#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
SERVER_DIR="$ROOT_DIR/server"
RUN_ROOT="${AGENTLAB_RUN_ROOT:-$ROOT_DIR/lab/runs}"
CONTEXT_ROOT="${AGENTLAB_CONTEXT_ROOT:-$ROOT_DIR/lab/sessions}"

WEB_HOST="${AGENTLAB_WEB_HOST:-127.0.0.1}"
WEB_PORT="${AGENTLAB_WEB_PORT:-5173}"
API_HOST="${AGENTLAB_API_HOST:-127.0.0.1}"
API_PORT="${AGENTLAB_API_PORT:-4318}"
TEMPORAL_ENDPOINT="${AGENTLAB_TEMPORAL_ENDPOINT:-localhost:7233}"
TEMPORAL_NAMESPACE="${AGENTLAB_TEMPORAL_NAMESPACE:-default}"
TEMPORAL_TASK_QUEUE="${AGENTLAB_TEMPORAL_TASK_QUEUE:-agentlab-temporal-baseline}"
TEMPORAL_CLI="${AGENTLAB_TEMPORAL_CLI:-temporal}"

RESTATE_INGRESS_URL="${AGENTLAB_RESTATE_INGRESS_URL:-http://127.0.0.1:8080}"
RESTATE_ADMIN_URL="${AGENTLAB_RESTATE_ADMIN_URL:-http://127.0.0.1:9070}"
RESTATE_SERVICE_URL="${AGENTLAB_RESTATE_SERVICE_URL:-http://127.0.0.1:9080}"
RESTATE_SERVICE_PORT="${AGENTLAB_RESTATE_SERVICE_PORT:-9080}"
LANGGRAPH_HOST="${AGENTLAB_LANGGRAPH_HOST:-127.0.0.1}"
LANGGRAPH_PORT="${AGENTLAB_LANGGRAPH_PORT:-2024}"
LANGGRAPH_SERVICE_URL="${AGENTLAB_LANGGRAPH_SERVICE_URL:-http://${LANGGRAPH_HOST}:${LANGGRAPH_PORT}}"
VERCEL_WORKFLOWS_HOST="${AGENTLAB_VERCEL_WORKFLOWS_HOST:-127.0.0.1}"
VERCEL_WORKFLOWS_PORT="${AGENTLAB_VERCEL_WORKFLOWS_PORT:-9094}"
VERCEL_WORKFLOWS_SERVICE_URL="${AGENTLAB_VERCEL_WORKFLOWS_SERVICE_URL:-http://${VERCEL_WORKFLOWS_HOST}:${VERCEL_WORKFLOWS_PORT}}"

# Make the ignored server/.env available to separate local workers and
# services. Only known provider settings are loaded, and values are never
# printed by this script.
load_local_provider_env() {
  local env_file="$SERVER_DIR/.env"
  [[ -f "$env_file" ]] || return 0

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(OPENROUTER_API_KEY|AGENTLAB_OPENROUTER_BASE_URL|AGENTLAB_OPENROUTER_DEFAULT_MODEL|AGENTLAB_OPENROUTER_CATALOG_TIMEOUT_MS|AGENTLAB_OPENROUTER_CATALOG_TTL_MS|AGENTLAB_OPENROUTER_CATALOG_LIMIT|AGENTLAB_ALLOWED_MODEL_PROVIDERS)[[:space:]]*=(.*)$ ]] || continue
    local key="${BASH_REMATCH[1]}"
    local value="${BASH_REMATCH[2]}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ ${#value} -ge 2 && ( ( "${value:0:1}" == "'" && "${value: -1}" == "'" ) || ( "${value:0:1}" == '"' && "${value: -1}" == '"' ) ) ]]; then
      value="${value:1:${#value}-2}"
    fi
    if [[ ! -v "$key" ]]; then
      export "$key=$value"
    fi
  done < "$env_file"
}

load_local_provider_env

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
  if [[ ! -f "$ROOT_DIR/pnpm-lock.yaml" ]]; then
    echo "Workspace dependencies are not installed." >&2
    echo "Run pnpm install from the repository root." >&2
    exit 1
  fi
}

