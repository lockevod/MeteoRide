#!/usr/bin/env bash
# Start and supervise local dev services for MeteoRide: Caddy + share-server
# - rotates logs if too large
# - starts share-server (background) with logs to repo logs
# - starts Caddy via tools/localDEV/run-caddy.sh
# - tails both logs and cleans up on Ctrl-C

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
LOG_DIR="$REPO_ROOT/logs"
SHARE_SERVER_JS="$HERE/share-server.js"
RUN_CADDY_SH="$HERE/run-caddy.sh"
PID_DIR="$HERE/pids"
mkdir -p "$PID_DIR"

# Rotation threshold in bytes (5 MB)
ROT_THRESH=$((5 * 1024 * 1024))

rotate_log() {
  local f="$1"
  if [ -f "$f" ]; then
    local size
    size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null || echo 0)
    if [ "$size" -ge "$ROT_THRESH" ]; then
      local stamp
      stamp=$(date +%Y%m%d-%H%M%S)
      mv "$f" "$f.$stamp"
      echo "Rotated $f -> $f.$stamp"
      touch "$f"
    fi
  fi
}

echo "Preparing dev run (repo root: $REPO_ROOT)"
mkdir -p "$LOG_DIR"
rotate_log "$LOG_DIR/caddy_access.log"
rotate_log "$LOG_DIR/share-server.log"

start_share_server() {
  echo "Starting share-server..."
  # Start node share-server in background with logs appended
  nohup node "$SHARE_SERVER_JS" >> "$LOG_DIR/share-server.log" 2>&1 &
  local pid=$!
  echo $pid > "$PID_DIR/share-server.pid"
  echo "share-server pid=$pid"
}

start_caddy() {
  if [ ! -x "$RUN_CADDY_SH" ]; then
    chmod +x "$RUN_CADDY_SH" || true
  fi
  echo "Starting Caddy (run-caddy.sh)..."
  # Start run-caddy.sh in background (it will exec caddy)
  "$RUN_CADDY_SH" &
  local pid=$!
  echo $pid > "$PID_DIR/caddy.pid"
  echo "caddy wrapper pid=$pid"
}

stop_all() {
  echo "Shutting down dev services..."
  if [ -f "$PID_DIR/caddy.pid" ]; then
    pid=$(cat "$PID_DIR/caddy.pid")
    echo "Killing caddy wrapper pid=$pid" || true
    kill "$pid" 2>/dev/null || true
    rm -f "$PID_DIR/caddy.pid" || true
  fi
  if [ -f "$PID_DIR/share-server.pid" ]; then
    pid=$(cat "$PID_DIR/share-server.pid")
    echo "Killing share-server pid=$pid" || true
    kill "$pid" 2>/dev/null || true
    rm -f "$PID_DIR/share-server.pid" || true
  fi
}

trap 'echo; stop_all; exit 0' INT TERM

start_share_server
start_caddy

echo "Tailing logs (press Ctrl-C to stop)."
echo "Logs: $LOG_DIR/caddy_access.log  $LOG_DIR/share-server.log"
tail -F "$LOG_DIR/caddy_access.log" "$LOG_DIR/share-server.log"
