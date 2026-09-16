# Computer Native browser interaction

**Created:** 2026-09-15T19:18:16+02:00
**Last updated:** 2026-09-16T08:17:54+02:00
**Status:** Active
**Owner:** Computer Native standalone runtime
**Filename:** `computer-native-browser-interaction.md`

## Current implementation status

This plan is active. The first vertical slice is implemented and verified; the plan
is not complete yet.

Implemented in the current slice:

- URL validation for HTTP(S), credentials, private/link-local/metadata targets,
  configured local-development hosts, and redirect downgrade checks.
- Typed browser session, tab, snapshot, document-reference, action, and adapter
  boundaries with session and tab ownership checks.
- A pinned local Playwright/Chromium adapter with isolated persistent profiles,
  bounded semantic snapshots, short-lived element references, bounded waits,
  screenshots, and click/type/press execution.
- Model-facing browser start/open/tabs/snapshot/click/type/press/wait/screenshot/upload/download/close tools,
  fail-closed approval handling, and tool-registry dispatch.
- A managed screenshot artifact store with byte limits, atomic metadata, and failed/
  oversized capture cleanup.
- A configured maximum tab count enforced before model-requested opens, plus explicit
  Chromium child-process environment sanitization that excludes provider credentials,
  workspace paths, and arbitrary parent variables.
- An explicit browser capability switch: disabling it removes browser tools from the
  model-facing registry instead of advertising an unavailable capability.
- A bounded browser-session lifetime with an `expiresAt` record, adapter shutdown,
  profile cleanup, and a typed `session-timeout` result for later work.
- Bounded startup cleanup for old generated profiles and expired/incomplete screenshot
  and download artifacts, with explicit retention ages, candidate limits, and doctor
  visibility. Cleanup preserves recent, unknown, symlinked, and out-of-root entries.
- Screenshot artifacts are validated as PNGs and constrained by configured byte and
  pixel dimensions before metadata is persisted.
- Read-only tab listing and snapshots retry only a bounded transient adapter failure
  within the browser action timeout; navigation and side-effecting browser actions
  remain non-retrying.
- A `doctor` browser section that reports the effective capability, deadlines, resource
  bounds, artifact limits, and local-host policy without exposing secrets.
- Workspace-policy-backed uploads and managed-artifact downloads with exact approval
  paths, bounded sizes, and real local Chromium coverage.
- Artifact finalization rejects symlinked managed paths, verifies adapter observations
  against bounded on-disk files, sanitizes download names, and removes failed or
  incomplete captures without exposing outside-root files.
- Durable browser action records, redacted lifecycle payloads, restart ambiguity
  handling, typed navigation-policy failures, and managed-profile cleanup.
- Distinct timeout, cooperative-cancellation, and browser-crash outcomes. A crashed
  browser quarantines the session, rejects further work, and remains cleanable without
  replaying any action.
- Page-dialog observation and explicit approval: dialogs are never accepted or given
  prompt input automatically. The TUI presents a nested, redacted decision for accept,
  dismiss, or prompt text; if no approval channel is available, the dialog is dismissed
  only to unblock the browser and the original action is recorded as ambiguous.
- Approved side-effecting actions that time out, crash, or are cancelled after start are
  recorded as `browser-ambiguous`, with the underlying browser error and whether
  termination was confirmed retained for diagnosis instead of being presented as an
  ordinary failed action.
- The bounded model/tool loop now allows eight rounds by default, leaving a final
  reporting round after a multi-step browser workflow while remaining configurable and
  finite.
- Basic TUI browser activity and exact action approval rendering, including a redacted
  approval display.
- TUI regression coverage verifies that cancelling an active browser turn renders the
  cancellation outcome and whether adapter termination was confirmed.
- Approval and dialog displays are redacted at the TUI boundary as well as in tool
  events and durable records; regression coverage includes secrets embedded in page
  dialog messages.
- Configuration, setup, quick-start, and CLI documentation for the current browser
  surface.
- Deterministic URL-policy, session, tool/approval, and real local-fixture browser
  tests, plus end-to-end turn persistence and TUI approval tests.

