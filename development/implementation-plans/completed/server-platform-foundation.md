# Server platform foundation: generic runner contract and Temporal isolation

**Created:** 2026-09-15T09:54:24+02:00
**Last updated:** 2026-09-15T10:22:54+02:00
**Status:** Completed
**Owner:** Primary implementation agent
**Parallel work:** Allowed after the contract checkpoint described below

## Start here

Read these before editing:

- [repository rules](../../../AGENTS.md)
- [server ownership](../../../server/README.md)
- [server architecture](../../../server/src/control-plane/README.md)
- [platform ownership](../../../server/src/platforms/README.md)
- [runner interfaces](../../../server/src/control-plane/ports/README.md)
- [completed Temporal implementation](lab-server-temporal-baseline.md)
- [Platform UI ownership](../../../apps/web/src/features/platforms/README.md)
- [reference harness code maps](../../../docs/research/harness-code-maps/README.md)

The reference harnesses are design input only. This slice must not import Computer
Native code, OpenClaw, Hermes, Waku, or another platform implementation.

## Purpose

The first Temporal implementation proved that the UI, server, worker, durable
platform execution, model adapter, and Lab evidence can work together. The server
is not yet a genuinely reusable platform server, though. Its common code still
contains Temporal assumptions:

- the manifest only accepts `temporal/baseline`;
- the run view exposes `temporalReference`;
- the evidence store reads and writes `native/temporal.json` directly;
- the HTTP health response is shaped around Temporal;
- the runner reference is a workflow-shaped type rather than a platform execution
  reference;
- the server bootstrap constructs only one concrete runner.

This plan removes those assumptions while keeping Temporal working. It creates the
shared seam that future Restate, LangGraph, Mastra, Vercel, Inngest, Trigger.dev,
DBOS, Hatchet, and AWS Step Functions plans can implement independently.

This is a server architecture slice, not another platform implementation.

## Definition of done

The existing Temporal baseline still works through the current local stack:

```bash
temporal server start-dev
./scripts/run_local_stack.sh
```

The server can also run a second in-memory test adapter through the same generic
runner interface. The test adapter does not pretend to be a real platform. It exists
to prove that the common server modules no longer require Temporal-shaped data.

The completed server has these properties:

```text
generic run request
  → registry selects platform + variant
  → platform-neutral manifest
  → platform runner adapter
  → platform execution reference
  → normalized Lab evidence
  → platform-native evidence
```

Temporal remains the first real adapter. Its workflow IDs, namespace, task queue,
signals, queries, and workflow history stay inside `server/src/platforms/temporal/`.

The final validation must show:

- all current server unit tests pass;
- the local Temporal integration test passes;
- the existing Platform UI can still submit, poll, cancel, and inspect a Temporal run;
- the generic test adapter can complete and fail through the same `RunService`;
- no generic control-plane module needs to import Temporal SDK types;
- native evidence is selected by platform rather than hardcoded to Temporal;
- a fresh platform implementation plan can be created from the new template and
  assigned to another agent without changing the common server design.

## Fixed scope

- [x] Generalize the run-domain types without erasing useful platform-specific data.
- [x] Move platform-specific manifest settings behind the selected runner seam.
- [x] Replace the Temporal-only execution reference with a generic platform execution
      reference that can carry safe native details.
- [x] Generalize evidence-store native reference handling and allowlisted evidence
      paths while preserving safe path rules.
- [x] Make `RunService` reconcile, cancel, and project runs through the generic runner
      interface only.
- [x] Make health and platform availability data represent registered runners rather
      than one hardcoded platform.
- [x] Migrate the Temporal adapter and its tests without changing Temporal semantics.
- [x] Add a test-only second runner and runner conformance tests.
- [x] Add a reusable platform implementation-plan template with explicit ownership,
      dependencies, tests, evidence, documentation, and commit boundaries.
- [x] Update server and Platform UI documentation where response or evidence contracts
      change.
- [x] Record exact validation results, manual checks, release impact, and known limits
      before marking this plan complete.

## Explicitly out of scope

This slice does not:

- implement Restate, LangGraph, Mastra, Vercel, Inngest, Trigger.dev, DBOS, Hatchet,
  or AWS Step Functions;
- add new model providers, tools, skills, memory, plugins, OAuth, MCP, gateways,
  social connections, or Computer Native integration;
- redesign the Platform UI beyond contract compatibility or necessary labels;
- create a generic agent-loop abstraction;
- move Temporal workflow logic into the common server layer;
- add a database-backed run store or remote deployment;
- claim that all platform semantics can be represented by normalized evidence;
- hide platform-specific retries, scheduling, checkpoints, or failure semantics;
- create placeholder controls that are not backed by a registered runner.

