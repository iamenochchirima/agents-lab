# Cua browser migration audit

Date: 2026-09-20

This note audits the browser migration requested for Anesu. It uses only the local first-party checkouts listed below. It does not claim that Anesu has completed the migration or passed live browser acceptance.

## Source revisions

| Project | Revision | Scope read |
| --- | --- | --- |
| Cua | `9bbfa7dd3e27ca7f1861ede70aaca390174493f9` | Cua Driver 0.28.2 browser tools, Linux adapter, authorization, manifests, session store, TypeScript SDK, tests, and release notes |
| Anesu | `c1f542ec8a159682e812aea7dd7e7ac731caab75` | Current Playwright browser adapter, session manager, tools, policies, computer browser strategy, runtime wiring, and tests |
| Hermes | `b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a` | Browser session ownership, snapshots, URL checks, environment filtering, cleanup, and profile handling |
| OpenClaw | `912685f442286233fbbd40762482d98598299497` | Computer-use contract, browser actions, provider generations, execution ownership, serialized input, stale observations, and cleanup |

## Finding

Cua Driver 0.28.2 can replace Anesu's Playwright execution path for Chrome, Chromium, and Edge on the supported Linux X11 setup. This is not an adapter swap. Cua already owns browser preparation, process and window proof, CDP endpoint ownership, tab capabilities, semantic snapshots, stale-reference rules, input delivery, origin authorization, file transfer controls, and session cleanup. Anesu must stop minting a parallel browser identity and reference model.

The right boundary is:

```text
Anesu task planning, approval, URL policy, redaction, records, recovery, and verification
                                  |
                       one task-scoped Cua session
                                  |
browser_prepare -> get_browser_state bind -> semantic_v2 snapshot
                                  |
 browser_navigate / browser_click / browser_type / browser_pointer / dialog / files
                                  |
                 fresh semantic_v2 snapshot and task verifier
```

## Upstream Cua capability

### Exact lifecycle

The supported lifecycle is fixed by Cua's browser contracts:

1. Create one configured Cua driver for the Anesu application lifetime. The TypeScript SDK exposes `CuaDriver.createConfigured(...)`, `callTool(...)`, `listToolsJson()`, `startSession(...)`, and `endSession(...)`. Source: `cua/libs/cua-driver/typescript/src/index.ts` and `cua/libs/cua-driver/typescript/src/native/cua_driver_sdk.ts`.
2. Start an explicit non-default session for the task. Browser targets, tabs, snapshots, refs, and continuations live inside that session. Ending the session removes its namespace. Source: `cua/libs/cua-driver/rust/crates/cua-driver-core/src/session.rs` and `browser/store.rs`.
3. Prepare the browser explicitly with `browser_prepare`. Read-only inspection never enables remote debugging. Source: `browser/tools.rs`, `BrowserPrepareTool`, and `browser/platform.rs`.
4. Prefer a driver-owned isolated browser for the initial Anesu implementation. Call `browser_prepare` with `allow_launch: true` and `profile.mode: "isolated_new"` or `"isolated_named"`. On Linux, pid-free launch selects only a recognized root-owned, non-writable system Chrome, Chromium, or Edge executable. Source: `browser/prepare.rs` and `platform-linux/src/browser_platform.rs`.
5. If a task later supports the user's existing signed-in browser, require a separate exact-profile authorization. Pass `strategy.kind: "existing_profile"`, plus the exact `pid` and `window_id`. This is not implied by ordinary task approval. Source: `browser/tools.rs`, `authorization.rs`, and `browser-existing-profile-attachment-plan.md`.
6. Bind the exact native browser window by calling `get_browser_state` with `pid`, `window_id`, and `session`. Cua proves the process-owned loopback endpoint and correlates the native window with a CDP browser target. It returns opaque target and tab ids or refuses. Source: `browser/engine.rs`, `browser/tools.rs`, and `platform-linux/src/browser_platform.rs`.
7. Observe one exact tab with `get_browser_state`, passing `target_id`, `tab_id`, `session`, and `snapshot_format: "semantic_v2"`. Optional `query`, `scope_ref`, `continuation`, and `include_screenshot` stay on this read-only path. Source: `browser/tools.rs`, `GetBrowserStateTool`.
8. Build Jev choices only from actions declared on current semantic refs. Cua refs use the opaque `p<snapshot>:<index>` namespace. A newer snapshot, navigation, reconnect, tab change, session end, or target generation change can invalidate them. Source: `browser/store.rs` and `browser/engine.rs`.
9. Execute one typed Cua action. Every mutation revalidates the exact target and tab and takes the Cua mutation lock. Source: `browser/tools.rs`, `browser/pointer.rs`, and `browser/engine.rs`.
10. Observe again. Action dispatch is not task completion. Verify the requested postcondition against a fresh snapshot or an independent artifact before declaring success.
11. End the task session on success, denial, cancellation, timeout, or failure. Isolated profile cleanup belongs to Cua. Anesu must preserve and report cleanup failure rather than claiming a clean close.

