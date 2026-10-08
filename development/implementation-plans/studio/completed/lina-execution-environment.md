# Lina Execution Environment

Status: completed Studio architecture and simulation slice. Implements the accepted [research proposal](../../../../docs/research/lina/environment-research.md). Scope is Studio architecture, JSON contracts and deterministic simulation. No real container, remote worker, host command or sandbox enforcement is introduced.

## Responsibilities and boundaries

Twelve nodes resolve profile, bind workspace, acquire an environment, verify readiness, stage inputs, execute filesystem operations, start commands, manage process sessions, collect evidence, publish artifacts, reconcile work and release leases. The maintained graph has 140 nodes and 643 connections, including 100 Environment relationships.

Local execution uses the explicitly selected current-PC workspace. Configurable sandbox profiles keep command and file operations on the same declared binding. Whole-agent container/VM deployment remains independent. Tools owns action dispatch, Safety grants authority, State records exact identities and observations, and Subagents owns child lifetime. Environment release is distinct from process Stop and resource destruction.

## Checklist

- [x] Twelve maintained nodes, valid endpoints and requester-specific State, Tools, Context, Input and child routes.
- [x] Relationship layout replaces the reserved Environment region and preserves saved coordinates, notes and custom links.
- [x] Rich JSON schemas and alternative examples for profile/workspace/lease/process/artifact/lifecycle records.
- [x] Deterministic local/sandbox/remote fixtures with original operation IDs, capability limits and explicit uncertainty.
- [x] State ledger/checkpoint integration and scoped child environment assignments.
- [x] Run settings for case, backend, workspace access, sharing, network, lifetime, command deadline and output limit.
- [x] Environment evidence/snapshot inspector, response controls and existing Auto/Next/manual following integration.
- [x] Verify integrated cases, unique graph/event identities, requester returns, Stop and recovery behavior.
- [x] Verify Auto/Next parity and cross-block Planning, State and Subagent combinations.
- [x] Verify browser settings, automatic/manual traversal and JSON contracts.
- [x] Complete full Lina tests, web typecheck/build and documentation/diff checks.
- [x] Document architectural scope, defaults and unsupported live capabilities.

## Controlled cases

The selector has 26 entries: disabled/no workspace operation; local round-trip; Docker reuse; read-only mount; copied workspace; unavailable backend; missing dependency; resource exhaustion; background process; stdin; output truncation; deadline; uncertain launch; uncertain termination; stale binding; shared/separate children; disk restart; memory resume; unsupported resume; staging failure; export failure; repeated release; uncertain cleanup; pure tool bypass; external service bypass.

Disabled leaves ordinary playback intact. The other cases model declared backend capabilities and failure branches, not measured provider behavior. Requested restrictions differ from enforced restrictions; local execution claims no filesystem sandbox. Pure tools and external integrations do not acquire a workspace merely to make the graph look connected.

## Validation status

The full Lina suite passes **908 tests**, including Environment architecture, schemas/examples, deterministic scenarios, Auto/Next parity, Stop, State recovery, Planning outcomes and scoped child ownership. Web typecheck and production build pass; the existing large-chunk build warning remains. Browser checks cover modal settings, independent manual graph following, Next, automatic continuation, mismatched and matched reconciliation responses, and collapsible JSON contracts. Local documentation links and diff checks pass. These checks do not establish runtime isolation.

## Limits

Workspace files, process output, backend handles and artifact custody are controlled in-memory fixtures. Rich inspector schemas describe intended implementation contracts. No actual command, dependency installation, container provisioning, network restriction, file export or process termination happens. Reconnect and snapshots preserve only capabilities declared by the fixture; neither a saved PID nor surviving files proves a real process survived. Computer Use remains deferred.
