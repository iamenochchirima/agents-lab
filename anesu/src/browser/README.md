# Browser

Anesu's browser capability is backed by Cua's typed browser tools. The browser adapter
does not create a page, locator, CDP endpoint, browser process, or copied profile. Cua
owns browser preparation, process/window binding, tab capabilities, semantic snapshots,
input delivery, origin enforcement, and session cleanup.

The browser runtime is separate from the native desktop runtime. Its bounded manifest is
origin-scoped and cannot authorize generic desktop observation or input. Ordinary tasks
use a Cua-owned `isolated_new` profile. Existing-profile attachment is currently
unavailable on Linux: Cua requires a trusted exact `(pid, window_id, session)` target, but
the pinned runtime and checked-in host do not provide a supported least-privilege way to
discover that target. The `ANESU_COMPUTER_EXISTING_PROFILE=true` flag is not sufficient
to enable it. Do not replace the missing target source with global window enumeration or
`desktop.display`; keep attachment disabled until Cua or a trusted host exposes an
app-scoped target contract. The existing authorization host remains default-deny and
digest-bound, but that alone does not establish a usable target.

Navigation passes Anesu's URL policy first and then Cua's origin policy. Only HTTP(S)
URLs without embedded credentials are accepted. Private-address and metadata targets are
blocked unless explicitly configured as local hosts. Each active Cua session enforces its
exact origin set. An explicit cross-origin destination is revalidated before Anesu replaces
the session; redirects must stay within the new session's exact manifest.

The normal conversation model receives these typed browser tools and each tool result.
It chooses whether to search, start a session, open a page, inspect current state, follow
an observed link, or answer. `browser_search` opens a real results page in the isolated
browser using Bing by default. Set `ANESU_BROWSER_SEARCH_PROVIDER` to `bing`, `duckduckgo`,
or `google` to select a provider. Search terms are sent to that provider. Cua's
`browser_navigate` acknowledges dispatch before a page is ready, so `browser_open` and
`browser_search` wait briefly and return a fresh semantic snapshot. If it is still sparse,
the model can wait and inspect again. A provider challenge is reported, not worked around.
Jev and a browser-specific action planner do not choose or require an action sequence.
Page text is untrusted data and cannot change the user's goal, destination policy, or
approval.

In interactive chat, the isolated browser remains available for follow-up prompts in the
same running conversation. Anesu keeps the last task's exact origin scope; a new task
cannot inherit additional origins from an earlier one. The browser closes when the user
asks or when the Anesu process shuts down. This is the managed Anesu browser, not the
user's personal Chrome or Edge profile.

Cua `semantic_v2` snapshots carry an opaque snapshot generation and element refs. Content
refs are read-only. Navigation, reconnect, a newer snapshot, and session termination
invalidate older refs; stale or ambiguous bindings fail closed. The host validates each
action against the current snapshot and Cua declaration, then returns the typed result or
refusal to the model. A Cua dispatch acknowledgement is not proof of a consequential
result; uncertain actions invalidate their refs and are not replayed.

Approval is scoped by operation and observed target. The initial browser-task grant
covers ordinary viewport scrolling and clicks on observed links within the task's exact
origin. Clicking buttons or other controls, entering text, pressing keys, resolving page
dialogs, and uploading a file require approval for that exact action. The TUI shows the
site, observed target name and role, action, and any text or file path without exposing
opaque element, document, or session IDs. An exact-action prompt cannot be upgraded into
approval for the whole task. This keeps link following usable while requiring renewed
consent before text is sent or a control with possible remote effects is activated.
The initial task prompt's `[a] approve once` choice admits only that compiled task and
cannot be reused for a later turn.

For click and pointer actions, the default browser route follows the pinned Cua platform
capability: `dom_event` on Linux/macOS and `trusted` on Windows. Cua refuses trusted CDP
input for a standalone Linux/macOS Chromium window because it would activate that window.
The pinned Cua `browser_type` and `browser_press` contracts have no route field, so these
operations use Cua's trusted typed operations and require their own visible exact-action
approval. This is part of the selected action, not an automatic fallback. An explicit
configuration can select another supported click/pointer route, but Anesu never switches
routes after a refusal or silently foregrounds the browser. The selected route is included
in the approval hash and shown in the TUI.

