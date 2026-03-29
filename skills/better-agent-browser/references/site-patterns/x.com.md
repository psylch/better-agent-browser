# x.com (Twitter/X)

## Scroll Container

- `window.scrollTo()` does NOT work for feed scrolling
- Main feed scroll container: `main[role="main"]` or the first scrollable child of `[data-testid="primaryColumn"]`
- Use: `document.querySelector('[data-testid="primaryColumn"]').scrollBy(0, 1000)`

## Anti-Bot

- Aggressive rate limiting on unauthenticated requests
- Login wall appears after ~2-3 pages of browsing without login
- Cloudflare Turnstile on login page
- **Requires CDP mode**: YES for any authenticated operations

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
