#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"

WEB_HOST="${AGENTLAB_WEB_HOST:-127.0.0.1}"
WEB_PORT="${AGENTLAB_WEB_PORT:-5173}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

show_usage() {
  cat <<EOF
Usage: $0 [service]

Start the local Agent Harness Lab services. With no service specified, all
currently available local services are started.

Available services:
  frontend, web    Start the React/Vite frontend

Environment variables:
  AGENTLAB_WEB_HOST  Frontend bind address (default: 127.0.0.1)
  AGENTLAB_WEB_PORT  Frontend port (default: 5173)

Examples:
  $0
  $0 frontend
  AGENTLAB_WEB_PORT=5174 $0
EOF
}

run_frontend() {
  require_command npm

  if [[ ! -f "$WEB_DIR/package.json" ]]; then
    echo "Frontend package file not found: $WEB_DIR/package.json" >&2
    exit 1
  fi

  if [[ ! -d "$WEB_DIR/node_modules" ]]; then
    echo "Frontend dependencies are not installed." >&2
    echo "Run: npm --prefix apps/web install" >&2
    exit 1
  fi

  if [[ ! -d "$WEB_DIR/node_modules/tailwindcss" || ! -x "$WEB_DIR/node_modules/.bin/vite" ]]; then
    echo "Frontend dependencies are incomplete or out of date." >&2
    echo "Run: npm --prefix apps/web install" >&2
    exit 1
  fi

  echo "Starting Agent Harness Lab frontend at http://${WEB_HOST}:${WEB_PORT}"
  exec npm --prefix "$WEB_DIR" run dev -- --host "$WEB_HOST" --port "$WEB_PORT"
}

start_all() {
  # Keep the default path explicit so adding another local service later does
  # not silently change what this launcher starts.
  run_frontend
}

case "${1:-}" in
  ""|all)
    start_all
    ;;
  -h|--help)
    show_usage
    ;;
  frontend|web)
    run_frontend
    ;;
  *)
    echo "Unknown service: $1" >&2
    echo "Run '$0 --help' to see available services." >&2
    exit 1
    ;;
esac