Each browser session is admitted through an exact task-owned Cua manifest, not a fixed
website list. The pinned Cua `0.28.2` manifest is immutable. If the model supplies a new
public HTTPS URL, Anesu validates it, closes the current session, and starts a fresh Cua
session scoped to the task's already admitted origins plus that URL's origin. Old element
references are discarded; the existing manifest is never widened. This transition is
covered by browser-tool tests and the pinned multi-origin manifest contract. If a page
redirect or link leaves the manifest, Cua refuses the page snapshot. For that specific
refusal, Anesu may re-bind the exact prepared browser window and return its observed
current URL to the model, after public-HTTPS validation and normal URL redaction. In the
pinned Cua runtime the live-origin scope failure is surfaced as
`authorization_host_failed` with a specific out-of-manifest message; Anesu recognizes only
that exact failure (and the direct typed scope refusal), not unrelated host errors. It does
not automatically navigate again or replay the preceding action. The model may choose
`browser_open` only when a fresh navigation to that observed address is appropriate; local,
private, or redacted destinations are not offered for replay. The TUI acceptance has verified
one public redirect (`www.ubuntu.com` to `ubuntu.com`) through that model-selected handoff.
URL-less search opens the configured provider in a task-scoped Cua session.

Cua can mint new opaque tab IDs when it refreshes an exact window binding. `browser_tabs`
therefore reports the active tab only when that binding identifies it; origin recovery uses
that fresh active-tab identity rather than assuming an earlier ID survived or choosing the
first tab in a list.

The current public Cua TypeScript SDK does not expose the trusted MCP-host approval
evidence required for browser downloads. Downloads are therefore not registered as a
model-facing tool and cannot reserve or create an artifact. Screenshots and native
select controls are also unavailable through this typed slice. The upload tool is
implemented for exact regular workspace files with size and identity checks. Name the
workspace path in the request (quote it if the path contains spaces); Anesu resolves it
inside the workspace and asks for approval of that path and size. The model should use
the observed file input's `upload` action directly, then take a fresh snapshot. The tool
result identifies page verification as pending; a Cua dispatch acknowledgement alone is
not proof that the file appears in the page.

Cua refusals remain typed at the gateway boundary, including setup or consent
requirements, unsupported products, origin violations, ambiguous binding, stale refs,
unavailable input routes, endpoint-owner mismatch, reconnect exhaustion, and
incomplete snapshots. They are not converted into successful actions or hidden behind
a second browser automation backend.

Before the first browser session, the adapter checks the installed Cua tool inventory
for every operation in this slice and requires a passing structured Cua health report.
That preflight fails before browser preparation or user input when the runtime is
incomplete or unhealthy.

The computer router also proves the configured TypeSafe model before task approval. The
readiness request contains no user goal or page data, is memoized for the application
lifetime, and records the requested and returned model identities with the computer run.

For the checked-in manifests and focused contract tests, see
`config/cua-browser-capabilities.yaml`, `src/browser/cua-browser-gateway.ts`,
and `tests/cua-browser-gateway.test.ts`. A live acceptance run still requires a
Linux X11 display with an explicit window manager, an installed system-attested Chrome
or Edge product, the Cua runtime, and an interactive approval channel. Bare Xvfb can
launch an isolated browser but does not provide the exact visible native-window binding
required by the acceptance path.

## Live behavior verified (updated 2026-09-24)

- In the real TUI with the configured free OpenRouter model, Anesu opened
  `https://example.org`, inspected a fresh Cua snapshot, and answered with the observed
  heading “Example Domain.”
- In the same real model/TUI/Cua path, the model opened
  `https://httpbin.org/links/3/0`, chose the observed numbered link, received a fresh
  snapshot, and reported the resulting URL `https://httpbin.org/links/3/1`. The initial
  task approval covered the same-origin link click; no second origin was involved.