ensure_port_available() {
  local name="$1"
  local host="$2"
  local port="$3"

  stop_existing_lab_processes "$name" "$port"
  if ( exec 3<>"/dev/tcp/$host/$port" ) 2>/dev/null; then
    exec 3>&-
    echo "$name cannot start: $host:$port is already in use." >&2
    echo "The port is not owned by an Agent Harness Lab process, so it was left untouched." >&2
    return 1
  fi
}

terminate_process_tree() {
  local pid="$1"
  local child
  while read -r child; do
    [[ -n "$child" ]] || continue
    terminate_process_tree "$child"
  done < <(pgrep -P "$pid" 2>/dev/null || true)
  kill -TERM "$pid" 2>/dev/null || true
}

stop_existing_lab_processes() {
  local name="$1"
  local port="$2"
  require_command lsof
  require_command ps
  require_command pgrep

  local listener_pid command process_group current_process_group
  while read -r listener_pid; do
    [[ -n "$listener_pid" ]] || continue
    command="$(ps -p "$listener_pid" -o args= 2>/dev/null || true)"
    [[ -n "$command" ]] || continue
    if [[ "$command" != *"$ROOT_DIR"* ]]; then
      echo "$name cannot start: port $port is occupied by another process (PID $listener_pid)." >&2
      return 1
    fi

    echo "Stopping existing Agent Harness Lab process on port $port (PID $listener_pid)."
    process_group="$(ps -p "$listener_pid" -o pgid= 2>/dev/null | tr -d ' ')"
    current_process_group="$(ps -p "$$" -o pgid= 2>/dev/null | tr -d ' ')"
    if [[ "$process_group" =~ ^[0-9]+$ && "$process_group" != "$current_process_group" ]]; then
      kill -TERM -- "-$process_group" 2>/dev/null || terminate_process_tree "$listener_pid"
    else
      terminate_process_tree "$listener_pid"
    fi
  done < <(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | sort -nu)

  for _ in {1..30}; do
    if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  echo "$name could not stop the previous Lab process on port $port." >&2
  return 1
}

stop_existing_lab_workers() {
  require_command ps
  require_command pgrep

  local worker_pid command process_group current_process_group
  while read -r worker_pid; do
    [[ -n "$worker_pid" ]] || continue
    command="$(ps -p "$worker_pid" -o args= 2>/dev/null || true)"
    if [[ "$command" != *"$ROOT_DIR"* || "$command" != *"worker-entry.ts"* ]]; then
      continue
    fi

    echo "Stopping existing Agent Harness Lab Temporal worker (PID $worker_pid)."
    process_group="$(ps -p "$worker_pid" -o pgid= 2>/dev/null | tr -d ' ')"
    current_process_group="$(ps -p "$$" -o pgid= 2>/dev/null | tr -d ' ')"
    if [[ "$process_group" =~ ^[0-9]+$ && "$process_group" != "$current_process_group" ]]; then
      kill -TERM -- "-$process_group" 2>/dev/null || terminate_process_tree "$worker_pid"
    else
      terminate_process_tree "$worker_pid"
    fi
  done < <(pgrep -f 'worker-entry\.ts' 2>/dev/null | sort -nu || true)

  for _ in {1..30}; do
    local remaining_worker_pid remaining_command
    remaining_worker_pid=""
    while read -r worker_pid; do
      [[ -n "$worker_pid" ]] || continue
      remaining_command="$(ps -p "$worker_pid" -o args= 2>/dev/null || true)"
      if [[ "$remaining_command" == *"$ROOT_DIR"* && "$remaining_command" == *"worker-entry.ts"* ]]; then
        remaining_worker_pid="$worker_pid"
        break
      fi
    done < <(pgrep -f 'worker-entry\.ts' 2>/dev/null | sort -nu || true)
    [[ -z "$remaining_worker_pid" ]] && return 0
    sleep 0.1
  done
  echo "The previous Agent Harness Lab Temporal worker did not stop." >&2
  return 1
}