Still required before this plan can move to `completed/`:

- Add the completion record and a focused commit or handoff reference. The source tree
  is intentionally dirty with unrelated user work, so no commit was created during
  this implementation pass.

Current validation snapshot (2026-09-16):

- `pnpm --filter @agent-harness-lab/computer-native run typecheck` — passed.
- `pnpm --filter @agent-harness-lab/computer-native test` — 179 passed, 0 failed.
- The browser-focused build and tests — 57 passed, 0 failed.
- `pnpm --filter @agent-harness-lab/computer-native coverage` — 179 passed, 0 failed;
  package-wide line coverage reported 87.61%.

## Start here

Read these before changing code:

- [repository rules](../../../AGENTS.md)
- [Computer Native rules](../../../computer-native/AGENTS.md)
- [Computer Native ownership](../../../computer-native/README.md)
- [tools ownership](../../../computer-native/src/tools/README.md)
- [security ownership](../../../computer-native/src/security/README.md)
- [runtime ownership](../../../computer-native/src/runtime/README.md)
- [persistence ownership](../../../computer-native/src/persistence/README.md)
- [artifacts ownership](../../../computer-native/src/artifacts/README.md)
- [telemetry ownership](../../../computer-native/src/telemetry/README.md)
- [turn lifecycle](../../../computer-native/docs/turn-lifecycle.md)
- [implementation plan lifecycle](../README.md)
- [completed workspace and filesystem capability](../completed/computer-native-workspace-filesystem.md)
- [completed process execution](../completed/computer-native-process-execution.md)

Local reference maps reviewed for this plan:

- [OpenClaw code map](../../../docs/research/harness-code-maps/openclaw.md)
- [Hermes code map](../../../docs/research/harness-code-maps/hermes.md)
- [Waku code map](../../../docs/research/harness-code-maps/waku.md)

The reference implementations are design input, not dependencies. Computer Native
remains standalone and must not import OpenClaw, Hermes, Waku, or other Agent Harness
Lab runtime modules.

## Purpose

Add the first real browser capability to Computer Native. The agent must be able to
open and inspect web pages and perform explicitly approved interactions through an
isolated local browser session. The implementation must make browser ownership,
navigation safety, action approval, session cleanup, artifacts, and failure outcomes
inspectable.

This is a browser-interaction capability, not a general browser product, web-search
service, cloud-browser marketplace, or personal-Chrome automation feature.

## Definition of done

From `computer-native/`, this real flow works with the configured model:

```bash
pnpm run chat
```

The model can start a managed local browser, open a permitted URL, inspect a bounded
accessibility-oriented snapshot, identify an element reference, and request a click or
text-entry action. Computer Native shows the exact action and approval context, waits
for an explicit decision when the action can submit data or change remote state, then
executes the approved action through the local browser adapter. The TUI shows the
session, tab, action state, result, errors, and artifact paths. Browser evidence remains
available after the turn without exposing cookies, credentials, or unbounded page data.

The deterministic test suite exercises the same contracts against a local HTTP fixture
and a controlled browser adapter. No test requires an external website or real account.

```text
model browser tool
  → typed argument validation
  → browser/session policy
  → URL and action preflight
  → exact approval where required
  → isolated local browser session
  → bounded result and artifacts
  → durable evidence and TUI activity
```

## Scope

- [x] Add a browser-session boundary with explicit session, tab, action, artifact, and
      lifecycle contracts.
- [x] Add one local managed Chromium adapter using a pinned Playwright dependency. The
      adapter is an implementation detail; Playwright objects and CDP endpoints must
      never be exposed to the model or the rest of the runtime.
- [x] Create an isolated browser profile for each Computer Native browser session and
      clean it up on normal close, cancellation, and terminal failure.
- [x] Support one or more tabs within a session with ownership checks for list, open,
      and close operations. A tab from another session must never be addressable.
- [x] Expose a small typed model-facing surface: start, open/navigate, list tabs,
      snapshot, click, type, press, wait, screenshot, download, upload, and close.
- [x] Represent page state with bounded accessibility/role-oriented snapshots and
      short-lived element references. Do not make arbitrary CSS selectors the primary
      model interaction contract.