### Browser tools in 0.28.2

`browser/tools.rs` registers these first-class tools:

| Tool | Contract relevant to Anesu |
| --- | --- |
| `browser_prepare` | Explicit endpoint preparation. Isolated launch and existing-profile attachment have different authorization requirements. It is destructive, non-idempotent, and open-world. |
| `get_browser_state` | Read-only bind or snapshot. `semantic_v2` returns typed action refs and bounded continuations. It never performs setup. |
| `browser_navigate` | Accepts `http`, `https`, and `about`. Navigation invalidates page refs. The manifest can restrict live origins. |
| `browser_click` | Uses an exact ref or viewport coordinates. The default trusted route uses CDP input. `dom_event` is an explicit synthetic fallback and does not prove control activation. |
| `browser_type` | Requires a current editable ref. `insert_text` is the default. `keystrokes` is explicit. `replace: true` selects and replaces existing content. |
| `browser_pointer` | Hover, right click, double click, scroll, and drag. Ref capabilities limit allowed actions. Trusted and synthetic routes remain distinct. |
| `browser_dialog` | Inspects or resolves page-owned JavaScript dialogs only. It does not handle browser permission UI, extension UI, native dialogs, or file pickers. |
| `browser_set_input_files` | Assigns approved absolute regular files to a current file-input ref. It rejects symlinks and directories. |
| `browser_download` | Triggers one ref-bound download into an approved canonical directory. It needs host destructive-tool approval and does not return sensitive URL or path details. |

The legacy `page` tool still exists for compatibility, but its source says to prefer `get_browser_state` plus the `browser_*` tools. Anesu should not migrate to `page`, arbitrary JavaScript, selectors, or a new CDP wrapper. Source: `cua-driver-core/src/page.rs` and `docs/browser-tool-implementation-journal.md`.

### Installed TypeScript SDK boundary

The 0.28.2 TypeScript SDK has typed methods for lifecycle and native window discovery,
but browser operations reach it through `callTool(name, argumentsJson)`. Anesu must send
snake-case JSON through a tested encoder. `window_id` stays a `bigint` for typed
`listWindows`, so normal `JSON.stringify` cannot encode it and conversion to a JavaScript
number may lose identity. The encoder must emit the exact decimal JSON integer while the
Anesu record boundary stores only an opaque decimal string.

`browser_prepare`, `get_browser_state`, `browser_navigate`, `browser_dialog`, and
`browser_set_input_files` advertise no output schema in `listToolsJson()`. The adapter
therefore needs pinned, version-specific output decoders. Structured browser refusals can
arrive with `isError: false`. For click, type, and pointer, the public SDK exposes only
the closed `ActionResult` effect, route, delivery, and escalation. It does not expose the
detailed refusal code in structured output, so Anesu must not parse free-form diagnostic
text into policy.

`browser_download` is a separate boundary. The public TypeScript SDK removes Cua's
reserved approval argument before dispatch. The Cua MCP server inserts that argument only
after the MCP host's destructive-action approval flow. Anesu cannot call download through
the public SDK, cannot forge the reserved field, and should not add an MCP transport just
for this operation. The active plan defers downloads until Anesu adopts Cua's supported
MCP-host route for the browser runtime or a first-party SDK API carries equivalent trusted
host approval.

Sources: installed `cua_driver_sdk.d.ts`; `cua-driver-sdk/src/lib.rs::call_tool`;
`cua-driver-core/src/browser/download.rs`; and `cua-driver-core/src/server.rs`.

### Permission boundaries

Cua's permission model is part of the implementation, not an optional second check:

- `browser_prepare` for an isolated profile is an actively enforced R1 operation.
- `browser_prepare` for an existing profile is an actively enforced R2 operation with an existing-profile grant. Its scope includes the exact process, window, browser product, endpoint owner, policies, and session. It expires and is revoked by session end, policy changes, process or endpoint changes, daemon restart, or reconnect exhaustion.
- `get_browser_state` is protected private observation.
- `browser_navigate`, `browser_click`, `browser_type`, and `browser_pointer` are protected browser-bound input. Their resource includes the exact binding, tab, and live origin.
- Dialog resolution is a consequential browser action.
- Upload and download also cross the file-transfer boundary. Downloads require the host's destructive-tool approval marker.
- A bounded capability manifest must allow the exact tools and browser origins. Existing profiles additionally require the exact profile resource or the reviewed existing-profile kind. File operations require canonical read or write paths.
- Generic desktop input must not be included merely to bypass browser origin limits. Cua's own browser manifest example omits it for that reason.

Sources: `cua-driver-core/src/authorization.rs`, `session_manifest.rs`, `policy.rs`, `browser/tools.rs`, and `blog/extension-free-browser-use.md`.

Anesu's task approval should authorize the user-visible task. It must not replace Cua's immutable runtime authorization ceiling. The host maps the approved task to permitted tools, origins, profile mode, file paths, and time bounds before execution. The model cannot widen that set.

### Linux X11, Chrome, and Edge limits

The target for this migration should be Linux X11 with Chrome, Chromium, or Edge. The following limitations come directly from the 0.28.2 Linux adapter:

- Isolated pid-free launch accepts only fixed root-managed candidates: Google Chrome, Chromium package paths, and Microsoft Edge. A user-controlled executable or symlink is refused.
- X11 native ownership uses the window id and `_NET_WM_PID`, corroborated by the process-owned loopback endpoint. The CDP and native window geometry must agree for an exact standalone-browser binding.
- The loopback DevTools port must belong to the approved process. A returned WebSocket URL must use that same attested port.
- Trusted CDP pointer input for a standalone browser activates its browser window on Linux. Cua refuses trusted background pointer delivery when preserving background posture is required. The explicit `dom_event` route can remain in the background, but it is synthetic and must be verified.
- Resolving a JavaScript dialog on Linux requires `delivery_mode: "foreground"`. Background resolution is refused.
- Browser navigation and text input can use CDP without borrowing the physical keyboard or pointer. Pointer cursor animation is feedback, not proof that the page changed.
- Chrome and Edge existing-profile setup may expose browser-owned consent UI. Cua automates only the recognized exact setup flow after host authorization. Ambiguous UI or endpoint ownership is refused.
- Generic Wayland does not have the same exact window proof. This audit does not extend the acceptance claim beyond X11.

Sources: `platform-linux/src/browser_platform.rs`, `browser/pointer.rs`, `browser/tools.rs`, `docs/browser-tool-implementation-journal.md`, and `docs/browser-existing-profile-attachment-plan.md`.

## Current Anesu implementation

Anesu currently has two browser paths that duplicate Cua responsibility:

1. `anesu/src/browser/playwright-adapter.ts` launches a Playwright persistent Chromium context, owns pages and tabs, mints Anesu document and element ids, injects `data-anesu-ref`, executes locators, handles dialogs, captures screenshots, and manages uploads and downloads.
2. `anesu/src/computer/runner.ts` drives those browser tools through a separate browser action loop, while `computer/browser-strategy.ts` derives candidates from the Playwright snapshot format.

Runtime construction in `anesu/src/runtime/application.ts` creates `PlaywrightBrowserAdapter` and `BrowserSessionManager`. The package has a direct `playwright` dependency. Model-facing tools in `anesu/src/browser/tools.ts` expose `browser_start`, `browser_open`, `browser_snapshot`, browser mutations, artifacts, and `browser_close`.

Useful Anesu behavior that should survive the migration:

- URL validation, embedded-credential refusal, private and metadata address blocking, redirect checks, and explicit local-host exceptions in `browser/policy.ts`.
- Task-level approval identity, timeout handling, secret redaction, and durable action phases in `browser/tools.ts` and `browser/records.ts`.
- No automatic replay after a started side effect. Timeout, cancellation, crash, or lost acknowledgement becomes an ambiguous outcome.
- Bounded upload and download paths, regular-file and symlink checks, artifact limits, and cleanup evidence.
- Natural browser routing and the Jev bounded-choice rule in `computer/routing.ts`, `computer/router.ts`, and `computer/browser-strategy.ts`.

Behavior that must not survive as a second source of browser truth:

