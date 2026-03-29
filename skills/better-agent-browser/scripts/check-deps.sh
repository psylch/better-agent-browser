#!/usr/bin/env bash
# check-deps.sh — Verify prerequisites for better-agent-browser
# Exit codes: 0 = ready, 1 = needs setup, 2 = fatal (missing hard deps)
# Output: JSON with live validation results
#
# Usage: check-deps.sh [CDP_PORT]

set -euo pipefail

CDP_PORT="${1:-9333}"
PROXY_PORT="${CDP_PROXY_PORT:-3456}"

# --- Hard dependency checks ---

check_agent_browser() {
  command -v agent-browser &>/dev/null
}

check_node() {
  local ver
  ver=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
  [[ -n "$ver" ]] && [[ "$ver" -ge 22 ]]
}

# --- Soft dependency checks (with live validation) ---

check_chrome_cdp() {
  curl -sf "http://127.0.0.1:${CDP_PORT}/json/version" &>/dev/null
}

# Live validation: actually send a CDP command, not just check port
check_chrome_cdp_live() {
  local version
  version=$(curl -sf "http://127.0.0.1:${CDP_PORT}/json/version" 2>/dev/null) || return 1
  # Verify it's real Chrome (not Electron or other CDP endpoint)
  echo "$version" | grep -q '"Browser"' 2>/dev/null
}

check_proxy() {
  curl -sf "http://127.0.0.1:${PROXY_PORT}/health" &>/dev/null
}

# --- Run checks ---

AB=$(check_agent_browser && echo true || echo false)
ND=$(check_node && echo true || echo false)
CDP=$(check_chrome_cdp_live && echo true || echo false)
PXY=$(check_proxy && echo true || echo false)

# --- Determine mode ---
# CDP available → cdp mode, otherwise → session mode (degraded)
if $CDP; then
  MODE="cdp"
else
  MODE="session"
fi

# --- Build result ---

READY=true
EXIT_CODE=0
HINTS=()

# Hard deps (fatal if missing)
if ! $AB; then
  READY=false; EXIT_CODE=2
  HINTS+=("Install agent-browser: npm i -g agent-browser && agent-browser install")
fi
if ! $ND; then
  READY=false; EXIT_CODE=2
  HINTS+=("Need Node.js 22+: brew install node@22 (macOS) or nvm install 22 (any)")
fi

# Soft deps (degraded if missing)
if ! $CDP; then
  HINTS+=("Chrome CDP not on port $CDP_PORT. Degraded to session mode (no parallel tabs, no anti-bot sites). Fix: start Chrome with --remote-debugging-port=$CDP_PORT")
fi
if ! $PXY; then
  HINTS+=("CDP proxy not running. Start: node \${SKILL_PATH}/scripts/cdp-proxy.mjs &")
fi

# If hard deps OK but soft deps missing, still ready but degraded
if $READY && ! $CDP; then
  EXIT_CODE=0  # usable in session mode
fi

HINT=$(IFS='; '; echo "${HINTS[*]:-all good}")

cat <<EOF
{"ready":$READY,"mode":"$MODE","agent_browser":$AB,"node":$ND,"chrome_cdp":$CDP,"proxy":$PXY,"hint":"$HINT"}
EOF

exit $EXIT_CODE