- [x] Require a fresh snapshot after navigation or a document-changing action and
      return a typed stale-reference result when a reference is no longer valid.
- [x] Add URL policy for schemes, credentials in URLs, private addresses, loopback,
      link-local/metadata addresses, redirects, and configured local-development hosts.
- [x] Add action approval for operations that can submit data, change remote state,
      enter user-provided text, upload files, or create downloads. Page dialogs use a
      nested explicit accept, dismiss, or prompt-text decision; without an approval
      channel they are dismissed only to unblock the browser and the original action
      remains ambiguous.
- [x] Bind approval to the exact session, tab, action, reference, text, file path, and
      resource limits. A late or mismatched approval must fail closed.
- [x] Keep read-only inspection actions unblocked when they pass policy: tab listing,
      bounded snapshots, page text, screenshots, and bounded waits.
- [x] Disable arbitrary JavaScript evaluation in this slice. It requires a separate
      policy and approval design because page evaluation can access cookies, storage,
      network APIs, and sensitive form data.
- [x] Constrain downloads and uploads to managed artifact/workspace roots, reject
      traversal and symlink escapes, enforce size limits, and retain safe metadata.
- [x] Redact credentials, cookies, tokens, authorization headers, and known secrets from
      snapshots, action results, logs, screenshots metadata, and durable evidence.
- [x] Add browser lifecycle and action events to the existing persistence and telemetry
      paths without moving browser ownership into the TUI or model provider.
- [x] Add browser activity and approval rendering to the existing TUI.
- [x] Document installation of the pinned browser dependency and browser binaries,
      local configuration, security limits, manual testing, and unavailable-dependency
      behaviour.

## Explicitly out of scope

- Cloud browser providers, Browserbase, Browser Use, Firecrawl, Camofox, or any remote
  browser service.
- Attaching to a personal Chrome profile, importing existing cookies, or connecting to
  an arbitrary user-supplied CDP endpoint.
- Browser extensions, native-host relay, remote browser nodes, or multi-machine routing.
- Arbitrary JavaScript evaluation, cookie manipulation, local-storage access, iframe
  scripting, request interception, or unrestricted network control.
- CAPTCHA solving, authentication automation, OAuth token capture, or credential
  storage. A later credential-aware integration must define its own secret boundary.
- General web search, web extraction, browser-based external integrations, or memory.
- Background browser daemons, browser sessions that survive process restart, or automatic
  replay of browser actions after an ambiguous outcome.
- A claim that a managed browser is an OS sandbox. Browser pages and local browser
  processes remain subject to the host's process and network capabilities.

## Reference alignment and design decisions

| Local reference | Pattern used | Computer Native decision |
| --- | --- | --- |
| OpenClaw `extensions/browser` | Dedicated browser capability with explicit profiles, lifecycle, routing, tab identity, SSRF checks, upload/download handling, and browser-specific tests. | Keep browser implementation under a standalone Computer Native browser boundary. Start with one managed local profile and preserve a future adapter seam without adding remote control now. |
| Hermes `tools/browser_tool.py` and browser helper modules | Shared model-facing browser surface over session/back-end helpers; accessibility snapshots, element refs, output bounds, redaction, session ownership, and private-URL policy. | Use semantic snapshots and short-lived refs, keep the model-facing contract stable, and make provider/adapter details invisible to the model. |
| Waku `waku/ops/browser_agent.py` | Long-lived gateway agent and dated chat-session ownership, including safe rebuild behaviour. | Reuse the lifecycle lesson for session ownership and restart handling. Do not treat Waku's dashboard agent as a browser-automation backend. |

Important non-adoptions:

- Do not copy either mature project's entire browser product surface into this slice.
- Do not let a browser library define Computer Native's approval or evidence contract.
- Do not interpret page instructions as Computer Native policy. Page content is untrusted
  input and can contain prompt injection.
- Do not expose raw Playwright, raw CDP, arbitrary selectors, or arbitrary JavaScript as
  a shortcut around the browser tool contract.

## Finished behaviour

### User-visible behaviour

