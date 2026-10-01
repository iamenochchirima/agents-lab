# Anesu computer environments

Computer environments are host adapters, not model tools. A strategy may select an
Anesu-owned action from a bounded observation, but only the environment adapter can
capture state or send native input.

## CUA Driver on Ubuntu

Anesu pins the in-process TypeScript SDK as `@trycua/cua-driver` in
`anesu/package.json`. The current adapter is `src/computer/cua-driver.ts`; it does
not invoke `cua-driver mcp`, spawn the CUA CLI, or pass arbitrary model-produced CUA
calls through.

The adapter currently provides the first native vertical slice:

- readiness requires Linux, an X11 `DISPLAY`, and the explicit
  `ANESU_COMPUTER_CUA_ISOLATED_DISPLAY=true` marker;
- a named CUA session is started and the CUA agent cursor is enabled with the
  built-in `cua.default` theme;
- the application retains one configured CUA runtime, while each native task uses
  the SDK's bounded `createTrustedSession` client with the same capability manifest.
  All task operations, including `list_windows` (whose typed input has no session
  field), go through that bound client. Anesu ends the named task session and closes
  its handle after the task; the shared runtime stays alive until application shutdown.
  The task-session ceiling is 30 minutes absolute and 5 minutes idle;
- observations are bounded and expose metadata rather than embedding screenshot
  bytes in the model transcript; the native TypeSafe path captures the exact
  authorized foreground-window state and uses its accessibility candidates. On Linux,
  CUA's screen-space AT-SPI bounds are converted using the reported window bounds and
  screenshot dimensions for semantic grounding.
  Desktop capture remains available as an explicit adapter scope.
  When CUA exposes it, the observation also carries the bounded agent-cursor position
  for inspection;
- when CUA exposes Linux window accessibility, Anesu selects one unambiguous
  foreground window, bounds its roles/labels/actions, and retains its PID, window
  ID, and accessibility snapshot ID. Native TypeSafe/Jev receives those candidates
  only and can return an existing element token, never a guessed coordinate. When
  that structured set is empty, a separate focused keyboard/text rung may expose
  only a quoted, non-sensitive value or an explicitly requested bounded key from
  the user goal. That fallback remains bound to the same exact window and Jev still
  chooses only a code-issued candidate;
- for compiled native form tasks, the exact source-backed text, date, or time value is
  attached only to a fresh editable control whose accessibility label identifies the
  same value kind. Unlabelled or ambiguous controls receive no typed-value candidate.
  Jev chooses the control/value-kind candidate; the exact mutation value stays in code
  and is dispatched only after the task grant is revalidated;
- one typed native action can be dispatched only against the exact unused
  observation that produced it, using CUA's exact window target for semantic
  element clicks and for coordinates observed in window scope. Desktop-scope
  observations use CUA's desktop target for absolute coordinates. Accessibility-token
  clicks request background semantic delivery; coordinate and keyboard input use
  explicit foreground delivery after approval. The adapter currently maps move,
  click, type, keypress, scroll, and drag. Native action payloads also carry the
  observed display geometry, scale, and window/snapshot identity; CUA rejects a
  mismatched binding before dispatch; and
- the observation is consumed before dispatch, so an ambiguous native error is
  never retried as a duplicate input.