- Playwright browser process ownership and persistent contexts.
- Playwright page, locator, dialog, screenshot, upload, and download execution.
- Anesu-minted tab, document, and element refs.
- DOM mutation with `data-anesu-ref`.
- Playwright-specific installation advice, environment options, failure mapping, profile cleanup, and retry assumptions.
- The `browser_open_and_click` shortcut. It hardcodes one narrow workflow and conflicts with the general observe, choose, act, verify loop.

Relevant tests are spread across `browser-playwright.test.ts`, `browser-session.test.ts`, `browser-tools.test.ts`, `browser-tui.test.ts`, `computer.test.ts`, plus policy, artifact, and records tests. Tests tied to Playwright mechanics must be replaced. Policy and lifecycle expectations should be ported to the Cua contracts.

## Migration work required

### Runtime and contracts

- Remove the `playwright` dependency and delete `PlaywrightBrowserAdapter` after the Cua path passes replacement acceptance.
- Replace `BrowserAdapter` with a Cua browser gateway that uses the application-owned configured driver. Do not create one Cua driver per action.
- Keep one named Cua session per approved task and serialize all browser and desktop actions through the same task queue.
- Validate the live 0.28.2 tool schemas at startup through `listToolsJson()`. Fail readiness if required browser tools or expected schema fields are absent.
- Include Cua health and browser capability results in `doctor`. A package version alone is not readiness.
- Store Cua's opaque `target_id`, `tab_id`, snapshot id, refs, connection generation, native pid, and window id. Do not translate them into weaker Anesu locators.

### Browser preparation and routing

- Make `browser_prepare` the only path that creates or attaches a browser endpoint.
- Ship isolated Chrome or Edge as the default. Existing-profile attachment remains a separate later mode until its explicit authorization and live consent flow pass acceptance.
- After isolated preparation, discover and bind the returned exact process and native window. Do not select a browser by title or list order.
- Preserve Anesu's URL preflight. Also enforce the approved live origin through the Cua capability manifest, so redirects cannot escape the task boundary.
- Route browser and native desktop work through one task runner. A browser file picker, native prompt, or another app can then use the native Cua path without changing execution ownership.

### Observation, Jev choices, and action mapping

- Use `semantic_v2` as the primary browser observation.
- Convert only current Cua action refs into Jev candidates. Candidate data should include the allowed Cua action, role, accessible name, visible text, target, tab, snapshot generation, and task-relevant value supplied by Anesu.
- Never ask Jev to invent URLs, text, file paths, coordinates, refs, or completion. Those values must come from the approved task or current Cua observation.
- Map candidate operations directly to `browser_navigate`, `browser_click`, `browser_type`, and `browser_pointer`. Use `browser_dialog` and upload only when the task grant includes them. Defer download until Anesu uses a supported Cua host route.
- Prefer refs over coordinates. Use trusted input by default. Select `dom_event` only after a structured trusted-route refusal and only if the task permits synthetic delivery. Record the weaker proof and verify the postcondition.
- Treat stale refs, changed generations, and lost tabs as a demand for a fresh observation, never as permission to retry an old action.

### Approval, recovery, and records

- Present one bounded task approval that names the browser mode, allowed origins, permitted action classes, files, expected completion condition, and expiry.
- Require a separate explicit decision before attaching an existing profile. Never infer it from approval to visit a website.
- Keep consequential confirmations at their actual boundary. Submitting, purchasing, publishing, changing account state, accepting a dialog, and uploading may need a focused confirmation even inside an approved browsing task.
- Record Cua refusal codes, tool result metadata, target and tab handles, snapshot generations, origin, delivery route, approval identity, and fresh verification evidence. Redact typed secrets and private page content from progress and durable summaries.
- Do not retry mutations after timeout, cancellation, transport loss, or a missing acknowledgement. Reobserve and classify the outcome as succeeded, failed, or uncertain.
- End the exact Cua session during task cleanup. Preserve cleanup errors and reject later actions against the closed session.

### Verification

Cua verifies delivery and target identity. Anesu still owns task completion.

- Reobserve with `get_browser_state` after every action that can change page state.
- Verify navigation against the fresh live URL and origin, not the requested URL alone.
- Verify typing against the fresh field state or the next task-specific page state. A successful `browser_type` result proves delivery, not form submission.
- Verify clicks through the requested postcondition, such as a changed state, dialog, route, or server-visible result. A cursor move or dispatched synthetic click is not success.
- Treat incomplete semantic snapshots and unprovable frames as unknown. Continue with a bounded query or continuation, or stop with a clear reason.
- Verify uploads against the approved file identity before dispatch and fresh page state after dispatch.

