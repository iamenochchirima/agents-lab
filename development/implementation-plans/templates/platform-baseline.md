# Platform implementation plan template

Copy this file to `development/implementation-plans/active/` and rename it for the
platform and variant being implemented. Replace every `[placeholder]`. Keep the
platform adapter behind the committed server runner contract; do not reopen shared
contracts in a platform plan unless new platform evidence proves that the contract is
insufficient. Remove a section only after recording `Not applicable — [reason]`.

**Created:** `[YYYY-MM-DDTHH:MM:SS±HH:MM]`<br>
**Last updated:** `[YYYY-MM-DDTHH:MM:SS±HH:MM]`<br>
**Status:** Active<br>
**Owner:** `[person or team]`<br>
**Platform:** `[platform identifier]`<br>
**Variant:** `[variant identifier]`

## Start here

Read these before changing code:

- [`repository rules`](../../../AGENTS.md)
- [`server ownership`](../../../server/README.md)
- [`server architecture`](../../../server/src/control-plane/README.md)
- [`platform ownership`](../../../server/src/platforms/README.md)
- [`runner interfaces`](../../../server/src/control-plane/ports/README.md)
- [`server platform foundation`](../active/server-platform-foundation.md)
- `[platform-specific SDK or service documentation]`

Reference harnesses, upstream repositories, and framework examples are design input,
not requirements. Record which behaviours are being studied and which are intentionally
not copied:

- `[reference implementation or documentation]` — `[relevant observation]`
- `[reference implementation or documentation]` — `[relevant observation]`

## Purpose

[State the platform/variant this plan adds, the user or experiment flow it enables, and
why this platform is the next useful comparison. Keep this about the implementation,
not a general framework overview.]

## Platform and variant identity

| Field | Decision |
| --- | --- |
| Platform identifier | `[stable lowercase identifier]` |
| Display name | `[human-readable name]` |
| Variant identifier | `[stable variant identifier]` |
| Display name | `[human-readable variant name]` |
| Status before this plan | `[planned/runnable/other]` |
| Language and runtime | `[language, runtime, and versions]` |
| SDK/framework version | `[pinned version or not applicable]` |
| Execution model | `[direct loop/workflow/graph/service/etc.]` |
| Durability model | `[none/application-managed/platform-managed/etc.]` |
| State model | `[memory/checkpoint/database/service/etc.]` |
| Environment | `[local process/container/VM/remote service/etc.]` |
| Infrastructure | `[required local or remote services]` |

### Definition of done

Describe the exact real flow that works when this plan is complete. Include the command
or UI/API action, the dependency it contacts, the platform execution, and the evidence a
contributor can inspect. Do not describe simulated success.

```text
[run request] → [server runner] → [platform execution] → [normalized evidence + native evidence]
```

The completed implementation must be able to:

- [ ] accept `[specific run request or entry point]`;
- [ ] execute `[specific platform operation]` against `[real local/remote dependency]`;
- [ ] expose `[status/result/cancellation behaviour]` through the server contract;
- [ ] produce inspectable records under `lab/runs/<run-id>/`;
- [ ] explain unavailable dependencies and unknown outcomes without fabricating results.

## Scope

- [ ] `[platform adapter and variant implementation]`
- [ ] `[platform-owned configuration and validation]`
- [ ] `[local dependency/bootstrap changes]`
- [ ] `[tests and fixtures]`
- [ ] `[documentation and learning material]`

## Explicitly out of scope

- `[deferred platform, variant, provider, or feature]`
- `[deferred deployment, UI, environment, or integration work]`
- `[behaviour this platform does not claim to support]`

Do not add placeholder controls or unbacked status claims merely to make the platform
appear complete.

## Architecture and ownership

### Boundary map

```text
server/src/control-plane/
  common request, manifest, lifecycle, runner dispatch, and normalized evidence

server/src/platforms/[platform]/
  [platform client, worker/service entrypoint, variants, native state, and adapter]

lab/runs/<run-id>/
  config.json, events.jsonl, trajectory.json, metrics.json, result.json,
  native/[platform].json, logs/, and artifacts/
```

