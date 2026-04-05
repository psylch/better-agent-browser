---
domain: x.com
aliases: [Twitter, X, twitter.com]
requires_cdp: true
updated: 2026-03-29
---

## Platform Characteristics

- SPA with infinite scroll
- `window.scrollTo()` does NOT work for feed — custom scroll container
- DOM class names are hashed/obfuscated — never rely on class selectors
- Aggressive rate limiting on unauthenticated requests
- Login wall appears after ~2-3 pages without login
- Cloudflare Turnstile on login page

## Effective Patterns

- Scroll container: `document.querySelector('[data-testid="primaryColumn"]').scrollBy(0, 1000)` (2026-03-29)
- Use `data-testid` attributes or snapshot refs exclusively (2026-03-29)

| Element | Selector | Notes |
|---------|----------|-------|
| Tweet text | `[data-testid="tweetText"]` | |
| Username | `[data-testid="User-Name"]` | Contains both display name and @handle |
| Like button | `[data-testid="like"]` | |
| Retweet button | `[data-testid="retweet"]` | |
| Reply button | `[data-testid="reply"]` | |
| Search input | `[data-testid="SearchBox_Search_Input"]` | |
| Grok input | Varies, use snapshot ref | Changes frequently (2026-03-29) |

## Known Traps

- Infinite scroll: old tweets removed from DOM as new ones load (2026-03-29)
- Image lazy loading: screenshots may show placeholders if taken too fast (2026-03-29)
- Grok input selector changes frequently — always use snapshot refs (2026-03-29)