check_temporal() {
  require_command "$TEMPORAL_CLI"

  if ! temporal_is_reachable; then
    echo "Temporal is not reachable at $TEMPORAL_ENDPOINT." >&2
    echo "Start it in another terminal: $TEMPORAL_CLI server start-dev" >&2
    echo "For restart exercises, use: $TEMPORAL_CLI server start-dev --db-filename /tmp/agentlab-temporal-baseline.db" >&2
    exit 1
  fi
}

temporal_is_reachable() {
  "$TEMPORAL_CLI" workflow list \
    --address "$TEMPORAL_ENDPOINT" \
    --namespace "$TEMPORAL_NAMESPACE" \
    --limit 1 >/dev/null 2>&1
}

wait_for_temporal() {
  local log_file="$1"
  for _ in {1..60}; do
    if temporal_is_reachable; then
      echo "Temporal is ready at $TEMPORAL_ENDPOINT"
      return 0
    fi
    sleep 1
  done
  echo "Temporal did not become ready at $TEMPORAL_ENDPOINT. Check $log_file." >&2
  return 1
}

wait_for_http() {
  local name="$1"
  local url="$2"
  for _ in {1..60}; do
    if curl --silent --show-error --fail --max-time 2 "$url" >/dev/null 2>&1; then
      echo "$name is ready at $url"
      return 0
    fi
    sleep 1
  done
  echo "$name did not become ready at $url." >&2
  return 1
}

