---
name: better-agent-browser
description: "Enhanced browser automation extending agent-browser CLI with parallel multi-tab operations, CAPTCHA/automation-block detection, login-watch, and per-domain site experience. Triggers: 'parallel browse', 'open multiple tabs', 'batch scrape', 'captcha check', 'automation blocked', 'site pattern', 'better browser', 'cdp proxy', 'parallel tabs', 'login watch'."
---

# Better Agent Browser

Extends `agent-browser` CLI with four capabilities:
1. **Login Watch** — Auto-detect login walls, notify user, poll until login completes
2. **CAPTCHA / Automation Block Detection** — Distinguish solvable CAPTCHAs from unsolvable automation blocks
3. **Site Experience** — Per-domain patterns that accumulate over time as agents learn site quirks
4. **Parallel Tabs** — Operate many tabs simultaneously via CDP proxy, sharing one Chrome and one login state

**This skill complements agent-browser, not replaces it.** `agent-browser` is the execution layer. This skill adds detection, experience, and coordination on top.

`${SKILL_PATH}` is set by skills.sh to this skill's install directory.

## Language

**Match user's language.**

---

## Layers — Start Simple, Escalate When Needed

```
Layer 0a: agent-browser open              ← local dev / public pages (no CDP)
Layer 0b: agent-browser connect <port>    ← external sites needing login / anti-bot
Layer 1:  + login-watch / captcha-watch   ← when hitting login walls or anti-bot
        + site-patterns                 ← read before, write after
Layer 2:  + CDP proxy                     ← parallel multi-tab only
```

Always start at Layer 0. Escalate only when you hit a specific problem.

---

## Layer 0: Direct agent-browser

**Do you need the user's login state or need to bypass anti-bot?**

### 0a: No login needed

Local dev, testing, public pages. Just use `agent-browser open` — launches its own browser, no setup.

```bash
agent-browser open http://localhost:3000
agent-browser snapshot -i
agent-browser click @e3
agent-browser screenshot page.png
```

### 0b: External sites

Connect to the **agent's dedicated Chrome profile** at `~/.chrome-debug-profile`. This is a persistent profile — login state, cookies, and site data survive across sessions and agents. Once the user logs into a site here, it stays logged in for all future agent sessions.

```bash
agent-browser connect 9333
agent-browser open https://github.com/settings
agent-browser snapshot -i
```

Connection persists — subsequent commands don't need `--cdp` or `connect` again.

**Default assumption: already logged in.** This profile accumulates login state over time. Navigate to the target page directly — don't pre-check login. Only if you hit a login wall, escalate to Layer 1's login-watch.

**Tab management:**

```bash
agent-browser tab list           # [index] title - url
agent-browser tab 0              # Switch by index (0-based)
agent-browser tab new https://...  # Open new tab
agent-browser tab close          # Close current tab
agent-browser get url            # Which tab am I on?
```

**Tab discipline:** Don't touch existing tabs. Work in tabs you create (`tab new` / `open`). Close your tabs when done.

**First-time Chrome setup** (once per machine boot, when debug port is not running):

```bash
# 1. Quit Chrome (Cmd+Q)
# 2. Start the agent's dedicated Chrome profile
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9333 '--remote-allow-origins=*' \
  --user-data-dir="$HOME/.chrome-debug-profile" 2>/dev/null &

# 3. Verify
curl -s http://127.0.0.1:9333/json/version
```

Port 9222 is often occupied by Electron — prefer **9333**.

**Get CDP port programmatically:**

```bash
agent-browser get cdp-url   # → ws://127.0.0.1:9333/devtools/browser/...
```

**Diagnostics:** `bash ${SKILL_PATH}/scripts/check-deps.sh` → JSON with agent-browser, Node, CDP, proxy status.

---

## Layer 1: Login Watch + CAPTCHA Watch + Site Patterns

### Site Patterns — Read Before, Write After

Accumulated experience about specific domains. Grows as agents encounter and solve problems.

**Before navigating** to an external domain:

```bash
PATTERN_FILE="${SKILL_PATH}/references/site-patterns/${DOMAIN}.md"
```

- **File exists** → Read it. Treat as hints (may be outdated), not guarantees.
  - `requires_cdp: true` and not connected to real Chrome → **STOP**, `connect` first.
- **File doesn't exist** → Proceed. You may create one later.

**After successful operations**, write back what you learned:

```markdown
---
domain: example.com
aliases: [示例, Example]
requires_cdp: true
updated: 2026-04-05
---

## Platform Characteristics
Architecture, anti-bot, login needs, content loading.

## Effective Patterns
Verified URLs, selectors, strategies. Tag each with date.

## Known Traps
What fails and why. Tag each with date.
```

Rules:
- Only write verified facts, not guesses
- Tag findings with dates — patterns decay
- If a pattern stops working, update the file

**List available patterns:**

```bash
ls ${SKILL_PATH}/references/site-patterns/*.md | grep -v _template
```

### Login Watch — Auto-Detect and Wait

Don't pre-assume login is needed. **Try to access content first.** Only if the page shows a login wall:

1. Tell the user: "Please log in to [site] in your Chrome."
2. Start login-watch in the background:

```bash
bash ${SKILL_PATH}/scripts/login-watch.sh --interval 5 --timeout 300
```

**MUST run in background with long timeout** — user may take minutes to log in.

3. When it returns `logged_in: true`, navigate to the target URL and continue.

**Exit codes:**

