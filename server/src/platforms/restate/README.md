# Restate platform

This directory contains the `restate/baseline` platform implementation.

The baseline is one Restate Workflow keyed by `agentlab:<runId>`. The workflow owns
the durable model step and returns normalized event intents, trajectory, metrics, and
the terminal result. The runner adapter owns submission, inspection, cancellation,
and safe mapping of Restate-native identity and status into the Lab runner contract.

The Platform UI selects an OpenRouter model from the shared server catalog. The
model call remains inside the durable workflow step; fake models are retained
only for deterministic tests and failure experiments.

The common server remains the owner of Lab evidence files. This platform never writes
`lab/runs/` directly and never places provider credentials in workflow input or native
references.

## Session and turn semantics

The baseline is run-oriented. A browser conversation has one `sessionId`, but each
submitted turn creates its own Lab `runId` and Restate Workflow key:

```text
sessionId + clientTurnId
  -> one admitted Lab turn
  -> one runId
  -> agentlab:<runId>
```

The shared `ContextSessionStore` owns the transcript, active-turn admission, context
snapshot, compaction record, and terminal settlement. The Restate service does not keep
a second transcript database. A repeated `(sessionId, clientTurnId)` request returns
the existing turn; the same key with a changed prompt is a conflict. A second turn
cannot overtake an active one. The model and execution configuration become pinned
after the first turn, so changing them requires `New chat`.

The native workflow key and invocation ID are safe recovery identities, not proof of
exactly-once provider execution. Restate replays completed durable steps from its
journal, but an external model request can still be received when its acknowledgement
is lost.

## Recovery and evidence

The runner keeps Lab status and native Restate status separate. A terminal workflow
result is projected into the common run record while the native reference is refreshed
with the latest invocation status when Admin introspection is available. Temporary
Admin or ingress outages preserve the last readable projection. An accepted-but-unknown
submission remains `reconciliation_required`; it is never turned into a successful or
ordinary failed assistant message by timeout.

The common server writes the run evidence. A completed run normally contains:

```text
lab/runs/<run-id>/
  config.json
  context.json
  events.jsonl
  trajectory.json
  metrics.json
  result.json
  logs/operations.jsonl
  native/restate.json
```

`native/restate.json` contains only bounded Restate identity and status fields. It does
not contain prompts, tool arguments, authorization headers, provider response bodies,
or `OPENROUTER_API_KEY`. See [semantics](./docs/semantics.md) for the failure matrix
and [architecture](./docs/architecture.md) for ownership and write ordering.

When a persisted native reference is read again, the adapter validates its schema
version, run-derived workflow key, service and handler names, invocation identity,
endpoint URLs, counters, and bounded status fields before contacting Restate. A
malformed reference is a local recovery error; it is never used to construct an
introspection query or a cancellation request.

Status: baseline implementation and shared server registration complete. Restate is
advertised as runnable when the Lab server starts, but it reports unavailable until the
local Restate runtime and registered service are reachable. The default local runtime
is the pinned native Restate server binary; Docker is an optional profile.

Start with:

- [architecture](./docs/architecture.md)
- [local development](./docs/local-development.md)
- [semantics](./docs/semantics.md)
- [baseline variant](./variants/baseline/README.md)

The exact local commands and opt-in acceptance checks are in
[local development](./docs/local-development.md). The native binary is the required
local profile; Docker is only an optional compatibility profile.

### Running alongside an occupied default ingress

The existing official `@restatedev/restate-server` package pins native Restate
1.7.10. If another application owns port 8080, use isolated ports rather than
stopping that application. For example:

```bash
AGENTLAB_RESTATE_DATA_DIR=/tmp/agentlab-restate-eval-data \
RESTATE_ADMIN__BIND_ADDRESS=127.0.0.1:19070 \
RESTATE_INGRESS__BIND_ADDRESS=127.0.0.1:18080 \
RESTATE_BIFROST__BIND_ADDRESS=127.0.0.1:19522 \
./scripts/run_local_stack.sh restate-server

AGENTLAB_RESTATE_INGRESS_URL=http://127.0.0.1:18080 \
AGENTLAB_RESTATE_ADMIN_URL=http://127.0.0.1:19070 \
AGENTLAB_RESTATE_SERVICE_URL=http://127.0.0.1:19080 \
AGENTLAB_RESTATE_SERVICE_PORT=19080 \
./scripts/run_local_stack.sh restate

curl --fail --request POST http://127.0.0.1:19070/deployments \
  --header 'content-type: application/json' \
  --data '{"uri":"http://127.0.0.1:19080"}'
```

Pass the same ingress/admin/service environment variables to eval commands.
Set `AGENTLAB_CONTEXT_ROOT` to the same absolute directory in the driver and
service, and `AGENTLAB_LOCAL_FIXTURE_URL` to the eval fixture endpoint when using
connected-tool probes. Preserve the native data directory until inspecting or
reconciling any unfinished workflow.
