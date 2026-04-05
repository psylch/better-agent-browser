#!/usr/bin/env bash
# browser-disconnect.sh — Release lock and close browser
#
# Usage: browser-disconnect.sh [CDP_PORT]
#
# Closes agent-browser session and removes the lock file.
# Only removes lock if we own it (PID matches).

set -euo pipefail

CDP_PORT="${1:-9333}"
LOCKFILE="/tmp/agent-browser-cdp-${CDP_PORT}.lock"

# Close browser
agent-browser close 2>/dev/null || true

# Release lock only if we own it
if [ -f "$LOCKFILE" ]; then
  LOCK_PID=$(cat "$LOCKFILE" 2>/dev/null || echo "0")
  if [ "$LOCK_PID" = "${PPID}" ] || ! kill -0 "$LOCK_PID" 2>/dev/null; then
    rm -f "$LOCKFILE"
  fi
fi

echo "{\"disconnected\":true,\"port\":${CDP_PORT}}"
