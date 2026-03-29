# better-agent-browser Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a skill that extends agent-browser with three capabilities: multi-tab parallel browsing via a lightweight CDP proxy, CAPTCHA detection watchdog, and site experience accumulation.

**Architecture:** A single Claude Code skill (`better-agent-browser`) containing: (1) a ~200-line Node.js CDP proxy script (`cdp-proxy.mjs`) that multiplexes HTTP requests over a single WebSocket to Chrome for parallel tab operations, (2) a shell script (`captcha-watch.sh`) that detects CAPTCHA pages via agent-browser snapshot pattern matching — critically distinguishing between solvable CAPTCHAs (CDP mode, real Chrome) and unsolvable automation blocks (session mode, Playwright browser with `navigator.webdriver=true`), (3) a `site-patterns/` directory with per-domain experience files that flag anti-bot sites to prevent session-mode access. The skill delegates interactive operations to agent-browser CLI and handles batch/parallel operations through the CDP proxy.

**Tech Stack:** Node.js 22+ (native WebSocket), agent-browser CLI, Bash

---

## Project Structure

```
better-agent-browser/
├── skills/
│   └── better-agent-browser/
│       ├── SKILL.md                          # Core skill definition
│       ├── scripts/
│       │   ├── cdp-proxy.mjs                 # Lightweight CDP proxy for parallel tabs
│       │   ├── captcha-watch.sh              # CAPTCHA detection wrapper
│       │   └── check-deps.sh                 # Prerequisites check
│       └── references/
│           └── site-patterns/                # Per-domain experience files
│               ├── _template.md              # Template for new site patterns
│               ├── cloudflare.md             # Cloudflare Turnstile patterns
│               └── x.com.md                  # X/Twitter patterns
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── README.md
├── README.zh.md
├── LICENSE
└── .gitignore
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `better-agent-browser/.gitignore`
- Create: `better-agent-browser/LICENSE`
- Create: `better-agent-browser/.claude-plugin/plugin.json`
- Create: `better-agent-browser/.claude-plugin/marketplace.json`

**Step 1: Create .gitignore**

```
.DS_Store
node_modules/
*.log
.env
.cache
```

**Step 2: Create LICENSE**

MIT License, copyright 2026 psylch.

**Step 3: Create plugin.json**

```json
{
  "name": "better-agent-browser",
  "description": "Enhanced browser automation: parallel tabs via CDP proxy, CAPTCHA detection, site experience accumulation. Extends agent-browser CLI.",
  "version": "0.1.0",
  "author": {
    "name": "psylch"
  },
  "homepage": "https://github.com/psylch/better-agent-browser",
  "repository": "https://github.com/psylch/better-agent-browser",
  "license": "MIT",
  "keywords": ["browser", "automation", "cdp", "parallel", "captcha", "agent-browser"]
}
```

**Step 4: Create marketplace.json**

```json
{
  "name": "psylch-better-agent-browser",
  "owner": {
    "name": "psylch"
  },
  "metadata": {
    "description": "Parallel tabs, CAPTCHA detection, and site experience for agent-browser"
  },
  "plugins": [
    {
      "name": "better-agent-browser",
      "source": "./",
      "description": "Enhanced browser automation: parallel multi-tab CDP proxy, CAPTCHA watchdog, per-domain site experience. Extends agent-browser CLI with batch capabilities.",
      "version": "0.1.0",
      "category": "automation",
      "tags": ["browser", "cdp", "parallel", "captcha", "agent-browser"],
      "homepage": "https://github.com/psylch/better-agent-browser"
    }
  ]
}
```

**Step 5: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold better-agent-browser project"
```

---

### Task 2: CDP Proxy — Core WebSocket + HTTP Server

This is the most critical piece. Build `cdp-proxy.mjs` that bridges HTTP requests to Chrome's CDP WebSocket.

**Files:**
- Create: `skills/better-agent-browser/scripts/cdp-proxy.mjs`

**Step 1: Write the CDP proxy script**

Core components (in order of implementation within the single file):

1. **Chrome port discovery** — `discoverChromePort()`
   - Read `~/Library/Application Support/Google/Chrome/DevToolsActivePort` (macOS)
   - Fallback: scan ports 9222, 9229, 9333 via TCP connect
   - Return `{ port, wsPath? }`

