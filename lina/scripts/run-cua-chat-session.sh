#!/usr/bin/env bash

set -Eeuo pipefail

fixture="${1:-false}"
window_manager="${2:-}"
browser_product="${3:-${LINA_CUA_BROWSER_PRODUCT:-auto}}"
mode=manual
if (($# >= 4)); then
  mode="$4"
  shift 4
elif (($# >= 3)); then
  shift 3
else
  shift "$#"
fi

case "$fixture" in
  true|false) ;;
  *)
    echo "The fixture selector must be true or false." >&2
    exit 2
    ;;
esac
case "$browser_product" in
  auto|chrome|edge) ;;
  *)
    echo "The browser product must be auto, chrome, or edge; got '$browser_product'." >&2
    exit 2
    ;;
esac
case "$mode" in
  manual|acceptance) ;;
  *)
    echo "The Cua session mode must be manual or acceptance; got '$mode'." >&2
    exit 2
    ;;
esac
if [[ "$mode" == acceptance && -z "$window_manager" ]]; then
  echo "Cua acceptance requires an explicit disposable X11 window manager so Cua can bind the browser window exactly." >&2
  echo "Rerun with --window-manager openbox (or another installed supported manager)." >&2
  exit 2
fi

runtime_dir="${LINA_CUA_RUNTIME_DIR:-}"
if [[ -z "$runtime_dir" || ! -d "$runtime_dir" ]]; then
  echo "The Cua session requires LINA_CUA_RUNTIME_DIR to name an existing private launcher directory." >&2
  echo "Start it through chat-cua-xvfb.sh or chat-cua-xephyr.sh." >&2
  exit 2
fi
if [[ -z "${DISPLAY:-}" || -z "${XAUTHORITY:-}" || ! -f "$XAUTHORITY" ]]; then
  echo "The Cua session requires a private DISPLAY and XAUTHORITY from an acceptance launcher." >&2
  exit 2
fi
if [[ "$(realpath -m -- "$XAUTHORITY")" != "$(realpath -m -- "$runtime_dir/Xauthority")" ]]; then
  echo "Refusing to run Cua with XAUTHORITY outside the private launcher directory." >&2
  exit 2
fi
if ! command -v xdpyinfo >/dev/null 2>&1 || ! xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
  echo "The private X11 display '$DISPLAY' is not reachable." >&2
  exit 2
fi
if ! command -v dbus-run-session >/dev/null 2>&1; then
  echo "The native CUA launcher requires dbus-run-session so Lina and the GUI share one desktop session bus." >&2
  exit 2
fi

find_chrome_binary() {
  local launcher launcher_path resolved candidate
  if [[ -x /opt/google/chrome/chrome ]]; then
    printf '%s\n' /opt/google/chrome/chrome
    return 0
  fi
  for launcher in google-chrome google-chrome-stable; do
    launcher_path="$(command -v "$launcher" 2>/dev/null || true)"
    [[ -n "$launcher_path" && -x "$launcher_path" ]] || continue
    resolved="$(readlink -f -- "$launcher_path" 2>/dev/null || true)"
    if [[ -n "$resolved" ]]; then
      candidate="${resolved%/*}/chrome"
      if [[ -x "$candidate" ]]; then
        printf '%s\n' "$candidate"
        return 0
      fi
    fi
  done
  return 1
}

find_edge_binary() {
  local launcher launcher_path resolved candidate
  if [[ -x /opt/microsoft/msedge/msedge ]]; then
    printf '%s\n' /opt/microsoft/msedge/msedge
    return 0
  fi
  for launcher in microsoft-edge microsoft-edge-stable msedge; do
    launcher_path="$(command -v "$launcher" 2>/dev/null || true)"
    [[ -n "$launcher_path" && -x "$launcher_path" ]] || continue
    resolved="$(readlink -f -- "$launcher_path" 2>/dev/null || true)"
    if [[ -n "$resolved" ]]; then
      candidate="${resolved%/*}/msedge"
      if [[ -x "$candidate" ]]; then
        printf '%s\n' "$candidate"
        return 0
      fi
    fi
    if [[ "$launcher_path" == /opt/microsoft/msedge/msedge ]]; then
      printf '%s\n' "$launcher_path"
      return 0
    fi
  done
  return 1
}

