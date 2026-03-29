# CDP Proxy API Reference

## Endpoints

| Endpoint | Method | Params | Returns |
|----------|--------|--------|---------|
| `/health` | GET | — | `{ ok, proxy_port, sessions, pending }` |
| `/list` | GET | — | `[{ targetId, title, url }]` |
| `/new?url=URL` | GET | `url`, `timeout` | `{ targetId, title, url }` |
| `/close?target=ID` | GET | `target` | `{ ok }` |
| `/navigate?target=ID&url=URL` | GET | `target`, `url`, `timeout` | `{ ok, title, url }` |
| `/eval` | POST | `{ target, expression }` | `{ result }` |
| `/screenshot?target=ID` | GET | `target`, `format=base64` | PNG image or `{ data }` |
| `/info?target=ID` | GET | `target` | `{ title, url, readyState }` |
| `/batch` | POST | `{ urls: [...] }` | `[{ targetId, title, url }]` |
| `/batch-eval` | POST | `{ targets: [...], expression }` | `[{ targetId, result }]` |
| `/batch-close` | POST | `{ targets: [...] }` | `{ ok, closed }` |

## Start / Stop

```bash
# Start (auto-discover Chrome)
node ${SKILL_PATH}/scripts/cdp-proxy.mjs &

# Start (explicit ports)
node ${SKILL_PATH}/scripts/cdp-proxy.mjs --cdp-port 9333 --port 3456 &

# Startup signal (stdout JSON): { "ok": true, "proxy_port": 3456, "cdp_port": 9333 }

# Stop
kill %1  # or: pkill -f cdp-proxy.mjs
```

## Examples

### Single tab

```bash
PROXY="http://127.0.0.1:3456"

# Open
TARGET=$(curl -s "$PROXY/new?url=https://example.com" | jq -r '.targetId')

# Eval
curl -s -X POST "$PROXY/eval" \
  -H 'Content-Type: application/json' \
  -d "{\"target\":\"$TARGET\",\"expression\":\"document.title\"}"

# Screenshot
curl -s "$PROXY/screenshot?target=$TARGET" > page.png

# Close
curl -s "$PROXY/close?target=$TARGET"
```

### Batch operations

```bash
# Open multiple
TABS=$(curl -s -X POST "$PROXY/batch" \
  -H 'Content-Type: application/json' \
  -d '{"urls":["https://a.com","https://b.com","https://c.com"]}')

# Extract targets
TARGETS=$(echo "$TABS" | jq '[.[].targetId]')

# Eval on all
curl -s -X POST "$PROXY/batch-eval" \
  -H 'Content-Type: application/json' \
  -d "{\"targets\":$TARGETS,\"expression\":\"document.title\"}"

# Close all
curl -s -X POST "$PROXY/batch-close" \
  -H 'Content-Type: application/json' \
  -d "{\"targets\":$TARGETS}"
```

### Mixing with agent-browser

```bash
# Batch: open tabs via proxy
curl -s -X POST "$PROXY/batch" -d '{"urls":[...]}'

# Interactive: use agent-browser for ref-based interaction on same Chrome
agent-browser --cdp 9333 snapshot -i -c
agent-browser --cdp 9333 click @e3
agent-browser --cdp 9333 fill @e5 "text"
```

Both connect to the same Chrome — shared login state, no conflicts.