2. **WebSocket connection** — `connect(port)`
   - Fetch `http://127.0.0.1:<port>/json/version` to get `webSocketDebuggerUrl`
   - Open WebSocket with native `WebSocket` (Node 22+), fallback to `ws` module
   - Set up `onMessage` handler: parse JSON, if message has `id` → resolve from `pending` Map; if message has `method` → event (ignore for now)

3. **CDP command sender** — `sendCDP(method, params, sessionId?)`
   - Increment global `cmdId`
   - Create Promise, store resolver + 30s timeout in `pending` Map keyed by `cmdId`
   - Send JSON: `{ id: cmdId, method, params, sessionId? }`
   - Return Promise

4. **Session manager** — `ensureSession(targetId)`
   - Check `sessions` Map for existing sessionId
   - If missing: `sendCDP('Target.attachToTarget', { targetId, flatten: true })` → store sessionId
   - Return sessionId

5. **Page load waiter** — `waitForLoad(sessionId, timeout=15000)`
   - Loop: `sendCDP('Runtime.evaluate', { expression: 'document.readyState' }, sessionId)`
   - If result === 'complete', return
   - Otherwise sleep 500ms and retry
   - Throw on timeout

6. **HTTP server** with routes:

| Route | Method | Params | CDP Commands | Returns |
|-------|--------|--------|-------------|---------|
| `GET /health` | — | — | — | `{ ok, port, sessions }` |
| `GET /list` | — | — | `Target.getTargets` | `[{ targetId, title, url }]` |
| `GET /new` | — | `?url=` | `Target.createTarget` → `ensureSession` → `waitForLoad` | `{ targetId, title, url }` |
| `GET /close` | — | `?target=` | `Target.closeTarget` | `{ ok }` |
| `POST /eval` | JSON body | `{ target, expression }` | `ensureSession` → `Runtime.evaluate` | `{ result }` |
| `GET /navigate` | — | `?target=&url=` | `ensureSession` → `Page.navigate` → `waitForLoad` | `{ ok }` |
| `GET /screenshot` | — | `?target=` | `ensureSession` → `Page.captureScreenshot` | base64 PNG |
| `GET /info` | — | `?target=` | `ensureSession` → `Runtime.evaluate` (title, url, readyState) | `{ title, url, readyState }` |

7. **Startup logic** — `main()`
   - Check if already running: `fetch http://127.0.0.1:<proxyPort>/health`
   - If running, exit with message
   - Otherwise: `discoverChromePort()` → `connect()` → start HTTP server
   - Default proxy port: `CDP_PROXY_PORT` env or `3456`

**Step 2: Test manually**

```bash
# Ensure Chrome is running with --remote-debugging-port=9333
node skills/better-agent-browser/scripts/cdp-proxy.mjs &

# Health check
curl -s http://127.0.0.1:3456/health | jq .

# Open a tab
curl -s 'http://127.0.0.1:3456/new?url=https://example.com' | jq .

# List tabs
curl -s http://127.0.0.1:3456/list | jq .

# Eval on tab
curl -s -X POST http://127.0.0.1:3456/eval \
  -H 'Content-Type: application/json' \
  -d '{"target":"<targetId>","expression":"document.title"}'

# Close tab
curl -s 'http://127.0.0.1:3456/close?target=<targetId>'

# Kill proxy
kill %1
```

**Step 3: Commit**

```bash
git add skills/better-agent-browser/scripts/cdp-proxy.mjs
git commit -m "feat: add CDP proxy for parallel multi-tab operations"
```

---

### Task 3: CAPTCHA & Automation Block Detection Script

**Critical design point:** Playwright-managed browsers (agent-browser `--session` mode) set `navigator.webdriver=true` and other automation flags. Cloudflare/Turnstile detects this and blocks — even a human user cannot solve the CAPTCHA because the browser itself is flagged. The script MUST distinguish:

- **Solvable CAPTCHA** (CDP mode → real Chrome, no automation flags) → wait for user
- **Automation block** (session mode → Playwright browser, automation flags) → unsolvable, must switch to CDP mode

**Files:**
- Create: `skills/better-agent-browser/scripts/captcha-watch.sh`

**Step 1: Write the CAPTCHA detection script**

