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

Start the local Agent Harness Lab services. With no service specified, the web
app, Lab server, and Temporal worker are started after checking the external
Temporal server.

Available services:
  all                  Start web, Lab server, and Temporal worker
  frontend, web        Start the React/Vite frontend only
  server, api          Start the Fastify server only (api is an alias)
  worker               Start the Temporal worker only
  restate-server       Start the native Restate server (no Docker)
  restate              Start the Restate baseline service
  dbos                 Start the DBOS baseline service (PostgreSQL must be available)
  inngest              Start the Inngest function service
  inngest-dev          Start the Inngest Dev Server directly with npx
  trigger-dev          Start the Trigger.dev local task worker
  langgraph            Start the LangGraph Python service
  aws-step-functions   Start the AWS Step Functions platform service
  hatchet              Start the Hatchet platform worker (embedded by default)
  vercel-workflows     Start the Vercel Workflows platform service
  check-temporal       Check the configured Temporal endpoint

Environment variables:
  AGENTLAB_WEB_HOST, AGENTLAB_WEB_PORT
  AGENTLAB_API_HOST, AGENTLAB_API_PORT
  AGENTLAB_RUN_ROOT
  AGENTLAB_TEMPORAL_ENDPOINT, AGENTLAB_TEMPORAL_NAMESPACE
  AGENTLAB_TEMPORAL_TASK_QUEUE, AGENTLAB_TEMPORAL_CLI
  AGENTLAB_RESTATE_DATA_DIR
  AGENTLAB_INNGEST_DEV_SERVER_URL, AGENTLAB_INNGEST_SERVICE_URL
  AGENTLAB_DBOS_*
  AGENTLAB_LANGGRAPH_*
  AGENTLAB_AWS_STEP_FUNCTIONS_*
  AGENTLAB_HATCHET_*, HATCHET_CLIENT_TOKEN
  AGENTLAB_VERCEL_WORKFLOWS_*

Examples:
  $0
  $0 server
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

run_server() {
  require_command npm
  require_package "$SERVER_DIR"

  echo "Starting Agent Harness Lab server at http://${API_HOST}:${API_PORT}"
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

run_restate_server() {
  require_command npm
  require_package "$SERVER_DIR/src/platforms/restate"

  echo "Starting native Restate server (no Docker)."
  exec npm --prefix "$SERVER_DIR/src/platforms/restate" run dev:server
}

run_restate() {
  require_command npm
  require_package "$SERVER_DIR"
  require_package "$SERVER_DIR/src/platforms/restate"

  echo "Starting Restate baseline service."
  exec npm --prefix "$SERVER_DIR" run dev:restate
}

run_dbos() {
  require_command npm
  require_package "$SERVER_DIR"
  require_package "$SERVER_DIR/src/platforms/dbos"

  echo "Starting DBOS baseline service. PostgreSQL must already be available."
  exec npm --prefix "$SERVER_DIR" run dev:dbos
}

run_inngest() {
  require_command npm
  require_package "$SERVER_DIR"
  require_package "$SERVER_DIR/src/platforms/inngest"

  echo "Starting Inngest function service."
  exec npm --prefix "$SERVER_DIR" run dev:inngest
}

run_inngest_dev() {
  require_command npx

  local service_url="${AGENTLAB_INNGEST_SERVICE_URL:-http://${API_HOST}:9091}"
  echo "Starting Inngest Dev Server for $service_url/api/inngest."
  exec npx --yes inngest-cli@1.44.0 dev --no-discovery -u "$service_url/api/inngest"
}

run_trigger_dev() {
  require_command npm
  require_package "$SERVER_DIR/src/platforms/trigger-dev"

  echo "Starting Trigger.dev local task worker."
  exec npm --prefix "$SERVER_DIR" run dev:trigger
}

run_langgraph() {
  local python_command="${AGENTLAB_LANGGRAPH_PYTHON:-python3}"
  require_command "$python_command"

  local platform_directory="$SERVER_DIR/src/platforms/langgraph"
  if [[ ! -d "$platform_directory" ]]; then
    echo "LangGraph platform directory not found: $platform_directory" >&2
    exit 1
  fi
  if ! "$python_command" -c 'import sqlite3' >/dev/null 2>&1; then
    echo "LangGraph requires a Python build with the sqlite3 module." >&2
    echo "Set AGENTLAB_LANGGRAPH_PYTHON to a compatible Python 3.11+ interpreter." >&2
    exit 1
  fi

  echo "Starting LangGraph Python service."
  cd "$platform_directory"
  PYTHONPATH="$platform_directory" \
    "$python_command" -m uvicorn service.app:app \
      --host "${AGENTLAB_LANGGRAPH_HOST:-127.0.0.1}" \
      --port "${AGENTLAB_LANGGRAPH_PORT:-2024}"
}

run_aws_step_functions() {
  require_command npm
  require_package "$SERVER_DIR"
  require_package "$SERVER_DIR/src/platforms/aws-step-functions"

  echo "Starting AWS Step Functions platform service."
  exec npm --prefix "$SERVER_DIR" run dev:aws-step-functions
}

run_hatchet() {
  require_command npm
  require_package "$SERVER_DIR"
  require_package "$SERVER_DIR/src/platforms/hatchet"

  echo "Starting Hatchet platform worker (embedded runtime by default)."
  exec npm --prefix "$SERVER_DIR" run dev:hatchet
}

run_vercel_workflows() {
  require_command npm
  require_package "$SERVER_DIR"
  require_package "$SERVER_DIR/src/platforms/vercel-workflows"

  echo "Starting Vercel Workflows platform service."
  exec npm --prefix "$SERVER_DIR" run dev:vercel-workflows
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
    npm --prefix "$SERVER_DIR" run dev >"$log_directory/server.log" 2>&1 &
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
  echo "  Server: http://${API_HOST}:${API_PORT}"
  echo "  Logs:   $log_directory/{web,server,worker}.log"
  echo "Press Ctrl-C to stop the Lab processes. Temporal remains separately managed."

  wait_for_http "Lab server" "http://${API_HOST}:${API_PORT}/ready"
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
    run_server
    ;;
  worker)
    run_worker
    ;;
  restate-server)
    run_restate_server
    ;;
  restate)
    run_restate
    ;;
  dbos)
    run_dbos
    ;;
  inngest)
    run_inngest
    ;;
  inngest-dev)
    run_inngest_dev
    ;;
  trigger-dev|trigger)
    run_trigger_dev
    ;;
  langgraph)
    run_langgraph
    ;;
  aws-step-functions|aws)
    run_aws_step_functions
    ;;
  hatchet)
    run_hatchet
    ;;
  vercel-workflows|vercel)
    run_vercel_workflows
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