The adapter is not the default chat environment, but it is selectable through the
normal configuration path with `ANESU_COMPUTER_ENVIRONMENT=ubuntu-x11-cua` and
`ANESU_COMPUTER_SURFACE=auto`. Production computer use uses `typesafe`: Jev selects
only from bounded CUA structured or focused candidates. Traditional vision, compare mode,
and automatic strategy fallback are retired from production admission; their direct
runner tests remain isolated regression coverage. The chat tool and TUI approval flow
use the selected adapter for a bounded sequence of model-selected actions. For a clearly
explicit computer-action prompt, `runTurn` requests the named `computer` function. If the
provider completes that request with prose only, Anesu discards the prose and routes the
exact original user prompt through the ordinary computer tool, task compiler, approval,
and verifier path; it never extracts an action from the model's prose. Typed provider
refusals, a wrong or multiple tool call, and incomplete streams remain failures. Ordinary
questions that merely mention an application stay in chat. The durable model-round record
labels this recovery as `explicit-user-intent`.
Each action is tied to a fresh observation, explicit approval, and the configured
`ANESU_COMPUTER_MAX_ACTIONS` limit (8 by default, configurable up to 32). For the
managed safe fixture, the native runner also verifies its success marker from the
fresh observation, including when CUA reports an uncertain acknowledgement. It
never retries the input. The
complete computer-tool call has its own bounded deadline, configured with
`ANESU_COMPUTER_DURATION_MS` (30 seconds by default), so a slower real vision or
accessibility provider is not cut off by the ordinary 10-second metadata-tool limit.
When computer use is enabled, the enclosing model turn defaults to at least the
configured browser-task duration plus 60 seconds. This leaves time for model
rounds before the task and a final reply after it. An explicit `ANESU_TIMEOUT_MS`
still overrides that default, including with a shorter value that can end a
browser task early.
Before starting the native session, the adapter checks the installed Cua tool inventory
and requires a passing structured health report. A missing operation or failed health
check stops admission before the app is launched or input is dispatched.
The production preflight also checks that the selected code-owned launch path is an
executable host file. It does not search the desktop or infer a command from the
prompt. `/doctor` reports native and browser Cua contract identities, host display and
session indicators, Jev credential presence, browser product presence, and the
installed supported window manager without printing credentials. For native Cua it also
reports whether the optional visual-region contract is actually advertised; `visual regions
unavailable` is the expected result with the currently pinned driver. GNOME Shell is a
supported launcher route even though it is not a lightweight window manager.
The bounded native manifest deliberately does not authorize unscoped `list_apps`: Cua
classifies that call as display-wide observation when no PID is supplied, which would
broaden this app-scoped runtime. Supported native applications therefore come from the
code-owned allow-list and Cua's manifest. Production launch requires that exact
code-resolved path, and after launch `list_windows` is always scoped to the PID returned
by Cua.
The current code-owned catalog covers Notes/Text Editor, Calendar, Clocks, Calculator,
and Settings. The live disposable X11 lane has proven Notes, Calendar opening, and Settings
opening. Calculator has a tested task compiler and verifier, but its latest live Cua
`launch_app` result returned a process that exited before the next usable observation, so
Calculator live support remains unverified. Clocks remains an explicit matrix failure because Cua's
Linux `launch_app` returns a child PID that exits while the DBus-activatable service is
started elsewhere; Anesu does not adopt that unrelated PID. Files and Terminal are not
advertised by this catalog for the same reason. Adding an application requires an exact
Cua PID/window proof first; an installed executable alone is not a support claim.
The native TypeSafe runner selects one structured accessibility candidate per
observation, or one explicitly bounded focused keyboard/text candidate after a
structured route is unavailable or refused. If the
action limit is reached without a
configured verifier proving the goal, the result is `outcome-unknown` and no further
input is sent. Arbitrary-application goal verification is not configured yet. The repository now includes disposable Xephyr
and Xvfb development launchers. Native action evidence is now durably journaled per
turn, including approval, dispatch, verification, and terminal outcome; restart
recovery fails pre-dispatch actions and marks in-flight actions ambiguous without
replaying input. Each computer-tool call also gets a bounded metadata-only
`computer-runs/<run-id>/run.json` and ordered `events.jsonl` projection, so the
selected strategy, environment, approval states, action request, verification,
terminal outcome, and bounded terminal error category can be inspected without storing
screenshots or raw provider bodies
in the transcript. `/computer` also shows recent run IDs, terminal status, event
counts, and the latest safe artifact reference through a lossy inspection projection;
it does not render arbitrary event payloads. Terminal run journals are retained for the
configured `ANESU_COMPUTER_RUN_RETENTION_MS` window and bounded by
`ANESU_COMPUTER_CLEANUP_MAX_ENTRIES`; active runs are never removed. If Anesu restarts
while a run is active, recovery appends one idempotent interruption event, marks that
run `outcome-unknown`, and never replays native input. When
`ANESU_COMPUTER_ARTIFACTS_ENABLED=true`, each bounded native observation is copied
from the short-lived screenshot scratch file into the managed
`computer-artifacts/<run-id>/` directory with an immutable PNG and JSON sidecar. The
run event stores only the artifact ID, managed relative path, byte size, and dimensions;
the scratch file is removed when the run closes. Artifact retention is bounded by
`ANESU_COMPUTER_ARTIFACT_RETENTION_MS` and
`ANESU_COMPUTER_ARTIFACT_CLEANUP_MAX_ENTRIES`, and active runs are retained. Artifacts
are disabled by default. Local OCR/visual segmentation, richer provider evidence, and
arbitrary-application goal verification remain later work. Native Jev's current semantic path
is accessibility-backed only. A Cua-bound visual fallback is a separately staged capability:
it will be enabled only after the released Cua runtime advertises its versioned
`parse_visual_regions` result and capture-bound `click.capture_id` input. Cua owns screenshot
perception; Jev receives bounded typed region metadata and chooses a region ID. Anesu will not
replace that missing contract with OCR, a second vision model, or the retired
traditional/compare strategies.

