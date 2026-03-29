#!/usr/bin/env bash
# captcha-watch.sh — Detect CAPTCHA / automation blocks in current page
#
# Usage: captcha-watch.sh [--cdp PORT] [--session NAME] [--proxy-eval TARGET]
# Exit codes:
#   0 = no CAPTCHA
#   1 = CAPTCHA detected (solvable — real Chrome, user can solve)
#   2 = automation block (unsolvable — Playwright browser, must switch to CDP)
#   3 = error
#
# Two modes:
#   agent-browser mode: uses agent-browser snapshot (default)
#   proxy mode:         uses cdp-proxy /eval endpoint (--proxy-eval TARGET)
#
# Output: JSON { "captcha": bool, "type": "...", "solvable": bool, "mode": "...", "hint": "..." }

set -euo pipefail

CDP_FLAG=""
SESSION_FLAG=""
MODE="unknown"
PROXY_TARGET=""
PROXY_PORT="${CDP_PROXY_PORT:-3456}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cdp) CDP_FLAG="--cdp $2"; MODE="cdp"; shift 2 ;;
    --session) SESSION_FLAG="--session $2"; MODE="session"; shift 2 ;;
    --proxy-eval) PROXY_TARGET="$2"; MODE="cdp"; shift 2 ;;
    --proxy-port) PROXY_PORT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# ---------------------------------------------------------------------------
# Get page snapshot
# ---------------------------------------------------------------------------
get_snapshot() {
  if [[ -n "$PROXY_TARGET" ]]; then
    # Use CDP proxy eval to get page text
    curl -sf -X POST "http://127.0.0.1:${PROXY_PORT}/eval" \
      -H 'Content-Type: application/json' \
      -d "{\"target\":\"$PROXY_TARGET\",\"expression\":\"document.body?.innerText || ''\"}" \
      2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',''))" 2>/dev/null || echo ""
  else
    # Use agent-browser snapshot
    local cmd="agent-browser $CDP_FLAG $SESSION_FLAG"
    $cmd snapshot 2>/dev/null || echo ""
  fi
}

# ---------------------------------------------------------------------------
# Check navigator.webdriver flag
# ---------------------------------------------------------------------------
get_webdriver() {
  if [[ -n "$PROXY_TARGET" ]]; then
    curl -sf -X POST "http://127.0.0.1:${PROXY_PORT}/eval" \
      -H 'Content-Type: application/json' \
      -d "{\"target\":\"$PROXY_TARGET\",\"expression\":\"String(navigator.webdriver)\"}" \
      2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('result','unknown'))" 2>/dev/null || echo "unknown"
  else
    local cmd="agent-browser $CDP_FLAG $SESSION_FLAG"
    $cmd eval 'String(navigator.webdriver)' 2>/dev/null || echo "unknown"
  fi
}

# ---------------------------------------------------------------------------
# CAPTCHA type detection
# ---------------------------------------------------------------------------
detect_captcha() {
  local snap="$1"

  # Cloudflare Turnstile / Challenge
  if echo "$snap" | grep -iqE "cf-turnstile|challenges\.cloudflare|Verify you are human|Just a moment\.\."; then
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

  # Generic patterns (low signal, check last)
  if echo "$snap" | grep -iqE "are you a robot|verify you.re human|bot detection"; then
    echo "generic"; return 0
  fi

  echo "none"; return 1
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
SNAPSHOT=$(get_snapshot)

if [[ -z "$SNAPSHOT" ]]; then
  echo '{"captcha":false,"type":"none","solvable":false,"mode":"'"$MODE"'","hint":"snapshot failed — check connection"}'
  exit 3
fi

TYPE=$(detect_captcha "$SNAPSHOT") && FOUND=true || FOUND=false

if ! $FOUND; then
  echo '{"captcha":false,"type":"none","solvable":true,"mode":"'"$MODE"'","hint":"no CAPTCHA detected"}'
  exit 0
fi

# Key decision: is this solvable?
WEBDRIVER=$(get_webdriver)

if [[ "$WEBDRIVER" == "true" ]]; then
  # Automation flags present — CAPTCHA is unsolvable even by a human
  cat <<EOF
{"captcha":true,"type":"$TYPE","solvable":false,"mode":"$MODE","hint":"Automation block ($TYPE). Browser has navigator.webdriver=true — CAPTCHA unsolvable even manually. Must switch to CDP mode with real Chrome (--remote-debugging-port)."}
EOF
  exit 2
else
  # Real Chrome — user can solve manually
  cat <<EOF
{"captcha":true,"type":"$TYPE","solvable":true,"mode":"$MODE","hint":"CAPTCHA detected ($TYPE) in real Chrome. Take screenshot, notify user, wait for manual solve."}
EOF
  exit 1
fi
