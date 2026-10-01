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
For a navigation-only request, the assistant should confirm the observed destination
briefly and wait for the next instruction. The snapshot remains available to the model
for follow-up actions; its page content is not a request for a page summary.
Anesu adds `observedAt` in UTC when each snapshot returns and includes it in the tool
summary. It is the time Anesu observed that page, not a timestamp for the site's
price or publication. A sparse snapshot is not evidence that a site requires login or
blocks automation; report what was visible instead of guessing the cause.
When Anesu's output limit trims a dense snapshot, the summary counts only the
content and refs actually delivered to the model and labels the result partial.
Use `browser_snapshot` with `query` or `scopeRef` to inspect the omitted part
before drawing a conclusion from that page.
When a TypeSafe API key is configured, the conversation model may call
`browser_jev_step` for one page-local subgoal. Anesu first takes a fresh Cua
snapshot. Jev chooses one code-issued, action-compatible candidate ID or
abstains; it cannot navigate, supply text, choose a new origin, or declare the
user's whole task complete. The optional `text` or `value` comes from the
conversation model and passes through the same exact-action approval as ordinary
browser tools. Personal or trip details must come from the user; the model may
compose general text the task requests or choose an option visible in the current
page state. If Jev chooses an editable or selectable control but the caller
omitted its value, the tool returns `needs-value` with no input sent. The
conversation model can call it again with the task-authorized value.
Anesu executes at most one Cua action and returns fresh page
state. A Cua `unverifiable` click stays an unknown input outcome even when the
later page state shows progress. Without the key, Anesu does not expose the
Jev tool. The conversation model still chooses when to use it and retains the
wider task.
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
result. After an `unverifiable` dispatch, Anesu makes one bounded read-only
snapshot and includes it in the same tool result if the tab remains on the
approved origin. The action remains ambiguous and non-replayable; the new
snapshot is evidence for the model's next choice, not proof of the click.
If that read fails or the tab changes origin, Anesu returns the ambiguous
outcome without exposing a new-origin snapshot. Other ambiguous failures still
require an explicit fresh snapshot.

Listing tabs also refreshes Cua's exact browser binding and can invalidate element refs
from the previous snapshot. After `browser_tabs`, take a fresh `browser_snapshot` for the
selected opaque tab ID before acting. Cua's current typed interface does not provide a
bring-to-front operation; Anesu does not imply or emulate one.

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
current location to the model, after public-HTTPS validation and URL redaction. If the
redirected URL contains a session-like or other secret query value, Anesu keeps the
exact address internally and returns a one-use `handoffId`. `browser_open` accepts that
ID only in the same approved task and Cua session; the handoff result does not include
the query value.
In the
pinned Cua runtime the live-origin scope failure is surfaced as
`authorization_host_failed` with a specific out-of-manifest message; Anesu recognizes only
that exact failure (and the direct typed scope refusal), not unrelated host errors. It does
not automatically navigate again or replay the preceding action. The model may choose
`browser_open` only when a fresh navigation to that observed address is appropriate; local
and private destinations are not offered for replay. The TUI acceptance has verified
one public redirect (`www.ubuntu.com` to `ubuntu.com`) through that model-selected handoff.
The one-use private-query handoff has a focused adapter test but awaits a real TUI recheck.
URL-less search opens the configured provider in a task-scoped Cua session.

Cua can mint new opaque tab IDs when it refreshes an exact window binding. `browser_tabs`
therefore reports the active tab only when that binding identifies it; origin recovery uses
that fresh active-tab identity rather than assuming an earlier ID survived or choosing the
first tab in a list.

