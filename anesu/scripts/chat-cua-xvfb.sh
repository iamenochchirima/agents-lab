#!/usr/bin/env bash

set -Eeuo pipefail

# Start Anesu inside a private Xvfb display. This is a development launcher, not
# a claim that Xvfb is a complete desktop environment. `--fixture` opens the
# checked-in native fixture; `--acceptance` starts the deterministic local
# browser acceptance service. Combine both flags for a mixed run.
display="${ANESU_CUA_XVFB_DISPLAY:-:99}"
screen="${ANESU_CUA_XVFB_SCREEN:-1280x720x24}"
fixture=false
acceptance=false
window_manager="${ANESU_CUA_WINDOW_MANAGER:-}"
browser_product="${ANESU_CUA_BROWSER_PRODUCT:-auto}"
chat_args=()

usage() {
  cat >&2 <<'EOF'
Usage: chat-cua-xvfb.sh [--fixture] [--acceptance] [--window-manager NAME]
                        [--browser-product auto|chrome|edge] [-- chat arguments...]

  --fixture       Open the checked-in native CUA fixture in the private display.
  --acceptance    Start the deterministic local browser acceptance service.
  --window-manager NAME
                  Start NAME inside the private display (for example gnome-shell).
  --browser-product PRODUCT
                  Select the installed Cua browser for --fixture; auto prefers Chrome.
  --              End launcher options; remaining arguments go to `pnpm run chat`.

The acceptance service uses http://127.0.0.1:4173 by default because that origin is
already present in Anesu's immutable Cua browser manifest.
EOF
}

while (($# > 0)); do
  case "$1" in
    --fixture) fixture=true; shift ;;
    --acceptance) acceptance=true; shift ;;
    --window-manager)
      if (($# < 2)); then
        echo "--window-manager requires a command name such as openbox or fluxbox." >&2
        exit 2
      fi
      window_manager="$2"
      shift 2
      ;;
    --window-manager=*) window_manager="${1#*=}"; shift ;;
    --browser-product)
      if (($# < 2)); then
        echo "--browser-product requires auto, chrome, or edge." >&2
        exit 2
      fi
      browser_product="$2"
      shift 2
      ;;
    --browser-product=*) browser_product="${1#*=}"; shift ;;
    --help|-h) usage; exit 0 ;;
    --) shift ;;
    *) chat_args+=("$1"); shift ;;
  esac
done

if [[ ! "$display" =~ ^:[0-9]+$ ]]; then
  echo "ANESU_CUA_XVFB_DISPLAY must look like :99." >&2
  exit 2
fi
if [[ ! "$screen" =~ ^[0-9]+x[0-9]+x(8|15|16|24|32)$ ]]; then
  echo "ANESU_CUA_XVFB_SCREEN must look like 1280x720x24." >&2
  exit 2
fi
if ! command -v Xvfb >/dev/null 2>&1 || ! command -v xdpyinfo >/dev/null 2>&1 || ! command -v xauth >/dev/null 2>&1; then
  echo "The native CUA launcher requires Xvfb, xdpyinfo, and xauth." >&2
  exit 2
fi
if xdpyinfo -display "$display" >/dev/null 2>&1; then
  echo "Refusing to reuse the already-running display $display; choose another ANESU_CUA_XVFB_DISPLAY." >&2
  exit 2
fi

runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/anesu-cua-xvfb.XXXXXX")"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
auth_file="$runtime_dir/Xauthority"
log_file="$runtime_dir/Xvfb.log"
cookie="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
touch "$auth_file"
xauth -f "$auth_file" add "$display" MIT-MAGIC-COOKIE-1 "$cookie" >/dev/null
export DISPLAY="$display"
export XAUTHORITY="$auth_file"

xvfb_pid=""
remove_runtime_dir() {
  local attempt
  for attempt in {1..30}; do
    [[ ! -e "$runtime_dir" ]] && return 0
    rm -rf -- "$runtime_dir" 2>/dev/null || true
    [[ ! -e "$runtime_dir" ]] && return 0
    sleep 0.1
  done
  echo "Unable to remove private Cua runtime state: $runtime_dir" >&2
  return 1
}
cleanup() {
  local status=$?
  if [[ -n "$xvfb_pid" ]] && kill -0 "$xvfb_pid" 2>/dev/null; then
    kill "$xvfb_pid" 2>/dev/null || true
    wait "$xvfb_pid" 2>/dev/null || true
  fi
  if ! remove_runtime_dir && [[ "$status" -eq 0 ]]; then
    status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

Xvfb "$display" -screen 0 "$screen" -nolisten tcp -auth "$auth_file" >"$log_file" 2>&1 &
xvfb_pid=$!
for _ in {1..50}; do
  if xdpyinfo -display "$display" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$xvfb_pid" 2>/dev/null; then
    echo "Xvfb exited before display $display became ready." >&2
    sed -n '1,80p' "$log_file" >&2 || true
    exit 1
  fi
  sleep 0.1
done
if ! xdpyinfo -display "$display" >/dev/null 2>&1; then
  echo "Timed out waiting for isolated display $display." >&2
  sed -n '1,80p' "$log_file" >&2 || true
  exit 1
fi

export ANESU_COMPUTER_ENABLED=true
export ANESU_COMPUTER_ENVIRONMENT=ubuntu-x11-cua
export ANESU_COMPUTER_CUA_ISOLATED_DISPLAY=true
export ANESU_CUA_RUNTIME_DIR="$runtime_dir"
export XDG_SESSION_TYPE=x11
export GDK_BACKEND=x11
export QT_QPA_PLATFORM=xcb
export LIBGL_ALWAYS_SOFTWARE=1

echo "Anesu private Cua Xvfb display: $DISPLAY ($screen)"
mode=manual
if [[ "$acceptance" == true ]]; then
  mode=acceptance
  echo "Deterministic Cua browser acceptance: enabled"
fi
"$script_dir/run-cua-chat-session.sh" "$fixture" "$window_manager" "$browser_product" "$mode" "${chat_args[@]}"