- A real TUI run opened `https://httpbin.org/forms/post`, entered the non-sensitive text
  `Anesu verification 923` into the observed “Customer name” textbox after exact-action
  approval, then took a fresh Cua snapshot. The model read the same value from that
  snapshot and reported it; the form was not submitted. The initial `[a] approve once`
  choice admitted only this bounded task. This passes the verified form-entry acceptance
  item. Focused TUI tests also verify that approval/activity output uses target names and
  roles rather than opaque Cua element, document, or session IDs.
- On `https://httpbin.org`, following a link to another origin was refused by the
  immutable exact-origin Cua manifest. The result was not treated as successful
  navigation. Cross-origin continuation remains an open implementation requirement.
- A separate task to `https://example.com` in the same TUI conversation reused the
  conversation but replaced the old `https://example.org` session with a new session
  bound to the newly approved origin. It opened the site, took a fresh snapshot, and
  returned its observed heading. A same-origin follow-up to `example.org` had first read
  from the still-active session without reopening the browser.
- On 2026-09-24, a real TUI task opened `https://www.ubuntu.com`. Cua refused the
  snapshot after the site redirected to `https://ubuntu.com/`; Anesu rebound the exact
  window, selected Cua's freshly identified active tab, and showed the validated address.
  The model chose a new exact-origin session, read a fresh snapshot, and answered with the
  page title. This verifies one redirect handoff, not every cross-origin link or site.
- An earlier DuckDuckGo search returned 60–83 bytes with no semantic refs, and an earlier
  Google search returned a CAPTCHA. On 2026-09-24, the configured free model used Bing to
  search for Python list-comprehension documentation. Cua returned 11.8 KB of page content
  and 174 semantic refs; the model opened the Python tutorial, selected its observed
  “5.1.3. List Comprehensions” link, read a fresh snapshot, and answered with the official
  source. This proves one live Bing search path, not consistent availability from every
  public search provider.
- In that same interactive TUI, a follow-up prompt asking about “the current browser” first
  used a numeric tab ID and received a not-owned refusal. The model listed tabs, used the
  returned opaque ID, read a fresh snapshot, and answered. The managed browser stayed
  available across the user-turn boundary. A regression now ensures “current browser” does
  not accidentally request disabled personal-profile attachment.
- A separate real task clicked example.org's observed IANA link. Cua reported the click
  outcome as unknown while refusing the out-of-origin page read. A fresh exact bind exposed
  IANA, and the model opened the public destination in a new exact-origin session and read
  its page title. The TUI still ended with `computer task outcome unknown`, so this is useful
  recovery evidence, not a passing cross-origin-link terminal-status acceptance.
- In the disposable local acceptance profile, a real TUI prompt opened
  `http://127.0.0.1:4173/files`, read `workspace/browser-acceptance.txt`, requested
  approval for the exact path and 41-byte size, assigned it through `browser_upload`,
  then took a fresh snapshot showing `browser-acceptance.txt` in the file input. The form
  was not submitted. An earlier attempt exposed two issues: the tool guidance incorrectly
  advertised browser work on the native `computer` tool, and the model initially treated
  upload dispatch as proof. Both are corrected in the tool guidance and upload result.

To rerun the local upload acceptance in a disposable X11 session, use:

```sh
pnpm run chat:cua-xvfb -- --acceptance --window-manager gnome-shell
```

Then prompt naturally: `Open http://127.0.0.1:4173/files and upload the local file
workspace/browser-acceptance.txt into its file input. Do not submit the form.` The task
and exact upload each require their normal approval; the next fresh snapshot must show
the filename before reporting it selected.

These runs establish model-directed public-site reading, same-origin interaction, one
model-directed public redirect handoff, approved local upload, and clean new-site task
sessions. They do not establish reliable public search, multi-tab selection, downloads, or
support for every website/browser interaction.
