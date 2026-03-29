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