| Exit | Meaning | Action |
|------|---------|--------|
| `0` | Login detected | Navigate to target and continue |
| `1` | Timeout | Tell user login-watch timed out, ask them to confirm when done |
| `2` | Error | agent-browser not connected, fix connection |

**Output:** `{ "logged_in": bool, "url": string, "elapsed": number, "hint": string }`

**Login detection keywords:** "Sign in", "Log in", "Create account", "Enter your password", etc. If a site uses unusual login wall text, the detection may miss it — fall back to asking the user.

### CAPTCHA Watch — Check After Navigating

Run **only when** you suspect a block (blank page, challenge page, Cloudflare interstitial):

```bash
bash ${SKILL_PATH}/scripts/captcha-watch.sh --cdp <PORT>
```

Use the port Chrome is running on. Get it from `agent-browser get cdp-url` if unsure.

| Exit | Meaning | Action |
|------|---------|--------|
| `0` | No CAPTCHA | Continue |
| `1` | Solvable CAPTCHA (real Chrome) | Screenshot → notify user → poll (background, same pattern as login-watch) |
| `2` | Automation block (unsolvable) | **STOP.** Must use real Chrome. Never retry in session mode. |
| `3` | Error | Retry once |

**Solvable CAPTCHA polling:**

```bash
agent-browser screenshot captcha.png
echo "CAPTCHA detected. Please solve it in Chrome."
# Run in background — same pattern as login-watch
for i in $(seq 1 24); do
  sleep 5
  RESULT=$(bash ${SKILL_PATH}/scripts/captcha-watch.sh --cdp <PORT>)
  if echo "$RESULT" | jq -e '.captcha == false' >/dev/null 2>&1; then
    break
  fi
done
```

---

## Layer 2: CDP Proxy (Parallel Multi-Tab)

HTTP API to manage multiple tabs in the user's real Chrome. The **only way** to do parallel multi-tab while sharing login state and clean fingerprint.

**Why not `agent-browser --session`?** Sessions spawn Playwright instances — `navigator.webdriver=true`, blocked by anti-bot, no shared login.

### Preflight

```bash
bash ${SKILL_PATH}/scripts/check-deps.sh [CDP_PORT]
```

Output: `{ ready, mode, agent_browser, node, chrome_cdp, proxy, hint }`.

| `ready` | `mode` | Action |
|---------|--------|--------|
| `true` | `cdp` | Proceed |
| `true` | `session` | Layer 2 unavailable. Fall back to Layer 0. |
| `false` | — | **STOP.** Fix per `hint`. |

### Start Proxy

```bash
# Reuse if already running
curl -sf http://127.0.0.1:3456/health >/dev/null 2>&1 || \
  node ${SKILL_PATH}/scripts/cdp-proxy.mjs &
PROXY="http://127.0.0.1:3456"
```

### Batch Operations

```bash
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

### Parallel Sub-Agents

```
Main Agent
├── Start CDP proxy (once)
├── Sub-Agent A: /new → targetId-A → /eval → /close
├── Sub-Agent B: /new → targetId-B → /eval → /close
└── Sub-Agent C: /new → targetId-C → /eval → /close
    All share same Chrome, login state, cookies
```

### CAPTCHA Watch for Proxy Tabs

```bash
bash ${SKILL_PATH}/scripts/captcha-watch.sh --proxy-eval <targetId>
```

### Cleanup

**Tab discipline applies.** Only close tabs you opened. Never close user's tabs. Don't kill the proxy if other agents may be using it.

```bash
curl -s -X POST "$PROXY/batch-close" \
  -H 'Content-Type: application/json' \
  -d "{\"targets\":$TARGETS}"
```

Full API: `references/api.md`.

---

## Scripts Reference

| Script | Purpose | Layer | Run in background? |
|--------|---------|-------|-------------------|
| `check-deps.sh [PORT]` | Environment diagnostics | 0+ | No |
| `login-watch.sh --interval N --timeout N` | Poll until login wall disappears | 1 | **Yes** |
| `captcha-watch.sh --cdp PORT` | Detect CAPTCHA/automation block | 1 | Polling loop: yes |
| `captcha-watch.sh --proxy-eval ID` | Same, for proxy tabs | 2 | Polling loop: yes |
| `cdp-proxy.mjs` | HTTP API for parallel tabs | 2 | **Yes** (daemon) |

---

## Degradation

| Missing | Impact |
|---------|--------|
| Chrome CDP | Layer 0b/1/2 unavailable. 0a still works. |
| CDP proxy | Layer 2 unavailable. 0/1 still work. |
| agent-browser | **Fatal.** |
| Node.js 22+ | Layer 2 unavailable. 0/1 still work. |
| Site pattern file | Proceed without experience. Risk: unexpected blocks. |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `connect` fails | Chrome not running with debug port. See setup in Layer 0. |
| CAPTCHA unsolvable (exit 2) | `navigator.webdriver=true`. Switch to real Chrome. |
| `webdriver=true` in CDP | Connected to Playwright/Electron. Use real Chrome. |
| Proxy port 3456 in use | `CDP_PROXY_PORT=3457 node cdp-proxy.mjs &` |
| `/new` hangs | Slow page. `?timeout=30000`. |
| Tabs accumulate | `/batch-close`. Check `/list`. |
| login-watch misses login wall | Site uses unusual text. Fall back to asking user. |

## References (read on demand)

| Document | When |
|----------|------|
| `references/api.md` | Layer 2: proxy endpoints, batch examples |
| `references/site-patterns/*.md` | Layer 1: before navigating to known domains |