```bash
#!/usr/bin/env bash
# captcha-watch.sh — Detect CAPTCHA / automation blocks in current page
#
# Usage: captcha-watch.sh [--cdp PORT] [--session NAME]
# Exit codes:
#   0 = no CAPTCHA
#   1 = CAPTCHA detected (solvable — CDP mode, user can solve)
#   2 = automation block detected (unsolvable — session mode, must switch to CDP)
#   3 = error
#
# Outputs JSON: { "captcha": bool, "type": "...", "solvable": bool, "mode": "cdp|session", "hint": "..." }

set -euo pipefail

CDP_FLAG=""
SESSION_FLAG=""
MODE="unknown"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cdp) CDP_FLAG="--cdp $2"; MODE="cdp"; shift 2 ;;
    --session) SESSION_FLAG="--session $2"; MODE="session"; shift 2 ;;
    *) shift ;;
  esac
done

AB_CMD="agent-browser $CDP_FLAG $SESSION_FLAG"

# Get snapshot text
SNAPSHOT=$($AB_CMD snapshot 2>/dev/null || echo "")

if [[ -z "$SNAPSHOT" ]]; then
  echo '{"captcha":false,"type":"none","solvable":false,"mode":"'"$MODE"'","hint":"snapshot failed"}'
  exit 3
fi

# Also check navigator.webdriver to confirm automation flags
WEBDRIVER=$($AB_CMD eval 'navigator.webdriver' 2>/dev/null || echo "unknown")

# Detect CAPTCHA type
detect_captcha() {
  local snap="$1"

  # Cloudflare Turnstile / Challenge
  if echo "$snap" | grep -iqE "cf-turnstile|challenges\.cloudflare|Verify you are human|Just a moment"; then
    echo "cloudflare"; return 0
  fi

  # hCaptcha
  if echo "$snap" | grep -iqE "h-captcha|hcaptcha\.com|hcaptcha-box"; then
    echo "hcaptcha"; return 0
  fi

  # Google reCAPTCHA
  if echo "$snap" | grep -iqE "g-recaptcha|recaptcha|google\.com/recaptcha"; then
    echo "recaptcha"; return 0
  fi

  # Generic patterns
  if echo "$snap" | grep -iqE "are you a robot|verify you.re human|captcha"; then
    echo "generic"; return 0
  fi

  echo "none"; return 1
}

TYPE=$(detect_captcha "$SNAPSHOT") && FOUND=true || FOUND=false

if ! $FOUND; then
  echo '{"captcha":false,"type":"none","solvable":true,"mode":"'"$MODE"'","hint":"no CAPTCHA detected"}'
  exit 0
fi

# Key decision: is this solvable?
# If navigator.webdriver=true (Playwright browser), anti-bot CAPTCHAs are UNSOLVABLE
# even by a human user — the browser fingerprint itself is rejected.
if [[ "$WEBDRIVER" == "true" ]]; then
  SOLVABLE=false
  HINT="Automation block detected ($TYPE). Browser has navigator.webdriver=true — CAPTCHA is unsolvable even manually. Switch to CDP mode: connect to real Chrome with --remote-debugging-port."
  echo "{\"captcha\":true,\"type\":\"$TYPE\",\"solvable\":false,\"mode\":\"$MODE\",\"hint\":\"$HINT\"}"
  exit 2
else
  SOLVABLE=true
  HINT="CAPTCHA detected ($TYPE) in real Chrome. User can solve manually. Take screenshot and wait."
  echo "{\"captcha\":true,\"type\":\"$TYPE\",\"solvable\":true,\"mode\":\"$MODE\",\"hint\":\"$HINT\"}"
  exit 1
fi
```

**Step 2: Test manually**

```bash
chmod +x skills/better-agent-browser/scripts/captcha-watch.sh

# CDP mode — real Chrome, should be solvable if CAPTCHA appears
bash skills/better-agent-browser/scripts/captcha-watch.sh --cdp 9333

# Session mode — Playwright browser, if CAPTCHA appears it's unsolvable
bash skills/better-agent-browser/scripts/captcha-watch.sh --session test
```

**Step 3: Commit**

```bash
git add skills/better-agent-browser/scripts/captcha-watch.sh
git commit -m "feat: add CAPTCHA detection script via snapshot pattern matching"
```

---

### Task 4: Prerequisites Check Script

**Files:**
- Create: `skills/better-agent-browser/scripts/check-deps.sh`

**Step 1: Write check-deps.sh**