## Design decisions to lock before implementation

The primary agent must write the contract decision before parallel implementation
starts. The decision record can live in the plan until the implementation is
complete, but every delegated agent must use the same decision.

### Generic run manifest

The common manifest owns only data that every run needs:

- run identity and creation time;
- server version;
- platform and variant identifiers;
- task definition;
- model selection;
- common context settings;
- safe experiment identity when experiments are supported.

Platform settings belong in a platform-owned, validated section. The common server
may retain the effective serialized values for reproducibility, but it must not read
Temporal namespace or task-queue fields from a generic manifest.

The manifest remains immutable after dispatch. Credentials, raw provider headers,
and arbitrary unvalidated objects must not enter it.

### Generic execution reference

The runner interface returns a platform execution reference with common identity
fields and a safe native payload. The common server may persist and pass that
reference back to the same runner. It must not inspect workflow IDs, invocation IDs,
graph checkpoints, or service-object keys to make lifecycle decisions.

The reference interface must document:

- identity and uniqueness rules;
- whether it is safe to retry `start`;
- how cancellation addresses the execution;
- how an unavailable platform is represented;
- which native fields may be persisted;
- which fields must be redacted.

### Normalized versus native evidence

The server continues to own these normalized files:

```text
config.json
events.jsonl
trajectory.json
metrics.json
result.json
```

Platform-specific evidence stays under an allowlisted native path:

```text
native/<platform>.json
```

The normalized record must preserve comparable lifecycle meaning without pretending
that Temporal history, Restate state, and LangGraph checkpoints are the same thing.
Native evidence must remain available for platform-specific study.

Existing Temporal evidence must remain readable during this change. If the file name
or schema changes, the implementation must document the compatibility rule and test
it explicitly.

## Ownership map

```text
server/src/control-plane/domain/
  Common run request, manifest, lifecycle, result, and evidence types.
  No Temporal SDK imports and no platform-specific lifecycle decisions.

server/src/control-plane/ports/
  Small generic runner interface and its documented invariants.

server/src/control-plane/application/
  Registry, dispatch, cancellation, reconciliation, and normalized projection.
  It talks to a runner through the interface only.

server/src/control-plane/http/
  Generic request and response parsing. It does not know platform-native IDs.

server/src/control-plane/bootstrap/
  Composition of registered runners and common server configuration.

server/src/platforms/<platform>/
  Platform client, worker/service entrypoint, variants, native state, local
  dependencies, platform tests, and platform documentation.

lab/runs/<run-id>/
  The server-owned normalized projection plus safe native platform evidence.

apps/web/src/features/platforms/
  Uses common run responses. It may render native details only through an explicit
  platform-specific view, never by assuming every runner has Temporal fields.
```

The common modules are the shared seam. Platform adapters are implementations of
that seam. A second adapter must make the seam deeper, not cause each caller to
learn another platform's SDK concepts.

## Parallel implementation model

Parallel work starts only after the primary agent commits the contract checkpoint.
Before that checkpoint, agents may inspect and propose changes but must not create
competing versions of the common types.

### Sequential foundation work owned by the primary agent

1. Confirm the generic contract and compatibility rules.
2. Update common types, manifest validation, runner interface, and evidence interface.
3. Migrate the Temporal adapter and bootstrap to the new interface.
4. Run the common test suite and commit the foundation.

### Delegatable work after the foundation commit

| Workstream | Owned files | Must not change | Handoff result |
| --- | --- | --- | --- |
| Runner conformance tests | `server/tests/control-plane/runner-contract.test.ts`, test fixtures | common production interfaces | Tests that any adapter must satisfy |
| Evidence compatibility tests | `server/tests/control-plane/evidence-store.test.ts`, native fixtures | platform adapters | Tests for generic and legacy-safe evidence |
| Temporal migration tests | `server/tests/platforms/temporal/` tests only | common domain design | Proof that Temporal semantics remain unchanged |
| Platform plan template | `development/implementation-plans/templates/` | runtime code | Reusable plan for a future platform agent |
| UI compatibility review | `apps/web/src/features/platforms/` | server contracts | UI changes only if the committed response shape requires them |
| Documentation | server and platform README/docs files | implementation code | Updated ownership and onboarding documentation |

Each agent must report changed files, tests run, assumptions, and known limitations.
The primary agent owns integration, conflict resolution, and final contract decisions.

