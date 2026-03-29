---
name: better-agent-browser
description: "Enhanced browser automation extending agent-browser CLI with parallel multi-tab operations, CAPTCHA/automation-block detection, and per-domain site experience. Triggers: 'parallel browse', 'open multiple tabs', 'batch scrape', 'captcha check', 'automation blocked', 'site pattern', 'better browser', 'cdp proxy', 'parallel tabs'."
---

# Better Agent Browser

Extends `agent-browser` CLI with three capabilities:
1. **Parallel Tabs** — Open and operate on many tabs simultaneously via a lightweight CDP proxy
2. **CAPTCHA / Automation Block Detection** — Distinguish solvable CAPTCHAs from unsolvable automation blocks
3. **Site Experience** — Per-domain patterns that accumulate knowledge about site quirks

**This skill complements agent-browser, not replaces it.** Use agent-browser for interactive operations (ref-based clicks, form fills, snapshots). Use this skill's CDP proxy for batch/parallel operations.

## Language

**Match user's language**: Respond in the same language the user uses.

## Workflow

Progress:
- [ ] Step 1: Preflight — verify dependencies and determine mode
- [ ] Step 2: Site check — read site-patterns for target domain
- [ ] Step 3: Execute — use the appropriate capability (parallel tabs / interactive / both)
- [ ] Step 4: CAPTCHA watch — detect and handle blocks after navigation
- [ ] Step 5: Cleanup — close tabs and stop proxy

### Step 1: Preflight (MUST run first)

```bash
bash ${SKILL_PATH}/scripts/check-deps.sh [CDP_PORT]
```

Output: `{ ready, mode, agent_browser, node, chrome_cdp, proxy, hint }`.

**Act on the result:**

| `ready` | `mode` | Action |
|---------|--------|--------|
| `true` | `cdp` | Full capabilities. Proceed to Step 2. |
| `true` | `session` | Degraded — no parallel tabs, no anti-bot sites. Proceed with session-mode only. |
| `false` | — | **STOP.** Fix hard dependencies per the `hint` field. |

#### Check → Fix Table

| Check | Failure | Fix (macOS) | Fix (Linux) |
|-------|---------|-------------|-------------|
| `agent_browser` | `false` | `npm i -g agent-browser && agent-browser install` | Same |
| `node` | `false` | `brew install node@22` | `nvm install 22` |
| `chrome_cdp` | `false` | See "First-Time CDP Setup" below | Same |
| `proxy` | `false` | `node ${SKILL_PATH}/scripts/cdp-proxy.mjs &` | Same |

#### First-Time CDP Setup

If `chrome_cdp` is false, guide the user through one-time setup:

```bash
# 1. Quit Chrome completely (Cmd+Q / close all windows)
# 2. Start Chrome with debugging port
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9333 \
  '--remote-allow-origins=*' \
  --user-data-dir="$HOME/.chrome-debug-profile" &

# 3. Verify CDP is available
curl -s http://127.0.0.1:9333/json/version

# 4. User logs in to target sites manually in this Chrome
# 5. Login state persists across sessions in ~/.chrome-debug-profile
```

### Step 2: Site Check

Before navigating to any domain, check for a site-pattern file:

```bash
DOMAIN="x.com"
PATTERN_FILE="${SKILL_PATH}/references/site-patterns/${DOMAIN}.md"
```

- **File exists** → Read it. If `Requires CDP mode: YES` and current mode is `session` → **STOP**, tell user to switch to CDP.
- **File doesn't exist** → Proceed normally. If you learn new quirks, create a pattern file using `_template.md`.

Available patterns (read on demand, do NOT preload):

| Domain | Key Info |
|--------|----------|
| `cloudflare.md` | Turnstile detection/strategy, REQUIRES CDP mode |
| `x.com.md` | Feed scroll container, `data-testid` selectors, DOM obfuscation |

### Step 3: Execute

Choose the appropriate mode based on task:

| Task | Tool | Requires |
|------|------|----------|
| Open 10+ URLs in parallel | CDP proxy `/batch` | CDP mode |
| Extract content from many pages | CDP proxy `/batch-eval` | CDP mode |
| Click/fill forms with ref precision | `agent-browser --cdp` | CDP or session |
| Take snapshot with @refs | `agent-browser --cdp` or `--session` | Either mode |
| Both batch AND interactive | CDP proxy + agent-browser | CDP mode |

**Parallel Tabs (CDP Proxy):**

