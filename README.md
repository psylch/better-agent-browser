# better-agent-browser

[中文文档](README.zh.md)

Enhanced browser automation that extends [agent-browser](https://github.com/vercel-labs/agent-browser) CLI with parallel multi-tab operations, CAPTCHA/automation-block detection, and per-domain site experience accumulation.

| Feature | What It Does | How |
|---------|-------------|-----|
| **Parallel Tabs** | Open and operate 100+ tabs simultaneously | Lightweight CDP proxy multiplexing over single WebSocket |
| **CAPTCHA Watch** | Detect CAPTCHAs and automation blocks | Snapshot pattern matching + `navigator.webdriver` check |
| **Site Experience** | Accumulate per-domain browsing knowledge | Markdown files with selectors, scroll quirks, anti-bot info |

## Installation

### Via skills.sh (recommended)

```bash
npx skills add psylch/better-agent-browser -g -y
```

### Via Plugin Marketplace

```
/plugin marketplace add psylch/better-agent-browser
/plugin install better-agent-browser@psylch-better-agent-browser
```

### Manual Install

```bash
git clone https://github.com/psylch/better-agent-browser.git
# Copy skills/better-agent-browser to your skills directory
```

Restart Claude Code after installation.

## Prerequisites

- [agent-browser](https://github.com/vercel-labs/agent-browser) CLI installed globally
- Node.js 22+ (native WebSocket for CDP proxy)
- Chrome with `--remote-debugging-port` for CDP mode (recommended for anti-bot sites)

## Usage

### Parallel Tabs

```bash
# Start CDP proxy
node scripts/cdp-proxy.mjs &

# Batch open URLs
curl -s -X POST http://127.0.0.1:3456/batch \
  -H 'Content-Type: application/json' \
  -d '{"urls":["https://site1.com","https://site2.com","https://site3.com"]}'

# Extract content from all tabs
curl -s -X POST http://127.0.0.1:3456/batch-eval \
  -H 'Content-Type: application/json' \
  -d '{"targets":["id1","id2","id3"],"expression":"document.title"}'
```

### CAPTCHA Detection

```bash
# After navigation, check for CAPTCHA
bash scripts/captcha-watch.sh --cdp 9333
# Exit 0: clear | Exit 1: solvable CAPTCHA | Exit 2: automation block (switch to CDP)
```

### Site Experience

Per-domain pattern files in `references/site-patterns/` guide the agent on domain-specific quirks (scroll containers, stable selectors, anti-bot requirements).

## Architecture

```
agent-browser CLI ←── Interactive ops (ref-based clicks, forms)
       ↕ same Chrome instance
CDP Proxy (cdp-proxy.mjs) ←── Batch/parallel ops (open, eval, screenshot)
       ↓
Chrome (--remote-debugging-port)
```

Both tools connect to the same Chrome — shared login state, no conflicts.

## File Structure

```
better-agent-browser/
├── skills/better-agent-browser/
│   ├── SKILL.md                    # Core skill definition
│   ├── scripts/
│   │   ├── cdp-proxy.mjs          # CDP proxy for parallel tabs
│   │   ├── captcha-watch.sh       # CAPTCHA/automation block detection
│   │   └── check-deps.sh          # Prerequisites check
│   └── references/site-patterns/
│       ├── _template.md            # Template for new patterns
│       ├── cloudflare.md           # Cloudflare Turnstile patterns
│       └── x.com.md               # X/Twitter patterns
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── README.md
├── README.zh.md
└── LICENSE
```

## Key Design Decisions

- **CDP proxy is ~250 lines** — minimal, no dependencies beyond Node.js 22 native WebSocket
- **CAPTCHA watch distinguishes solvable vs unsolvable** — Playwright browsers (`navigator.webdriver=true`) can never pass Cloudflare, even manually
- **Site patterns are agent-maintained** — patterns improve over time as the agent encounters new quirks

## License

MIT
