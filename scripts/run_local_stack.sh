#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
SERVER_DIR="$ROOT_DIR/server"
RUN_ROOT="${AGENTLAB_RUN_ROOT:-$ROOT_DIR/lab/runs}"

WEB_HOST="${AGENTLAB_WEB_HOST:-127.0.0.1}"
WEB_PORT="${AGENTLAB_WEB_PORT:-5173}"
API_HOST="${AGENTLAB_API_HOST:-127.0.0.1}"
API_PORT="${AGENTLAB_API_PORT:-4318}"
TEMPORAL_ENDPOINT="${AGENTLAB_TEMPORAL_ENDPOINT:-localhost:7233}"
TEMPORAL_NAMESPACE="${AGENTLAB_TEMPORAL_NAMESPACE:-default}"
TEMPORAL_TASK_QUEUE="${AGENTLAB_TEMPORAL_TASK_QUEUE:-agentlab-temporal-baseline}"
TEMPORAL_CLI="${AGENTLAB_TEMPORAL_CLI:-temporal}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

require_package() {
  local directory="$1"
  if [[ ! -f "$directory/package.json" ]]; then
    echo "Package file not found: $directory/package.json" >&2
    exit 1
  fi
  if [[ ! -d "$directory/node_modules" ]]; then
    echo "Dependencies are not installed for $directory." >&2
    echo "Run npm install in ${directory#"$ROOT_DIR/"}." >&2
    exit 1
  fi
}

check_temporal() {
  require_command "$TEMPORAL_CLI"

  if ! "$TEMPORAL_CLI" workflow list \
    --address "$TEMPORAL_ENDPOINT" \
    --namespace "$TEMPORAL_NAMESPACE" \
    --limit 1 >/dev/null 2>&1; then
    echo "Temporal is not reachable at $TEMPORAL_ENDPOINT." >&2
    echo "Start it in another terminal: $TEMPORAL_CLI server start-dev" >&2
    echo "For restart exercises, use: $TEMPORAL_CLI server start-dev --db-filename /tmp/agentlab-temporal-baseline.db" >&2
    exit 1
  fi
}

wait_for_http() {
  local name="$1"
  local url="$2"
  for _ in {1..60}; do
    if curl --silent --show-error --fail "$url" >/dev/null 2>&1; then
      echo "$name is ready at $url"
      return 0
    fi
    sleep 1
  done
  echo "$name did not become ready at $url." >&2
  return 1
}

wait_for_worker() {
  local log_file="$1"
  for _ in {1..60}; do
    if grep -q "state: 'RUNNING'\|state: \"RUNNING\"" "$log_file" 2>/dev/null; then
      echo "Temporal worker is ready on $TEMPORAL_TASK_QUEUE"
      return 0
    fi
    sleep 1
  done
  echo "Temporal worker did not become ready. Check $log_file." >&2
  return 1
}

show_usage() {
  cat <<EOF
Usage: $0 [service]

Start the local Agent Harness Lab services. With no service specified, all
three Lab processes are started after checking the external Temporal server.

Available services:
  all                  Start web, control API, and Temporal worker
  frontend, web        Start the React/Vite frontend only
  api, server          Start the Fastify control API only
  worker               Start the Temporal worker only
  check-temporal       Check the configured Temporal endpoint

Environment variables:
  AGENTLAB_WEB_HOST, AGENTLAB_WEB_PORT
  AGENTLAB_API_HOST, AGENTLAB_API_PORT
  AGENTLAB_RUN_ROOT
  AGENTLAB_TEMPORAL_ENDPOINT, AGENTLAB_TEMPORAL_NAMESPACE
  AGENTLAB_TEMPORAL_TASK_QUEUE, AGENTLAB_TEMPORAL_CLI

Examples:
  $0
  $0 api
  AGENTLAB_WEB_PORT=5174 $0 all
EOF
}

run_frontend() {
  require_command npm
  require_package "$WEB_DIR"

  if [[ ! -x "$WEB_DIR/node_modules/.bin/vite" ]]; then
    echo "Frontend dependencies are incomplete or out of date." >&2
    echo "Run: npm --prefix apps/web install" >&2
    exit 1
  fi

  echo "Starting Agent Harness Lab frontend at http://${WEB_HOST}:${WEB_PORT}"
  exec npm --prefix "$WEB_DIR" run dev -- --host "$WEB_HOST" --port "$WEB_PORT"
}

