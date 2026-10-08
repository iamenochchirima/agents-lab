# Lina Context revisit proposal

Reviewed 2026-10-08. This is a graph implementation proposal for review. It changes no graph, contracts or playback. The current Context block has ten proposed design nodes, rich inspectors, and scripted fits/prune/compact/error paths. It has no real retrieval, tokenizer, summarizer or persistence runtime.

## Recommendation and observed gaps

Keep the ten existing responsibilities. Add two nodes, **Bind context scope** and **Shape observations**, bringing Context to twelve nodes. The first makes agent-specific access and inheritance visible. The second separates executable tool definitions from model-visible results, which now need substantially different contracts.

The existing code already protects canonical records, preserves call/result pairs, budgets the request, bounds reduction, and rechecks launch authority after publication. Those decisions should survive. See [Context nodes](../../../apps/web/src/features/lina/contextBlock.ts) and [contracts](../../../apps/web/src/features/lina/contracts/contextAssembly.ts).

Concrete gaps found in those contracts:

- `contextPreparation` has agent/conversation identity but no workspace, requester/account scope, memory namespaces, child inheritance policy or permission generation. Mentioning children in node prose does not exercise isolation.
- The Context tool record has only name, schema reference, description and permission reference. Tools now supplies catalog revision, stable tool ID, schema digest and executable binding. Context currently drops information needed to resolve exactly the definitions shown to the model.
- The Tools `catalogProjection` example differs from its registered search definition: `query.minLength: 1` disappears. This must be fixed at the producer, rather than tolerated by Context. See [Tools capability contracts](../../../apps/web/src/features/lina/contracts/toolsCapabilities.ts).
- Tools-to-Context edges accept catalog, activated-skill and loaded-resource payloads, but the normal Context example remains the calculator candidate. Type-valid unions do not prove that incoming additions are merged into the same preparation, or that revisions stay coherent.
- Tool observations use the shared simple `toolResult`. Tools now has structured output, content blocks, artifacts, partial failures and correlated pending work. Those forms need a real Context projection contract.
- Plugin context hooks, skill inventory metadata, selected MCP prompts/resources, source-change invalidation and child result packets have no complete visible route.

The richer graph is our decomposition for learning and review. The cited source agents do not share a standard twelve-node architecture.

## Nodes to add

| Exact node ID | Title | Input | Outputs and routes | Why a separate node |
| --- | --- | --- | --- | --- |
| `lina-context-scope` | Bind context scope | `context.prepare` plus coordinator-supplied agent access and inheritance policy | `context.scope-bound` to load; `context.scope-denied` to existing Execution settlement | Parent/child reuse, account isolation and memory namespace eligibility must be checked before source loading. Context consumes an existing policy decision; it cannot grant access. |
| `lina-context-observations` | Shape observations | Candidate, selected canonical complete tool groups and child-result records, provider content capabilities | `context.observations-shaped` to budget; `context.observation-invalid` to settlement; `context.projection-hook-requested` to Tools hooks | Catalog definitions and rich result projection need different rules. This node preserves call identities and original artifacts while choosing model-visible representations. |

Use the current Context block layout and shift the main row to make room. Scope starts the row before load. Observations follows tools before budget. Keep reduction branches below the row. Saved user positions and edits must survive migration.

## Updates to every existing node

