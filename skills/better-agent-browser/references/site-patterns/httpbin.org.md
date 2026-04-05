---
domain: httpbin.org
aliases: [httpbin, HTTPBin]
requires_cdp: false
updated: 2026-04-05
---

## Platform Characteristics

- Content loading: static (server-rendered JSON responses)
- Anti-bot: none
- Login required for target content: no
- `window.scrollTo()` works: yes

## Effective Patterns

- `/headers` endpoint returns request headers as JSON — useful for verifying browser fingerprint and `navigator.webdriver` status (2026-04-05)
- Snapshot returns minimal interactive elements (just a "Pretty-print" checkbox); use `eval "document.body.innerText"` to read the JSON response body (2026-04-05)
- Works fine in both session mode and CDP mode — no anti-bot protection (2026-04-05)

## Known Traps

- None observed (2026-04-05)