chrome_binary="$(find_chrome_binary || true)"
edge_binary="$(find_edge_binary || true)"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
native_manifest="$script_dir/../config/cua-native-capabilities.yaml"
browser_manifest="$script_dir/../config/cua-browser-capabilities.yaml"
if ! command -v sha256sum >/dev/null 2>&1 || [[ ! -f "$native_manifest" || ! -f "$browser_manifest" ]]; then
  echo "Cua acceptance requires sha256sum and both checked-in capability manifests." >&2
  exit 2
fi
native_manifest_digest="$(sha256sum "$native_manifest" | awk '{print $1}')"
browser_manifest_digest="$(sha256sum "$browser_manifest" | awk '{print $1}')"
echo "Cua capability manifests:"
echo "  native:  $native_manifest_digest"
echo "  browser: $browser_manifest_digest"
echo "Cua browser product availability (installed executable and manifest target):"
if [[ -n "$chrome_binary" ]]; then
  echo "  Chrome: available ($chrome_binary)"
else
  echo "  Chrome: unavailable (manifest target /opt/google/chrome/chrome is not installed)"
fi
if [[ -n "$edge_binary" ]]; then
  echo "  Edge: available ($edge_binary)"
else
  echo "  Edge: unavailable (manifest target /opt/microsoft/msedge/msedge is not installed)"
fi

selected_product=""
selected_binary=""
case "$browser_product" in
  chrome) selected_product=chrome; selected_binary="$chrome_binary" ;;
  edge) selected_product=edge; selected_binary="$edge_binary" ;;
  auto)
    if [[ -n "$chrome_binary" ]]; then
      selected_product=chrome
      selected_binary="$chrome_binary"
    elif [[ -n "$edge_binary" ]]; then
      selected_product=edge
      selected_binary="$edge_binary"
    fi
    ;;
esac
if [[ "$browser_product" != auto && -z "$selected_binary" ]]; then
  echo "Requested browser product '$browser_product' is unavailable; no fixture was started." >&2
  exit 2
fi
if [[ "$fixture" == true && -z "$selected_binary" ]]; then
  echo "The --fixture option requires an installed supported Chrome or Edge product; none is available." >&2
  exit 2
fi
if [[ "$mode" == acceptance && -z "$selected_binary" ]]; then
  echo "Deterministic browser acceptance is unavailable: neither manifest-listed Chrome nor Edge is installed." >&2
  exit 2
fi
if [[ "$fixture" == false && "$browser_product" != auto ]]; then
  echo "Explicit browser product selection is supported only for --fixture." >&2
  echo "Cua isolated browser preparation owns product selection and Lina cannot override it with an executable path." >&2
  exit 2
fi

# CUA's Linux accessibility tree is session-scoped. Keep the fixture and Lina
# in one short-lived bus instead of starting the browser on the user's unrelated
# desktop bus and hoping the driver can discover it later. The child is a real
# script rather than `bash -s` with a heredoc: a heredoc would consume stdin and
# make the interactive TUI see EOF immediately.

# pnpm is provided by Corepack on the development host. Copy only its package
# manager cache into the private launcher state, then point Corepack at that
# copy. This keeps an interactive run reproducible without allowing the child
# to write to the contributor's normal HOME or XDG cache.
source_corepack_home="${COREPACK_HOME:-}"
if [[ -z "$source_corepack_home" ]]; then
  source_corepack_home="${XDG_CACHE_HOME:-${HOME}/.cache}/node/corepack"
fi

