# Anesu computer-use dual paths

**Created:** 2026-09-18T01:43:47+02:00
**Last updated:** 2026-09-19T20:10:56+02:00
**Status:** Active
**Owner:** Anesu

## Start here

Read these before changing code:

- [Repository development rules](../../../../AGENTS.md)
- [Anesu development rules](../../../../anesu/AGENTS.md)
- [Anesu source boundaries](../../../../anesu/src/README.md)
- [Tool ownership and approval boundary](../../../../anesu/src/tools/README.md)
- [Existing browser capability](../../../../anesu/src/browser/README.md)
- [Computer-use research](../../../../docs/research/computer-use-implementation.md)
- [Computer-use experiment guidance](../../../../docs/planning/component-lab.md)
- [Anesu production-readiness gap register](anesu-production-readiness-gaps.md)

Reference implementations and primary documentation:

- [Hermes source map](../../../../docs/research/harness-code-maps/hermes.md)
- [OpenClaw source map](../../../../docs/research/harness-code-maps/openclaw.md)
- [TypeSafe System One](https://docs.typesafe.ai/concepts/system-one)
- [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice)
- [TypeSafe confidence guidance](https://docs.typesafe.ai/confidence)
- [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)
- [TypeSafe computer-use project](https://github.com/awlevin/typesafe-computer-use)

These references are design inputs, not requirements to copy. Preserve the existing
decisions that browser automation is a tool capability, that environment ownership is
separate from model/provider code, that screen content is untrusted, and that a
proposed action is distinct from an approved and committed action.

## Purpose

Add one standalone Anesu computer-use capability with two selectable decision paths:
the traditional screenshot-and-vision path and a TypeSafe/Jev semantic path. Both must
use the same bounded host executor, approval policy, cancellation, verification, and
evidence boundary so they can be compared honestly and one can later be removed without
rewriting the computer environment.

This is the first usable implementation slice, not a claim that every desktop platform
or every production-hardening case is complete.

## Implementation sequence

This is one plan with three deliberately ordered stages. The first stage is a small
visible-browser validation path, not a separate plan or a claim of native desktop
support. It keeps the first feedback loop short while establishing the contracts that
the later host adapter must use.

### Stage 1: visible browser validation

Use a fresh, visible, Anesu-managed Chromium profile and a loopback fixture with one safe
state-changing control. Run the same bounded task through both the traditional and
TypeSafe/Jev strategies. Both strategies must propose through the same approval and
executor path, execute at most one click, verify the changed state, and emit bounded TUI
activity and evidence. The fake-environment tests and the real TypeSafe/browser smoke
path establish the deterministic seam; provider availability, cancellation, evidence
redaction, compare-mode behaviour, and the traditional real-provider path remain
validation items in this plan rather than a second plan.

This stage proves the shared decision/execution boundary only. It does not prove native
desktop control, OCR, macOS Accessibility, CoreML segmentation, coordinate input, or
general multi-step computer use.

### Stage 2: one native graphical host

Add one explicitly supported disposable graphical host profile with readiness checks,
capture, input, focus, permissions, cleanup, and visible manual operation. Prefer the
maintained CUA-driver approach used by the reference agents; do not write a custom OS
driver or attach silently to a personal desktop.

### Stage 3: lifecycle and production reinforcement

Complete the shared recovery, evidence, comparison, resource-limit, security, and
focused test requirements below. Broader cross-platform, adversarial, load, and
operational reinforcement remains in the production-readiness gap register.

## Definition of done

With persistent local configuration in `anesu/.env`, a contributor can run:

```text
pnpm run chat
```

and ask Anesu to perform a small task in an explicitly selected, visible, disposable
computer environment. The configured strategy is either `traditional` or `typesafe`.
The traditional path sends a bounded visual observation to a vision-capable model and
receives a validated structured action. The TypeSafe path builds bounded local OCR and
accessibility/element state, sends only that text/JSON state to Jev, and maps Jev's typed
choice to the same executor. The TUI shows which path is active, what environment is
controlled, the proposed action, approval, execution, verification, and any abstention.

```text
user goal
  → Anesu computer tool
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

- [ ] Complete the visible browser validation stage with both strategy proposals, one
      shared approved executor, post-action verification, compare-mode evidence, and the
      focused failure/secret-redaction checks described below.
- [ ] Define a model-neutral computer-use contract for environment lifecycle,
      observations, candidate targets, action proposals, execution results, and
      post-action verification.
- [ ] Add a real host adapter for one explicitly supported graphical environment,
      with a visible/disposable mode for manual testing and a readiness/doctor check.
      The first native backend should prefer the maintained CUA-driver approach already
      used by Hermes/OpenClaw, pinned as a normal dependency with its host capability
      checks; do not write a custom kernel driver or silently attach to a personal
      desktop when that backend is unavailable.
- [ ] Implement the traditional visual strategy. It must support bounded screenshot
      observations, image-capable model input, a constrained computer-action schema,
      and capability rejection when the selected model cannot process images or the
      required action format.
- [ ] Implement the TypeSafe/Jev strategy. It must assemble local OCR and available
      accessibility/element metadata into bounded text/JSON candidates, issue a
      focused `Choice` request, retain probabilities and confidence, abstain below a
      configured risk-aware threshold, and never treat confidence as authorization.
- [ ] Keep text composition separate from Jev's classifier. If an action needs free
      text that is not already known from the goal or approved state, route it through
      an explicit bounded composer or request clarification; Jev must not be treated
      as a text generator.
- [ ] Share one deterministic action executor for click, type, keypress, scroll, wait,
      and close. Validate target identity, frame/display identity, coordinates or
      element handles, scale, focus, limits, and cancellation immediately before
      execution.
- [ ] Add a comparison mode in which one configured strategy is the executor and the
      other is shadow-only. Record agreement, disagreement, confidence, latency, and
      abstention without ever executing two competing actions on the same live screen.
- [ ] Add persistent local configuration for enablement, strategy, model selection,
      environment profile, limits, and credentials. The normal development flow must
      not require exporting a key or model on every run.
- [ ] Extend the TUI with strategy/environment readiness, live observe/propose/approve/
      act/verify activity, concise target and confidence details, visible artifact
      links, and clear unavailable/aborted/ambiguous states.
- [ ] Produce bounded, inspectable computer-use evidence for each observation and
      action, including provider-specific details without placing raw screenshots in
      the transcript by default.
- [ ] Document a small real-model/manual fixture flow that can be run from
      `pnpm run chat` and a replayable fake-environment test flow.

## Explicitly out of scope

- Training, bundling, or claiming an on-device CoreML UI-segmentation model. The linked
  TypeSafe project currently uses local screen capture, Apple Vision OCR, and macOS
  Accessibility data; current TypeSafe documentation says Jev accepts text/JSON, not
  images. The perception seam must leave room for a future local segmenter without
  pretending that it exists now.
- Full native support for macOS, Linux, and Windows in this first slice. The shared
  contract and diagnostics may be cross-platform, but the implementation will name one
  real host profile and report other profiles as unavailable until their adapters are
  implemented and tested.
- A desktop application, remote node fleet, pairing service, cloud desktop, or
  personal-browser/CDP attachment. The initial surface is the standalone Anesu CLI/TUI
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
directory name should follow Anesu's existing state-root conventions; its contents are:

```text
computer-runs/<run-id>/
  run.json                 # strategy, environment, limits, outcome, timestamps
  observations.jsonl       # bounded metadata and redacted semantic state per step
  actions.jsonl            # proposal, approval, execution, verification, and outcome
  providers.jsonl          # provider-specific model IDs, confidence/probabilities, timing
  artifacts/               # opt-in bounded screenshots/annotated captures, if enabled
```

- [ ] Every run, observation, proposal, and action has a stable ID and references its
      predecessor observation.
- [ ] A target is bound to an observation/frame identity, display scale, bounds, and
      foreground target. An action is rejected as stale when those facts change.
- [ ] Raw screenshots are opt-in artifacts with byte/dimension limits, redaction or
      explicit sensitive-data warnings, and retention cleanup. They are not copied into
      the model transcript by default.
- [ ] TypeSafe state records candidate source (`ocr`, `accessibility`, or both), role,
      label, bounded location, and selected option. Traditional records image metadata
      and the model action without retaining unbounded prompt content.
- [ ] Writes are append-only or atomically replaced according to the existing
      persistence rules. A partial record cannot become the active completed result.
- [ ] On restart, an incomplete action is reconciled as `outcome-unknown` unless the
      adapter can prove it did not reach the host. It is never replayed automatically.

## Failure, retry, and recovery semantics

- [ ] Observation capture may be retried once within the run deadline when no action
      was sent. Strategy decisions may be retried only before execution and with a
      bounded attempt count; each attempt has its own provider evidence.
- [ ] An action is not assumed idempotent. A lost acknowledgement after input was sent
      yields `outcome-unknown`, stops automatic retry, and asks for inspection.
- [ ] A stale target, changed display scale, changed foreground application, lost
      focus, missing permission, or invalid coordinate fails closed before input.
- [ ] Cancellation stops new observations and actions, asks the host adapter to close
      or release resources, and records whether an in-flight action was definitely
      cancelled or may have been delivered.
- [ ] Host-driver crash, display disappearance, provider timeout, malformed response,
      and confidence abstention have distinct error categories and TUI messages.
- [ ] Duplicate tool calls for one call identity are ignored or rejected according to
      the runtime's existing tool-call rules; the executor never repeats a committed
      action solely because an acknowledgement was duplicated.
- [ ] Shadow comparison failure never blocks or mutates the primary executor unless
      the user explicitly selects a policy that says so. Disagreement is evidence.

## Security and configuration

- [ ] Computer use is disabled by default and requires an explicit environment/profile
      selection. The default profile cannot attach to the user's personal desktop or
      browser profile.
- [ ] Persistent development configuration supports the selected strategy and model,
      but keys are read from `.env`/process environment, never written to evidence or
      displayed in the TUI. The repository keeps only `.env.example` placeholders.
- [ ] Traditional mode refuses models without a verified vision/action capability.
      TypeSafe mode refuses a missing `TYPESAFE_API_KEY`, unsupported Jev request, or
      unavailable semantic observation source; there is no silent path substitution.
- [ ] Screen content, OCR, accessibility labels, and model output are untrusted data.
      They cannot grant approval, change policy, escape the environment, or invoke an
      unlisted action.
- [ ] Input text, URLs, keypresses, clicks, navigation, and file-transfer-like actions
      have explicit schemas and bounds. Password fields and secret-looking values are
      refused or redacted in the first slice.
- [ ] Environment readiness reports required display/session permissions, backend
      identity, visibility, and isolation limitations before an action can run.
- [ ] Resource limits cover total duration, action count, observation size, image bytes,
      semantic candidate count, text length, and provider request size.

## Implementation checklist

### 1. Contracts and configuration

- [ ] Add branded IDs and schemas for computer runs, observations, targets, actions,
      approvals, verification, and provider evidence.
- [ ] Add strategy values `traditional`, `typesafe`, and `compare`, with an explicit
      primary strategy for compare mode. Validate limits and reject unknown values.
- [ ] Add the `ComputerEnvironment` and `ComputerDecisionStrategy` seams without
      importing provider or native-host types into runtime/tool contracts.
- [ ] Extend model request content only as needed for bounded image input; retain a
      truthful `vision` capability and reject unsupported providers/models.
- [ ] Add persistent `.env` development settings and safe defaults with no per-run
      export requirement.

### 2. Core implementation

- [ ] Implement readiness, start, observe, execute, verify, stop, and close lifecycle
      for one real disposable graphical host profile.
- [ ] Validate and pin the selected CUA-driver/backend dependency, record its native
      artifact/platform requirements, and keep the dependency behind the environment
      adapter so Anesu remains portable when another backend is selected later.
- [ ] Implement shared action validation, observation/frame freshness, coordinate/target
      checks, limits, cancellation, and result classification.
- [ ] Implement traditional screenshot/action parsing and bounded visual-model input.
- [ ] Implement TypeSafe/Jev state assembly, batched focused Choice questions, response
      validation, confidence/risk gating, and deterministic target mapping.
- [ ] Implement explicit free-text composition/clarification handling and post-type
      verification without treating Jev as a generator.
- [ ] Implement shadow comparison with no second execution and provider-specific
      timing/probability evidence.

### 3. Integration and user surface

- [ ] Register one model-facing `computer` tool whose schema exposes only implemented
      actions and whose results are bounded, typed, and honest.
- [ ] Connect the tool to runtime lifecycle events, approval, cancellation, deadlines,
      recovery, and existing tool-call deduplication.
- [ ] Add TUI readiness and activity projections plus a concise `/computer` inspection
      surface. Preserve Ctrl+C and the existing approval interaction.
- [ ] Add safe artifact links and replay/inspection metadata without making raw screen
      contents part of ordinary transcript rendering.

### 4. Documentation and learning material

- [ ] Document the strategy/environment configuration in Anesu's CLI and local setup
      guides, including one-time `.env` configuration and unavailable-host behaviour.
- [ ] Document the architecture boundary and why Jev receives local semantic state,
      not screenshots, with links to the TypeSafe project and official docs.
- [ ] Add a `development/playground/` walkthrough for one safe visible fixture and one
      replayable observation, clearly labelled as a hands-on inspection rather than a
      test or benchmark.
- [ ] Record deferred OS, CoreML, security, and operations reinforcement in the
      production-readiness gap register rather than expanding this first slice.

## Test coverage

The first slice needs focused tests that prove the core path. Exhaustive platform and
adversarial reinforcement remains in the gap register and is not a reason to hold this
slice indefinitely.

### Unit tests

- [ ] action schema, limits, coordinate/target bounds, display scale, and frame freshness
- [ ] strategy configuration, capability checks, provider response validation, and
      truthful unavailable errors
- [ ] TypeSafe Choice candidate construction, `none`/no-match handling, probability and
      confidence recording, threshold/abstention, and stable target mapping
- [ ] traditional multimodal message serialization, action parsing, and malformed/
      unsupported response rejection
- [ ] risk classification, approval projection, redaction, and secret handling
- [ ] evidence serialization, bounded screenshots, deterministic IDs, and no transcript
      leakage

### Integration tests

- [ ] deterministic fake environment: observe → proposal → approval → action → fresh
      observation → verification
- [ ] both strategies drive the same fake fixture to equivalent safe outcomes, while
      retaining separate provider evidence
- [ ] compare mode executes only the primary strategy and records shadow agreement or
      disagreement
- [ ] stale target, focus loss, display loss, provider timeout, malformed response,
      missing permission, low confidence, and approval denial
- [ ] cancellation before execution, during execution, and after an ambiguous
      acknowledgement
- [ ] restart/recovery of an incomplete run, including no automatic replay and a clear
      `outcome-unknown` result
- [ ] duplicate/out-of-order events and duplicate tool-call identities
- [ ] real local backend smoke test when the declared host profile is available; skip
      with an explicit readiness reason when it is not

### Manual acceptance checks

- [ ] Configure one strategy and model once in `anesu/.env`, run `pnpm run chat`, and
      complete a small safe task in a visible disposable fixture.
- [ ] Repeat the same fixture with the other strategy and inspect the TUI's strategy,
      target, approval, action, verification, and timing output.
- [ ] Run compare mode and verify only the primary strategy changes the fixture while
      both proposals are visible in evidence.
- [ ] Cancel with Ctrl+C and verify the run stops without claiming an unverified action.
- [ ] Inspect the run evidence and verify no API key, password, or unbounded screenshot
      entered the transcript or ordinary logs.

## Required validation commands

```bash
pnpm --filter @agent-harness-lab/anesu typecheck
pnpm --filter @agent-harness-lab/anesu test
pnpm --filter @agent-harness-lab/anesu coverage
git diff --check
```

The real backend smoke test requires the declared graphical host profile, its input/
capture permissions, and configured provider credentials. CI must use the fake
environment for deterministic coverage and report a missing real host as unavailable,
not as a passing real-backend result.

## Completion gate

Before moving this plan to `completed/`, verify:

- [ ] Both selectable strategies perform real proposals and use the same real executor;
      no deterministic echo path is presented as computer use.
- [ ] One declared host profile completes a visible, safe manual task through each
      available strategy, or the unsupported strategy/host is explicitly documented as
      unavailable with a concrete reason.
- [ ] Approval, cancellation, stale-target protection, post-action verification,
      recovery, and bounded evidence are implemented and covered by focused tests.
- [ ] Compare mode is shadow-only for the non-primary strategy.
- [ ] TUI, configuration, docs, playground, and validation commands match the shipped
      behaviour.
- [ ] Known platform and production-hardening limitations are recorded in the gap
      register.

## Commit discipline and handoff

- [ ] Commit contracts/configuration, host/strategy implementation, and TUI/evidence as
      reviewable validated sections when practical.
- [ ] Run the narrow validation relevant to each section before committing it.
- [ ] Review `git status` and each diff; preserve unrelated `.anesu-trash` or user files.
- [ ] Record changed files, validation results, real-backend prerequisites, and known
      limitations in the handoff.
- [ ] Record implementation commit hashes in the completion record when the plan is
      archived.

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

This plan records the first dual-path computer-use slice. Later work may replace a host
adapter, add a local segmenter, or remove one strategy after comparable evidence, but
those changes must update the current source of truth rather than silently changing this
completion record.
