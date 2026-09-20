#!/usr/bin/env bash

set -Eeuo pipefail

fixture="${1:-false}"
window_manager="${2:-}"
shift 2 || true
if ! command -v dbus-run-session >/dev/null 2>&1; then
  echo "The native CUA launcher requires dbus-run-session so Anesu and the GUI share one desktop session bus." >&2
  exit 2
fi

# CUA's Linux accessibility tree is session-scoped. Keep the fixture and Anesu
# in one short-lived bus instead of starting the browser on the user's unrelated
# desktop bus and hoping the driver can discover it later. The child is a real
# script rather than `bash -s` with a heredoc: a heredoc would consume stdin and
# make the interactive TUI see EOF immediately.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# pnpm is provided by Corepack on the development host. Preserve only the
# package-manager cache location across the isolated HOME used by the child;
# otherwise Corepack treats the disposable home as a fresh installation and
# prompts to download pnpm during an interactive CUA run.
if [[ -z "${COREPACK_HOME:-}" ]]; then
  if [[ -n "${XDG_CACHE_HOME:-}" ]]; then
    export COREPACK_HOME="${XDG_CACHE_HOME}/node/corepack"
  else
    export COREPACK_HOME="${HOME}/.cache/node/corepack"
  fi
fi

# Set the isolated desktop environment before dbus-run-session starts. D-Bus
# service activation inherits the bus launcher environment, not later changes
# made by the child script; doing this here prevents Tracker and other desktop
# services from resolving the real user's home directories.
isolated_home="${ANESU_CUA_RUNTIME_DIR}/home"
isolated_runtime="${ANESU_CUA_RUNTIME_DIR}/runtime"
export HOME="$isolated_home"
export XDG_CONFIG_HOME="${isolated_home}/.config"
export XDG_CACHE_HOME="${isolated_home}/.cache"
export XDG_DATA_HOME="${isolated_home}/.local/share"
export XDG_STATE_HOME="${isolated_home}/.local/state"
export XDG_RUNTIME_DIR="$isolated_runtime"
unset GNOME_KEYRING_CONTROL SSH_AUTH_SOCK GPG_AGENT_INFO GNUPGHOME
mkdir -m 700 -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$XDG_RUNTIME_DIR"

dbus-run-session -- bash "$script_dir/run-cua-chat-session-child.sh" "$fixture" "$window_manager" "$@"