The current public Cua TypeScript SDK does not expose the trusted MCP-host approval
evidence required for browser downloads. Downloads are therefore not registered as a
model-facing tool and cannot reserve or create an artifact. The installed Cua `0.28.2`
API can expose native `<select>` options as semantic refs, but a synthetic click does
not select one and trusted click refuses standalone Linux Chromium. Anesu adds
`browser_select` to the model's tool list only when the installed Cua library
declares `browser_select_option`. That tool requires a current ref that declares
`select` and maps an exact visible option label to Cua's matching operation. The
installed `0.28.2` package does not declare it, so native selection stays
unavailable while ordinary browser tasks continue. At startup Anesu asks the
installed Cua library for its tool inventory before deriving the immutable
capability manifest. It admits `browser_select_option` only when that library
declares it; putting an unknown tool in Cua's manifest makes the entire browser
driver refuse to start. Upstream Cua `0.28.3` is available, but its release
notes and browser tool contract still do not include native selection; moving
Anesu to that version alone would not enable the operation.
The published `0.28.2` package has been rechecked through the real TUI after
this correction and can open the Kasitek form. On the `dom_event` route, Anesu
refuses a synthetic click on a combobox
that declares `select` before approval or input. When the installed runtime lacks
the selection operation, the model receives that explicit limitation and does
not see a `browser_select` tool that can only refuse. A local Cua build proved
the typed selection route in the disposable
Chrome TUI on 2026-09-25: an ordinary chat request selected Kasitek's Company
type and a fresh snapshot showed the chosen value. This is validation of the
local build, not a claim that published `0.28.2` has the operation or can
complete the form. Anesu also decodes Chromium AX `checked` and
other supported boolean states when Cua reports them as the exact strings
`"true"` or `"false"`; it leaves other state values unknown. A later local-build
TUI run confirmed fake Name, Email, Company type, and consent values on the
Kasitek form without submitting it. The same local build also passed a
different real-TUI form at Selenium's public web-form page: the model set
text, a checkbox, a date field, and a native select, then reported their
values after a fresh snapshot without submitting. An installable, pinned Cua
build remains open; published `0.28.2` does not provide this native-select
path. One published-package run filled a supplied name and correctly asked
for Email and consent, but incorrectly called the country-code selector inside
an optional phone field required. After a generic tool-instruction correction,
a fresh TUI run asked for Email and consent, marked Country optional, and did
not submit. This is one acceptance example, not a guarantee across all forms.
Anesu's `browser_press` currently
supports only Enter, delivered through Cua `browser_type` as a newline on a current editable
ref; Cua does not expose a typed route for arrow keys or keyboard selection of a native
select. Do not claim selection from an exposed option ref alone or guess a sequence of keys.

Common form controls were verified through the real TUI and typed Cua browser API on
2026-09-24: a text field, checkbox, custom accessible dropdown, and a native date input.
For a date input, the model may choose the current `date` ref and Anesu sends Cua's
documented `keystrokes` mode. When the user supplied an ISO date and the fresh snapshot
exposes one unambiguous Day/Month/Year spinbutton group, Anesu translates it to that
observed order before showing the exact text for approval. The live Ubuntu fixture
accepted `12/10/2026` and a fresh snapshot reported the canonical value `2026-10-12`.
Prefer typing directly into the date ref before opening its picker: typing after opening
the picker did not change the field in a live attempt. A highlighted calendar day is not
evidence of the field's stored value. Native date-picker month navigation and native
`<select>` activation remain unavailable through the current Ubuntu input route. Multiple
date fields in one snapshot and localized date-part labels have not been verified.

Screenshots remain unavailable through this typed slice. The upload tool is implemented
for exact regular workspace files with size and identity checks. Name the workspace path
in the request (quote it if the path contains spaces); Anesu resolves it inside the
workspace and asks for approval of that path and size. The model should use the observed
file input's `upload` action directly, then take a fresh snapshot. The tool result
identifies page verification as pending; a Cua dispatch acknowledgement alone is not
proof that the file appears in the page.

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
- On 2026-09-24, a disposable Ubuntu/GNOME X11 TUI run on the checked-in `/form-controls`
  fixture filled First name with `Ada`, checked the terms box, and selected `Product` in
  the custom accessible Company type dropdown. A later fresh snapshot confirmed those
  values, left Industry at `Choose an industry`, and showed `Not submitted`. An incorrect
  proposed click on the native `Technology` option was denied before dispatch; the model
  then selected the requested custom `Product` option.
