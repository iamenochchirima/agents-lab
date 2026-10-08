# Extensible agent capabilities

Capability packages supply tools and procedural skills to native agents. A
trusted profile selects package contributions; admission retains the exact
catalog. The agent chooses operations through its platform's model/tool mechanism.
The capability host executes configured sources and records each call.

This extends the existing [capability and approval boundary](platform-capabilities.md).
The design follows [source research on Waku, Pi, Hermes, MCP and Agent Skills](../research/extensible-agent-capabilities.md).
Those reference systems informed the boundaries; their permissions and execution
guarantees are not claims about this implementation.

## Decisions and supported platform boundary

The shared host is chosen because the Lab has both Python and TypeScript workers.
Separate clients in every language would duplicate source implementations and
connection behaviour. The host adds a service dependency and authenticated internal
transport, while each platform retains reasoning, tool selection and native execution.
Local built-ins can still execute directly.

Package provenance identifies declarative contributions separately from executable
plugins. Existing profile resolution owns grants and approvals. Source adapters
use the existing connection result/attempt contracts for transport evidence; they
do not introduce another permission system.

| Platform baseline | Model-facing declarations | Source invocation | Native evidence |
| --- | --- | --- | --- |
| Mastra | SDK tools generated from catalog schemas | Native SDK tool handler calls the host | SDK steps, correlated tools and retained model observations |
| LangGraph | Serialized schemas validated by Python | Graph tool node calls the host | Graph events, checkpoints and correlated tool results |
| Temporal | Pure projection from the admitted snapshot | Activity calls the host; no workflow network I/O | Workflow state and Activity lifecycle |
| Restate | Projection from the admitted snapshot | Durable action calls the host | Journal/action lifecycle and run state |

This table defines the four integration targets. Their acceptance evidence is
recorded separately; registration alone is not proof that a task succeeded.
Other platform variants are not declared compatible with hosted packages until
their adapters are implemented and verified.

## Ownership and flow

```mermaid
flowchart LR
  P[Trusted package configuration] --> L[Package loader]
  L --> C[Capability catalog and profiles]
  C --> A[Run admission]
  A --> S[Retained catalog snapshot]
  S --> N[Native model/tool projection]
  N --> H[Authenticated capability host]
  S --> H
  H --> W[Workspace and skill readers]
  H --> X[MCP and HTTP sources]
  H --> R[Retained call receipts]
```

`server/src/capabilities/extensions/packages.ts` owns configuration loading.
`CapabilityCatalog` owns trusted profile resolution. `RunService` admits the run
and retains its manifest. Platform adapters project selected descriptors into
native declarations. Temporal executes I/O through Activities, Restate through
durable actions, Mastra through SDK tools and LangGraph through its Python tool
node. No shared implementation replaces their native agent loops.

The host is a source executor. It reads the run manifest, verifies the catalog
revision and turn identity, matches the source binding and schema, then repeats
argument validation and policy checks. The browser and model cannot submit new
endpoints, credentials, filesystem roots or executable handlers.

## Contributions and authority

A package has a safe ID, exact version and configured source. Skill sources use trusted package roots. Optional file providers own their storage. MCP sources discover tools from a configured endpoint.
HTTP sources declare specific methods, paths and input schemas. A package can
contribute several operations. Profiles can explicitly compose package IDs;
there is no implicit all-packages grant.

The snapshot contains model-facing definitions, source ID/version/digest, routing
identity and failure policy. Private roots, endpoints and credential values stay
in server-owned configuration and closures. Provider-compatible aliases retain
the original source routing identity. Duplicate aliases are rejected.

Admission freezes the catalog used by a run. A package reload supplies new
admissions; an older run cannot silently dispatch against changed source/schema
identity. MCP tools are checked against current discovery before invocation.
Skill instructions and resources are checked against their admitted digests.
Changing provider identity or authorization changes its source binding.

Write and external tools require explicit approval through the existing policy
resolver. A skill's Markdown, frontmatter or resource cannot supply that approval.
Generic schema validation uses JSON Schema 2020-12 or declared draft-07 without
coercion, defaults or remote reference loading. Resource-specific checks enforce
additional path and edit invariants.

## Skill and external document lifecycle

Profiles are reproducible capability configurations, not agent personas or job
roles. The built-in `local-safe` profile supplies a small fixture for initial
experiments. A configured profile can combine connected operations and skills
without changing a platform runtime. Skill metadata is available without adding
every body to model context. The model can list procedures, load one `SKILL.md`,
then read the particular resource it needs. Loaded results retain package
identity and digest. Skill scripts are returned as source text; no script
executor is implied. Binary assets use bounded base64, while text uses UTF-8.

