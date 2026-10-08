# Lina Tools follow-up audit

Reviewed 2026-10-08. Proposal only. The current 29 Tools nodes and their JSON
contracts remain unchanged. This note specifies four additional graph nodes and
targeted repairs needed when integrating the other blocks.

## Evidence and scope

Inspected `apps/web/src/features/lina/toolsBlock.ts`,
`contracts/toolsConnections.ts`, `contracts/toolsCapabilities.ts`,
`contracts/toolsCalls.ts` and `contracts/nodeContracts.ts`.
The [Tools research](tools-architecture-research.md),
[pinned source comparison](tools-hermes-openclaw.md) and
[Pi/Waku comparison](tools-pi-waku.md) establish source behavior and its limits.
The specific node names and division below are Lina design recommendations.

MCP resource acquisition is a distinct operation, including text/binary content,
templates and optional supported continuations. It is not inherently a tool call.
See the [official resources specification](https://modelcontextprotocol.io/specification/2026-07-28/server/resources).
Skill metadata, selected instructions and requested assets remain separate;
see the [Agent Skills specification](https://agentskills.io/specification).
No interoperability or performance measurement was performed for this audit.

## Additions

| Exact node ID | Title and owner boundary | Input record | Output variants |
| --- | --- | --- | --- |
| `lina-tools-resource-read` | Read selected connector resources. Tools owns remote acquisition; Context owns inclusion. | Context dependency identity, versioned resource selection, account/binding, authority and size limit. | `tools.resource-loaded`, `tools.resource-waiting`, `tools.resource-failed`. Preserve URI, MIME type, source revision/digest, content/artifact refs, acquired account and source trust. |
| `lina-tools-prompt-get` | Get selected connector prompt. Fetch an explicitly selected template with validated arguments; preserve supplied roles. | Dependency identity, selected prompt name/revision, arguments/digest and binding. | `tools.prompt-loaded`, `tools.prompt-waiting`, `tools.prompt-failed`. Return ordered role/content blocks and provenance; never promote remote content to system authority. |
| `lina-tools-hooks` | Apply declared plugin hooks at an explicit host invocation point. | Invocation kind, plugin/revision, contribution generation, authority, original call/context candidate and bounded hook policy. | `tools.hook-applied`, `tools.hook-blocked`, `tools.hook-failed`. Call mutation returns to validation. Context mutation returns to Context validation and budget evaluation. |
| `lina-tools-retry` | Decide bounded adapter retry. This owns tool attempts, not model retries or transport reconnect. | Known failure, effect classification, adapter retry contract, logical call ID, prior attempt, retry budget and cancellation state. | `tools.retry-ready`, `tools.retry-denied`, `tools.retry-cancelled`. Eligible retries reenter resolution/validation/permissions and scheduling; no direct launch bypass. |

One hook node represents a tagged invocation boundary, not a new generic workflow
engine. Initial supported points are `before-argument-validation` and
`context-projection`. After-result observers may consume safe events without
rewriting authoritative effect evidence. Arbitrary hooks are rejected as
unsupported until they have a declared invocation contract.

Resources and prompts use scoped connection/authentication readiness and Safety
checks before acquisition. Their wait IDs retain the context dependency ID.
They do not manufacture a main-model round or a tool-result transcript message.
If exposed through an actual registered utility tool, that wrapper follows the
ordinary call pipeline and retains its own call ID.

## Existing node repairs

| Existing nodes | Required update |
| --- | --- |
| `plugin-load`, `plugin-lifecycle`, `register` | Loaded candidates remain inactive. Publish tool, skill, connector and hook contributions only after successful activation. Current load outputs named active skills/connectors and the direct load-to-register edge obscure this distinction. Stage candidates, then activate atomically or report failed cleanup. |
| `discover`, `register`, `catalog` | Keep resource/prompt metadata in distinct inventories rather than silently discard it or register it as a fabricated tool. Propagate capability support flags, schema dialect, exact account and generation. Unsupported sampling, roots, subscriptions or continuation features receive explicit outcomes. |
| `catalog` | Preserve the same input schema or a declared semantics-preserving provider projection. Current catalog projection examples omit registered constraints. Record `schemaDigest`, catalog revision and binding generation end to end. Add skill metadata inventory handoff to Context. |
| `resolve`, `validate` | Resolve against the exposed revision, apply declared argument hooks before final validation/digests. Account/schema/catalog changes produce a bounded reprepare outcome, never silently rebind. |
| `permissions` | Make the request/response handoff to Safety explicit. Tools holds per-call state; Safety decides grants and validates answers; Turn Execution coordinates retained waits. |
| `dispatch` | Hand off scoped operations to Environment; request State intent acknowledgement before effects when the configured durability profile requires it. Never expose raw credential leases to either Context or ordinary evidence. |
| `collect`, `publish` | Add explicit retry-decision and waiting handoffs. Keep rich results, known siblings and uncertain effects distinct. Route unknown effects to the retained reconciliation node under Turn Execution ownership. |
| `monitor`, credential nodes | Publish readiness/catalog invalidation events, safe credential-store failures and scoped disconnect outcomes to State/Observability. Refresh and reconnect do not authorize replay. |

These IDs use the `lina-tools-` prefix. The three current lanes for calls,
credentials and setup remain separately inspectable. Catalog publication is a
dependency available to a round, not a path that forces every configuration and
credential step to run on every round.

## Exact edges and producer routes

Exact edge IDs are below. A row with two event variants
means both variants are explicitly declared on the same edge.

| Edge ID | Source → target | Producer output |
| --- | --- | --- |
| `lina-tools-edge-context-resource-request` | `lina-context-load` → `lina-tools-resource-read` | `context.resource-requested` |
| `lina-tools-edge-resource-context` | `lina-tools-resource-read` → `lina-context-load` | `tools.resource-loaded` / `tools.resource-failed` |
| `lina-tools-edge-context-prompt-request` | `lina-context-load` → `lina-tools-prompt-get` | `context.prompt-requested` |
| `lina-tools-edge-prompt-context` | `lina-tools-prompt-get` → `lina-context-load` | `tools.prompt-loaded` / `tools.prompt-failed` |
| `lina-tools-edge-resource-wait` | `lina-tools-resource-read` → `lina-execution-wait` | `tools.resource-waiting` |
| `lina-tools-edge-prompt-wait` | `lina-tools-prompt-get` → `lina-execution-wait` | `tools.prompt-waiting` |
| `lina-tools-edge-wait-resource-resume` | `lina-execution-wait` → `lina-tools-resource-read` | `execution.resource-resume` |
| `lina-tools-edge-wait-prompt-resume` | `lina-execution-wait` → `lina-tools-prompt-get` | `execution.prompt-resume` |
| `lina-tools-edge-resolve-hooks` | `lina-tools-resolve` → `lina-tools-hooks` | `tools.call-hook-requested` |
| `lina-tools-edge-hooks-validate` | `lina-tools-hooks` → `lina-tools-validate` | `tools.hook-applied` with `invocationKind: before-argument-validation` |
| `lina-tools-edge-hooks-collect` | `lina-tools-hooks` → `lina-tools-collect` | `tools.hook-blocked` / `tools.hook-failed` for a call |
| `lina-context-edge-observations-hooks` | `lina-context-observations` → `lina-tools-hooks` | `context.projection-hook-requested` |
| `lina-tools-edge-hooks-context-budget` | `lina-tools-hooks` → `lina-context-budget` | `tools.context-projection-transformed` |
| `lina-tools-edge-hooks-context-terminal` | `lina-tools-hooks` → `lina-execution-settle` | `tools.context-projection-failed` |
| `lina-tools-edge-collect-retry` | `lina-tools-collect` → `lina-tools-retry` | `tools.retry-assessment-requested` |
| `lina-tools-edge-retry-resolve` | `lina-tools-retry` → `lina-tools-resolve` | `tools.retry-ready` |
| `lina-tools-edge-retry-collect` | `lina-tools-retry` → `lina-tools-collect` | `tools.retry-denied` / `tools.retry-cancelled` |
| `lina-tools-edge-skills-context-inventory` | `lina-tools-skill-discover` → `lina-context-load` | `tools.skill-inventory` |

Replace the direct resolved-call `resolve-validate` route with
`resolve-hooks` → `hooks-validate`; the no-hook case emits an explicit unchanged
record. The context hook path permits one application per incoming candidate revision.
Its output includes the applied invocation ID; reductions preserve that record
and do not invoke the same hook again. Mutations force budget reevaluation with a bounded candidate
revision count. A failed required hook stops preparation; optional-hook behavior
is declared by host policy, never silently swallowed.

Safety, Environment and State edge endpoints are defined in the
[whole-architecture proposal](../../../development/implementation-plans/studio/active/lina-cross-block-revisit.md).
That proposal is the integration authority when supporting notes use different
event names for equivalent handoffs.

## Representative JSON records

These are proposed normalized payloads. They are not MCP wire messages or
operational credentials. Implementation wraps them in `{kind, payload}` using
the existing contract helpers and provides complete input/output schemas.

```json
{
  "dependencyId": "context-dependency-001",
  "agentId": "lina-main",
  "turnId": "turn-001",
  "snapshotCandidateId": "candidate-001",
  "binding": {
    "connectionId": "conn-docs-demo",
    "accountId": "account-demo",
    "readinessGeneration": 3
  },
  "selection": {"kind": "resource", "uri": "docs://guide", "inventoryRevision": "resources:7"},
  "permissionDecisionRef": "permission:resource-read:1",
  "maxBytes": 32768
}
```

```json
{
  "dependencyId": "context-dependency-001",
  "source": {"kind": "mcp-resource", "uri": "docs://guide", "revision": "r7", "trust": "external-data"},
  "binding": {"connectionId": "conn-docs-demo", "accountId": "account-demo", "readinessGeneration": 3},
  "contents": [{"mimeType": "text/markdown", "artifactRef": "artifact:guide:r7", "digest": "sha256:fixture-guide"}],
  "truncated": false,
  "grantsInstructionAuthority": false
}
```

```json
{
  "callId": "call-001",
  "previousAttemptId": "tool-attempt-001",
  "nextAttemptId": "tool-attempt-002",
  "adapterPolicyRef": "retry:docs-read:v1",
  "failureCode": "rate-limited",
  "effectCertainty": "known-no-effect",
  "retryBudget": {"used": 0, "max": 1},
  "notBefore": "2026-10-08T12:00:01Z",
  "logicalCallPreserved": true,
  "requiresFreshAdmission": true
}
```

Unknown write outcomes take reconciliation instead of the retry path. A provider
idempotency key is evidence only when that adapter declares and verifies its
semantics. It is not a universal guarantee.

## Implementation and simulation checklist

- [ ] Add four nodes, producer outputs and exact incoming variants.
- [ ] Update all affected existing descriptions, schemas and examples.
- [ ] Fix staged plugin publication and catalog projection fidelity.
- [ ] Route resource/prompt dependencies through real scoped acquisition owners.
- [ ] Link Safety, Environment, State and waiting owners using matching payloads.
- [ ] Show two independent calls launched before either completes, then a full join.
- [ ] Show a permission-denied call alongside a successful sibling.
- [ ] Show hook argument mutation followed by fresh validation and approval digest.
- [ ] Show plugin activation failure publishing no executable contribution.
- [ ] Show catalog invalidation after preparation rejecting launch and bounded reprepare.
- [ ] Show a known read failure retry retaining call ID and changing attempt ID.
- [ ] Show cancellation during retry backoff preventing launch.
- [ ] Show unknown write timeout retaining successful siblings and requiring reconciliation.
- [ ] Show selected resource/prompt loading, dependency wait/resume, optional omission and required-source failure.
- [ ] Show secret redaction before safe evidence/model projection.
- [ ] Run each case in manual and auto mode with identical semantic events.

Scripted playback demonstrates the proposed state transitions. It does not prove
real concurrent execution, safe plugin execution or actual durable recovery.
