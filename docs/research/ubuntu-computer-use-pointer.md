# Ubuntu visible computer-use pointer research

**Reviewed:** 2026-09-19
**Scope:** visible cursor movement, pointer input, screen capture, and isolation for
Anesu computer use on Ubuntu 24.04
**Evidence boundary:** Ubuntu/X.Org/Wayland/kernel documentation, Playwright and
FFmpeg documentation, the local Hermes/OpenClaw implementations, and a direct review
of the local CUA Driver checkout at `/home/enoch/aworkspace/agents/cua` (revision
`9bbfa7dd3`). This note is a design input; it is not evidence that Anesu already has
the described native backend.

## Conclusion

For the first Ubuntu implementation, Anesu should use an isolated X11 graphical
session, preferably through the maintained CUA Driver Linux backend, and expose that
session through a visible nested window or a protected VNC/noVNC viewer. The action
executor should move a real pointer, click, drag, scroll, and type through the host
session. Screen observations should be captured from the same session with cursor
position and display geometry recorded, and with the cursor included in recordings or
explicitly represented in the observation metadata.

Wayland should be a separate later backend. Its supported route is compositor-mediated
RemoteDesktop/libei input, not a generic X11 utility pointed at an XWayland window.
The current local machine is already running Ubuntu 24.04.4 LTS on an X11 session with
`DISPLAY=:1`; `Xvfb` and `Xephyr` are installed, while `xdotool`, `ydotool`, and
`gnome-remote-desktop` are not currently installed.

## What “visible cursor use” actually requires

There are three separate requirements that are easy to conflate:

1. **Pointer injection:** the host receives motion, button, drag, scroll, and keyboard
   events.
2. **Pointer rendering:** the controlled display or viewer paints a cursor that a human
   can see moving over the browser or desktop.
3. **Pointer observation:** screenshots or recordings retain either the cursor image or
   enough position metadata to reconstruct where it was when the action occurred.