- The tool list advertises only browser capabilities implemented and enabled by the
  current configuration.
- Browser activity shows session ID, tab ID, safe URL/title metadata, action, approval
  state, and bounded result status.
- `browser_open` rejects unsafe schemes, credential-bearing URLs, blocked private targets,
  and unsafe redirects before a page result is returned.
- `browser_snapshot` returns bounded semantic page content and element references. Page
  text is labelled as untrusted content and is redacted before model delivery.
- `browser_click`, `browser_type`, `browser_press`, and equivalent state-changing actions
  show an exact approval request before execution.
- A denied or unavailable approval starts no browser action and returns a typed denial.
- A stale reference returns an actionable result requiring a new snapshot. The runtime
  does not silently guess a replacement element.
- A page dialog is never accepted automatically. If one interrupts an adapter action,
  the TUI presents its bounded, redacted message for an explicit accept, dismiss, or
  prompt-text decision. The original action is still returned as ambiguous because the
  page may have changed before or after the dialog was handled. Without an approval
  channel, the dialog is dismissed only to unblock the browser.
- Uploads and downloads show the exact controlled path, byte limit, and approval state.
- A browser timeout, crash, cancellation, or closed session is visible as a distinct
  result. For an approved side-effecting action whose outcome may be unknown, the tool
  reports `browser-ambiguous` and preserves the underlying error code. It never reports
  success merely because a command was sent.
- Ctrl-C cancels a pending approval or in-flight browser action. A late approval cannot
  start a cancelled action.
- Non-interactive execution has no approval callback and therefore fails closed for
  approval-gated browser actions.

### Ownership and boundaries

```text
src/tools/                 → model-facing browser schemas, dispatch, safe results
src/browser/               → browser session, tabs, snapshots, adapter boundary
src/security/              → URL policy, action classification, path policy, limits, redaction
src/workspace/             → approved workspace-relative upload/source paths
src/artifacts/             → screenshot/download/upload artifact ownership and metadata
src/runtime/               → turn deadline, approval pause, cancellation, tool lifecycle
src/persistence/           → browser session/action records and restart reconciliation
src/telemetry/             → ordered browser lifecycle and diagnostic events
src/cli/                   → TUI rendering and approval input only
src/models/                → model transport and tool-call normalization only
```

The browser module is the sole owner of browser handles, page/tab identity, and browser
cleanup. The security module is the sole owner of whether a URL, action, or local path is
authorized. The tools module is the sole model-facing action surface. The TUI cannot call
Playwright or write browser evidence directly.

## Approval and security rules

The first policy is deliberately explicit rather than heuristic:

| Operation | Default treatment |
| --- | --- |
| Start, close, status, list tabs | No approval; bounded lifecycle operation |
| Snapshot, page text, screenshot, bounded wait | No approval after session and URL policy |
| Open permitted public URL | No approval after URL/redirect policy |
| Local/private URL override | Explicit approval and configuration opt-in, or reject |
| Click, type, press, fill, select | Explicit approval bound to exact action |
| Unexpected page dialog | Present a nested, redacted approval request; accept, dismiss, or prompt input is explicit. The original action remains ambiguous after the dialog is handled. |
| No dialog approval channel | Dismiss only to unblock; report an ambiguous outcome with bounded dialog metadata |
| Upload or download | Explicit approval bound to exact path and limits |
| JavaScript evaluation | Disabled in this slice |

The policy must revalidate the current tab URL and document identity immediately before
an approved action. Navigation or document replacement invalidates prior element refs.
Approval does not grant broader browser or filesystem authority than the request shows.

## State, persistence, and evidence

Use the existing state directory and artifact conventions. The browser module may create
the following per-session structure:

```text
state/sessions/<session-id>/browser/
  session.json       # profile, lifecycle state, creation/close times, no secrets
  events.jsonl       # ordered browser lifecycle and action events
  screenshots/       # bounded approved artifacts
  downloads/         # controlled downloaded files and metadata
  uploads/           # staged upload metadata, not copied secrets
```