| Existing node ID | Required change | Concrete example branches |
| --- | --- | --- |
| `lina-context-load` | Load an assembled source manifest for the exact scoped preparation. Join incoming catalog, skill, resource, memory and history references by preparation ID; do not treat each incoming edge as a standalone complete candidate. Handle required/optional, loaded/referenced/pending/denied and revision status. Request permitted external acquisition through Tools. | Selected resource requires authentication then resumes the same preparation; optional memory unavailable proceeds with omission; required project instruction missing stops; stale source causes bounded reprepare. |
| `lina-context-instructions` | Separate metadata discovery from activated bodies. Record instruction kind, origin, package/contribution revision, activation identity, precedence and host trust decision. Selected skills cannot supersede higher-priority instructions. Keep MCP prompt messages in their supplied roles unless a separately declared host policy selects a trusted instruction source. | Skill description visible without body; activated skill body added; conflicting skill text remains lower priority; unloaded plugin contribution omitted from a revised preparation. |
| `lina-context-history` | Select from the bound agent's active history branch. Represent multi-call assistant groups with full required terminal results. Preserve unresolved work metadata without fabricating a terminal observation. Reject duplicate/conflicting terminal records and foreign-agent history. | Results arrive call-002 then call-001 but remain correlated; child starts with fresh history and selected task packet; parent selected history allowed only under explicit inheritance policy. |
| `lina-context-task` | Add typed evidence blocks for memory, selected resources, prompt messages, attachments, skill resources and child task/result artifacts. Preserve source/account namespace, MIME type, artifact digest, acquisition record, revision, and explicit omission/failure. Retrieved source priority hints cannot override the host's requiredness or access policy. | MCP text resource; binary image reference; selected user-role prompt; child report with artifact links; memory hit in allowed namespace; forbidden hit excluded before reads. |
| `lina-context-tools` | Limit this node to the model-visible permitted catalog projection. Preserve exact catalog revision, tool IDs, input schema/digest and account/binding reference through the published snapshot and subsequent model call. Empty catalog is valid. Skill allowed-tools metadata remains a hint. | Two connected accounts expose separately resolved aliases; catalog invalidation produces revision 8 with removed tool; a curated subset records excluded IDs and reason. |
| `lina-context-budget` | Count activated skill bodies, metadata inventory, selected prompt messages, structured observations, binary/media handling and hook-added content. A hook/reduction revision must be budgeted again. Carry acquisition/summary work usage separately from main model usage. | Rich image output needs capability estimate; hook adds content and exceeds budget; selected source alone exceeds protected budget; bounded retry exhaustion stops. |
| `lina-context-prune` | Apply reduction to complete correlation groups or eligible observation blocks. Preserve essential failure/uncertainty, source provenance, raw artifacts and child-result references. Selection cannot remove protected constraints or rewrite status to success. | Mask older successful large result; retain unknown-effect warning and reconciliation reference; keep image artifact available after dropping its inline representation. |
| `lina-context-compact` | Summary provenance names exact history branch/revision and retained unresolved work. Parent and child summaries use separate scopes. A source change, cancellation or failed summary preserves the prior valid snapshot. Scripted summaries remain visibly fixtures. | Parent summary excludes child-private transcript; stale summary rejected; successful summary retains outstanding approval and unknown write. |
| `lina-context-validate` | Check scope, source revisions, instruction precedence, catalog/schema identity, complete correlated terminal groups, MIME/provider capabilities, source trust and hook mutation declaration. Never silently repair data. Hook mutations cannot invent canonical calls or widen tool permissions. | Orphan/duplicate terminal result rejected; projection schema differs from registry rejected; foreign memory reference rejected; unsupported required media fails with classified reason. |
| `lina-context-publish` | Publish snapshot with source/catalog/policy generation vector and selected contribution digests. Recheck current generations immediately before returning readiness. An invalidated candidate returns to Execution for bounded reprepare, with the same logical round and no model launch. Publication records no secrets. | Account switched during preparation; plugin removed after validation; source revision changed; unchanged retry reuses snapshot; overflow obtains a new revision. |

## Exact edge changes

Remove `lina-context-edge-prepare-load`; replace it with:

| New edge ID | Source → target | Event |
| --- | --- | --- |
| `lina-context-edge-prepare-scope` | `lina-execution-prepare` → `lina-context-scope` | `context.prepare` |
| `lina-context-edge-scope-load` | scope → load | `context.scope-bound` |
| `lina-context-edge-scope-terminal` | scope → `lina-execution-settle` | `context.scope-denied` |

Remove `lina-context-edge-tools-budget`; replace it with:

