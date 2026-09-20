# Computer-use implementation research

**Reviewed:** 2026-09-18
**Scope:** whether Anesu can add computer use, what the runtime actually needs, and
whether OS drivers are required
**Evidence boundary:** official provider documentation and primary project
documentation; this note is a design input, not evidence that a future Anesu
implementation is complete

For the Ubuntu-specific pointer, display, and cursor-capture decision, see the focused
[Ubuntu visible computer-use pointer research](ubuntu-computer-use-pointer.md).

## Short answer

Computer use is achievable from this repository. The first implementation does not
need a kernel driver or a custom operating-system driver. It needs a user-space
computer adapter that can:

1. capture a bounded screenshot of a controlled display;
2. receive a structured action from the model;
3. validate policy, limits, and approval;
4. execute the action through a desktop or browser automation backend; and
5. return the resulting observation to the model so the loop can continue.

The important prerequisites are an available graphical session or virtual display,
an input-control backend, platform permissions, and isolation. A driver can be one
possible backend detail on some systems, but it is not the defining requirement.

## How computer use actually works

The model does not directly control the host. The application owns the loop and
executes the model's requests:

```text
user task
  -> model request with computer capability
  -> screenshot and/or other observation
  -> model emits structured actions
  -> Anesu validates and approves the action
  -> adapter performs the action in the controlled environment
  -> Anesu captures the new screen and result
  -> model receives that result and continues or finishes
```