- [x] Each session, tab, action, approval request, and artifact has a stable identity.
- [x] The proposal is persisted before waiting for approval.
- [x] The action result is persisted after the adapter reports a terminal outcome.
- [x] Writes use the existing atomic JSON/JSONL persistence helpers.
- [x] Evidence is redacted before model exposure and durable storage.
- [x] A restart marks in-flight browser actions as interrupted or ambiguous and cleans
      up owned browser processes without replaying actions.
- [x] Orphaned temporary profiles and artifacts have bounded cleanup rules.
- [x] Evidence retains bounded, redacted native adapter details for diagnosis without
      claiming the browser performed a side effect that was not observed.

## Failure, retry, and recovery semantics

- [x] Read-only tab-list and snapshot operations retry only a bounded transient adapter
      failure within the browser action timeout; navigation and side-effecting actions
      are not automatically replayed.
- [x] Click, type, press, upload, and download actions are never automatically
      replayed after a timeout or lost acknowledgement.
- [x] A browser process crash marks the session failed and invalidates all tab refs.
- [x] A session lifetime expiry closes the adapter, cleans the owned profile, and rejects
      later work with `session-timeout`; shutdown can retry cleanup after expiry.
- [x] An individually closed tab returns `tab-closed` without quarantining the healthy
      browser session, including the local adapter-driven close lifecycle.
- [x] A page navigation invalidates refs from the previous document.
- [x] Cancellation stops the pending approval or requests adapter cancellation, then
      records whether the browser confirmed termination. The managed Playwright adapter
      closes the affected tab and waits for the underlying operation to settle within
      the action timeout; cancellation remains ambiguous because the side effect itself
      may already have happened.
- [x] An uncertain external outcome is reported as `ambiguous`, not as success or failure
      inferred from local process state.
- [x] Duplicate approval events are idempotently ignored after the request reaches a
      terminal state.
- [x] Out-of-order adapter events cannot move a terminal action back to running.
- [x] Cleanup failure is recorded separately from the action result and never causes an
      unsafe automatic retry.

## Configuration and dependencies

- [x] Add browser settings for screenshot byte and dimension limits.
- [x] Wire the browser enabled switch, action timeout, tab limit, snapshot bounds, byte
      limits, and local-host allowlist through configuration into the runtime.
- [x] Validate current browser settings at startup and show effective bounded values in
      `doctor`; remaining future settings must use the same path.
- [x] Add Playwright as a direct, pinned Computer Native dependency only if the adapter
      contract and local browser installation path are implemented together.
- [x] Pin and document the browser binary version. A missing browser binary must produce
      an actionable setup error and must not silently fall back to a personal browser.
- [x] Never pass provider keys, workspace secrets, cookies, or arbitrary parent
      environment variables to browser helper processes. Chromium receives an explicit
      runtime/display allowlist.

## Implementation checklist

### 1. Contracts and policy

- [x] Define browser session, tab, snapshot, element reference, action, approval, result,
      artifact, and lifecycle event types.
- [x] Define typed error categories for invalid URL, blocked URL, invalid ref, stale ref,
      approval denied, approval unavailable, timeout, cancellation, browser crash,
      artifact violation, and ambiguous outcome.
- [x] Define action capabilities so unsupported adapter operations are not advertised.
- [x] Add browser security policy and configuration validation.

### 2. Browser adapter and session runtime

- [x] Implement the local Playwright adapter behind the browser interface.
- [x] Implement isolated profile creation and cleanup.
- [x] Implement tab ownership and per-session identity checks.
- [x] Implement bounded navigation, snapshot, screenshot, and action timeouts.
- [x] Enforce the configured maximum tab count before opening another tab and reject
      adapter observations that exceed the bound.
- [x] Implement stale-reference invalidation and current-document checks.
- [x] Implement cooperative cancellation, crash detection, cleanup reporting, and
      bounded in-flight side-effect termination confirmation.

### 3. Tools and approval integration

- [x] Register the browser tools with the existing tool registry.
- [x] Route all browser paths through security and workspace/artifact policy.
- [x] Persist approval requests before presenting them to the TUI.
- [x] Revalidate the approved request immediately before adapter execution.
- [x] Return bounded, redacted, typed tool results.