| New edge ID | Source → target | Event |
| --- | --- | --- |
| `lina-context-edge-tools-observations` | tools → observations | `context.tools-prepared` |
| `lina-context-edge-observations-budget` | observations → budget | `context.observations-shaped` |
| `lina-context-edge-observations-terminal` | observations → `lina-execution-settle` | `context.observation-invalid` |
| `lina-context-edge-observations-hooks` | observations → `lina-tools-hooks` | `context.projection-hook-requested` |
| `lina-tools-edge-hooks-context-budget` | `lina-tools-hooks` → budget | `tools.context-projection-transformed` |
| `lina-tools-edge-hooks-context-terminal` | `lina-tools-hooks` → `lina-execution-settle` | `tools.context-projection-failed` |

Cross-block acquisition and invalidation edges:

| New edge ID | Source → target | Event |
| --- | --- | --- |
| `lina-tools-edge-context-resource-request` | load → `lina-tools-resource-read` | `context.resource-requested` |
| `lina-tools-edge-resource-context` | `lina-tools-resource-read` → load | `tools.resource-loaded` or `tools.resource-failed |
| `lina-tools-edge-context-prompt-request` | load → `lina-tools-prompt-get` | `context.prompt-requested` |
| `lina-tools-edge-prompt-context` | `lina-tools-prompt-get` → load | `tools.prompt-loaded` or `tools.prompt-failed |
| `lina-context-edge-load-reprepare` | load → `lina-execution-prepare` | `context.reprepare-required` |
| `lina-context-edge-publish-reprepare` | publish → `lina-execution-prepare` | `context.reprepare-required` |
| `lina-tools-edge-skills-context-inventory` | `lina-tools-skill-discover` → load | `tools.skill-inventory` |

All short Context names in these tables use `lina-context-` prefix. The Tools nodes `resource-read`, `prompt-get` and `hooks` are coordinated additions in the broader revisit proposal, not existing nodes today.

Retarget the three existing contribution edges `lina-tools-edge-catalog-context`, `lina-tools-edge-skill-activate-context` and `lina-tools-edge-skill-resources-context` to `lina-context-load`. They stage versioned source records rather than advancing the execution cursor. Scope is bound before material is read or included. Every active-preparation contribution needs agent/preparation correlation; a setup inventory without a turn identity is deliberately bound by load before use. The [consolidated graph manifest](../../../development/implementation-plans/studio/active/lina-cross-block-revisit.graph.json) is authoritative for IDs and contribution routing.

Invoke each declared context-projection hook once for the input candidate generation and record its invocation ID, input digest and output digest. The returned candidate always enters budget and then validation. Prune/compact loops do not invoke the hook again; an explicit reprepare creates a new generation and bounded invocation. Hook failure is classified, never an implicit retry loop.

A `context.reprepare-required` outcome returns to Prepare round, which rechecks limits, cancellation and authority before requesting revision N+1. Preserve round/call counters. Bound reprepare attempts separately from provider retry and reduction attempts. If the bound is exhausted, settle with `context_sources_unstable`. Resource/auth waits remain pending work in Execution/Tools, and do not complete the main turn or launch another model round.

## Contract additions and paired examples

Use one staged candidate throughout the preparation. Each event includes `preparationId`, `agentId`, `turnId`, `roundId` and `revision`; source contributions must match these fields or be versioned coordinator dependencies deliberately bound during scope/load. A whole registry catalog event is not itself a prepared model request.

Required shared records:

- `contextScope`: workspace, requester, agent, history branch, permitted source roots, memory namespaces, account/binding references, permission generation, parent reference, explicit inheritance mode and task packet reference. No credentials.
- `sourceManifestEntry`: stable source ID/type/ref, revision/digest, scope/origin, requiredness, loading status, acquisition request, omission and trust classification.
- `catalogBinding`: catalog reference/revision, registry generation, selected tool IDs, schema digests, exact input schemas, owner/account binding references and permission-policy generation. Use the producer's schema object without lossy reconstruction.
- `observationProjection`: call and batch identity, canonical terminal status, original result reference, content blocks, structured-output reference, child-result reference if applicable, selected representation, fallback/omission reason and raw artifact references.
- `generationVector`: history, source manifests, catalog, scope/permission, activated skill/plugin and model-capability revisions. Snapshot equality is established on these records; a snapshot's existence does not authorize launch.

