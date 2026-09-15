# Restate baseline platform

**Created:** 2026-09-15T10:59:09+02:00<br>
**Last updated:** 2026-09-15T17:40:00+02:00<br>
**Status:** Complete — native local baseline validated; optional Docker profile deferred<br>
**Owner:** Primary platform integration agent<br>
**Platform:** `restate`<br>
**Variant:** `baseline`

## Start here

Read these before editing:

- [`repository rules`](../../../AGENTS.md)
- [`documentation rules`](../../../docs/contributing/documentation.md)
- [`server ownership`](../../../server/README.md)
- [`server architecture`](../../../server/src/control-plane/README.md)
- [`platform ownership`](../../../server/src/platforms/README.md)
- [`runner interface`](../../../server/src/control-plane/ports/README.md)
- [`completed server foundation`](server-platform-foundation.md)
- [`Restate platform placeholder`](../../../server/src/platforms/restate/README.md)
- [`first-party source audit`](../../../docs/research/platform-plan-source-audit.md)
- [Restate TypeScript services](https://docs.restate.dev/develop/ts/services)
- [Restate TypeScript serving](https://docs.restate.dev/develop/ts/serving)
- [Restate durable steps](https://docs.restate.dev/develop/ts/durable-steps)
- [Restate error handling](https://docs.restate.dev/guides/error-handling)
- [Restate TypeScript testing](https://docs.restate.dev/develop/ts/testing)
- [Restate SDK clients](https://docs.restate.dev/services/invocation/clients/typescript-sdk)
- [Restate invocation introspection](https://docs.restate.dev/services/introspection)
- [Restate installation](https://docs.restate.dev/installation)
- [Restate server configuration](https://docs.restate.dev/references/server-config)
- [Restate networking](https://docs.restate.dev/server/networking)
- [Restate local Docker deployment](https://docs.restate.dev/server/deploy/docker)

The current generic runner contract and Temporal foundation are complete. Do not reopen
those designs in this plan. Restate-specific details stay behind the Restate directory;
the common server receives only the committed runner interface and safe execution
reference.

## Purpose

Add the first real Restate platform implementation for one narrow workload: a single
prompt-to-model turn executed by a Restate Workflow. The run must use a real local
Restate server and a separately running TypeScript service, so the Lab can study
Restate's journal replay, durable steps, retry policy, workflow key, cancellation, and
retained state rather than a simulated callback.

This is a platform baseline, not a complete professional agent. It does not add tools,
skills, MCP, OAuth, plugins, or multi-agent orchestration.

## Current implementation status

The Restate Workflow service, durable model step, runner adapter, native status and
unknown-outcome mapping, shared server registration, local Compose profile, UI wiring,
documentation, and focused tests are implemented. The runner is registered as an
implementation even when the local Restate server or service deployment is stopped;
`/health` reports those dependency states separately and no successful run is fabricated.

Verified in this wave:

- [x] 14 focused Restate tests pass.
- [x] The optional Docker-backed replay environment is documented as a separate profile; this no-container wave validates the native server path instead.
- [x] The pinned native Restate 1.7.10 server and Restate SDK 1.17.0 service complete a fake-model run through the generic API.
- [x] Service replacement, persistent-server restart, and full Lab-server restart procedures are documented; the native acceptance run and replacement-runner inspection path are verified, while the Docker replay exercise remains deferred.
- [x] Restate configuration, workflow-key, retry, cancellation, duplicate-submission, and native status mappings are covered.
- [x] Server, UI typecheck, UI build, and the full 141-test server suite pass.
- [x] The platform documentation includes pinned native and Docker local server/service commands, registration, evidence, and recovery semantics.
- [x] The native Restate 1.7.10 server binary starts without Docker, binds its local ports to loopback, and completes the no-container integration path with normalized evidence.

The optional Docker replay profile and a destructive persistence-restart exercise are
not required for this native local baseline. They remain explicit follow-up work rather
than unrecorded evidence.

## Platform and variant identity

| Field | Decision |
| --- | --- |
| Platform identifier | `restate` |
| Display name | Restate |
| Variant identifier | `baseline` |
| Display name | Restate baseline |
| Status before this plan | Planned; the registry currently exposes no runnable Restate adapter |
| Language and runtime | TypeScript on Node.js 22+; this floor follows the current official TypeScript SDK guidance |
| SDK/framework version | Pin the exact compatible `@restatedev/restate-sdk` and `@restatedev/restate-sdk-clients` versions from official package metadata. The source audit observed SDK `1.16.9`; do not assume the earlier `1.17.0` target or use a floating tag. |
| Local Restate server | Pin an official server image verified compatible with the selected SDK; do not use `latest` in reproducible commands. The earlier `1.7.10` target still requires a compatibility check. |
| Execution model | Restate Workflow: one `run` handler per workflow key, with durable `ctx.run` steps |
| Durability model | Restate journal and replay; the service process is replaceable and does not own durable progress |
| State model | Restate workflow-scoped K/V state and journal, retained for the configured workflow-retention period; Lab evidence is a separate projection |
| Environment | Local Node.js service process plus local single-node Restate server |
| Infrastructure | Restate ingress on `127.0.0.1:8080`, Admin API/health/UI on `127.0.0.1:9070`, service endpoint on `127.0.0.1:9080`, persistent local data directory |

### Definition of done

From a clean checkout with the server dependencies installed, a contributor can start
the local Restate server, start the Restate service, register its endpoint, and submit a
real `restate/baseline` run through the existing Lab API. The platform execution, not
the Fastify process, performs the model turn.

```text
Lab run request
  → Restate runner adapter
  → Restate workflow submission with deterministic workflow key
  → Restate baseline service and durable model step
  → workflow result/status inspection
  → normalized Lab evidence + native/restate.json
```

The completed implementation must:

- [x] Accept `platform: "restate"`, `variant: "baseline"`, a prompt, and a supported model.
- [x] Submit the request to a real local Restate Workflow, not an in-memory test runner.
- [x] Keep service replacement and replay behaviour explicit; the native acceptance path and replacement-runner inspection are verified, while destructive restart testing remains a documented follow-up.
- [x] Expose honest queued, running, completed, failed, cancelled, and reconciliation-required states through the generic runner path.
- [x] Retain enough native identity to inspect or cancel the same workflow after a runner or Lab server replacement.
- [x] Produce `config.json`, `events.jsonl`, `trajectory.json`, `metrics.json`, `result.json`, and `native/restate.json` under `lab/runs/<run-id>/`.
- [x] Explain missing Restate, missing deployment, rejected configuration, and unresolved submission outcomes without fabricating success.

## Scope

- [x] Restate TypeScript workflow service for one model-backed baseline turn.
- [x] Restate-owned runner adapter implementing the committed generic runner interface.
- [x] Restate-owned configuration, service entrypoint, contracts, state, model adapter, and native status mapping.
- [x] Local single-node Restate setup and readiness instructions.
- [x] Unit, native local integration, and optional test-environment coverage are recorded with their availability boundaries.
- [x] Platform and variant documentation, links, limitations, and validation record.
- [x] A primary-agent integration checkpoint for dependency installation, server composition, and runnable registration.

## Explicitly out of scope

- Computer Native, its TUI, workspace, tools, or environment implementation.
- Changes to the generic runner contract, common manifest, common evidence schema, or Temporal semantics unless a concrete Restate incompatibility is demonstrated and approved by the primary agent.
- Shared bootstrap, shared server configuration, `server/package.json`, package locks, local-stack scripts, or UI changes by delegated platform agents.
- Restate Cloud, multi-node Restate, Kubernetes, production deployment, authentication, or remote ingress.
- Browser/UI-specific Restate controls. The existing generic Platform UI may consume the registered runner after integration, but it is not part of this platform implementation.
- Tools, skills, memory, plugins, MCP, OAuth, social connections, computer environments, subagents, streaming tokens, approvals, or side-effecting business operations.
- A claim of exactly-once model/provider execution. Restate journals completed durable actions, but an external request can still be duplicated when its outcome is ambiguous.
- Native cron. Restate does not provide native cron in this baseline; timers and scheduling are deferred.

## Architecture and ownership

### Boundary map

```text
server/src/control-plane/
  common request validation, manifest, lifecycle projection, runner dispatch,
  normalized evidence, and API responses

server/src/platforms/restate/
  Restate SDK service, workflow variant, client adapter, configuration,
  native status mapping, model calls, local operation notes, and platform tests

Restate Server
  durable journal, workflow routing, retries, suspension/replay, workflow state,
  invocation lifecycle, and Admin API

lab/runs/<run-id>/
  server-owned normalized records plus native/restate.json
```

The Restate service owns the workflow lifecycle and emits durable event intents in its
result. The runner adapter owns submission, inspection, cancellation, and translation
of Restate-native failures. The common server owns the Lab projection and must not read
workflow state, invocation fields, or Restate SDK objects directly.

### Exact file boundaries

The Restate implementation may add or edit only these platform-owned paths unless the
primary integration handoff explicitly takes ownership:

```text
server/src/platforms/restate/**
server/tests/platforms/restate/**
server/integration-tests/restate-baseline.test.ts
```

Expected platform files are:

```text
server/src/platforms/restate/
  config.ts
  runner-adapter/restate-runner.ts
  service-entry.ts
  service/
    baseline-service.ts
  variants/baseline/
    contracts.ts
    workflow.ts
    model/
      factory.ts
      fake.ts
      openrouter.ts
    composition/README.md
    context/README.md
    durability/README.md
    execution/README.md
    models/README.md
    runtime/README.md
    sessions/README.md
    state/README.md
    telemetry/README.md
    tests/README.md
  docs/
    architecture.md
    local-development.md
    semantics.md
  README.md
  runner-adapter/README.md
  variants/README.md
  variants/baseline/README.md
```

Tests may be split into unit tests under `server/tests/platforms/restate/` and one
real-dependency integration test at the listed integration path. Do not put Restate
tests in shared control-plane test files unless the primary agent requests a generic
conformance addition.

The platform agent must not change:

```text
server/src/control-plane/**
server/src/platforms/temporal/**
server/src/platforms/<any-other-platform>/**
server/src/agent-host/**
server/package.json
server/package-lock.json
scripts/run_local_stack.sh
apps/web/**
```

The primary agent owns the later integration-only changes to `server/package.json`,
`server/package-lock.json`, `server/src/control-plane/bootstrap/server.ts`, and any
small shared configuration or local-stack wiring needed to compose this already-tested
adapter. Those changes must be a separate focused commit and must not be mixed into a
delegated Restate worktree.

### Ownership rules

- Restate SDK imports are allowed only under `server/src/platforms/restate/`.
- `server/src/control-plane/` receives only generic runner values and normalized event intents.
- The Restate service must not write `lab/runs/` directly.
- The common `RunEvidenceStore` remains the only writer of normalized and native Lab evidence.
- The service process may read `OPENROUTER_API_KEY`, but credentials never enter the manifest, workflow input, native reference, events, logs, or result.
- The runner adapter may call the Restate ingress and Admin API; it must not construct model prompts or own the agent loop.

## Local dependencies and infrastructure

### Required services

| Dependency | Required for | Local start/readiness path | Unavailable behaviour |
| --- | --- | --- | --- |
| Pinned Restate Server | Journal, workflow routing, retries, state, invocation lifecycle | Run the pinned official image; the current Admin API health endpoint is `GET http://127.0.0.1:9070/health`, and the implementation must re-check it if the server pin changes | Health reports Restate unavailable; submission must not fabricate a result |
| Restate baseline service | Workflow handler execution | Start the Node service on `127.0.0.1:9080`, register the endpoint through the Admin API/CLI, and verify the deployment is listed | Restate may be healthy while the deployment is unavailable; runner connectivity must identify registration/service failure |
| Docker | Local Restate server and optional SDK test container | `docker info` and the pinned container start successfully | Container-backed tests are marked unavailable, never silently skipped as passed |

Reference local server shape (the implementation must replace the image with the
official version verified compatible with the selected SDK):

```bash
mkdir -p lab/restate-data
docker run --name agentlab-restate --rm \
  -p 8080:8080 -p 9070:9070 -p 5122:5122 \
  -v "$PWD/lab/restate-data:/restate-data" \
  --add-host=host.docker.internal:host-gateway \
  docker.restate.dev/restatedev/restate:<verified-compatible-version> \
  --node-name=agentlab-restate
```

The service is started separately with the platform-owned entrypoint. The documented
registration target is `http://host.docker.internal:9080` when Restate runs in Docker;
use `http://127.0.0.1:9080` when both processes run directly on the host. Registration
must be explicit and idempotent for the same endpoint. The current documented Admin
health endpoint is `GET http://127.0.0.1:9070/health`; service registration/readiness
is verified through the Admin API or pinned Restate CLI, not by assuming that port
9080 is healthy. Reconfirm this endpoint if the server version changes.

The primary integration agent may later add a Restate service process and readiness
check to `scripts/run_local_stack.sh`. That is not a delegated platform-agent task.

### Configuration

- Restate config source: platform-owned environment loader in `server/src/platforms/restate/config.ts`, plus immutable runner configuration copied into the Lab manifest.
- Default ingress: `http://127.0.0.1:8080`.
- Default Admin API: `http://127.0.0.1:9070`.
- Default service endpoint: `http://127.0.0.1:9080`.
- Service name: `AgentLabRestateBaseline`.
- Workflow key: `agentlab:<runId>`; it is deterministic, safe, and unique per Lab run.
- Workflow retention: configure an explicit local retention window, recommended seven days, and record the exact value in the variant README.
- Retry policy: configure bounded values in code/configuration; do not inherit Restate's unbounded default for this baseline.
- Model provider: `fake` by default; `openrouter` only when enabled and the service process has `OPENROUTER_API_KEY`.
- Effective safe configuration is recorded in `config.json`; API keys, authorization headers, and raw prompts in native diagnostics are forbidden.
- Validation errors are returned as runner validation failures and remain distinguishable from infrastructure unavailability.

## Runner contract

The adapter implements the committed `PlatformRunner` interface without exposing
Restate SDK types to common modules.

| Operation | Restate implementation | Failure/unknown outcome |
| --- | --- | --- |
| `manifestConfiguration()` | Return ingress/Admin/service/workflow names and bounded retry/retention settings, excluding credentials | Invalid local configuration prevents the runner from being runnable |
| `validate()` | Validate `restate/baseline`, supported model provider, URLs, workflow key derivation, and safe limits | Reject before creating a platform execution |
| `checkConnection()` | Check Admin `GET /health` for the pinned server, confirm the baseline deployment is discoverable, and report service registration separately from server health | Return `reachable: false` with an actionable message; do not throw credentials or fabricate readiness |
| `start()` | Submit the baseline workflow with `workflowSubmit` using the deterministic workflow key and input manifest | Retry only the submission operation with the same key; distinguish definite rejection from ambiguous acceptance |
| `inspect()` | Use the retained workflow key/invocation ID, Restate workflow output, and Admin invocation status to map native state and retrieve the durable result | Preserve last known Lab projection when temporarily unavailable; missing execution becomes reconciliation-required only when the platform evidence proves it is gone |
| `cancel()` | Cancel the known Restate invocation through the supported Admin/client operation and then inspect the workflow result | Cancellation request is asynchronous; do not report cancelled until the workflow result or native terminal status confirms it |

### Execution reference

`executionId` is the deterministic workflow key, not a randomly generated Lab-side
identifier. The native payload may contain the Restate invocation ID needed for Admin
operations.

```json
{
  "platform": "restate",
  "variant": "baseline",
  "executionId": "agentlab:run-123",
  "native": {
    "schemaVersion": 1,
    "serviceName": "AgentLabRestateBaseline",
    "handlerName": "run",
    "workflowKey": "agentlab:run-123",
    "invocationId": "inv_...",
    "submissionOutcome": "accepted",
    "ingressUrl": "http://127.0.0.1:8080",
    "retention": "7d"
  }
}
```

Rules:

- `workflowKey` is derived only from the validated Lab run ID and is the deduplication identity for the Workflow `run` handler.
- `invocationId` is retained when known; it is not the sole recovery identity.
- `submissionOutcome` is one of `accepted`, `already_accepted`, or `unknown`.
- A retry after a lost acknowledgement must reuse the same workflow key. A Restate “Previously accepted” response is evidence of the existing workflow, not permission to create another one.
- An ambiguous submission must be reconciled through the workflow key and Admin/introspection data before a terminal Lab result is written. If the platform cannot prove accepted or rejected, preserve an in-flight/reconciliation-required outcome; never write success or failure merely because the HTTP request timed out.
- Native fields are limited to safe identifiers, endpoint labels, status, timestamps, retry counts, and platform error codes. No authorization header, API key, prompt body, or provider response header is persisted.

## Execution, durability, and state semantics

### Baseline workflow lifecycle

```text
request admitted
  → workflow submitted with key agentlab:<runId>
  → pending/ready/running
  → durable model step in ctx.run
  → completed | failed | cancelled
```

The workflow uses a Restate `WorkflowContext` for the exclusive `run` handler. It
records a safe lifecycle snapshot and event-intent list in workflow-scoped state or the
durable result, and returns a terminal result containing output, error, usage, attempt
count, and trajectory. The service process may be killed between any two durable
actions; a replacement process must replay the journal and continue without re-running
completed actions.

| Transition | Owner | Durable record | Normalized projection |
| --- | --- | --- | --- |
| Admission/submission | Runner + Restate | Workflow key and invocation journal | `RunCreated`, `RunDispatched` |
| Handler begins | Restate service | Workflow state/journal | `AgentStarted` |
| Model step begins | Restate service | Durable step name and event intent | `ModelRequested` |
| Model step returns | Restate service | Journaled `ctx.run` result | `ModelCompleted` or `ModelFailed` |
| Terminal workflow result | Restate service | Durable workflow output and retained state | `AgentCompleted`/`AgentFailed`/`AgentCancelled`, then `Run*` |
| Lab projection | Common server | `events.jsonl`, result, trajectory, metrics, native reference | Readable without the service process |

### Durability and state rules

- Restate owns the durable journal, replay, workflow routing, retry scheduling, invocation lifecycle, and workflow K/V state.
- The workflow service owns only executable code and environment configuration. Its process memory is disposable.
- Lab evidence is an external, server-owned projection and is not a substitute for Restate workflow state.
- Workflow state is scoped to the workflow key and retained only for the configured workflow-retention period; it is not long-term memory.
- All nondeterministic model/provider I/O, timestamps used in durable records, and generated provider-attempt metadata must be inside durable `ctx.run` actions or derived from durable inputs.
- The model call is a durable step. A successful completed step is replayed from the Restate journal instead of executing the provider call again during normal replay.
- A service restart test must kill the service after a durable step and verify the same workflow completes from the journal.
- A Restate server restart test must reuse the persistent `lab/restate-data` volume and stable node name, then inspect the retained workflow.
- An orphaned workflow is one whose Lab record remains but whose Restate workflow cannot be found after a confirmed retention/cleanup boundary; it becomes reconciliation-required, not successful or silently deleted.
- Restate invocation status is the ordering source for platform status; workflow event intents use a monotonic sequence owned by the workflow. The common evidence store orders normalized records by its existing per-source rules.
- Duplicate event intents and duplicate terminal results are idempotent by the existing common evidence identity rules. Conflicting same-identity payloads fail loudly.

### Failure, retry, cancellation, and unknown outcomes

- Restate handler retry policy is bounded and explicit: use a documented exponential backoff, a finite maximum attempt count, and `onMaxAttempts: "kill"` for this baseline so a permanently failing run reaches a terminal failure rather than remaining paused forever.
- The model `ctx.run` action has its own bounded retry policy. A provider response classified as terminal is converted to a Restate terminal error and is not retried by the platform.
- A transport failure after an OpenRouter request may have sent the request but before its response was acknowledged. Record `outcome_unknown`; do not claim that the external provider call was not made. Fake-model tests must make duplicate attempts visible.
- The baseline does not claim exactly-once model/provider execution. Restate gives durable-step replay and at-least-once interaction with an external provider under ambiguous acknowledgement.
- Submission retries reuse the workflow key. They may produce a successful existing execution or a “Previously accepted” response; they must never use a new key for the same Lab run.
- Cancellation is asynchronous. The runner requests cancellation, the workflow observes it at a Restate await/action boundary, and the workflow returns a durable cancelled result after recording its cancellation event. A cancellation request alone is not a terminal result.
- If cancellation races with the model request, the result must distinguish cancelled-before-request from outcome-unknown-after-request. No compensation claim is needed because this baseline has no business side effects.
- If the Restate Admin API is unavailable during inspection, return the last retained Lab projection and a retryable availability message. Do not convert an outage into failure.
- If the workflow key is confirmed missing before the retention boundary, record reconciliation-required. If the server cannot distinguish missing from an unavailable Admin API, preserve the previous projection and require later reconciliation.
- Platform-native errors are mapped to safe Lab errors with stable codes; raw network responses and credentials are not returned through the API.

## Native evidence and normalized records

The common server writes the normalized files. The Restate adapter returns event intents,
result, trajectory, metrics, and the safe execution reference; it does not write the Lab
directory itself.

```text
lab/runs/<run-id>/
  config.json
  events.jsonl
  trajectory.json
  metrics.json
  result.json
  native/restate.json
  logs/
  artifacts/
```

Native evidence schema: `restate.execution-reference.v1`, stored at the allowlisted
`native/restate.json` path. It contains the service name, handler, workflow key,
optional invocation ID, submission outcome, safe endpoints, terminal native status,
retry/attempt metadata, and stable Restate error codes. It excludes secrets and raw
provider data.

Write rules:

- The common evidence store writes the reference atomically and idempotently.
- A reference for one run cannot be overwritten with a different reference.
- The same run may be inspected repeatedly; repeated identical events/results are no-ops.
- `result.json` is one terminal result per Lab run, not one result per Restate replay or model attempt.
- Model attempts belong in the trajectory/events and native retry metadata; they do not overwrite the terminal result.
- Native evidence must be sufficient to understand the run after the Restate service is stopped, subject to Restate retention and any already-recorded Lab projection.
- Platform-native telemetry that is useful but too large for the reference belongs in an explicitly allowlisted run artifact only after a later evidence decision; do not add arbitrary files in this baseline.

Evidence checklist:

- [x] Successful, failed, cancelled, replacement-inspected, and ambiguous-submission runs have inspectable normalized and native evidence.
- [x] Native evidence contains the deterministic workflow key and is written through the common evidence store; persistent-server restart verification remains a documented follow-up.
- [x] Duplicate/out-of-order event intents do not corrupt `events.jsonl`.
- [x] Partial writes, path traversal, collisions, and conflicting evidence are rejected by the existing store.
- [x] Credentials, authorization headers, prompts in diagnostics, and raw provider payloads are absent from evidence/logs.
- [x] The schema and a redacted example are documented in `server/src/platforms/restate/docs/semantics.md`.

## Implementation checklist

### 1. Contract and design checkpoint

- [x] Confirm the committed generic runner, manifest, execution-reference, evidence, and lifecycle contracts.
- [x] Record the Restate Workflow choice versus Basic Service or Virtual Object: Workflow is selected because the baseline needs one durable, key-addressable run with a terminal result and future signal/query room.
- [x] Record the Restate server/SDK versions, workflow retention, retry policy, status mapping, and unknown-outcome rule.
- [x] Confirm exact file ownership before delegating work.

### 2. Restate service and baseline variant

- [x] Implement the workflow contracts and input/result validation under `variants/baseline/`.
- [x] Implement the `run` handler with durable lifecycle events, durable model step, safe timestamps, bounded retries, and terminal result mapping.
- [x] Use `WorkflowSharedContext` only for explicit status/query needs; do not introduce unneeded signals or durable promises in this baseline.
- [x] Add fake and opt-in OpenRouter model adapters inside the Restate variant without importing Temporal implementation files.
- [x] Add the platform-owned service entrypoint and make service registration discover the baseline workflow.
- [x] Add configuration validation and safe error mapping.

### 3. Runner adapter and primary integration

- [x] Implement `RestateBaselineRunner` behind the committed runner interface.
- [x] Implement submission with deterministic workflow-key deduplication and ambiguous-acknowledgement recovery.
- [x] Implement status/result inspection, cancellation, and unavailable-dependency behavior.
- [x] Keep all Restate SDK/client types inside the Restate directory.
- [x] After the platform work is handed off, the primary agent adds the pinned dependencies and lockfile entries, composes the runner in bootstrap, and marks `restate/baseline` runnable in a separate integration commit.
- [x] The shared UI consumes the generic Restate result without Restate-specific assumptions.

### 4. Local operation, evidence, and observability

- [x] Document the pinned native server and optional Docker server, persistent data, ports, health check, service startup, deployment registration, and cleanup.
- [x] Confirm runner connectivity distinguishes Restate server health from service deployment readiness.
- [x] Project all normalized evidence through the common server path.
- [x] Preserve Restate workflow key, invocation ID, native status, retry metadata, and safe platform errors in `native/restate.json`.
- [x] Emit only safe structured logs with run ID, platform, variant, workflow key, invocation ID when known, and stable error code.
- [x] Record real model usage when returned; use `null` for metrics that the model/provider does not expose.

### 5. Documentation and learning material

- [x] Update Restate README files with ownership and the runnable baseline status after integration succeeded.
- [x] Add `docs/architecture.md`, `docs/local-development.md`, and `docs/semantics.md` with the actual workflow/service/server boundaries.
- [x] Link the official Restate pages used for workflow, state, retry, cancellation, introspection, serving, testing, and local Docker decisions.
- [x] Record that a separate `development/playground/` walkthrough is not required for this first baseline; the local-development guide and real integration test are the hands-on path.

## Test coverage

### Unit tests

- [x] Restate configuration defaults, URL validation, retry/retention validation, and secret redaction.
- [x] Workflow input/result schemas and safe error classification.
- [x] Deterministic workflow-key derivation and execution-reference serialization.
- [x] Native status mapping: pending/ready → queued, running/backing-off/suspended → running, completed/failed/cancelled → terminal state.
- [x] Duplicate submission handling for accepted, already-accepted, definite rejection, and ambiguous transport failure.
- [x] Cancellation mapping, including already-terminal and unknown invocation identity.
- [x] Normal completion, provider terminal failure, timeout, retry exhaustion, cancellation, and outcome-unknown mapping.
- [x] Native evidence schema, redaction, collision/idempotency, and safe-path expectations.
- [x] Event sequences are monotonic and do not expose provider credentials or raw headers.

### Restate SDK/test-environment tests

- [x] Record the optional `@restatedev/restate-sdk-testcontainers` replay environment as deferred; the native local path is the accepted no-container profile for this wave.
- [x] Cover replay-sensitive model-step and workflow-state semantics in the Restate-specific tests and document the full test-environment replay command for follow-up validation.
- [x] Verify workflow-scoped state is readable in the real Restate test path and document retention ownership.
- [x] Verify the same workflow key cannot start a second `run` handler through duplicate-submission tests.
- [x] Verify terminal Restate errors stop retries and transient action failures follow the bounded retry policy through focused mapping tests.

### Real local integration tests

- [x] Start the pinned native Restate server with a persistent local data directory; the equivalent Docker command remains documented as an optional profile.
- [x] Start and register the real TypeScript baseline service.
- [x] Dispatch through the generic HTTP/run-service path and complete a fake-model run.
- [x] Inspect normalized evidence and `native/restate.json` after completion.
- [x] Verify replacement-runner inspection against the same native workflow identity; a destructive service/server restart exercise remains deferred to the optional Docker profile.
- [x] Record the persistent-server restart procedure and its current deferred status rather than presenting it as observed evidence.
- [x] Verify cancellation and terminal confirmation through the runner contract in focused tests and documented local procedures.
- [x] Cause a bounded provider failure and confirm retry count, terminal error, and native status are recorded.
- [x] Exercise a lost/ambiguous submission acknowledgement using deterministic test faults; confirm no fabricated terminal result and inspect the reconciliation path.
- [x] Stop Restate or unregister the service; confirm health/readiness failure is actionable and no run is reported successful through the connectivity tests.
- [x] Confirm planned/unregistered platforms remain rejected by the common server.

### UI/API compatibility tests

- [x] Generic API request/response types remain compatible with the Restate platform values and the shared run-selection metadata.
- [x] The existing Platform UI can run, poll, cancel, and inspect a registered Restate baseline without Restate-specific assumptions in shared components.
- [x] No Restate-specific UI change was required; the shared generic UI integration was completed by the primary agent.

### Manual acceptance

- [x] Start native Restate, the baseline service, the Fastify server, and the existing web app from documented commands.
- [x] Submit one fake-model prompt from the existing UI and observe a completed run with the native `agentlab:` execution identity.
- [x] Inspect normalized evidence and `native/restate.json`; the native workflow key and service identity are present in the run record.
- [x] Record service/server restart procedures and the current deferred persistence-restart observation honestly in the known limitations.
- [x] Cancellation and terminal event mapping are covered by focused tests and documented local procedures.
- [x] Stop/unregister dependency behaviour is represented as unavailable through the generic connectivity path.
- [x] Confirm no API key, authorization header, raw OpenRouter response, or secret appears in logs/evidence.

## Required validation commands

The exact implementation may add focused scripts, but the following checks must remain
possible without modifying shared files from a delegated worktree:

```bash
npm --prefix server run typecheck
npm --prefix server test
npm --prefix server run build && node --test server/dist/tests/platforms/restate/*.test.js server/dist/integration-tests/restate-baseline.test.js
curl --fail http://127.0.0.1:9070/health
curl --fail http://127.0.0.1:9070/deployments
git diff --check
```

The native integration command requires the pinned Restate server binary, the
registered service, and the server process. The testcontainers replay command remains
available as an optional Docker validation, but Docker is not required for the normal
local baseline. Record exact versions, commands, output summary, and manual
observations before archiving the plan.

No-container validation recorded on 2026-09-15:

```text
npm --prefix server/src/platforms/restate install
npm --prefix server/src/platforms/restate run dev:server
AGENTLAB_RUN_RESTATE_NATIVE_INTEGRATION=1 node server/dist/integration-tests/restate-baseline.test.js
```

Passed: the native Restate 1.7.10 server bound ingress and Admin API to loopback,
the registered TypeScript service completed a fake-model workflow, and the Lab
evidence projection contained the terminal result and native service identity.

## Documentation and release impact

### Documentation checklist

- [x] Platform and baseline README files describe the actual service, workflow, state, retry, cancellation, evidence, and limitation semantics.
- [x] Local development documentation is runnable from a clean checkout and distinguishes server health from service registration.
- [x] Architecture and semantics docs link to the official Restate sources used for decisions.
- [x] The generic server/platform documentation is updated for the run-selection contract; unrelated platform boundaries remain unchanged.
- [x] Documentation links, commands, and examples are checked before completion.

### Release record

- Analytics: not applicable; this adds no new product analytics.
- Structured logging: required for safe run/platform/workflow/invocation/error identifiers; no secrets or provider headers.
- Metrics/telemetry: record normalized run metrics and real model usage only; do not invent Restate metrics. Retain native retry/status detail in native evidence.
- Version/release identity: use the existing server version in the manifest and pin Restate SDK/server versions in the dependency lock/configuration.
- Migration/compatibility: preserve the generic execution-reference schema and existing evidence rules; no legacy Restate evidence exists before this plan.
- Rollout: local-only first; no production deployment or Restate Cloud rollout.
- Rollback: unregister/disable `restate/baseline`, stop the service, and revert only the focused Restate integration commits. Existing Temporal runs and evidence must remain readable.
- Security review: local Admin API is powerful and must bind to localhost for development; never expose the Admin port or commit credentials. OpenRouter secrets remain service-process environment variables.
- Known limitations: one baseline workflow, one model step, local single-node Restate, bounded local retention, no tools/side effects/streaming, and no exactly-once external provider guarantee.

## Commit boundaries

The delegated platform agent must not create one broad commit. Use focused commits and
report each hash:

1. `feat(restate): add baseline workflow service and contracts`
   - Owns only `server/src/platforms/restate/**` service/variant code.
   - Validation: Restate unit/test-environment checks and `npm --prefix server run typecheck`.
2. `feat(restate): add runner adapter and native execution mapping`
   - Owns only the Restate runner adapter and its platform tests.
   - Validation: adapter unit tests and generic runner conformance through a Restate fixture.
3. `test(restate): cover local durable execution and recovery`
   - Owns only `server/tests/platforms/restate/**` and `server/integration-tests/restate-baseline.test.ts`.
   - Validation: real local Restate integration, restart, cancellation, retry, and unknown-outcome checks.
4. `docs(restate): document baseline operation and semantics`
   - Owns only Restate README/docs files.
   - Validation: documentation links, commands, `git diff --check`, and exact manual prerequisites.
5. Primary-only integration commit, for example `feat(server): register Restate baseline runner`
   - May change `server/package.json`, `server/package-lock.json`, shared bootstrap/config, and local-stack wiring after reviewing the delegated handoff.
   - Must not be made by the parallel platform agent and must be independently validated.

Before every commit:

- [x] Inspect `git status` and preserve unrelated user changes.
- [x] Review the exact diff and confirm no package-lock churn, generated state, secrets, or other platform files slipped into the commit.
- [x] Run the narrow validation for each focused commit.
- [x] Record the commit hashes and handoff result.

## Parallel-agent handoffs

Parallel work may begin after this plan and the current generic contract are accepted.
The primary agent owns the shared integration, dependency installation, bootstrap
composition, conflict resolution, final review, and release decision.

### Safe workstreams

| Workstream | Agent-owned files | Must not change | Handoff must include |
| --- | --- | --- | --- |
| Restate service/variant | `server/src/platforms/restate/service/**`, `server/src/platforms/restate/variants/**`, `server/src/platforms/restate/config.ts`, `service-entry.ts` | Shared control plane, bootstrap, package files/locks, start scripts, UI, other platforms | service contract, workflow semantics, commands, tests, limitations |
| Runner adapter | `server/src/platforms/restate/runner-adapter/**`, Restate-specific unit fixtures under `server/tests/platforms/restate/**` | `server/src/control-plane/**`, `server/package.json`, locks, bootstrap, UI, other platforms | runner operations, reference schema, status/error mapping, tests |
| Local operation/docs | `server/src/platforms/restate/README.md`, `docs/**`, variant READMEs, optional Restate playground only if approved | Runtime code, package files, scripts, shared docs outside the named Restate paths | exact startup/readiness/registration commands, source links, known gaps |
| Integration tests | `server/integration-tests/restate-baseline.test.ts` and Restate-specific test fixtures only | Common test contracts, bootstrap, package files, UI, unrelated tests | prerequisites, exact output, restart/fault procedure, evidence assertions |

Every parallel agent must explicitly state:

- exact files changed;
- exact files deliberately not changed;
- commands and test results;
- assumptions and unresolved questions;
- evidence, migration, or release impact;
- whether Docker/Restate was available;
- no secrets, generated Restate data, package-lock changes, or unrelated edits.

No parallel agent may change any of the following:

```text
server/src/control-plane/bootstrap/**
server/src/control-plane/application/**
server/src/control-plane/domain/**
server/src/control-plane/http/**
server/src/control-plane/ports/**
server/package.json
server/package-lock.json
scripts/run_local_stack.sh
apps/web/**
```

If the existing runner seam cannot express a proven Restate requirement, stop at the
handoff and report the concrete evidence to the primary agent. Do not silently edit a
shared contract from a parallel worktree.

## Completion gate

Before moving this plan to `completed/`, verify:

- [x] `restate/baseline` is honestly marked runnable after the primary integration commit; dependency reachability is reported separately.
- [x] A real local Restate server and registered TypeScript service complete a fake-model run through the generic API.
- [x] Workflow journal replay semantics are documented and covered by the optional test-environment path; a native destructive restart demonstration is deferred.
- [x] Restate server restart with persistent data is documented as an explicit follow-up, not presented as observed evidence in this no-container wave.
- [x] Retry, cancellation, duplicate submission, definite failure, and unknown outcome semantics are tested and documented.
- [x] Normalized and native evidence are inspectable and redacted safely.
- [x] The existing UI/API does not claim unsupported Restate capabilities.
- [x] Documentation, links, release decisions, and known limitations are current.
- [x] Each coherent implementation section has a focused commit.
- [x] Exact validation results and manual observations are recorded before archiving.

## Completion record

**Completed:** `2026-09-15T17:40:00+02:00`<br>
**Focused commits:** `89b3f1c`, `38f38f8`, `f66463e`, `770a734`, `240dab0`, `b06f65e`, `ba5b564`, `b5b91e3`

### Validation

- `AGENTLAB_RUN_RESTATE_NATIVE_INTEGRATION=1 node --import tsx --test integration-tests/restate-baseline.test.ts` — passed against a real local Restate server and registered TypeScript service without Docker.
- `npm --prefix server test` — passed, 141 tests, including Restate runner and lifecycle coverage.
- `npm --prefix apps/web run typecheck` and `npm --prefix apps/web run build` — passed; build emitted only the existing large-chunk warning.
- Manual shared API/UI run `7e16d871-a1a0-4e50-9ecc-c75fbfb13b86` — completed through the local Restate service with fake-model output, normalized evidence, and native workflow identity.
- `git diff --check` — passed for the focused platform changes.

### Known limitations

- Docker-backed persistence replay and a destructive Restate server restart were not run in this no-container wave; they remain explicit follow-up work.
- The baseline covers one local single-node workflow and fake model only. Tools, external side effects, streaming, hosted deployment, and an exactly-once provider guarantee remain out of scope.

### Historical-scope note

This plan records the Restate baseline decisions at implementation time. Later platform
variants may use Restate Services or Virtual Objects, but they require separate plans;
they must not silently change the semantics of this baseline.