resolve_langgraph_python() {
  local platform_directory="$SERVER_DIR/src/platforms/langgraph"
  local configured_python="${AGENTLAB_LANGGRAPH_PYTHON:-}"

  if [[ -n "$configured_python" ]]; then
    require_command "$configured_python"
    if ! "$configured_python" -c 'import sqlite3, fastapi, langgraph, uvicorn' >/dev/null 2>&1; then
      echo "LangGraph dependencies are not installed for $configured_python." >&2
      echo "Install $platform_directory/requirements.lock or unset AGENTLAB_LANGGRAPH_PYTHON to let the launcher prepare .venv." >&2
      return 1
    fi
    printf '%s\n' "$configured_python"
    return 0
  fi

  local candidate
  for candidate in \
    "$platform_directory/.venv/bin/python" \
    "$platform_directory/.local311/bin/python" \
    "$platform_directory/.local/bin/python"; do
    if [[ -x "$candidate" ]] && "$candidate" -c 'import sqlite3, fastapi, langgraph, uvicorn' >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  require_command python3
  if ! python3 -c 'import sys; raise SystemExit(0 if (sys.version_info >= (3, 11) and sys.version_info < (3, 13)) else 1)' >/dev/null 2>&1; then
    echo "LangGraph requires Python 3.11 or 3.12." >&2
    echo "Set AGENTLAB_LANGGRAPH_PYTHON to a compatible interpreter with the locked dependencies installed." >&2
    return 1
  fi

  local virtual_environment="${AGENTLAB_LANGGRAPH_VENV:-$platform_directory/.venv}"
  if [[ ! -x "$virtual_environment/bin/python" ]]; then
    echo "Preparing the local LangGraph Python environment at $virtual_environment." >&2
    python3 -m venv "$virtual_environment"
  fi
  if ! "$virtual_environment/bin/python" -c 'import sqlite3, fastapi, langgraph, uvicorn' >/dev/null 2>&1; then
    echo "Installing the locked LangGraph dependencies." >&2
    "$virtual_environment/bin/python" -m pip install --disable-pip-version-check --requirement "$platform_directory/requirements.lock" >&2
  fi
  if ! "$virtual_environment/bin/python" -c 'import sqlite3, fastapi, langgraph, uvicorn' >/dev/null 2>&1; then
    echo "LangGraph dependencies could not be loaded from $virtual_environment." >&2
    return 1
  fi
  printf '%s\n' "$virtual_environment/bin/python"
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

Start the local Agent Harness Lab services. With no service specified, the
complete local comparison stack is started: Temporal, Restate, LangGraph,
Vercel Workflows, the Lab server, the Temporal worker, and the web app.

Available services:
  all                  Start the complete local comparison stack (default)
  frontend, web        Start the React/Vite frontend only
  server, api          Start the Fastify server only (api is an alias)
  worker               Start the Temporal worker only
  restate-server       Start the native Restate server (no Docker)
  restate              Start the Restate baseline service
  dbos                 Start the DBOS baseline service (PostgreSQL must be available)
  inngest              Start the Inngest function service
  inngest-dev          Start the Inngest Dev Server directly with pnpm dlx
  trigger-dev          Start the Trigger.dev local task worker
  langgraph            Start the LangGraph Python service
  aws-step-functions   Start the AWS Step Functions platform service
  hatchet              Start the Hatchet platform worker (embedded by default)
  vercel-workflows     Start the Vercel Workflows platform service
  check-temporal       Check the configured Temporal endpoint

Environment variables:
  AGENTLAB_WEB_HOST, AGENTLAB_WEB_PORT
  AGENTLAB_API_HOST, AGENTLAB_API_PORT
  AGENTLAB_RUN_ROOT, AGENTLAB_CONTEXT_ROOT
  AGENTLAB_TEMPORAL_ENDPOINT, AGENTLAB_TEMPORAL_NAMESPACE
  AGENTLAB_TEMPORAL_TASK_QUEUE, AGENTLAB_TEMPORAL_CLI
  AGENTLAB_RESTATE_INGRESS_URL, AGENTLAB_RESTATE_ADMIN_URL
  AGENTLAB_RESTATE_SERVICE_URL, AGENTLAB_RESTATE_SERVICE_PORT
  AGENTLAB_RESTATE_DATA_DIR
  AGENTLAB_LANGGRAPH_PYTHON, AGENTLAB_LANGGRAPH_VENV
  AGENTLAB_LANGGRAPH_HOST, AGENTLAB_LANGGRAPH_PORT, AGENTLAB_LANGGRAPH_SERVICE_URL
  AGENTLAB_VERCEL_WORKFLOWS_HOST, AGENTLAB_VERCEL_WORKFLOWS_PORT
  AGENTLAB_VERCEL_WORKFLOWS_SERVICE_URL
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
  require_command pnpm
  require_package "$WEB_DIR"

  if [[ ! -x "$WEB_DIR/node_modules/.bin/vite" ]]; then
    echo "Frontend dependencies are incomplete or out of date." >&2
    echo "Run: pnpm install" >&2
    exit 1
  fi

  ensure_port_available "Frontend" "$WEB_HOST" "$WEB_PORT"
  echo "Starting Agent Harness Lab frontend at http://${WEB_HOST}:${WEB_PORT}"
  exec pnpm --dir "$ROOT_DIR" --filter @agent-harness-lab/web run dev --host "$WEB_HOST" --port "$WEB_PORT"
}

run_server() {
  require_command pnpm
  require_package "$SERVER_DIR"

  ensure_port_available "Lab server" "$API_HOST" "$API_PORT"
  echo "Starting Agent Harness Lab server at http://${API_HOST}:${API_PORT}"
  AGENTLAB_API_HOST="$API_HOST" \
    AGENTLAB_API_PORT="$API_PORT" \
    AGENTLAB_RUN_ROOT="$RUN_ROOT" \
    AGENTLAB_CONTEXT_ROOT="$CONTEXT_ROOT" \
    AGENTLAB_TEMPORAL_ENDPOINT="$TEMPORAL_ENDPOINT" \
    AGENTLAB_TEMPORAL_NAMESPACE="$TEMPORAL_NAMESPACE" \
    AGENTLAB_TEMPORAL_TASK_QUEUE="$TEMPORAL_TASK_QUEUE" \
    exec pnpm --dir "$ROOT_DIR" --filter @agent-harness-lab/lab-server run dev
}