OpenAI describes two integration shapes: code execution, where the model writes
code using a library such as Playwright or PyAutoGUI, and a computer tool, where the
model returns structured mouse and keyboard actions that the application translates
into browser or operating-system input. The current computer-tool action surface
includes click, double-click, drag, move, scroll, keypress, type, wait, and
screenshot. The caller executes permitted actions in order and returns a new
screenshot for the next model step. [OpenAI Computer use](https://developers.openai.com/api/docs/guides/tools-computer-use)

Anthropic documents the same client-owned loop. Claude returns client-tool calls
such as `screenshot`, `left_click`, and `type`; the application dispatches each call
in order in its container or virtual machine, returns an image for screenshot
results and an acknowledgement for input results, and continues until Claude stops
calling the tool. [Anthropic Computer use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)

This means “computer use” is primarily an observation/action protocol plus an
execution environment. It is not a special local process that the model launches by
itself.

## Does it require OS drivers?

Usually, no.

There are three practical execution levels:

| Level | Observation and control | Driver requirement | Appropriate use |
| --- | --- | --- | --- |
| Browser semantic control | Accessibility/DOM snapshot, locator actions, browser screenshot | No custom OS driver | Normal websites and web applications |
| Browser pixel control | Viewport screenshot plus coordinates through the browser automation API | No custom OS driver | Canvas, maps, image editors, controls missing from the accessibility tree |
| Desktop control | Full-display screenshot plus user-space mouse/keyboard/window APIs | No universal driver; platform permissions/session are required. Some Linux backends may use a privileged input facility such as `uinput` | Native applications and interfaces outside the browser |

Playwright's own documentation illustrates the distinction: its normal MCP path
uses the accessibility tree and element references, while its vision mode uses
screenshots and coordinate-based mouse commands for canvas and other pixel-only
interfaces. Playwright exposes keyboard, mouse, and screenshot APIs directly.
[Playwright MCP](https://playwright.dev/docs/next/getting-started-mcp),
[Playwright actions](https://playwright.dev/docs/next/input),
[Playwright vision mode](https://playwright.dev/agent-cli/vision-mode)

For whole-desktop control, user-space libraries can send mouse and keyboard input
and capture the screen. PyAutoGUI is one example that documents cross-platform
mouse/keyboard automation and screenshots on Windows, macOS, and Linux. It has
limitations, including primary-monitor-only support in its documented FAQ, which is
why an Anesu adapter must declare its display/session assumptions instead of
pretending that all desktops are equivalent. [PyAutoGUI documentation](https://pyautogui.readthedocs.io/en/latest/)

The actual platform requirements are therefore more likely to be:

- Linux: a running X11 or Wayland graphical session, a capture/input backend, and
  any required user permissions; a headless worker normally uses a virtual display
  such as Xvfb. The backend may use a user-space command or library and should be
  treated as an optional platform dependency.
- macOS: a logged-in graphical session and the relevant Accessibility and Screen
  Recording permissions for the controlling process.
- Windows: an interactive desktop/session and the relevant user-input and screen
  capture APIs/permissions.
- Any platform: reliable display dimensions, device-pixel-ratio/scale handling,
  foreground-window ownership, cancellation, and a way to prove or report whether
  an action stopped.

A custom kernel module would increase the security and operational burden and is not
needed for the initial Anesu slice. If a backend later needs a low-level facility,
that should remain behind the adapter boundary and be explicitly documented as an
optional host capability.

## Browser interaction is not the same as whole-desktop computer use

Anesu already has a browser module at `anesu/src/browser/`. It owns an isolated
Playwright session, bounded screenshots, accessibility-oriented snapshots, short
life element references, navigation policy, action approval, download/upload
handling, cancellation, crash classification, and durable browser evidence. Its
model-facing tools include `browser_snapshot`, `browser_click`, `browser_type`,
`browser_press`, and `browser_screenshot`.

That is a strong first computer-interaction surface, but it is intentionally not a
desktop environment. The existing browser adapter can target elements by a fresh
semantic reference and fingerprint them before acting. Whole-desktop computer use
normally has only pixels and coordinates, unless a platform accessibility tree is
added. Coordinates can become invalid after a window moves, a display scale
changes, a dialog appears, or the foreground application changes. Desktop actions
therefore need stricter focus/target checks and more frequent post-action
observations.

The implementation should preserve both surfaces:

```text
browser interaction: semantic observation -> bounded browser action
desktop computer use: screenshot/accessibility observation -> bounded OS action
```

Desktop computer use should not replace the existing browser tools or force every
model/provider to use screenshots when semantic browser control is available.

## Security and reliability implications

Both provider references treat computer use as a high-risk capability. OpenAI says
to isolate the environment, treat screen content as untrusted, confirm
consequential actions, bound the run, support cancellation, and verify the actual
outcome. It specifically treats typing sensitive information as data transmission.
Anthropic recommends a dedicated VM or container with minimal privileges, avoiding
sensitive data, limiting network access, and requiring human confirmation for
meaningful consequences; it also calls out prompt injection in pages and images.
[OpenAI safety guidance](https://developers.openai.com/api/docs/guides/tools-computer-use),
[Anthropic security considerations](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)

For Anesu, a reasonable first desktop slice should therefore enforce:

- a dedicated, explicitly selected display/session rather than attaching to the
  user's personal desktop by default;
- a bounded screenshot size, capture rate, action count, run time, and artifact
  retention policy;
- no implicit access to the user's clipboard, password manager, personal browser
  profile, or arbitrary files;
- explicit approval for click, type, keypress, drag, file transfer, navigation, and
  any action that can submit, purchase, publish, delete, or grant consent;
- revalidation of the display/session and target immediately before execution;
- fail-closed handling when the display disappears, the target is stale, or focus
  cannot be established;
- cancellation that stops future actions but reports an action as ambiguous if it
  may already have reached the external application;
- redaction or controlled retention for screenshots, because a screen can contain
  secrets even when the model did not request them; and
- durable action/evidence records containing the action identity, observation
  identity, target coordinates or semantic target, approval decision, execution
  result, and verification observation.

The model's screenshot is observation data, not authorization. Text visible on the
screen must never grant permission or override Anesu policy.

## Fit with the current Anesu architecture

The repository already has useful plumbing:

- `anesu/src/browser/` provides the semantic browser precedent and a library-neutral
  adapter seam;
- `anesu/src/process/` provides bounded real-process execution and cancellation
  semantics;
- `anesu/src/workspace/` and `anesu/src/security/` provide workspace boundaries,
  mutation approvals, resource limits, and evidence redaction;
- `anesu/src/runtime/` owns tool rounds, persistence, recovery, and lifecycle
  events;
- `anesu/src/context/` owns bounded model-visible context and source accounting; and
- `anesu/src/cli/` owns the interactive approval and TUI surface.

The missing pieces are a desktop observation/action contract and a model/provider
path that can carry image observations and recognize the chosen computer-use action
format. The current OpenRouter provider is a streaming Chat Completions adapter
whose capabilities declare `vision: false`; its tool surface is ordinary function
calls. That is enough for a future custom desktop tool only if a selected model can
understand image content and emit the agreed action schema. It is not equivalent to
support for a provider-native computer-use tool.

Provider-native computer use also varies by API. OpenAI's current guide exposes a
Responses API `computer` tool and `computer_call` action batches; Anthropic exposes a
client toolset whose application executes member calls. These should be represented
as provider adapters, not leaked into the generic desktop executor.

## Recommended implementation boundary

When we implement this, the first slice should be deliberately narrow:

1. Add a model-neutral `ComputerAdapter` contract for `observe`, `click`, `type`,
   `keypress`, `scroll`, `wait`, and close/lifecycle operations. Keep drag and window
   management behind explicit capability flags until the first backend justifies
   them.
2. Add one local backend for one supported environment, preferably a disposable
   Linux display/VM path. Do not attach to the contributor's normal desktop as the
   default.
3. Add a tool orchestration layer that validates action schema, coordinate bounds,
   display identity, step/time limits, approval, cancellation, and post-action
   observation.
4. Add an image-capable model request/result representation without changing the
   existing text-only provider contract for providers that do not support images.
5. Persist bounded action and observation metadata, while making raw screenshots
   opt-in/managed artifacts rather than unbounded transcript content.
6. Test the adapter with a deterministic fake display and a small real-backend smoke
   test where the environment is available. Cover normal action execution, invalid
   coordinates, stale/focus changes, approval denial/unavailability, cancellation,
   display crash, duplicate/lost acknowledgement, screenshot bounds, redaction, and
   restart recovery. The fake display validates orchestration; it does not prove
   model accuracy.

This is achievable without OS-driver work. The hard part is not physically moving a
mouse; it is maintaining a trustworthy observation/action boundary around a very
powerful side effect. The existing browser slice gives Anesu a good pattern for that
boundary, but desktop control should remain a separate capability with a stricter
environment and approval contract.

## TypeSafe/Jev computer-use project

This section is based on the linked project’s source and README, plus the official
TypeSafe documentation and JavaScript SDK reference. It describes what the project
actually implements; the screenshot’s “CoreML segments every button” wording should
not be treated as a description of this repository.

### What Jev receives

Jev receives text-only structured state. The project’s `decide.py` builds a state
object containing the goal, current app and browser URL, focused-field metadata,
recent actions, OCR/accessibility items in reading order, and optional off-screen
controls. It then sends three or four `Choice` questions in one `system_one` request:
the action kind, the selected on-screen item, the selected site, and—when present—the
selected off-screen control. The project does not send the screenshot image to Jev.
[Project decision code](https://raw.githubusercontent.com/awlevin/typesafe-computer-use/main/typesafe_computer_use/decide.py)

This matches the official TypeSafe contract: System One evaluates text, JSON objects,
and arrays of text; Jev does not currently accept images, audio, or video. The
JavaScript SDK uses `TypeSafeClient.systemOne({ state, questions })`, with typed
questions such as `choice(...)` and a `TYPESAFE_API_KEY` environment variable.
[TypeSafe System One](https://docs.typesafe.ai/concepts/system-one),
[TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)

### How perception is assembled

The project has a local macOS perception pipeline:

1. `screencapture` captures the main display, or a saved PNG is loaded for replay.
2. Apple Vision OCR through `ocrmac` turns a bounded region into text lines with
   confidence and pixel boxes. The implementation crops to the frontmost window and
   can reuse OCR for unchanged tiles.
3. macOS Accessibility (`AXUIElement`) supplies labelled actionable controls,
   focused-field metadata, frames, and references for direct `AXPress`/value updates.
4. OCR blocks and AX controls are merged into numbered items, retaining their source
   (`ocr`, `ax`, or `ax+ocr`) and coordinates.

The repository contains no CoreML UI-segmentation model or general visual button
detector. Its current implementation depends on Apple Vision OCR plus AX metadata;
the README explicitly describes non-Apple OCR and xdotool/AT-SPI as future port
directions. [Project perception code](https://raw.githubusercontent.com/awlevin/typesafe-computer-use/main/typesafe_computer_use/perception.py),
[project macOS adapter](https://raw.githubusercontent.com/awlevin/typesafe-computer-use/main/typesafe_computer_use/macos.py)

“No screenshots leave my Mac” therefore means the screenshot is processed locally
and is not sent to a frontier vision model. It does not mean that no local screen
capture occurs. The linked project still requires Screen Recording permission for
capture and Accessibility permission for synthetic input/AX operations.

### How probabilities and actions work

Each `Choice` answer returns the selected `choice`, a full probability distribution
over every offered option, and `confidence`. The project combines the relevant
confidence values—for example, action-kind confidence and item confidence—using the
minimum, then stops or abstains below its configured floor. TypeSafe documents that
`confidence` summarizes the probability distribution; it is not authorization to
perform a consequential action. [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice),
[TypeSafe confidence guidance](https://docs.typesafe.ai/confidence)

Jev does not return mouse events or click coordinates. The project’s deterministic
action layer maps the selected item index to either an AX press or a coordinate click,
and maps fixed action names to AppleScript, Quartz keyboard/mouse/scroll events, or
accessibility value updates. Free text is a separate concern: an optional Anthropic
writer composes text or an unknown URL; Jev’s classifier does not generate it. The
project validates URLs, refuses password entry, verifies typed-field results with a
TypeSafe `Noul`, and clears the field when verification fails.
[Project action code](https://raw.githubusercontent.com/awlevin/typesafe-computer-use/main/typesafe_computer_use/actions.py)

### Runtime, platform, and dependency requirements

The linked repository currently targets macOS only: macOS 14+, Python 3.12+, and
`uv`. Its declared runtime dependencies are `typesafe-sdk==0.6.0`, `ocrmac==1.0.1`,
PyObjC ApplicationServices and Quartz bindings, and `anthropic==1.6.0`; pytest and
ruff are development dependencies. `TYPESAFE_API_KEY` is required for every Jev
decision. `ANTHROPIC_API_KEY` is optional and only supports writer-proposed free text
or URLs. [Project pyproject.toml](https://raw.githubusercontent.com/awlevin/typesafe-computer-use/main/pyproject.toml)

The project uses Quartz for screenshot capture and synthetic input, Application
Services for AX discovery/press/value operations, and AppleScript for frontmost-app,
browser, and URL operations. It has a CLI with dry-run and `--act` modes, step/time
limits, a confidence floor, Ctrl-C and top-left-corner aborts, annotated captures,
payload dumps, per-answer probabilities, and replay from saved images. Its own
metadata labels the project as alpha and lists limits including one main display,
uneven AX coverage, duplicate-label ambiguity, and focus contention. [Project README](https://github.com/awlevin/typesafe-computer-use)

### Comparison with the local Hermes/OpenClaw maps

The local Hermes map shows a model-facing `computer_use` tool backed by a swappable
`cua-driver` session, with approval and cross-platform host execution. The local
OpenClaw map shows a paired node/desktop-worker boundary, `screen.snapshot`,
`computer.act`, stale-frame checks, and a node-local CUA provider. Both therefore
separate perception/model decisions from the process that owns desktop input.

The TypeSafe project fits as a third perception/decision strategy, not as a complete
desktop driver replacement. Its fast path still needs a platform adapter for capture,
AX/OCR, focus, and input. Its distinctive contribution is converting a bounded local
screen representation into typed, probabilistic choices instead of sending each
screenshot to a large vision model. A future dual implementation should compare it
with the traditional screenshot/vision strategy behind the same executor and approval
boundary, while recording provider-specific state, probabilities, timing, and
abstentions separately. The second strategy must be shadow-only during comparison;
both strategies must never execute competing clicks against the same live screen.

## CUA's `jev-use` and CUA-S1 resources

The CUA repository now provides a maintained reference for the same separation. Its
public-preview `jev-use` recipe puts TypeSafe Jev outside Cua Driver: the application
constructs bounded candidate IDs, Jev chooses one supplied ID, Cua Driver executes the
resolved action, and an independent fixture state check verifies completion. The
recipe supports deterministic mock runs without credentials and optional live Jev
runs; it does not treat a model response or driver acknowledgement as proof of
success. [CUA `jev-use` guide](https://cua.ai/docs/how-to-guides/driver/jev-use),
[local CUA `jev-use` source](https://github.com/trycua/cua/tree/main/libs/cua-driver/examples/jev-use)

The same repository also contains CUA-S1-FORMS, a separate research-stage specialist
model. It scores bounded form options such as supplied document values, `check`,
`click`, and `skip` in one pass; it does not generate arbitrary text or general
desktop actions. Its model card reports a narrow form scope, synthetic training plus a
small real evaluation, and no claim of general computer-use capability. [CUA-S1 source](https://github.com/trycua/cua/tree/main/libs/cua-s1),
[CUA-S1 model card](https://huggingface.co/cua-ai/cua-s1-forms)

This gives Anesu two useful conclusions:

- adopt the `jev-use` boundary now: CUA owns capture, target binding, native dispatch,
  and verification; Anesu owns provider selection, candidate construction, approval,
  cancellation, and orchestration;
- keep CUA-S1-FORMS out of the first general computer-use slice, but preserve a
  future specialist-provider seam. Its dry-run default, explicit execute/submit
  gates, snapshot-bound tokens, abstain/reobserve choices, fail-closed handling, and
  independent postconditions are good implementation patterns for Anesu even before
  we add the model itself.

The local CUA checkout contains the CUA-S1 source and tests but does not contain model
weights. A future local specialist integration must pin the exact checkpoint, verify
its safetensors/JSON integrity and licensing, and never download or load an untrusted
model artifact inside a privileged driver process.

## Browser-use `jev-ultrafast`

`browser-use/jev-ultrafast` is an immediately relevant browser-only reference for
Anesu's first computer-use stage. It is not a native desktop driver and should not
replace CUA Driver. It connects to an owned Chromium target through Browser Harness
and builds a dynamic, indexed action space from the current DOM/accessibility-like
state. The available operations are constrained to observed capabilities such as
`CLICK`, `TYPE_TEXT`, `SELECT`, scrolling, waiting, `DONE`, and `BLOCKED`; target
choices are offered only for the selected operation. [Repository README](https://github.com/browser-use/jev-ultrafast)

The strongest ideas to carry into Anesu are:

- perform one atomic browser snapshot and retain code-owned DOM node identity;
- ask Jev for an operation and then an operation-compatible target from that same
  bounded observation;
- never let model output become a selector, coordinate, JavaScript expression, or
  shell command;
- revalidate page freshness, node identity, visibility, disabled state, geometry,
  and hit-test/occlusion immediately before input;
- consume a decision before mutation so a retry cannot double-click;
- keep the text helper separate from Jev and require a small validated JSON response;
- use short, bounded waits for UI settling rather than sleeping after every action; and
- verify `DONE` with independent task state rather than trusting the selected choice.

The implementation is small enough to study directly: [dynamic action-space and
choice construction](https://raw.githubusercontent.com/browser-use/jev-ultrafast/main/jev_ultrafast/model.py),
[atomic DOM snapshot and guards](https://raw.githubusercontent.com/browser-use/jev-ultrafast/main/jev_ultrafast/snapshot.js),
and [freshness/occlusion-checked execution](https://raw.githubusercontent.com/browser-use/jev-ultrafast/main/jev_ultrafast/browser.py).

It should influence the Anesu browser strategy, but it should not be added as a
runtime dependency in this slice. The project is Python-based, uses Browser Harness
and CDP, assumes an owned Chrome profile, and has a deliberately limited MVP surface:
shadow roots, frames, canvas, uploads, popup tabs, nested scrolling, and arbitrary
keyboard widgets remain outside its stated coverage. Anesu already has a managed
Playwright browser and a TypeScript/pnpm runtime, so we should port the contracts and
tests into our existing adapter rather than introduce a second browser control stack.

Its published performance comparison is also appropriately bounded: the README
reports a 25% median reduction in one repeated Google Flights task and fewer browser
protocol calls, while explicitly saying that this is not a general reliability
benchmark. [Performance measurements](https://github.com/browser-use/jev-ultrafast/blob/main/docs/performance.md)

The resulting decision is: use `jev-ultrafast` as the primary reference for improving
Anesu's TypeSafe/Jev browser path; use CUA Driver as the native host executor for the
later Ubuntu desktop path; and keep the traditional vision path as the separate
comparison strategy. These are complementary layers, not competing implementations.

### Evidence boundary

The linked project is a small, macOS-specific alpha implementation, not evidence of
cross-platform support or production readiness. Its README reports measured latency
and cost for its own workload; those figures should be reproduced rather than copied
as Anesu benchmarks. Its open issues also identify accessibility coverage and OCR
portability as unfinished areas. [Project issues](https://github.com/awlevin/typesafe-computer-use/issues)

## Hermes and OpenClaw: CLI versus desktop

The checked-out reference implementations do not make the same product choice.

### Hermes

Hermes exposes `computer_use` as an agent tool in its normal model/tool loop. That
means a turn started from the Hermes TUI or CLI can call the tool; the desktop app
and gateway are additional surfaces for starting or managing the same capability.
The CLI also has explicit operational commands such as:

```text
hermes computer-use install
hermes computer-use status
hermes computer-use doctor
hermes computer-use permissions status
```

The relevant local code is `tools/computer_use/tool.py`,
`tools/computer_use/cua_backend.py`, and `hermes_cli/subcommands/computer_use.py`.
Hermes uses `cua-driver` as a cross-platform backend and keeps approval in the
agent-facing CLI/TUI path. Its `computer_use` tool is therefore not desktop-app-only.
The desktop app provides a more convenient place to configure and diagnose the
driver and OS permissions, but the agent loop can be driven from a terminal.

### OpenClaw

OpenClaw makes a stronger host-boundary distinction. Its built-in `computer` tool
acts through the node command `computer.act`; the connected node must advertise
both `computer.act` and `screen.snapshot`. The node-local provider executes the
action in the desktop session. The CUA implementation is an optional
`extensions/cua-computer` node-host plugin, not a generic shell command or a
model-facing raw MCP endpoint.

The OpenClaw CLI is still used for operational work such as node pairing,
approval, configuration, and health checks. But the desktop action itself is
performed by the paired node or a bound cloud/worker desktop. On macOS, the
OpenClaw desktop app owns the bundled CUA daemon so the native Accessibility and
Screen Recording grants belong to the process that actually captures and controls
the display. The local source and documentation are
`docs/nodes/computer-use.md`, `extensions/cua-computer/index.ts`, and
`extensions/cua-computer/src/commands.ts`.

So the accurate summary is:

| Project | Can the agent be started from CLI/TUI? | Where desktop input is executed |
| --- | --- | --- |
| Hermes | Yes; `computer_use` is in the normal tool loop | The Hermes host process starts/owns a `cua-driver` backend; the desktop app is an additional management and permission surface |
| OpenClaw | Yes, but the computer capability is routed through the agent/gateway contract | A paired node or bound desktop worker; on macOS the desktop app owns the native CUA daemon and permission identity |

## Why products often show computer use as desktop-only

“Desktop-only” usually describes the execution environment or permission owner,
not the model loop. The reasons are practical:

1. **A terminal often has no usable desktop.** A CLI may run over SSH, in a CI
   process, with no `DISPLAY`, on a locked screen, or without a foreground window.
   Input injection and screen capture then cannot be performed. A headless setup
   needs a disposable VM or virtual display, such as Xvfb, instead.
2. **OS permission is identity- and session-sensitive.** macOS grants control and
   screen capture to an application identity. Windows and Linux similarly have
   interactive-session, foreground-window, integrity, compositor, or display
   constraints. A desktop app is a natural owner of these permissions and can show
   the user what is being controlled.
3. **Safety is easier to make visible.** A desktop surface can show readiness,
   active provider, target display, approval state, screenshots, stop/cancel, and
   permission prompts. That reduces the chance that a terminal process silently
   drives the user's personal desktop.
4. **Native packaging is non-trivial.** Computer use may require architecture- and
   platform-specific binaries, daemons, sockets, accessibility bridges, and cleanup.
   A signed desktop app can package and update those pieces and preserve the correct
   permission chain.
5. **The model needs image-capable transport.** A CLI that only sends text and
   ordinary function calls cannot implement screenshot-driven computer use. It needs
   an image-capable provider contract or provider-native computer tool in addition
   to the local executor.

This does not mean Anesu must start with an Electron app. Anesu can start with a
CLI/TUI-controlled disposable desktop backend, provided it clearly reports whether
it is using a real interactive display or a virtual one. The CLI should not silently
attach to the contributor's personal desktop. A later desktop UI can improve
permission setup and visibility without changing the core observe/approve/act
protocol.