# Set the isolated desktop environment before dbus-run-session starts. D-Bus
# service activation inherits the bus launcher environment, not later changes
# made by the child script; doing this here prevents Tracker and other desktop
# services from resolving the real user's home directories.
isolated_home="${runtime_dir}/home"
isolated_runtime="${runtime_dir}/runtime"
export HOME="$isolated_home"
export XDG_CONFIG_HOME="${isolated_home}/.config"
export XDG_CACHE_HOME="${isolated_home}/.cache"
export XDG_DATA_HOME="${isolated_home}/.local/share"
export XDG_STATE_HOME="${isolated_home}/.local/state"
export XDG_RUNTIME_DIR="$isolated_runtime"
# Do not let a host D-Bus activation context leak into the disposable session.
# `dbus-run-session` provides the authoritative session bus address; retaining
# DBUS_STARTER_ADDRESS can make GTK/AT-SPI clients connect to the host starter
# bus and fail with an InvalidGUID before Cua can walk the application tree.
unset DBUS_STARTER_ADDRESS DBUS_STARTER_BUS_TYPE
unset GNOME_KEYRING_CONTROL SSH_AUTH_SOCK GPG_AGENT_INFO GNUPGHOME
mkdir -m 700 -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$XDG_RUNTIME_DIR"
isolated_corepack_home="$XDG_CACHE_HOME/node/corepack"
mkdir -m 700 -p "$isolated_corepack_home"
if [[ -d "$source_corepack_home" && "$(realpath -m -- "$source_corepack_home")" != "$(realpath -m -- "$isolated_corepack_home")" ]]; then
  cp -a -- "$source_corepack_home"/. "$isolated_corepack_home"/
fi
export COREPACK_HOME="$isolated_corepack_home"

acceptance_pid=""
native_fixture_pid=""
terminate_isolated_processes() {
  local pass proc_dir pid entry isolated=false
  for pass in 1 2; do
    for proc_dir in /proc/[0-9]*; do
      [[ -d "$proc_dir" ]] || continue
      pid="${proc_dir##*/}"
      [[ "$pid" == "$$" ]] && continue
      isolated=false
      if [[ -r "$proc_dir/environ" ]]; then
        while IFS= read -r -d '' entry; do
          if [[ "$entry" == "LINA_CUA_RUNTIME_DIR=$runtime_dir" || "$entry" == "XDG_RUNTIME_DIR=$isolated_runtime" ]]; then
            isolated=true
            break
          fi
        done <"$proc_dir/environ" 2>/dev/null || true
      fi
      if [[ "$isolated" == true ]]; then
        kill -TERM "$pid" 2>/dev/null || true
      fi
    done
    [[ "$pass" -eq 2 ]] || sleep 0.25
  done
  for proc_dir in /proc/[0-9]*; do
    [[ -d "$proc_dir" ]] || continue
    pid="${proc_dir##*/}"
    [[ "$pid" == "$$" ]] && continue
    isolated=false
    if [[ -r "$proc_dir/environ" ]]; then
      while IFS= read -r -d '' entry; do
        if [[ "$entry" == "LINA_CUA_RUNTIME_DIR=$runtime_dir" || "$entry" == "XDG_RUNTIME_DIR=$isolated_runtime" ]]; then
          isolated=true
          break
        fi
      done <"$proc_dir/environ" 2>/dev/null || true
    fi
    if [[ "$isolated" == true ]]; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
}
cleanup_acceptance() {
  local status=$?
  if [[ -n "$acceptance_pid" ]] && kill -0 "$acceptance_pid" 2>/dev/null; then
    kill "$acceptance_pid" 2>/dev/null || true
    wait "$acceptance_pid" 2>/dev/null || true
  fi
  if [[ -n "$native_fixture_pid" ]] && kill -0 "$native_fixture_pid" 2>/dev/null; then
    kill "$native_fixture_pid" 2>/dev/null || true
    wait "$native_fixture_pid" 2>/dev/null || true
  fi
  terminate_isolated_processes 2>/dev/null || true
  exit "$status"
}
trap cleanup_acceptance EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