An implementation can satisfy one without satisfying the others. For example,
Playwright's `page.mouse.move()` dispatches browser `mousemove` events in CSS viewport
pixels, and `page.mouse.click()` dispatches browser mouse actions. Those are useful for
web interaction but do not establish that the Ubuntu desktop pointer moved or that a
browser screenshot contains a cursor. [Playwright Mouse API](https://playwright.dev/docs/next/api/class-mouse)
and [Chrome DevTools `Input.dispatchMouseEvent`](https://chromedevtools.github.io/devtools-protocol/1-3/Input/)
describe page-level input, not OS-level pointer control.

The current Anesu browser POC uses this semantic browser path: it selects a managed
element reference and calls the browser adapter. The browser is visible and the page
changes, but there is no first-class OS cursor movement in that path.

## Ubuntu execution choices

### X11 and XTEST

X11 is the simplest first target for a controlled Ubuntu display. The XTEST extension
can synthesize motion, button, and keyboard events; its specification defines fake
motion events that move the pointer on an X screen. [XTEST extension](https://www.x.org/docs/Xext/xtest.pdf)

`xdotool` is a command-line wrapper around XTEST and Xlib. Its source documentation
supports absolute and relative pointer movement, clicks, button press/release, mouse
location queries, and synchronization after a move. It also explicitly warns that it
does not work correctly on Wayland. [xdotool documentation](https://github.com/jordansissel/xdotool)

For Anesu, XTEST or a maintained CUA Driver backend should remain inside the environment
adapter. The model must receive typed actions such as `move`, `click`, and `drag`; it
must not be allowed to choose a shell command, display name, native device, or helper
binary.

### Xvfb for an isolated display

Xvfb is an X server with no display hardware or physical input devices. It is designed
for testing and can run a complete window manager and browser in a separate display.
Its `-fbdir` framebuffer files include the cursor image, which is useful for controlled
capture. [Ubuntu Xvfb manpage](https://manpages.ubuntu.com/manpages/resolute/man1/Xvfb.1.html)

Xvfb is safe and reproducible for automated tests, but it is not visible by itself. To
let a human watch it, Anesu would need a view-only or authenticated VNC/noVNC surface,
or a separate capture/streaming layer. The viewer must preserve cursor position and
shape rather than rendering a static screenshot only.

### Xephyr for local visual development

Xephyr runs a nested X server inside a window on an existing X display. It is a useful
local development mode because the controlled Chromium and its pointer live on the
nested display while the contributor watches the Xephyr window. [Ubuntu Xephyr manpage](https://manpages.ubuntu.com/manpages/jammy/man1/Xephyr.1.html)

The host display must not become the action target. The environment adapter should
launch Chromium, the window manager, and the input backend with the nested `DISPLAY`,
record the nested display identity, and refuse actions if the display/session changes.

### VNC and cursor delivery

For a remote or headless Ubuntu worker, an X11 VNC server can export the isolated
display. `x11vnc` documents XTEST input injection and XFIXES-based cursor-shape
retrieval. Its cursor-position and cursor-shape modes are relevant when the goal is a
human-observable pointer rather than a page-only screenshot. [x11vnc project documentation](https://github.com/LibVNC/x11vnc)

For recordings made directly from X11, FFmpeg's `x11grab` input has a `draw_mouse`
option that controls whether the mouse pointer is drawn into captured frames. This is
appropriate for evidence video, but it does not replace the live display's pointer or
the action executor. [FFmpeg x11grab documentation](https://ffmpeg.org/ffplay-all.html#Options)

### Wayland and compositor-mediated input

Wayland does not provide one universal client API equivalent to XTEST. Pointer focus,
pointer images, and input serials are managed by the compositor and surfaces. [Wayland protocol model](https://wayland.freedesktop.org/docs/book/Protocol.html)

The standard desktop integration path is the XDG RemoteDesktop portal. It supports
relative and absolute pointer motion, pointer buttons, and scroll axes after the user
grants pointer access to the session. [XDG RemoteDesktop portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html)

The related libei protocol is designed for emulated input in the Wayland stack. Its
events are distinguishable inside the compositor so the compositor can apply access
control, while clients receive input as if it came through the normal input stack.
[libei protocol documentation](https://libinput.pages.freedesktop.org/libei/)

Wayland screen capture also has explicit cursor modes: hidden, embedded in the stream,
or delivered as PipeWire metadata. [XDG ScreenCast portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.ScreenCast.html)

Therefore the Ubuntu implementation should not claim Wayland support merely because a
browser is running through XWayland. A Wayland profile needs its own readiness check,
portal permission flow, cursor-mode handling, coordinate-space contract, and focused
tests. The first profile should be X11.

## What the mature local references do

The local OpenClaw implementation separates the model-facing `computer.act` command
from a node-local CUA provider. Its Linux proof uses a disposable Xvfb display, Openbox,
AT-SPI, a GTK fixture, and X11 tooling; it explicitly rejects native Wayland for that
proof. The driver contract includes `moveCursor`, `getCursorPosition`, click, drag,
scroll, type, keypress, desktop screenshots, display geometry, and generation-bound
frame references. Relevant local sources are:

- `/home/enoch/aworkspace/agents/openclaw/docs/nodes/computer-use.md`
- `/home/enoch/aworkspace/agents/openclaw/scripts/dev/computer-use-linux-x11-fixture.py`
- `/home/enoch/aworkspace/agents/openclaw/extensions/cua-computer/src/driver-client.ts`
- `/home/enoch/aworkspace/agents/openclaw/extensions/cua-computer/src/frame.ts`

Hermes also uses a CUA-driver boundary and deliberately drives the desktop in the
background by default, so its normal mode does not move the user's personal cursor or
steal focus. That is a safety and coexistence choice, not evidence that a visible
cursor cannot be implemented. The relevant local reference is:

- `/home/enoch/aworkspace/agents/hermes-agent/skills/autonomous-ai-agents/computer-use/SKILL.md`

The lesson for Anesu is to make visibility a host-profile choice. A development profile
can intentionally show a disposable cursor and display; a background profile can keep
actions isolated from the operator's cursor. Both must use the same action policy,
freshness checks, and evidence contract.

## Direct review of the cloned CUA Driver

The first research pass used OpenClaw's CUA integration and Hermes' computer-use
workflow as local references, but it did not inspect the newly cloned CUA repository
directly. That gap is now closed. The checkout is not merely a cursor utility: it is a
Rust-backed native desktop driver with TypeScript/Python SDKs, an MCP/CLI surface,
platform adapters, Linux validation harnesses, cursor rendering, and typed session and
action contracts.

The most relevant local sources are:

- `/home/enoch/aworkspace/agents/cua/libs/cua-driver/rust/Skills/cua-driver/LINUX.md`
- `/home/enoch/aworkspace/agents/cua/libs/cua-driver/docs/action-support.md`
- `/home/enoch/aworkspace/agents/cua/libs/cua-driver/docs/linux-desktop-validation.md`
- `/home/enoch/aworkspace/agents/cua/libs/cua-driver/docs/test-harnesses-guide.md`
- `/home/enoch/aworkspace/agents/cua/libs/cua-driver/docs/cursor-themes.md`
- `/home/enoch/aworkspace/agents/cua/rfcs/3931-cua-perception-and-jev-use.md`
- `/home/enoch/aworkspace/agents/cua/rfcs/3550-hyprland-isolated-input.md`

### What Anesu should reuse

CUA Driver is the right host-execution boundary for the Ubuntu slice. Its Linux
documentation describes background X11 delivery, AT-SPI element actions, X11 pixel
routes, screenshots, display/window state, keyboard and pointer actions, and explicit
background/foreground delivery modes. Its TypeScript SDK supports an in-process
native runtime, named sessions, desktop/window observations, `moveCursor`, click,
drag, scroll, typing, keypress, verification, and orderly shutdown. That is enough
to avoid writing a second XTEST/uinput implementation in Anesu.

For visible development, CUA's “agent cursor” is the relevant feature. It is a
synthetic, session-owned overlay that glides to action targets and can show action and
target context. It is intentionally separate from the real compositor pointer: CUA's
default background mode can act without moving the operator's pointer or stealing
focus. Anesu should therefore expose two honest host profiles rather than assume that
“computer use” always means moving the user's cursor:

1. **Visible disposable profile:** an isolated X11 display, CUA agent-cursor overlay,
   and a human viewer such as Xephyr or a protected VNC surface.
2. **Background isolated profile:** the same disposable display and executor, with the
   real pointer left alone and the synthetic cursor retained in evidence when useful.

CUA's Linux support documents also give us a useful starting capability truth: X11 is
the strongest first lane; standard Wayland is compositor-dependent and refuses raw
background shapes when it cannot prove target-addressable delivery; nested or
compositor-specific routes must not be presented as general Wayland support.

### What Anesu should learn from, but not put inside CUA

The CUA perception/Jev RFC is closely aligned with the Anesu boundary. It keeps CUA
Driver responsible for capture, target identity, coordinate transforms, action
admission, dispatch, and verification. A client constructs complete bounded candidate
actions; Jev may select one supplied candidate ID; the client validates it; the loop
executes at most one action from one capture and then reobserves. Jev does not receive
desktop authority, invent tool names, or emit unconstrained coordinates.

Anesu should preserve that division:

- **Anesu owns:** model/provider selection, traditional-vs-Jev strategy, candidate
  construction, approval, cancellation, conversation policy, TUI, and run evidence.
- **CUA Driver owns:** Ubuntu session/display attachment, capture, native target
  resolution, pointer/keyboard dispatch, cursor overlay, platform permissions, and
  native action results.
- **The integration adapter owns:** CUA session lifecycle, target/frame binding,
  coordinate conversion, capability/doctor checks, and mapping CUA results into
  Anesu's model-neutral computer-use events.

The adapter must not pass arbitrary model-produced CUA tool calls through. It should
construct a small allowlisted action set, bind every action to the fresh observation,
reject stale or cross-session targets, and never automatically escalate a refused
background action to foreground. Foreground takeover remains an explicit approval
boundary.

### Important integration constraints

Reusing CUA still requires deliberate integration work:

- pin the CUA SDK/native artifact set as one compatible release unit; do not depend on
  an untracked globally installed daemon or a moving “latest” artifact;
- run CUA's Linux doctor/readiness checks as part of Anesu environment readiness and
  surface missing X11, AT-SPI, session-bus, native-library, or permission state;
- retain CUA's exact target, session, generation, geometry, scale, and stale-frame
  semantics instead of reducing them to an unbound `{x, y}`;
- make cursor visibility a profile setting and record whether a frame contains the
  synthetic cursor, the real pointer, cursor metadata, or none of these;
- use CUA's refusal and ambiguous-result outcomes as structured evidence; a successful
  native call is not proof that the application changed; and
- begin with the repository's X11 lane and its fixture/evidence model. Do not claim
  CUA's broader Wayland, Hyprland, GNOME, KDE, or real-Xorg behavior until the
  corresponding Anesu host profile has its own readiness and focused evidence.

This confirms CUA should be our primary Ubuntu host-driver candidate and reference,
not a reason to duplicate the lower-level desktop implementation. It does not make
the current Anesu browser POC a native computer-use implementation; the integration,
visible disposable profile, approval path, verification, and evidence work remain in
the active computer-use plan.

## CUA-S1-FORMS and the new `jev-use` resources

The linked announcement contains two related but distinct resources. The September
17 `jev-use` preview composes TypeSafe Jev with CUA Driver: the application supplies a
bounded candidate table, Jev selects one candidate ID, CUA Driver executes it, and an
independent check verifies the result. The September 18 CUA-S1 announcement adds a
separate family of small specialist models; the first release, CUA-S1-FORMS, scores
form actions in one pass and lets ordinary code order and execute them.

Primary sources:

- [CUA-S1-FORMS model card](https://huggingface.co/cua-ai/cua-s1-forms)
- [CUA-S1 source and training code](https://github.com/trycua/cua/tree/main/libs/cua-s1)
- [CUA `jev-use` guide](https://cua.ai/docs/how-to-guides/driver/jev-use)
- [Local `jev-use` implementation](https://github.com/trycua/cua/tree/main/libs/cua-driver/examples/jev-use)
- [CUA perception/Jev boundary RFC](https://github.com/trycua/cua/issues/3931)

CUA-S1-FORMS is useful to Anesu as a later specialist-provider experiment, not as the
default computer-use brain. Its documented contract is intentionally narrow: each
actionable form element is paired with bounded options such as a supplied document
entity, `check`, `click`, or `skip`; the model returns probabilities over those
options and does not generate arbitrary field values or general desktop actions. The
official model card also limits its evidence to synthetic form data and a small real
form evaluation, so its reported accuracy must not be generalized to open-ended
computer use.

The local checkout contains source, tests, training/evaluation utilities, and the
Driver adapter, but no model weights. The official model release provides a
`safetensors` checkpoint with a JSON sidecar and explicitly rejects pickle-based
loading in its reference loader. Any future Anesu integration must pin and verify the
exact artifact and license rather than silently downloading a model at runtime.

The most valuable implementation lessons are already applicable:

- keep planning separate from execution and default to dry-run;
- require explicit execution and separate submit authorization;
- build decisions only for the current exact window snapshot;
- use snapshot-bound element tokens and reobserve after every mutation;
- fail closed on unknown checkbox state, unsupported `set_value`, stale targets,
  ambiguous windows, unconfirmed effects, timeouts, and outcome-unknown transport
  failures;
- keep the candidate set bounded and include explicit `reobserve` and `abstain`
  choices; and
- verify completion through independent application state, not the model's confidence
  or the Driver acknowledgement alone.

These patterns reinforce the existing Anesu plan. They do not justify adding CUA-S1 to
the first general computer-use slice: the initial comparison remains traditional
vision versus TypeSafe/Jev, while CUA-S1-FORMS can later be added as a form-specific
local specialist behind the same candidate, approval, executor, and verification
interfaces.

## Recommended Anesu Ubuntu design

```text
traditional vision / Jev semantic state
        ↓ proposed action
shared policy + structured approval
        ↓ validated target and fresh frame
Ubuntu host adapter
  ├─ isolated X11 display (Xephyr for local viewing, Xvfb for worker tests)
  ├─ managed window manager and Chromium profile
  ├─ CUA Driver / XTEST pointer and keyboard backend
  └─ cursor-aware screen capture and optional recording
        ↓
fresh observation + pointer/action evidence
```

The host adapter should own:

- display/session creation and teardown;
- browser/window focus and active-display identity;
- pointer position, move, hover, click, drag, and scroll;
- typing and keypresses;
- screenshot dimensions, scale factor, cursor mode, and frame IDs;
- screenshot or recording artifacts with explicit cursor inclusion;
- cancellation, driver shutdown, and ambiguous-result classification.

The strategy should not own any of those side effects. Traditional vision may propose a
bounded point or box. Jev should select a candidate from local OCR/accessibility/element
state; deterministic code maps that candidate to a fresh coordinate or element target.
Jev still does not generate pointer events or coordinates itself.

## Safety and reliability requirements

The Ubuntu profile should require the following before it advertises readiness:

- the process is attached to the intended isolated display, not the operator's
  `DISPLAY` by accident;
- the display geometry, scale factor, screen index, and window/session generation are
  known;
- the input backend is the pinned, expected backend and its native artifacts pass a
  doctor check;
- screenshots and pointer coordinates use one explicit coordinate space;
- a fresh frame or element observation authorizes the target;
- the pointer is within the declared display bounds and the target remains valid;
- approval is required before click, drag, typing, navigation, or other side effects;
- cancellation stops future actions and labels in-flight actions as cancelled or
  outcome-unknown;
- pointer movement and hover are bounded so the agent cannot roam outside the target
  window or display profile;
- screenshots, recordings, cursor metadata, and logs are bounded and do not expose
  credentials or personal screens; and
- driver failure, focus loss, display loss, stale frame, and verification failure are
  separate outcomes rather than generic success/failure strings.

The model's visual observation is not authorization. A cursor moving over a control is
not a click approval, and a click acknowledgement is not proof that the intended state
changed. The system must capture and verify the post-action state before continuing.

## Proposed implementation order

1. Add an Ubuntu X11 readiness/doctor profile and refuse unsupported displays rather
   than silently falling back.
2. Add a disposable Xephyr development display so the contributor can watch a real
   cursor move without giving the agent the personal desktop.
3. Add the host adapter's pointer contract: `get_position`, `move`, `click`, `drag`,
   `scroll`, `type`, and `keypress`, with display/frame identity and cancellation.
4. Add cursor-aware screenshot and optional recording artifacts. Verify whether the
   selected capture path embeds the cursor or emits cursor metadata, and record that
   fact in evidence.
5. Run the traditional and Jev strategies through the same executor. Jev remains
   semantic selection; the host adapter performs the pointer action.
6. Add an Xvfb plus view-only VNC/noVNC fixture for reproducible worker tests and
   remote observation.
7. Add Wayland as a separate profile using the RemoteDesktop/libei path only after the
   X11 profile is stable.

## Completion evidence for the Ubuntu pointer slice

The slice is complete when a contributor can use `pnpm run chat` against a disposable
Ubuntu X11 profile and observe all of the following:

- the cursor begins at a recorded position;
- the agent proposes a bounded move or click against a fresh observation;
- the TUI shows the exact strategy, display, target, and approval state;
- the pointer visibly moves in the controlled display;
- the click or other action is executed once;
- a fresh screenshot/semantic observation verifies the intended change;
- the evidence records frame, display, pointer, action, approval, execution, and
  verification identities without raw credentials; and
- Ctrl+C, stale coordinates, focus loss, driver failure, and display teardown produce
  honest non-success outcomes.

This evidence would establish Ubuntu X11 pointer control. It would not establish
Wayland, multiple-display, arbitrary-desktop, or production-scale support.
