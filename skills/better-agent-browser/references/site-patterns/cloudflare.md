---
domain: cloudflare.com
aliases: [Cloudflare, Turnstile, cf-turnstile]
requires_cdp: true
updated: 2026-03-29
---

## Platform Characteristics

- Cloudflare Turnstile is a challenge system, not a specific site
- Playwright browsers (`navigator.webdriver=true`) are ALWAYS blocked — even manual solving fails because the browser fingerprint is rejected
- Real Chrome with clean fingerprint: initial challenge auto-resolves in 3-5 seconds

## Effective Patterns

- After navigation in CDP mode, wait 5 seconds before checking snapshot (2026-03-29)
- Once resolved, page redirects automatically (2026-03-29)
- Repeated visits from same IP may reduce challenge frequency (2026-03-29)

**Detection keywords in snapshot:** "Verify you are human", "Just a moment", "cf-turnstile"

## Known Traps

- Do NOT click the Turnstile checkbox programmatically — triggers harder challenge (2026-03-29)
- If "Just a moment" still present after 5s, CAPTCHA is interactive — screenshot + notify user (2026-03-29)
- Session mode (`--session`): ALWAYS blocked, no workaround. Must use real Chrome (2026-03-29)
