#!/usr/bin/env node
// cdp-proxy.mjs — Lightweight CDP proxy for parallel multi-tab browser operations
// Bridges HTTP requests to Chrome's CDP WebSocket, enabling concurrent tab control.
//
// Usage: node cdp-proxy.mjs [--port PORT] [--cdp-port CDP_PORT]
// Env:   CDP_PROXY_PORT (default 3456), CDP_PORT (default: auto-discover)

import { createServer } from 'node:http';
import { connect as netConnect } from 'node:net';
import { readFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const PROXY_PORT = parseInt(getArg('--port', process.env.CDP_PROXY_PORT || '3456'), 10);
const EXPLICIT_CDP_PORT = getArg('--cdp-port', process.env.CDP_PORT);
const MAX_BATCH_SIZE = parseInt(getArg('--max-batch', process.env.CDP_MAX_BATCH || '50'), 10);

// ---------------------------------------------------------------------------
// Structured stderr logging
// ---------------------------------------------------------------------------
function logInfo(msg) {
  process.stderr.write(JSON.stringify({ level: 'info', hint: msg }) + '\n');
}
function logError(msg, recoverable = true) {
  process.stderr.write(JSON.stringify({ error: msg, hint: msg, recoverable }) + '\n');
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let ws = null;
let cmdId = 0;
const pending = new Map();   // id → { resolve, reject, timer }
const sessions = new Map();  // targetId → sessionId

// ---------------------------------------------------------------------------
// WebSocket — use native (Node 22+) or fallback to 'ws'
// ---------------------------------------------------------------------------
let WS;
try {
  WS = globalThis.WebSocket || (await import('ws')).default;
} catch {
  logError('Node 22+ required for native WebSocket, or install ws: npm i ws', false);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Chrome port discovery
// ---------------------------------------------------------------------------
async function checkPort(port) {
  return new Promise((resolve) => {
    const sock = netConnect({ host: '127.0.0.1', port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
    sock.setTimeout(1000, () => { sock.destroy(); resolve(false); });
  });
}

async function readDevToolsActivePort() {
  const paths = [];
  const os = platform();
  if (os === 'darwin') {
    paths.push(join(homedir(), 'Library/Application Support/Google/Chrome/DevToolsActivePort'));
    paths.push(join(homedir(), 'Library/Application Support/Google/Chrome Canary/DevToolsActivePort'));
  } else if (os === 'linux') {
    paths.push(join(homedir(), '.config/google-chrome/DevToolsActivePort'));
    paths.push(join(homedir(), '.config/chromium/DevToolsActivePort'));
  }
  // Also check the debug profile path used by our CDP setup guide
  paths.push(join(homedir(), '.chrome-debug-profile/DevToolsActivePort'));

  for (const p of paths) {
    try {
      const content = await readFile(p, 'utf-8');
      const lines = content.trim().split('\n');
      const port = parseInt(lines[0], 10);
      const wsPath = lines[1] || undefined;
      if (port > 0 && await checkPort(port)) return { port, wsPath };
    } catch { /* ignore */ }
  }
  return null;
}

async function discoverChromePort() {
  if (EXPLICIT_CDP_PORT) {
    const port = parseInt(EXPLICIT_CDP_PORT, 10);
    if (await checkPort(port)) return { port };
    throw new Error(`CDP port ${port} not responding`);
  }

  const fromFile = await readDevToolsActivePort();
  if (fromFile) return fromFile;

  for (const port of [9333, 9222, 9229]) {
    if (await checkPort(port)) return { port };
  }

  throw new Error('No Chrome CDP port found. Start Chrome with --remote-debugging-port=9333');
}

// ---------------------------------------------------------------------------
// WebSocket connection to Chrome
// ---------------------------------------------------------------------------
async function connectChrome(portInfo) {
  const { port, wsPath } = portInfo;
  let wsUrl;

  if (wsPath) {
    wsUrl = `ws://127.0.0.1:${port}${wsPath.startsWith('/') ? wsPath : '/' + wsPath}`;
  } else {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    const data = await res.json();
    wsUrl = data.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error('No webSocketDebuggerUrl in /json/version response');
  }

  return new Promise((resolve, reject) => {
    const socket = new WS(wsUrl);

    socket.addEventListener('open', () => {
      ws = socket;
      // Enable target discovery
      sendCDP('Target.setDiscoverTargets', { discover: true }).catch(() => {});
      resolve(socket);
    });

    socket.addEventListener('error', (e) => {
      reject(new Error(`WebSocket error: ${e.message || e}`));
    });

    socket.addEventListener('close', () => {
      ws = null;
      logError('CDP WebSocket closed. Proxy shutting down.', false);
      process.exit(1);
    });

    socket.addEventListener('message', (event) => {
      const data = typeof event.data === 'string' ? event.data : event.data.toString();
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      // Response to a command we sent
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject, timer } = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) {
          reject(new Error(`CDP error: ${msg.error.message} (${msg.error.code})`));
        } else {
          resolve(msg.result || {});
        }
      }

      // Session events — track attachedToTarget
      if (msg.method === 'Target.attachedToTarget' && msg.params) {
        const { sessionId, targetInfo } = msg.params;
        if (targetInfo?.targetId) {
          sessions.set(targetInfo.targetId, sessionId);
        }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// CDP command sender
// ---------------------------------------------------------------------------
function sendCDP(method, params = {}, sessionId) {
  if (!ws) return Promise.reject(new Error('Not connected'));

  const id = ++cmdId;
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method} (id=${id})`));
    }, 30000);

    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify(msg));
  });
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------
async function ensureSession(targetId) {
  if (sessions.has(targetId)) return sessions.get(targetId);

  const result = await sendCDP('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = result.sessionId;
  if (!sessionId) throw new Error(`Failed to attach to target ${targetId}`);
  sessions.set(targetId, sessionId);
  return sessionId;
}

// ---------------------------------------------------------------------------
// Page load waiter
// ---------------------------------------------------------------------------
async function waitForLoad(sessionId, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const result = await sendCDP('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true,
      }, sessionId);
      if (result.result?.value === 'complete') return;
    } catch { /* page may be navigating */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  // Don't throw — some SPAs never reach 'complete'
}

// ---------------------------------------------------------------------------
// Helper: get page info
// ---------------------------------------------------------------------------
async function getPageInfo(sessionId) {
  const result = await sendCDP('Runtime.evaluate', {
    expression: 'JSON.stringify({ title: document.title, url: location.href, readyState: document.readyState })',
    returnByValue: true,
  }, sessionId);
  try { return JSON.parse(result.result.value); } catch { return {}; }
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------
function parseQuery(url) {
  const u = new URL(url, 'http://localhost');
  return Object.fromEntries(u.searchParams);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function error(res, msg, status = 500) {
  json(res, { error: msg }, status);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const q = Object.fromEntries(url.searchParams);

  try {
    switch (path) {

      // Health check
      case '/health': {
        json(res, {
          ok: !!ws,
          proxy_port: PROXY_PORT,
          sessions: sessions.size,
          pending: pending.size,
        });
        break;
      }

      // List all page targets
      case '/list': {
        const result = await sendCDP('Target.getTargets');
        const pages = (result.targetInfos || [])
          .filter((t) => t.type === 'page')
          .map(({ targetId, title, url }) => ({ targetId, title, url }));
        json(res, pages);
        break;
      }

      // Open new background tab
      case '/new': {
        const tabUrl = q.url || 'about:blank';
        const result = await sendCDP('Target.createTarget', {
          url: tabUrl,
          background: true,
        });
        const targetId = result.targetId;
        const sessionId = await ensureSession(targetId);
        await waitForLoad(sessionId, parseInt(q.timeout || '15000', 10));
        const info = await getPageInfo(sessionId);
        json(res, { targetId, ...info });
        break;
      }

      // Close a tab
      case '/close': {
        const targetId = q.target;
        if (!targetId) { error(res, 'missing ?target=', 400); break; }
        await sendCDP('Target.closeTarget', { targetId });
        sessions.delete(targetId);
        json(res, { ok: true });
        break;
      }

      // Navigate existing tab
      case '/navigate': {
        const targetId = q.target;
        const navUrl = q.url;
        if (!targetId || !navUrl) { error(res, 'missing ?target= or ?url=', 400); break; }
        const sessionId = await ensureSession(targetId);
        await sendCDP('Page.navigate', { url: navUrl }, sessionId);
        await waitForLoad(sessionId, parseInt(q.timeout || '15000', 10));
        const info = await getPageInfo(sessionId);
        json(res, { ok: true, ...info });
        break;
      }

      // Execute JavaScript
      case '/eval': {
        let targetId, expression;
        if (req.method === 'POST') {
          const body = JSON.parse(await readBody(req));
          targetId = body.target;
          expression = body.expression;
        } else {
          targetId = q.target;
          expression = q.expression;
        }
        if (!targetId || !expression) { error(res, 'missing target or expression', 400); break; }
        const sessionId = await ensureSession(targetId);
        const result = await sendCDP('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true,
        }, sessionId);
        if (result.exceptionDetails) {
          error(res, result.exceptionDetails.text || 'eval error', 400);
        } else {
          json(res, { result: result.result?.value });
        }
        break;
      }

      // Screenshot
      case '/screenshot': {
        const targetId = q.target;
        if (!targetId) { error(res, 'missing ?target=', 400); break; }
        const sessionId = await ensureSession(targetId);
        const result = await sendCDP('Page.captureScreenshot', {
          format: 'png',
        }, sessionId);
        if (q.format === 'base64') {
          json(res, { data: result.data });
        } else {
          const buf = Buffer.from(result.data, 'base64');
          res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': buf.length });
          res.end(buf);
        }
        break;
      }

      // Page info
      case '/info': {
        const targetId = q.target;
        if (!targetId) { error(res, 'missing ?target=', 400); break; }
        const sessionId = await ensureSession(targetId);
        const info = await getPageInfo(sessionId);
        json(res, info);
        break;
      }

      // Batch open — open multiple URLs in parallel, return all targetIds
      case '/batch': {
        if (req.method !== 'POST') { error(res, 'POST required', 405); break; }
        const body = JSON.parse(await readBody(req));
        const urls = body.urls;
        if (!Array.isArray(urls) || urls.length === 0) { error(res, 'missing urls array', 400); break; }
        if (urls.length > MAX_BATCH_SIZE) { error(res, `batch size ${urls.length} exceeds limit ${MAX_BATCH_SIZE}`, 400); break; }

        const results = await Promise.allSettled(
          urls.map(async (tabUrl) => {
            const result = await sendCDP('Target.createTarget', { url: tabUrl, background: true });
            const targetId = result.targetId;
            const sessionId = await ensureSession(targetId);
            await waitForLoad(sessionId, parseInt(q.timeout || '15000', 10));
            const info = await getPageInfo(sessionId);
            return { targetId, ...info };
          })
        );

        json(res, results.map((r) =>
          r.status === 'fulfilled' ? r.value : { error: r.reason?.message }
        ));
        break;
      }

      // Batch eval — eval expression on multiple targets
      case '/batch-eval': {
        if (req.method !== 'POST') { error(res, 'POST required', 405); break; }
        const body = JSON.parse(await readBody(req));
        const { targets, expression } = body;
        if (!Array.isArray(targets) || !expression) { error(res, 'missing targets or expression', 400); break; }
        if (targets.length > MAX_BATCH_SIZE) { error(res, `batch size ${targets.length} exceeds limit ${MAX_BATCH_SIZE}`, 400); break; }

        const results = await Promise.allSettled(
          targets.map(async (targetId) => {
            const sessionId = await ensureSession(targetId);
            const result = await sendCDP('Runtime.evaluate', {
              expression,
              returnByValue: true,
              awaitPromise: true,
            }, sessionId);
            if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
            return { targetId, result: result.result?.value };
          })
        );

        json(res, results.map((r) =>
          r.status === 'fulfilled' ? r.value : { error: r.reason?.message }
        ));
        break;
      }

      // Batch close — close multiple targets
      case '/batch-close': {
        if (req.method !== 'POST') { error(res, 'POST required', 405); break; }
        const body = JSON.parse(await readBody(req));
        const targets = body.targets;
        if (!Array.isArray(targets)) { error(res, 'missing targets array', 400); break; }

        await Promise.allSettled(
          targets.map(async (targetId) => {
            await sendCDP('Target.closeTarget', { targetId });
            sessions.delete(targetId);
          })
        );
        json(res, { ok: true, closed: targets.length });
        break;
      }

      default:
        error(res, `unknown route: ${path}`, 404);
    }
  } catch (e) {
    error(res, e.message);
  }
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Check if already running
  try {
    const check = await fetch(`http://127.0.0.1:${PROXY_PORT}/health`);
    if (check.ok) {
      const data = await check.json();
      console.log(JSON.stringify({ already_running: true, ...data }));
      process.exit(0);
    }
  } catch { /* not running, good */ }

  // Discover and connect
  logInfo('Discovering Chrome CDP port...');
  const portInfo = await discoverChromePort();
  logInfo(`Found Chrome on port ${portInfo.port}`);

  await connectChrome(portInfo);
  logInfo('Connected to Chrome CDP');

  // Start HTTP server
  server.listen(PROXY_PORT, '127.0.0.1', () => {
    logInfo(`CDP proxy listening on http://127.0.0.1:${PROXY_PORT}`);
    // Machine-readable startup signal
    console.log(JSON.stringify({ ok: true, proxy_port: PROXY_PORT, cdp_port: portInfo.port }));
  });
}

// Graceful shutdown
process.on('SIGINT', () => { ws?.close(); process.exit(0); });
process.on('SIGTERM', () => { ws?.close(); process.exit(0); });
process.on('uncaughtException', (e) => { logError(`Uncaught: ${e.message}`); });
process.on('unhandledRejection', (e) => { logError(`Unhandled: ${e}`); });

main().catch((e) => {
  logError(`Fatal: ${e.message}`, false);
  process.exit(1);
});