run_api() {
  require_command npm
  require_package "$SERVER_DIR"

  echo "Starting Agent Harness Lab API at http://${API_HOST}:${API_PORT}"
  AGENTLAB_API_HOST="$API_HOST" \
    AGENTLAB_API_PORT="$API_PORT" \
    AGENTLAB_RUN_ROOT="$RUN_ROOT" \
    AGENTLAB_TEMPORAL_ENDPOINT="$TEMPORAL_ENDPOINT" \
    AGENTLAB_TEMPORAL_NAMESPACE="$TEMPORAL_NAMESPACE" \
    AGENTLAB_TEMPORAL_TASK_QUEUE="$TEMPORAL_TASK_QUEUE" \
    exec npm --prefix "$SERVER_DIR" run dev
}

run_worker() {
  require_command npm
  require_package "$SERVER_DIR"
  check_temporal

  echo "Starting Temporal worker on task queue $TEMPORAL_TASK_QUEUE"
  AGENTLAB_RUN_ROOT="$RUN_ROOT" \
    AGENTLAB_TEMPORAL_ENDPOINT="$TEMPORAL_ENDPOINT" \
    AGENTLAB_TEMPORAL_NAMESPACE="$TEMPORAL_NAMESPACE" \
    AGENTLAB_TEMPORAL_TASK_QUEUE="$TEMPORAL_TASK_QUEUE" \
    exec npm --prefix "$SERVER_DIR" run dev:worker
}

start_all() {
  require_command npm
  require_command curl
  require_package "$WEB_DIR"
  require_package "$SERVER_DIR"
  check_temporal

  local log_directory
  log_directory="$(mktemp -d "${TMPDIR:-/tmp}/agentlab-stack.XXXXXX")"
  local -a pids=()

  cleanup() {
    trap - EXIT INT TERM
    for pid in "${pids[@]}"; do
      kill "$pid" 2>/dev/null || true
    done
    for pid in "${pids[@]}"; do
      wait "$pid" 2>/dev/null || true
    done
    echo "Local stack stopped. Logs retained at $log_directory"
  }
  trap cleanup EXIT INT TERM

  AGENTLAB_API_HOST="$API_HOST" \
    AGENTLAB_API_PORT="$API_PORT" \
    AGENTLAB_RUN_ROOT="$RUN_ROOT" \
    AGENTLAB_TEMPORAL_ENDPOINT="$TEMPORAL_ENDPOINT" \
    AGENTLAB_TEMPORAL_NAMESPACE="$TEMPORAL_NAMESPACE" \
    AGENTLAB_TEMPORAL_TASK_QUEUE="$TEMPORAL_TASK_QUEUE" \
    npm --prefix "$SERVER_DIR" run dev >"$log_directory/api.log" 2>&1 &
  pids+=("$!")

  AGENTLAB_RUN_ROOT="$RUN_ROOT" \
    AGENTLAB_TEMPORAL_ENDPOINT="$TEMPORAL_ENDPOINT" \
    AGENTLAB_TEMPORAL_NAMESPACE="$TEMPORAL_NAMESPACE" \
    AGENTLAB_TEMPORAL_TASK_QUEUE="$TEMPORAL_TASK_QUEUE" \
    npm --prefix "$SERVER_DIR" run dev:worker >"$log_directory/worker.log" 2>&1 &
  pids+=("$!")

  VITE_AGENTLAB_API_URL="${VITE_AGENTLAB_API_URL:-http://${API_HOST}:${API_PORT}}" \
    npm --prefix "$WEB_DIR" run dev -- --host "$WEB_HOST" --port "$WEB_PORT" >"$log_directory/web.log" 2>&1 &
  pids+=("$!")

  echo "Agent Harness Lab local stack started."
  echo "  Web:    http://${WEB_HOST}:${WEB_PORT}"
  echo "  API:    http://${API_HOST}:${API_PORT}"
  echo "  Logs:   $log_directory/{web,api,worker}.log"
  echo "Press Ctrl-C to stop the Lab processes. Temporal remains separately managed."

  wait_for_http "Control API" "http://${API_HOST}:${API_PORT}/health"
  wait_for_http "Web app" "http://${WEB_HOST}:${WEB_PORT}"
  wait_for_worker "$log_directory/worker.log"

  while :; do
    for pid in "${pids[@]}"; do
      if ! kill -0 "$pid" 2>/dev/null; then
        echo "A local stack process exited. Check $log_directory for details." >&2
        return 1
      fi
    done
    sleep 1
  done
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
  api|server)
    run_api
    ;;
  worker)
    run_worker
    ;;
  check-temporal)
    check_temporal
    echo "Temporal is reachable at $TEMPORAL_ENDPOINT."
    ;;
  *)
    echo "Unknown service: $1" >&2
    echo "Run '$0 --help' to see available services." >&2
    exit 1
    ;;
esac