Scope input fixture:

```json
{
  "kind": "context.prepare",
  "payload": {
    "preparationId": "prepare:child-001:round-001:r0",
    "agentId": "lina-child-001",
    "conversationId": "conversation-child-001",
    "turnId": "turn-child-001",
    "roundId": "round-001",
    "revision": 0,
    "workspaceId": "workspace-demo",
    "requesterId": "user-demo",
    "historyRef": "history:child-001:r0",
    "parentAgentId": "lina-main",
    "inheritanceMode": "selected-task-packet",
    "taskPacketRef": "task-packet:child-001:v1",
    "requestedMemoryNamespaces": ["workspace-demo:shared"],
    "permissionGeneration": 4
  }
}
```

Paired scope output retains that request unchanged and adds:

```json
{
  "kind": "context.scope-bound",
  "payload": {
    "preparationId": "prepare:child-001:round-001:r0",
    "scopeRef": "context-scope:child-001:v1",
    "historyRef": "history:child-001:r0",
    "allowedMemoryNamespaces": ["workspace-demo:shared"],
    "excludedSourceRefs": ["history:parent-private:r9"],
    "scopeDecisionRef": "scope-decision:child-001:1",
    "grantsAdditionalPermission": false
  }
}
```

The complete implemented output must carry the staged request/candidate in addition to this scope result. The short example shows the new fields; it is not a replacement for existing state/authority fields.

Rich observation input fixture:

```json
{
  "kind": "context.observations-requested",
  "payload": {
    "preparationId": "prepare:turn-001:round-002:r0",
    "batchId": "batch-001",
    "selectedCallIds": ["call-001", "call-002"],
    "canonicalResults": [
      {"callId": "call-002", "status": "success", "structuredOutputRef": "artifact:search:structured", "contentRefs": ["artifact:search:text", "artifact:search:image"]},
      {"callId": "call-001", "status": "unknown", "effect": "unknown", "reconciliationRef": "reconcile:document-write:1", "contentRefs": ["artifact:write:uncertain"]}
    ]
  }
}
```

Paired output keeps both canonical results and shows the selected view:

```json
{
  "kind": "context.observations-shaped",
  "payload": {
    "preparationId": "prepare:turn-001:round-002:r0",
    "orderedCallIds": ["call-001", "call-002"],
    "observations": [
      {"callId": "call-001", "status": "unknown", "visibleText": "The document write outcome is unknown. Reconcile before retrying.", "rawArtifactRefs": ["artifact:write:uncertain"], "reconciliationRef": "reconcile:document-write:1"},
      {"callId": "call-002", "status": "success", "content": [{"type": "text", "artifactRef": "artifact:search:text"}, {"type": "image", "mimeType": "image/png", "artifactRef": "artifact:search:image"}], "structuredOutputRef": "artifact:search:structured", "rawArtifactRefs": ["artifact:search:raw"]}
    ],
    "canonicalRecordsPreserved": true
  }
}
```

This inspection fixture is not authority to launch a continuation while required uncertain work remains unresolved. Execution owns that decision. For an executable baseline simulation, use two terminal successes or one success plus a known error; keep the uncertain batch on the reconciliation path.

## Scripted graph cases required

Run each case in automatic and manual mode using the same trace. These are design fixtures, not agent-performance measurements.