Replace the example paths with the actual ownership map for this platform. State:

- The files/modules that own platform SDK or service calls: `[paths]`.
- The module that constructs the platform execution request: `[path]`.
- The module that owns in-flight execution: `[path/service]`.
- The sole writer for normalized run records: `[path]`.
- The sole writer for native platform evidence: `[path]`.
- The module that may expose run state to the UI/API: `[path]`.
- The dependencies and SDK types that must not cross into common server modules:
  `[list]`.

### Files allowed to change

| Workstream | Owned files/directories | Must not change | Handoff |
| --- | --- | --- | --- |
| Platform adapter | `[paths]` | `[shared contracts or other platforms]` | `[result]` |
| Configuration/dependencies | `[paths]` | `[unrelated config]` | `[result]` |
| Tests | `[paths]` | `[production implementation, if applicable]` | `[result]` |
| Documentation | `[paths]` | `[runtime code]` | `[result]` |

If a shared file must change, explain why the platform cannot use the existing seam and
record the contract decision before editing it.

## Local dependencies and infrastructure

### Required services

| Dependency | Required for | Local start command | Readiness check | Unavailable behaviour |
| --- | --- | --- | --- | --- |
| `[service]` | `[operation]` | `[command]` | `[command/endpoint]` | `[explicit result]` |

Define whether the platform runs in-process, as a worker, as a separate service, or
through an external deployment. Include pinned versions and ports where relevant.

- [ ] Local setup is documented from a clean checkout.
- [ ] Required services have deterministic readiness checks.
- [ ] Optional services are clearly separated from required services.
- [ ] Credentials use environment variables or safe local fixtures.
- [ ] The implementation fails clearly when a required dependency is unavailable.
- [ ] No secret, personal data, or machine-specific state is committed.

### Configuration

- Configuration source: `[environment/config file/server request]`.
- Effective configuration is recorded in `config.json`: `[yes/no and redaction rule]`.
- Platform defaults: `[defaults]`.
- Validation failures: `[HTTP/API/runner error and user-visible message]`.
- Secret fields and redaction boundaries: `[fields/rules]`.
- Resource, permission, and isolation limits: `[limits or not applicable]`.

## Runner contract

Describe how this implementation satisfies the committed generic runner interface. The
adapter must keep platform-specific lifecycle decisions inside the platform boundary.

### Operations

| Operation | Platform implementation | Inputs | Output | Failure/unknown outcome |
| --- | --- | --- | --- | --- |
| Validate configuration | `[module/function]` | `[inputs]` | `[result]` | `[behaviour]` |
| Check availability | `[module/function]` | `[inputs]` | `[result]` | `[behaviour]` |
| Start | `[module/function]` | `[manifest/config]` | `[execution reference]` | `[behaviour]` |
| Inspect | `[module/function]` | `[execution reference]` | `[status/result]` | `[behaviour]` |
| Cancel | `[module/function]` | `[execution reference]` | `[result]` | `[behaviour]` |

### Execution reference

Define the safe native reference returned through the generic seam:

```json
{
  "platform": "[platform]",
  "variant": "[variant]",
  "executionId": "[stable platform execution identity]",
  "native": {
    "[safe field]": "[example]"
  }
}
```

- Identity and uniqueness rule: `[rule]`.
- Start retry rule: `[safe/unsafe/conditional, with reason]`.
- Cancellation address: `[field/operation]`.
- Inspection after restart: `[rule]`.
- Safe native fields persisted: `[fields]`.
- Redacted or forbidden fields: `[credentials, headers, tokens, or other data]`.
- Platform unavailable representation: `[error/status]`.

## Execution, durability, and state semantics

Do not use generic labels without describing the actual platform behaviour.

### Lifecycle

Describe the transition from request admission to terminal result:

```text
[received] → [validated] → [started] → [running] → [completed/failed/cancelled/unknown]
```

For each transition, identify the owner, persisted record, and observable event:

| Transition | Owner | Persisted before/after | Normalized event | Native detail |
| --- | --- | --- | --- | --- |
| `[transition]` | `[module/service]` | `[record/timing]` | `[event]` | `[evidence]` |

### Durability and state

- State that survives a server restart: `[state]`.
- State owned by the platform: `[state]`.
- State owned by the server: `[state]`.
- State that is intentionally ephemeral: `[state]`.
- Checkpoint or resume identity: `[identity/rule]`.
- Server restart reconciliation: `[procedure]`.
- Platform restart or worker recovery: `[procedure]`.
- Orphaned execution handling: `[procedure]`.
- Event ordering source and rule: `[source/rule]`.
- Duplicate event/result handling: `[rule]`.
- Retention and cleanup: `[rule]`.

### Failure, retry, cancellation, and side effects

Answer every applicable question explicitly:

- [ ] What may be retried, with what limit and backoff?
- [ ] What proves an external operation was not sent?
- [ ] What happens after a timeout or lost acknowledgement?
- [ ] What is the idempotency key or deduplication rule?
- [ ] Can a model/provider request be duplicated? If so, how is that recorded?
- [ ] What happens when cancellation races with execution or a side effect?
- [ ] What happens when the server, worker, platform, or dependency restarts?
- [ ] How are duplicate, out-of-order, or orphaned events handled?
- [ ] Which outcome is reported when the real external outcome is unknown?
- [ ] Which platform guarantees are deliberately not claimed?

Never call a behaviour exactly-once unless the implementation and tests establish the
precise guarantee.

## Native evidence and normalized records

The server owns the comparable normalized projection. The platform adapter preserves
useful native detail without making the common schema pretend that every platform has the
same history, checkpoint, retry, or telemetry model.

### Evidence layout

```text
lab/runs/<run-id>/
  config.json          # effective safe configuration
  events.jsonl         # normalized lifecycle events
  trajectory.json      # normalized execution trajectory
  metrics.json         # normalized measurements
  result.json          # terminal result, written according to the rule below
  native/
    [platform].json     # platform-specific execution/evidence summary
  logs/                 # retained operational logs, if applicable
  artifacts/            # outputs produced by the run
```

Define:

- Native evidence schema and version: `[schema/path]`.
- Native evidence writer: `[module]`.
- Write timing and atomicity: `[rule]`.
- Result cardinality: `[one per run/one per turn/etc.]`.
- Multi-turn or repeated-result rule: `[rule]`.
- Compatibility with existing evidence: `[read/migrate/unsupported and reason]`.
- Native path allowlist and platform-name validation: `[rule]`.
- Redaction and retention: `[rule]`.
- Framework-specific telemetry retained outside normalized evidence: `[data/path]`.

Evidence checklist:

- [ ] A run can be inspected without the platform service still being available.
- [ ] Normalized records preserve identity, ordering, and terminal-result semantics.
- [ ] Native evidence preserves details needed to understand platform behaviour.
- [ ] Writes are safe against traversal, collisions, partial files, and duplicates.
- [ ] Credentials and raw provider headers never enter evidence or logs.
- [ ] The evidence schema and examples are documented.

## Implementation checklist

### 1. Contract and design checkpoint

- [ ] Confirm the committed generic runner, manifest, execution-reference, and evidence contracts.
- [ ] Record any platform-specific data that must remain native.
- [ ] Record alternatives, trade-offs, and compatibility constraints.
- [ ] Confirm ownership and file boundaries before parallel work begins.

### 2. Platform adapter and variant

- [ ] Add platform-owned configuration and validation.
- [ ] Add the platform client/worker/service entrypoint.
- [ ] Implement runner operations without leaking SDK types into common modules.
- [ ] Register the variant with an honest runnable/planned status.
- [ ] Implement normal completion and terminal result projection.
- [ ] Implement failure, cancellation, retry, restart, and unknown-outcome behaviour.