run_worker() {
  require_command pnpm
  require_package "$SERVER_DIR"
  check_temporal
  stop_existing_lab_workers

  echo "Starting Temporal worker on task queue $TEMPORAL_TASK_QUEUE"
  AGENTLAB_RUN_ROOT="$RUN_ROOT" \
    AGENTLAB_CONTEXT_ROOT="$CONTEXT_ROOT" \
    AGENTLAB_TEMPORAL_ENDPOINT="$TEMPORAL_ENDPOINT" \
    AGENTLAB_TEMPORAL_NAMESPACE="$TEMPORAL_NAMESPACE" \
    AGENTLAB_TEMPORAL_TASK_QUEUE="$TEMPORAL_TASK_QUEUE" \
    exec pnpm --dir "$ROOT_DIR" --filter @agent-harness-lab/lab-server run dev:worker
}

run_restate_server() {
  require_command pnpm
  require_package "$SERVER_DIR/src/platforms/restate"

  echo "Starting native Restate server (no Docker)."
  exec pnpm --dir "$ROOT_DIR" --filter @agent-harness-lab/restate-platform run dev:server
}

run_restate() {
  require_command pnpm
  require_package "$SERVER_DIR"
  require_package "$SERVER_DIR/src/platforms/restate"

  echo "Starting Restate baseline service."
  exec pnpm --dir "$ROOT_DIR" --filter @agent-harness-lab/lab-server run dev:restate
}

run_dbos() {
  require_command pnpm
  require_package "$SERVER_DIR"
  require_package "$SERVER_DIR/src/platforms/dbos"

  echo "Starting DBOS baseline service. PostgreSQL must already be available."
  exec pnpm --dir "$ROOT_DIR" --filter @agent-harness-lab/lab-server run dev:dbos
}

run_inngest() {
  require_command pnpm
  require_package "$SERVER_DIR"
  require_package "$SERVER_DIR/src/platforms/inngest"

  echo "Starting Inngest function service."
  exec pnpm --dir "$ROOT_DIR" --filter @agent-harness-lab/lab-server run dev:inngest
}

run_inngest_dev() {
  require_command pnpm

  local service_url="${AGENTLAB_INNGEST_SERVICE_URL:-http://${API_HOST}:9091}"
  echo "Starting Inngest Dev Server for $service_url/api/inngest."
  exec pnpm dlx --yes inngest-cli@1.44.0 dev --no-discovery -u "$service_url/api/inngest"
}

run_trigger_dev() {
  require_command pnpm
  require_package "$SERVER_DIR/src/platforms/trigger-dev"

  echo "Starting Trigger.dev local task worker."
  cd "$SERVER_DIR/src/platforms/trigger-dev"
  exec pnpm run dev
}

run_langgraph() {
  local platform_directory="$SERVER_DIR/src/platforms/langgraph"
  if [[ ! -d "$platform_directory" ]]; then
    echo "LangGraph platform directory not found: $platform_directory" >&2
    exit 1
  fi
  local python_command
  python_command="$(resolve_langgraph_python)" || exit 1

  echo "Starting LangGraph Python service."
  cd "$platform_directory"
  PYTHONPATH="$platform_directory" \
    "$python_command" -m uvicorn service.app:app \
      --host "$LANGGRAPH_HOST" \
      --port "$LANGGRAPH_PORT"
}

run_aws_step_functions() {
  require_command pnpm
  require_package "$SERVER_DIR"
  require_package "$SERVER_DIR/src/platforms/aws-step-functions"

  echo "Starting AWS Step Functions platform service."
  exec pnpm --dir "$ROOT_DIR" --filter @agent-harness-lab/lab-server run dev:aws-step-functions
}

run_hatchet() {
  require_command pnpm
  require_package "$SERVER_DIR"
  require_package "$SERVER_DIR/src/platforms/hatchet"

  echo "Starting Hatchet platform worker (embedded runtime by default)."
  exec pnpm --dir "$ROOT_DIR" --filter @agent-harness-lab/lab-server run dev:hatchet
}

run_vercel_workflows() {
  require_command pnpm
  require_package "$SERVER_DIR"
  require_package "$SERVER_DIR/src/platforms/vercel-workflows"

  echo "Starting Vercel Workflows platform service."
  exec pnpm --dir "$ROOT_DIR" --filter @agent-harness-lab/lab-server run dev:vercel-workflows
}