No parallel agent may add a real platform adapter in this plan. Real platform
implementations get separate plans and separate commits after this seam is stable.

## Implementation checklist

### 1. Contract inventory and decision record

- [x] List every Temporal-specific field in common domain, application, HTTP, evidence,
      bootstrap, UI, and tests.
- [x] Decide the generic manifest shape and platform-owned configuration seam.
- [x] Decide the generic execution-reference shape and native redaction rules.
- [x] Decide how old `native/temporal.json` evidence is read during migration.
- [x] Decide whether health returns one generic runner map or a list of runner statuses.
- [x] Record compatibility changes as an ADR or an explicit section in this plan.
- [x] Commit this checkpoint before delegating implementation work.

### 2. Common domain and runner seam

- [x] Generalize `RunManifest`, request validation, and manifest creation.
- [x] Preserve immutable effective configuration and safe serialization.
- [x] Rename or replace workflow-shaped common types with platform-neutral names.
- [x] Keep lifecycle statuses common and document platform-specific status mapping.
- [x] Keep the runner interface small: validation, connectivity, start, inspect, cancel.
- [x] Document start retry, cancellation, inspection, and unknown-outcome semantics.
- [x] Add runner conformance fixtures without putting fake platform behavior in production.

### 3. Evidence and reconciliation

- [x] Generalize `RunEvidenceSnapshot` and `RunView` away from `temporalReference`.
- [x] Add safe native reference read/write by platform identifier.
- [x] Keep evidence filenames allowlisted and reject traversal or unknown native paths.
- [x] Preserve event identity, source ordering, idempotent writes, and terminal-result rules.
- [x] Keep platform-specific event detail available without requiring it in normalized files.
- [x] Test server restart/reconciliation using a generic runner reference.
- [x] Test missing references, unavailable runners, duplicate events, and conflicting evidence.

### 4. Temporal migration

- [x] Move namespace, task queue, workflow type, activity names, and Temporal connection
      rules behind the Temporal adapter.
- [x] Keep Temporal workflow IDs and duplicate-start recovery unchanged.
- [x] Keep query, signal, cancellation, retry, and worker-restart behavior unchanged.
- [x] Keep the fake and OpenRouter model paths unchanged.
- [x] Keep Temporal native evidence safe and inspectable.
- [x] Update Temporal tests to use the generic reference only at the server seam.
- [x] Run the local Temporal integration test with a real local Temporal server.

### 5. Health, registry, and HTTP compatibility

- [x] Make registry entries the source of truth for runnable and planned variants.
- [x] Make health report registered runner connectivity without hardcoding one platform.
- [x] Keep errors actionable and prevent native SDK errors from leaking credentials.
- [x] Update API response types and UI client types together if response fields change.
- [x] Verify the existing Temporal Platform UI can still submit and inspect a run.
- [x] Do not show a planned platform as runnable merely because its directory exists.

### 6. Reusable platform plan template

- [x] Add a template for future platform implementation plans.
- [x] Require platform identity, variant identity, language/runtime, and local dependency.
- [x] Require adapter ownership and files allowed to change.
- [x] Require execution model, durability model, state model, and platform-native evidence.
- [x] Require normal completion, failure, cancellation, retry, restart, and unknown-outcome
      semantics.
- [x] Require unit, integration, local-infrastructure, manual, and UI acceptance checks.
- [x] Require documentation updates, release impact, commit boundaries, and known limits.
- [x] Require a parallel-agent handoff section that names safe file ownership.

### 7. Documentation and learning path

- [x] Update the server architecture diagram to show platform adapters behind one seam.
- [x] Document what the common server guarantees and what it deliberately does not normalize.
- [x] Document how a new platform plan is created and how an adapter becomes runnable.
- [x] Update the Temporal architecture and local-development guides.
- [x] Update Platform UI documentation if native reference fields or health responses change.
- [x] Add a short comparison table showing common run records versus native platform records.
- [x] Keep this plan focused on the server platform layer, not Computer Native.

## Test coverage

### Unit tests

- [x] generic manifest validation and immutable serialization
- [x] platform and variant lookup, planned versus runnable status
- [x] runner contract validation and safe error mapping
- [x] generic execution-reference persistence
- [x] native evidence path allowlisting and platform-name validation
- [x] event identity, source ordering, duplicate handling, and terminal idempotency
- [x] run service dispatch, inspection, cancellation, and reconciliation with a test runner
- [x] Temporal-specific configuration remains inside the Temporal adapter

### Integration tests

