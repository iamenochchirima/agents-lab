# Audit: Anesu Jev + Cua native task loop

**Audited:** 2026-09-20<br>
**Scope:** Research evidence and implementation-plan requirements only<br>
**Code changes:** None<br>
**Verdict:** The proposed architecture is viable for a bounded Ubuntu/X11 profile, but
the current Anesu implementation does not yet provide the promised natural-language
native task loop. The active plan is broadly sound. It needs several corrections before
implementation starts, especially an explicit Cua runtime authorization ceiling,
runtime health and TypeSafe model checks, precise use of generic versus typed Cua APIs,
and stronger acceptance evidence for Calendar and Clocks.

This audit distinguishes three different claims:

1. **Available upstream:** the pinned Cua or TypeSafe package exposes a capability.
2. **Implemented in Anesu:** Anesu correctly owns and uses that capability.
3. **Accepted live:** a real prompt, model, app, and disposable desktop produced durable
   evidence of the requested outcome.

An upstream capability is not implementation or acceptance evidence.

## Sources and version baseline

Only first-party material was used.

| Source | Version or revision checked | Relevant paths |
| --- | --- | --- |
| Anesu | Current working tree | `anesu/src/computer/`, `anesu/package.json`, `pnpm-lock.yaml` |
| Installed Cua TypeScript package | `@trycua/cua-driver` `0.28.2` | `anesu/node_modules/@trycua/cua-driver/dist/native/cua_driver_sdk.d.ts`, `cua_driver_contract.d.ts` |
| Local Cua checkout | `9bbfa7dd3e27ca7f1861ede70aaca390174493f9` | `/home/enoch/aworkspace/agents/cua/libs/cua-driver/` |
| Installed TypeSafe package | `@typesafe-ai/sdk` `0.6.0` | `anesu/node_modules/@typesafe-ai/sdk/README.md`, `dist/index.d.mts` |
| Hermes checkout | `b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a` | `/home/enoch/aworkspace/agents/hermes-agent/tools/computer_use/` |
| OpenClaw checkout | `912685f442286233fbbd40762482d98598299497` | `/home/enoch/aworkspace/agents/openclaw/extensions/cua-computer/src/` |
| Official Cua docs | Current on audit date | [Jev use](https://cua.ai/docs/how-to-guides/driver/jev-use), [Linux tools](https://cua.ai/docs/reference/cua-driver/mcp-tools-linux), [in-process SDK](https://cua.ai/docs/how-to-guides/driver/use-sdk-in-process), [permission policies](https://cua.ai/docs/reference/cua-driver/permission-policies), [verification](https://cua.ai/docs/how-to-guides/driver/verify-a-desktop-action) |

The local Cua checkout and installed package have the same `0.28.2` version. This reduces
source/package drift for this audit, but runtime tool discovery must remain the final
contract check.

The official TypeSafe website was not needed to establish the used API. The installed
first-party SDK declaration and README establish the `Choice`, model-listing, timeout,
retry, confidence, and probability contracts used below. Live model availability and
the behavior of the moving `jev-latest` alias still require a network preflight.

## Audit of the existing research note

The audited note is [`jev-cua-native-task-loop.md`](jev-cua-native-task-loop.md).

### Claims that are supported

| Existing claim | Finding | Exact evidence |
| --- | --- | --- |
| Linux/X11 supports app discovery, launch, window discovery, AT-SPI observation, input, verification, sessions, and an agent cursor. | Supported as an upstream Cua capability. It is not proof that Anesu uses each capability. | Cua `rust/Skills/cua-driver/LINUX.md`; installed `listToolsJson()` reports 59 tools including `list_apps`, `launch_app`, `list_windows`, `get_window_state`, `click`, `type_text`, `set_value`, `press_key`, `hotkey`, `scroll`, `invoke_menu`, `verify_state`, session and cursor tools. |
| The agent cursor is synthetic and normally does not move the real pointer. | Supported for the Linux backend. Desktop-scope `move_cursor` is an explicit real-pointer escape hatch and must stay outside the bounded profile. | Cua `LINUX.md`, "How input is delivered". |
| Background input is the default and foreground input is an approval boundary. | Supported. `bring_to_front` is not an ordinary focus step; it is a persistent focus-proxy exception after documented failure. | Cua `LINUX.md`, "delivery_mode" and "Persistent focus-proxy exception". |
| Jev is a bounded chooser rather than an unrestricted planner or executor. | Supported. The application owns candidates, action arguments, execution, reobservation, and completion. | Cua `examples/jev-use/typescript/core.ts`, `jev_adapter.ts`, `core.test.ts`; Cua Jev guide; Cua `skills/jev-use/SKILL.md`. |
| Jev must not receive screenshots, driver tool names, or arbitrary action arguments. | Supported by the reference design. It receives a goal, compact observations, bounded history, candidate IDs and descriptions. | Same Jev sources as above. |
| Anesu currently exposes only click candidates to Jev. | Supported. | `anesu/src/computer/native-strategy.ts`, `NativeSemanticCandidate` and `nativeAccessibilityCandidates`. |
| Anesu lacks an app launch/discovery lifecycle in its Cua adapter. | Supported. | `anesu/src/computer/cua-driver.ts`, `CuaDriverClient`; `observeDesktop()` selects a current window but does not resolve or launch an app. |
| Current native verification is too narrow for general real-app tasks. | Supported. | `anesu/src/computer/verification.ts`; its derivation is based on narrow URL, quoted-text, fixture-marker, and state-word patterns. |
| Current approval is per action and supports only allow-once/deny/unavailable. | Supported. | `anesu/src/computer/contracts.ts`, `ComputerApprovalDecision`; `anesu/src/computer/native-runner.ts`. |

### Claims that need correction or qualification

| Claim or implication | Correction |
| --- | --- |
| "The typed TypeScript surface exposes app/window discovery, observation, input, cursor/session operations, and `verifyState`." | Mostly true for `0.28.2`, but incomplete. The typed interface has `listApps`, `listWindows`, `getWindowState`, input methods, sessions, cursor methods, and `verifyState`. It does **not** expose a typed `launchApp` or `setValue`. Those operations require `callTool`. Element-targeted `type_text` also has fields in the runtime JSON schema that are not present in the generated typed `TypeTextInput`, so the plan must deliberately use and validate the generic schema for that path. |
| "Cua supports app focus." | Do not model focus as a normal lifecycle step. Cua's Linux contract prefers background operation. Foreground delivery is a per-action escalation, and persistent `bring_to_front` is an exceptional focus proxy. |
| "The full tool surface is supported." | This is an upstream backend statement, not proof that every installed application exposes usable AT-SPI state or that the current desktop session satisfies D-Bus, accessibility, capture, and input requirements. Each target app must pass runtime health and observation checks. |
| "The next implementation can use app/window discovery and launch." | Correct in principle, but `launch_app` is open-world, state-changing, and non-idempotent. On Linux, `launch_path` is spawned through the system shell. Anesu must round-trip an unchanged path from a fresh trusted `list_apps` record and must never pass model/user-generated command text, arguments, URLs, or paths. |
| "Independent verification proves completion." | Too broad. `verify_state` proves only one to eight bounded predicates on one exact window. Accessibility absence can remain `unknown`, and `unknown` is never success. Calendar and alarm creation need app-specific postconditions that show the durable object, not merely a transient form or a model statement. |
| "A visible cursor demonstrates execution." | Cursor visibility is useful review evidence, not completion evidence. The Linux source supports a synthetic cursor, but Anesu must prove it in the actual Xephyr/X11 acceptance profile. |
| "Current confidence floor is safe." | Unsupported. `0.5` in `anesu/src/computer/contracts.ts` is an uncalibrated operating threshold. TypeSafe confidence is decision evidence, not authorization or correctness. |

### Important omissions in the research note

The note should explicitly add these facts:

- Cua `0.28.2` provides `CuaDriver.createConfigured(...)` with an immutable runtime
  authorization ceiling. `CuaDriver.create(undefined)`, which Anesu currently uses,
  does not establish the bounded policy required by the proposed security model.
- Cua's `health_report` schema version `1` checks binary version, platform, desktop
  session, AT-SPI, and screen capture. Checking `DISPLAY` and an Anesu isolation marker
  is not a sufficient readiness test.
- Cua recommends one in-process `CuaDriver` for the application lifetime. A named Cua
  session should then scope each task. Current Anesu shuts down the driver around each
  computer-tool run.
- The runtime exposes 59 tools in the installed package. The implementation must parse
  and contract-test the live schemas of generic operations, not only their names.
- `list_windows` order is not a focus or ownership signal when z-order is absent. The
  current "top accessible window" heuristic is unsuitable for app-scoped tasks.
- TypeSafe SDK `0.6.0` can list available models. `jev-latest` is a moving alias; Anesu
  must record the actual response model and test availability before task approval.
- A bounded chooser needs both `reobserve` and `abstain`. Current native Anesu supplies
  only `none`.
- Exact task values must come from user input or deterministic normalization. Jev may
  select a candidate but must not invent alarm times, event titles, dates, note text,
  app names, commands, or paths.

## Current Anesu implementation gap map

| Area | Current behavior | Required change |
| --- | --- | --- |
| Runtime authorization | `CuaDriver.create(undefined)` | Create one configured runtime with an immutable bounded capability manifest before any action is accepted. Keep task approval as a narrower layer, never a way to widen the runtime ceiling. |
| Readiness | Linux, `DISPLAY`, and isolation-marker checks | Call `health_report`; check schema/version, session, AT-SPI, capture, required tool names and required generic-tool schema fields. Fail before approval. |
| Driver lifetime | Driver is created and shut down around a computer run | One driver owner for Anesu's process/native host; one named Cua session for each task; serialized actions; idempotent task/session cleanup. |
| App targeting | Selects a current "top accessible window" | Fresh `list_apps` -> opaque Anesu app reference -> approved unchanged launch record -> launch/reuse -> exact PID/window selection. Never select array order or an unrelated foreground window. |
| Jev actions | Click only; `none` only | Immutable click, semantic type/set-value, safe key/hotkey, bounded scroll, `reobserve`, and `abstain` candidates. Add only operations required by admitted task profiles. |
| Generic Cua API | Adapter omits `callTool` | Use `callTool` for `launch_app`, `set_value`, and generic element-targeted operations, with schemas captured and validated from pinned `listToolsJson()`. Prefer typed methods where their contract is complete. |
| Action binding | Current observation plus live top-window checks | Bind task, app, process, exact window, session, observation generation, snapshot, element token, candidate ID, action arguments, and delivery mode. Invalidate the generation after every action or observation. |
| Approval | One prompt for every action | One immutable task grant, locally checked before every action. Reapprove only for scope change, new value/action class, foreground delivery, or new risk. |
| Verification | Goal-regex and text search; fixture marker | Compile a verifier before approval. Use `verify_state` where expressible and app-specific fresh-state checks where necessary. `unknown`, truncated state, or model narration cannot pass. |
| Jev threshold | Fixed confidence `0.5` | Treat it as a provisional abstention policy, run a small labeled decision evaluation, document false-action/abstention results, and choose a threshold from evidence. |
| Evidence | Per-action records exist, but no complete task contract | Record task spec and grant digest, resolved app/window refs, observation generations, candidate set digest, Jev model/choice/confidence, Cua action effect, verification facts, and terminal reason. Redact sensitive values. |

## Required corrections to the active implementation plan

The audited plan is
`development/implementation-plans/anesu/archived/anesu-jev-cua-native-computer-use.md`.
Its overall ownership model and observe/choose/execute/reobserve loop are appropriate.
The following changes are required.

### P0: required before implementation

- [ ] Add a work item to replace `CuaDriver.create(undefined)` with a configured,
  immutable authorization ceiling. The bounded manifest must allow only the operations
  needed by this profile and deny shell execution, arbitrary process control,
  clipboard, downloads, browser operations, desktop-wide input, and unrelated Cua
  tools. The task grant must remain narrower than this ceiling.
- [ ] Add `health_report` to startup readiness and require the Linux session, AT-SPI,
  and capture checks used by this profile. A tool-name inventory alone is insufficient.
- [ ] Require schema checks for the generic tools actually used: `launch_app`,
  element-targeted `type_text`, `set_value`, and any optional `invoke_menu`. Record the
  expected schema version or a stable bounded fingerprint in contract tests.
- [ ] State explicitly that `launch_app` and `set_value` use `callTool` in Cua `0.28.2`.
  Do not assume typed methods that do not exist.
- [ ] Add one application-lifetime Cua driver owner. Keep the existing plan's named
  task session, but do not recreate the native runtime per task or per action.
- [ ] Add TypeSafe readiness: exact installed SDK version, `models.list()` or an
  equivalent bounded live check, selected model availability, and recording of the
  response model. Pin `@typesafe-ai/sdk` exactly or enforce the resolved `0.6.0`
  contract in CI; the current manifest uses `^0.6.0`.
- [ ] Replace "retain the current confidence floor" with a calibration requirement.
  Until a labeled evaluation supports a threshold, low confidence must abstain and the
  plan must not describe `0.5` as safe.
- [ ] Resolve the plan's credential inconsistency. Credentials and secret typing are
  out of scope, so the runner must refuse them. "Separate approval" is not enough until
  a secret-safe input and evidence path exists.

### P1: required for the stated outcome

- [ ] Add `set_value` as the preferred candidate for an editable element that advertises
  it, with exact value readback. Fall back to element-targeted `type_text` only when its
  route and evidence are understood. Do not implement typing as an unbound window-level
  action.
- [ ] Define opaque app and window references with a generation, following OpenClaw's
  host-owned frame model. A refreshed inventory or observation invalidates old refs.
- [ ] Require `reobserve` and `abstain` in every Jev candidate set. Keep `complete` out
  of Jev's authority; only a satisfied code-owned verifier can complete.
- [ ] Define how natural-language task admission produces a validated task spec.
  Supported intent extraction may use deterministic parsing or constrained structured
  model output, but every app, value, date, time, action family, and completion rule
  must validate locally and retain source provenance. Unsupported or ambiguous prompts
  must clarify before approval.
- [ ] Separate app launch from focus. Launch/reuse and exact window binding are normal;
  foreground delivery is a separate grant expansion. `bring_to_front` is not part of
  the standard loop.
- [ ] Add an action queue/lock so two model/tool calls cannot act concurrently on one
  Cua runtime or task session. OpenClaw's `commands.ts::openExecution` and Hermes's
  per-session call locks are relevant first-party precedents.
- [ ] For uncertain launch acknowledgement, reconcile against the approved app identity
  and exact windows before any retry. For uncertain input, reobserve and terminate
  `outcome-unknown` if the verifier cannot reconcile it. Never replay.
- [ ] Replace the undocumented "current host exposes Clocks, Calendar, and Text Editor"
  assertion with durable profile evidence from the same disposable desktop used for
  acceptance. App availability on a developer's ordinary host is not a project
  guarantee.

### P1: verification corrections

- [ ] Define exact completion facts for each acceptance task before implementing its
  action sequence.
- [ ] `Open Calendar` may pass when the approved app identity owns the exact usable
  window and that state is stable.
- [ ] Text entry must prove the exact nonce-bearing value in the intended editable
  control after a fresh observation or `verify_state`. This task should not be described
  as a "saved note" unless save persistence is separately verified.
- [ ] Calendar event creation must prove title, normalized date, and normalized time in
  a fresh event/list view after submission. Seeing the values in an unsaved form does
  not pass. If AT-SPI cannot distinguish the event, report unsupported rather than use
  screenshot interpretation.
- [ ] Alarm creation must prove the requested time and enabled state in a fresh alarm
  list after submission. The test should use a unique label if the installed app
  supports one, then remove the test alarm in the disposable profile.
- [ ] Require at least two stable samples only where the predicate can be matched
  unambiguously. `verify_state` can return `unknown` for multiple matches or
  untrustworthy/projected state; that result must not be rewritten as failure or
  success.

### P2: important API and evidence hardening

- [ ] Treat Cua window IDs as 64-bit values throughout the adapter. Do not round-trip
  them through JavaScript `number`; the generated typed API uses `bigint`.
- [ ] Record the Cua package version, runtime driver version, tool-inventory fingerprint,
  TypeSafe SDK version, returned Jev model, desktop profile, app desktop-file identity,
  and app version when available.
- [ ] Persist candidate IDs/descriptions and a digest of immutable hidden action
  arguments. Do not persist secrets, complete accessibility trees, screenshots, or
  provider payloads in ordinary JSONL.
- [ ] Test the cursor as review UX, not as task proof. Acceptance should confirm that
  the synthetic cursor is visible in Xephyr while the real host pointer remains outside
  the task contract.

## Reference-agent findings

### Hermes

Hermes provides useful patterns, but it does not already implement Anesu's proposed
task-wide grant.

- `tools/computer_use/tool.py` caches backends by session and uses per-session call
  locks.
- `_request_approval` supports approve-once, approve-session, always-approve, and deny.
  Its session cache is scoped by action and delivery mode; foreground does not inherit
  background permission.
- It blocks dangerous keyboard combinations and suspicious terminal commands before
  approval.
- When no CLI callback exists, another gateway layer is expected to own approval. Anesu
  must not copy that behavior as a fail-open local default.

Use Hermes as evidence for serialization, action/delivery scoping, pre-approval policy,
and reacting to Cua outcomes. The task-grant identity and lifecycle remain an Anesu
design that needs its own tests.

### OpenClaw

OpenClaw provides a strong reference for host-owned identity and stale-state handling.

- `extensions/cua-computer/src/frame.ts` creates opaque app, window, observation, and
  element references and invalidates prior generations.
- `action-targets.ts` requires exact window and observation identities for actions.
- `window-actions.ts` launches only from an app returned by `list_apps`, uses exact
  window refs, and routes semantic element actions through Cua.
- `commands.ts::openExecution` owns one driver/frame/resources lifecycle and serializes
  operations.
- `node-invoke-policy.ts` classifies operations before dispatch.

OpenClaw is evidence for identity, generation, serialization, and dispatch policy. It is
not evidence that the complete Jev task loop or Anesu's task approval already exists.

## Concrete acceptance evidence

The implementation must not be marked complete from unit tests or the deterministic
fixture alone. Each live acceptance run must retain a bounded evidence bundle containing:

- the natural prompt exactly as entered through `pnpm run chat` or the designated
  visible Cua launcher;
- the validated task spec, source-backed values, verifier contract, budget, and task
  grant digest;
- one task approval decision and any separately approved foreground escalation;
- Cua and TypeSafe package/runtime/model versions and the desktop profile;
- the fresh `list_apps` record represented by an opaque app ref, the launch/reuse
  result, and the exact PID/window ref;
- every observation generation, candidate IDs/descriptions, selected Jev choice,
  confidence/probabilities, and hidden-action digest;
- each Cua action effect, route, delivery mode, and escalation/refusal;
- fresh verification status and predicate facts; and
- a terminal outcome that distinguishes completed, clarified, refused, cancelled,
  unsupported, timed out, and outcome unknown.

Minimum live capability ladder:

| Task | Required proof |
| --- | --- |
| Open one installed app | App was selected from the current disposable profile, launched or reused without a user/model command, and owns one stable exact window. |
| Enter exact text in Text Editor | One task approval; semantic target; exact nonce-bearing text; confirmed/value-readback action evidence where available; fresh exact-value verification. |
| Open Calendar | Exact approved app and stable bound Calendar window. |
| Create Calendar event | Exact title/date/time visible in a fresh post-submit event or list state. An unsaved form and model narration do not count. |
| Set Clocks alarm | Exact requested time and enabled state visible in a fresh post-submit alarm list; cleanup occurs inside the disposable profile. |

Every row must also prove that denial causes no launch/input, cancellation stops later
actions, stale observations are refused, provider failure cannot trigger input replay,
and ordinary in-grant actions do not prompt repeatedly.

## API and version risk register

| Risk | Consequence | Required control |
| --- | --- | --- |
| Generic Cua tools are not fully represented by typed methods. | A developer may call a nonexistent typed API or omit element/snapshot fields. | Contract-test live `listToolsJson()` schemas for every generic operation and isolate JSON parsing in the adapter. |
| `launch_path` is executed through the system shell on Linux. | User/model data could become command execution. | Use only an unchanged value from a fresh `list_apps` record; forbid arguments, names, paths, and URLs from prompts/models. |
| Cua runtime policy is immutable and loaded at startup. | A late task-level check cannot repair an overbroad native runtime. | Construct the driver with the bounded authorization ceiling before accepting work. |
| `@typesafe-ai/sdk` is declared as `^0.6.0`. | A new compatible-range release may change behavior or declarations. | Pin exactly or enforce the lockfile/API contract and record the SDK version. |
| `jev-latest` is a moving model alias. | Decision behavior and calibration can change without code changes. | Preflight availability, record the returned model identity, and rerun the labeled decision evaluation when it changes. |
| Confidence `0.5` has no local calibration evidence. | Unsafe choices or excessive abstention may be hidden behind a numeric threshold. | Calibrate against task candidate sets; confidence never replaces validation, permission, or verification. |
| Cua docs can move ahead of the installed package. | The plan may cite tools or fields absent at runtime. | Installed `0.28.2` declarations and runtime discovery are normative for this slice. |
| `window_id` is a 64-bit integer. | JavaScript number conversion can corrupt exact identity. | Keep it as `bigint` or an opaque decimal string at serialization boundaries. |
| X11, D-Bus, AT-SPI, capture, and window-manager behavior vary. | Tool inventory may pass while observation or input is unusable. | Require `health_report` and live target-app observation in the disposable profile. |
| Accessibility trees can be incomplete or ambiguous. | Absence, duplicate labels, or a transient form could be mistaken for success. | Preserve degraded/truncated flags; require unambiguous fresh predicates; treat `unknown` as non-success. |
| One in-process Cua runtime is expected per process. | Repeated construction or concurrent calls can produce lifecycle races. | One driver owner, serialized task actions, named task sessions, and idempotent cleanup. |

## Final recommendation

Proceed with the active plan only after applying the P0 and P1 corrections above. The
core shape is correct:

```text
natural goal
  -> validated task and verifier
  -> bounded task approval
  -> trusted app resolution and exact window binding
  -> fresh Cua observation
  -> immutable code-built candidates
  -> Jev Choice
  -> local grant and freshness validation
  -> one Cua action
  -> fresh observation and independent verification
  -> repeat or terminate explicitly
```

Do not claim the outcome until the real Calendar and Clocks applications expose enough
fresh AT-SPI state to satisfy their postconditions. If either app cannot provide that
evidence, the correct result for this accessibility-only profile is "unsupported", not
a screenshot-based workaround or a model assertion.