| Case | Expected visible path / assertion |
| --- | --- |
| Ordinary input | scope → load → instructions → history → task → tools → observations → budget → validate → publish → Prepare round launch check |
| Activated skill and metadata-only skill | Only selected skill body appears; both allowed metadata entries stay discoverable; precedence and activation provenance visible |
| Catalog change before launch | publish → bounded reprepare → scope; exact new revision/schema retained; model launch counter stays zero for discarded preparation |
| Plugin projection hook | observations → hooks → budget → validate; changed candidate revision and hook digest retained; denied mutation cannot widen authority |
| Rich parallel tool feedback | Two matching calls/results, reverse completion order, structured output plus image; stable correlation survives shaping |
| Partial tool failure | Successful peer retained; known error stays visible; next-round preparation receives complete required terminal groups |
| Unknown write | Visible uncertainty and reconciliation path; no blind retry or new main-model continuation |
| Selected MCP resource | load → resources → load; versioned text/binary evidence joins same preparation; not inserted as instruction authority |
| Resource auth/input wait | Same preparation remains pending; matched response resumes acquisition; cancellation stops without model launch |
| Selected MCP prompt | load → prompts → load → task; original user/assistant role retained; required argument missing is explicit failure |
| Child isolation | Fresh child history, selected task packet and allowed shared memory; parent-private history/memory rejected before load |
| Pruning/compaction | Existing fits/prune/compact/failure paths still work with rich observations and protected unresolved-work metadata |
| Source changes repeatedly | Bounded reprepare exhausts, settles `context_sources_unstable`, does not spin or reset main execution counters |

## Ready implementation checklist

- [ ] Add scope and observations nodes, schemas, examples and inspectable paths.
- [ ] Extend preparation/candidate/snapshot records with scope, typed sources, exact catalog bindings and generation vector.
- [ ] Correct the Tools catalog schema projection before expanding Context examples.
- [ ] Define preparation staging and distinguish dependency-contribution edges from executable steps.
- [ ] Implement all ten existing-node updates in the table, including failures and empty catalog.
- [ ] Add resources/prompts/hooks cross-edges once their owning Tools nodes exist.
- [ ] Add bounded reprepare handoff to Execution without provider retry or round-counter reset.
- [ ] Add automatic/manual scripted cases and source/call/account consistency assertions.
- [ ] Preserve saved graph edits during migration; update node-contract guide, Context research implementation status, completed plan and local README.
- [ ] Validate JSON Schemas/examples and graph output/edge correspondence, then inspect the live graph and both playback modes.

## Evidence and boundaries

Existing research records exact source revisions and behavior. [Hermes/OpenClaw Context study](context-hermes-openclaw.md) uses Hermes `ddc0e65958b326a89f6c440c76c812d31ac27e2a` and OpenClaw `e40ed06f23cb8bd939c9a6ff537eba7136074686`. It documents prompt tiers, plugin/skill sections, source snapshots and isolated or explicitly forked children. [Pi/Waku Context study](context-pi-waku.md) uses Pi `a276dabe57911253350bffb93cb7d7aff6a73261` and Waku `24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01`. It distinguishes source loading, instruction assembly, task selection, history projection and fresh child sessions. These pinned studies support reusing one Context pipeline with explicit scope; they do not establish universal defaults.

MCP resources expose text or binary content selected by host policy, with scoped availability and source-change mechanisms. Context decides inclusion; adapters own reading and authentication. [Resources specification, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/server/resources).

MCP prompts supply selected templates and user/assistant messages, including media/resources. Preserve those roles and validate arguments; exposing a remote prompt is not a grant of harness instruction authority. [Prompts specification, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts). This is explicitly a legacy protocol reference: the 2026-07-28 prompt URL failed to load during this audit, so no current-protocol prompt transport claim is made.

Tools research adds account-scoped credentials, catalog invalidation, plugins and rich result handling. [Tools architecture](tools-architecture-research.md), [connection standards](tools-connections-standards.md), [Tools capability contracts](../../../apps/web/src/features/lina/contracts/toolsCapabilities.ts), [call contracts](../../../apps/web/src/features/lina/contracts/toolsCalls.ts).

Memory owns retrieval and durable writes. Model Interface owns provider conversion/counting support. Safety owns permissions. State owns acknowledged persistence. Execution owns waiting-work lifecycle, cancellation, settlement and launch authority. Context owns the scoped, versioned model-visible projection.

Validation for this proposal: code and existing contracts inspected; primary MCP resource and legacy prompt pages read; documentation-local links and whitespace checked. No app code, real connectors, credentials, benchmarks or runtime behavior changed.