- [x] existing Temporal baseline run completes through the generic server path
- [x] existing Temporal cancellation still produces the same terminal semantics
- [x] Temporal worker restart recovery still projects one normalized result
- [x] a generic test runner completes and fails through the same HTTP/run service path
- [x] server restart reconciles a retained generic execution reference
- [x] unavailable platform execution does not fabricate a result
- [x] unknown or planned platform requests remain rejected with a clear response
- [x] native evidence for two runner identities cannot overwrite each other

### Manual acceptance checks

- [x] Start local Temporal and `./scripts/run_local_stack.sh`.
- [x] Exercise a Temporal fake-model request through the local HTTP path used by the
      Platform UI; the web typecheck/build passed against the same generic response.
- [x] Inspect `config.json`, `events.jsonl`, `trajectory.json`, `metrics.json`,
      `result.json`, and `native/temporal.json` through the integration evidence
      assertion and the returned run view.
- [x] Exercise server-restart reconciliation through a fresh `RunService` instance
      and confirm retained execution evidence is projected once.
- [x] Confirm a planned platform is rejected with `503 RUNNER_UNAVAILABLE` while the
      registered Temporal platform remains runnable.
- [x] Exercise the generic test adapter through its test harness, not the production UI.
- [x] Confirm no API key, raw provider header, or SDK credential appears in evidence or logs.

## Documentation, release, and commit checklist

- [x] Update relevant server and platform documentation in the same change.
- [x] Record analytics decision: not applicable unless new product interaction metrics are added.
- [x] Record structured logging decision: preserve safe runner/platform identifiers only.
- [x] Record metrics decision: keep normalized run metrics; add no invented platform metrics.
- [x] Record version/release identity decision: manifest server version remains populated.
- [x] Record rollout decision: local-only change; no deployment rollout required.
- [x] Record rollback decision: revert the foundation commits while retaining old Temporal evidence.
- [x] Record known limitations and migration rules in the completion record.
- [x] Use focused commits rather than one large implementation commit:
  1. `refactor(server): define platform-neutral run contracts`
  2. `refactor(server): isolate Temporal adapter details`
  3. `test(server): add runner and evidence conformance coverage`
  4. `docs(server): document platform adapter onboarding`
- [x] Move this plan to `completed/` only after exact validation output and manual checks
      are recorded.

## Completion gate

This plan is complete only when Temporal still runs end to end, a second test adapter
passes through the same server modules, the reusable platform plan template exists,
all listed tests have exact results, and the known limitations are written down.

The next separate plan may implement Restate, LangGraph, or another real platform. It
must start from the committed generic seam and must not reopen the common contract
without new evidence from that platform.

## Completion record

**Completed:** 2026-09-15T10:22:54+02:00<br>
**Commits:** `daf45a3`, `8b5b6d9`, `88b850c`, `d7ab0c8`, `c122b8d`, `5e58209`, `b24b28f`

### Validation

- `npm --prefix server run typecheck` — passed.
- `npm --prefix server test` — passed, 36 tests.
- `npm --prefix server run test:temporal` — passed, 1 local Temporal integration test covering success, retry, ambiguity, timeout, cancellation, and reconciliation.
- `npm --prefix apps/web run typecheck` — passed; documentation catalog generated 42 documents.
- `npm --prefix apps/web run build` — passed; Vite reported only the existing large-chunk warning.
- `./scripts/run_local_stack.sh all` — started the web app, server, and Temporal worker successfully; `/health` reported Temporal reachable.
- Local API smoke — submitted a Temporal fake-model run through `POST /api/runs`, then inspected it through `GET /api/runs/:runId`; it completed with normalized events, trajectory, metrics, result, and the generic execution reference.
- `git diff --check` — passed.

### Known limitations

- Temporal is the only real registered platform adapter. The Restate adapter is an
  in-memory test fixture used to prove the common service and evidence seam; it is not
  a Restate implementation.
- Platform registration is composed in the server bootstrap. A future platform plan
  must add its adapter and any platform-owned configuration there, while keeping SDK
  types and lifecycle decisions behind the runner port.
- Evidence is still a local filesystem projection. A durable shared evidence store and
  remote deployment are separate work.
- UI compatibility was validated through the web typecheck/build and the running HTTP
  flow; no browser automation suite exists yet.
- Existing schema-v1 `native/temporal.json` files are read through a compatibility path.
  New platform implementations must define their own native evidence schema in their
  platform plan.

### Historical-scope note

This plan establishes the server platform seam at completion time. It does not make
platforms interchangeable: each future plan must document and retain its own execution,
durability, state, retry, cancellation, and native telemetry semantics.
