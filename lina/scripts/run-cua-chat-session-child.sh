#!/usr/bin/env bash

set -Eeuo pipefail

fixture="${1:-false}"
window_manager="${2:-}"
shift 2 || true

# A window manager such as GNOME Shell starts desktop services of its own. Keep
# those services inside the disposable launcher directory so a CUA smoke run
# cannot discover the contributor's real Desktop, Tracker index, browser
# profile, or other session data. The fixture also uses Chrome's basic password
# store so a disposable keyring setup dialog cannot become an unintended computer
# target. Lina still runs from the repository cwd, so its project-local .env and
# source files remain available.
isolated_home="${LINA_CUA_RUNTIME_DIR}/home"
export HOME="$isolated_home"
export XDG_CONFIG_HOME="${isolated_home}/.config"
export XDG_CACHE_HOME="${isolated_home}/.cache"
export XDG_DATA_HOME="${isolated_home}/.local/share"
export XDG_STATE_HOME="${isolated_home}/.local/state"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME"

chrome_pid=""
window_manager_pid=""
cleanup() {
  local exit_status=$?
  if [[ -n "$chrome_pid" ]] && kill -0 "$chrome_pid" 2>/dev/null; then
    kill "$chrome_pid" 2>/dev/null || true
    wait "$chrome_pid" 2>/dev/null || true
  fi
  if [[ -n "$window_manager_pid" ]] && kill -0 "$window_manager_pid" 2>/dev/null; then
    kill "$window_manager_pid" 2>/dev/null || true
    wait "$window_manager_pid" 2>/dev/null || true
  fi
  exit "$exit_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ -n "$window_manager" ]]; then
  case "$window_manager" in
    openbox|fluxbox|twm|jwm|gnome-shell) ;;
    *)
      echo "Unsupported window manager '$window_manager'; use openbox, fluxbox, twm, jwm, or gnome-shell." >&2
      exit 2
      ;;
  esac
  if ! command -v "$window_manager" >/dev/null 2>&1; then
    echo "Requested window manager '$window_manager' is not installed on this host." >&2
    echo "Install it as an OS prerequisite, then rerun the disposable CUA launcher." >&2
    exit 2
  fi
  case "$window_manager" in
    openbox) openbox --sm-disable >"${LINA_CUA_RUNTIME_DIR}/window-manager.log" 2>&1 & ;;
    fluxbox) fluxbox -noicon >"${LINA_CUA_RUNTIME_DIR}/window-manager.log" 2>&1 & ;;
    twm|jwm) "$window_manager" >"${LINA_CUA_RUNTIME_DIR}/window-manager.log" 2>&1 & ;;
    gnome-shell) gnome-shell --x11 --sm-disable --display="$DISPLAY" >"${LINA_CUA_RUNTIME_DIR}/window-manager.log" 2>&1 & ;;
  esac
  window_manager_pid=$!
  sleep 0.5
  if ! kill -0 "$window_manager_pid" 2>/dev/null; then
    echo "Window manager '$window_manager' exited before the fixture started." >&2
    sed -n '1,120p' "${LINA_CUA_RUNTIME_DIR}/window-manager.log" >&2 || true
    exit 1
  fi
  echo "Started disposable X11 window manager: $window_manager"
else
  echo "No window manager requested; native Jev will abstain if no semantic window is exposed."
fi

if [[ "$fixture" == true ]]; then
  google-chrome \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --password-store=basic \
    --no-first-run \
    --no-default-browser-check \
    --force-renderer-accessibility \
    --user-data-dir="${LINA_CUA_RUNTIME_DIR}/chrome-profile" \
    --app="${LINA_CUA_FIXTURE_URL}" \
    >"${LINA_CUA_RUNTIME_DIR}/chrome.log" 2>&1 &
  chrome_pid=$!
  sleep 1
  echo "Opened the disposable Lina native fixture in Chrome."
else
  echo "A GUI application must be started in this display before asking Lina to interact with it."
fi

# This script is invoked by dbus-run-session with the caller's stdin intact.
pnpm run chat "$@"
