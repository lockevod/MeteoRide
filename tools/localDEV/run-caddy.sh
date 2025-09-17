#!/usr/bin/env bash
# Run Caddy locally for MeteoRide development using tools/localDEV/Caddyfile.local
# This script will try to stop any existing Caddy processes launched with that config
# and then start Caddy in the foreground so logs appear on stdout.

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
CADDYFILE="$HERE/Caddyfile.local"

if [ ! -f "$CADDYFILE" ]; then
  echo "Caddyfile not found: $CADDYFILE" >&2
  exit 2
fi

echo "Using Caddyfile: $CADDYFILE"

# Find caddy processes that were started with a Caddyfile path containing 'Caddyfile.local' and kill them
PIDS=$(pgrep -f "caddy run --config .*Caddyfile.local" || true)
if [ -n "$PIDS" ]; then
  echo "Stopping existing local caddy processes: $PIDS"
  kill $PIDS || true
  sleep 0.3
fi

echo "Starting caddy in foreground (logs will appear here). Press Ctrl-C to stop."
cd "$HERE"
# Run caddy in foreground; it will print stdout/stderr logs
exec caddy run --config "$CADDYFILE"