unset LINA_CUA_ACCEPTANCE_URL LINA_CUA_FIXTURE_URL
if [[ "$fixture" == true || "$mode" == acceptance ]]; then
  if ! command -v python3 >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
    echo "Cua fixture acceptance requires python3 and curl for its private HTTP service and readiness check." >&2
    exit 2
  fi
  acceptance_host="${LINA_CUA_ACCEPTANCE_HOST:-127.0.0.1}"
  acceptance_port="${LINA_CUA_ACCEPTANCE_PORT:-4173}"
  if [[ ! "$acceptance_host" =~ ^[A-Za-z0-9.-]+$ || ! "$acceptance_port" =~ ^[0-9]+$ || "$acceptance_port" -lt 1 || "$acceptance_port" -gt 65535 ]]; then
    echo "LINA_CUA_ACCEPTANCE_HOST and LINA_CUA_ACCEPTANCE_PORT must identify a valid local HTTP endpoint." >&2
    exit 2
  fi
  if [[ "$acceptance_host" != 127.0.0.1 ]]; then
    echo "The deterministic Cua harness must bind to 127.0.0.1; selecting another host could expose the fixture beyond this machine." >&2
    exit 2
  fi
  acceptance_url="http://${acceptance_host}:${acceptance_port}"
  if [[ "$mode" == acceptance ]]; then
    read -r -d '' acceptance_server <<'PY' || true
import html
import hashlib
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlsplit

HOST = sys.argv[1]
PORT = int(sys.argv[2])

