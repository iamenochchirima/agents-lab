# Mastra baseline harness variant

The baseline is a direct-agent call with Lab-owned context and a bounded native tool:

```text
Lab manifest → Lab context snapshot → Mastra Agent.generate() → Lab evidence projection
```

It uses Mastra's native TypeScript runtime and accepts either a deterministic local
fake model or an opt-in OpenRouter model. The calculator is registered with the shared
tool registry and exposed through Mastra's native tool interface. The `local-mcp-safe`
profile also registers the server-owned `mcp_fixture_lookup` binding as a native Mastra
tool; discovery and invocation cross the local Streamable HTTP boundary from the tool
execution path. Context sessions, snapshots, token budgets, and transcript continuation
belong to the Lab. Mastra Storage persists native approval snapshots in LibSQL;
Mastra Memory and workflows are not enabled. Waiting runs can be reconstructed
without repeating model inference. Arbitrary in-flight generation remains
process-local and is not recoverable after a server restart.

The MCP binding is immutable for the run. The endpoint and remote `fixture.lookup` tool
are resolved from server configuration, not from model arguments. A provider-declared
failure is failed, while a lost acknowledgement is `outcome_unknown`; neither is
converted into a successful final response by the agent runner.

### Synthetic live eval transport

Runs selecting the `agent-harness-live` experiment use an opt-in AI SDK v2 OpenRouter
transport inside the existing Mastra `Agent.generate()` loop. It retains actual mapped
messages, tool definitions, responses and tool results through eval-only events, without
authentication headers. Requests enforce the selected approved free ID, zero-price
provider ceilings, disabled fallback and a 512-token output limit. SDK retries are zero;
provider failures stop the trial. Context compaction is refused for these short probes.
Ordinary interactive runs continue using the existing model router.

## Extensible tool catalogs

Admitted profile runs carry a frozen `toolCatalog` snapshot with full JSON Schema,
source identity, effective limits, execution binding, and failure policy. The
model sees that snapshot rather than a platform-owned list of tool names. Adding
a hosted tool package changes the capability catalog; it does not require adding
a branch to this platform's agent loop. Direct legacy callers without a snapshot
retain the original built-ins.

Hosted tools require the Lab capability host (`AGENTLAB_CAPABILITY_HOST_URL`,
default `http://127.0.0.1:4318`) and its local worker credential
(`AGENTLAB_CAPABILITY_HOST_KEY_FILE`, default `lab/runs/.capability-host.key`).
Only an opaque catalog revision and execution identity cross the runtime
boundary; credentials and host addresses stay outside run manifests and model
context. The host rechecks the admitted run's catalog and approval policy.
Known failures become model feedback only when the frozen descriptor permits
it. Unknown dispatch outcomes stop the turn and are never automatically retried.

Generic Mastra SDK tools use the admitted JSON Schema directly. All wrappers
share the run call counter and execute through the common tool registry.


### Invocation review

Tools with `approvalMode: "invocation"` use native SDK `requireApproval`. When
`generate` suspends, the runner persists the exact call through the shared review
host and retains the SDK snapshot plus native event projection under
`<contextRoot>/.mastra-baseline/<runId>/`. Human waiting clears the execution timer.
Approval/denial resumes that existing SDK call using `approveToolCallGenerate` or
`declineToolCallGenerate`; denied actions receive correlated error feedback and
never execute. The host rechecks the durable approval before any effect.

A replacement runner rebuilds the admitted agent against the same LibSQL snapshot
and persisted pending identity. Review renewal changes the pending revision without
inference or SDK approval. This is waiting-state recovery, not arbitrary model-call
replay. Unknown tool effects stop the native SDK loop before another model request,
then settle the run with its retained uncertainty.

Tool results retain structured content, original content blocks, and effect
certainty in execution evidence. This baseline projects text and structured JSON
into the native model message. Unsupported content gets an explicit marker;
the evidence does not claim the text-only model perceived images or audio.

The opt-in native review fixture uses scripted model choices through the real
SDK and capability host. It verifies suspended runner and host reconstruction,
two review renewals, approve/deny/cancel, and stopping after an unknown effect:

```sh
cd server
npm run build
AGENTLAB_REVIEW_PLATFORMS=mastra AGENTLAB_RUN_NATIVE_INVOCATION_REVIEW=1 \
  node --test dist/integration-tests/native-invocation-review.test.js
```

This verifies harness behavior rather than real-model decision quality. Run
evidence is retained under `lab/runs/.review-proof/`.