## Practices taken from Hermes and OpenClaw

These are supporting harness practices, not evidence that either project implements the Cua browser lifecycle.

Hermes provides useful patterns:

- Per-task browser sessions and automatic cleanup in `tools/browser_tool.py`, `browser_tool_session.py`, and `browser_tool_lifecycle.py`.
- Credential-scrubbed browser subprocess environments in `browser_tool.py`.
- URL safety before navigation and a second check after redirects in `browser_tool.py`.
- Compact accessibility snapshots with opaque refs and automatic post-navigation snapshots.
- Failure-closed handling for profile identity. Hermes refuses a profile it cannot identify instead of silently using another account in `browser_tool_real_profile.py`.

OpenClaw provides useful execution rules:

- One execution owner and explicit close operation in `src/agents/tools/computer-tool.ts`, `computer-tool-node.ts`, and `src/worker/computer-runtime.ts`.
- Serialized computer actions so clicks, typing, and split pointer operations cannot race.
- Provider generation binding and stale-observation rejection in `src/plugins/computer-use-contract.ts` and `computer-tool-request.ts`.
- Opaque browser, page, window, element, and observation refs in the public contract.
- Attempt-scoped idempotency keys and cleanup. These prevent duplicate transport calls, but they do not justify replaying an uncertain external side effect.

Anesu should copy these ownership and failure rules, not their browser backends.

## Live acceptance evidence still required

Upstream Cua source and tests prove that the capability exists. They do not prove that Anesu's migration works on this machine. Completion requires recorded live evidence from the exact Anesu build and disposable X11 profile.

Minimum acceptance matrix:

| Case | Required proof |
| --- | --- |
| Isolated Chrome start | `browser_prepare` launches the attested system binary, returns its pid, and cleanup removes the isolated profile at session end. |
| Isolated Edge start | Same proof for Edge when installed. If Edge is absent, readiness reports unavailable rather than passing a mock. |
| Exact bind | Native pid and window bind to one Cua target. Wrong pid, wrong window, duplicate geometry, and another process's endpoint all refuse. |
| Observe | `semantic_v2` returns bounded content and refs from a real public page. A newer snapshot makes old refs stale. |
| Navigate | Natural prompt opens the requested site. Fresh state proves the final URL and origin after redirects. |
| Click and type | Natural form task selects current refs, types supplied text, clicks the intended control, and verifies the resulting page state. |
| Linux pointer limit | Trusted background pointer refusal is surfaced honestly. Foreground or explicit synthetic fallback runs only when the task policy permits it. |
| Dialog | Inspect and foreground resolution work for a page JavaScript dialog. Native and browser permission dialogs are not mislabeled as page dialogs. |
| Upload | Only the approved unchanged regular file is accepted. Symlink, changed file, and out-of-scope path refuse. |
| Download boundary | Public TypeScript SDK calls refuse because they cannot carry Cua's trusted MCP-host approval evidence. Anesu sends no reserved field and records no false success. |
| Cancellation and crash | Task cancellation closes the session. Browser crash, Cua restart, and connection-generation change invalidate all old handles. |
| Mixed browser and desktop | One task can move from a Cua browser tab to a native Cua window and back without changing task owner or approval scope. |
| Security | Private and metadata targets, disallowed redirects, unapproved origins, existing-profile attachment, arbitrary scripts, and unapproved files all refuse. |

The manual acceptance prompt should be ordinary language, for example: `Open example.com in Chrome, follow the More information link, and tell me the page heading.` The test fails if the user must name Cua tools, fixtures, refs, sessions, or approval mechanics.

## Decision for the active plan

The active plan can include browser use as part of the same Cua and Jev computer-use implementation if it makes these changes explicit:

- Cua becomes the sole native and browser execution driver.
- Playwright leaves the production dependency and execution path.
- Isolated Chrome or Edge is the first supported browser mode on Ubuntu X11.
- Existing-profile attachment stays disabled until its separate authorization and live acceptance gate passes.
- The browser and desktop share one task approval, task owner, serialized action queue, evidence model, and verifier.
- Download stays outside this slice because the pinned public SDK lacks Cua's supported host-approval route for it.
- Completion requires the live acceptance matrix above. Unit tests or upstream Cua evidence alone cannot close the checklist.