Calculator has a bounded task compiler and result verifier: a simple arithmetic expression
is normalized by code, supplied as `--equation` through Cua's typed `launch_app` arguments,
and expected to appear in a fresh Calculator accessibility result control. The parser is
small and fail-closed; unsupported or ambiguous expressions do not become launch arguments.
This route is not live-supported on the current Cua/X11 profile: the latest approved TUI run
returned a Calculator PID that exited before a usable bound-window observation, so no
calculation result was observed and no follow-up input was sent. The failure is recorded as
`computer-driver-failure`; Anesu does not adopt another PID or infer success from the launch
argument. Calculator remains unverified until Cua provides a released launch/window identity
handoff that preserves the exact app-scoped binding. Browser mutations, Calendar and Clocks
mutations, credentials, destructive actions, and file or remote-state changes remain
verifier-gated.

Before a task approval is shown, the application-lifetime router performs one
memoized TypeSafe readiness request using only a constant readiness state. It does not
send the user's goal, page content, accessibility state, or task values. The returned
model identity is attached to the started computer-run record so a moving alias such as
`jev-latest` remains auditable. A missing key, failed request, or malformed model
identity stops admission before launch or input.

## Natural surface selection

The model-facing `computer` tool accepts one ordinary-language goal. The user does
not need to name a tool, fixture, provider, or strategy. Anesu routes the goal before
the concrete runner starts:

- a URL, page, browser, tab, or web-navigation request selects the managed browser;
- a screen, window, desktop application, cursor, mouse, keyboard, or native-input
  request selects the isolated Ubuntu/X11 desktop when that profile is enabled;
- an otherwise surface-neutral request uses the configured preferred surface, and a
  request with no permitted surface returns an actionable unavailable result; and
- if both surfaces are available and no preference can be inferred, Anesu asks for a
  clarification instead of attaching to an arbitrary environment.

Under the production TypeSafe policy, Jev is tried only against the current bounded
semantic candidate set. It cannot provide coordinates, selectors, refs, commands, or
verification results. The TUI approval panel identifies the selected surface, target,
operation, scope, input route, and verification expectation.

For example, these are ordinary goals:

```text
Open https://example.com
Open Settings
Open Calendar
Calculate 2 + 2 in Calculator
Click the visible Settings button
Inspect the window on screen and press Enter
```

The first is browser-routed. The second uses whichever surface is configured when it
is unambiguous; the third is desktop-routed when the isolated native profile is
available. Arbitrary application launching and unrestricted personal-desktop access
remain outside this adapter.

## Goal verification and run outcomes

The high-level computer runner does not treat a model response, a completed input, or
a screenshot as proof that a goal succeeded. It records a bounded run and performs a
fresh observation after each approved input. The first code-owned verifier vocabulary
is `url-reached`, `text-present`, `text-absent`, `element-visible`, and
`element-state-changed` for an explicitly quoted target and state such as `checked`,
`selected`, `enabled`, `disabled`, `expanded`, or `hidden`.