### 4. Artifacts, telemetry, and TUI

- [x] Store screenshots and downloads through the artifact boundary.
- [x] Add browser lifecycle and action events to telemetry.
- [x] Add TUI rendering for browser sessions, tabs, approvals, action progress, errors,
      and artifacts.
- [x] Keep the TUI factual: never display simulated browser state or claim an action ran
      before the adapter reports it.

### 5. Documentation and playground

- [x] Add browser ownership and lifecycle documentation under `computer-native/`.
- [x] Update the quick-start guide with the one-command launch and local fixture test.
- [x] Document Playwright/browser-binary setup, security limitations, approval rules,
      and manual checks.
- [x] Add a small `development/playground/computer-native-browser-turn/` inspection
      walkthrough and local fixture server. It is explicitly a contributor walkthrough,
      not a test or benchmark.

## Test coverage

### Unit tests

- [x] Browser argument schemas reject missing, oversized, malformed, and unknown fields.
- [x] URL policy rejects unsafe schemes, credentials, private addresses, metadata hosts,
      unsafe redirects, and invalid local-host configuration.
- [x] URL policy handles IPv4, IPv6, hostname resolution, redirects, and normalization
      without allowing a path around the policy.
- [x] Session and tab ownership reject cross-session access and invalid lifecycle use.
- [x] Session lifetime expiry records the deadline, closes the adapter, cleans the profile,
      and returns a typed post-expiry error.
- [x] Snapshot bounds truncate at safe boundaries and redact secrets.
- [x] Snapshot references are unique within a document, become stale after navigation,
      and cannot silently target a new element.
- [x] Approval requests bind exact action arguments, tab identity, document identity,
      paths, limits, and session identity.
- [x] Denied, unavailable, late, duplicate, and mismatched approvals fail closed.
- [x] Upload/download path checks reject absolute paths, traversal, symlinks, special
      files, oversized files, and destinations outside approved roots.
- [x] Result and event serializers redact cookies, tokens, authorization data, and known
      configured secrets.
- [x] Native adapter diagnostics are bounded and redacted before browser action records,
      lifecycle events, and TUI-facing activity receive them.
- [x] Browser child-process environment construction excludes provider credentials,
      workspace settings, `NODE_OPTIONS`, and arbitrary parent variables.
- [x] Bounded cleanup removes only expired managed profiles and artifact records,
      preserves symlinks and recent entries, and stops at its configured candidate
      bound.
- [x] Screenshot capture validates PNG dimensions, rejects oversized pixel bounds, and
      persists observed width and height in artifact metadata.
- [x] Read-only retry behavior is configurable, bounded, and covered for both enabled
      and disabled retry paths.
- [x] Terminal event ordering prevents a completed action returning to running.
- [x] A four-tool-round interaction can still complete on a bounded final reporting
      round; the default model/tool loop limit is eight and remains configurable.
- [x] The interactive TUI renders an active browser cancellation and its termination
      confirmation state.

### Adapter and integration tests

- [x] Start and close a real local managed browser with a temporary profile.
- [x] Open a deterministic local HTTP fixture and return a bounded semantic snapshot.
- [x] Navigate between fixture pages and verify old refs become stale.
- [x] Perform approved click, type, and press actions against fixture controls.
- [x] Exercise fixture page dialogs and verify explicit accept/dismiss decisions, safe
      fallback dismissal, an ambiguous original action outcome, bounded/redacted dialog
      evidence, and continued session usability.
- [x] Verify denied actions do not change the fixture page or send the request.
- [x] Verify form submission is approval-gated and the submitted value is not written to
      evidence unless the policy explicitly permits it.
- [x] Capture a screenshot and verify bounded artifact metadata and cleanup.
- [x] Download a fixture file into the managed artifact root and reject traversal targets.
- [x] Upload a safe fixture file and reject symlink/out-of-root sources.
- [x] Exercise timeout, cooperative cancellation, browser-crash, dialog, and ambiguous
      side-effect paths, including confirmed and unconfirmed cancellation. Missing-browser
      and closed-page diagnostics are covered.