```bash
# Start proxy
node ${SKILL_PATH}/scripts/cdp-proxy.mjs &
PROXY="http://127.0.0.1:3456"

# Batch open → extract → close
TABS=$(curl -s -X POST "$PROXY/batch" \
  -H 'Content-Type: application/json' \
  -d '{"urls":["https://site1.com","https://site2.com"]}')
TARGETS=$(echo "$TABS" | jq '[.[].targetId]')
curl -s -X POST "$PROXY/batch-eval" \
  -H 'Content-Type: application/json' \
  -d "{\"targets\":$TARGETS,\"expression\":\"document.title\"}"
curl -s -X POST "$PROXY/batch-close" \
  -H 'Content-Type: application/json' \
  -d "{\"targets\":$TARGETS}"
```

For full API reference, read `references/api.md`.

**Parallel Sub-Agents:**

```
Main Agent
├── Start CDP proxy
├── Sub-Agent A: curl /new → targetId-A → /eval, /screenshot → /close
├── Sub-Agent B: curl /new → targetId-B → /eval, /screenshot → /close
└── Sub-Agent C: curl /new → targetId-C → /eval, /screenshot → /close
    All share same Chrome, same login state, same cookies
```

### Step 4: CAPTCHA Watch

After every `navigate` to an external site, run:

```bash
bash ${SKILL_PATH}/scripts/captcha-watch.sh --cdp 9333
# Or for proxy tabs:
bash ${SKILL_PATH}/scripts/captcha-watch.sh --proxy-eval <targetId>
```

**Act on exit code:**

| Exit | Meaning | Action |
|------|---------|--------|
| `0` | No CAPTCHA | Continue normally |
| `1` | Solvable CAPTCHA | Screenshot → notify user → poll every 5s (max 120s) |
| `2` | Automation block | **STOP.** Must switch to CDP mode. Never retry in session mode. |
| `3` | Error | Check connection, retry once |

**Solvable CAPTCHA handling (exit 1):**

```bash
agent-browser --cdp 9333 screenshot captcha.png
echo "CAPTCHA detected. Please solve it in Chrome, then I'll continue."
for i in $(seq 1 24); do
  sleep 5
  RESULT=$(bash ${SKILL_PATH}/scripts/captcha-watch.sh --cdp 9333)
  if echo "$RESULT" | jq -e '.captcha == false' >/dev/null 2>&1; then
    break
  fi
done
```

**Automation block handling (exit 2):**

Tell user: "This site blocks automated browsers (navigator.webdriver=true). Switch to CDP mode with real Chrome. See First-Time CDP Setup in Step 1."

### Step 5: Cleanup

Always clean up when done:

```bash
# Close proxy-opened tabs
curl -s http://127.0.0.1:3456/list | jq '[.[].targetId]' | \
  xargs -I {} curl -s -X POST http://127.0.0.1:3456/batch-close \
  -H 'Content-Type: application/json' -d '{"targets":{}}'

# Stop proxy
pkill -f cdp-proxy.mjs 2>/dev/null || true
```

## Degradation Strategy

| Component | Unavailable | Degraded Behavior |
|-----------|-------------|-------------------|
| Chrome CDP | Not running | Session mode only — no parallel tabs, no anti-bot sites. agent-browser `--session` still works for basic browsing. |
| CDP proxy | Not started | Single-tab only via agent-browser. Batch/parallel operations unavailable. |
| agent-browser | Not installed | **Fatal.** Cannot proceed. |
| Node.js 22+ | Not installed | **Fatal.** CDP proxy cannot start. |
| Site patterns | File missing | Proceed without domain knowledge. Risk: may hit unexpected anti-bot or scroll issues. |

## Troubleshooting

| Symptom | Resolution |
|---------|------------|
| `check-deps.sh` returns `ready:false` | Follow the `hint` field. See Check → Fix Table in Step 1. |
| CDP proxy can't find Chrome | Start Chrome with `--remote-debugging-port=9333`. Verify: `curl http://127.0.0.1:9333/json/version` |
| Proxy port already in use | `CDP_PROXY_PORT=3457 node cdp-proxy.mjs &` |
| `/new` hangs | Slow page. Use `?timeout=30000`. |
| CAPTCHA unsolvable (exit 2) | Browser has automation flags. Switch to CDP mode with real Chrome. |
| `navigator.webdriver=true` in CDP mode | You're connected to Playwright Chrome, not real Chrome. Use manually-started Chrome. |
| Tabs accumulate | Always `/batch-close` when done. Check with `/list`. |

## References (read on demand)

| Document | When to read |
|----------|-------------|
| `references/api.md` | CDP proxy API details, examples, batch operations |
| `references/site-patterns/*.md` | Before navigating to specific domains |
