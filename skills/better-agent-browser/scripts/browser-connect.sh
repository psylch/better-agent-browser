#!/usr/bin/env bash
# browser-connect.sh — Safe connect with lock-based conflict detection
#
# Usage: browser-connect.sh [CDP_PORT]
#
# Checks if another agent is already using Layer 0b (direct connect).
# If so, outputs guidance to use Layer 2 (CDP proxy) instead.
# If not, acquires lock and connects.
#
# Exit codes:
#   0 = Connected successfully (Layer 0b)
#   1 = Another agent is active — use Layer 2 instead
#   2 = Chrome CDP not available
#
# Output: JSON { "connected": bool, "mode": "layer0b"|"layer2", "port": number, "pid": number, "hint": string }

set -euo pipefail

CDP_PORT="${1:-9333}"
LOCKFILE="/tmp/agent-browser-cdp-${CDP_PORT}.lock"

# Check Chrome is reachable
if ! curl -sf "http://127.0.0.1:${CDP_PORT}/json/version" &>/dev/null; then
  echo "{\"connected\":false,\"mode\":\"unavailable\",\"port\":${CDP_PORT},\"pid\":0,\"hint\":\"Chrome CDP not running on port ${CDP_PORT}\"}"
  exit 2
fi

# Check lock
if [ -f "$LOCKFILE" ]; then
  LOCK_PID=$(cat "$LOCKFILE" 2>/dev/null || echo "0")
  # Check if the process that holds the lock is still alive
  if kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "{\"connected\":false,\"mode\":\"layer2\",\"port\":${CDP_PORT},\"pid\":${LOCK_PID},\"hint\":\"Another agent (pid ${LOCK_PID}) is using Layer 0b. Use Layer 2 CDP proxy instead.\"}"
    exit 1
  else
    # Stale lock — previous agent died without cleanup
    rm -f "$LOCKFILE"
  fi
fi

# Acquire lock — use PPID (the agent/claude process that spawned this script)
# This survives across multiple script invocations within the same agent session
echo "${PPID}" > "$LOCKFILE"

# Connect
agent-browser connect "$CDP_PORT" >/dev/null 2>&1

echo "{\"connected\":true,\"mode\":\"layer0b\",\"port\":${CDP_PORT},\"pid\":$$,\"hint\":\"Connected. Lock acquired.\"}"
exit 0
