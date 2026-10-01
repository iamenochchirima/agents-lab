# Lina computer-use dual paths

**Created:** 2026-09-18T01:43:47+02:00
**Last updated:** 2026-09-20T13:50:00+02:00
**Status:** Active
**Owner:** Lina

## Start here

Read these before changing code:

- [Repository development rules](../../../../AGENTS.md)
- [Lina development rules](../../../../lina/AGENTS.md)
- [Lina source boundaries](../../../../lina/src/README.md)
- [Tool ownership and approval boundary](../../../../lina/src/tools/README.md)
- [Existing browser capability](../../../../lina/src/browser/README.md)
- [Computer-use research](../../../../docs/research/computer-use-implementation.md)
- [Ubuntu pointer and cursor research](../../../../docs/research/ubuntu-computer-use-pointer.md)
- [Computer-use experiment guidance](../../../../docs/planning/component-lab.md)
- [Lina production-readiness gap register](lina-production-readiness-gaps.md)

Reference implementations and primary documentation:

- [Hermes source map](../../../../docs/research/harness-code-maps/hermes.md)
- [OpenClaw source map](../../../../docs/research/harness-code-maps/openclaw.md)
- [TypeSafe System One](https://docs.typesafe.ai/concepts/system-one)
- [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice)
- [TypeSafe confidence guidance](https://docs.typesafe.ai/confidence)
- [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)
- [TypeSafe computer-use project](https://github.com/awlevin/typesafe-computer-use)
- [CUA Driver repository](https://github.com/trycua/cua)
- [CUA-S1-FORMS model card](https://huggingface.co/cua-ai/cua-s1-forms)
- [CUA `jev-use` guide](https://cua.ai/docs/how-to-guides/driver/jev-use)
- [Browser-use Jev Ultrafast](https://github.com/browser-use/jev-ultrafast)

These references are design inputs, not requirements to copy. Preserve the existing
decisions that browser automation is a tool capability, that environment ownership is
separate from model/provider code, that screen content is untrusted, and that a
proposed action is distinct from an approved and committed action.

## Purpose

Add one standalone Lina computer-use capability with two selectable decision paths:
the traditional screenshot-and-vision path and a TypeSafe/Jev semantic path. Both must
use the same bounded lifecycle, approval policy, cancellation, verification, and evidence
boundary so they can be compared honestly and one can later be removed without rewriting
the computer environment. Browser and native host execution remain separate adapters
because their freshness and target-identity invariants are different.

This is the first usable implementation slice, not a claim that every desktop platform
or every production-hardening case is complete.

## Current implementation checkpoint

The first code slice now exposes a real `computer` tool and `LINA_COMPUTER_*`
configuration rather than presenting the capability as a fake deterministic action.
Its visible-browser path has a bounded indexed action space: the current document and
reference identity are retained, each observed target is paired with an allow-listed
operation, password/file/hidden inputs become explicit `blocked` actions, and Jev or a
vision model can return only an Lina-owned action ID. The selected action is mapped
back through the same browser approval and executor path, then a fresh snapshot verifies
the result. Focused tests cover operation compatibility, sensitive-input blocking,
provider response validation, shared execution, compare-mode no-double-click behaviour,
and TUI activity.

This is usable as a browser validation slice, not completion of the plan. The pinned
`@trycua/cua-driver` TypeScript SDK and a fake-host-tested `CuaEnvironment` now provide
the first native boundary: explicit Linux/X11/isolation readiness, named CUA session
lifecycle, CUA's visible agent cursor and bounded cursor-state metadata, bounded observations, background semantic
element clicks, explicit foreground coordinate/keyboard input,
and consume-before-dispatch stale/duplicate protection. The native traditional path
is now selectable by chat configuration and shares the TUI approval flow; it performs
a bounded sequence of model-selected native actions, one action per fresh observation,
with an explicit configured action limit. Traditional vision may also explicitly
abstain when it cannot identify one safe target; that result stops before approval
and native input. A private, cookie-protected
Xvfb and visible Xephyr launchers are available, and a live smoke test has captured a real X11 screenshot
and sent a click to an X11 fixture window. The optional `--fixture` launcher mode now
opens a local non-networking Chrome page for the same manual flow. The fixture's
success marker is verified from a fresh observation when CUA reports an uncertain
effect; Lina does not retry the input. This is host evidence for the safe fixture,
not arbitrary-application goal verification.
Arbitrary GUI-app startup remains a separate host task. Native Jev now has an
accessibility-backed semantic path: CUA selects one unambiguous visible window,
Lina bounds its candidate elements, Jev selects one candidate, and the approved
element token is dispatched to that exact window. If the host does not expose usable
accessibility state, native Jev abstains; it does not invent OCR or coordinates. The
native runner now verifies the repository fixture's success marker from the fresh
observation, including after an outcome-unknown CUA acknowledgement without retrying.
Arbitrary-application goal verification and raw provider body retention remain separate
work. Opt-in observation artifact capture now copies bounded PNGs to a managed
`computer-artifacts/<run-id>/` directory, publishes JSON sidecars, and records only a
safe relative reference plus bounded dimensions in the run event. Proposal evidence now records the selected model,
bounded decision latency, and Jev probabilities when available. The browser and native runners now support the same
bounded loop shape: after a non-terminal action, the next observation carries the
predecessor observation ID; reaching the configured action limit returns
`outcome-unknown` without another action.
Its first durable action journal is now in place: it records the bounded native action
through prepared, approved, running, and terminal states, writes lifecycle events through
the runtime, and on restart fails pre-dispatch actions or marks in-flight input
ambiguous without replay. Those remaining items and the manual real-provider/backend
checks are listed below. A real Chrome fixture smoke on Xvfb has since captured the page,
dispatched the CUA click, and shown the fixture's `Computer success` state on a fresh
follow-up observation; the driver classified that input as uncertain, so Lina
verified the state and did not retry it.

The live host check also established an important Linux prerequisite: the fixture and
Lina must share a short-lived `dbus-run-session` for CUA's desktop capture and
AT-SPI bridge. With that session in place, bare Xvfb captured the real fixture
screenshot, but CUA's window enumeration returned no windows because the display had
no window manager. Native Jev therefore correctly abstained: screenshot capture is
available, but there was no trustworthy window/element candidate to select. The
launchers now provide the shared D-Bus setup and Chromium accessibility flag. They
also support an explicit `--window-manager openbox` (or another allow-listed
lightweight WM) opt-in inside the disposable display; installing that OS prerequisite
remains a host setup step, not an implicit system mutation.

Both native strategies now use CUA's window capture scope so traditional visual
coordinates and Jev element tokens are grounded in the exact foreground window that
produced the observation; desktop scope remains an explicit adapter capability for
future full-display tasks. A live isolated Xvfb + GNOME/X11 + Chrome
check enumerated the real Chrome window and exposed the labelled `Reveal safe result`
control through 15 bounded accessibility candidates. The stored TypeSafe credential
selected that candidate, the structured TUI approval dispatched its exact token, and
a fresh snapshot verified `Computer success: safe result revealed.` CUA classified
the element click as uncertain, so Lina did not retry it. This proves the CUA/AT-SPI
window boundary, approval path, and action delivery. The normal interactive TUI
approval check is now complete for the native TypeSafe path. The repository fixture now has a bounded
application-level verifier in the native runner; arbitrary applications still require
their own verifier.
Native Ubuntu/X11 compare mode is now available. Traditional vision is the primary
executor and Jev is shadow-only. The two proposals are emitted separately, and the
runner executes at most one approved click only when the traditional coordinate falls
inside Jev's bounded accessibility frame from the same observation. Missing semantic
frames, Jev abstention, low confidence, and target disagreement stop before approval;
there is no second native input. The compare path therefore remains conservative when
CUA cannot provide enough geometry to prove that the proposals refer to the same
control.

Native action payloads now carry the observed display dimensions, scale factor, and
window/snapshot identity into the CUA adapter. The adapter rejects a mismatched
binding before dispatch, in addition to the observation ID/generation and element
token checks, and revalidates live desktop dimensions and the top on-screen window
immediately before dispatch when the CUA driver exposes those queries. External
changes that the host driver cannot report remain an explicit unavailable/failure
case rather than a silent fallback.

The coordinate dispatch boundary is now explicit in the adapter: coordinates from a
desktop observation use CUA's desktop target even when an accessible foreground window
is also present, while semantic element tokens use the exact window target. The
fallback test adapter follows the same rule. This prevents desktop screenshot pixels
from being reinterpreted as window-relative coordinates. The disposable Chrome fixture
also uses `--password-store=basic` inside its isolated profile so a GNOME keyring setup
dialog cannot obscure the desktop screenshot or become an unintended computer-use
target. A live GNOME artifact confirmed the resulting 1280x720 screenshot geometry;
the remaining traditional failure was a provider coordinate-grounding miss, not a
host coordinate transform.

The first real interactive TUI acceptance then completed on the same disposable
Xvfb/GNOME/Chrome profile using the stored credentials and the configured free
`cohere/north-mini-code:free` model. Jev proposed the labelled fixture
button, the TUI rendered the structured approval panel, the `a` approval key allowed
one action, and the TUI reported the fresh fixture verification with no retry after
CUA returned an uncertain acknowledgement. The stored NVIDIA free route is not a
reliable traditional acceptance backend at present: its OpenRouter response reached
the model boundary but returned an upstream HTTP 502 `ResourceExhausted` envelope.
The computer parser now surfaces that envelope and performs only the bounded
pre-approval retry. The launcher also now
preserves the caller's stdin and isolates HOME/XDG state before `dbus-run-session`,
so desktop services stay within the disposable profile and the interactive TUI does
not exit on startup.

After replacing the retired local `*_POC_*` development settings with the current
`LINA_COMPUTER_*` names, the same TypeSafe task was repeated through the normal
`pnpm run chat:cua-xvfb -- --fixture --window-manager gnome-shell` path (using a
different disposable display only because the earlier `:99` session was still live).
The TUI again showed the labelled target, accepted a single `a` approval, dispatched
through CUA, and verified the safe result after an uncertain acknowledgement. This
confirms the stored development configuration and one-command launcher path; it does
not change the open traditional-provider gate.

A real traditional-vision acceptance attempt now reaches the same live boundary. The
configured free `inclusionai/ling-3.0-flash-vl:free` route received the X11 screenshot,
returned a valid bounded coordinate action, rendered the approval panel, and dispatched
one approved click; its coordinate did not fall on the visible fixture control, so the
fresh observation ended as `outcome-unknown` without replaying an uncertain native
effect. A second live run with the configured NVIDIA
`nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` route reached screenshot observation
under the dedicated 30-second computer deadline, but returned no single supported choice
and stopped before approval. A catalog-confirmed Gemma route returned HTTP 429, while
Nex returned a bounded HTTP 400 with nested provider detail indicating an invalid
multimodal request. The provider normalizer now extracts that bounded nested detail from
OpenRouter's `metadata.raw` without retaining the raw body. These runs prove the
traditional provider path and the failure boundary are connected, not that a free visual
model is yet reliable enough for completion. The traditional manual-acceptance item
therefore remains open.

The next live run with NVIDIA selected the computer tool and exposed two provider-shape
compatibility cases at the Lina boundary: a bounded `reason` field alongside a click and
normalized coordinates (`0.3906, 0.5315`) for the 1280x720 display. Both are now normalized
strictly at the provider boundary, with unknown fields still rejected and canonical pixel
coordinates shown in approval. A subsequent retry reached the provider but received the
bounded `HTTP 502 ResourceExhausted` response from NVIDIA's free worker pool before a new
proposal was available. The live traditional acceptance item remains open until a free
vision route returns a correct proposal that is approved and verified on the fixture.

A later live Dots run with a 60-second development deadline reached the structured
approval panel and showed canonical coordinates `(390,530)`. The visible fixture control
was elsewhere on the 1280x720 desktop, so the proposal was denied and no native input was
sent. This confirms the approval and no-side-effect boundary, but it is not traditional
acceptance evidence; the Dots route remains unsuitable for the completion gate until its
coordinate grounding is reliable.

The traditional request boundary now presents the model with a bounded, human-readable
goal/state block and explicit full-screenshot coordinate-frame and visible-bounding-box
instructions. The focused regression test covers that request shape (`cc7f42`). Repeated
static probes against the same captured fixture image still produced materially different
coordinates across otherwise identical free-provider requests, including points outside
the visible button. The change improves the request contract but does not convert an
unstable provider into acceptance evidence; Lina must continue to abstain or deny rather
than snap or silently reinterpret those coordinates.

After both strategies moved to CUA's exact foreground-window capture scope, a live
traditional run with `dots-studio/dots-3-note-preview:free` and the disposable
Xvfb + GNOME + Chrome fixture produced the correct window-local coordinate `(411,300)`.
The TUI rendered the structured approval panel, one `a` approval dispatched the click,
and a fresh observation verified `Computer success: safe result revealed.` CUA reported
the native effect as uncertain; Lina did not retry it. The run required temporary
90-second diagnostic deadlines because the free provider was slow. This closes the
traditional host/coordinate acceptance for one live route; the stored NVIDIA route and
other free routes remain provider-availability or model-capability risks.

The first live compare attempts correctly stopped before approval, first because the
real CUA Linux payload used `{x,y,w,h}` bounds that the adapter had discarded, then
because an unstable visual proposal fell outside the localized Jev frame. The adapter
now canonicalizes both CUA's `{x,y,w,h}` and compatible `{x,y,width,height}` shapes,
and converts Linux AT-SPI screen-space bounds into the same window-screenshot frame
using `window_bounds`, screenshot dimensions, and the decoration crop. A subsequent
live compare run produced a traditional coordinate `(415,315)` inside Jev's localized
button frame, showed both proposals in evidence, rendered one primary approval, sent
one click, and verified the fixture result from a fresh observation after CUA reported
an uncertain effect. The shadow Jev strategy sent no native input.

The CUA adapter now also translates the bounded native move, type, keypress, scroll,
and drag operations through the pinned SDK, with the same one-observation consumption
and no-retry rule. The traditional native runner now selects one of those operations
per fresh observation and routes its operation-specific payload through the TUI approval panel. The
runtime now persists native approval, dispatch, verification, and recovery evidence in
the turn's `computer-actions/` directory. It now also writes a bounded metadata-only
`computer-runs/<run-id>/run.json` and ordered `events.jsonl` for each computer-tool
call. Those records make the selected strategy, environment, goal, approval states,
action request, verification, and terminal outcome inspectable without storing
screenshots or raw provider bodies in the transcript. Application-specific verification,
local OCR/visual segmentation, richer artifact layouts, and richer provider/run evidence
remain separate work. If Lina restarts while a run is
active, recovery appends one idempotent interruption event, marks that run
`outcome-unknown`, and never replays native input.

The TUI now identifies the configured computer environment, strategy, isolation or
visibility state, and selected model in its header/status projection. Semantic native
approvals show the observed target label and role rather than empty coordinates. This
improves inspection of the real path without pretending that arbitrary-application
verification or richer multi-step artifact layouts are already implemented.

Cancellation now has an explicit computer-run outcome: cancellation before input is
recorded as a failed run, while cancellation after an input may have started is
recorded as `outcome-unknown`. Neither path replays the input. The run journal also
records the configured action limit, provider model and decision latency, bounded Jev
probabilities when available, and bounded per-step display/cursor/window metadata;
raw provider bodies and screen bytes remain outside the ordinary journal.

The provider boundary was also corrected as part of this slice: a transport failure
after only a non-executable stream-start event remains eligible for the existing
bounded retry, while provider error frames inside an OpenRouter SSE stream retain their
retryable/auth/rate-limit classification and redact known credentials. This matters to
computer use because a provider outage must not be confused with a failed native action.

The browser action space now has complete bounded timing and viewport paths. When the user
explicitly requests a duration in milliseconds or seconds, Lina adds one synthetic
`wait` candidate with the parsed value capped at 10 seconds. Jev or the traditional
selector may choose that candidate, but neither can invent its duration. The runner
dispatches the existing bounded `browser_wait` primitive without input approval,
captures a fresh snapshot, and terminates with `waited` evidence. Browser scrolling now
follows the same model-owned candidate boundary: an explicit direction and amount from
the user are capped at 2,000 pixels, approved as a browser interaction, dispatched
through Playwright, followed by reference invalidation and a fresh snapshot, and
terminated with `scrolled` evidence. Model-selected `done` remains absent from the
candidate space until it has an independent verification contract.

The browser TypeSafe path now matches the native semantic path's abstention boundary:
Jev receives a `none` option, and Lina refuses a selected candidate when confidence
is missing, invalid, or below the shared 0.5 threshold. That signal is evidence only;
the normal approval decision remains independent.

Validation checkpoint: `pnpm test` passes all 499 tests; the build and typecheck pass.
`pnpm coverage` passes with 89.56% line coverage, 76.58% branch coverage, and
85.99% function coverage. The focused computer suite covers the bounded wait and
scroll parsers, synthetic candidates, approval/no-approval dispatch,
fresh-snapshot verification, terminal `waited`/`scrolled` evidence, and the browser
TypeSafe `none`/low-confidence abstention boundary. The full suite also covers the
real Playwright scroll dispatch, browser approval/persistence identity fields, and
native/browser shared confidence handling, native compare coverage proves separate
traditional and Jev proposals, one approved primary execution on agreement, and
zero approval/input on a bounded target disagreement, and CUA coverage proves stale
geometry/window bindings plus live desktop/window changes are rejected before native
dispatch.
Failure-category tests also distinguish display unavailability, host-driver failure,
stale observations, provider timeout, malformed model output, and confidence
abstention at the runner/TUI boundary.
The focused artifact store and native-runner integration tests cover immutable copies,
typed path failures, retention, run-event references, and scratch cleanup.
The real native fixture acceptance remains separately recorded below because it requires
a disposable X11/AT-SPI host and configured provider credentials.

The evidence-inspection slice is now partly implemented: `SessionStore` exposes a
bounded, lossy run-summary projection, `/computer` renders recent run IDs/status/event
counts and safe relative artifact references, and startup retention removes only old
terminal journals within configured bounds. It does not copy raw screenshots or
provider bodies into the transcript, and it does not make replay of native input
possible. Local OCR/visual segmentation, richer provider evidence, arbitrary
application verification, and cross-platform hosts remain later slices.

Browser text composition now has an explicit first-slice contract. If Jev or the
traditional model selects a text field, Lina types only text that the user included
inside quotation marks in the computer goal. Missing quoted text produces a
`clarification_required` abstention; credential-like or secret-looking text is refused.
The model selects the observed field but never generates or invents the value entered
into it. The subsequent browser snapshot remains the verification boundary.

The browser computer path also accepts a user-requested public URL for an open-only
goal, such as `Can you open kasitek.co.za?`. Lina normalizes the URL, sends it
through the existing managed-browser URL policy, captures one fresh snapshot, and
returns an `opened` result without starting a model action or forcing the local
fixture. Goals that request an interaction continue through the bounded candidate,
approval, and verification path; arbitrary-page success verification remains
application-specific and is not guessed.

The browser action space now also exposes a `press` candidate beside a text field only
when the goal explicitly requests a supported key (`Enter`, `Tab`, `Escape`, `Space`,
`Backspace`, `Delete`, or an arrow key). The key is derived from the user goal and
passed through the existing approval-gated `browser_press` tool; Jev cannot invent a
key name.

Native browser `<select>` controls now have the corresponding bounded `select`
operation. The option label must come from explicit user quotes, is shown in the
approval panel, is bound to the exact current reference, and is rechecked against the
current option list immediately before Playwright selects it. Custom comboboxes remain
blocked until their option semantics are observed rather than being treated as native
selects.

Traditional visual execution now has an explicit model-capability gate:
`LINA_COMPUTER_TRADITIONAL_VISION=true` must be set for `traditional` or `compare`
mode, and the selected model must be confirmed by the contributor to accept image
input. The gate fails during configuration rather than sending a screenshot to a
text-only route. The response boundary separately accepts only one allow-listed
action selection and rejects malformed or extra fields. This is a declared
capability contract, not automatic provider metadata discovery; provider capability
discovery remains a later integration concern.

For an interactive requested URL, the runner now performs at most one approved
model-selected action before returning a terminal result with
`verification: "not-configured"` when no page-specific verifier proves the goal. It
captures and links a fresh follow-up observation, but never repeats the action merely
because the page's success state is unknown. The repository fixture remains the
explicit verifier used by deterministic and native acceptance tests.

## Implementation sequence

This is one plan with three deliberately ordered stages. The first stage is a small
visible-browser validation path, not a separate plan or a claim of native desktop
support. It keeps the first feedback loop short while establishing the contracts that
the later host adapter must use.

### Stage 1: visible browser validation

Use a fresh, visible, Lina-managed Chromium profile and a loopback fixture with one safe
state-changing control. Run the same bounded task through both the traditional and
TypeSafe/Jev strategies. Both strategies must propose through the same approval and
executor path, execute one click at a time within the configured action budget, verify
the changed state, and emit bounded TUI
activity and evidence. The fake-environment tests and the real TypeSafe/browser smoke
path establish the deterministic seam; provider availability, cancellation, evidence
redaction, compare-mode behaviour, and the traditional real-provider path remain
validation items in this plan rather than a second plan.

This stage proves the shared decision/execution boundary and its bounded re-observation
loop. It does not prove native desktop control, OCR, macOS Accessibility, CoreML
segmentation, coordinate input, or arbitrary-application computer use.

Use Browser-use's `jev-ultrafast` as a focused reference for this browser stage: build
an indexed action space from one atomic observation, ask Jev for an operation and a
compatible target, keep free-text composition in a separate validated helper, and
recheck freshness, visibility, geometry, and occlusion immediately before each execution.
Port those contracts into Lina's existing TypeScript/Playwright adapter; do not add
the Python/CDP project as a second browser runtime or adopt its shared-profile model.

The Lina implementation will own this fast structured browser strategy. A browser
observation produces code-owned element IDs and only the operations supported by each
element (`click`, `type`, `press`, `select`, `scroll`, `wait`, `done`, or `blocked`). Jev may
choose only from those IDs and operation heads; it cannot return selectors, coordinates,
JavaScript, or arbitrary tool calls. Lina revalidates the page and target immediately
before each execution, consumes the decision before mutation, then obtains a fresh
observation and independent verification. Screenshots remain optional evidence or
traditional-strategy input, not the default Jev payload.

CUA-S1-FORMS is deliberately not a third strategy in this first general slice. It is
a narrow, form-oriented specialist scorer whose current evidence and input contract do
not generalize to arbitrary desktop tasks. Its bounded planning, dry-run, abstention,
snapshot-token, independent-verification, and artifact-integrity patterns are design
references. A later form-specific experiment may add it behind the same candidate,
approval, executor, and verification interfaces.

### Stage 2: one native graphical host

Start with Ubuntu X11 as the explicitly supported disposable graphical host profile.
Use Xephyr for a locally visible nested display and Xvfb plus a protected viewer for
worker or remote tests. The profile must provide readiness checks, cursor-aware capture,
pointer position/movement, click, drag, scroll, keyboard input, focus, permissions,
cleanup, and visible manual operation. Use CUA Driver as the primary host-driver
candidate: its Linux backend, typed SDK, agent-cursor overlay, session/target freshness
contracts, refusal results, and validation harness are documented in the linked
pointer research. Integrate it behind an Lina adapter; do not pass model-produced CUA
tool calls through directly, write a second XTEST/uinput driver, or attach silently to
a personal desktop. Wayland is a separate later profile using the XDG RemoteDesktop/
libei path and must not be claimed through XWayland.

The primary integration is CUA Driver's pinned in-process TypeScript SDK, packaged and
managed with the Lina pnpm workspace. The adapter owns creation and shutdown of the
CUA session and translates only Lina's normalized actions to the typed Driver API.
The CUA MCP/CLI surface may be used for diagnostics or an explicit compatibility
smoke, but it is not a second production execution path for this slice.

CUA is installed as the pinned `@trycua/cua-driver` package through the repository's
pnpm lockfile. No global CUA command, background daemon, or MCP server is required
for the production path. Linux display/session dependencies remain host prerequisites
and are checked by the launcher/adapter: a shared D-Bus session is required for
AT-SPI, and native semantic selection requires a window manager plus an
accessibility-capable application. If those are absent, native Jev must abstain.

The CUA integration follows CUA's current `jev-use` boundary: Lina constructs the
complete bounded candidates and owns Jev credentials, approval, policy, cancellation,
and orchestration; CUA owns capture, target/session binding, native dispatch, cursor
presentation, and native results. Bind each action to the exact current observation and
CUA session/generation, execute at most one action from one capture, then reobserve
within the configured action budget.
Never pass an unrestricted model-produced CUA call through, retry a stale or ambiguous
action as a free coordinate, or automatically escalate background delivery to
foreground. The visible profile uses CUA's synthetic agent cursor and an isolated
display; it does not require moving the operator's real pointer.

### Stage 3: lifecycle and production reinforcement

Complete the shared recovery, evidence, comparison, resource-limit, security, and
focused test requirements below. Broader cross-platform, adversarial, load, and
operational reinforcement remains in the production-readiness gap register.

## Definition of done

With persistent local configuration in `lina/.env`, a contributor can run:

```text
pnpm run chat
```

and ask Lina to perform a small task in an explicitly selected, visible, disposable
computer environment. The configured strategy is `traditional`, `typesafe`, or
`compare`; compare uses traditional vision as the primary executor and Jev as a
shadow proposal.
The traditional path sends a bounded visual observation to a vision-capable model and
receives a validated structured action. The TypeSafe path builds one bounded indexed
    observation from managed browser state, or from CUA accessibility/element state for
    the native profile, asks Jev to choose only a supplied operation/target candidate,
    and maps that typed choice to the appropriate environment executor. Native TypeSafe
    does not claim OCR or visual segmentation when those sources are unavailable.
The TUI shows which path is active, what environment is
controlled, the proposed action, approval, execution, verification, and any abstention.

```text
user goal
  → Lina computer tool
  → selected observation/decision strategy
  → shared policy and structured approval
  → host adapter executes one action
  → fresh observation and verification
  → bounded lifecycle/evidence record
```

The default remains safe: computer use is unavailable unless the user explicitly
enables it and selects an environment. A missing host permission, missing driver, or
unsupported strategy produces a diagnostic result; it never silently falls back to a
fake action or to the other strategy.

## Scope

- [x] Complete the visible browser validation stage with both strategy proposals, one
      shared approved browser executor, post-action verification, compare-mode evidence,
      and the focused failure/secret-redaction checks described below.
- [x] Define a model-neutral computer-use contract for environment lifecycle,
      observations, candidate targets, action proposals, execution results, and
      post-action verification.
- [x] Add a real host adapter for one explicitly supported graphical environment,
      with a visible/disposable mode for manual testing and a readiness/doctor check.
      The first native backend should prefer the maintained CUA-driver approach already
      used by Hermes/OpenClaw, pinned as a normal dependency with its host capability
      checks; do not write a custom kernel driver or silently attach to a personal
      desktop when that backend is unavailable.
- [x] Make the first Ubuntu X11 profile cursor-visible and pointer-capable: record the
      display/session identity and geometry, expose bounded cursor position, move,
      click, drag, scroll, and keyboard actions, and retain cursor-aware screenshots or
      recordings without leaking the operator's display.
- [x] Implement the traditional visual strategy. It supports bounded screenshot
      observations, image-capable model input, a constrained computer-action schema,
      strict response parsing, and capability rejection before a screenshot is sent
      when the selected model is not declared image-capable.
- [x] Implement the TypeSafe/Jev strategy for the perception sources declared in this
      initial slice. The shared path assembles managed browser state or native CUA
      accessibility/element metadata into bounded JSON candidates, issues a focused
      `Choice` request, retains probabilities and confidence, abstains below the
      configured risk-aware threshold, and never treats confidence as authorization.
      Local OCR/visual perception is not declared as a supported source in this slice;
      it remains an explicit product gap in the readiness register.
- [x] Implement the fast structured browser path inside the TypeSafe strategy: one
      atomic managed-browser snapshot, Lina-owned indexed element identities,
      operation-compatible target choices, freshness/visibility/geometry/occlusion
      revalidation, decision consumption before mutation, and independent
      post-action verification. Jev must never return selectors, coordinates,
      JavaScript, or arbitrary tool calls.
- [x] Keep browser text composition separate from Jev's classifier. Text not already
      present in explicit user quotes produces clarification; quoted browser text is
      bounded and secret-like values are refused. Jev selects the observed field but
      is never treated as a text generator. Native arbitrary-app composition remains
      a later host-specific slice.
- [x] Share one deterministic lifecycle/approval/retry/evidence contract across
      click, type, keypress, scroll, wait, and close, while keeping the final
      environment executors separate. Browser actions validate document/reference,
      visibility, geometry, and DOM freshness; native actions validate observation,
      frame/display, window identity, scale, focus, and CUA bindings. Both validate
      limits and cancellation immediately before execution. A single browser/native
      lowest-common-denominator executor would erase these safety invariants and is
      deliberately not introduced.
- [x] Add a comparison mode in which one configured strategy is the executor and the
      other is shadow-only. Record agreement, disagreement, confidence, latency, and
      abstention without ever executing two competing actions on the same live screen.
- [x] Add persistent local configuration for enablement, strategy, model selection,
      environment profile, limits, and credentials. The normal development flow must
      not require exporting a key or model on every run.
- [x] Extend the TUI with strategy/environment readiness, live observe/propose/approve/
      act/verify activity, concise target and confidence details, and clear
      unavailable/aborted/ambiguous states. `/computer` provides a read-only inspection
      panel without starting CUA.
- [x] Add a bounded multi-step loop for the browser and Ubuntu/X11 paths. Each action
      requires approval, is followed by a fresh observation linked to its predecessor,
      and is limited by `LINA_COMPUTER_MAX_ACTIONS`; exhausting the limit returns
      `outcome-unknown` without automatic retry.
- [x] Record cancellation before input as a terminal failed run and cancellation after
      input as `outcome-unknown`; the runner emits the terminal evidence before
      propagating cancellation to the surrounding turn.
- [x] Produce bounded, inspectable metadata evidence for each computer-tool call and
      its ordered lifecycle events without placing raw screenshots or provider bodies
      in the transcript by default. The first run journal is implemented at
      `computer-runs/<run-id>/run.json` plus `events.jsonl`; it includes terminal
      status, strategy, environment, configured action limit, approval, action-request,
      and verification events.
- [x] Add bounded per-step observation metadata to ordered run events, including native
      display, dimensions, cursor position, image bounds, and foreground-window identity
      when the host supplies them. Provider proposal metadata is also retained; raw
      provider bodies remain excluded.
- [x] Add bounded replay/inspection metadata and retention controls for multi-step
      runs. `SessionStore.readComputerRunSummaries()` exposes a lossy projection and
      `/computer` renders recent IDs, status, and event counts; retention removes only
      old terminal journals within configured bounds.
- [x] Add safe links to immutable screenshot/observation artifacts. Capture is opt-in
      through `LINA_COMPUTER_ARTIFACTS_ENABLED`; source screenshots remain short-lived,
      copies are bounded by byte and dimension limits, sidecars are atomically published,
      references are managed-root-relative, and retention never removes active runs.
- [x] Document a small real-model/manual fixture flow that can be run from
      `pnpm run chat` or the disposable X11 launchers, including the replayable
      fake-environment test flow and opt-in artifact inspection.

## Explicitly out of scope

- Training, bundling, or claiming an on-device CoreML UI-segmentation model. The linked
  TypeSafe project currently uses local screen capture, Apple Vision OCR, and macOS
  Accessibility data; current TypeSafe documentation says Jev accepts text/JSON, not
  images. The perception seam must leave room for a future local segmenter without
  pretending that it exists now.
- CUA-S1-FORMS as a third general strategy, and CUA's optional `cua-perception` worker
  or model bundle. CUA-S1 is a narrow form specialist; the perception extension is a
  separately installed, model-neutral capability. Both remain future experiments and
  must not be implied by the first TypeSafe/Jev or native CUA implementation.
- Full native support for macOS, Linux, and Windows in this first slice. The shared
  contract and diagnostics may be cross-platform, but the implementation will name one
  real host profile and report other profiles as unavailable until their adapters are
  implemented and tested.
- A desktop application, remote node fleet, pairing service, cloud desktop, or
  personal-browser/CDP attachment. The initial surface is the standalone Lina CLI/TUI
  and an explicitly selected local environment.
- Replacing the existing managed browser tools. Browser semantic actions remain a
  separate tool capability; this slice may use a visible browser fixture inside the
  computer environment for testing, but it must not collapse the two contracts.
- Arbitrary JavaScript execution, clipboard/password-manager access, credential entry,
  purchases, publishing, account changes, file uploads, or irreversible actions without
  a dedicated policy and approval rule.
- Automatic fallback from TypeSafe to traditional or vice versa after a failed action.
  A later experiment may test an explicit fallback policy; this slice must preserve
  which strategy made each proposal.
- Exhaustive race, load, OS-compatibility, accessibility, adversarial-prompt,
  dependency, and operational hardening. Track those in the production-readiness gap
  register once the core path works.

## Finished behaviour

### User-visible behaviour

Before the first action, the TUI shows the selected strategy, model, environment,
display/session identity, visibility, and readiness. Each step is rendered as:

```text
observe → propose [strategy/confidence] → approval [target/action/scope]
      → execute → verify [changed/unchanged/unknown]
```

Read-only observation and `wait` may be shown without an approval prompt. Input,
navigation, and other side-effecting actions use the existing structured approval
surface, with the exact target, action, environment, risk, and limits visible. A user
can cancel with Ctrl+C; an emergency stop prevents future actions. The TUI never says an
action happened until the host adapter reports it, and reports `outcome-unknown` when a
timeout or crash prevents reliable confirmation.

The TypeSafe path displays the selected action and bounded confidence/probability
summary, while making clear that the probability is a model signal rather than an
approval decision. The traditional path displays the visual-model action and the
observation identity, without claiming the model saw or acted on data that was not
sent.

### Ownership and boundaries

```text
src/computer/contracts.ts       → observation, action, strategy, and evidence contracts
src/computer/environment/       → host capture, input, focus, permissions, and cleanup
src/computer/strategies/        → traditional vision and TypeSafe/Jev decisions
src/security/                   → risk policy, approval requirements, limits, redaction
src/tools/                      → model-facing computer tool schema and dispatch
src/runtime/                    → turn lifecycle, cancellation, retries, and recovery
src/telemetry/ and persistence/ → durable evidence and safe projections
src/cli/                        → readiness, approval, activity, and inspection UX
```

The environment adapter is the sole owner of native handles, display sessions, input
events, and cleanup. The strategy may propose an action but cannot execute it. Security
owns whether an action is eligible and approved. The runtime owns in-flight lifecycle
and cancellation. Persistence owns the durable computer run record. The TUI may read
safe projections and artifacts but may not mutate execution state directly.

Provider-specific APIs, TypeSafe SDK types, OCR libraries, and native desktop bindings
must remain inside their strategy or environment adapters. The generic tool and runtime
must consume the normalized contract while retaining provider-specific evidence.

## State, persistence, and evidence

One computer-use run belongs to one turn and has one selected strategy. The exact
directory name should follow Lina's existing state-root conventions; its contents are:

```text
computer-runs/<run-id>/
  run.json                 # strategy, environment, limits, outcome, timestamps
  events.jsonl             # current bounded lifecycle projection for one tool call
  observations.jsonl       # bounded metadata and redacted semantic state per step
  actions.jsonl            # proposal, approval, execution, verification, and outcome
  providers.jsonl          # provider-specific model IDs, confidence/probabilities, timing
  artifacts/               # planned richer per-run layout; current copies use state-root computer-artifacts/<run-id>/
```

The current implementation durably publishes `run.json` and `events.jsonl`. The
additional observation/action/provider JSONL files remain planned extensions. Opt-in
native screenshot copies are published separately under the state-root
`computer-artifacts/<run-id>/` directory with a PNG plus JSON sidecar; run events retain
only bounded metadata and a managed relative reference, and the inspection projection
does not expose raw event payloads or absolute paths.

- [x] Every bounded run, observation, proposal, and action has a stable ID and
      references its observation identity. Browser and native proposal, dispatch, and
      verification events now carry the exact observation ID that produced them.
- [x] Extend predecessor-observation links across the bounded multi-step loop. Each
      subsequent `observed` event carries `previousObservationId`; proposal events also
      retain the selected model, bounded decision latency, and Jev probabilities when
      available. Raw provider bodies and richer screen-artifact layouts remain separate
      work.
- [x] A target is bound to an observation/frame identity, display scale, bounds, and
      foreground target. Native runner actions carry the observed geometry and
      window/snapshot identity; CUA validates those bindings, rechecks live desktop
      dimensions and the top on-screen window when supported, and rejects stale
      geometry/window state before dispatch. A changing accessibility snapshot is
      reobserved rather than treated as an automatic retry.
- [x] Raw screenshots are opt-in artifacts with byte/dimension limits, managed-root
      relative references, atomic metadata sidecars, active-run protection, and
      retention cleanup. They are not copied into the model transcript by default.
- [x] TypeSafe state records the current candidate source (`browser` or
      `accessibility`), role, label, bounded location, and selected option. Traditional
      records image metadata and the model action without retaining unbounded prompt
      content. Browser and native proposal evidence now retains bounded source, role,
      label, and native accessibility frame metadata; raw screen/provider content
      remains excluded. OCR/visual candidates remain a later source addition.
- [x] Writes are append-only or atomically replaced according to the existing
      persistence rules. A partial record cannot become the active completed result.
- [x] On restart, an incomplete action is reconciled as `outcome-unknown` unless the
      adapter can prove it did not reach the host. It is never replayed automatically.

## Failure, retry, and recovery semantics

- [x] Read-only observation capture may be retried once within the run deadline when
      the first capture fails; no input is replayed and the caller signal remains the
      cancellation/deadline boundary.
- [x] Strategy decisions may be retried only before execution and with a bounded
      two-attempt default. Transient provider failures (timeouts, rate limits, and
      declared temporary provider/stream failures) emit bounded `decision_attempt`
      evidence and may retry once; malformed decisions, abstentions, cancellation,
      and every post-approval/native-input outcome are not retried.
- [x] An action is not assumed idempotent. A lost acknowledgement after input was sent
      yields `outcome-unknown`, stops automatic retry, and asks for inspection.
- [x] A stale target, changed display scale, changed foreground application, lost
      focus, missing permission, or invalid coordinate fails closed before input on
      the supported CUA path. CUA refusal and unavailable-driver errors remain
      distinct from stale-observation errors; provider error taxonomy is a later
      reinforcement item.
- [x] Cancellation stops new observations and actions, asks the host adapter to close
      or release resources, and records whether an in-flight action was definitely
      cancelled or may have been delivered.
- [x] Host-driver crash, display disappearance, provider timeout, malformed response,
      and confidence abstention have distinct error categories and TUI messages. The
      runner preserves these categories through `ComputerOutcome`, ordered run events,
      and the TUI activity lane; stale observations remain distinct as well.
- [x] Duplicate tool calls for one call identity are ignored or rejected according to
      the runtime's existing tool-call rules; the executor never repeats a committed
      action solely because an acknowledgement was duplicated.
- [x] Shadow comparison failure never blocks or mutates the primary executor unless
      the user explicitly selects a policy that says so. Disagreement is evidence.

## Security and configuration

- [x] Computer use is disabled by default and requires an explicit environment/profile
      selection. The default profile cannot attach to the user's personal desktop or
      browser profile.
- [x] Persistent development configuration supports the selected strategy and model,
      computer-specific timeouts and limits, but keys are read from `.env`/process
      environment, never written to evidence or displayed in the TUI. The repository
      keeps only `.env.example` placeholders. The computer tool has its own bounded
      `LINA_COMPUTER_DURATION_MS` deadline (30 seconds by default) rather than sharing
      the ordinary 10-second metadata-tool deadline.
- [x] Traditional mode refuses models without a verified vision/action capability.
      TypeSafe mode refuses a missing `TYPESAFE_API_KEY`, unsupported Jev request, or
      unavailable semantic observation source; there is no silent path substitution.
- [x] Screen content, OCR, accessibility labels, and model output are untrusted data.
      They cannot grant approval, change policy, escape the environment, or invoke an
      unlisted action.
- [x] Input text, URLs, keypresses, clicks, navigation, and file-transfer-like actions
      have explicit schemas and bounds. Password fields and secret-looking values are
      refused or redacted in the first slice.
- [x] Environment readiness reports required display/session permissions, backend
      identity, visibility, and isolation limitations before an action can run.
- [x] Resource limits cover total duration, action count, observation size, image bytes,
      semantic candidate count, text length, and provider request size.

## Implementation checklist

### 1. Contracts and configuration

- [x] Add bounded IDs and schemas for computer runs, observations, targets, actions,
      approvals, verification, and provider evidence.
- [x] Add strategy values `traditional`, `typesafe`, and `compare`, with an explicit
      primary strategy for compare mode. Validate limits and reject unknown values.
- [x] Add the `ComputerEnvironment` and `ComputerDecisionStrategy` seams without
      importing provider or native-host types into runtime/tool contracts.
- [x] Extend model request content only as needed for bounded image input; retain a
      truthful `vision` capability and reject unsupported providers/models.
- [x] Add persistent `.env` development settings and safe defaults with no per-run
      export requirement.

### 2. Core implementation

- [x] Implement readiness, start, observe, execute, verify, stop, and close lifecycle
      for one real disposable graphical host profile.
- [x] Implement the Ubuntu X11 host profile with Xephyr local viewing, Xvfb worker
      isolation, pinned input/capture backend checks, and an explicit cursor inclusion
      mode for screenshots or recordings. The launchers are development helpers; they
      do not claim to be a production sandbox or start arbitrary GUI applications.
- [x] Validate and pin the selected CUA-driver/backend dependency, record its native
      artifact/platform requirements, and keep the dependency behind the environment
      adapter so Lina remains portable when another backend is selected later.
- [x] Implement the first CUA integration boundary around exact session/generation
      and capture/target identity: Lina supplies bounded candidates and approval, CUA
      performs one admitted native action per fresh observation, and the adapter
      reobserves within the configured action budget. Preserve CUA refusal and
      outcome-unknown results; never downgrade to an unbound coordinate or silently
      escalate background delivery.
- [x] Implement the first native TypeSafe semantic boundary around CUA's window
      accessibility output: select an unambiguous visible window, bound roles,
      labels, actions, and tokens, bind the proposal to PID/window/snapshot
      identity, route the approved element token through the CUA window target, and
      abstain when semantic state is unavailable. This does not claim OCR or visual
      segmentation.
- [x] Implement shared action validation, observation/frame freshness, coordinate/target
      checks, limits, cancellation, and result classification.
- [x] Implement traditional screenshot/action parsing and bounded visual-model input.
- [x] Implement TypeSafe/Jev state assembly, focused Choice questions, response
      validation, confidence/risk gating, and deterministic target mapping.
- [x] Implement explicit free-text composition/clarification handling and post-type
      verification without treating Jev as a generator. Browser text is taken only
      from explicit user quotes, bounded to 1,024 characters, and credential-like or
      secret-looking values are refused; the fresh browser snapshot remains the
      verification boundary.
- [x] Implement shadow comparison with no second execution and provider-specific
      timing/probability evidence. Browser compare already required matching action
      IDs; native compare now requires traditional coordinates to fall inside Jev's
      exact accessibility frame from the same observation, otherwise it abstains
      before approval. Traditional vision is the current primary in both compare
      paths; an explicit alternate primary selector remains a follow-up.

### 3. Integration and user surface

- [x] Register one model-facing `computer` tool whose schema exposes only implemented
      actions and whose results are bounded, typed, and honest.
- [x] Connect the tool to runtime lifecycle events, approval, cancellation, deadlines,
      recovery, and existing tool-call deduplication.
- [x] Add TUI readiness and activity projections plus a concise `/computer` inspection
      surface. Preserve Ctrl+C and the existing approval interaction.

### 4. Documentation and learning material

- [x] Document the strategy/environment configuration in Lina's CLI and local setup
      guides, including one-time `.env` configuration and unavailable-host behaviour.
- [x] Document the architecture boundary and why Jev receives local semantic state,
      not screenshots, with links to the TypeSafe project and official docs.
- [x] Add a `development/playground/` walkthrough for one safe visible fixture and one
      replayable observation, clearly labelled as a hands-on inspection rather than a
      test or benchmark.
- [x] Record deferred OS, CoreML, security, and operations reinforcement in the
      production-readiness gap register rather than expanding this first slice.

## Test coverage

The first slice needs focused tests that prove the core path. Exhaustive platform and
adversarial reinforcement remains in the gap register and is not a reason to hold this
slice indefinitely.

### Unit tests

- [x] action schema, limits, coordinate/target bounds, display scale, and frame
      freshness, including live CUA desktop/window revalidation before dispatch
- [x] strategy configuration, capability checks, provider response validation, and
      truthful unavailable errors for the implemented traditional and TypeSafe paths
- [x] TypeSafe Choice candidate construction, `none`/no-match handling, probability and
      confidence recording, threshold/abstention, and stable target mapping across
      browser and native accessibility inputs. The native accessibility candidate,
      no-candidate, confidence threshold, and exact-token tests are covered; local
      OCR/visual candidates are outside this slice and remain deferred.
- [x] Indexed browser action-space construction, operation/target compatibility,
      snapshot identity, stale-page rejection, covered/occluded target rejection,
      invalid Jev output, and no-selector/no-coordinate execution guarantees
- [x] Explicit browser text composition requires quoted user text, refuses
      credential-like values, and records bounded text-length evidence without
      storing the text itself
- [x] Explicit browser keypress composition derives only supported keys from the
      user goal and routes them through approval-gated `browser_press` execution
- [x] Explicit browser wait and scroll composition derives only bounded values from
      the user goal, routes scroll through approval, invalidates prior references,
      and verifies both terminal outcomes from a fresh snapshot
- [x] traditional multimodal message serialization, action parsing, explicit
      `none` abstention, and malformed/unsupported response rejection
- [x] risk classification, approval projection, redaction, and secret handling for
      the implemented browser/native actions
- [x] bounded pre-approval decision retry for browser and native strategies, including
      transient-provider evidence, cancellation handling, and no retry after input
- [x] evidence serialization, bounded screenshots, deterministic IDs, and no transcript
      leakage for the current run journal and artifact store

### Integration tests

- [x] deterministic fake environment: observe → proposal → approval → action → fresh
      observation → verification
- [x] both strategies drive the same fake fixture to equivalent safe outcomes, while
      retaining separate provider evidence
- [x] compare mode executes only the primary strategy and records shadow agreement or
      disagreement
- [x] stale target, focus loss, display loss, provider timeout, malformed response,
      missing permission, low confidence, and approval denial
- [x] CUA adapter mapping for one-capture/one-action/reobserve within the action
      budget, session or generation mismatch, structured refusal, ambiguous native
      result, and no automatic
      background-to-foreground escalation
- [x] Native action journal records approval, dispatch, verification, terminal outcome,
      and restart recovery without replaying pre-dispatch or ambiguous input.
- [x] Computer-tool run journal records bounded ordered lifecycle events and terminal
      status, rejects cross-run or oversized event payloads, and redacts configured
      secrets. Opt-in native observation artifacts are bounded, immutable, retained
      separately, and linked only by safe relative metadata; richer step-level provider
      evidence remains separate work.
- [x] cancellation before execution, after a completed input, and during a blocked host
      dispatch is recorded with the correct failed versus `outcome-unknown` run status,
      with no automatic replay.
- [x] cancellation after an ambiguous native acknowledgement remains
      `outcome-unknown` and does not replay the input.
- [x] restart/recovery of an incomplete run, including no automatic replay and a clear
      `outcome-unknown` result. Recovery appends one idempotent run-level event before
      publishing the terminal status.
- [x] duplicate/out-of-order computer-run events are rejected, and the existing
      runtime call-identity rules prevent a committed tool call from being repeated.
- [x] real local backend smoke test on the declared Ubuntu/X11 profile: a disposable
      Xvfb display with a shared D-Bus session and X11 window manager enumerated the
      Chrome fixture, returned its accessibility tree, dispatched one exact element
      token, and observed the changed fixture state. The driver returned an uncertain
      acknowledgement, the verifier confirmed the state, and no retry was attempted.
      The launcher isolates HOME/XDG state before D-Bus activation. A host without
      the window-manager/AT-SPI prerequisites remains an explicit unavailable-host case.

### Manual acceptance checks

- [x] Configure one strategy and model once in `lina/.env`, then use the supported
      one-command native fixture path
      `pnpm run chat:cua-xvfb -- --fixture --window-manager gnome-shell` to complete a
      small safe task in a visible disposable fixture. The ordinary `pnpm run chat`
      path remains the normal console entry point when a caller supplies an already
      configured native host. The stored TypeSafe configuration completed this check;
      the traditional acceptance used the same command with a temporary Dots model
      override because the stored NVIDIA free route is currently capacity-limited.
- [x] Complete one real native TypeSafe task in the disposable Ubuntu/X11 fixture:
      Jev proposed the accessibility target, the structured TUI approval panel showed
      the target label, one `a` approval dispatched the token, and the fresh fixture
      observation verified success without retrying an uncertain CUA acknowledgement.
      The run used the stored credentials and the validated
      `cohere/north-mini-code:free` model, now saved as the local development default.
- [x] Repeat the same fixture with the other strategy and inspect the TUI's strategy,
      target, approval, action, verification, and timing output. The earlier
      `inclusionai/ling-3.0-flash-vl:free` attempt reached approval but selected a
      coordinate outside the fixture control; that remains evidence of safe failure,
      not acceptance. After both strategies moved to the exact foreground-window
      capture scope, the disposable Xvfb + GNOME + Chrome fixture completed with the
      live `dots-studio/dots-3-note-preview:free` route: the TUI showed the strategy,
      target, approval, action, and verification; one `a` approval dispatched the
      click; and fresh observation verified success after CUA reported an uncertain
      effect, without retry. The run used temporary diagnostic deadlines of 90 seconds
      because the free provider was slow. NVIDIA's stored free route still returned
      an upstream capacity error, and other catalogued routes remain rate-limited or
      rejected; the provider parser exposes those bounded nested errors. Traditional
      acceptance is therefore proven for one live provider route, while provider
      availability and model-specific grounding remain operational limitations.
- [x] Run compare mode and verify only the primary strategy changes the fixture while
      both proposals are visible in evidence. A live Xvfb + GNOME + Chrome run produced
      agreeing traditional and Jev proposals, showed both in the run evidence, used
      one `a` approval for the traditional primary action, verified the safe result,
      and sent no native input for the Jev shadow proposal. Earlier disagreement runs
      stopped before approval as intended.
- [x] Cancel with Ctrl+C and verify the run stops without claiming an unverified action.
      A live TypeSafe/X11 fixture run reached the structured approval panel; Ctrl+C
      cancelled the pending action, emitted `failed` before input, and did not dispatch
      or claim verification.
- [x] Inspect the run evidence and verify no API key, password, or unbounded screenshot
      entered the transcript or ordinary logs. A persisted disposable TypeSafe fixture
      run produced only bounded metadata/event records in the transcript and ordinary
      journals; the managed artifact directory held two bounded PNGs with sidecars,
      and a secret-pattern scan found no credential-like material.

## Required validation commands

```bash
pnpm --filter @agent-harness-lab/lina typecheck
pnpm --filter @agent-harness-lab/lina test
pnpm --filter @agent-harness-lab/lina coverage
git diff --check
```

The real backend smoke test requires the declared graphical host profile, its input/
capture permissions, and configured provider credentials. CI must use the fake
environment for deterministic coverage and report a missing real host as unavailable,
not as a passing real-backend result.

## Completion gate

Before moving this plan to `completed/`, verify:

- [x] Both selectable strategies perform real proposals through the shared lifecycle,
      approval, and evidence boundary, then use the appropriate real environment
      executor; no deterministic echo path is presented as computer use.
- [x] One declared host profile completes a visible, safe manual task through each
      available strategy, or the unsupported strategy/host is explicitly documented as
      unavailable with a concrete reason. The same isolated Ubuntu/X11 + GNOME + Chrome
      profile completed TypeSafe, traditional, and compare tasks; traditional and
      compare used the live Dots free route because the stored NVIDIA route returned a
      bounded upstream capacity error.
- [x] Approval, cancellation, stale-target protection, post-action verification,
      recovery, and bounded evidence are implemented and covered by focused tests.
- [x] Compare mode is shadow-only for the non-primary strategy.
- [x] TUI, configuration, docs, playground, and validation commands match the shipped
      behaviour.
- [x] Known platform and production-hardening limitations are recorded in the gap
      register.

## Commit discipline and handoff

- [x] Commit contracts/configuration, host/strategy implementation, and TUI/evidence as
      reviewable validated sections when practical.
- [x] Run the narrow validation relevant to each section before committing it.
- [x] Review `git status` and each diff; preserve unrelated `.anesu-trash` or user files.
- [x] Record changed files, validation results, real-backend prerequisites, and known
      limitations in the handoff.
- [x] Record implementation commit hashes in the completion record when the plan is
      archived.

### Current handoff snapshot

- **Implementation commits:** `d08ada8` adds the dual-path computer-use slice,
  `837f0a7` adds provider-response compatibility for bounded rationales, explicit
  `x_abs`/`y_abs` aliases, and normalized coordinates, `2382ddd` accepts equivalent
  canonical/alias coordinates while rejecting conflicting duplicates, and `cc7f42`
  clarifies the traditional vision coordinate context and bounded observation payload.
  `3ef9209` aligns native vision with CUA window frames; the archive commit for this
  plan adds Linux AT-SPI frame normalization and records live compare acceptance.
- **Changed implementation surface:** `lina/src/computer/`, the Lina runtime/config,
  TUI and tool wiring, disposable Xvfb/Xephyr launchers, focused computer tests, the
  computer-use playground, research notes, and the active plan/gap register. The
  follow-up commit touched only the native runner, its focused tests, its README, and
  this plan.
- **Validation:** `pnpm --filter @agent-harness-lab/lina typecheck` passed;
  `pnpm --filter @agent-harness-lab/lina test` passed all 500 tests after the latest
  window-frame regression;
  `pnpm --filter @agent-harness-lab/lina coverage` passed with 89.59% line,
  76.57% branch, and 86.08% function coverage; scoped `git diff --check` passed.
- **Real-backend prerequisites:** Linux/X11, an isolated `DISPLAY`, Xvfb or Xephyr,
  xauth, `dbus-run-session`, Chrome, an AT-SPI-capable application/window manager,
  and configured TypeSafe/OpenRouter credentials as required by the selected strategy.
- **Acceptance evidence:** the same isolated Ubuntu/X11 + GNOME + Chrome profile has
  live successful TypeSafe, traditional, and compare runs. The successful traditional
  and compare runs used `dots-studio/dots-3-note-preview:free` with temporary 90/120
  second diagnostic deadlines; the stored NVIDIA free route remains capacity-limited,
  while other free routes may be rate-limited, rejected, or visually unreliable.

## Completion record

**Completed:** `2026-09-20T15:00:24+02:00`
**Commits:** `d08ada8`, `837f0a7`, `2382ddd`, `cc7f42`, `3ef9209`, `0b8e61d`

### Validation

- `pnpm --filter @agent-harness-lab/lina typecheck` — passed.
- `pnpm --filter @agent-harness-lab/lina test` — passed, 500 tests.
- `pnpm --filter @agent-harness-lab/lina coverage` — passed, 89.59% line,
  76.57% branch, and 86.08% function coverage.
- `git diff --check` — passed for the scoped implementation and plan changes.
- Live TypeSafe fixture — Jev selected the exact accessibility target; one `a`
  approval dispatched it; fresh observation verified success after an uncertain CUA
  acknowledgement; no retry was sent.
- Live traditional fixture — the Dots vision route proposed a window-local click;
  one `a` approval dispatched it; fresh observation verified success after an
  uncertain CUA acknowledgement; no retry was sent.
- Live compare fixture — traditional and Jev proposals were both recorded; their
  target agreement allowed one primary approval and one traditional click; fresh
  observation verified success; Jev remained shadow-only and sent no input.

### Known limitations

- The stored NVIDIA free route remains subject to an upstream capacity error. The
  successful traditional and compare checks used the live Dots free route with
  temporary longer diagnostic deadlines; provider availability and visual grounding
  quality remain model-dependent.
- The shipped host slice requires Linux/X11, an isolated display, Xvfb or Xephyr,
  `dbus-run-session`, Chrome, and an AT-SPI-capable window manager/application.
- Arbitrary-application goal verification, local OCR/segmentation, richer artifact
  layouts, and exhaustive production hardening remain in the gap register; this plan
  intentionally closes the initial dual-path implementation slice only.

### Historical-scope note

This plan records the first dual-path computer-use slice. Later work may replace a host
adapter, add a local segmenter, or remove one strategy after comparable evidence, but
those changes must update the current source of truth rather than silently changing this
completion record.
