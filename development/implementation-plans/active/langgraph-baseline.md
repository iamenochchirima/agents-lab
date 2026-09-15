# LangGraph baseline platform

**Created:** 2026-09-15T10:59:22+02:00<br>
**Last updated:** 2026-09-15T14:19:00+02:00<br>
**Status:** Active — implementation integrated; archival validation pending<br>
**Owner:** LangGraph platform implementation owner<br>
**Platform:** langgraph<br>
**Variant:** baseline

## Start here

Read these before changing code:

- [repository rules](../../../AGENTS.md)
- [documentation guide](../../../docs/contributing/documentation.md)
- [server ownership](../../../server/README.md)
- [server architecture](../../../server/src/control-plane/README.md)
- [platform ownership](../../../server/src/platforms/README.md)
- [runner interface](../../../server/src/control-plane/ports/README.md)
- [completed server foundation](../completed/server-platform-foundation.md)
- [language boundary decision](../../../docs/adr/0002-language-boundary.md)
- [LangGraph application structure](https://docs.langchain.com/oss/python/langgraph/application-structure)
- [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [LangGraph streaming](https://docs.langchain.com/oss/python/langgraph/streaming)
- [LangGraph fault tolerance](https://docs.langchain.com/oss/python/langgraph/fault-tolerance)
- [LangGraph local server guidance](https://docs.langchain.com/oss/python/langgraph/local-server)
- [first-party source audit](../../../docs/research/platform-plan-source-audit.md)

The generic TypeScript runner contract and the Temporal foundation are complete.
This plan implements the LangGraph adapter behind those seams. Do not redesign
the common runner contract, import Python SDK types into TypeScript, or turn
LangGraph checkpointing into a claim of Temporal-style durable execution.

## Purpose

Add the first runnable LangGraph platform variant. The Lab server remains the
TypeScript owner of requests, run manifests, lifecycle projection, and normalized
evidence. A Python service owns the LangGraph graph, model call, checkpoint store,
and platform-native execution state. A TypeScript adapter calls that service and
maps its wire responses to the generic runner interface.

This is a platform baseline, not a complete agent product. It should make one real
prompt run inspectable end to end and make the differences between graph
checkpointing and Temporal workflows visible.

## Current implementation status

The Python service, SQLite-backed baseline graph, TypeScript runner adapter, shared
server registration, Platform UI wiring, documentation, and focused tests are now
implemented. The baseline is registered as a runnable implementation even when its
Python service is stopped; `/health` reports that runtime dependency as unavailable,
while `/ready` reports only Fastify process readiness.

Verified in this wave:

- [x] 20 Python service tests pass with Python 3.12.3, LangGraph 1.2.10, and SQLite support.
- [x] 9 TypeScript adapter tests pass.
- [x] A process-level LangGraph integration test passes, including cancellation, service restart, and reconciliation.
- [x] A real LangGraph run completes through the generic Fastify API and writes the complete Lab evidence set.
- [x] Server, UI typecheck, UI build, and the full 64-test server suite pass.
- [x] The locked Python service tests (20 tests) and process-level integration pass without Docker using Python 3.11 with the sqlite3 module enabled.

Remaining before archival:

- [ ] Re-run the documented clean-checkout flow with a freshly provisioned environment rather than the current temporary validation environment.
- [ ] Record the manual UI run and final plan commit hashes in the completion record.

## Platform and variant identity

| Field | Decision |
| --- | --- |
| Platform identifier | langgraph |
| Display name | LangGraph |
| Variant identifier | baseline |
| Display name | LangGraph baseline |
| Status before this plan | Planned |
| Language and runtime | Python 3.11+ for the platform service, pinned to the repository-supported minor version; TypeScript/Node for the Lab adapter |
| SDK/framework version | Pin `langgraph==1.2.10` from the reviewed source state plus compatible checkpoint packages and the local CLI in the Python lockfile; record exact resolved versions in native run metadata |
| Execution model | A Python StateGraph with a small baseline graph invoked through a platform-owned HTTP service |
| Durability model | Application-managed LangGraph checkpoints in SQLite; no external durable scheduler in this variant. SQLite is a local-development/small-project profile, not production persistence or LangSmith Deployment. |
| State model | Per-run LangGraph thread state, checkpoint history, and pending writes; the Lab keeps a separate normalized projection |
| Environment | Local Python process, local SQLite state, and optional OpenRouter access |
| Infrastructure | Python environment, FastAPI/ASGI service, SQLite file, and existing TypeScript Lab server |

### Definition of done

From a clean checkout, a contributor can start the Python service and Lab server,
submit a langgraph/baseline prompt through the existing API or Platform UI, and
inspect the real result and checkpoint-related events. The Python service is not
a fake HTTP responder and does not write the Lab's normalized run files.

~~~
run request
  -> TypeScript Lab server
  -> LangGraph runner adapter
  -> Python LangGraph service
  -> baseline StateGraph + model node
  -> SQLite checkpoint/state
  -> adapter mapping
  -> normalized Lab evidence + native execution reference
~~~

The completed implementation must be able to:

- [ ] accept a prompt using the existing generic run request;
- [ ] start one real baseline graph execution through the Python service;
- [ ] support the existing fake model provider and a configured openrouter provider;
- [ ] poll status, return terminal output, and request cancellation through the generic runner;
- [ ] expose checkpoint/thread identity and graph-step information in safe events or native metadata;
- [ ] preserve state in SQLite across a service process restart where LangGraph has written a checkpoint;
- [ ] report an in-flight or interrupted execution as unknown/reconciliation-required when its external outcome cannot be established;
- [ ] write config.json, events.jsonl, trajectory.json, metrics.json, result.json, and native/langgraph.json through the Lab evidence path;
- [ ] explain an unavailable Python service without fabricating a successful run.

## Scope

- [ ] Python service with a versioned HTTP wire protocol.
- [ ] Baseline StateGraph, state schema, model node, streaming/event collection, and SQLite checkpointer.
- [ ] TypeScript runner adapter and platform-specific execution reference.
- [ ] Local start/readiness commands and a platform deployment profile.
- [ ] Unit, service, cross-language, server integration, failure, cancellation, and restart tests.
- [ ] Platform documentation and one focused development playground walkthrough.
- [ ] Registration of langgraph/baseline as runnable, owned by the primary integration agent.

## Explicitly out of scope

- LangGraph Platform or LangSmith hosted deployment.
- langgraph dev as the Lab runtime. It is a reference for the official local workflow, not this service boundary.
- Postgres checkpointers, multi-process workers, autoscaling, authentication, or remote deployment.
- Human approval, interrupt resume UX, subgraphs, supervisor graphs, parallel tool branches, long-term stores, or time travel UI.
- MCP, OAuth, plugins, social connections, computer-native tools, browser automation, or a general tool registry.
- A second LangGraph language variant. Python is the native baseline.
- Changes to Temporal behaviour or the common runner contract.
- A new platform-specific UI. The existing generic Platform UI may be made honest by the primary integration agent, but this plan does not redesign it.

Do not add controls for features listed above. The UI and API must report the
Python service's reachability honestly; registration of the implemented adapter does
not imply that its external service is currently running.

## Architecture and ownership

### Boundary map

~~~
server/src/control-plane/
  generic requests, manifests, lifecycle, runner dispatch, and normalized evidence

server/src/platforms/langgraph/runner-adapter/
  TypeScript HTTP client, wire validation, execution-reference mapping, and runner adapter

server/src/platforms/langgraph/service/
  Python HTTP service, run registry, LangGraph invocation, checkpoint access, and native state

server/src/platforms/langgraph/variants/baseline/
  Python graph definition, state schema, model node, and baseline graph configuration

server/deployments/platforms/langgraph/
  Local service profile, state path, ports, readiness, and reset instructions

lab/runs/<run-id>/
  server-owned normalized records and native/langgraph.json execution reference
~~~

The Python service owns graph execution and platform state. The TypeScript adapter
owns only the HTTP client and translation to PlatformRunner. The common server
never reads a LangGraph checkpoint directly.

### Cross-language interface

Freeze a platform-local protocol before parallel implementation starts. Keep the
wire schema in server/src/platforms/langgraph/protocol/ and validate both sides
against it. The JSON protocol, not generated TypeScript types or Python models,
is the compatibility source for this seam.

Required operations:

| HTTP operation | Purpose | Important fields |
| --- | --- | --- |
| GET /health | Process and dependency readiness | protocol version, service version, LangGraph version, checkpoint path status |
| POST /v1/runs | Idempotently admit a graph execution | Lab run ID, prompt, system instruction, model, graph name, thread ID, durability |
| GET /v1/runs/:executionId | Inspect execution and platform events | status, run ID, thread ID, checkpoint summary, event sequence, result, trajectory, metrics |
| POST /v1/runs/:executionId/cancel | Request cooperative cancellation | reason, accepted, already-terminal, message |

The start request must not contain an API key or raw provider headers. The Python
service reads OPENROUTER_API_KEY from its own environment. The stable execution
identity is langgraph:<runId>, and LangGraph thread_id is the Lab run ID.
Starting the same run ID with a different prompt or model is a conflict. Repeating
the same start request returns the existing execution record instead of starting a
second graph.

The protocol must define JSON-safe representations for:

- queued, running, completed, failed, cancelled, and unknown platform states;
- ordered event records with a platform source sequence;
- model usage and error fields;
- checkpoint ID, thread ID, graph name, superstep, and pending-write summary;
- retry attempt and node name without serializing arbitrary Python objects;
- redaction rules for prompts, provider responses, headers, and credentials.

### Files allowed to change

| Workstream | Agent-owned files/directories | Must not change | Handoff must include |
| --- | --- | --- | --- |
| Protocol checkpoint and final integration | server/src/platforms/langgraph/protocol/, shared bootstrap/config/registry and root launcher only when required | Other platform directories and Computer Native | Frozen wire schema, registration diff, exact validation, conflicts resolved |
| Python LangGraph service | server/src/platforms/langgraph/service/, variants/baseline/, Python metadata | TypeScript control-plane files, Temporal, shared launcher, normalized Lab evidence | Endpoints, graph semantics, state rules, Python tests, versions, limits |
| TypeScript runner adapter | server/src/platforms/langgraph/runner-adapter/ and local protocol client files | Common runner types, bootstrap, registry, other platforms | Runner operations, mappings, adapter tests, registration hook |
| Local infrastructure | server/deployments/platforms/langgraph/ and a new LangGraph-specific scripts helper if needed | scripts/run_local_stack.sh, server config, other profiles | Start/readiness/reset commands, ports, state path, unavailable behaviour |
| TypeScript and cross-language tests | server/tests/platforms/langgraph/, server/integration-tests/langgraph-baseline.test.ts, test-only protocol fixtures | Production code, common contracts, Python service implementation | Cases, commands, fixture assumptions, process cleanup |
| Documentation and playground | LangGraph README/docs, deployment README, development/playground/langgraph-baseline.md | Runtime code and shared UI | Links checked, commands, semantics, limitations, observations |

The primary integration agent alone may edit shared bootstrap, registry, package
scripts, root launcher, or Platform UI catalog files. Platform agents must not
make drive-by edits to those files. This is what lets LangGraph, Restate, Mastra,
and future platform agents work in separate worktrees without repeatedly editing
the same shared files.

## Local dependencies and infrastructure

### Required services

| Dependency | Required for | Local start command | Readiness check | Unavailable behaviour |
| --- | --- | --- | --- | --- |
| Python 3.11+ environment | Every LangGraph run | uv sync or the documented equivalent from the platform directory | python --version and dependency import check | Setup error before registration; no run is fabricated |
| LangGraph Python service | Start, inspect, and cancel | uv run uvicorn ... --host 127.0.0.1 --port 2024 | curl -fsS http://127.0.0.1:2024/health | Runner reports unavailable; the Lab preserves its last durable projection |
| SQLite checkpoint/state file | Checkpoints and service run records | Created under the configured local state directory | Service health verifies the directory is writable | Service is not ready; no in-memory fallback |
| TypeScript Lab server | Generic API, dispatch, and evidence | Existing Lab server command | Existing /health reports LangGraph connectivity | LangGraph runs cannot be submitted through the Lab |
| OpenRouter | Only model.provider=openrouter | No local process; OPENROUTER_API_KEY | A real model call, never a key echo | Provider failure is recorded according to the call outcome |

The baseline uses SQLite, not an external database. The service must create its
state directory explicitly, use a configured absolute path, and refuse to silently
fall back to in-memory state. The state directory is generated local state and
must not be committed. The default service bind is loopback only.

The local launcher integration is a separate primary-agent step because the root
launcher is shared. The platform deployment profile must still work independently
from a clean checkout and document how to start, stop, reset, and inspect the
Python service.

### Configuration

- Python configuration: environment variables and the platform service config module.
- TypeScript configuration: AGENTLAB_LANGGRAPH_SERVICE_URL and the existing server profile.
- Default service URL: http://127.0.0.1:2024.
- State directory: AGENTLAB_LANGGRAPH_STATE_DIR, defaulting to an ignored local directory under the server workspace.
- Checkpoint durability: request sync for the baseline and record the effective mode.
- Model providers: fake is deterministic; openrouter requires the Python service environment key.
- Safe manifest values: service URL, graph name, protocol version, durability mode, and non-secret runtime settings.
- Redacted values: API keys, authorization headers, raw provider headers, and secret environment values.
- Resource limits: request timeout, maximum prompt size, maximum graph steps, and bounded model retries.
- Local-only security: bind to loopback and reject or document non-loopback access until authentication exists.

## Runner contract

The TypeScript adapter implements PlatformRunner without exposing Python, FastAPI,
LangGraph, or checkpoint SDK types to common modules.

| Operation | Platform implementation | Inputs | Output | Failure/unknown outcome |
| --- | --- | --- | --- | --- |
| manifestConfiguration | Adapter config | service URL, protocol, graph, durability, limits | safe immutable config | invalid config prevents registration |
| validate | Adapter-side schema and service validation | generic manifest | valid/reason | unsupported model, graph, or limits rejected before start |
| checkConnection | GET /health | service URL | reachable/message | timeout or malformed health is unavailable |
| start | POST /v1/runs | immutable manifest mapped to wire request | generic execution reference | same run reconciles; conflicting duplicate fails dispatch |
| inspect | GET /v1/runs/:executionId | opaque reference | generic inspection/events/result | outage preserves last Lab projection; unknown becomes reconciliation-required |
| cancel | POST /v1/runs/:executionId/cancel | opaque reference and reason | accepted/already-terminal/message | cancellation is not claimed when it cannot be established |

### Execution reference

The stable reference written to native/langgraph.json is small and safe:

~~~
{
  "platform": "langgraph",
  "variant": "baseline",
  "executionId": "langgraph:<run-id>",
  "native": {
    "protocolVersion": 1,
    "graph": "baseline",
    "threadId": "<run-id>",
    "serviceOrigin": "http://127.0.0.1:2024"
  }
}
~~~

- runId and threadId are one-to-one; independent runs never share a thread.
- Repeating start is safe only when the run ID and request fingerprint match.
- Cancellation addresses the service execution ID, which resolves to the persisted thread record.
- Checkpoint IDs are observed in events and inspection, not interpreted by the common server.
- No API key, authorization value, raw prompt copy, provider header, or arbitrary Python state enters the reference.
- A missing or malformed reference is a reconciliation error, not a new execution.

## Execution, durability, and state semantics

### Baseline graph

The first graph is intentionally small:

~~~
input state -> model node -> final response state -> END
~~~

The state schema must be JSON-safe and include only prompt, response, model
identity, node/attempt metadata, and safe usage fields. The model call belongs
inside a graph node. The service must not put model calls or side effects in
graph-construction code.

Use LangGraph sync checkpoint durability for the baseline. Capture streamed
updates, messages, tasks, and checkpoints where the pinned version supports them,
then map them to platform events. Lab events are a projection, not a replacement
for LangGraph's checkpoint store.

### Lifecycle

~~~
received -> validated -> queued -> running -> completed
                                      \-> failed
                                      \-> cancelled
                                      \-> unknown/reconciliation-required
~~~

| Transition | Owner | Persisted before/after | Normalized event | Native detail |
| --- | --- | --- | --- | --- |
| Request accepted | TypeScript server and Python service | Lab manifest, then service run record | RunCreated, RunDispatched | execution ID, thread ID |
| Graph starts | Python service | service status and first checkpoint when available | PlatformExecutionStarted | graph, node, checkpoint |
| Node/model work | LangGraph service | checkpoint/pending writes according to sync | GraphStepStarted, ModelRequested, ModelResponse, CheckpointWritten | node, attempt, checkpoint ID |
| Terminal result | Python service, then Lab server | service terminal record, then normalized result/trajectory/metrics | RunCompleted, RunFailed, RunCancelled | final checkpoint and native error |
| Service restart during work | service and adapter | prior checkpoint may exist, terminal outcome may not | RunReconciliationRequired | last known checkpoint and unknown reason |

### Durability and state

- LangGraph owns thread checkpoints, checkpoint history, pending writes, and serialized graph state in SQLite.
- The Python service owns its run registry, execution status, cancellation request, and safe platform event log.
- The Lab server owns the immutable manifest and normalized evidence files.
- The TypeScript adapter owns no graph state and must not recreate a checkpoint from events.
- A checkpoint is not proof that an external model call did not happen. A node can be re-executed after a crash or interruption.
- This baseline does not promise automatic resumption of in-flight execution after the Python service dies. A persisted checkpoint remains inspectable; an execution without a known terminal record becomes unknown until a future recovery variant defines resume behaviour.
- On service startup, queued/running records from an earlier process must be marked unknown or recovery-required, not silently reported as running.
- Event source sequence comes from the Python service's persisted event log. The TypeScript server assigns recorded sequence while preserving source sequence.
- Repeated inspection is idempotent. Duplicate event delivery is accepted only when identity and content match. Conflicting content is an evidence error.
- State retention and cleanup are local-only and documented. No automatic deletion occurs in this baseline.

### Failure, retry, cancellation, and side effects

- [ ] Model-node retries use an explicit bounded policy. The first baseline retries only deterministic transient test failures and configured provider transport failures.
- [ ] Every model attempt carries run ID, graph node, and attempt number in platform events.
- [ ] A model request may be duplicated after a crash or node retry. Evidence shows attempt count; the implementation must not call this exactly once.
- [ ] Fake-model failures use deterministic fixtures. OpenRouter failures are classified from provider results without logging credentials or raw authorization headers.
- [ ] A timeout before the service receives a model response is unknown unless the service has a durable terminal record.
- [ ] Cancellation is cooperative. An active in-process task may be cancelled and recorded; cancellation after service loss is not confirmed.
- [ ] Cancellation racing with a terminal checkpoint resolves to the persisted terminal result, not a fabricated cancellation.
- [ ] There are no external side effects in the baseline graph. Future tool/API nodes must run inside explicit idempotent tasks with a separate side-effect key.
- [ ] Unknown, orphaned, duplicate, and out-of-order service events are tested and become reconciliation-required or evidence conflicts as appropriate.
- [ ] The platform claims checkpoint durability and resumable state inspection only. It does not claim durable scheduling, automatic worker recovery, exactly-once model calls, or exactly-once side effects.

## Native evidence and normalized records

The TypeScript Lab server is the sole writer for normalized run evidence. The
Python service owns its SQLite state and returns safe native details through the
wire protocol. The generic foundation currently persists the execution reference
at native/langgraph.json. Checkpoint details belong in ordered event payloads and
the service's own inspectable state until a later evidence contract adds a richer
native snapshot operation.

~~~
lab/runs/<run-id>/
  config.json
  events.jsonl
  trajectory.json
  metrics.json
  result.json
  native/langgraph.json
  logs/
  artifacts/
~~~

Define before implementation:

- Native protocol/evidence version: 1, tied to the platform wire schema.
- Native reference writer: the existing common RunEvidenceStore through RunService.
- Native state writer: the Python service's SQLite checkpointer and run registry, never lab/runs/.
- Event write timing: the adapter appends ordered service events during inspection; duplicate content is idempotent.
- Result cardinality: one terminal result.json per Lab run. Repeated inspection must not overwrite it with different content.
- Trajectory: graph phases and node/attempt timing projected into the common trajectory schema.
- Metrics: model call count, attempt count, duration, usage when supplied, and checkpoint/step counts where the common shape permits.
- Redaction: API keys, authorization headers, raw provider metadata, and arbitrary checkpoint values are excluded from events, logs, and native reference files.
- Compatibility: no existing LangGraph evidence exists in the Lab. Add schema versioning from the first file and reject incompatible protocol versions clearly.

Evidence checklist:

- [ ] A run can be inspected after the Python service exits if a terminal service record and checkpoint exist.
- [ ] Normalized events preserve source sequence, graph node, attempt, checkpoint identity, and terminal meaning.
- [ ] Native reference preserves the safe execution/thread identity needed for later inspection.
- [ ] Writes handle duplicate starts, duplicate events, partial service responses, and path traversal safely.
- [ ] Secrets and arbitrary serialized Python objects never enter Lab evidence.
- [ ] The evidence layout and one real example are documented.

## Implementation checklist

### 1. Protocol and integration checkpoint

- [ ] Freeze the LangGraph wire schema and protocol version under the platform directory.
- [ ] Record request fingerprints, idempotency, status, event, error, checkpoint, and redaction rules.
- [ ] Confirm no common server contract change is needed.
- [ ] Assign shared bootstrap, registry, launcher, and package-script changes to the primary integration agent only.
- [ ] Create the runnable registration only when the adapter and service readiness checks exist.

### 2. Python service and baseline graph

- [ ] Add pinned Python dependency metadata and a reproducible environment.
- [ ] Implement health, start, inspect, and cancel endpoints with strict JSON validation.
- [ ] Implement persisted run records and stable execution IDs.
- [ ] Build the small StateGraph with JSON-safe state and one model node.
- [ ] Implement deterministic fake-model behaviour and OpenRouter configuration without forwarding secrets.
- [ ] Configure SQLite checkpointing with explicit sync durability and no silent in-memory fallback.
- [ ] Collect graph events and checkpoint summaries without serializing arbitrary Python objects.
- [ ] Implement startup handling for queued/running records and explicit unknown outcomes.

### 3. TypeScript adapter

- [ ] Implement the LangGraph-local HTTP client and response validation.
- [ ] Implement manifestConfiguration, validate, checkConnection, start, inspect, and cancel.
- [ ] Map service statuses and errors to the generic runner without importing Python/LangGraph types.
- [ ] Map source events to RunEventIntent with stable source sequencing.
- [ ] Preserve unknown outcomes as reconciliation-required rather than failed success or fabricated output.
- [ ] Register the adapter through the primary integration handoff.

### 4. Local operation and evidence

- [ ] Add the platform deployment profile, service command, readiness check, reset command, and state-path explanation.
- [ ] Add the primary integration to the local stack only after the platform-specific command works independently.
- [ ] Verify native reference and normalized evidence are written by the Lab server.
- [ ] Verify the Python service never writes lab/runs/.

### 5. Documentation and playground

- [ ] Document the Python/TypeScript seam, graph ownership, checkpoint semantics, and local setup.
- [ ] Document failure, retry, cancellation, restart, unknown-outcome, and non-guarantee rules.
- [ ] Link official LangGraph application, persistence, streaming, fault-tolerance, and local-server references.
- [ ] Add a short development/playground/ walkthrough showing one prompt, one checkpoint, one event, and one restart observation.
- [ ] Record exact package/runtime versions and known limitations before archiving this plan.

## Test coverage

### Python service tests

- [ ] Protocol validation rejects missing IDs, invalid model/provider values, oversized input, forbidden fields, and incompatible versions.
- [ ] The baseline graph completes with the fake model and produces JSON-safe state.
- [ ] Fake-model failure produces deterministic retry and terminal failure records.
- [ ] OpenRouter configuration uses environment secrets and never returns them.
- [ ] Checkpoint writes survive a process-independent reopen of the SQLite state.
- [ ] Repeated start with the same request is idempotent and conflicting reuse is rejected.
- [ ] Cancellation before, during, and after graph execution reports the real accepted/already-terminal state.
- [ ] Service restart marks unfinished records unknown/recovery-required instead of claiming they are running.
- [ ] Duplicate/out-of-order internal events are rejected or deduplicated by identity.
- [ ] Serialized state rejects unsafe or non-JSON values at the protocol seam.

### TypeScript adapter and server tests

- [ ] Adapter validation and manifest configuration are platform-owned.
- [ ] Health, start, inspect, and cancel wire responses map to the generic runner contract.
- [ ] Lost start acknowledgement reconciles by stable run ID without a second graph.
- [ ] Service unavailable, malformed responses, timeouts, and incompatible protocol versions are explicit failures.
- [ ] Platform unknown maps to reconciliation-required with outcome_unknown, without fabricated output.
- [ ] Event source sequence and duplicate event content remain safe through RunEvidenceStore.
- [ ] native/langgraph.json contains only the safe execution reference.
- [ ] No Python SDK dependency or LangGraph-native type leaks into common control-plane modules.

### Real local integration tests

- [ ] Launch the actual Python service on a test port with a temporary SQLite state directory.
- [ ] Launch or compose the TypeScript Lab server with langgraph/baseline registered.
- [ ] Submit a fake-model run through the generic server API.
- [ ] Poll until completion and assert normalized result, trajectory, metrics, events, and native reference.
- [ ] Kill/restart the Python service during a deliberately blocked or delayed run and assert the unknown/reconciliation rule.
- [ ] Verify checkpoint/state files remain readable after the service process exits.
- [ ] Exercise cancellation during a delayed model node.
- [ ] Verify an unavailable service is reported by health and the run API without fake success.
- [ ] Run the OpenRouter path only when a developer explicitly provides a key; it is not a required CI test.
- [ ] Confirm the generic Platform UI can run and inspect the registered baseline without Temporal-specific assumptions.

## Required validation commands

The implementation must replace placeholders with the exact commands supported by
the chosen Python toolchain and package scripts. At minimum, the final record must
include:

~~~
# Python service
uv run pytest server/src/platforms/langgraph/service/tests
uv run python -m compileall server/src/platforms/langgraph/service server/src/platforms/langgraph/variants

# TypeScript adapter and server
npm --prefix server run typecheck
npm --prefix server test
npm --prefix server run test:langgraph

# Local readiness and representative run
curl -fsS http://127.0.0.1:2024/health
curl -fsS http://127.0.0.1:4318/health

# Repository hygiene
git diff --check
~~~

The final validation record must state Python and package versions, whether the
OpenRouter path was run, temporary ports/state paths, and any manual-only check.

## Documentation and release impact

### Documentation checklist

- [ ] Platform README states the actual Python service and TypeScript adapter ownership.
- [ ] Local-development docs explain installation, start, readiness, reset, state path, and unavailable dependencies.
- [ ] Semantics docs explain checkpoints, thread IDs, sync durability, retries, duplicate model calls, cancellation, restart, and unknown outcomes.
- [ ] The playground is separate from tests, scenarios, experiments, and published evidence.
- [ ] Official links and repository paths/commands were checked.
- [ ] UI/API documentation is updated only if registration changes a public response or capability label.

### Release record

Record each decision explicitly in the implementation completion record:

- Analytics: not applicable for this local research platform; no new product analytics.
- Structured logging: record run ID, execution ID, graph/node, event sequence, status, and error code; never prompts, keys, or raw headers.
- Metrics/telemetry: record real model attempts, graph steps, checkpoint count, duration, usage when available, and service/runtime versions; do not claim benchmark results.
- Version/release identity: record Lab server version, protocol version, Python version, LangGraph lockfile, and adapter revision in safe run metadata.
- Migration/compatibility: new native evidence path; reject incompatible protocol versions; no legacy migration is required.
- Rollout: local-only, disabled until the Python service health check succeeds.
- Rollback: remove the runnable registration and stop the Python service; retained run evidence remains readable.
- Security review: loopback-only service, environment-only secrets, bounded input/resource limits, and no arbitrary checkpoint deserialization in Lab evidence.
- Known limitations: no hosted deployment, automatic in-flight recovery, human approval, tool side effects, Postgres, or exactly-once model execution.

## Commit boundaries

Use focused commits. The primary agent must review each handoff and keep unrelated
worktree changes unstaged.

1. feat(langgraph): freeze local service protocol and Python baseline
   - Platform-local protocol, Python service, graph, fake model, and Python tests.
2. feat(langgraph): add TypeScript runner adapter
   - Platform-local adapter, wire validation, execution-reference mapping, and adapter tests.
3. feat(langgraph): add local deployment profile
   - Platform deployment docs and LangGraph-specific helper/readiness/reset commands.
4. feat(server): register LangGraph baseline
   - Primary-owned bootstrap, configuration, registry, local-stack integration, and API/UI compatibility changes only.
5. test(langgraph): verify cross-language lifecycle and recovery
   - Real local service integration, restart/cancellation/unknown-outcome coverage, and evidence assertions.
6. docs(langgraph): document baseline semantics
   - Platform docs, playground, release record, and final validation record.

Before each commit:

- [ ] Review git status and preserve unrelated user changes.
- [ ] Review the exact diff and confirm no secrets, .env files, SQLite state, lockfile noise, or generated machine state are included accidentally.
- [ ] Run the narrow validation for the owned section.
- [ ] Include contract documentation with the code that changes it.
- [ ] Record the commit hash in the handoff.

## Parallel-agent handoffs

The protocol checkpoint and ownership table are prerequisites. After they are
committed, these workstreams can proceed in separate worktrees:

| Workstream | Safe parallel start | Files | Handoff |
| --- | --- | --- | --- |
| Python service | After protocol schema is frozen | server/src/platforms/langgraph/service/, variants/baseline/, Python metadata | Endpoint behaviour, state/durability semantics, Python commands, tests, versions |
| TypeScript adapter | After protocol schema is frozen | server/src/platforms/langgraph/runner-adapter/ and local protocol client | Runner mapping, error/unknown rules, adapter tests, registration instructions |
| Local infrastructure | Independent of runtime code | server/deployments/platforms/langgraph/, LangGraph-specific scripts helper | Ports, commands, readiness, reset, unavailable behaviour |
| Test harness | After protocol schema is frozen; use fixtures until service handoff | server/tests/platforms/langgraph/, server/integration-tests/langgraph-baseline.test.ts | Exact cases, process lifecycle, fixture assumptions |
| Documentation/playground | Independent after semantics are agreed | LangGraph README/docs and development/playground/ | Checked links, commands, observations, limitations |

Agents must not edit the common runner interface, Temporal files, root launcher,
server package scripts, registry, bootstrap, or Platform UI catalog. The primary
agent integrates those shared changes in one short commit after reviewing all
handoffs. No agent may silently widen this plan into another real platform.

Every handoff must include:

- exact files changed and files deliberately not changed;
- exact commands and results;
- assumptions and unresolved questions;
- evidence, migration, and release impact;
- known limitations and follow-up work;
- no secrets, generated runtime state, or unrelated changes.

## Completion gate

Before moving this plan to completed/, verify:

- [ ] langgraph/baseline is registered only when the real Python service implementation exists; runtime reachability is reported separately.
- [ ] A clean-checkout local run completes through the generic server API.
- [ ] Python and TypeScript sides validate the same protocol version and redaction rules.
- [ ] Checkpoint, state, retry, cancellation, restart, duplicate, and unknown-outcome semantics are tested.
- [ ] Normalized evidence and safe native reference are inspectable.
- [ ] The UI/API does not claim unsupported LangGraph capabilities.
- [ ] Documentation, playground, release decisions, exact validation results, and limitations are current.
- [ ] Each coherent implementation section has a focused commit.
- [ ] The completion record below names the final commits and manual observations.

## Completion record

Complete this section only when archiving the plan.

**Completed:** [YYYY-MM-DDTHH:MM:SS+HH:MM]<br>
**Commits:** [commit hashes]

### Validation

- [command] — [passed/failed and concise result]
- [manual check] — [what was observed]

### Known limitations

- [deliberate limitation or follow-up]

### Historical-scope note

This plan records the first Python LangGraph baseline. Later variants may add
hosted deployment, Postgres persistence, human approval, tools, or automatic
recovery, but those behaviours require their own plan and evidence.