def page(title, body):
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>body{{font-family:system-ui,sans-serif;margin:3rem;max-width:52rem;color:#172033}}main{{border:2px solid #6d28d9;border-radius:1rem;padding:2rem}}button,input{{font:inherit;padding:.7rem .9rem;margin:.4rem .2rem .4rem 0}}button{{background:#6d28d9;color:#fff;border:0;border-radius:.5rem}}.result{{color:#087f23;font-weight:700;min-height:1.5rem}}</style></head>
<body><main>{body}</main></body></html>'''.encode('utf-8')

class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, _format, *_args):
        return

    def respond(self, status, body, content_type='text/html; charset=utf-8'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, location):
        self.send_response(303)
        self.send_header('Location', location)
        self.send_header('Content-Length', '0')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()

    def get_body(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            return None
        if length < 0 or length > 2_000_000:
            return None
        return self.rfile.read(length)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path in ('/', '/index.html'):
            self.respond(200, page('Lina CUA acceptance', '''
<h1>Lina CUA acceptance</h1>
<p>This local page is deterministic and disposable. It makes no network requests.</p>
<label for="safe-text">Safe text field</label><br>
<input id="safe-text" aria-label="Safe text field" placeholder="Type non-secret text">
<button id="details" type="button" aria-pressed="false">Open details</button>
<button id="reveal" type="button">Reveal safe result</button>
<p id="details-state" aria-live="polite" hidden>Details are open.</p>
<p id="result" class="result" aria-live="polite"></p>
<p><a href="/contact">Open contact acceptance</a> · <a href="/files">Open file acceptance</a></p>
<script>
document.getElementById('details').addEventListener('click',()=>{document.getElementById('details').setAttribute('aria-pressed','true');document.getElementById('details-state').hidden=false;});
document.getElementById('reveal').addEventListener('click',()=>{document.getElementById('result').textContent='Computer success: safe result revealed.';});
</script>'''))
            return
        if path == '/tabs':
            self.respond(200, page('Browser tab acceptance', '''
<h1>First tab</h1>
<p><a href="/tabs/second" target="_blank" rel="noopener">Open second tab</a></p>'''))
            return
        if path == '/tabs/second':
            self.respond(200, page('Second tab acceptance', '<h1>Second tab</h1>'))
            return
        if path == '/form-controls':
            self.respond(200, page('Form controls acceptance', '''
<h1>Form controls acceptance</h1>
<form id="form-controls">
<label for="first-name">First name</label><br>
<input id="first-name" name="first_name" autocomplete="off"><br>
<label><input id="agree-terms" name="agree_terms" type="checkbox"> I agree to the terms</label><br>
<label for="company-type">Company type</label><br>
<button id="company-type" type="button" role="combobox" aria-label="Company type" aria-haspopup="listbox" aria-expanded="false" aria-controls="company-options">Choose a type</button>
<div id="company-options" role="listbox" aria-label="Company type options" hidden>
<button type="button" role="option" aria-selected="false" data-value="product">Product</button>
<button type="button" role="option" aria-selected="false" data-value="services">Services</button>
</div><input id="company-type-value" name="company_type" type="hidden"><br>
<label for="industry">Industry (native select capability probe)</label><br>
<select id="industry" name="industry">
<option value="">Choose an industry</option><option value="technology">Technology</option><option value="design">Design</option>
</select><br>
<label for="preferred-date">Preferred date</label><br>
<input id="preferred-date" name="preferred_date" type="date"><br>
<button id="form-submit" type="submit">Submit form</button>
</form>
<p id="submission-state" class="result" aria-live="polite">Not submitted</p>
<script>
document.getElementById('form-controls').addEventListener('submit', event => {
  event.preventDefault();
  document.getElementById('submission-state').textContent = 'Submitted';
});
const company = document.getElementById('company-type');
const options = document.getElementById('company-options');
company.addEventListener('click', () => {
  const expanded = company.getAttribute('aria-expanded') !== 'true';
  company.setAttribute('aria-expanded', String(expanded));
  options.hidden = !expanded;
});
options.querySelectorAll('[role="option"]').forEach(option => option.addEventListener('click', () => {
  const value = option.dataset.value || '';
  company.textContent = option.textContent || '';
  document.getElementById('company-type-value').value = value;
  options.querySelectorAll('[role="option"]').forEach(item => item.setAttribute('aria-selected', String(item === option)));
  company.setAttribute('aria-expanded', 'false');
  options.hidden = true;
}));
</script>'''))
            return
        if path == '/contact':
            self.respond(200, page('Contact acceptance', '''
<h1>Contact acceptance</h1>
<form method="post" action="/contact"><label for="message">Message</label><br>
<input id="message" name="message" aria-label="Message" autocomplete="off">
<button type="submit">Submit message</button></form>'''))
            return
        if path == '/contact/result':
            query = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
            submission_id = query.get('submission_id', [''])[0]
            message = query.get('message', [''])[0]
            if not re.fullmatch(r'[0-9a-f]{16}', submission_id) or not message:
                self.respond(404, page('Not found', '<h1>Not found</h1>'))
                return
            safe = html.escape(message)
            self.respond(200, page('Submission accepted', f'<h1>Submission accepted</h1><p id="submission-result" class="result">Submission accepted: {safe} (submission {submission_id})</p>'))
            return
        if path == '/files':
            self.respond(200, page('File acceptance', '''
<h1>File acceptance</h1>
<form id="file-form" method="post" action="/files" enctype="multipart/form-data"><label for="file">Acceptance file</label><br>
<input id="file" name="file" type="file" aria-label="Acceptance file">
<button id="file-submit" type="submit">Upload acceptance file</button></form>
<script>
// The Linux acceptance lane explicitly uses Cua's dom_event route when
// trusted background input is unavailable. Make the fixture's submit effect
// observable for that route while keeping the server-side result authoritative.
const fileForm = document.getElementById('file-form');
document.getElementById('file-submit').addEventListener('click', (event) => {
  event.preventDefault();
  HTMLFormElement.prototype.requestSubmit.call(fileForm);
});
</script>'''))
            return
        if path == '/files/result':
            query = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
            filiname = query.get('filiname', [''])[0]
            byte_count = query.get('bytes', [''])[0]
            content_hash = query.get('sha256', [''])[0]
            if not filiname or not re.fullmatch(r'[0-9]+', byte_count) or not re.fullmatch(r'[0-9a-f]{64}', content_hash):
                self.respond(404, page('Not found', '<h1>Not found</h1>'))
                return
            safe_filiname = html.escape(filiname)
            self.respond(200, page('Upload accepted', f'<h1>Upload accepted</h1><p id="upload-result" class="result">Upload accepted: {safe_filiname} ({byte_count} bytes, sha256 {content_hash})</p>'))
            return
        self.respond(404, page('Not found', '<h1>Not found</h1>'))

    def do_POST(self):
        path = urlsplit(self.path).path
        body = self.get_body()
        if body is None:
            self.respond(413, page('Request too large', '<h1>Request too large</h1>'))
            return
        if path == '/contact':
            fields = parse_qs(body.decode('utf-8', 'replace'), keep_blank_values=True)
            message = fields.get('message', [''])[0].strip()
            if not message:
                self.respond(400, page('Message required', '<h1>Message required</h1>'))
                return
            submission_id = hashlib.sha256(message.encode('utf-8')).hexdigest()[:16]
            self.redirect('/contact/result?submission_id=' + submission_id + '&message=' + quote(message, safe=''))
            return
        if path == '/files':
            content_type = self.headers.get('Content-Type', '')
            boundary_match = re.search(r'boundary=(?:"([^"]+)"|([^;]+))', content_type)
            filiname_match = re.search(br'filiname="([^"]*)"', body)
            if not boundary_match or not filiname_match:
                self.respond(400, page('File required', '<h1>File required</h1>'))
                return
            boundary = (boundary_match.group(1) or boundary_match.group(2)).encode()
            parts = body.split(b'--' + boundary)
            payload_size = 0
            payload_hash = ''
            for part in parts:
                marker = part.find(b'\r\n\r\n')
                if marker >= 0 and b'filiname=' in part[:marker]:
                    payload = part[marker + 4:]
                    # Remove only the CRLF separating this part from the
                    # multipart boundary; the uploaded payload itself may
                    # legitimately end in CR/LF bytes.
                    if payload.endswith(b'\r\n'):
                        payload = payload[:-2]
                    payload_size = len(payload)
                    payload_hash = hashlib.sha256(payload).hexdigest()
                    break
            filiname = filiname_match.group(1).decode('utf-8', 'replace')
            if not payload_hash:
                self.respond(400, page('File required', '<h1>File required</h1>'))
                return
            self.redirect('/files/result?filiname=' + quote(filiname, safe='') + '&bytes=' + str(payload_size) + '&sha256=' + payload_hash)
            return
        self.respond(404, page('Not found', '<h1>Not found</h1>'))

server = ThreadingHTTPServer((HOST, PORT), Handler)
server.daemon_threads = True
server.serve_forever()
PY
    python3 -c "$acceptance_server" "$acceptance_host" "$acceptance_port" >"$runtime_dir/acceptance-service.log" 2>&1 &
    acceptance_pid=$!
    acceptance_path="/"
    export LINA_CUA_ACCEPTANCE_URL="$acceptance_url"
    echo "Deterministic Cua acceptance service: $acceptance_url"
    echo "  routes: /, /contact, /files, /form-controls, /tabs"
  else
    native_fixture="$(cd "$script_dir/../src/computer/fixtures" && pwd)/native.html"
    if [[ ! -f "$native_fixture" ]]; then
      echo "The checked-in native Cua fixture is missing: $native_fixture" >&2
      exit 2
    fi
    python3 -m http.server "$acceptance_port" --bind "$acceptance_host" --directory "$(dirname "$native_fixture")" >"$runtime_dir/native-fixture-service.log" 2>&1 &
    native_fixture_pid=$!
    acceptance_path="/native.html"
    echo "Native Cua fixture service: $acceptance_url$acceptance_path"
  fi
  acceptance_ready=false
  for _ in {1..50}; do
    if curl --silent --show-error --fail --max-time 1 "$acceptance_url$acceptance_path" >/dev/null 2>&1; then
      acceptance_ready=true
      break
    fi
    service_pid="$acceptance_pid"
    if [[ -z "$service_pid" ]]; then service_pid="$native_fixture_pid"; fi
    if ! kill -0 "$service_pid" 2>/dev/null; then
      echo "The private HTTP fixture service exited before $acceptance_url$acceptance_path became ready." >&2
      sed -n '1,120p' "$runtime_dir/acceptance-service.log" "$runtime_dir/native-fixture-service.log" 2>/dev/null >&2 || true
      exit 1
    fi
    sleep 0.1
  done
  if [[ "$acceptance_ready" != true ]]; then
    echo "Timed out waiting for the private HTTP fixture at $acceptance_url$acceptance_path." >&2
    sed -n '1,120p' "$runtime_dir/acceptance-service.log" "$runtime_dir/native-fixture-service.log" 2>/dev/null >&2 || true
    exit 1
  fi
  if [[ "$mode" == acceptance ]]; then
    export LINA_CUA_FIXTURE_URL="$acceptance_url/"
  else
    export LINA_CUA_FIXTURE_URL="$acceptance_url$acceptance_path"
  fi
  echo "  service state: private launcher runtime"
else
  unset LINA_CUA_ACCEPTANCE_URL LINA_CUA_FIXTURE_URL
fi

if [[ "$fixture" == true && -n "$selected_binary" ]]; then
  export LINA_CUA_BROWSER_PRODUCT="$selected_product"
  export LINA_BROWSER_EXECUTABLE_PATH="$selected_binary"
  browser_bin="$runtime_dir/bin"
  mkdir -m 700 -p "$browser_bin"
  browser_launcher="$browser_bin/google-chrome"
  # The existing child harness invokes google-chrome. Point that stable test
  # entrypoint at the selected Cua-attested binary so Edge acceptance does not
  # silently become a Chrome run. The shim also gives the browser only display,
  # D-Bus, locale, and private XDG state; model credentials remain in Lina's
  # process and are not inherited by the fixture browser.
  {
    printf '%s\n' '#!/usr/bin/env bash' 'set -Eeuo pipefail' 'exec env -i \'
    printf '%s\n' \
      '  HOME="${HOME-}" \' \
      '  XDG_CONFIG_HOME="${XDG_CONFIG_HOME-}" \' \
      '  XDG_CACHE_HOME="${XDG_CACHE_HOME-}" \' \
      '  XDG_DATA_HOME="${XDG_DATA_HOME-}" \' \
      '  XDG_STATE_HOME="${XDG_STATE_HOME-}" \' \
      '  XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR-}" \' \
      '  DISPLAY="${DISPLAY-}" \' \
      '  XAUTHORITY="${XAUTHORITY-}" \' \
      '  DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS-}" \' \
      '  AT_SPI_BUS_ADDRESS="${AT_SPI_BUS_ADDRESS-}" \' \
      '  XDG_SESSION_BUS_ADDRESS="${XDG_SESSION_BUS_ADDRESS-}" \' \
      '  XDG_SESSION_TYPE="${XDG_SESSION_TYPE-}" \' \
      '  GDK_BACKEND="${GDK_BACKEND-}" \' \
      '  QT_QPA_PLATFORM="${QT_QPA_PLATFORM-}" \' \
      '  LIBGL_ALWAYS_SOFTWARE="${LIBGL_ALWAYS_SOFTWARE-}" \' \
      '  LANG="${LANG-}" \' \
      '  LC_ALL="${LC_ALL-}" \' \
      '  PATH="/usr/bin:/bin" \'
    printf '  -- %q "$@"\n' "$selected_binary"
  } >"$browser_launcher"
  chmod 700 "$browser_launcher"
  export PATH="$browser_bin:$PATH"
  if [[ "$fixture" == true ]]; then
    echo "Cua fixture browser: $selected_product ($selected_binary)"
  fi
elif [[ "$fixture" == false ]]; then
  unset LINA_CUA_BROWSER_PRODUCT LINA_BROWSER_EXECUTABLE_PATH
  echo "No pre-opened browser fixture requested; Cua isolated preparation owns supported-product selection and attestation."
fi

dbus-run-session -- bash "$script_dir/run-cua-chat-session-child.sh" "$fixture" "$window_manager" "$@"