A page-heading request passes when a fresh Cua snapshot contains a visible in-viewport
heading and is not explicitly incomplete or waiting for a continuation. Unrelated
omissions such as hidden elements do not invalidate that positive observation. Absence
claims still require complete evidence.

The original user goal remains separate from model output. In the production task path,
a request without a supported completion verifier is rejected before task approval or
input; for example, opening Notes and clicking an unverified control cannot be reported
as a successful open-only task. If a run becomes unverifiable after an approved action,
Anesu returns a bounded `clarification-required` result and records the unresolved run as
`outcome-unknown`.
Other terminal outcomes are `completed`, `abstained`, `failed`, `cancelled`, and
`action-limit`. The run journal preserves the user-visible outcome, step number,
verifier identity, bounded facts, and observation IDs without storing raw screenshots
or provider bodies. `/computer` shows the same outcome in its lossy recent-run view.

The disposable browser fixture supports both a one-step safe-result goal and a
two-step `open details and reveal the safe result` goal. This gives contributors a
repeatable loop test without requiring a personal website or browser profile.

The structured browser computer path also exposes a bounded `wait` candidate when
the user explicitly requests a duration such as `wait 250 milliseconds`. The duration
is parsed and capped by Anesu at 10 seconds before the model sees the candidate; the
model cannot invent a delay. The wait uses the existing read-only `browser_wait`
operation, takes no input approval, captures a fresh snapshot, and returns a terminal
`waited` result. It also exposes a user-requested `scroll` candidate with a direction
and amount capped at 2,000 pixels. Scrolls use the normal structured approval panel,
invalidate the previous element snapshot, capture a fresh snapshot, and return terminal
`scrolled` evidence. Model-selected terminal `done` remains absent until it has an
independent verification contract.

Browser TypeSafe/Jev decisions include an explicit `none` choice and use the shared
0.5 minimum confidence gate. A `none` response or a lower/invalid confidence ends in
an abstention before browser approval; confidence is recorded as model evidence, not
treated as authorization.

Cancellation is recorded before it propagates to the turn. If no native or browser
input has started, the computer run ends as `failed`. If an input has completed or may
have been delivered, it ends as `outcome-unknown`; Anesu never retries that input.
Read-only observation capture has one bounded retry within the caller's deadline.
Provider decisions may make one additional attempt before approval when the failure is
classified as transient; each failed attempt is recorded as bounded
`decision_attempt` evidence. Malformed decisions, abstentions, cancellation, and every
native/browser input are not retried.

Failure evidence keeps the important first-iteration categories separate: a missing or
non-isolated display is `computer-display-unavailable`, a CUA host failure is
`computer-driver-failure`, a stale observation is `computer-stale-observation`, a
provider deadline is `computer-provider-timeout`, malformed model output is
`computer-malformed-response`, and a low-confidence Jev result is
`computer-confidence-abstention`. These codes are retained in the computer outcome,
run event, and TUI activity. Only transient provider failures may trigger the one
bounded pre-approval decision retry; the other codes do not authorize a retry.

The ordered run journal records the model selected for each proposal, bounded decision
latency, and Jev probabilities when available. Observed native steps also retain
bounded display, cursor, image-size, and foreground-window metadata. It does not store
raw provider bodies or screen pixels in the journal.

## Why the SDK is installed directly

The TypeScript SDK is the production seam because it keeps CUA session lifecycle,
target binding, cursor presentation, native refusal results, and cleanup in one
process. The CLI/MCP surface remains useful for diagnostics and compatibility
checks, but adding it as a second runtime path would duplicate authorization and
recovery semantics. CUA's optional platform packages are resolved by pnpm's lockfile;
contributors should use the repository's normal command:

```bash
cd anesu
pnpm install
pnpm typecheck
```

No CUA native session is created by install, build, or the default browser chat
command. The adapter is loaded only when the explicit Ubuntu/X11 environment profile
starts it. The profile also requires a process-level `DISPLAY` and the explicit
`ANESU_COMPUTER_CUA_ISOLATED_DISPLAY=true` opt-in; Anesu will not attach to a
personal desktop by default.

