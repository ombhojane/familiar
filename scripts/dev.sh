#!/usr/bin/env bash
# Start everything Familiar needs, in dependency order, and keep it running.
#   ./scripts/dev.sh          start all
#   ./scripts/dev.sh stop     stop all
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"; LOGS="$ROOT/.logs"; mkdir -p "$LOGS"

PIDFILE="$ROOT/.logs/pids"

# Track our own children. Global `pkill -f vite` would kill unrelated dev servers and
# Electron apps that happen to be running on this machine.
record() { echo "$1" >> "$PIDFILE"; }

stop_all() {
  echo "stopping…"
  if [ -f "$PIDFILE" ]; then
    while read -r pid; do
      [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
    done < "$PIDFILE"
    rm -f "$PIDFILE"
  fi
  echo "stopped."
}
[ "${1:-}" = "stop" ] && { stop_all; exit 0; }

wait_for() { # url, name, seconds
  local i=0
  until curl -s --max-time 2 "$1" >/dev/null 2>&1; do
    i=$((i+1)); [ $i -gt "${3:-60}" ] && { echo "  ✗ $2 did not come up — see $LOGS"; return 1; }
    sleep 1
  done
  echo "  ✓ $2"
}

stop_all >/dev/null 2>&1 || true; sleep 1
: > "$PIDFILE"

echo "starting Familiar…"
( cd "$ROOT" && nohup npx -y @truefoundry/trueforge@latest > "$LOGS/trueforge.log" 2>&1 & echo $! >> "$PIDFILE" )
wait_for http://localhost:8790/api/v1/capabilities "trueforge      :8790" 120

( cd "$ROOT/server" && nohup npx tsx src/index.ts > "$LOGS/server.log" 2>&1 & echo $! >> "$PIDFILE" )
wait_for http://localhost:3333/health "familiar-mcp   :3333" 60

( cd "$ROOT/web" && nohup npx vite > "$LOGS/web.log" 2>&1 & echo $! >> "$PIDFILE" )
wait_for http://localhost:5173 "dashboard      :5173" 60

# One-time registration is idempotent; safe to run every boot.
bash "$ROOT/scripts/register.sh" >> "$LOGS/register.log" 2>&1 || echo "  ! registration had warnings — see $LOGS/register.log"
echo "  ✓ agent + connectors registered"

( cd "$ROOT/hold" && nohup npx electron . > "$LOGS/hold.log" 2>&1 & echo $! >> "$PIDFILE" )
sleep 3; echo "  ✓ HOLD (menu bar, ⌃⌥⌘H)"
echo
echo "Familiar is up.  Dashboard: http://localhost:5173   Logs: .logs/"
