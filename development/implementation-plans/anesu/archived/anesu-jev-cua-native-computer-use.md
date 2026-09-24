# Anesu Jev and Cua desktop and browser computer use

**Created:** 2026-09-20T23:00:00+02:00<br>
**Last updated:** 2026-09-23<br>
**Status:** Archived on 2026-09-23. The remaining-acceptance plan was also
archived. Current browser work is tracked in
[Anesu browser use](../active/anesu-browser-use.md); native work is deferred.<br>
**Owner:** Anesu standalone product<br>
**Implementation policy:** Jev plus separately bounded Cua Driver runtimes for native
Ubuntu/X11 applications and typed Chrome/Edge browser operation. The Playwright browser
runtime is retired from production Anesu. Legacy vision and compare strategies remain
preserved experiment coverage and stay ineligible for production. Production native
computer use adds a separately designed, Cua-owned visual fallback only after structured
interaction fails or is unavailable. It never falls back to a second automation backend.

This document preserves the full design and implementation evidence for the initial
Jev/Cua computer-use work. Its remaining checklist is no longer the execution plan.
Use the focused acceptance plan linked above; unchecked items here are historical
context unless that plan explicitly includes them.

## Start here

Read these sources before changing code:

- [Repository development rules](../../../../AGENTS.md)
- [Anesu development rules](../../../../anesu/AGENTS.md)
- [Anesu computer environment](../../../../anesu/src/computer/README.md)
- [Verified Jev and Cua research](../../../../docs/research/jev-cua-native-task-loop.md)
- [Cua browser migration audit](../../../../docs/research/cua-browser-migration-audit.md)
- [Hermes and OpenClaw computer-use notes](../../../../docs/research/goal-oriented-computer-use-hermes-openclaw.md)
- [Native computer-use action comparison](../../../../docs/research/computer-use-native-app-action-comparison.md)
- [Completed goal-oriented computer-use slice](../completed/anesu-goal-oriented-computer-use.md)
- [Production-readiness gap register](anesu-production-readiness-gaps.md)
- [Cua Jev guide](https://cua.ai/docs/how-to-guides/driver/jev-use)
- [Cua Linux tools](https://cua.ai/docs/reference/cua-driver/mcp-tools-linux)
- [Cua platform support](https://cua.ai/docs/reference/cua-driver/platform-support)
- [Cua action-selection policy](https://cua.ai/docs/reference/cua-driver/action-selection-policy)
- [Cua permission policy](https://cua.ai/docs/concepts/how-permission-policies-work)
- [Cua browser workflow](https://cua.ai/docs/how-to-guides/driver/drive-a-web-page)
- [Cua browser targeting and delivery](https://cua.ai/docs/concepts/browser-targeting-and-background-delivery)
- [Cua browser semantic snapshots](https://cua.ai/docs/reference/cua-driver/browser-semantic-snapshots)
- [Cua browser limits](https://cua.ai/docs/reference/cua-driver/limits)
- [Cua permission modes](https://cua.ai/docs/reference/cua-driver/permission-modes)

Local reference implementations:

- `/home/enoch/aworkspace/agents/cua/libs/cua-driver/rust/Skills/cua-driver/SKILL.md`
- `/home/enoch/aworkspace/agents/cua/libs/cua-driver/rust/Skills/cua-driver/LINUX.md`
- `/home/enoch/aworkspace/agents/cua/libs/cua-driver/examples/jev-use/`
- `/home/enoch/aworkspace/agents/cua/docs/content/docs/how-to-guides/driver/drive-a-web-page.mdx`
- `/home/enoch/aworkspace/agents/cua/docs/content/docs/concepts/browser-targeting-and-background-delivery.mdx`
- `/home/enoch/aworkspace/agents/cua/docs/content/docs/reference/cua-driver/browser-semantic-snapshots.mdx`
- `/home/enoch/aworkspace/agents/hermes-agent/tools/computer_use/`
- `/home/enoch/aworkspace/agents/openclaw/extensions/cua-computer/`

The external projects are references, not dependencies. Anesu keeps its own task,
approval, evidence, persistence, and TUI contracts.

## Outcome

A user starts the visible disposable Ubuntu/X11 environment and types a normal request:

```text
Open Text Editor and type "Anesu native acceptance" into a new document.
```

```text
Open Calendar and create an event titled "Anesu acceptance" tomorrow at 10:00.
```

```text
Open Clocks and set an alarm for 07:30.
```

```text
Open example.com in the browser and tell me the page heading.
```

```text
Open the browser, go to the local acceptance form, enter "Anesu browser acceptance",
and submit it.
```

Anesu resolves an installed native application or a supported Chromium product, shows
one bounded task approval, launches or prepares it through Cua Driver, observes the
exact window or browser tab, asks Jev to choose from code-built action candidates,
executes one bound action, captures fresh state, and continues until a code-owned
postcondition contract classifies the requested result as deterministic, calibrated
visual, or unknown. Browser tasks use Cua's exact
native-window-to-Chromium binding and typed `browser_*` tools. They do not use
Playwright locators, contexts, pages, or browser processes.

The user does not name Cua, Jev, selectors, observation IDs, accessibility tokens,
target IDs, tab IDs, coordinates, fixtures, or driver methods. The TUI does not prompt
for every ordinary click or keystroke that remains inside the approved task.

```text
natural request
  -> preserve original goal and extract bounded task values and allowed origins
  -> route to native application or browser
  -> prepare and approve one task grant
  -> native: launch one code-owned app and bind one exact window
  -> browser: prepare isolated or explicitly approved profile, then bind one exact tab
  -> observe AT-SPI state plus exact native-window image, or semantic_v2 browser state
  -> build finite structured native actions, bounded native visual targets, or typed browser refs
  -> Jev chooses candidate ID, reobserve, or abstain
  -> validate candidate against the task grant and fresh observation
  -> execute one Cua action through the declared delivery route
  -> reobserve, classify progress, and verify or replan without replay
  -> continue, complete, clarify, refuse, cancel, or report outcome unknown
```

## Why the previous slices are insufficient

The completed slices proved routing, a bounded action loop, fresh observation, exact
action approval, Cua input dispatch, and small fixture verifiers. They did not deliver
general native or Cua-backed browser tasks:

- `native-strategy.ts` offers Jev clickable accessibility candidates only;
- `cua-driver.ts` did not expose the allow-listed native launch and exact PID/window
  lifecycle through the Anesu adapter;
- `verification.ts` cannot prove a saved note, calendar event, or enabled alarm;
- the CLI approval contract has `allow-once` only;
- the runner can stop after a successful action when it cannot derive a completion
  condition; and
- the Cua environment is owned by a tool call rather than an explicit computer task;
- `src/browser/playwright-adapter.ts` owns browser processes, contexts, pages, locators,
  dialogs, downloads, and screenshots outside Cua's session and authorization model;
- browser references use Anesu's Playwright document IDs instead of Cua's exact native
  window, target, tab, snapshot, frame, and generation-bound capabilities;
- the current browser route cannot use Cua's `browser_prepare`, exact Chromium endpoint
  ownership proof, `semantic_v2` snapshots, structured browser refusals, or existing
  profile authorization; and
- `playwright` remains a runtime dependency with separate profile cleanup and lifecycle
  semantics that duplicate Cua.

This plan replaces those limitations and removes Playwright from Anesu. It preserves
useful Anesu policy, approval, artifact, evidence, and TUI concepts only where they can
be expressed through Cua's contracts. It does not reinterpret the old fixture slice as
the finished product.

## Evidence baseline and API facts

The following facts were checked before this plan was written.

| Fact | Evidence | Consequence for this plan |
| --- | --- | --- |
| Anesu pins `@trycua/cua-driver` `0.28.2`. | `anesu/package.json` and the installed package under the pnpm store. | Implementation targets the installed contract, not an unreleased Cua branch. |
| The pinned same-process `CuaDriver.createConfigured()` runtime initializes with its cursor overlay disabled. `set_agent_cursor_enabled` can update session state but does not start the renderer; Linux overlay commands are then silently dropped. The configured SDK options expose no cursor-config field. | Cua tag `cua-driver-rs-v0.28.2`: `cua-driver-sdk/src/lib.rs::CuaDriver::create_configured`, `cua-driver-sdk/src/abi.rs::runtime_options_from_abi`, `cua-driver-sdk/src/runtime.rs::RuntimeOptions::embedded`, and `platform-linux/src/lib.rs::register_tools_with_cursor`; installed `ConfiguredDriverOptions` declaration. | A successful cursor-tool acknowledgement cannot satisfy visible-cursor acceptance. Find a supported Cua host/runtime configuration that enables the renderer while preserving Anesu's bounded manifest and trusted task-session authorization; do not switch to desktop-pointer input or claim visibility. |
| Cua Linux `move_cursor` agent-overlay coordinates are absolute display coordinates. Its own accessibility route passes AT-SPI screen extents to the overlay; window-local pixel actions are separately converted to screen coordinates. | Same pinned Cua tag: `platform-linux/src/tools/impl_.rs::MoveCursorTool`, `element_screen_center`, and `window_local_to_screen`; Anesu live frame inspection on 2026-09-23. | Anesu's presentation-only cursor point is derived from the exact current element frame in display space, checked against the bound window, and is not screenshot-normalized. The TUI capture must still prove an actual visible cursor before acceptance. |
| The installed runtime reports 59 tools. Inspected tools `launch_app`, `list_apps`, `list_windows`, `get_window_state`, `click`, `set_value`, `type_text`, `press_key`, `hotkey`, `scroll`, `invoke_menu`, `verify_state`, `health_report`, `set_agent_cursor_enabled`, `get_agent_cursor_state`, `start_session`, and `end_session` are present. | `CuaDriver.create().listToolsJson()` against the pinned package. | Startup can inspect and enforce the real tool inventory. No tool name in this plan is speculative. |
| The pinned runtime does not report `parse_visual_regions`, a capture-bound `click.capture_id`, or OCR. `get_window_state` can return a screenshot for an exact native window. | The live `listToolsJson()` inventory for `@trycua/cua-driver@0.28.2`. | Anesu must not invent a Cua visual-region API or build its own screenshot-to-coordinate planner. The visual route remains unavailable until Cua advertises both the versioned visual-region result and capture-bound click contract. |
| Cua's Jev recipe defines the optional visual route as a Driver-owned `cua.visual_regions_v1` result plus a capture-bound click; Jev receives compact typed regions and a capture ID, not screenshot bytes or Driver internals. | Local Cua `skills/jev-use/SKILL.md`, `libs/cua-driver/examples/jev-use/`, and `docs/content/docs/how-to-guides/driver/jev-use.mdx`. | Implement Anesu's visual stage against this public Cua contract when a released package provides it. Do not require a TypeSafe image-input API, add OCR, or add a second vision backend. |
| The local Cua checkout contains the visual-region recipe and a development-line admission change (`f56b18881` on `origin/feat/cua-perception-foundations`), but checked-out `main` is `9bbfa7dd3` and the npm registry still reports `@trycua/cua-driver@0.28.2` as latest. | `git -C /home/enoch/aworkspace/agents/cua` inspection and `pnpm view @trycua/cua-driver version dist-tags --json` on 2026-09-22. | Do not point Anesu at an absolute local checkout, vendor an unpublished branch, or claim visual support. Keep the capability gated and record the released dependency needed to enable it. |
| Linux `list_apps` returns installed XDG desktop entries and their `launch_path`; `launch_app` accepts that exact path, but bounded `list_apps` is treated as unfiltered display observation when no PID is supplied. | Live Cua `0.28.2` probe plus Cua Linux documentation. | The native app-scoped runtime does not grant `desktop.display` merely for discovery. Anesu resolves only its checked-in app allow-list and passes an unchanged allow-listed launch path to `launch_app`; the returned PID then scopes all window operations. |
| In Cua `0.28.2`, adding `list_apps` to the tool allow-list does not make it usable in the app-scoped manifest: a configured SDK `listApps()` call still returns `bounded_resource_outside_manifest` while `resources.desktop.display` is false. | Disposable Xvfb/DBus probe on 2026-09-23; the probe-only tool permission was removed afterward. | Do not enable desktop-wide observation or infer a replacement process from an unfiltered app list. Keep D-Bus handoff as an upstream Cua identity-contract requirement. |
| `launch_app` is open-world, state-changing, and not declared idempotent. | Its live tool annotations. | Launch belongs inside the approved task and is never retried blindly after uncertain acknowledgement. |
| The pinned Linux `launch_app` contract returns the spawned PID and a `windows` array for that PID. Calculator, Calendar, and Clocks can hand off to a separate D-Bus-activated process, leaving that array empty and the returned PID gone; direct Cua probes reproduce this while direct Calculator launch in the same profile remains alive. | Cua `0.28.2` Linux `launch_app` implementation waits up to three seconds for windows owned by the returned PID; direct `@trycua/cua-driver@0.28.2` probes on 2026-09-22 show the handoff failure. | Anesu consumes one exact matching window from the Cua launch result before polling, and refuses multiple or mismatched windows. If Cua returns none and the PID exits, do not adopt another PID, perform display-wide discovery, or add an app-specific shell/D-Bus workaround. The D-Bus handoff cell still requires a released Cua identity contract. |
| `get_window_state` returns an AT-SPI tree and screenshot for one exact `pid` and `window_id`. | Live tool schema and Cua Linux documentation. | The candidate builder begins with structured elements and may use the same exact snapshot for bounded visual grounding. Every candidate remains bound to that window snapshot. |
| `verify_state` returns satisfied, unsatisfied, or unknown for bounded predicates. Unknown is not success. | Live tool schema and Cua action-selection policy. | Only satisfied predicates can complete a task. |
| Jev selects from caller-provided IDs. It does not generate driver calls, raw coordinates, selectors, or task values. | Official Cua Jev guide and TypeSafe Choice guidance. | Anesu owns task values, candidates, execution, and verification. Visual grounding may let Jev select only a code-issued region ID, never an unconstrained coordinate. |
| The installed runtime exposes `browser_prepare`, `get_browser_state`, `browser_navigate`, `browser_click`, `browser_type`, `browser_pointer`, `browser_dialog`, `browser_set_input_files`, and `browser_download`. | Live `listToolsJson()` against Cua `0.28.2`. | The replacement browser path targets real installed operations, not a proposed API. Each operation still needs a supported host route. |
| In Cua `0.28.2`, public TypeScript `callTool` strips reserved arguments and cannot supply the trusted MCP-host approval evidence required by `browser_download`. | Installed SDK sanitization and Cua's browser download implementation. | This plan does not forge private evidence or add an MCP client for one operation. Download is deferred until Anesu adopts Cua's supported MCP-host route or pins a first-party SDK download API. |
| Cua binds a native browser `(pid, window_id)` to opaque target and tab capabilities. Browser mutations re-prove endpoint ownership and exact binding. | Cua browser workflow and targeting documentation. | Anesu never chooses a first process, window, tab, or raw CDP target. Ambiguity is a refusal. |
| `semantic_v2` snapshots provide typed action refs, content refs, visibility, omissions, scopes, and continuations. New snapshots, navigation, reconnect, and session end invalidate capabilities. | Cua semantic snapshot reference. | Browser candidates come only from current declared actions and are rebuilt after every state change. |
| Linux X11 Chrome and Edge support exact binding, navigation, ref-bound typing, synthetic DOM actions, dialogs, files, downloads, frames, and multi-tab handling. Trusted standalone pointer input and background dialog resolution refuse when they would activate the browser. | Cua platform support and limits. | Anesu treats `browser_input_trust_unavailable` as a real boundary. It never silently switches route or foregrounds the browser. |
| Cua's origin-scoped manifest rejects generic desktop input, desktop observation, and legacy `page` in the same runtime. Cua says browser and generic desktop access belong to separate manifests and runtimes. | Cua permission modes, "Origin scope excludes generic input." | Anesu uses separate native and browser Cua owners under one task coordinator. Browser origin policy cannot be bypassed by the native runtime. |
| Existing-profile attachment grants broad CDP access to live pages, cookies, and storage. Isolated profiles are the default. | Cua browser workflow and targeting documentation. | Ordinary tasks use `isolated_new`. Existing-profile work has a separate explicit grant and acceptance track. |
| The legacy `page` mutation route lacks the typed browser tools' exact binding and grant guarantees. | Cua browser workflow, "Legacy page actions." | Anesu does not enable legacy page mutations or use `page` as a mutation fallback. |
| Hermes scopes session approvals by action and delivery mode. Foreground delivery does not inherit background approval. | `hermes-agent/tools/computer_use/tool.py::_request_approval`. | Anesu's task grant is scoped. Foreground escalation and new risk require another approval. |
| Hermes uses background delivery first, re-observes after uncertain effects, then escalates to pixel and foreground delivery only on evidence. | `hermes-agent/tools/computer_use/schema.py` and `tool.py::_classify_action_result`. | Anesu uses the same evidence-driven native fallback order. It never retries input based on a guess or changes browser automation backends. |
| OpenClaw keeps action targets, execution state, and driver evidence in its computer host. | `openclaw/extensions/cua-computer/src/`. | The Cua adapter owns exact native identities and effects. The TUI remains a projection. |
| A preliminary ordinary-host probe exposed XDG entries for Clocks, Calendar, and Text Editor, but the bounded native manifest cannot use unscoped `list_apps` while `desktop.display` is false. | Pinned Cua `listApps()` probe and bounded-manifest refusal on 2026-09-21. | This informs the checked-in acceptance allow-list only. It is not acceptance evidence; the disposable profile must launch and exercise each allow-listed app through Cua and bind its returned PID/window. |

The live inventory check becomes an automated readiness check. A future package update
cannot remove or change a required operation while Anesu continues as if it existed.

## Supported profile

This plan implements one named profile:

```text
profile: ubuntu-x11-cua-jev-development
display: private Xvfb or visible nested Xephyr
desktop bus: private dbus-run-session
home/config/data/state: disposable directories owned by the launcher
window manager: Openbox preferred; GNOME Shell, Fluxbox, TWM, or JWM when installed
native perception: Cua AT-SPI structured state plus exact bound-window screenshot
browser engine: system-attested Chrome or Edge through a Cua isolated_new profile
browser perception: Cua semantic_v2 snapshots
decision model: TypeSafe Jev
native input: Cua background mode first
browser input: typed Cua browser tools; explicit DOM route on Linux when permitted
visible review: Xephyr plus Cua's session cursor
```

The launcher already creates a disposable `HOME`, XDG directories, runtime directory,
session bus, Xauthority file, and display. This plan must preserve those boundaries when
it begins launching real desktop applications.

## Ownership and module boundaries

| Responsibility | Owner |
| --- | --- |
| Natural prompt and normal agent tool selection | Existing Anesu runtime and `computer` tool definition |
| Original goal, extracted source values, task budget, and completion contract | New computer task contract/compiler |
| Supported application resolution and exact app identity | Code-owned native allow-list plus Cua manifest |
| App launch, window identity, observations, input, and driver effects | Cua environment adapter |
| Browser preparation, exact target/tab binding, semantic snapshots, typed mutations, and cleanup | Cua browser environment adapter |
| Native versus browser routing | Existing Anesu routing plus the compiled task contract |
| Finite native action candidates | Native structured and bounded visual candidate builders |
| Finite browser candidates | Browser candidate builder over current Cua `semantic_v2` refs |
| Candidate choice and probabilities | Jev through TypeSafe Choice |
| Permission to launch and act | Anesu task grant plus separate native and browser Cua authorization ceilings |
| Loop state, deadlines, cancellation, and terminal outcome | Computer task coordinator inside the existing turn |
| Completion | Generic or application-specific deterministic verifier, or a calibrated low-risk visual postcondition contract, over fresh Cua state |
| User interaction | Existing TUI event and approval projection |
| Durable evidence and recovery | Existing session store and computer-run records |

The TUI must not own task state. Jev must not own policy, execution, or success. Cua must
not receive model-generated commands, selectors, target IDs, tab IDs, refs, paths, or
verification results.

## Native fallback contract

The production native loop follows the research-backed split of responsibilities:

```text
Hermes: evidence-driven background → pixel → approved foreground fallback
OpenClaw: execution-scoped state, fresh references, and typed refusals
Anesu: one Cua-only coordinator; Jev chooses only a current structured or region-ID candidate
```

For each low-risk native task, Anesu observes before action and after every action. It
starts with the most structured current route, then may replan through focused
keyboard/text, background pixel, and separately approved foreground pixel routes. A
later route is permitted only by fresh evidence that the earlier route was unavailable
or had no observed effect. The loop never repeats an effect that may have happened.

Browser operation remains separate: it uses typed origin-scoped Cua browser tools and
does not fall back to native browser-window input, legacy `page`, Playwright, arbitrary
scripts, or generic desktop-wide observation.

## Work plan

### 0. Lock the real Cua contracts

- [x] Add Cua capability probes that call `listToolsJson()` once for each configured
      runtime and parse only the required tool names, schemas, and annotations.
- [x] Require `launch_app`, `list_windows`, `get_window_state`, `click`,
      `set_value`, `type_text`, `press_key`, `scroll`, `verify_state`, `health_report`,
      `set_agent_cursor_enabled`, `get_agent_cursor_state`, `start_session`, and
      `end_session`. Keep `hotkey` and `invoke_menu` discoverable but optional until a
      task profile uses them.
- [x] Probe and pin the actual Cua visual-region and capture-bound click contract required
      for the bounded visual route. If the configured Cua runtime does not advertise both
      `parse_visual_regions` and the `click.capture_id` input, expose visual fallback as
      unavailable before approval. Jev receives only Cua-validated JSON region metadata;
      Anesu must not simulate the route with text descriptions, a second model, OCR, or a
      legacy strategy.
      Evidence note (2026-09-22): the pinned `@trycua/cua-driver@0.28.2` inventory has
      neither capability. The installed `@typesafe-ai/sdk@0.6.0` accepts JSON state only,
      which is sufficient for the Cua visual-region recipe and is not itself a blocker.
      The same-day Cua `main` commit `681bc44807d1be81a4357f8e158f1c74a81d5a5b` now
      contains `cua.visual_regions_v1` and Linux clicks bound to its `capture_id`, but its
      release notes say a driver feature release is still required. This is upstream
      development evidence, not a capability Anesu may select or claim in the pinned npm
      runtime. Re-probe the published package when Cua releases it; do not vendor or imitate
      the unreleased protocol as a compatibility shortcut.
- [x] Require `browser_prepare`, `get_browser_state`, `browser_navigate`,
      `browser_click`, `browser_type`, `browser_pointer`, `browser_dialog`,
      and `browser_set_input_files` in the browser runtime. Keep `browser_download`
      visible in diagnostics but ineligible through the public TypeScript `callTool`
      route. Do not admit legacy `page` mutations.
- [x] Fail startup with a typed readiness error that lists missing operations. Do not
      discover a missing operation halfway through an approved task.
- [x] Record the installed Cua package version, Cua driver/contract identity, and a bounded required-capability summary
      in diagnostics and run evidence. Do not persist the full schemas.
- [x] Replace `CuaDriver.create(undefined)` with two application-lifetime configured Cua
      owners coordinated by Anesu. Use `CuaDriver.createConfigured(...)` for the native
      owner and for an isolated-only browser deployment. Use Cua's configured
      authorization-host constructor when the browser deployment admits existing-profile
      attachment. Both owners use bounded mode and separate immutable deployment
      manifests before any task is admitted. Do not create a driver per action.
- [x] In the native manifest, allow only lifecycle, health, checked-in app launch,
      exact native observation, verification, cursor, and approved native input. Scope its
      app resources to non-browser applications used by this profile. Keep browser
      windows, browser tools, unscoped `list_apps`, and desktop-wide observation outside
      this authorization ceiling. Do not turn on `desktop.display` merely to enumerate
      apps. Native resolution remains a checked-in app identity in this first slice.
- [x] In the browser manifest, allow lifecycle, health, `list_windows`, isolated browser
      preparation, exact browser state, and the typed `browser_*` tools. Declare allowed
      browser profile kinds, origins, and file roots. Exclude generic desktop input,
      `get_window_state`, `verify_state`, desktop capture, and legacy `page`, as Cua's
      origin-scoping contract requires.
- [x] Treat both manifests as deployment ceilings. The task compiler may select only
      apps, profile kinds, origins, tools, and file roots already present in the matching
      manifest. Prompt text cannot add a manifest resource. A task grant records the
      exact selected subset and remains narrower than the runtime ceiling. The checked-in
      app/catalog lockstep test, browser origin subset check, derived upload-root manifest,
      and per-task grant binding provide this evidence.
- [x] Install Cua's trusted `DriverAuthorizationHost` on the browser owner only when the
      deployment supports existing-profile attachment. The callback denies by default,
      matches the exact pending Anesu session and Cua request digest, returns one decision,
      and discards the pending decision. It never logs `resource_json`, exposes it to the
      model, or treats ordinary MCP approval as profile authorization. Evidence:
      `src/browser/cua-authorization.ts`, the configured Cua host in
      `src/browser/cua-adapter.ts`, and `tests/cua-authorization.test.ts` cover bounded
      redaction, expiry, callback failure, concurrency, and replay. Live product consent
      acceptance remains open below.
- [x] Fail startup if either manifest can reach the other runtime's protected resources.
      Add a test proving that the native runtime cannot target Chrome or Edge and that
      the browser runtime cannot dispatch generic desktop input.
- [x] Keep shell, arbitrary process control, clipboard, unrestricted filesystem,
      desktop-wide input, legacy page mutation, and unrelated tools outside both
      authorization ceilings. The two manifests contain no such tools; browser generic
      desktop input and legacy `page` remain absent from the browser gateway.
- [x] Keep a code-owned native generic dispatch allow-list and test that a denied browser
      tool cannot reach the native driver through `callTool`. The task grant and this
      allow-list only narrow Cua's ceiling; they can never widen it.
- [x] Validate the complete capability manifest against the pinned runtime and add a
      runtime-level test proving Cua itself denies an operation outside that manifest.
      `tests/cua-browser-manifest.test.ts` creates the pinned `0.28.2` configured
      runtime with each checked-in manifest and proves Cua returns structured
      `permission_denied` for a browser tool in the native runtime and a generic
      desktop tool in the browser runtime.
- [x] Call `health_report` before task admission. Require the expected schema version
      and passing Linux platform, desktop-session, AT-SPI, and capture checks used by
      this profile.
- [x] Contract-test the live input schemas, required fields, and annotations for generic
      `launch_app`, `set_value`, element-targeted `type_text`, and every admitted typed
      browser operation, not only their names. Store one bounded stable fingerprint per
      runtime for diagnostics.
- [ ] Contract-test the native screenshot dimensions, image digest, exact PID/window
      binding, and pixel-input coordinate system used by visual candidates. Reject image
      dimensions, generations, or points that cannot be reconciled with the current Cua
      window state before any input is dispatched.
- [x] Add pinned output decoders for `browser_prepare`, `get_browser_state`,
      `browser_navigate`, `browser_dialog`, and `browser_set_input_files`. Cua `0.28.2`
      does not advertise output schemas for these tools. Reject unknown success shapes;
      do not mistake a structured refusal with `isError: false` for success.
- [x] Pin `@typesafe-ai/sdk` exactly or enforce its resolved API contract and version in
      CI. Preflight the configured Jev model through the installed SDK before approval
      and record the model identity returned by the service, since `jev-latest` moves.
      The application-lifetime readiness probe sends only a constant state, memoizes
      successful evidence, fails closed on missing or malformed identity, and carries
      requested/resolved model names into the durable computer run.
- [x] Add `/doctor` and `/computer` output for both Cua profiles, Cua availability, Jev
      credential presence, X11 display, session bus, window manager, installed supported
      Chromium products, and missing required operations without printing secrets.
- [x] Add contract tests using the actual pinned SDK's tool inventory shape and a fake
      inventory missing each required operation.

Gate: Anesu refuses task admission before approval when either selected Cua runtime
cannot provide its required contract, health checks, isolated authorization ceiling,
or Jev model. Neither runtime can dispatch through the other's permission boundary.

### 1. Define the computer task contract

- [x] Replace the native-only admission shape with a `ComputerTaskSpec` containing the
      immutable original goal, task ID, selected surface, target app or browser profile,
      allowed origins, source-backed values and files, allowed action classes,
      completion specification, delivery scope, action limit, deadline, expiry, and the
      configured normalization timezone. `task.ts` and `computer-task.test.ts` prove the
      compiled grant identity and relative Calendar value normalization.
- [x] Keep user text, times, dates, titles, URLs, and application names tied to source
      spans in the original prompt. Normalized text, URL, file, date, and time values
      retain their source span and deterministic normalization record; native application
      identity remains a trusted catalog value rather than a model-generated string.
- [x] Build value candidates in code for quoted text, explicit application names,
      clock times, calendar dates, event titles, URLs, and exact upload files.
      Jev receives only bounded candidate IDs; it never supplies a value. Relative dates
      and 12-hour times normalize in code.
- [x] Resolve native application descriptions through the checked-in code-owned alias map
      and Cua app manifest. Exact aliases take precedence, unsupported or ambiguous names
      clarify, and the model cannot produce a new app name or launch value. Cua does not
      authorize unscoped installed-app enumeration in this profile, so this slice does not
      fake a desktop inventory or ask Jev to choose from one.
- [x] Add Settings as a code-owned open-only native application after a live Cua PID/window
      proof. Keep Files and Terminal out of the catalog because their DBus-activatable
      services do not preserve the direct `launch_app` PID; do not advertise an installed
      executable as supported without exact Cua identity evidence.
- [x] Reject or clarify when a required value is absent, has two plausible
      interpretations, or cannot be normalized in the configured timezone. Do not let
      Jev generate a replacement value. URL ambiguity, missing date/time, unsupported
      downloads, secret-looking values, and missing verifiers are covered by the task
      compiler tests.
- [x] Compile supported task intents for opening an application, entering exact text,
      creating a local calendar event, setting a local alarm, opening and reading a web
      page, navigating, entering text, selecting an exact browser action, handling a
      page-owned dialog, and uploading an approved file. Keep the execution loop generic
      even though completion profiles are application-aware. Native and browser runner
      tests cover the admitted action paths; unsupported intents stop before input.
- [x] Resolve bare domains and explicit `http` or `https` URLs through the existing URL
      policy. Preserve the exact user source and normalized URL. Reject unsupported
      schemes, embedded credentials, unsafe redirects, and origins outside the compiled
      task grant or browser runtime manifest. Task and browser policy tests cover these
      refusals.
- [x] Default browser tasks to a Cua-owned `isolated_new` profile. Existing-profile
      attachment is admitted only for explicit already-open-browser intent when the
      deployment opt-in is enabled; it remains a separate authorization-host path and
      no prompt can silently broaden an isolated task into live-profile access.
- [ ] Treat Chrome and Edge as the supported browser products. Use only products Cua
      classifies and attests. Do not infer product support from an executable name.
      On Linux, require Cua's exact capability result for the requested preparation
      path and report unsupported product/profile combinations honestly. The adapter's
      code-level classifier now accepts only Cua window identities for Google Chrome or
      Microsoft Edge, including Cua's Linux X11 `Google-chrome`/`Microsoft-edge` WM_CLASS
      forms, and rejects generic Chromium/WebView labels; the live product matrix
      remains open until Cua proves the selected product on the disposable host. The
      launcher selects a product only for its pre-opened fixture; it does not export an
      executable override to Cua's isolated `browser_prepare`, whose installed contract
      has no product selector. Explicit selection on a Cua-owned path fails closed.
- [x] The initial strict profile compiles a deterministic completion specification before
      approval and clarifies when none is available.
- [ ] Complete and live-accept a low-risk native GUI task end to end. The Calculator
      compiler and verifier admit only a non-sensitive, code-parsed arithmetic expression,
      pass bounded `--equation` arguments through Cua `launch_app`, and verify a result
      from fresh Calculator accessibility state. Unit coverage exists, but the latest real
      TUI run returned a Calculator PID that exited before usable observation, so live
      computation acceptance has not passed and Calculator is not claimed as supported.
      Unsupported expressions fail closed. Browser mutations, Calendar and Clocks
      mutations, credentials, destructive actions, and file/secret operations remain
      verifier-gated until their stronger contracts exist.
- [x] Represent resolved app, window, browser target, tab, snapshot, frame,
      continuation, dialog, observation, and element identities as opaque,
      generation-bound references. Keep Cua `window_id` as `bigint` inside adapters and
      an opaque decimal string at JSON boundaries. Never convert it to JavaScript
      `number`.
- [x] Keep the existing `computer({goal})` public schema. Internal task fields are not
      exposed as extra syntax the user must learn; the tool definition remains goal-only.
- [x] Add unit tests for source-span preservation, time/date normalization in
      `Africa/Johannesburg`, URL and origin normalization, redirects, ambiguity, missing
      values, unsupported intents, exact file roots, and malicious instructions
      embedded in app labels, page content, or task text. The focused task, URL-policy,
      browser-strategy, and injection tests cover the implemented boundary.

Gate: every approved value, origin, profile kind, file boundary, action class, and
fallback route is traceable to the user's prompt, trusted deployment manifest, or a
deterministic normalization. Every selected resource is inside its runtime ceiling.
Every terminal success carries fresh deterministic or explicitly labelled calibrated
visual evidence.

### 2. Add native allow-listed app and window lifecycle

- [x] Extend `CuaDriverClient` with the pinned SDK's `callTool`, `listWindows`,
      `getWindowState`, and `verifyState` methods needed by this profile.
- [x] Add adapter methods for checked-in app resolution, app launch, launch-result
      parsing, window discovery, exact window selection, and deterministic verification.
      Keep raw Cua JSON inside the adapter. Launch-result parsing consumes the pinned
      Cua `windows` array, converts only safe decimal window IDs to `bigint`, and refuses
      multiple visible windows for the returned PID. `computer-cua.test.ts` covers the
      snake-case wire shape, exact binding, and ambiguity refusal.
- [x] Use typed SDK methods where `0.28.2` exposes the full contract. Use validated
      `callTool` adapters for `launch_app`, `set_value`, and element-targeted
      `type_text`; the pinned SDK has no typed `launchApp` or `setValue`, and its typed
      text input does not expose every runtime targeting field.
- [x] Resolve applications only from the checked-in app allow-list and the task
      compiler's bounded application choice. Ask for clarification when no supported
      application is represented; never infer a new executable from prompt text.
- [x] Pass only an unchanged `launch_path` from that code-owned allow-list. Reject
      model-provided paths, command strings, `additional_arguments`, URLs, and app names
      that were not resolved by code. Cua's bounded manifest remains the final launch
      authorization.
- [x] Bind the prepared launch to the allow-listed application identity and the exact PID
      returned by Cua. No unscoped app inventory call may silently change the launch target.
- [x] Treat app launch as non-idempotent. If acknowledgement is lost, inspect
      `list_windows({pid})` using the known launch result when possible; do not call
      `launch_app` again automatically. A separate display-scoped discovery profile is
      out of this plan's authorization ceiling.
- [x] Wait within a fixed readiness deadline for exactly one usable target window.
      Resolve by launch PID and returned windows first. Refuse ambiguous or unrelated
      windows instead of choosing array order. Readiness polls remove their abort listener
      on both timeout and cancellation; `computer-cua.test.ts` verifies delayed readiness,
      cancellation, listener cleanup, and failed-start driver shutdown.
- [x] Bind the task to exact `pid`, `window_id`, app identity, display, and Cua session.
      A later window snapshot may refresh element tokens but cannot change the app.
- [x] Bind each task to a fresh bounded Cua `TrustedSession` client over the shared
      application-lifetime runtime, with the same capability manifest and shorter
      30-minute absolute / 5-minute idle ceilings. Route every task operation—including
      `list_windows`, whose typed input carries no session field—through that bound client;
      end the named task session and close its handle exactly once while keeping the shared
      runtime alive. The adapter test runs two sequential task sessions and fails if window
      discovery falls back to the expired implicit session.
- [x] Serialize native operations with an application-level queue and a per-task lock.
      Two turns or tool calls must not act concurrently through one task session.
- [x] Use background delivery first. Do not bring an app to the foreground merely to
      make the implementation appear active.
- [x] Add unit and adapter-contract tests for exact, ambiguous, absent, launch-ready,
      multiple-window, disappeared-window, and acknowledgement-loss cases. Already-running
      reuse remains deferred because discovering it before a launch would require a broader
      native window inventory than this profile authorizes.

Gate: the user can approve one exact installed app, Anesu can launch it through Cua,
and the runner observes one exact window without shelling out or accepting a model
command. Reusing an already-running app is deferred because discovering it before a
launch would require a broader native window inventory than this profile authorizes.

### 3. Replace Playwright with Cua's browser lifecycle

- [x] Use validated `callTool` adapters for the admitted browser operations. Cua `0.28.2`
      advertises typed browser tool contracts, but its installed TypeScript SDK does not
      expose dedicated methods for them. Pass a JSON string with snake-case tool fields;
      do not invent typed SDK methods or pass JavaScript objects directly.
- [x] Add a Cua browser adapter that exposes validated operations for preparation,
      native-window binding, semantic snapshots, navigation, click, type, pointer,
      page-owned dialogs, file assignment, and session cleanup. Keep raw Cua JSON and
      refusal payloads inside the adapter.
- [x] Remove `PlaywrightBrowserAdapter` from runtime construction. Delete
      `src/browser/playwright-adapter.ts` and the `playwright` runtime dependency after
      the Cua replacement passes its focused and live acceptance suites.
- [x] Replace the current `BrowserAdapter` seam instead of wrapping Cua in Playwright's
      shape. Retain `BrowserSessionManager`, URL policy, file policy, artifact store,
      records, and TUI projections only where their contracts remain true. Remove
      adapter-owned profile directories, pages, locators, Anesu document IDs, flat
      snapshots, and generic action summaries. Cua owns the process, profile, target,
      tab, snapshot, refs, and cleanup.
- [x] Start one explicit Cua lifecycle session for each browser task and repeat that
      non-empty, non-`default` session label on every browser call, even where the
      advertised schema marks it optional. End it exactly once on completion, denial,
      cancellation, timeout, failure, or shutdown.
- [x] Keep `window_id` as `bigint` through typed `listWindows`. Use a tested Cua JSON
      encoder that emits its exact unquoted decimal integer for `callTool`; never use
      ordinary `JSON.stringify(bigint)`, convert it to `number`, or expose it to the
      model. Persist only the opaque decimal string.
- [x] Use `browser_prepare` with `allow_launch: true` and
      `profile: {mode: "isolated_new"}` for ordinary browser tasks. Treat it as a
      state-changing, non-idempotent preparation covered by the task grant.
- [x] Accept only the `prepared_pid` returned by Cua. Call `list_windows` for that
      process, require one exact usable browser window, and bind it through
      `get_browser_state({pid, window_id, session})`.
- [ ] For a specifically requested Chrome or Edge product, pass a proven running PID to
      isolated preparation only after Cua classifies the process as a supported
      Chromium product. The resulting profile remains driver-owned and separate from
      the running user's profile. Do not pass executable paths or remote-debugging
      arguments from Anesu.
- [x] Keep `isolated_named` disabled until a later persistence plan defines retention,
      cleanup, migration, and disclosure. The first implementation deletes every
      `isolated_new` profile when its owning session ends.
- [x] Implement existing-profile attachment as a separate, explicit path. It requires one
      exact visible running Chrome/Edge PID and window, Cua's supported-product
      classification, an immutable opt-in manifest entry naming `existing_profile`,
      allowed origins and tools, a trusted Cua authorization-host decision bound to the
      pending session, and an Anesu grant that explains access to live pages, cookies,
      and storage. This is authorization/adapter plumbing only, not a usable Linux feature:
      the pinned runtime still lacks a supported least-privilege source for the exact target,
      as recorded in the open discovery item below. Evidence: `src/browser/cua-adapter.ts`,
      `src/browser/cua-manifest.ts`, and `tests/cua-browser-adapter.test.ts`.
- [x] Consume the authorization-host decision once. Refuse stale or malformed requests,
      mismatched digests, callbacks without a pending approved task, and replay after
      denial, cancellation, expiry, or session close. The adapter also rejects a changed
      prepared PID or attachment kind. Evidence: `src/browser/cua-authorization.ts` and
      `tests/cua-authorization.test.ts`. Live host consent, process/window mutation, and
      restart evidence remain open in the acceptance lane.
- [ ] On Linux, live-accept existing-profile attachment only for product and desktop
      combinations Cua marks as validated. Chrome on X11 is required. Edge attachment
      remains capability-gated until Cua or local release evidence validates it; this
      does not block isolated Edge use.
- [x] Never enable remote debugging through `launch_app`, command arguments, profile
      copying, profile-file editing, or a model-generated Boolean. Use only
      `browser_prepare` and its structured consent or refusal result. The adapter
      contract test asserts that preparation sends only Cua's isolated profile/launch
      fields and no executable, argument, or remote-debugging field.
- [x] Bind only when `get_browser_state` reports `binding_quality: "exact"` and
      `mutation_allowed: true`. Resolve the selected tab only when `active` is `true`,
      or use an explicitly returned tab selected from bounded metadata. Treat
      `active: null`, heuristic binding, duplicate titles, or endpoint ownership
      mismatch as ambiguity, never array order.
- [x] Request `snapshot_format: "semantic_v2"`. Preserve snapshot completeness,
      omissions, frame status, visibility, action refs, content refs, and opaque
      continuation. Use `query`, `scope_ref`, and single-use continuations for bounded
      reads rather than unbounded DOM extraction.
- [x] Invalidate target capabilities on reconnect or process replacement. Invalidate
      tab snapshots, refs, and continuations on navigation or newer snapshot. End of
      session revokes the complete namespace.
- [x] Preserve an incomplete `endSession` cleanup as a cleanup failure. Do not claim a
      clean close merely because the lifecycle session became inactive.
- [x] Serialize browser preparation, binding, observation, and mutation through the
      browser runtime queue and per-task lock. No second turn may share or race a task
      session.
- [x] Preserve the current URL and redirect policy as an Anesu layer. Require the task's
      exact origin set to be a subset of the browser manifest's origin ceiling, and bind
      the narrower set into the task grant. Cua enforces the deployment ceiling; Anesu
      stops a redirect or popup that leaves the task grant before further mutation.
- [x] Add adapter and lifecycle tests for isolated launch, product selection, existing
      endpoint, setup/consent refusal, exact binding, heuristic refusal, ambiguous tab,
      reconnect generation, stale ref, process replacement, cleanup, unsupported browser,
      authorization-host mismatch/replay, and the documented structured browser refusal
      vocabulary. Evidence: `tests/cua-browser-adapter.test.ts`,
      `tests/cua-browser-gateway.test.ts`, `tests/browser-session.test.ts`, and
      `tests/cua-authorization.test.ts`. Live product/profile acceptance remains a
      separate integration gate.

Gate: `pnpm run chat` can prepare an isolated supported Chromium browser through Cua,
bind one exact native window and tab, snapshot it with `semantic_v2`, and close the
Cua-owned process and profile without importing or invoking Playwright.

### 4. Build the complete bounded action set

- [x] Replace `NativeSemanticCandidate.operation: "click"` with a discriminated action
      candidate union. Each candidate carries its exact observation, window, snapshot,
      target, task value, and delivery scope.
- [x] Generate click candidates only for enabled elements exposing a supported AT-SPI
      action or a role with documented click semantics.
- [x] Generate type candidates only for editable elements. The candidate references one
      exact code-owned task value; Jev never supplies the text.
- [x] For compiled native forms, bind source-backed text, date, and time only to a fresh
      editable element whose accessibility label unambiguously identifies that value kind.
      Unlabelled or conflicting controls receive no typed-value candidate. Jev selects the
      bounded element/value-kind candidate; exact values remain code-owned and dispatch is
      revalidated against the same current snapshot. Unit and runner tests prove that an
      alarm time cannot be typed into the separate alarm-label field.
- [x] Prefer a semantic `set_value` candidate when the observed element exposes that
      operation and Cua can read the value back. Use element-targeted `type_text` only
      when the semantic route is unavailable and its exact token/snapshot binding is
      present. Never type at an unbound window or desktop target.
- [x] Generate key candidates from a small allow-list required by the admitted task,
      such as Enter, Escape, Tab, arrow keys, and task-specific safe modifiers.
- [x] Do not infer a keypress grant from a generic calculator goal. Native `press` is
      admitted only when the user explicitly requests a bounded key combination; the
      Calculator regression asserts that “Calculate 2 + 2” grants launch/click/type only.
- [x] Do not translate an arbitrary AT-SPI action name into a guessed keyboard shortcut.
      The initial strict profile correctly refused Calendar's observed `win.new-event`
      action because Cua `0.28.2` has no exact named-action mutation tool. That refusal
      remains correct for an unbound shortcut; it does not prohibit the separately
      specified native fallback ladder below.
- [x] Preserve Cua's safe accessibility element and parent indices and derive an exact
      menu-item path only from the current observed menu lineage. Dispatch that path
      through Cua `invoke_menu`, which resolves every segment again at execution time;
      ambiguous or non-menu ancestry fails closed. Never turn an application action name
      into a guessed accelerator or menu label.
- [x] Generate bounded scroll candidates for one exact window, direction, and amount.
      Do not generate desktop-wide scroll or unlimited repeated scrolling.
- [x] Include `reobserve` and `abstain` in every Jev choice. Do not offer `complete` to
      Jev. The runner completes only after a code-owned verifier reports satisfied
      state.
- [x] Exclude disabled, hidden, stale, zero-identity, password, credential, file-picker,
      terminal, and unrelated-window targets from ordinary candidates.
- [x] Bound candidate count, label length, observation text, task values, and Jev state.
      Preserve truncation evidence so an incomplete candidate set cannot prove absence.
- [x] Add direct tests for click, type, key, and scroll candidate construction plus
      disabled fields, password fields, stale snapshots, truncated trees, duplicate
      labels, and no-candidate outcomes. `native-strategy.test.ts` covers the action union,
      bounds, and restricted targets.
- [x] Remove the Calendar-only candidate suppression. Every native application now follows
      one rule: an exact current structured preparatory control may be selected before an
      editable target exists, while an application-root action never becomes a guessed
      shortcut. `native-strategy.test.ts` covers both cases.
- [x] Implement the structured-to-focused rung for native TypeSafe. When the fresh Cua
      accessibility set is empty, Jev may choose only a code-issued focused text or key
      candidate whose value/key was explicitly parsed from the user goal, whose window
      PID and window identity are present, and whose sensitive-value checks pass. The
      focused route never exposes a coordinate, selector, application shortcut, or
      model-generated value.
- [x] After a structured Cua type/press action is explicitly refused, reobserve the exact
      window and admit the focused rung once when it is available. The refused action is
      not replayed, and the fallback remains inside the existing approval/grant/action
      limit. Focused strategy and runner tests cover direct use, exact binding, refusal,
      fresh observation, and non-replay.
- [x] Implement the currently supported Cua-only native fallback ladder: structured
      AT-SPI element/value action, then focused bounded key/text action after fresh
      observation proves the structured route unavailable or ineffective. The route is
      bound into the compiled task grant, stays within the existing approval and action
      limit, and never replays a refused or uncertain input. Browser tasks retain their
      typed `browser_*` route and never fall back to native browser-window input.
      Pixel and foreground stages remain explicitly unavailable until the complete Cua
      visual-region contract is released; the visual items below are the admission gate
      for those later stages.
- [ ] Define `NativeVisualCandidate` from one Cua `visual_regions_v1` result tied to one
      fresh exact-window capture. It binds the runtime, session, PID, window ID,
      observation/snapshot generation, capture ID, image dimensions, region ID, center
      point, action class, delivery route, and task grant. Jev may select the region ID
      only. It never emits an unrestricted coordinate, selector, screenshot crop, or Cua
      argument.
- [ ] Consume Cua's validated bounded regions instead of implementing a second
      screenshot-to-coordinate planner. Require the exact capture ID in the same Cua
      click call, reject expired or mismatched captures, and re-observe before building
      another candidate set. If Cua does not expose the complete contract, abstain.
- [ ] Admit native visual candidates only for action classes authorized by the task grant
      and only after masking or excluding known password, credential, terminal, file
      chooser, destructive-system, and out-of-scope controls from the current AT-SPI
      state. An incomplete accessibility tree narrows the eligible task classes; it does
      not create general desktop permission.
- [ ] Pass only Cua-validated typed region metadata, the exact capture ID, and bounded
      candidate descriptions to Jev for a visual candidate choice. Screenshot bytes stay
      inside the Cua visual contract; do not persist them in the Anesu decision request,
      send other windows or desktop pixels, or expose driver methods, raw coordinates,
      secrets, or untrusted screen instructions as authority. Retain a content-free image
      digest, dimensions, capture/region IDs, and decision evidence.
- [ ] Treat all screen content as untrusted data. Re-state the immutable user goal and
      task grant in the visual decision request, reject text in screenshots that tries to
      add a task, disclose data, change origin, or widen permissions, and test prompt
      injection embedded in page and native-app images.
- [ ] Add route-selection tests for structured success, unavailable structured action,
      verified keyboard no-effect, visual coarse/fine selection, stale image generation,
      masked risky regions, foreground reapproval, action-limit exhaustion, and no-route
      outcomes. Add a calibrated visual-grounding fixture set before enabling the route
      in production.
- [x] Build browser click, type, upload, scroll, hover, double-click, right-click, drag,
      navigation, and dialog candidates only from the current task contract and current
      `semantic_v2` response. A semantic ref must declare the matching action before
      Anesu offers it. Upload/pointer strategy tests and the Cua gateway tests cover the
      declared-action boundary; downloads remain intentionally absent.
- [x] Keep content refs read-only. Use them only as `scope_ref` values for bounded
      observation. Never promote static page text into a mutation target.
- [x] Select the browser route from the pinned Cua platform contract before task approval:
      default to trusted input where the platform preserves standalone background posture;
      default to Cua `dom_event` on Linux/macOS where the platform refuses trusted input to
      avoid activating the browser window. Synthetic actions remain grant-bound and require
      an independent fresh postcondition; never switch routes after a refusal. Config tests
      cover Linux/macOS/Windows defaults and explicit overrides; the unmodified Linux TUI
      acceptance completes a real Cua click and fresh semantic verification.
- [x] Do not silently change from trusted input to DOM events, from background to
      foreground, from typed browser tools to native input, or from browser tools to
      legacy `page`. A structured route refusal becomes a terminal limitation or a
      separately approved scope change.
- [x] Build browser type candidates from one exact source-backed value, current editable
      ref, and explicit `insert_text` or `keystrokes` mode. Set `replace` deliberately;
      never guess whether existing text should be appended or replaced.
- [x] Build file-assignment candidates only for current refs declaring `upload` and
      exact pre-approved regular files.
- [x] Bind dialog resolution to the current opaque `dialog_id`. Permit prompt text only
      for an accepted prompt dialog and only when that exact value belongs to the grant.
- [x] Treat incomplete snapshots, omitted frames, exhausted continuations, unknown
      visibility, occluded targets, and unsupported out-of-process frames as evidence
      limits. They cannot prove that an action or completion target is absent.
- [x] Add browser candidate tests for declared actions, content refs, stale generations,
      hidden and disabled fields, credentials, incomplete snapshots, frames, duplicate
      names, synthetic-route eligibility, exact file roots, and no-candidate outcomes.

Gate: every supported native and browser interaction can be represented as a finite
Anesu-owned candidate bound to fresh Cua state. A visual candidate may contain only a
code-issued region ID and its derived point. No candidate contains a model-generated
selector, ref, raw coordinate, route, URL, file path, or action argument.

### 5. Use Jev as a chooser, not a planner

- [x] Send Jev the original goal, bounded task summary, selected surface, exact
      app/window or browser target/tab identity, current structured element summaries,
      bounded action history, and candidate descriptions. Runner and native strategy
      request-shape tests prove the bounded payload.
- [x] The initial structured-only profile does not send raw screenshots, Cua tool names,
      raw driver arguments, unrestricted environment values, secrets, or arbitrary launch
      data to Jev.
- [ ] Extend Jev requests only through the bounded native visual decision contract above.
      Its visual input must be Cua-validated typed region metadata and the exact capture
      ID. Screenshot bytes remain inside Cua's visual contract. Browser semantic choices
      remain text and typed-ref based; no raw browser screenshot becomes model input in
      this profile.
- [x] Ask one Choice question whose answer is a candidate ID, `reobserve`, or `abstain`.
      Resolve the returned ID locally and reject IDs absent from the current set.
- [x] Keep Choice probabilities and confidence as decision evidence. They do not grant
      approval or prove task success. Runner records and verifier tests keep these
      separate from approval and completion.
- [ ] Treat the current `0.5` confidence floor as uncalibrated. Build a small labeled set
      from the required app/candidate states, measure incorrect-action and abstention
      behavior, and choose a documented operating threshold from that evidence. Rerun
      calibration when the returned Jev model identity changes.
- [x] Permit bounded retry only when the Jev request failed before producing a decision.
      Do not issue another decision for an observation after input may have started.
      The runner's retry tests cover pre-decision provider failure and no replay after
      input.
- [x] Keep legacy traditional vision and compare modes ineligible in the production
      Cua/Jev profile regardless of provider availability. Preserve their old experiment
      tests without exposing them through production configuration. The new bounded Cua
      visual decision route is not either legacy mode and must pass its own capability,
      privacy, calibration, and acceptance gates before production admission.
- [x] Add request-shape tests proving Jev receives candidate IDs and bounded state but no
      screenshot bytes, page scripts, cookies, storage, credentials, driver methods,
      raw Cua refs, arbitrary coordinates, selectors, or launch commands. Browser and
      native request-shape tests pass in the full suite.

Gate: Jev can influence only which already-valid structured or code-issued visual region
candidate Anesu considers next.

### 6. Replace per-action prompts with a bounded task grant

- [x] Add an approval decision for `allow-task` alongside deny, cancel, and details.
      Retain `allow-once` for risk escalation and diagnostic use.
- [x] Present one task panel before the first state-changing operation. Code-owned native
      application resolution is read-only. Native launch, browser preparation, navigation, input, event creation,
      and alarm creation are inside the grant.
- [x] Show the original goal, selected surface, resolved application or browser profile,
      allowed origins, exact text/time/date/file values, allowed action classes,
      delivery route, maximum actions, deadline, expiry, timezone, and completion condition.
      The TUI renders the compiled values without exposing raw capability tokens.
- [x] Show the authorized native fallback routes in the task panel. The current grant
      displays `structured accessibility → focused key/text`, states that visual and
      foreground delivery are not authorized by the pinned Cua profile, and keeps
      deterministic completion, calibrated visual completion, and outcome-unknown
      distinct. The panel will expose pixel/foreground routes only after their separate
      capability and approval gates pass.
- [x] Hash and persist the immutable grant identity. Every action must pass a local
      grant check before Cua receives it.
- [x] Scope the grant to one task ID and the exact admitted surface set. A native-only or
      browser-only task owns one child Cua session. An explicitly mixed task may own one
      child session in each separately configured runtime under one Anesu coordinator,
      one serialized action queue, and one grant. The grant also binds application or
      browser-profile identity, launch/preparation records, process/window and
      target/tab family, origins, value and file set, action set, input route, delivery
      posture, action budget, and deadline.
- [x] Require a new approval when the resolved app changes, a new task value appears,
      an unapproved action class is needed, the process/window identity leaves the
      grant, or Cua recommends foreground delivery.
- [x] Keep foreground approval separate from background approval, following Hermes's
      delivery-mode scope. Never convert a Cua escalation hint into permission.
- [x] Bind the initial grant to the permitted native fallback routes. The current
      compiler admits only structured and focused key/text delivery for native tasks;
      the runner rejects a focused route absent from that grant. Pixel and foreground
      routes remain outside the grant until the visual capability contract and separate
      foreground approval exist.
- [x] Treat existing-profile attachment as a stronger grant than isolated browsing. The
      task panel identifies the visible existing Chrome/Edge target and explains that Cua
      may access live pages, cookies, and storage; a separate authorization-host decision
      is still required, and denial leaves the existing browser untouched.
- [x] Treat file upload as a separate grant field with exact canonical source files,
      byte/count limits, symlink refusal, and redacted evidence. No general filesystem
      permission follows from the action.
- [x] Treat browser submission, communication, purchases, account changes, and other
      consequential remote mutations as separate high-risk action classes. Do not admit
      them until their completion and uncertainty contracts exist. Reading, navigating,
      and harmless local acceptance-form submission remain in the first acceptance set.
- [x] Refuse credentials and secrets in this slice. A second approval is not sufficient
      because the plan does not build a secret-safe input or evidence path.
- [x] Expire the grant on completion, cancellation, timeout, action-limit exhaustion,
      Cua session close, or terminal uncertainty.
- [x] Add tests showing ordinary task actions do not prompt repeatedly, while app drift,
      value drift, foreground escalation, new risk, expiry, and session drift do.

Gate: one approval covers the declared harmless task but cannot become general desktop,
browser-profile, origin, cookie/storage, filesystem, or remote-mutation permission.

### 7. Execute, reobserve, and react to Cua effects

- [x] Validate task grant, app/window identity, observation generation, snapshot, element
      token, operation, value, and delivery mode immediately before dispatch.
- [x] The initial structured-only profile maps each candidate to one exact Cua call and
      does not repair malformed candidates.
- [x] Dispatch the supported fallback route only through a newly built candidate after
      fresh state establishes that the structured route is unavailable or had no observed
      effect. Never silently mutate an existing candidate, repeat an ambiguous input, or
      use native fallback for a browser page. The runner implements the structured-to-
      focused key/text transition; pixel routes remain gated by the visual contract.
- [x] For browser actions, re-prove the selected runtime, session, process/window,
      endpoint owner, target, tab, origin, snapshot, frame, current ref, declared action,
      input route, and grant immediately before the typed `browser_*` call.
- [x] Map browser navigation, click, type, pointer, dialog, and file-assignment candidates
      only to their corresponding typed Cua tools. Keep legacy `page` and native
      browser-window input unavailable as fallbacks.
- [x] Treat Cua effects separately: `confirmed`, `partial`, `unverifiable`,
      `suspected_noop`, and `refused` must remain distinct in events and evidence.
- [x] After `confirmed`, capture fresh state before continuing or completing. Driver
      acknowledgement alone is not whole-task success.
- [x] After `unverifiable`, reobserve and verify before considering another action.
      Never repeat the same input merely because no change was visible immediately.
- [x] The initial structured-only profile requests a scope expansion after
      `suspected_noop` or foreground escalation rather than changing delivery silently.
- [x] After a fresh observation proves no state progress, replan through the next
      currently authorized background route already bound to the grant. The supported
      transition is structured accessibility to focused key/text; visual and foreground
      escalation remain unavailable until their capability and approval contracts exist.
      If the effect may have occurred or fresh evidence is incomplete, stop as
      `outcome-unknown`; do not climb, retry, or replay.
- [x] Preserve exact structured refusal codes for non-action browser tools as terminal or
      recoverable states, including setup required, consent required or revoked, route
      unavailable, ambiguous or stale binding, wrong target, missing tab, stale ref,
      unavailable action, input-trust unavailable, endpoint-owner mismatch, reconnect
      exhausted, origin outside scope, and incomplete input. The adapter keeps each
      bounded Cua code in `BrowserError.cuaCode` and the browser lifecycle evidence;
      `tests/cua-browser-adapter.test.ts` covers the documented refusal vocabulary.
- [x] For `browser_click`, `browser_type`, and `browser_pointer`, preserve the public
      `ActionResult` effect, route, delivery, and escalation. Cua `0.28.2` deliberately
      does not expose the detailed refusal code in structured output for these actions.
      Keep bounded text as diagnostics only; never parse it into a policy decision.
- [x] Treat successful synthetic DOM dispatch as `unverifiable`. Re-snapshot and prove
      the requested postcondition before continuing. A dispatched event is not proof
      that a trust-gated control activated.
- [x] On Linux, request foreground dialog resolution only after a separate scope
      approval. Cua's inability to resolve a native Chromium modal in the background is
      not a reason to bypass the dialog tool or use desktop-wide input.
- [x] After partial delivery or uncertain acknowledgement, reconcile with fresh state.
      If reconciliation cannot prove the result, terminate `outcome-unknown` without
      replay.
- [x] Invalidate all previous element tokens after every action, window change, or
      reobservation. Build the next candidate set from the new snapshot only.
- [x] Implement the first evidence-driven fallback transition: a refused structured
      native type/press action causes one fresh observation and can admit a focused
      code-issued key/text candidate. The runner never replays the refused action and
      does not use this transition for browser tasks or click actions.
- [x] Keep Ctrl+C effective during app readiness, Jev choice, approval, Cua execution,
      reobservation, and verification.
- [x] Add tests for every Cua effect, stale token, changed window, cancellation at each
      boundary, browser refusal, stale page ref, navigation invalidation, reconnect,
      action-limit exhaustion, deadline, and no-replay behavior.
- [ ] Add runner tests proving the native fallback state machine follows only this order:
      structured action, focused key/text, background pixel, separately approved
      foreground pixel. Cover progress after each route, zero-progress route changes,
      stale visual snapshots, cancellation, uncertain acknowledgement, and a prevented
      duplicate submit/create action.

Gate: the runner performs one input at a time and never converts transport success into
task success or uncertainty into a duplicate action.

### 8. Implement independent completion verification

- [x] Add a verifier registry keyed by task kind and resolved application identity.
      Registration must name its supported completion facts and failure limitations.
- [x] Use Cua `verify_state` for exact window existence, accessible element existence,
      enabled/selected state, and exact value equality where the application exposes
      those facts.
- [x] Require fresh `pid` and `window_id`, one to eight bounded predicates, and a
      bounded timeout. Require two stable satisfied samples only when the predicate is
      unambiguous; duplicate or projected state remains `unknown`.
- [x] Treat `unknown` as unknown. An incomplete or projected accessibility walk cannot
      prove absence.
- [ ] Add a visual postcondition contract for low-risk native tasks whose final UI state
      is not fully represented in AT-SPI. Require a fresh exact-window image, a
      task-specific expected visual fact, two stable observations where appropriate, a
      calibrated Cua visual-region result, and a bounded confidence threshold. Record
      the terminal status as `completed-visual`, never as deterministic proof.
- [ ] Prefer a fresh AT-SPI value, element, or list state for completion even when pixel
      grounding performed the action. For example, Calendar may use a visual `+` target
      to open its form, then AT-SPI state to enter and confirm the visible saved event.
      Visual completion is a fallback, not a reason to ignore stronger current evidence.
- [x] Implement a generic `app-open` verifier proving that the resolved application has
      the bound usable window.
- [x] Implement a Text Editor verifier proving the requested text is present as the
      value of the expected editable control in the bound window.
- [x] Implement a Calendar verifier proving the requested event title, date, and time
      are visible in a fresh post-submit event or list view. Values still present only
      in an unsaved editor do not count.
- [x] Implement a Clocks verifier proving the requested alarm time is visible and its
      alarm control is enabled in a fresh post-submit alarm list. Use a unique label
      when the installed app supports one and remove the test alarm before the
      disposable acceptance profile closes.
- [x] Implement browser verification over a fresh `semantic_v2` snapshot from the exact
      target and tab. Verify the final URL and origin, required visible text or value,
      declared control state, and task-specific postcondition. A tool acknowledgement,
      old snapshot, page title alone, or model narration cannot complete a task. The
      runner and `verification.ts` perform this fresh-state check.
- [x] Verify navigation only after Cua reports the new committed page and a fresh
      snapshot matches the normalized allowed destination. Redirects must remain inside
      the approved origin set.
- [x] Verify browser typing by reading the exact current value from the intended fresh
      ref when the semantic contract exposes it. If page state cannot prove the value,
      return `unknown` rather than trusting `browser_type` acknowledgement.
- [x] Verify local acceptance-form submission through a fresh result state with a unique
      nonce. Seeing the entered text only in the form before submission does not pass.
- [x] Verify file assignment using Cua's correlated result plus fresh page state. Never
      use a guessed path or treat dispatch alone as proof that the page accepted the
      file.
- [x] Keep screenshot interpretation outside browser completion. Optional Cua viewport
      captures are review artifacts, not verifier input in the Jev profile.
- [x] The initial profile reports unsupported evidence when AT-SPI lacks a deterministic
      verifier and never treats a model statement as proof.
- [ ] When AT-SPI lacks enough final-state detail, use only the calibrated visual
      postcondition contract above for an eligible low-risk task. If the released Cua
      visual contract is unavailable, report `outcome-unknown`, not a simulated
      completion.
- [x] Add verifier tests for satisfied, unsatisfied, unknown, wrong app, wrong window,
      duplicate labels, projected tree, stale state, and a model claiming completion
      before the predicates pass. Native and browser verifier tests cover these outcomes.

Gate: each required task ends with fresh state from its exact Cua runtime. It is
`completed` only with deterministic postcondition evidence, `completed-visual` only with
the calibrated visual contract, and `outcome-unknown` otherwise.

### 9. Make the TUI usable for native and browser tasks

- [x] Keep ordinary language as the only required user input. Remove fixture wording
      and internal computer-use instructions from normal help and examples.
- [x] Show short phases: resolving app, awaiting task approval, launching, observing,
      choosing, acting, verifying, completed, clarification required, or outcome unknown.
- [x] For browser tasks, show preparing isolated browser or requesting existing-profile
      access, binding window and tab, current approved origin, observing page, acting,
      and verifying. Do not expose raw target IDs, tab IDs, refs, cookies, or CDP data.
- [x] Render the task approval as a keyboard-controlled panel with approve task, deny,
      details, and cancel choices. Do not use a `y/N` prompt.
- [x] Show app name, task values, current step, maximum steps, delivery mode, and the
      expected completion check without dumping raw tokens or driver JSON.
- [ ] Show Chrome or Edge product identity, isolated versus existing profile, synthetic
      versus trusted input route, and origin changes when those facts affect consent or
      explain a refusal. The current panel shows the supported product family and profile
      mode; exact live product identity still belongs to the browser acceptance lane.
- [x] Do not show an approval panel for every action covered by the current task grant.
      Show a new panel only for a documented scope expansion.
- [ ] Keep the visible Xephyr session and Cua agent cursor enabled so the user can watch
      actions. Explain that the synthetic cursor marks agent activity and does not move
      the user's real pointer. The pinned embedded Cua runtime disables its renderer, so
      this remains open until Anesu can use a supported renderer-enabled Cua host without
      weakening its manifest or task-session authorization.
- [x] Keep Ctrl+C cancellation and Ctrl+D exit working while no approval owns the input.
- [x] Exercise actual interactive Ctrl+C during a running turn, then a second Ctrl+C
      while idle to exit. `approval-tui.test.ts` verifies the keypress reaches the active
      `AbortSignal`, yields one terminal cancelled result, is not submitted as a prompt,
      and closes on the second interrupt.
- [x] Add TUI projection tests for task approval, launch, each action class, verification,
      browser preparation and binding, origin refusal, reapproval, denial, cancellation,
      unsupported app or browser, and outcome unknown.
- [x] Exercise denied Cua window discovery through the interactive TUI, real `runTurn`,
      `ToolRegistry`, `BrowserSessionManager`, and `CuaBrowserAdapter`. The regression test
      approves the bounded task, verifies the safe refusal is rendered, confirms the
      adapter's internal host detail is redacted, and proves no navigation or browser input
      was dispatched (`browser-tui.test.ts`).

Gate: a contributor can understand what the agent is doing without reading protocol
identities, and ordinary in-scope actions do not interrupt the task with repeated
prompts.

### 10. Persist evidence and recover without replay

- [x] Persist task admission, a bounded digest/length/source-span projection of compiled
      values, resolved native application when known, browser profile mode, allowed
      origin, capability summary, approval grant, runtime/session/window/target/tab
      binding, Jev choices, Cua effects, fresh observations, verifier results, and
      terminal outcome in bounded records. Raw text, URLs, and source file paths remain
      out of durable run records; the value-evidence helper and computer-task tests prove
      that boundary. Exact live Chrome/Edge product identity remains an acceptance/TUI
      gate until Cua exposes it as a trusted binding fact.
- [x] Record the Cua package and runtime versions, tool-schema fingerprint, TypeSafe SDK
      version, returned Jev model identity, desktop profile, app desktop-file identity,
      and app version when available.
- [x] Persist candidate IDs and bounded descriptions plus a digest of immutable hidden
      action arguments. Do not persist hidden values, complete accessibility trees, or
      provider payloads.
- [x] Never persist raw CDP endpoints, cookies, storage, profile paths, target internals,
      complete browser snapshots, page scripts, form secrets, source file paths, or
      upload contents. Persist opaque Anesu record IDs and bounded content-free Cua
      refusal/effect evidence.
- [x] Keep raw screenshots, accessibility trees, Cua schemas, provider bodies, and
      secrets out of ordinary run JSONL. Store optional bounded screenshots through the
      existing artifact store and reference them by ID.
- [ ] Keep visual-decision screenshots ephemeral by default. Persist only a content-free
      digest, dimensions, redaction/masking summary, region ID, model identity,
      calibration version, and terminal evidence class. A review artifact needs its own
      explicit retention policy and cannot be required for normal task recovery.
- [x] Redact typed values marked sensitive before TUI or evidence projection. Sensitive
      values remain outside this plan's approval grant.
- [x] On restart before launch or browser preparation, close the interrupted task
      without starting a process.
- [x] On restart after native launch or browser preparation but before input, inspect and
      close the Cua-owned lifecycle without continuing autonomously.
- [x] On restart after input may have started, reconcile from fresh state when possible;
      otherwise record `outcome-unknown`. Never continue the action sequence or replay
      input after restart.
- [x] Reject duplicate, missing, or out-of-order task events and immutable identity drift.
- [x] Add focused acknowledgement-loss tests after task approval, app launch, each input
      class, browser preparation, navigation, file transfer, fresh observation,
      verification, and terminal evidence.

Gate: an interrupted run remains explainable and cannot duplicate an app launch, typed
text, event creation, alarm creation, browser preparation, navigation, submission,
upload, or click.

### 11. Test the real outcome

#### Unit and contract coverage

- [x] Cover capability probing, app resolution, task compilation, source-backed values,
      origin and file policy, native and browser candidate generation, Jev
      request/response validation, task grants, action binding, Cua effect and refusal
      handling, verifiers, and terminal transitions.
- [x] Cover invalid inputs and policy refusals, not only the successful path.
- [x] Use fake Cua and TypeSafe clients for deterministic branch coverage. Fakes must
      implement the real pinned interfaces and may not define tools the capability probe
      does not report.
- [x] Replace Playwright-mechanics tests with Cua browser contract tests. Preserve valid
      URL, redirect, approval, no-replay, artifact, cancellation, persistence, and TUI
      assertions. Delete tests that assert Playwright contexts, pages, locators,
      injected attributes, or Playwright installation behavior.
- [x] Keep the remaining computer, browser policy, approval, persistence, and TUI suites
      passing without importing Playwright.
- [ ] Add deterministic visual-fallback fixtures covering Cua visual-region decoding,
      capture-generation invalidation, strict region-ID parsing, capture-bound click
      arguments, screen-content prompt injection, route escalation, visual postcondition
      stability, calibrated threshold selection, and the boundary between
      `completed-visual` and `outcome-unknown`.

#### Disposable X11 integration coverage

- [x] Start a private display, private session bus, disposable XDG state, and an installed
      launcher-supported window manager. Openbox is preferred; GNOME Shell is the current
      host's available supported lane. The current GNOME Shell probe passes Cua browser
      preflight, isolated Chrome launch, exact native-window binding, active-tab discovery,
      navigation, and cleanup. The real Notes/Text Editor Jev acceptance and the
      Calendar app-open acceptance also pass; Calendar event creation, Clocks, and the
      remaining browser action lanes remain open. A raw Cua control probe reproduces the
      Clocks boundary: Cua returns a launch PID, but `/usr/bin/gnome-clocks` exits before
      exact `list_windows` binding and Cua refuses the dead process as outside the
      manifest; Anesu does not broaden the manifest or retry with an untrusted target.
      A separate raw SDK probe on 2026-09-22 using the pinned Cua `0.28.2` and bare
      executable launches also observed the returned Calculator, Calendar, and Clocks
      launcher PIDs exit before exact window binding; the Text Editor process remained
      alive and exposed its window. This does not erase the earlier interactive
      `Calculate 2 + 2` or `Open Calendar.` acceptances: those are different launch/task
      paths and must be rerun under one recorded disposable profile before support is
      generalized. Unscoped `list_windows` was refused by the bounded manifest, so Anesu
      cannot safely reconcile another process on its own.
- [x] Native production lifecycle diagnostics check the exact Cua launch PID before
      readiness and before each window observation. A process that exits is reported as
      an app-launch lifecycle failure rather than being allowed to degrade into a
      misleading manifest timeout; cleanup does not report an already-dead exact child
      as an unknown desktop state. Deterministic fake runtimes retain their synthetic
      process and cleanup behavior.
- [ ] Start Anesu with immutable acceptance manifests whose native app list, browser
      profile kinds, `https://example.com` origin, deterministic
      `http://127.0.0.1:4173` acceptance service, host, and port, and upload source
      root cover exactly this matrix. Record both
      manifest digests. Prompt text cannot modify either manifest.
- [ ] Run `health_report` and each checked-in app launch inside that same disposable
      profile. Store bounded evidence that required app launch, AT-SPI/capture support,
      and exact PID/window binding are available there; ordinary-host discovery does not
      satisfy this check.
- [ ] Resolve native application launch identity only through a released Cua contract
      that reports the actual launched process/window or a typed handoff refusal. The
      pinned `0.28.2` returns short-lived launcher PIDs for the raw Calculator/Calendar/
      Clocks probes above, and its bounded interface refuses unscoped window discovery.
      Do not infer a replacement PID from an Anesu-side desktop scan, D-Bus call, shell
      command, or pre-existing window. Test both same-process launch and D-Bus handoff;
      preserve the pre-launch window set, require one fresh app-matching owner, and refuse
      ambiguous or absent matches.
- [ ] Exercise real Cua allow-listed app launch, exact window binding, AT-SPI observation,
      click, type, key, scroll, verification, session cursor, and cleanup.
- [ ] Exercise real Cua isolated browser preparation, exact process/window/target/tab
      binding, `semantic_v2` snapshots and continuations, navigation, type, click,
      pointer, dialog, upload, reconnect invalidation, and cleanup.
- [x] Prove that `browser_download` remains unavailable through the public TypeScript
      SDK route and that Anesu neither sends Cua's reserved approval field nor reports a
      refused download as complete. The pinned configured-runtime manifest test receives
      Cua's structured `permission_denied`; gateway and tool tests prove the reserved field
      is never sent and a refused download cannot become a completion result. Live download
      acceptance remains out of scope until a supported Cua host approval route exists.
- [ ] Prove that the native Cua runtime refuses Chrome and Edge windows and the browser
      Cua runtime refuses generic desktop tools. Prove that origin and file boundaries
      remain active after redirects, popups, reconnects, and new tabs.
- [ ] Run the browser matrix against the system-attested Chrome product and Edge when it
      is installed. An absent Edge is an explicit unavailable result, not a mock pass.
- [ ] Run an existing-profile attachment lane against a purpose-created throwaway Chrome
      profile on X11. Prove exact consent, binding, revocation, and cleanup without using
      the contributor's personal profile. Keep Edge existing-profile acceptance gated
      on Cua product-validation evidence.
- [ ] Resolve Linux existing-window discovery without silently widening observation. The
      pinned Cua 0.28.2 browser manifest denies `list_apps`; its live refusal is
      `permission_denied`. The Cua Linux source describes that operation as an unfiltered
      inventory of running and installed apps, and its no-PID private-observation scope is
      the whole display. Cua's attachment contract requires the trusted host to provide the
      exact PID and window ID. Prefer a released app-filtered discovery contract or a
      user-visible trusted target selector that supplies only that exact browser identity.
      Do not present global app inventory or `desktop.display: true` as an equivalent
      least-privilege route. If full-display window enumeration is ever offered as a
      separate opt-in, disclose that broader scope and keep it out of the default
      existing-profile grant. Until a supported target source exists, this path remains
      unavailable; never infer a PID or attach to the first matching browser.
- [ ] Test missing app, ambiguous app, inaccessible app, launch timeout, empty AT-SPI
      tree, changed window, stale token, Jev timeout, low confidence, denied approval,
      Ctrl+C, display loss, and uncertain input.
- [ ] Test browser setup required, consent required and denied, wrong endpoint owner,
      heuristic or ambiguous binding, stale target/tab/ref, unsupported action,
      incomplete snapshot, omitted frame, disallowed origin, private/metadata address,
      trusted-input refusal, synthetic dispatch without postcondition, foreground dialog
      denial, changed upload file, symlink, browser crash, Cua restart, cancellation,
      cleanup failure, and uncertain acknowledgement.
- [x] Assert that the launcher does not inherit the contributor's normal `HOME`, XDG
      directories, desktop bus, browser profile, calendar data, notes, or clock
      configuration. A live GNOME Shell/Xvfb acceptance child used the private
      `/tmp/anesu-cua-xvfb.*/home`, XDG state, Xauthority, display, runtime directory,
      and D-Bus session rather than the contributor's `/home/enoch` and `:1` session;
      the launcher also keeps Cua's isolated browser profile and all app state under
      that runtime. The docs state that this is environment separation, not an OS
      filesystem sandbox.

#### Required real-model acceptance

Run from `anesu/`:

```bash
pnpm run chat:cua-xvfb -- --window-manager gnome-shell
```

The following prompts are completion gates. They run inside the disposable profile and
must use the configured real chat model, TypeSafe Jev, and pinned Cua Driver:

1. `Open the notes app and write "Anesu native acceptance" in a new document.`
2. `[ ] Calculate 2 + 2 in Calculator.`
3. `Open Calendar.`
4. `Open Calendar and create an event titled "Anesu acceptance" tomorrow at 10:00.`
5. `Open Clocks and set an alarm for 07:30.`
6. `Open example.com in the browser and tell me the page heading.`
7. `Open http://127.0.0.1:4173/contact, enter "Anesu browser acceptance" in the message field, and submit it.`
8. `Open http://127.0.0.1:4173/files, upload the workspace file browser-acceptance.txt, and submit it.`
9. `Open example.com, read the page heading, then write it in Text Editor.`
10. `Open http://127.0.0.1:4173 and reveal the safe result.`

The Calculator task compiler and verifier are implemented and covered by tests, but the
live gate is not currently accepted. The latest real TUI task reached approval and Cua
`launch_app` returned a visible Calculator window, then the returned PID exited before
the next usable observation. A direct `@trycua/cua-driver@0.28.2` probe reproduced that
launch-lifecycle failure, while a plain Calculator launch in the same disposable session
stayed alive. Anesu correctly refuses to adopt another PID or weaken exact binding. The
enclosing turn now defaults to 120 seconds when computer use is enabled so a slower Jev
response cannot consume the whole turn before the Cua task approval; an explicit
`ANESU_TIMEOUT_MS` remains authoritative. A live
Calendar mutation run with that longer budget reached approval and then abstained
without dispatching input. Direct Cua inspection of the same disposable profile found
only the application-root `win.new-event` action, with no current menu-item lineage or
editable event control. Under the pinned Cua `0.28.2` public native contract and the
JSON-only Jev SDK, Calendar event creation therefore remains an honest unproven matrix
cell until a generic supported route is available; no Calendar-specific shortcut,
coordinate, shell, or DBus workaround is permitted.

The same-profile real-model run on 2026-09-22 narrows the live evidence further. In a
private Xvfb `:187` session with disposable GNOME Shell state, real Jev, and Cua `0.28.2`:
Notes text entry passed fresh accessibility verification; opening Calendar passed its
`native-app-open` verifier; the local browser prompt `Open http://127.0.0.1:4173 and
reveal the safe result.` passed fresh text verification. Calculator and Clocks each failed
closed because the exact PID returned by Cua exited before usable observation. Calendar
event creation reached approval, then Jev abstained from three observed candidates and
dispatched no mutation. These are task-specific observations, not a completed native
matrix. The disposable display and local acceptance service were closed afterward.

A fresh 2026-09-23 natural-language attempt, `Calculate 2 + 2 in Calculator.`, did not
invoke the `computer` tool: the configured free model answered the arithmetic directly
and offered to open Calculator only if asked. No app launch, approval, or Calculator
verification occurred. Explicit app-action requests now request the named `computer`
function while ordinary questions that merely mention an app remain normal model requests.
If a provider completes the required-choice request with prose only, `runTurn` discards
that prose and routes the exact original user prompt through the ordinary computer tool,
task compiler, approval, and verifier path. It never parses actions from model prose. A
typed provider refusal, wrong or multiple tool calls, or incomplete stream remains a
failure. The durable model-round record labels the recovery `explicit-user-intent`.
`computer-native.test.ts` verifies exact original-goal routing, no narration leakage,
ordinary-question behavior, wrong-tool refusal, typed-refusal handling, and persisted route
evidence. `anesu.test.ts` proves OpenRouter serializes the exact named `tool_choice` and
disables parallel calls.

A real TUI attempt of `Open Files.` on Xephyr `:106` reproduced the provider mismatch:
OpenRouter `cohere/north-mini-code:free` returned prose rather than the required tool
call, and the turn failed with `provider-incomplete` before any computer run, task grant,
launch, or input. This was the live failure that motivated the recovery. The current native
catalog still does not admit Files; this trace is not Files support evidence.

The explicit follow-up, `Open Calculator.`, did route through the real TUI, received one
bounded task approval, and called Cua `launch_app`. In the 2026-09-23 disposable Xephyr
`:100` + GNOME Shell session, Cua again returned a Calculator PID that exited before a
usable observation; Anesu refused the action as `computer-driver-failure` without sending
input. This remains a native launch/window-handoff acceptance failure on this host, not a
reason to claim Calculator support from the routing tests.

Fresh configured-model TUI acceptance on 2026-09-23 used a separate Xephyr `:103` + GNOME
Shell session, Cua `0.28.2`, OpenRouter `cohere/north-mini-code:free`, and Jev resolving
`jev-latest` to `jev-1.13.0`. The ordinary prompt `Open Notes` selected the native computer
tool, requested one bounded Notes task grant, and completed with the exact-window
`native-app-open` verifier without input. `Open Notes and type 'Anesu live acceptance
2026-09-23' into a new empty document. Do not save it.` completed under one grant; Cua's
type acknowledgement was uncertain, but fresh Text Editor accessibility state verified
the exact editable value and no input was replayed. `Set a 07:30 alarm in Clocks.` also
routed to the computer tool and showed one bounded Clocks grant. Cua's launch PID exited
before a usable observation; the computer run durably records
`computer-driver-failure`, with no observation or alarm input, and the assistant response
reports that exact failure rather than claiming an alarm was set. The TUI session and its
SessionStore were retained under an isolated temporary state directory after Xephyr
teardown. The saved transcript, three run records, and verification events contain no
configured API credential and no persisted screenshot files. This closes the real-model
named-app routing acceptance for open, supported in-app work, and honest unsupported
mutation reporting; it does not pass the Clocks alarm capability or native matrix.

After the explicit-intent fallback change, a fresh TUI run on Xephyr `:107` used the same
configured free OpenRouter model and Jev `jev-latest`. `Open Notes.` received one bounded
task grant; Cua bound the exact Notes window and the `native-app-open` verifier passed at
step 0 (13.8s). The live model issued the required tool call, so this run verifies the
normal path after the change, not the prose-fallback branch. That branch is covered by the
deterministic `runTurn` regression. Durable evidence is retained under
`/tmp/anesu-live-route.1f4hBl/state/sessions/session_4a5f6f426f7349808d5fa9cf20a2182d`;
the visible Xephyr session and isolated process tree were closed.

A further natural-task TUI probe on 2026-09-23 used a disposable Xephyr `:172` + GNOME
Shell session, Cua `0.28.2`, the configured free OpenRouter model, and Jev. The prompt
`Create a calendar event called "Anesu test 2026-09-24" tomorrow at 10:00.` reached Calendar;
Jev abstained from three current candidates and no event input was sent. The prompt
`Set an alarm for 7:30 tomorrow in Clocks.` received one task grant, but the Cua-launched
Clocks PID exited before a usable bound-window observation, so no alarm input was sent.
These attempts exposed a compiler gap: a native form verifier could receive only the
launch action class. The compiler now admits bounded click/type for Calendar and Clocks
form tasks, and the native runner binds each normalized source value only to a fresh
editable accessibility field whose label identifies the same value kind. The fake-Cua
runner proves that `07:30` is offered to `Alarm time`, not `Alarm label`, and refuses to
claim completion without fresh enabled-alarm evidence. This closes the code-level value
binding regression, not the live Clocks launch/window-handoff or Calendar event acceptance.

#### Native compatibility matrix

Before claiming Ubuntu computer use beyond one application, run the same bounded
launch/observe/route/reobserve checks against a representative fixed matrix: Text
Editor, Calculator, Files, Calendar, Clocks, LibreOffice Writer, a Qt application when
installed, VS Code when installed, Firefox, Chrome, Settings, Terminal, and Cua's
deterministic native fixture. The matrix is an acceptance instrument, not a promise that
every installed application is supported. An absent optional application records
`unavailable`; it is never replaced with a mock pass.

- [ ] For every installed matrix application, record product/version, toolkit when Cua
      exposes it, X11 or Wayland, window manager/compositor, Cua version, launch result,
      process survival, exact window binding, screenshot capture, AT-SPI availability,
      structured action availability, focused key/text result, background pixel result,
      foreground pixel result where approved, fresh postcondition evidence, and typed
      refusal or failure.
- [ ] Run the primary live acceptance lane on the pinned disposable X11 session. Run a
      separate Wayland capability-classification lane when the host supports it. Do not
      treat an X11 result as a Wayland claim, or a Wayland refusal as an Ubuntu-wide
      failure.
- [ ] Classify failures by shared cause before adding code: launch/session lifecycle,
      window binding, AT-SPI observation, structured input, key/text delivery, pixel
      delivery, foreground policy, visual grounding, or final-state evidence. A fix that
      works only for one application is not accepted as generic computer-use support
      unless that application is explicitly documented as an app profile.
- [ ] Add deterministic fixture coverage for every fallback-state-machine branch, then
      use the matrix to decide which real applications and capability classes Anesu may
      describe as supported. Keep unsupported or uncertain cells visible in `/doctor`,
      the TUI result, documentation, and durable evidence.

- [ ] Each native task resolves the intended installed XDG application without an app
      command in the prompt. Each browser task resolves a Cua-attested Chrome or Edge
      product without an executable path or launch argument in the prompt.
- [ ] Browser tasks prepare an isolated system-attested Chrome or Edge process through
      Cua, bind one exact native window and tab, and never start Playwright.
- [x] `http://127.0.0.1:4173` is a deterministic acceptance service started by the
      launcher and reached through the normal URL and origin policy. Its prompts remain
      ordinary browser requests and never mention fixtures, tools, refs, or Cua. The
      real Jev+Cua heading, form, upload, mixed, click, and denial runs used the private
      launcher service on that exact origin.
- [ ] Each task shows one bounded task approval before launch or input.
- [x] Text Editor proves the exact requested text in fresh editable state. The GNOME
      Shell/Xvfb acceptance run used real Jev, one bounded task approval, Cua element-token
      typing, and fresh native verification after an uncertain Cua acknowledgement.
- [x] Calendar opening proves the launched application identity from a fresh Cua native
      observation. The GNOME Shell/Xvfb acceptance completed `Open Calendar.` at step 0
      with the `native-app-open` verifier and no Jev-selected follow-up input.
- [ ] Calendar proves the exact event title, normalized date, and time in fresh state.
      It must use the generic native fallback ladder, not a Calendar-specific shortcut:
      structured interaction where available, then bounded key/text or visual interaction
      from a fresh exact window, followed by fresh visible event/list evidence.
- [ ] Clocks proves the exact alarm time and enabled state in fresh state.
      It must first pass the generic launch, process-survival, binding, observation, and
      input-route cells in the native compatibility matrix. No Clocks-only workaround is
      accepted.
- [x] The public read task proves the committed final URL, allowed origin, and exact page
      heading from a fresh `semantic_v2` snapshot. The GNOME Shell/Xvfb acceptance run used
      real Jev `jev-1.13.0`, an isolated Cua Chrome process, one bounded task approval, and
      a durable `completed` run whose fresh evidence observed `Example Domain` at
      `https://example.com/`.
- [x] The form task proves the submitted unique text in a fresh post-submit result. Text
      remaining only in the form does not pass. The GNOME Shell/Xvfb acceptance run used
      real Jev, isolated Cua Chrome, trusted typed input, Cua's normalized `dom` dispatch
      route, and a fresh `/contact/result` semantic snapshot before durable completion.
- [x] Upload proves the approved unchanged regular file reached the current upload ref
      and the page reports its expected bounded identity. The GNOME Shell/Xvfb acceptance
      used real Jev, isolated Cua Chrome, one bounded task grant, Cua's typed upload,
      Cua's synthetic submit route, and a fresh `/files/result` snapshot whose filename,
      byte count, and SHA-256 matched the approved file.
- [x] The mixed task retains one Anesu task owner and serialized action history while it
      uses separate browser and native Cua child sessions. Neither runtime crosses the
      other's manifest. A real GNOME Shell/Xvfb run transferred the freshly verified
      `Example Domain` heading from the isolated Cua Chrome child into a separate
      Text Editor child and proved the final editable value after an uncertain native
      acknowledgement.
- [x] The local browser action task proves that a URL plus an interaction intent is not
      reduced to navigation: the fresh semantic `Reveal safe result` candidate was
      selected by Jev, clicked through Cua, and independently verified from the fresh
      result text. On the pinned Linux Cua runtime the platform default is `dom_event`,
      shown in the one bounded task approval; there is no route retry or switch after
      refusal. The no-override Xvfb/GNOME Shell run completed through the actual TUI and
      persisted `status: completed`, `outcome: completed`, `taskSurface: browser`, and
      `inputRoute: dom_event`; full package tests pass 666/666.
- [x] The real isolated-Chrome read-only heading acceptance passes with the prompt
      `Open http://127.0.0.1:4173/ and tell me the page heading.` The fresh semantic
      snapshot exposes `Anesu CUA acceptance`; unrelated hidden/unknown omissions do not
      invalidate positive visible-heading evidence. Missing-heading claims still require
      complete evidence. The verifier, focused runner tests, and live TUI result agree.
- [ ] Calendar proof comes from a fresh post-submit event/list view, and Clocks proof
      comes from a fresh post-submit alarm list. Prefer AT-SPI evidence. A low-risk
      `completed-visual` result is permitted only after the calibrated visual contract
      passes. Unsaved forms do not pass.
- [x] Record an earlier live Calendar mutation attempt honestly: a bounded task grant
      launched/observed Calendar and Jev received three current candidates, then abstained
      because none was appropriate. No event-changing input was dispatched and no Calendar
      mutation support is claimed. The pinned runtime exposed no exact menu-item lineage or
      editable event control in this attempt; visual-region input remains unavailable.
- [x] Record the subsequent live Calendar event-creation attempt honestly: after one bounded
      task grant, Cua returned a PID that exited before the first usable observation. No
      accessibility observation or input dispatch occurred, no event was created, and the
      task failed rather than passing acceptance. Its durable run is retained at
      `/tmp/anesu-cua-calendar-event.XJRfrr/`; the disposable desktop was closed without
      retry. This does not justify an app-specific launch workaround.
- [ ] The disposable acceptance cleanup removes its test event and alarm or deletes the
      disposable profile as one verified harness-owned teardown step. This cleanup is
      limited to artifacts created by the same acceptance run and is not available as a
      user task action.
- [ ] The visible Xephyr window and synthetic Cua cursor show the actions as they occur.
      A 2026-09-23 real TUI capture showed the Notes window and entered text, but no
      clearly visible Cua pointer/glow during the sampled action frames; enabling the
      cursor in the adapter is not sufficient evidence for this gate.
- [x] At least two natural-language computer tasks run sequentially in one TUI process.
      The 2026-09-23 Xephyr/GNOME Shell acceptance ran `Open Notes` and `Open Calendar.`
      in one TUI session. Each received a separate bounded task approval, launched and
      freshly verified its exact app, completed its turn/run, and persisted distinct task,
      grant, and Cua-session identities. Both durable computer-run records remain available
      in retained local acceptance state. This proves these two app-open goals only; it does
      not establish broader native app interaction support.
- [x] The TUI distinguishes a completed assistant turn from an unsuccessful computer task.
      A regression exercises public `TerminalUi.runSingle()` with a completed turn and a
      failed computer-task event, and asserts an amber `turn completed · computer task
      failed` footer instead of a green success footer. The persisted turn status and
      computer-run outcome remain separate.
- [x] The 2026-09-23 Xephyr `:111` TUI sequence started fresh trusted Cua sessions over
      one shared runtime and reached fresh `list_windows`/window observations after the
      first task; one later click dispatched without `session_ended`. This is evidence for
      the lifecycle fix, not completion of the two-verified-goal gate above.
- [x] No task requests per-action approval while it remains inside its task grant. The
      live Jev+Cua browser click acceptance showed `task grant covers` and
      `task-grant` lifecycle activity, with no second interactive browser approval;
      the TUI projection has a regression test for this contract.
- [x] Denying the task sends no launch or input. A real GNOME Shell/Xvfb run denied
      `Open http://127.0.0.1:4173 and reveal the safe result.` at the single task-grant
      panel; the run emitted `computer-approval-denied` and no browser preparation,
      browser process, navigation, or input lifecycle event followed. The regression
      test also persists the distinct denial code instead of classifying explicit user
      denial as unavailable approval.
- [x] Cancelling after native action approval but before dispatch emits terminal
      `cancelled`, sends no input, and persists both action and run records as cancelled.
      Cancellation after dispatch returns a cancelled turn but persists the action as
      `ambiguous` and the computer run as `outcome-unknown`; the dispatch is never replayed.
      `computer-native.test.ts` covers both runner boundaries and both durable `runTurn`
      record outcomes.
- [x] Prevent native app-open verification from swallowing an explicit follow-on action.
      The verifier now admits `native-app-open` only for open-only intent. An unverified
      click request fails task compilation, while an open-and-compute Calculator request
      selects the result verifier. Focused regressions cover both cases. A real configured-
      model TUI run on Xephyr `:113` with `Open Notes and click the New Document button.
      Do not type or save anything.` reached the computer tool and returned the explicit
      `verifier-required` refusal before task approval or input; the chat turn's `completed`
      status was not counted as task success.
- [x] A transcript, computer-run record, and bounded evidence record identify the real
      model versions and verification facts without containing credentials or raw
      screenshots. The retained SessionStore from the 2026-09-23 TUI acceptance contains
      the OpenRouter and resolved Jev identities, terminal run evidence, and verification
      result; an exact-key scan found no configured credentials, and no image artifact was
      persisted.
- [x] `package.json`, compiled runtime imports, startup diagnostics, and test output show
      no production Playwright dependency or Playwright browser execution path. The final
      production scan over `src`, `package.json`, and `dist/src` is clean, and the full
      667-test run passes without importing or executing Playwright.

The plan does not pass if only deterministic fake clients work, the model writes a
success message without state evidence, an app or browser has to be opened manually, a
Playwright process performs browser work, or a reviewer must type internal tool
instructions.

Validation update (2026-09-23): the production build and full Anesu suite pass after
the bounded Cua task-session lifecycle and cancellation changes (`678/678`), and
`git diff --check` is clean. Cancellation is verified both in
`NativeComputerRunner.run()` with a fake environment and in `runTurn()` with the durable
`SessionStore`: cancellation after approval produces no input and terminal cancelled
action/run records; cancellation after dispatch remains outcome-unknown with no replay.
The Xephyr/GNOME Shell TUI also completed and retained two sequential app-open run records
for Notes and Calendar, each with its own task grant and Cua session label.
The task compiler also rejects a Notes open-plus-click request before approval when no
completion verifier represents the click; open-only Notes remains verifiable. Cursor
visibility and the remaining native/browser compatibility acceptance gates remain open.

### 12. Documentation and handoff

- [x] Update `anesu/src/computer/README.md` and `anesu/src/browser/README.md` with the
      native and browser task lifecycles, separate Cua runtimes, Cua/Jev
      responsibilities, task grant, supported apps, browser products, profile modes,
      origins, refusal behavior, and exact profile limitations. The docs explicitly
      describe isolated profiles, typed semantic refs, approval, fresh verification,
      and deferred downloads/existing-profile attachment.
- [x] Update `development/playground/anesu-computer-use.md` so manual testing starts with
      one pnpm command and the natural native, browser, and mixed prompts above. The
      retired `browser_open_and_click` shortcut is no longer documented; the walkthrough
      now uses Cua browser preparation and the disposable acceptance launcher.
- [x] Update `.env.example`, configuration docs, `/doctor`, and `/computer` only for
      settings or diagnostics actually introduced by this plan. Evidence: the current
      configuration exposes the Cua environment/surface/strategy/input-route settings,
      and diagnostics report bounded Cua health, model, browser-product, and unavailable
      download state without secrets.
- [x] Update the production-readiness gap register with evidence delivered here and keep
      unrelated Wayland, production isolation, OCR, cross-platform, and operations gaps
      open. Evidence: section 6 records the Cua typed-browser boundary and deferred
      download/profile work; section 6a records the native/browser plan and its remaining
      production limitations.
- [ ] Update the native computer-use README, TUI help, playground, `/doctor`, and the
      production-readiness register with the implemented fallback order, visual-evidence
      labels, redaction limits, foreground consent rule, and actual application matrix.
      Do not describe Ubuntu, Wayland, a toolkit family, or an application as supported
      without the recorded capability cells.
- [ ] Record exact automated commands, pass counts, coverage summary, manual prompts,
      provider/model names, Cua version, TypeSafe model, native and browser manifests,
      Chrome/Edge product versions, profile mode, origins, and evidence paths in the
      completion record.
- [ ] Move this plan to `completed/` only after every definition-of-done item is checked.

## Security and reliability rules

These rules are implementation requirements:

- The model never supplies a shell command, executable path, `.desktop` launch string,
  Cua tool name, accessibility token, browser target, tab, ref, selector, input route,
  coordinate, file path, origin grant, or verification result.
- App launch uses an unchanged record from the code-owned native allow-list and Cua
  manifest. The task grant binds that exact supported application before launch; the
  bounded runtime does not grant unscoped `list_apps`/desktop observation for discovery.
- The user approves one bounded task. A grant cannot outlive its task or expand itself.
- Background input is the default. Foreground delivery requires a separate approval.
- Separate immutable native and browser Cua authorization ceilings remain the final
  dispatch boundaries. Anesu's task approval does not replace either one.
- Browser origin scoping and generic native input never coexist in one Cua runtime.
  Native tools cannot target Chrome or Edge, and browser tools cannot escape through
  generic desktop input or legacy `page`.
- Isolated browser profiles are the default. Existing-profile attachment always requires
  its own exact, expiring authorization and never follows from approval to visit a URL.
- Cua's opaque endpoint, target, tab, snapshot, frame, ref, continuation, and dialog
  capabilities remain opaque. Anesu never replaces them with selectors or raw CDP IDs.
- Every input binds to one current runtime, app or browser profile, process, window,
  target/tab where applicable, observation, snapshot, origin, and task grant.
- Every action invalidates prior element references.
- Provider retry and input retry are separate. Input is never retried after uncertain
  delivery.
- Cua `confirmed` proves an action effect, not the whole task.
- A successful synthetic DOM event proves dispatch only. Browser completion always
  requires a fresh postcondition.
- `verify_state: unknown` and incomplete accessibility evidence never mean success.
- Application text, accessibility labels, web content, and browser metadata are
  untrusted data, not instructions.
- The disposable X11 profile is a development isolation profile. It is not called a
  production sandbox.

## Out of scope

The following work is not part of this plan:

- traditional vision, compare mode, or automatic strategy fallback;
- OCR, screenshot-to-coordinate planning, or a new vision model. The plan may consume
  Cua's public `parse_visual_regions` contract when a released runtime advertises it, but
  Cua remains the owner of screenshot perception and Anesu does not implement a detector;
- Wayland, macOS, Windows, remote desktops, or a contributor's personal desktop;
- arbitrary shell/process execution as an app-launch fallback;
- Firefox, Safari, WebKit, generic WebView2, and legacy `page` mutations;
- raw CDP access, arbitrary JavaScript, CSS selectors, remote-debugging arguments,
  copied browser profiles, or a second browser automation backend;
- unsupported URL schemes, embedded URL credentials, unapproved origins, arbitrary
  launch arguments, terminal typing, credentials, or secrets;
- purchases, publishing, account changes, communication, and other consequential remote
  mutations until a later plan defines their confirmation and verification contracts;
- browser-file access outside exact approved upload files;
- browser download until Anesu either uses Cua's MCP-host destructive approval path for
  the browser runtime or pins a first-party SDK API that carries equivalent trusted host
  evidence. The implementation must never forge Cua's reserved approval field;
- unrestricted global keyboard shortcuts or native drag-and-drop. Typed Cua browser
  pointer drag remains allowed only for exact same-frame refs inside a browser grant;
- claiming support for an application that lacks a proven delivery route and the fresh
  deterministic or calibrated visual evidence this plan requires; or
- the full production isolation, permission deployment, monitoring, update, and incident
  response work tracked in the production-readiness register.

## Definition of done

Do not mark the plan complete until every item is checked:

- [x] Both configured Cua runtimes pass their required-capability preflight. Anesu fails
      clearly when a required tool, schema field, health check, manifest resource,
      authorization setting, supported Chromium product, or Jev model is absent. The
      native and browser manifest/runtime contract tests and the disposable GNOME
      Shell/Xvfb preflight prove this for the installed Cua 0.28.2 lane; unavailable
      products and unsupported host paths remain explicit failures.
- [x] A normal TUI prompt can resolve, approve, launch, observe, and operate an installed
      code-owned allow-listed native application, with executable presence checked before
      production launch, without manual app startup or internal tool language. Real Jev
      Notes/Text Editor input and Calendar opening pass in the disposable GNOME lane.
- [x] The runtime requests the exact `computer` function for explicit named-app actions,
      routes a prose-only provider completion using the unchanged original prompt, and keeps
      ordinary questions in chat. Wrong/multiple tools and typed provider refusals remain
      fail-closed. `runTurn` verifies no prose leakage, exact-goal routing, refusal handling,
      and durable `explicit-user-intent` evidence; the OpenRouter wire-contract test verifies
      exact `tool_choice` serialization. A real post-change TUI `Open Notes.` acceptance
      passed with the configured free model, though it followed the provider's normal tool
      call rather than the fallback branch.
- [x] With the configured real model, exercise TUI prompts for app opening, a supported
      in-app task, and an unsupported app mutation. Unsupported capability must be reported
      honestly, not simulated. The 2026-09-23 Xephyr/GNOME Shell run routed `Open Notes`,
      verified a typed unsaved note through fresh accessibility state, and returned the
      exact Cua Clocks launch failure without claiming an alarm was set. The real model was
      OpenRouter `cohere/north-mini-code:free`; Jev resolved to `jev-1.13.0`. OpenRouter
      documents named-function `tool_choice`; its current North Mini Code free-model page
      lists support for `tools` and `tool_choice`, while OpenRouter warns that fallback
      endpoints may ignore tool calls. Sources: [tool-calling guide](https://openrouter.ai/docs/guides/features/tool-calling),
      [North Mini Code API page](https://openrouter.ai/cohere/north-mini-code%3Afree/api),
      [tool-calling fallback behavior](https://openrouter.ai/blog/tutorials/tool-calling/).
- [x] A normal TUI prompt can prepare an isolated Cua-owned Chrome or Edge process,
      bind its exact native window and tab, observe `semantic_v2`, act through typed
      browser tools, and clean up without starting Playwright. Real isolated Chrome
      heading, form, upload, click, and mixed runs prove the supported Chrome lane.
- [x] Jev chooses only from fresh Anesu-built native or browser candidate IDs. It never
      supplies a command, selector, coordinate, URL, Cua ref, file path, input route, or
      completion result. Request-shape, candidate-binding, and Jev response validation
      tests cover both surfaces.
- [x] One task approval covers ordinary actions inside an immutable surface/app/profile/
      origin/value/file/action/route/budget envelope. Foreground delivery, existing-
      profile access, and any scope expansion require their documented approval. Live
      browser and denial runs plus grant tests cover this boundary.
- [x] Every Cua action is bound to the exact current task and runtime plus all applicable
      app, profile, process, window, target, tab, origin, observation, snapshot, frame,
      ref, dialog, and file identities. Adapter, gateway, task, and stale-generation
      tests enforce the binding.
- [x] Anesu owns two separately configured bounded Cua drivers for the application
      lifetime. A native-only or browser-only task owns one child session; a mixed task
      owns one child session in each runtime under one serialized action queue. Window
      identities remain 64-bit-safe and opaque. Runtime construction and mixed-run tests
      cover the two-owner/child-session design.
- [x] The native runtime cannot target Chrome or Edge. The origin-scoped browser runtime
      cannot use generic desktop observation or input, legacy `page`, an origin outside
      its manifest, or a file outside its configured roots. Pinned configured-runtime
      manifest-denial tests and task/file policy tests prove these boundaries.
- [ ] Text Editor text entry, Calendar opening/event creation, and Clocks alarm creation
      pass in the visible disposable profile using the real configured models and the
      generic native fallback ladder where needed. No task receives an app-specific
      coordinate, shortcut, launch, or verification patch.
- [ ] The representative native compatibility matrix has fresh disposable acceptance
      evidence. Documentation distinguishes the proven application/action/session cells
      from unavailable and uncertain cells instead of claiming generic Ubuntu support.
- [x] Public-page reading, local form submission, upload, and mixed browser-to-native
      transfer pass through Cua in the visible disposable profile using the real
      configured models. Calendar event creation and Clocks alarm creation remain
      separately gated by their own native postcondition evidence.
- [x] The initial supported tasks complete only through fresh deterministic verification
      from the exact native window or browser target and tab. Tool acknowledgement and
      model narration never count as completion. The live browser and Text Editor runs
      and native/browser verifier suites prove the supported completion paths.
- [ ] Native visual fallback tasks complete only through the fresh deterministic evidence
      available after visual interaction or the separately calibrated `completed-visual`
      contract. Tool acknowledgement and model narration never count as either form of
      completion.
- [x] Denial, cancellation, ambiguity, unavailable app or browser, inaccessible UI,
      disallowed origin, incomplete browser state, stale native or browser capability,
      low confidence, route refusal, timeout, driver or browser loss, cleanup failure,
      action limit, and outcome unknown are distinct and tested. Focused failure and
      persistence suites cover the implemented refusal vocabulary; live host-specific
      matrix gaps remain listed above.
- [x] App launch, browser preparation, navigation, submission, upload, and native or
      browser input are never replayed after uncertain acknowledgement, cancellation,
      or restart. Recovery and acknowledgement-loss tests cover these boundaries.
- [x] TUI task progress, task approval, and final evidence are understandable without
      exposing secrets or raw protocol data. Visible cursor behavior remains a separate
      unchecked live-acceptance item.
- [x] `playwright` is absent from production dependencies, runtime imports, startup
      diagnostics, and browser execution. No second browser automation backend remains.
- [ ] Automated tests, native and browser integration checks, and all listed real-model
      acceptance tasks pass, and their evidence is recorded.
- [ ] Documentation describes exactly what works, what refuses, and what remains outside
      this profile.

## Required validation

From `anesu/`:

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm coverage
git diff --check
```

Also run the focused native and Cua browser contract suites plus the visible acceptance
command documented above. A missing provider, TypeSafe key, graphical dependency,
required app, supported Chromium product, browser capability, AT-SPI evidence, or live
`semantic_v2` evidence is a failed or blocked acceptance result. It is never counted as
a pass.

## Completion record

Not complete. Add the completion date, implementation summary, exact validation output,
real model names, Cua package/runtime version, accepted prompts, evidence paths, and
remaining production gaps only after every definition-of-done item passes.

Current native capability note: Cua `0.28.2` exposes Calendar's application-root
`win.new-event` AT-SPI action in `get_window_state`, but its public native tools only
invoke safe activation verbs or exact menu paths. Anesu does not broaden that allow-list,
send a guessed accelerator, use unbound coordinates, or call shell/D-Bus APIs. A missing
structured Calendar route is therefore evidence for the generic bounded fallback ladder,
not a Calendar-specific patch or a permanent product limitation. The current pinned Jev
SDK accepts JSON state, which is compatible with Cua's typed-region recipe, but the pinned
Cua runtime lacks the required visual-region and capture-bound click capabilities. The
visual stage therefore remains unavailable until a released Cua contract is present;
meanwhile Calendar event creation correctly returns an explicit unavailable/unknown result
rather than pretending an app-root GAction is an executable action. The same rule applies
to Clocks and every other matrix application.

Launch handoff evidence (2026-09-23): `pnpm view @trycua/cua-driver version dist-tags --json`
still reports `0.28.2` as the latest published release. The local
Cua clone's checked-out `main` does not contain the Linux D-Bus launch-handoff work; that
code exists on `feat/osworld-cuadriver-optimization` in
[`8f8bc9f7f`](https://github.com/trycua/cua/commit/8f8bc9f7fab934024d839fd88820d5da0763b30e),
with a later typed timeout refusal in
[`7c7d6f663`](https://github.com/trycua/cua/commit/7c7d6f663b7c575ddb2b22825eec197ed5f22769).
The branch snapshots existing X11 window IDs and looks for a fresh window after the
launcher exits, but its current matcher can select the first matching window. Treat it as
useful upstream design evidence, not a shipped Anesu/Cua capability: a usable released
contract and stricter unique-match/ambiguity-refusal acceptance are required before
Anesu may bind to a handed-off process. The pinned release is documented at the
[Cua Driver 0.28.2 release](https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.28.2).

Release and live acceptance update (2026-09-23): the primary-source audit in
[`cua-current-release-status-2026-09-23.md`](../../../../docs/research/cua-current-release-status-2026-09-23.md)
confirms that Cua PR #3943 has merged Linux `parse_visual_regions` plus screenshot
`capture_id`-bound pixel clicks, but these are not in the published `0.28.2` package and
require the optional `cua-perception` extension. This is a real upstream capability under
development, not a capability Anesu can enable against its pinned package. It also does not
solve launch-PID handoff. Do not install a nightly or call broad window discovery to bridge
either gap; retain the visual route and affected native app cells as unavailable until a
released, contract-tested Cua path exists.

The explicit prompt `Calculate 2 + 2 in Calculator.` was also exercised in the real TUI on
Xephyr `:100` with GNOME Shell, the configured free OpenRouter model, Jev, and Cua `0.28.2`.
It reached the computer-task grant, and the approval panel showed the bounded Calculator
scope, `--equation 2 + 2`, and the expected result `4`. After approval, Cua returned a PID
that exited before a usable observation. Anesu sent no calculator input, recorded
`computer-driver-failure`, and made no completion claim. This confirms natural prompt
routing and the approval preview, but it does not pass Calculator computation acceptance.
The disposable TUI evidence was stdout-only; the isolated display and state directory were
closed by the launcher.

The same live failure exposed a completed-response routing edge: a provider can ignore the
required `computer` tool choice. `runTurn` now replaces only a completed mismatched response
for an already-classified explicit computer request with one code-issued `computer` call
whose goal is the exact immutable user prompt. Provider refusals, transport failures,
incomplete streams, and malformed events remain failures. Deterministic integration tests
cover prose-only, wrong-tool, and mixed prose/tool responses; each proves no other tool is
executed. Natural questions that mention an app still do not force computer routing.

Cancellation acceptance is covered at both ownership seams. Fake-Cua
`NativeComputerRunner.run()` proves cancellation after approval but before dispatch yields a
terminal `cancelled` event with zero input; `runTurn()` with the real `SessionStore` proves
the action and run records become terminal `cancelled`. The separate post-dispatch test
keeps the run `outcome-unknown` and proves there is no replay.

Sequential-session correction (2026-09-23): installed Cua `0.28.2` exposes
`createTrustedSession`, which binds all task operations to a named, bounded session even
when a typed tool such as `list_windows` has no session argument. Anesu now keeps the
application runtime as owner, creates one trusted session client per task with the same
manifest (30-minute absolute / 5-minute idle TTL), and ends/closes that client during task
cleanup. Adapter contract tests prove two task clients share one runtime while each
sessionlessly typed window-list call remains out-of-band bound to its task session.
The real TUI sequence on Xephyr `:111` completed a Notes text-entry task, then opened and
observed fresh sessions for subsequent tasks; a later click dispatched without the previous
`session_ended` failure. It did not complete two sequential verified actions: one prompt
requested a click but compiled to app-open-only, and another text task became uncertain
before Jev abstained. The false open-only classification is fixed in
`deriveNativeVerificationSpec`; the verified-goal gate remains open.

The earlier 8-fps Xephyr capture showed the Notes window and entered text but no clearly
visible Cua pointer/glow. A later screenshot showed only the idle desktop, not an action.
Cursor visibility remains unaccepted; startup `set_agent_cursor_theme` and
`set_agent_cursor_enabled` calls are not visual evidence.

Cursor investigation update (2026-09-23): the pinned SDK's `createConfigured()` constructor
uses the embedded runtime, whose `RuntimeOptions::embedded()` sets `CursorConfig.enabled` to
false. Linux only initializes the overlay renderer when that configuration is enabled;
the current session-level cursor setter does not start it, and `move_cursor` can return a
successful acknowledgement while the overlay command is dropped. A fresh 30-fps Xephyr
recording during a real Jev-approved Notes text-entry task showed the document and entered
text but no agent cursor. The TUI action itself completed with fresh accessibility evidence.
Anesu also corrected its cursor-target coordinate conversion: the pinned Linux overlay
expects absolute display coordinates, not window-local screenshot coordinates. The focused
adapter regression passes with the absolute point, but this is not visual proof. Both the
renderer-enabled host path and a visibly captured action remain required; do not mark this
gate complete until the Cua host can enable rendering without changing authorization scope.

Latest validation (2026-09-23): `pnpm --dir anesu run build`, the focused TUI regression,
`pnpm --dir anesu test` (679/679), and `git diff --check` pass. The real TUI run typed the
requested unsaved Notes text and passed its fresh native verifier. The recording did not
show the synthetic cursor, consistent with the embedded-runtime limitation above.
Cancellation remains covered at both seams: fake-Cua `NativeComputerRunner.run()` for
pre-dispatch cancellation and real-`SessionStore` `runTurn()` records for pre- and
post-dispatch outcomes; post-dispatch remains `outcome-unknown` with no replay.

The later real Calendar event-creation attempt on Xephyr/GNOME Shell failed during Cua
launch handoff: the returned process PID exited before the first usable observation. No
input was dispatched and no event was created. The durable failed run is retained under
`/tmp/anesu-cua-calendar-event.XJRfrr/`; no retry or Calendar-specific workaround was made.
That failure exposed a misleading TUI footer: after the computer failure event, the
successfully completed assistant turn was rendered as green `completed`. The UI now ends
with an amber computer-task failure footer while preserving the distinct assistant-turn and
computer-run outcomes; the public TUI regression covers this distinction. Calendar
launch/process handoff, event creation, action-time visible cursor, and the broader native
compatibility matrix remain open.