```bash
#!/usr/bin/env bash
# check-deps.sh — Verify prerequisites for better-agent-browser
# Exit codes: 0 = ready, 1 = needs setup
# Output: JSON { "ready": bool, "agent_browser": bool, "node": bool, "chrome_cdp": bool, "proxy": bool, "hint": "..." }

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CDP_PORT="${1:-9333}"
PROXY_PORT="${CDP_PROXY_PORT:-3456}"

check_agent_browser() {
  command -v agent-browser &>/dev/null
}

check_node() {
  local ver
  ver=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
  [[ -n "$ver" ]] && [[ "$ver" -ge 22 ]]
}

check_chrome_cdp() {
  curl -sf "http://127.0.0.1:${CDP_PORT}/json/version" &>/dev/null
}

check_proxy() {
  curl -sf "http://127.0.0.1:${PROXY_PORT}/health" &>/dev/null
}

AB=$(check_agent_browser && echo true || echo false)
ND=$(check_node && echo true || echo false)
CDP=$(check_chrome_cdp && echo true || echo false)
PXY=$(check_proxy && echo true || echo false)

READY=true
HINTS=()

if ! $AB; then READY=false; HINTS+=("Install agent-browser: npm i -g agent-browser && agent-browser install"); fi
if ! $ND; then READY=false; HINTS+=("Need Node.js 22+"); fi
if ! $CDP; then HINTS+=("Chrome CDP not detected on port $CDP_PORT. Start Chrome with --remote-debugging-port=$CDP_PORT or use agent-browser --session mode"); fi

HINT=$(IFS='; '; echo "${HINTS[*]:-all good}")

cat <<EOF
{"ready":$READY,"agent_browser":$AB,"node":$ND,"chrome_cdp":$CDP,"proxy":$PXY,"hint":"$HINT"}
EOF

$READY && exit 0 || exit 1
```

**Step 2: Commit**

```bash
chmod +x skills/better-agent-browser/scripts/check-deps.sh
git add skills/better-agent-browser/scripts/check-deps.sh
git commit -m "feat: add prerequisites check script"
```

---

### Task 5: Site Experience Files

**Files:**
- Create: `skills/better-agent-browser/references/site-patterns/_template.md`
- Create: `skills/better-agent-browser/references/site-patterns/cloudflare.md`
- Create: `skills/better-agent-browser/references/site-patterns/x.com.md`

**Step 1: Write _template.md**

```markdown
# {domain}

## Scroll Container

- Default `window.scrollTo()` works: yes/no
- Actual scroll container: `{selector}`

## Anti-Bot

- Cloudflare Turnstile: yes/no
- Login required: yes/no
- Rate limiting: notes
- **Requires CDP mode**: yes/no (if yes, session mode will be blocked by automation detection)

## Known Selectors

| Element | Selector | Notes |
|---------|----------|-------|
| ... | ... | ... |

## Gotchas

- ...

## Last Verified

YYYY-MM-DD
```

**Step 2: Write cloudflare.md**

```markdown
# Cloudflare (Turnstile / Challenge)

## Anti-Bot

- Cloudflare Turnstile: yes
- **Requires CDP mode**: YES — Playwright browsers (navigator.webdriver=true) are always blocked. Even manual solving fails because the browser fingerprint is rejected.

## Detection

Snapshot contains: "Verify you are human", "Just a moment", "cf-turnstile"

## Behavior

- Initial challenge: 3-5 second wait, then auto-resolves if browser fingerprint is clean (real Chrome)
- Playwright/automation browsers: ALWAYS blocked, no workaround
- If blocked in real Chrome: shows interactive CAPTCHA widget
- Repeated visits from same IP may reduce challenge frequency

## Strategy

1. **Pre-check**: If current mode is session (not CDP), ABORT and tell agent to switch to CDP mode. Do not attempt navigation.
2. After navigation in CDP mode, wait 5 seconds before checking snapshot
3. If "Just a moment" still present after 5s, CAPTCHA is interactive — screenshot + notify user
4. Do NOT click the Turnstile checkbox programmatically (triggers harder challenge)
5. Once resolved, page usually redirects automatically

## Last Verified

2026-03-29
```

**Step 3: Write x.com.md**