For a repeatable headless development display, use the repository launcher:

```bash
pnpm run chat:cua-xvfb
```

It starts a private, cookie-protected Xvfb display, exports the native CUA profile,
and removes the display when chat exits. By default it does not start a desktop
application. For a self-contained manual smoke test, add `--fixture`; this opens
the local disposable Chrome page under the protected display:

```bash
pnpm run chat:cua-xvfb -- --fixture
```

The launcher runs Chrome and Anesu inside the same short-lived `dbus-run-session`.
That session bus is required by CUA's Linux accessibility bridge; starting Chrome on
one bus and Anesu on another can produce a screenshot while making the accessibility
tree unavailable. The fixture also starts Chrome with
`--force-renderer-accessibility`.

For native TypeSafe/Jev, a screenshot-capable Xvfb is not by itself a complete
desktop. The display must also have a window manager that publishes visible X11
windows and an AT-SPI-capable application. With only bare Xvfb, CUA may capture the
screen but Anesu has no trustworthy window or element candidates, so native Jev
abstains rather than guessing. The launchers do not install a system package or
silently start a window manager. For an explicit semantic smoke test, provide an
installed lightweight WM and opt into starting it inside the disposable display:

```bash
pnpm run chat:cua-xvfb -- --fixture --window-manager gnome-shell
```

The launcher accepts only the allow-listed `openbox`, `fluxbox`, `twm`, `jwm`, or
`gnome-shell` command names. Openbox is the preferred lightweight choice;
`gnome-shell` is supported when it is already available on Ubuntu but starts a much
larger disposable session. In either case, the launcher creates an isolated HOME and
XDG state before the D-Bus session begins; it does not install or reuse a global
desktop session. The production Jev path requires the bounded accessibility state
exposed by CUA.

The live smoke validation used an X11 fixture window and verified that CUA's click
reached it. The follow-up window-scoped smoke used the stored TypeSafe credential:
Jev selected the labelled fixture button from 15 accessibility candidates, the TUI
approval dispatched its exact token, and a fresh snapshot observed the success
marker. CUA reported the effect as uncertain; Anesu verified the result and did not
retry the input. The launcher gives the temporary desktop its own `HOME` and XDG
state directories before starting D-Bus, so desktop services cannot resolve the
contributor's normal Desktop or user indexes during this smoke.

The historical visual experiments remain in isolated strategy tests only; they are not
admitted by the configured production surface. Other catalog-confirmed free routes
remain subject to rate limits, model capability restrictions, or upstream capacity
errors. OpenRouter can also return a successful HTTP status with an embedded upstream
error. Anesu reports bounded upstream status and nested provider detail from
`metadata.raw` without retaining the raw body, and performs only its bounded
pre-approval retry. Jev provider availability remains model-dependent.

Native application commands exposed by CUA as an accessibility menu hierarchy use a
separate exact menu route. Anesu derives the path (for example, `File → New Event`)
from the current window snapshot, displays it in the task approval, and dispatches it
through CUA's `invoke_menu` tool. CUA resolves each segment again against the same
process and window at dispatch time; a missing, ambiguous, stale, or non-menu parent
fails closed. Anesu never turns an application action name into a guessed shortcut,
coordinate, or shell command. If no exact menu lineage is present, the normal
structured or focused candidate rules remain in force.

The launcher is intentionally separate from the ordinary `pnpm run chat` path and is
not a production sandbox.

When an existing X11 desktop is available and the nested desktop should be visible,
use:

```bash
pnpm run chat:cua-xephyr
```

This opens the isolated display in a Xephyr window on the parent desktop. To open the
same disposable local fixture inside that visible window, use
`pnpm run chat:cua-xephyr -- --fixture`. The parent `DISPLAY` is used only to show
that window; Anesu receives the nested `DISPLAY`, and the launcher refuses to reuse
an existing nested display. Arbitrary GUI applications still need to be started
separately; the fixture option is intentionally limited to the repository's local,
non-networking test page.