endpoint_host() {
  local endpoint="$1"
  local fallback="$2"
  local authority="${endpoint#*://}"
  authority="${authority%%/*}"
  if [[ "$authority" =~ ^\[([^]]+)\](:[0-9]+)?$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
  elif [[ "$authority" == *:* ]]; then
    printf '%s\n' "${authority%:*}"
  elif [[ -n "$authority" ]]; then
    printf '%s\n' "$authority"
  else
    printf '%s\n' "$fallback"
  fi
}

endpoint_port() {
  local endpoint="$1"
  local fallback="$2"
  local authority="${endpoint#*://}"
  authority="${authority%%/*}"
  if [[ "$authority" =~ :([0-9]+)$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
  else
    printf '%s\n' "$fallback"
  fi
}

start_all() {
  require_command pnpm
  require_command curl
  require_command setsid
  require_command pgrep
  require_package "$WEB_DIR"
  require_package "$SERVER_DIR"
  require_package "$SERVER_DIR/src/platforms/restate"
  require_package "$SERVER_DIR/src/platforms/vercel-workflows"
  if [[ ! -x "$WEB_DIR/node_modules/.bin/vite" ]]; then
    echo "Frontend dependencies are incomplete or out of date." >&2
    echo "Run: pnpm install" >&2
    return 1
  fi
  if [[ ! -x "$SERVER_DIR/src/platforms/restate/node_modules/.bin/restate-server" ]]; then
    echo "The native Restate server binary is missing." >&2
    echo "Run: pnpm install" >&2
    return 1
  fi

  local langgraph_python
  langgraph_python="$(resolve_langgraph_python)" || return 1

  local restate_ingress_host restate_ingress_port
  local restate_admin_host restate_admin_port restate_service_host
  restate_ingress_host="$(endpoint_host "$RESTATE_INGRESS_URL" "127.0.0.1")"
  restate_ingress_port="$(endpoint_port "$RESTATE_INGRESS_URL" "8080")"
  restate_admin_host="$(endpoint_host "$RESTATE_ADMIN_URL" "127.0.0.1")"
  restate_admin_port="$(endpoint_port "$RESTATE_ADMIN_URL" "9070")"
  restate_service_host="$(endpoint_host "$RESTATE_SERVICE_URL" "127.0.0.1")"

  ensure_port_available "Lab server" "$API_HOST" "$API_PORT"
  ensure_port_available "Frontend" "$WEB_HOST" "$WEB_PORT"
  ensure_port_available "Restate ingress" "$restate_ingress_host" "$restate_ingress_port"
  ensure_port_available "Restate admin" "$restate_admin_host" "$restate_admin_port"
  ensure_port_available "Restate service" "$restate_service_host" "$RESTATE_SERVICE_PORT"
  ensure_port_available "LangGraph service" "$LANGGRAPH_HOST" "$LANGGRAPH_PORT"
  ensure_port_available "Vercel Workflows service" "$VERCEL_WORKFLOWS_HOST" "$VERCEL_WORKFLOWS_PORT"
  stop_existing_lab_workers

  local log_directory
  log_directory="$(mktemp -d "${TMPDIR:-/tmp}/agentlab-stack.XXXXXX")"
  local -a pids=()
  local -a process_names=()

  start_background() {
    local name="$1"
    shift
    setsid "$@" >"$log_directory/$name.log" 2>&1 &
    pids+=("$!")
    process_names+=("$name")
  }

  stack_processes_alive() {
    local index
    for index in "${!pids[@]}"; do
      if ! kill -0 "${pids[$index]}" 2>/dev/null; then
        echo "${process_names[$index]} exited. Check $log_directory/${process_names[$index]}.log." >&2
        return 1
      fi
    done
  }

  cleanup() {
    trap - EXIT INT TERM
    local index pid exit_code=$?
    for ((index = ${#pids[@]} - 1; index >= 0; index--)); do
      pid="${pids[$index]}"
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    done
    for pid in "${pids[@]}"; do
      wait "$pid" 2>/dev/null || true
    done
    echo "Local stack stopped. Logs retained at $log_directory"
    exit "$exit_code"
  }
  trap cleanup EXIT INT TERM

  if temporal_is_reachable; then
    echo "Using existing Temporal at $TEMPORAL_ENDPOINT"
  elif [[ "$TEMPORAL_ENDPOINT" == "localhost:7233" || "$TEMPORAL_ENDPOINT" == "127.0.0.1:7233" ]]; then
    ensure_port_available "Temporal" "127.0.0.1" "7233"
    echo "Starting local Temporal server."
    start_background "temporal" "$TEMPORAL_CLI" server start-dev
    wait_for_temporal "$log_directory/temporal.log"
  else
    echo "Temporal is not reachable at $TEMPORAL_ENDPOINT and cannot be started automatically for a non-local endpoint." >&2
    echo "Start the configured Temporal server, then run this script again." >&2
    return 1
  fi

  echo "Starting Restate server and service."
  start_background "restate-server" env \
    RESTATE_BIND_IP="${RESTATE_BIND_IP:-$restate_ingress_host}" \
    RESTATE_ADMIN__BIND_ADDRESS="${RESTATE_ADMIN__BIND_ADDRESS:-${restate_admin_host}:${restate_admin_port}}" \
    RESTATE_INGRESS__BIND_ADDRESS="${RESTATE_INGRESS__BIND_ADDRESS:-${restate_ingress_host}:${restate_ingress_port}}" \
    pnpm --dir "$ROOT_DIR" --filter @agent-harness-lab/restate-platform run dev:server
  wait_for_http "Restate server" "$RESTATE_ADMIN_URL/health"
  stack_processes_alive

  start_background "restate" env \
    AGENTLAB_RESTATE_INGRESS_URL="$RESTATE_INGRESS_URL" \
    AGENTLAB_RESTATE_ADMIN_URL="$RESTATE_ADMIN_URL" \
    AGENTLAB_RESTATE_SERVICE_URL="$RESTATE_SERVICE_URL" \
    AGENTLAB_RESTATE_SERVICE_PORT="$RESTATE_SERVICE_PORT" \
    pnpm --dir "$ROOT_DIR" --filter @agent-harness-lab/lab-server run dev:restate

  for _ in {1..60}; do
    if [[ "$(curl --silent --show-error --max-time 2 --output /dev/null --write-out '%{http_code}' \
      --request POST "$RESTATE_ADMIN_URL/deployments" \
      --header 'content-type: application/json' \
      --data "{\"uri\":\"$RESTATE_SERVICE_URL\"}" 2>/dev/null || true)" =~ ^2 ]]; then
      echo "Restate service registered at $RESTATE_SERVICE_URL"
      break
    fi
    if curl --silent --show-error --fail --max-time 2 "$RESTATE_ADMIN_URL/deployments" 2>/dev/null | grep -Fq "$RESTATE_SERVICE_URL"; then
      echo "Restate service already registered at $RESTATE_SERVICE_URL"
      break
    fi
    stack_processes_alive
    sleep 1
  done
  if ! curl --silent --show-error --fail --max-time 2 "$RESTATE_ADMIN_URL/deployments" 2>/dev/null | grep -Fq "$RESTATE_SERVICE_URL"; then
    echo "Restate service could not be registered at $RESTATE_SERVICE_URL." >&2
    echo "Check $log_directory/restate-server.log and $log_directory/restate.log." >&2
    return 1
  fi

  echo "Starting LangGraph and Vercel Workflows services."
  start_background "langgraph" env \
    AGENTLAB_LANGGRAPH_HOST="$LANGGRAPH_HOST" \
    AGENTLAB_LANGGRAPH_PORT="$LANGGRAPH_PORT" \
    PYTHONPATH="$SERVER_DIR/src/platforms/langgraph" \
    "$langgraph_python" -m uvicorn service.app:app --host "$LANGGRAPH_HOST" --port "$LANGGRAPH_PORT"
  start_background "vercel-workflows" env \
    AGENTLAB_VERCEL_WORKFLOWS_HOST="$VERCEL_WORKFLOWS_HOST" \
    AGENTLAB_VERCEL_WORKFLOWS_PORT="$VERCEL_WORKFLOWS_PORT" \
    AGENTLAB_VERCEL_WORKFLOWS_SERVICE_URL="$VERCEL_WORKFLOWS_SERVICE_URL" \
    pnpm --dir "$ROOT_DIR" --filter @agent-harness-lab/lab-server run dev:vercel-workflows
  wait_for_http "LangGraph service" "$LANGGRAPH_SERVICE_URL/health"
  stack_processes_alive
  wait_for_http "Vercel Workflows service" "$VERCEL_WORKFLOWS_SERVICE_URL/ready"
  stack_processes_alive

  echo "Starting Lab server, Temporal worker, and web app."
  start_background "server" env \
    AGENTLAB_API_HOST="$API_HOST" \
    AGENTLAB_API_PORT="$API_PORT" \
    AGENTLAB_RUN_ROOT="$RUN_ROOT" \
    AGENTLAB_CONTEXT_ROOT="$CONTEXT_ROOT" \
    AGENTLAB_TEMPORAL_ENDPOINT="$TEMPORAL_ENDPOINT" \
    AGENTLAB_TEMPORAL_NAMESPACE="$TEMPORAL_NAMESPACE" \
    AGENTLAB_TEMPORAL_TASK_QUEUE="$TEMPORAL_TASK_QUEUE" \
    AGENTLAB_RESTATE_INGRESS_URL="$RESTATE_INGRESS_URL" \
    AGENTLAB_RESTATE_ADMIN_URL="$RESTATE_ADMIN_URL" \
    AGENTLAB_RESTATE_SERVICE_URL="$RESTATE_SERVICE_URL" \
    AGENTLAB_RESTATE_SERVICE_PORT="$RESTATE_SERVICE_PORT" \
    AGENTLAB_LANGGRAPH_SERVICE_URL="$LANGGRAPH_SERVICE_URL" \
    AGENTLAB_VERCEL_WORKFLOWS_SERVICE_URL="$VERCEL_WORKFLOWS_SERVICE_URL" \
    pnpm --dir "$ROOT_DIR" --filter @agent-harness-lab/lab-server run dev
  start_background "worker" env \
    AGENTLAB_RUN_ROOT="$RUN_ROOT" \
    AGENTLAB_CONTEXT_ROOT="$CONTEXT_ROOT" \
    AGENTLAB_TEMPORAL_ENDPOINT="$TEMPORAL_ENDPOINT" \
    AGENTLAB_TEMPORAL_NAMESPACE="$TEMPORAL_NAMESPACE" \
    AGENTLAB_TEMPORAL_TASK_QUEUE="$TEMPORAL_TASK_QUEUE" \
    pnpm --dir "$ROOT_DIR" --filter @agent-harness-lab/lab-server run dev:worker
  start_background "web" env \
    VITE_AGENTLAB_API_URL="${VITE_AGENTLAB_API_URL:-http://${API_HOST}:${API_PORT}}" \
    pnpm --dir "$ROOT_DIR" --filter @agent-harness-lab/web run dev --host "$WEB_HOST" --port "$WEB_PORT"

  wait_for_http "Lab server" "http://${API_HOST}:${API_PORT}/ready"
  stack_processes_alive
  wait_for_http "Web app" "http://${WEB_HOST}:${WEB_PORT}"
  stack_processes_alive
  wait_for_worker "$log_directory/worker.log"

  echo "Agent Harness Lab local stack is ready."
  echo "  Web:        http://${WEB_HOST}:${WEB_PORT}"
  echo "  Server:     http://${API_HOST}:${API_PORT}"
  echo "  Temporal:   $TEMPORAL_ENDPOINT"
  echo "  Restate:    $RESTATE_INGRESS_URL"
  echo "  LangGraph:  $LANGGRAPH_SERVICE_URL"
  echo "  Vercel:     $VERCEL_WORKFLOWS_SERVICE_URL"
  echo "  Logs:       $log_directory"
  echo "Press Ctrl-C to stop the Lab processes. An existing Temporal server is left running."

  while :; do
    stack_processes_alive
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