```markdown
# x.com (Twitter/X)

## Scroll Container

- `window.scrollTo()` does NOT work for feed scrolling
- Main feed scroll container: `main[role="main"]` or the first scrollable child of `[data-testid="primaryColumn"]`
- Use: `document.querySelector('[data-testid="primaryColumn"]').scrollBy(0, 1000)`

## Anti-Bot

- Aggressive rate limiting on unauthenticated requests
- Login wall appears after ~2-3 pages of browsing without login
- Cloudflare Turnstile on login page

## Known Selectors

| Element | Selector | Notes |
|---------|----------|-------|
| Tweet text | `[data-testid="tweetText"]` | |
| Username | `[data-testid="User-Name"]` | Contains both display name and @handle |
| Like button | `[data-testid="like"]` | |
| Retweet button | `[data-testid="retweet"]` | |
| Reply button | `[data-testid="reply"]` | |
| Search input | `[data-testid="SearchBox_Search_Input"]` | |
| Grok input | Varies, use snapshot ref | Changes frequently |

## Gotchas

- DOM class names are hashed/obfuscated — never rely on class selectors
- Use `data-testid` attributes or snapshot refs exclusively
- Infinite scroll: new tweets load as you scroll, old ones get removed from DOM
- Image lazy loading: screenshots may show placeholders if taken too fast

## Last Verified

2026-03-29
```

**Step 4: Commit**

```bash
git add skills/better-agent-browser/references/
git commit -m "feat: add site experience patterns (template, cloudflare, x.com)"
```

---

### Task 6: SKILL.md — Core Skill Definition

**Files:**
- Create: `skills/better-agent-browser/SKILL.md`

**Step 1: Write SKILL.md**

The SKILL.md should cover:

1. **Frontmatter**: name, description with trigger words
2. **Overview**: What this skill adds on top of agent-browser
3. **Prerequisites**: check-deps.sh
4. **Three capabilities** with usage flows:
   - Parallel Tabs (CDP proxy)
   - CAPTCHA Detection
   - Site Experience
5. **When to use which mode**: agent-browser CLI vs CDP proxy
6. **References**: site-patterns loading instructions

Key design decisions for SKILL.md:

- **Parallel tabs flow**: Start proxy → `/new` to open tabs → `/eval` to extract → `/close` to cleanup
- **CAPTCHA flow**: After every `navigate`, run `captcha-watch.sh`. If detected, screenshot + notify user + poll until resolved
- **Site experience flow**: Before operating on a domain, check if `site-patterns/{domain}.md` exists. If yes, read it. After learning new patterns, agent should update the file.

The SKILL.md content should be the actual Claude instruction prompt, not human documentation.

**Step 2: Commit**

```bash
git add skills/better-agent-browser/SKILL.md
git commit -m "feat: add SKILL.md with parallel tabs, CAPTCHA, and site experience workflows"
```

---

### Task 7: README Files

**Files:**
- Create: `README.md` (English)
- Create: `README.zh.md` (Chinese)

**Step 1: Write README.md**

Standard structure per template: title, badges, one-liner, feature table, installation (3 methods), prerequisites, usage examples, architecture diagram (text), file structure, known issues, license.

**Step 2: Write README.zh.md**

Chinese translation of README.md.

**Step 3: Commit**

```bash
git add README.md README.zh.md
git commit -m "docs: add README in English and Chinese"
```

---

### Task 8: Git Init + Final Verification

**Step 1: Verify project structure**

```bash
find better-agent-browser -type f | sort
```

Expected:
```
better-agent-browser/.claude-plugin/marketplace.json
better-agent-browser/.claude-plugin/plugin.json
better-agent-browser/.gitignore
better-agent-browser/LICENSE
better-agent-browser/README.md
better-agent-browser/README.zh.md
better-agent-browser/docs/plans/2026-03-29-better-agent-browser.md
better-agent-browser/skills/better-agent-browser/SKILL.md
better-agent-browser/skills/better-agent-browser/references/site-patterns/_template.md
better-agent-browser/skills/better-agent-browser/references/site-patterns/cloudflare.md
better-agent-browser/skills/better-agent-browser/references/site-patterns/x.com.md
better-agent-browser/skills/better-agent-browser/scripts/captcha-watch.sh
better-agent-browser/skills/better-agent-browser/scripts/cdp-proxy.mjs
better-agent-browser/skills/better-agent-browser/scripts/check-deps.sh
```

**Step 2: Run check-deps.sh to verify it works**

```bash
bash better-agent-browser/skills/better-agent-browser/scripts/check-deps.sh
```

**Step 3: Test CDP proxy (if Chrome CDP is available)**

```bash
node better-agent-browser/skills/better-agent-browser/scripts/cdp-proxy.mjs &
curl -s http://127.0.0.1:3456/health | jq .
kill %1
```

**Step 4: Run better-skill-review validate.py (if available)**

```bash
python3 better-skills/validate.py run --path better-agent-browser
```

**Step 5: Fix any validation issues found**

**Step 6: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup and validation fixes"
```