### 3. Dependencies and local operation

- [ ] Add only necessary dependencies with a documented reason.
- [ ] Add or update local startup and readiness checks.
- [ ] Verify unavailable dependencies fail clearly.
- [ ] Verify configuration and secret redaction boundaries.

### 4. Evidence and observability

- [ ] Write normalized evidence through the common server path.
- [ ] Write native evidence through the platform-owned path.
- [ ] Emit safe structured logs and normalized events.
- [ ] Preserve platform-specific telemetry needed for inspection.
- [ ] Record metrics only when they are real and defined by the platform.

### 5. Documentation and learning material

- [ ] Update the platform/variant README with execution, state, recovery, setup,
      permissions, telemetry, limitations, and validation.
- [ ] Update server architecture or ownership documentation if the boundary changed.
- [ ] Add a runnable local-development guide and example configuration.
- [ ] Add a focused `development/playground/` walkthrough when it helps inspect one
      implementation slice; keep it separate from tests, scenarios, and experiments.
- [ ] Link upstream documentation or source references used for platform decisions.

## Test coverage

### Unit tests

- [ ] platform and variant identity, registration, and configuration validation
- [ ] runner operation input/output mapping
- [ ] execution-reference serialization, redaction, and validation
- [ ] normal completion and result projection
- [ ] failure, cancellation, retry, timeout, and unknown-outcome mapping
- [ ] restart/reconciliation and orphan handling
- [ ] duplicate/out-of-order event and terminal-result handling
- [ ] native evidence schema, safe paths, atomic writes, and compatibility rules
- [ ] logs/events/metrics omit secrets and unsafe provider data

### Integration tests

- [ ] real local dependency path with deterministic fixtures
- [ ] server-to-runner dispatch through the generic HTTP/run-service path
- [ ] platform worker/service startup and readiness
- [ ] successful run with normalized and native evidence
- [ ] platform failure and unavailable dependency
- [ ] cancellation during execution
- [ ] retry or duplicate-call semantics for model and external requests
- [ ] server/platform restart and evidence reconciliation
- [ ] retained execution inspected after the original process exits
- [ ] planned/unregistered platform requests remain rejected

### UI/API compatibility tests

- [ ] API request and response schemas match the generic server contract.
- [ ] The Platform UI shows only capabilities backed by this registered variant.
- [ ] Run, poll, cancel, and inspect work without platform-specific assumptions in
      shared UI code.
- [ ] Native details are shown only through an explicit platform-specific view.

### Manual acceptance

- [ ] Start the documented local dependencies from a clean checkout.
- [ ] Run one successful request using `[entry point]`.
- [ ] Inspect `[config/events/trajectory/metrics/result/native evidence]`.
- [ ] Exercise `[failure/cancellation/restart/unknown-outcome flow]` and inspect the result.
- [ ] Confirm unavailable infrastructure is reported without a fabricated run result.
- [ ] Confirm no API key, raw provider header, or credential appears in logs/evidence.
- [ ] Confirm the UI/API labels and status match the actual implementation state.

## Required validation commands

```bash
[exact platform unit-test command]
[exact server integration-test command]
[exact local dependency/readiness command]
[exact typecheck/build command]
git diff --check
```

Expected warnings, external prerequisites, unavailable profiles, and manual-only checks:

- `[details]`

## Documentation and release impact

### Documentation checklist

- [ ] Platform/variant documentation matches the implementation and commands.
- [ ] Architecture and ownership docs describe the actual boundary.
- [ ] Configuration, evidence, failure, recovery, and limitations are documented.
- [ ] Public API/UI documentation is updated when contracts change.
- [ ] Links and examples were checked from a clean or representative checkout.

### Release record

Record each decision explicitly, including `not applicable`:

- Analytics: `[decision and reason]`.
- Structured logging: `[safe fields and decision]`.
- Metrics/telemetry: `[decision and evidence]`.
- Version/release identity: `[manifest/version decision]`.
- Migration/compatibility: `[decision]`.
- Rollout: `[local-only/staged/deployed and procedure]`.
- Rollback: `[revert/disable/migration procedure]`.
- Security review: `[decision, risks, or not applicable]`.
- Known limitations: `[deliberate limits and follow-up]`.

## Commit boundaries

Use focused commits for coherent, validated sections. Do not combine all platform work
into one large commit. Adjust the sequence to the actual implementation, but keep each
commit independently reviewable where practical:

1. `[contract/configuration or platform registration]`
   - Validation: `[commands]`
2. `[platform adapter and local dependency path]`
   - Validation: `[commands]`
3. `[state/recovery/evidence and observability]`
   - Validation: `[commands]`
4. `[tests and conformance coverage]`
   - Validation: `[commands]`
5. `[documentation, playground, and release record]`
   - Validation: `[commands]`

Before each commit:

- [ ] Review `git status` and preserve unrelated user changes.
- [ ] Review the exact diff and confirm no secrets/generated machine state are included.
- [ ] Run the narrow validation for the section.
- [ ] Include related documentation with the code when its contract changes.
- [ ] Record the commit hash in the handoff or completion record.

## Parallel-agent handoffs

Parallel work may begin only after the platform contract, ownership map, and first
implementation commit are stable. The primary agent owns the common contract, integration,
conflict resolution, final review, and release decision.

### Safe workstreams

| Workstream | Agent-owned files | Must not change | Handoff must include |
| --- | --- | --- | --- |
| Platform adapter | `[platform paths]` | common contracts, other platforms | changed files, behaviour, tests, limits |
| Local dependency | `[scripts/config paths]` | unrelated platform code | start/readiness commands, versions, failure behaviour |
| Evidence/tests | `[test/fixture paths]` | production contract without approval | cases covered, output, fixture assumptions |
| Documentation/playground | `[docs/development paths]` | runtime code | links checked, commands, known gaps |
| UI compatibility | `[feature paths]` | server contract and other platform UI | screenshots/flow, checks, native-detail assumptions |

### Handoff checklist

- [ ] Agent states the exact files changed.
- [ ] Agent states files deliberately not changed.
- [ ] Agent reports tests and commands with exact results.
- [ ] Agent records assumptions, unresolved questions, and known limitations.
- [ ] Agent identifies any evidence or migration impact.
- [ ] Agent does not commit secrets, generated state, or unrelated edits.
- [ ] Primary agent reviews and integrates the work before the next shared-contract change.

No parallel agent may add another real platform implementation under this plan unless
the scope explicitly names it. Separate platform plans should start from the committed
generic seam and use this template.

## Completion gate

Before moving this plan to `completed/`, verify:

- [ ] The platform/variant is honestly registered as runnable or remains clearly planned.
- [ ] The documented real flow works with the required local dependencies.
- [ ] Runner operations and platform-specific semantics are tested.
- [ ] Failure, retry, cancellation, restart, duplicate, and unknown-outcome behaviour
      are implemented or explicitly documented as not applicable.
- [ ] Normalized and native evidence are inspectable and redacted safely.
- [ ] UI/API behaviour does not claim unsupported capabilities.
- [ ] Documentation, release decisions, known limitations, and links are current.
- [ ] Each coherent implementation section has a focused commit.
- [ ] Exact validation results and manual acceptance observations are recorded below.

## Completion record

Complete this section only when archiving the plan.

**Completed:** `[YYYY-MM-DDTHH:MM:SS±HH:MM]`<br>
**Commits:** `[commit hashes or contiguous range]`

### Validation

- `[command]` — `[passed/failed and concise result]`
- `[manual check]` — `[what was observed]`

### Known limitations

- `[deliberate limitation or follow-up]`

### Historical-scope note

[If later architecture changes make terminology or scope outdated, explain that this
plan records the decision at completion time and link to the current source of truth.]
