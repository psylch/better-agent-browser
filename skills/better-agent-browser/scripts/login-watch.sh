#!/usr/bin/env bash
# login-watch.sh — Poll page until login wall disappears
#
# Usage: login-watch.sh [--interval SECONDS] [--timeout SECONDS]
#
# Exit codes:
#   0 = Login detected (page no longer shows login wall)
#   1 = Timeout waiting for login
#   2 = Error (agent-browser not connected)
#
# Output: JSON { "logged_in": bool, "url": string, "elapsed": number, "hint": string }

set -euo pipefail

INTERVAL="${1:-5}"
TIMEOUT="${2:-120}"

# Parse named args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval) INTERVAL="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Login wall indicators (case-insensitive patterns in snapshot)
LOGIN_PATTERNS=(
  "Sign in"
  "Log in"
  "sign_in"
  "login"
  "Create account"
  "Don't have an account"
  "Enter your password"
  "Phone, email, or username"
)

check_login_wall() {
  local snapshot
  snapshot=$(agent-browser snapshot 2>/dev/null) || return 2

  for pattern in "${LOGIN_PATTERNS[@]}"; do
    if echo "$snapshot" | grep -qi "$pattern"; then
      return 1  # Still showing login wall
    fi
  done
  return 0  # No login wall detected
}

# Verify agent-browser is connected
URL=$(agent-browser get url 2>/dev/null) || {
  echo '{"logged_in":false,"url":"","elapsed":0,"hint":"agent-browser not connected"}'
  exit 2
}

# Initial check — maybe already logged in
if check_login_wall; then
  echo "{\"logged_in\":true,\"url\":\"$URL\",\"elapsed\":0,\"hint\":\"no login wall detected\"}"
  exit 0
fi

# Poll until login completes or timeout
ELAPSED=0
while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))

  URL=$(agent-browser get url 2>/dev/null) || continue

  if check_login_wall; then
    echo "{\"logged_in\":true,\"url\":\"$URL\",\"elapsed\":$ELAPSED,\"hint\":\"login detected after ${ELAPSED}s\"}"
    exit 0
  fi
done

echo "{\"logged_in\":false,\"url\":\"$URL\",\"elapsed\":$ELAPSED,\"hint\":\"timeout after ${TIMEOUT}s\"}"
exit 1