- [x] Verify pre-start cancellation is propagated through browser start, open, snapshot,
      tab-list, and close operations without reaching the adapter action.
- [x] Verify the configured tab limit fails closed before an additional tab is opened.
- [x] Verify startup removes only expired generated profiles and artifact records, while
      retaining recent, unknown, and symlinked entries.
- [x] Close a real managed Chromium tab and verify its session remains usable while the
      closed tab is rejected.
- [x] Restart with an incomplete session/action record and verify reconciliation without
      replay.
- [x] Exercise duplicate and out-of-order adapter events.
- [x] Include a fixture containing prompt-injection instructions and verify those
      instructions remain explicitly labelled page data, not policy or approval authority.
- [x] Run all browser integration tests without external network access and without real
      credentials.

### Manual acceptance checks

- [x] From `computer-native/`, run `pnpm run chat` with the configured real model.
- [x] Ask the agent to open the local browser fixture and summarize the page.
- [x] Ask it to click a harmless fixture control and verify the TUI shows the exact
      approval request and the resulting page change.
- [x] Ask it to submit a fixture form and verify approval is required before submission;
      the exact type and submit approvals were shown. That manual run exposed the old
      four-round cap, which was then raised to eight and covered by regression tests.
- [x] Trigger a fixture page dialog and verify `a` accepts an alert/confirmation,
      `d` dismisses it, and `a:<text>` supplies prompt text; the original action must
      still be shown as ambiguous. Alert acceptance, confirmation dismissal, and
      prompt-text acceptance were observed manually.
- [x] Ask it to inspect a prompt-injection page and verify the agent treats the page text
      as untrusted content.
- [x] Request a screenshot/download and inspect the recorded artifact path and metadata.
- [x] Cancel an approval and an active action with Ctrl-C and verify no later action runs.
- [x] Inspect the session evidence and verify no API key, cookie, token, or personal
      browser profile data is present.

## Required validation commands

```bash
pnpm --filter @agent-harness-lab/computer-native run typecheck
pnpm --filter @agent-harness-lab/computer-native test
pnpm --filter @agent-harness-lab/computer-native coverage
pnpm --filter @agent-harness-lab/computer-native run build
git diff --check
```

The browser integration profile must be deterministic and local. If the Playwright
browser binary is unavailable, the unit suite must still run and the integration command
must fail with a clear setup message rather than silently skipping coverage.

## Completion gate

Before moving this plan to `completed/`, verify:

- [x] Every applicable scope and implementation checkbox is complete.
- [x] The local browser capability is real and inspectable through `pnpm run chat`.
- [x] Approval, URL security, path security, redaction, and resource limits are tested.
- [x] Timeout, cancellation, crash, restart, stale-ref, and ambiguous-outcome behaviour
      is implemented and tested.
- [x] TUI, persistence, telemetry, artifacts, and documentation match the implementation.
- [x] No remote provider, personal profile, arbitrary evaluation, or unsupported capability
      is advertised.
- [x] Required validation commands pass and the manual acceptance evidence is recorded.

## Commit discipline and handoff

- [ ] Keep contracts/policy, adapter/session runtime, tools/approval, TUI/evidence, and
      documentation as reviewable implementation sections.
- [ ] Run the narrow tests before each coherent commit.
- [ ] Review `git status` and each diff; preserve unrelated user changes.
- [ ] Record changed files, validation results, browser setup prerequisites, and known
      limitations in the completion record.
- [ ] Record all implementation commit hashes or the contiguous commit range before
      archiving this plan.

## Completion record

Complete this section only when archiving the plan.

**Completed:** `[YYYY-MM-DDTHH:MM:SS±HH:MM]`
**Commits:** `[commit hashes or contiguous range]`

### Validation

- `[command]` — `[passed/failed and concise result]`
- `[manual check]` — `[what was observed]`

### Known limitations

- `[deliberate limitation or follow-up]`

### Historical-scope note

This plan records the first local browser-interaction slice. Later plans may add remote
browser adapters, personal-profile attachment, credentials, or richer evaluation only
after their own security and lifecycle contracts are defined.