- On 2026-09-24, a combined natural-language fill-only TUI request on the same fixture
  set First name to `Amina`, checked the terms box, selected `Product`, and set Preferred
  date to `2026-10-12`. The model initially proposed opening the date picker; after that
  action was denied, it used the current date ref and Cua `keystrokes` with the observed
  Day/Month/Year order. A fresh snapshot confirmed all requested values; a separate
  read-only turn reconfirmed them, left Industry unchanged, and confirmed the form was not
  submitted. This proves the tested fixture/control combination, not every site's widget.
- The same Cua 0.28.2 runtime exposed `Technology` and `Design` as refs after opening the
  fixture's native `<select>`, but a `dom_event` click did not change the selected state in
  the next snapshot. In a separate date attempt, Cua opened the native date picker but
  refused its `Show next month` action; typing while that picker was open also did not
  change the field. Direct date-ref typing is now separately verified. Cua's [browser
  input guide](https://github.com/trycua/cua/blob/main/docs/content/docs/how-to-guides/driver/drive-a-web-page.mdx)
  documents `dom_event` as synthetic and says trusted clicks refuse standalone Linux
  Chromium. Native select activation and date-picker navigation remain unsupported on this
  route. This does not establish a limitation for Windows or another Cua input mode.
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
  outcome as ambiguous while refusing the out-of-origin page read. A fresh exact bind
  exposed IANA, and the model opened the public destination in a new exact-origin session
  and read its page title. The turn completed from that fresh destination evidence; the
  durable click record remained ambiguous and was not replayed. This verifies that bounded
  recovery path, not every cross-origin interaction.
- A real follow-up after 11m02.754s reused the same managed browser session and read
  `Example Domain` from a fresh snapshot without starting or navigating another session.
- A real multi-tab attempt on `the-internet.herokuapp.com/windows` was inconclusive: Cua
  listed one tab and the model exhausted its turn limit. The attempt exposed that tab
  listing refreshes the exact binding and invalidates old element refs. Anesu now clears
  those refs and requires a fresh snapshot before action. This does not establish live
  multi-tab support or a definitive Cua limitation.
- A second live attempt used the deterministic local `/tabs` page and its observed
  `target="_blank"` link. Under Anesu's Linux-default Cua `dom_event` route, Cua returned
  `unverifiable`, fresh state showed only the original tab, and Anesu blocked the model's
  repeated click. Cua 0.28.2 documents `dom_event` as synthetic (some pages may ignore it
  because `isTrusted` is false) and documents that trusted CDP clicks on standalone Linux
  Chromium refuse rather than activate the window. The run did not return an explicit
  popup-block reason, so that explanation is likely, not proven. Live multi-tab opening on
  this Ubuntu route remains unsupported/unverified until Cua provides a background-safe
  user-gesture path or a separately approved route; no Playwright, page-script, or desktop
  focus workaround is used.
- A third disposable TUI run explicitly selected Cua's `trusted` click route for the same
  link. Cua refused before dispatch (`browser_action_refused`); a fresh tab listing still
  showed only the original tab. The installed `@trycua/cua-driver` 0.28.2 contract and the
  inspected newer local Cua source do not register a browser tab-creation or activation
  operation. This establishes a capability gap for the current standalone Ubuntu/Cua route,
  not a universal limitation of Cua on every platform. Existing opaque IDs for tabs Cua has
  already returned remain selectable through the typed tool path; creating a second tab is
  not live-proven here. The synthetic route's exact popup-block reason remains unknown.
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

These runs establish model-directed public-site reading and search, same-origin interaction
and delayed follow-up, one public redirect handoff, one cross-origin link recovery with an
honestly ambiguous click record, approved local upload, and clean new-site task sessions.
They do not establish live multi-tab selection, downloads, or support for every
website/browser interaction.
