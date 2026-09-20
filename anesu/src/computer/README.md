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
- observations are bounded and expose metadata rather than embedding screenshot
  bytes in the model transcript; traditional mode captures the authorized desktop,
  while native Jev captures the exact authorized window snapshot. When CUA exposes
  it, the observation also carries the bounded agent-cursor position for inspection;
- when CUA exposes Linux window accessibility, Anesu selects one unambiguous
  foreground window, bounds its roles/labels/actions, and retains its PID, window
  ID, and accessibility snapshot ID. Native TypeSafe/Jev receives those candidates
  only and can return an existing element token, never a guessed coordinate;
- one typed native action can be dispatched only against the exact unused
  observation that produced it, using CUA's exact window target for semantic
  element clicks and its desktop target for absolute coordinate input. Accessibility-token
  clicks request background semantic delivery; coordinate and keyboard input use
  explicit foreground delivery after approval. The adapter currently maps move,
  click, type, keypress, scroll, and drag. Native action payloads also carry the
  observed display geometry, scale, and window/snapshot identity; CUA rejects a
  mismatched binding before dispatch; and
- the observation is consumed before dispatch, so an ambiguous native error is
  never retried as a duplicate input.

The adapter is not the default chat environment, but it is now selectable through
the normal configuration path with
`ANESU_COMPUTER_ENVIRONMENT=ubuntu-x11-cua` and one of
`ANESU_COMPUTER_STRATEGY=traditional`, `typesafe`, or `compare`. The chat tool and TUI approval
flow then use this adapter for a bounded sequence of model-selected actions. Each
action is tied to a fresh observation, explicit approval, and the configured
`ANESU_COMPUTER_MAX_ACTIONS` limit. For the managed safe fixture, the native runner
also verifies the fixture success marker from that fresh observation, including when
CUA reports an uncertain acknowledgement. It never retries the input. The
The complete computer-tool call has its own bounded deadline, configured with
`ANESU_COMPUTER_DURATION_MS` (30 seconds by default), so a slower real vision or
accessibility provider is not cut off by the ordinary 10-second metadata-tool limit.
traditional runner selects screenshot-based actions from the bounded click, move,
type, keypress, scroll, and drag schema, and may explicitly abstain with `none` when
the visual target is absent, ambiguous, or unsafe; an abstention never reaches
approval or native input. The native TypeSafe runner selects one accessibility
candidate per observation. If the action limit is reached without a
configured verifier proving the goal, the result is `outcome-unknown` and no further
input is sent. In `compare`, traditional vision is the primary executor and Jev is
shadow-only: Anesu approves and dispatches one action only when the visual coordinate
falls inside Jev's exact observed accessibility frame. A missing semantic frame,
abstention, or disagreement stops before approval. Arbitrary-application goal
verification is not configured yet. The repository now includes disposable Xephyr
and Xvfb development launchers. Native action evidence is now durably journaled per
turn, including approval, dispatch, verification, and terminal outcome; restart
recovery fails pre-dispatch actions and marks in-flight actions ambiguous without
replaying input. Each computer-tool call also gets a bounded metadata-only
`computer-runs/<run-id>/run.json` and ordered `events.jsonl` projection, so the
selected strategy, environment, approval states, action request, verification, and
terminal outcome can be inspected without storing screenshots or raw provider bodies
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
arbitrary-application goal verification remain later work. Native
Jev's current semantic path is accessibility-backed only; it refuses when that state
is absent.
Traditional mode also requires the explicit development declaration
`ANESU_COMPUTER_TRADITIONAL_VISION=true`. This is a capability gate, not a claim that
Anesu can infer every OpenRouter model's modalities: the contributor must confirm
that the configured traditional model accepts image input. When the declaration is
false or absent, configuration stops before a screenshot is sent. The action response
is still validated independently: it must contain one allow-listed action selection
in either a strict tool call or the supported strict JSON form.

The traditional response boundary accepts the declared bounded `reason` metadata and the
provider's explicit `x_abs`/`y_abs` coordinate aliases, while rejecting all other unknown
fields. If a provider returns a complete coordinate tuple in the `[0, 1]` range, Anesu
converts it against the current observed screen dimensions before approval; absolute pixel
coordinates remain unchanged. The approval panel therefore shows the canonical coordinates
that will be dispatched, not the provider's raw representation.

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
tree unavailable. The fixture also starts Chromium with
`--force-renderer-accessibility`.

For native TypeSafe/Jev, a screenshot-capable Xvfb is not by itself a complete
desktop. The display must also have a window manager that publishes visible X11
windows and an AT-SPI-capable application. With only bare Xvfb, CUA may capture the
screen but Anesu has no trustworthy window or element candidates, so native Jev
abstains rather than guessing. The launchers do not install a system package or
silently start a window manager. For an explicit semantic smoke test, provide an
installed lightweight WM and opt into starting it inside the disposable display:

```bash
pnpm run chat:cua-xvfb -- --fixture --window-manager openbox
```

The launcher accepts only the allow-listed `openbox`, `fluxbox`, `twm`, `jwm`, or
`gnome-shell` command names. Openbox is the preferred lightweight choice;
`gnome-shell` is supported when it is already available on Ubuntu but starts a much
larger disposable session. In either case, the launcher creates an isolated HOME and
XDG state before the D-Bus session begins; it does not install or reuse a global
desktop session. Traditional mode can still inspect the captured screen without a
window manager, subject to its explicit model and approval configuration.

The live smoke validation used an X11 fixture window and verified that CUA's click
reached it. The follow-up window-scoped smoke used the stored TypeSafe credential:
Jev selected the labelled fixture button from 15 accessibility candidates, the TUI
approval dispatched its exact token, and a fresh snapshot observed the success
marker. CUA reported the effect as uncertain; Anesu verified the result and did not
retry the input. The launcher gives the temporary desktop its own `HOME` and XDG
state directories before starting D-Bus, so desktop services cannot resolve the
contributor's normal Desktop or user indexes during this smoke.

The traditional visual route has also been exercised against the live provider path.
It captured the display, produced a valid bounded click proposal, and reached the
same approval and CUA dispatch boundary. The tested free model selected a coordinate
outside the fixture button, so fresh verification correctly returned `outcome-unknown`
and the runner did not retry the click. Other catalog-confirmed free routes were
rate-limited or rejected the multimodal request; OpenRouter can also return a successful
HTTP status with an embedded upstream error. Anesu reports bounded upstream status and
nested provider detail from `metadata.raw` without retaining the raw body, and performs
only its bounded pre-approval retry. Treat traditional mode as connected but not yet
accepted for reliable visual grounding; TypeSafe/Jev is the currently validated native
strategy.
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
