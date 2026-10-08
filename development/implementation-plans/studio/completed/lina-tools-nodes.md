# Lina Tools nodes, capability setup and credential lifecycle

## Scope

Extend Lina's inspectable design with connection, credential, plugin, skill,
registry and tool-execution lanes. This delivers graph paths, technical contracts
and examples. It does not connect accounts, load executable plugins, run real
tools or implement concurrent simulation playback.

Grounding: [Tools architecture research](../../../../docs/research/lina/tools-architecture-research.md),
[protocol and authentication standards](../../../../docs/research/lina/tools-connections-standards.md)
and their pinned agent/source studies.

## Checklist

- [x] Add connection configuration, authentication, transport/protocol compatibility,
  discovery and monitoring nodes with unavailable/retry/disconnect branches.
- [x] Add credential-reference resolution, retrieval, validity, authorization,
  persistence, coordinated refresh and removal nodes.
- [x] Show built-in, MCP, native API and plugin registration boundaries.
- [x] Add plugin discovery, trust/compatibility, contribution loading and lifecycle.
- [x] Add skill metadata, instruction activation and resource-loading paths to Context.
- [x] Publish a revisioned registry shared by model exposure and execution.
- [x] Add resolve, validate, permissions, scheduling, dispatch, collection and publication.
- [x] Show bounded parallel eligibility, conflict ordering, preflight errors, waits,
  cancellation, joined outcomes and uncertainty/reconciliation boundaries.
- [x] Give every node JSON schemas, input variants and branch-specific output examples.
- [x] Preserve owner/account/issuer/resource/catalog/call identity across handoffs.
- [x] Keep credential values out of ordinary schemas/examples and inspector evidence.
- [x] Preserve existing user layout/notes/custom graph content during refresh.
- [x] Retire the empty Tools region; support grouped block dragging.
- [x] Keep existing auto/manual simulation routes functional and explicitly summary-only.
- [x] Update usage/contract documentation and research implementation status.
- [x] Validate graph/contracts/examples, current simulation, build and browser behavior.

## Design assumptions

All new nodes are proposed design responsibilities. Runtime dependencies and
credential-store backends remain choices for real implementation. OAuth callbacks
and private credential access appear as safe references, not exposed secret fields.
Current and legacy MCP protocol paths stay distinct. A provider connection can also
serve Input/Output, whose existing ownership remains intact.

Tools setup is driven by startup/configuration/change events or on demand. It does
not repeat plugin loading and sign-in for every model round. Detailed Tools
execution is a design route from Execute tool batch to Evaluate tool outcomes.
Current playback uses its existing scripted batch summary edge. Parallel design
support is not a claim of actual concurrent remote execution.

## Validation

Delivered 29 proposed Tools nodes and 56 maintained connections. The full graph
has 79 nodes. All new nodes have branch-specific input/output reference contracts,
with private credential references and explicit external lifecycle/answer inputs.

Validation completed:

- 170 focused architecture, contract, handoff-semantics and simulation tests pass.
- Strict Ajv Draft 2020-12 validation passes for 736 input/output examples across
  all 79 nodes. Shape validity does not implement cross-record policy enforcement.
- Web TypeScript checks and production build pass. The existing large-bundle
  advisory remains; no dependency was added.
- Browser checked all 29 new inspectors and expandable JSON schemas, the absent
  empty Tools region, grouped drag preserving the other 50 nodes, and existing
  tool-summary playback in both modes, with no page errors.
- Whitespace and local documentation-link checks pass.

Review corrected misleading fixture combinations: authentication waits now refer
to remote tools, conflict/timeout examples use actual document writes, and denied
or skipped calls are distinguished from correctable argument errors. Credential
storage failures and concurrent-refresh winner rereads have explicit graph paths.

No runtime credential access, account sign-in, plugin execution, transport
connection or concurrent playback is added. Graph contract examples are synthetic.
Current playback uses the explicitly labeled scripted batch summary edge.
