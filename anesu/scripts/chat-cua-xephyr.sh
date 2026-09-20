#!/usr/bin/env bash

set -Eeuo pipefail

# Start Anesu inside a private nested X11 server that is visible as a window on
# the caller's existing X11 desktop. This is a development viewer, not a host
# isolation boundary by itself; the nested display is still the only display
# Anesu is allowed to target. The optional --fixture flag opens Anesu's local
# disposable Chrome fixture for a quick manual smoke.
parent_display="${DISPLAY:-}"
display="${ANESU_CUA_XEPHYR_DISPLAY:-:100}"
screen="${ANESU_CUA_XEPHYR_SCREEN:-1280x720x24}"
fixture=false
window_manager="${ANESU_CUA_WINDOW_MANAGER:-}"
chat_args=()
while (($# > 0)); do
  case "$1" in
    --fixture) fixture=true; shift ;;
    --window-manager)
      if (($# < 2)); then
        echo "--window-manager requires a command name such as openbox or fluxbox." >&2
        exit 2
      fi
      window_manager="$2"
      shift 2
      ;;
    --window-manager=*) window_manager="${1#*=}"; shift ;;
    --) shift ;;
    *) chat_args+=("$1"); shift ;;
  esac
done

if [[ -z "$parent_display" ]]; then
  echo "chat:cua-xephyr requires an existing X11 DISPLAY to show the nested window." >&2
  exit 2
fi
if [[ ! "$display" =~ ^:[0-9]+$ ]]; then
  echo "ANESU_CUA_XEPHYR_DISPLAY must look like :100." >&2
  exit 2
fi
if [[ ! "$screen" =~ ^[0-9]+x[0-9]+x(8|15|16|24|32)$ ]]; then
  echo "ANESU_CUA_XEPHYR_SCREEN must look like 1280x720x24." >&2
  exit 2
fi
if ! command -v Xephyr >/dev/null 2>&1 || ! command -v xdpyinfo >/dev/null 2>&1 || ! command -v xauth >/dev/null 2>&1; then
  echo "The native CUA viewer requires Xephyr, xdpyinfo, and xauth." >&2
  exit 2
fi
if [[ "$fixture" == true ]] && ! command -v google-chrome >/dev/null 2>&1; then
  echo "The --fixture option requires google-chrome." >&2
  exit 2
fi
if ! DISPLAY="$parent_display" xdpyinfo >/dev/null 2>&1; then
  echo "The parent X11 display is not reachable: $parent_display" >&2
  exit 2
fi
if DISPLAY="$parent_display" xdpyinfo -display "$display" >/dev/null 2>&1; then
  echo "Refusing to reuse the already-running nested display $display; choose another ANESU_CUA_XEPHYR_DISPLAY." >&2
  exit 2
fi

runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/anesu-cua-xephyr.XXXXXX")"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
auth_file="$runtime_dir/Xauthority"
log_file="$runtime_dir/Xephyr.log"
cookie="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
touch "$auth_file"
xauth -f "$auth_file" add "$display" MIT-MAGIC-COOKIE-1 "$cookie" >/dev/null

xephyr_pid=""
cleanup() {
  local status=$?
  if [[ -n "$xephyr_pid" ]] && kill -0 "$xephyr_pid" 2>/dev/null; then
    kill "$xephyr_pid" 2>/dev/null || true
    wait "$xephyr_pid" 2>/dev/null || true
  fi
  rm -rf -- "$runtime_dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

DISPLAY="$parent_display" Xephyr "$display" -screen "$screen" -nolisten tcp -auth "$auth_file" >"$log_file" 2>&1 &
xephyr_pid=$!
export DISPLAY="$display"
export XAUTHORITY="$auth_file"
for _ in {1..50}; do
  if xdpyinfo >/dev/null 2>&1; then break; fi
  if ! kill -0 "$xephyr_pid" 2>/dev/null; then
    echo "Xephyr exited before display $display became ready." >&2
    sed -n '1,80p' "$log_file" >&2 || true
    exit 1
  fi
  sleep 0.1
done
if ! xdpyinfo >/dev/null 2>&1; then
  echo "Timed out waiting for nested display $display." >&2
  sed -n '1,80p' "$log_file" >&2 || true
  exit 1
fi

export ANESU_COMPUTER_ENABLED=true
export ANESU_COMPUTER_ENVIRONMENT=ubuntu-x11-cua
export ANESU_COMPUTER_CUA_ISOLATED_DISPLAY=true
export ANESU_CUA_RUNTIME_DIR="$runtime_dir"
export ANESU_CUA_FIXTURE_URL="file://${script_dir}/../src/computer/fixtures/native.html"

echo "Anesu native CUA visible display: $DISPLAY ($screen)"
"$script_dir/run-cua-chat-session.sh" "$fixture" "$window_manager" "${chat_args[@]}"