The context session owns activated skill state. Successful instruction loads and
UTF-8 resource reads persist authority-free identities, exact versions, digests
and content before returning to the caller. Repeated identical loads are a no-op.
Changed content under an active identity requires a new session. Follow-up
snapshots include these records as contextual user messages with `source: skills`;
they do not promote tool text to a higher-priority instruction role. Compaction
protects these records and includes their actual size in the context budget.
Binary assets remain tool evidence rather than permanently occupying model context.
Preselected legacy skills remain separate admission configuration.

The separately running document provider lists, reads and searches files, then
creates or patches scoped outputs. It owns session storage, template cloning,
path checks, edit digests and local write serialization. The host injects the
admitted session identity; the model cannot choose a host directory. Existing-file
replacement requires the observed digest, and patching requires an unambiguous
match. Provider confinement is an application boundary, not an operating-system
sandbox. There is no native workspace source or implicit local shell fallback.

## Calls, interruption and evidence

Workers authenticate to `/internal/capabilities/execute` using a private configured
key file. The local default is `lab/runs/.capability-host.key`; the host creates
it with private permissions. Credentials are not included in run manifests or
model declarations.

Before executing a source operation, the host reserves the run/tool-call identity
under `artifacts/capability-calls/`. The fingerprint includes the catalog revision,
turn and complete call. Concurrent duplicates share the in-flight result. A
completed retained receipt replays its result; a conflicting fingerprint is
rejected. A pending receipt after interruption returns unknown and does not
repeat the operation. Receipt persistence can therefore prevent redispatch while
still leaving an uncertain external outcome. It is not an exactly-once guarantee.

Known tool failures retain correlated corrective feedback where the admitted
policy allows it. Connected write calls with a lost response or post-dispatch
timeout/cancellation return unknown and do not retry automatically. HTTP success
with a malformed declared output retains the acknowledgement and invalid presentation.
For writes, native continuation stops rather than inviting redispatch. MCP execution errors
retain `isError`, content blocks and structured content rather than turning every
reply into successful text. Native events, trajectory and metrics remain alongside
the source receipts.

The implemented MCP boundary covers configured legacy initialization and modern
request metadata, paginated discovery and bounded request/result handling. It is
not a full implementation of every MCP extension. Sampling, interactive elicitation,
subscription-driven inventory refresh, arbitrary stdio servers and task execution
require separate support. HTTP operations use configured same-origin paths and declarative path/query/header/body
bindings. Supported encodings are JSON and form; provider idempotency and rejection
semantics are explicit operation contracts.

## Operational limits

Native workers need access to the host URL and the configured private key. This
local shared-user setup does not establish a multi-tenant deployment boundary.
There is no arbitrary executable plugin loader, marketplace installation or
universal OAuth onboarding. Configured pre-registered clients and the documented
MCP discovery subset use the connection manager; unsupported registration modes
remain explicit. Larger native capabilities
such as terminal or browser execution can be added through a new source adapter
without redefining profiles or tool-call semantics.

Use the [package guide](../guides/capability-packages.md) for runnable setup and
the [local module notes](../../server/src/capabilities/extensions/README.md) for
implementation ownership.

## Connected authority and action review

Trusted connection definitions identify a deployment owner, target resource and
permitted scopes. The configured owner is a local authority label, not proof of a
remote user identity. Late credential resolution permits token rotation within the
same grant. Revocation, reconnect and configuration changes advance durable authority
generations and block old bindings. Optional unavailable sources do not stop the
control plane. Catalog refresh updates future admissions atomically.

Automatic execution, upfront tool grants and invocation review are separate modes.
The review host retains exact arguments and source identity before native suspension.
Approve/deny binds the retained revision; renewal creates a fresh review without
inference or effects. The unfinished context turn stays occupied while waiting.
Cancellation, decisions and final dispatch reservation share a single-host lock.
See the [review contract](../../server/src/capabilities/reviews/README.md).

Mastra persists SDK suspended snapshots in LibSQL. LangGraph uses a dedicated
checkpointed approval node and `Command(resume=...)`. Temporal waits on a workflow
signal and heartbeats source Activities. Restate waits on a call/revision-specific
durable promise. A common runner interface projects these native lifecycles without
replacing their orchestration. Waiting recovery does not establish recovery of every
in-flight model request or external effect.

Text-only model projections preserve supported text/JSON and resource references.
Original content blocks, response validity and effect evidence stay in canonical
records. Unsupported image/audio content is identified explicitly. The model is
never credited with perceiving media that its adapter did not provide.
