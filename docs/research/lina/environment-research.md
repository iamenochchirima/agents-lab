# Lina Execution Environment research and node proposal

Reviewed 2026-10-08. Status: accepted proposal implemented in Studio architecture and deterministic playback; validated design simulation. No live environment service is implied. Repository HEAD inspected: `f64bc6b7f7a2015039f898ab947aaa11a6bfd609`, including its existing working changes. No containers, processes, remote providers or isolation guarantees were exercised for this research.

## Accepted direction

Lina defaults to an explicitly bound current-PC workspace. A configured sandbox can instead own commands and workspace file operations. Deploying the whole harness in a container or VM remains supported as a deployment arrangement, separate from the tool execution target. Running a container does not establish a particular security guarantee without its actual mount, privilege, network and resource configuration.

This block owns the operational environment available to the agent. It does not move conversation storage, credentials, Memory, model-provider calls and every external integration into one sandbox. Tools declare their execution placement. An external API or remotely hosted MCP server keeps its own execution boundary. A local stdio MCP server needs an explicit placement decision; a sandbox setting for shell commands alone does not isolate that server.

## Evidence and source reports

- [Hermes and OpenClaw](environment-hermes-openclaw.md): current defaults, sandbox configuration, process/session behavior, subagent sharing and browser placement.
- [Backends, Pi and Waku](environment-backends-and-patterns.md): tool adapters, filesystem consistency, Docker limits, managed sandbox lifecycle and recovery capabilities.
- [Existing Lina audit](environment-existing-design-audit.md): graph and contract seams, reusable controlled module, required cross-block updates and implementation gaps.

The proposal below is Lina's design synthesis. Its node names are not claimed to be an upstream standard. Source implementations provide evidence for responsibilities, not a universal twelve-node architecture.

## Findings that change the design

### Deployment, placement and authority are separate

OpenClaw keeps its Gateway outside ordinary tool sandboxing and sandboxes workspace execution. Hermes offers a local terminal backend and alternate execution backends. These support configuring the execution target independently of harness deployment. Their source behavior and configuration differences are recorded in the comparative report.

Safety still authorizes an action. Tools resolves its adapter. Execution Environment supplies the actual workspace, backend and execution resources. A ready container, a selected workspace or an accepted parent plan grants no new action permission.

### One workspace view requires an adapter contract

Commands and file tools should use the same declared workspace binding. That is a requirement for Lina, not a guarantee automatically supplied by Docker or every upstream bridge. OpenClaw documents file-tool limits for container-only storage. Pi's separate shell and file operation adapters mean replacing the shell alone does not replace file access. Unsupported file locations must produce an explicit unsupported result, never an unnoticed host read.

Bind mounts refer to the Docker daemon's host. A remote daemon cannot mount a directory merely because it exists on the client PC. Writable binds modify the backing host files; mounting over a container directory hides its previous contents. A copied project is a different storage arrangement from a live writable mount. [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/)

### Requested restrictions differ from enforced restrictions

Containers need explicit resource configuration. Docker does not impose CPU and memory limits by default. Local execution also cannot claim hard isolation merely because a working directory and timeout were selected. Record requested limits, backend-supported limits and observed enforced limits separately. A local shell working directory and restricted file-tool roots do not confine unrestricted shell access. [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/)

Containers use host isolation mechanisms and restricted capabilities; they are not equivalent to a separate VM kernel. Alternatives such as gVisor change the syscall boundary. The backend's isolation mechanism belongs in the descriptor rather than a generic `secure: true` flag. [Docker security](https://docs.docker.com/engine/security/), [gVisor architecture](https://gvisor.dev/docs/architecture_guide/intro/)

### Files surviving does not prove processes survive

Provider stop/start, pause/resume, process reconnect and image snapshots have different semantics. The backend report distinguishes them. Persist a process handle with its environment generation and capability evidence. A checkpoint or saved PID alone does not establish that the original process still exists, its output is retrievable, or its effects did not happen. Restoring filesystem or memory snapshots does not roll back external API effects.

### Stop, release and destruction are different operations

Stop targets the exact owned operation or process tree. Releasing one agent's environment lease can leave shared or detached work running. Destruction is a separate lifecycle action, only for managed resources under the responsible owner, after required output custody and outstanding work have been accounted for. A local user-owned project directory is never a managed disposable resource.

## Proposed graph nodes

Use one block with three connected groups: binding and preparation; workspace operations; recovery and lifecycle. Local, Docker and remote backends are branches of these responsibilities, not duplicate copies of the graph.

| Node ID | Label | Responsibility and input → output |
| --- | --- | --- |
| `lina-environment-profile` | Resolve environment profile | Trusted run/agent preferences and execution placement → versioned local/sandbox/remote profile, limits and supported capabilities, or refused/unavailable profile. |
| `lina-environment-workspace` | Bind workspace | Requested project, agent scope and inherited/separate workspace policy → stable workspace identity, roots, access modes and sharing agreement, or invalid/conflicting binding. |
| `lina-environment-acquire` | Acquire environment | Profile/workspace plus original acquisition identity → attached local environment, created/reused managed backend and scoped lease, or known failure/unknown provisioning. |
| `lina-environment-ready` | Verify environment readiness | Environment identity/generation and required capabilities → actual mount/runtime/dependency/resource observations and readiness receipt, or missing capability/stale binding/unavailable dependency. |
| `lina-environment-stage` | Stage workspace inputs | Admitted attachment/artifact references and authorized destination → bounded verified import or existing shared-file binding; conflict, failure or uncertain transfer stays explicit. |
| `lina-environment-files` | Execute filesystem operation | Admitted read/list/search/write/edit request, exact workspace and path constraints → result/patch receipt and provenance, or refused/unsupported/unknown effect. |
| `lina-environment-start` | Start command | Admitted command, cwd, environment variables by private reference, limits and persisted launch intent → correlated process handle or known terminal result/known-unstarted failure/unknown launch. |
| `lina-environment-process` | Manage process session | Exact process handle and admitted status/log/input/signal request → running/terminal observation, output cursor or control receipt. Reconnect never means launch again. |
| `lina-environment-collect` | Collect execution evidence | Correlated process/file/transfer updates → bounded output, exit/signal/deadline evidence and independent effect certainty; preserve raw evidence and partial output. |
| `lina-environment-artifacts` | Publish workspace artifacts | Selected files and custody/retention policy → immutable retained artifact references with origin/digest/access, or pending/failed export. A pathname alone is not durable custody. |
| `lina-environment-reconcile` | Reconcile environment work | Original acquisition/launch/control/transfer identity and saved observations → known running, known terminal, proven unstarted, unavailable or still unknown; no blind replay. |
| `lina-environment-release` | Release environment | Exact lease, lifecycle owner, outstanding work and artifact custody → lease released, managed resource retained/removed, already released, deferred or cleanup uncertain. |

The twelve nodes are proposed responsibility boundaries, not a mandatory twelve-step path per call. Readiness can be reused only while its binding/generation remains valid. Context reads and subsequent calls reuse the existing workspace. A pure arithmetic tool and an external API tool bypass workspace execution.

Browser environment creation can later use profile/acquire/ready/release. Browser interaction remains with the deferred Computer Use block. Do not add fake browser interaction playback in this slice.

## Required connections and changes to existing owners

| Existing owner | Integration |
| --- | --- |
| Turn Execution | Start or first workspace demand binds a profile/workspace. Required environment readiness can suspend preparation using the existing wait owner. Stop routes exact active process controls through Tools/Environment. Required uncertain work retains reconciliation before settlement/release. |
| Tools | Capability resolution declares placement and supported operations. Scheduling preserves dependencies and resource conflicts. Dispatch routes workspace calls to Files/Start/Process, retaining call/attempt identity. Collect receives environment evidence, never a second independently settled tool result. |
| Safety | Authorize exact filesystem/command/control/import/export actions and setup actions that create resources or expose mounts/network. Effective environment and workspace digests join the existing operation binding. Changes invalidate stale approvals before launch. |
| Context | Workspace source requests read through the same bound environment. Return selected content and provenance to the original Context requester. Publish bounded runtime/dependency metadata, not secrets or an entire filesystem inventory. |
| Input | Attachment custody remains with Input/State. Stage consumes already admitted references and returns environment-local handles, preserving original custody. |
| State | Conditional records for environment leases/bindings, launch intents, process handles/cursors, lifecycle requests and artifact custody. Checkpoints refer to exact generations and original operations; restoration asks Reconcile before assuming external resources are usable. |
| Subagents | Child packet records inherited/shared versus separate workspace/environment binding. Acquires a child lease without gaining broader access. Attached Stop targets child-owned work; detached work retains its explicitly assigned supervisor owner. Detachment requires an admitted ownership change. Shared environment removal cannot terminate another owner's active work. |
| Planning | Task execution bindings reference the actual environment operation/attempt. Failed process output or uncertain effects cannot satisfy a task acceptance criterion automatically. |
| Output and delivery | Consumes retained artifact references later. Environment artifact publication does not send a user message or promise that a temporary sandbox path remains accessible. |

Every asynchronous setup, transfer, inspection and result must return to its recorded requester. An Environment readiness wait must not return a Context request as a tool completion, or start a fresh agent turn.

## Contract records to define before implementation

Use the existing rich JSON Schema inspector with examples for each alternative input/outcome. The following are record requirements, not finalized runtime APIs.

| Record | Required information |
| --- | --- |
| Profile | Profile reference/revision/digest, backend kind/version, deployment placement metadata, isolation mechanism, declared operation capabilities, requested/effective limits, network mode, image/template digest and private connection/credential references. |
| Workspace binding | Workspace ID/generation, environment namespace, logical root and backend path mappings, origin copy/bind/remote volume, access modes, canonical allowed roots, symlink behavior, sharing scope, user-owned/managed ownership, revision and conflict policy. |
| Environment lease | Environment ID/generation/backend instance identity, lease ID/owner/expiry, creation/acquisition operation identity and fingerprint, shared consumers, attached/detached lifecycle owner and ready receipt. |
| Operation intent | Existing run/turn/agent/call/attempt IDs, operation/fingerprint, environment and workspace generation, authorization/binding digests, request reference, launch phase, deadline and control owner. |
| Process handle | Provider/session/process identities, generation, local PID where meaningful, process-group scope, foreground/background lifetime, stdin/PTY capability, output cursors, status/exit/signal facts and effect certainty. |
| Artifact custody | Artifact ID/version/digest/size/type, originating workspace/process/operation, durable storage reference, access scope, retention/expiry and transfer receipt. Raw output and secret-bearing contents remain private. |
| Lifecycle/recovery receipt | Original operation and owner, observation time, backend inspection capability, known created/running/terminal/unstarted/removed or unknown outcome, retry/reuse eligibility with reason. |

Avoid a single ambiguous `timeout`: distinguish call wait/yield, process deadline, output-retention expiry, lease expiry and cleanup timeout. Avoid a single `success`: process exit, tool effect certainty, artifact retention and whole task acceptance are different facts.

Illustrative command launch intent, showing the minimum correlation fields rather than a complete JSON Schema:

```json
{
  "kind": "environment.command.intent",
  "runId": "run:example",
  "agentId": "main",
  "callId": "call:build",
  "attemptId": "attempt:build:1",
  "operationId": "operation:build:1",
  "environmentId": "environment:project",
  "environmentGeneration": 2,
  "workspaceId": "workspace:project",
  "workspaceGeneration": 1,
  "backend": "docker",
  "cwd": "/workspace",
  "requestRef": "private:command:build",
  "authorizationRef": "authorization:build:1",
  "bindingDigest": "sha256:illustrative-binding",
  "deadlineMs": 120000,
  "phase": "intent-recorded",
  "effectCertainty": "not-started"
}
```

## Recommended defaults and configurable choices

- Local execution uses the explicitly selected current workspace. It does not advertise an enforced filesystem sandbox or hard network isolation.
- Configurable Docker execution uses a declared image/template and workspace sharing policy. Never silently mount the whole home directory or switch back to host execution after sandbox failure.
- Reuse the environment across tool calls. Hold separate per-agent leases. Sharing an environment is distinct from sharing a writable workspace or process control rights.
- Children inherit the parent's environment profile/access ceiling and ordinarily its workspace binding. A separate worktree, copied workspace or separate backend is configurable. Writable sharing requires existing resource-conflict handling; unknown command writes may require a workspace barrier.
- Persist command launch intent before dispatch. Background sessions must have an explicit lifetime owner. Parent release does not erase a detached child's supervisor lease.
- Missing dependencies are reported. Installation/build steps run only through admitted setup actions. Record resulting image/runtime revision; do not silently auto-install arbitrary dependencies from a readiness check.
- Requested resources that the backend cannot enforce remain unsupported or advisory in the result. Profiles may require a capability and refuse weaker execution.
- Cleanup releases borrowed resources and removes only resources owned by the designated lifecycle manager. Export required artifacts first. Failed cleanup remains inspectable and retryable by original identity where supported.

Exact numeric resource limits and default sandbox network access should be defined in versioned profiles rather than invented as universal upstream defaults. The user has accepted local-first/configurable sandbox; mounting, network and isolation profile values remain explicit implementation decisions to confirm against the intended use case.

## Simulation coverage proposed for the block

Use the same reducer for Auto and Next and retain manual graph following. Cases should demonstrate:

1. Local workspace command writes a file; file tool reads that same file.
2. Docker creation and subsequent reuse; read-only mount refuses a write; copied workspace does not mutate the original.
3. Missing backend/image/dependency and required-resource unsupported, without host fallback.
4. Profile/mount change before launch invalidates readiness and existing authorization binding.
5. Foreground exit, background yield/status/log cursor/input, command deadline and output truncation with retained evidence.
6. Launch acknowledgement lost; reconnect original process when supported; proven unstarted permits admitted retry; no inspection leaves uncertainty.
7. Stop known-running work, uncertain termination, process-tree handling and successful sibling preservation.
8. Child shares workspace, child gets separate workspace, conflicting writes ordered, detached child keeps its lease.
9. Restart loses process state while files remain; pause preserves only declared backend capabilities; stale process IDs rejected.
10. Attachment import success/conflict/unknown transfer; artifact export success/failure; cleanup blocked until required custody exists.
11. Lease release without destruction, repeated cleanup, borrowed workspace preserved and managed cleanup acknowledgement lost.
12. Context workspace reads return to Context; external API/MCP calls retain their own placement; a deferred browser capability is unavailable honestly.

These are designed branches, not measured isolation or durability. Actual provider/container tests belong to later runtime implementation.

## Experiments versus correctness

Useful comparisons include shared versus separate child workspaces; warm reuse versus ephemeral environments; copied inputs versus bind mounts; local versus remote execution under the same dependency/image controls; output retention strategies; environment allocation and startup overhead; snapshot/reconnect approaches under precisely declared backend capabilities.

Measure task success, latency, startup cost, resource consumption, conflict rate, artifact retention and recovery outcomes with the same commands, model/task controls, image/dependency versions and failure timing. Isolation mechanisms are also different security boundaries; faster execution does not establish an equivalent guarantee.

Consistent workspace routing, exact attempt correlation, explicit sharing, preserved evidence, no secret projection, and no silent host fallback are correctness requirements. They should not be weakened to manufacture an experiment.

## Implementation checklist

- [x] Review the twelve-node proposal and source audit before adding nodes.
- [x] Define profile/workspace/lease/process/artifact records and input/output alternatives.
- [x] Add explicit state request/reply routes and immutable generations to existing bindings/checkpoints.
- [x] Update Tools placement and result contracts, Context workspace requests, Input staging, Safety binding checks and Subagent environment assignment.
- [x] Implement deterministic local/sandbox/remote capability fixtures, not real infrastructure disguised as simulation.
- [x] Add Run settings for backend, workspace sharing, child assignment and lifecycle/failure cases.
- [x] Verify Auto/Next parity, graph routes, JSON examples, waits, cancellation and recovery.
- [x] Document unsupported backend capabilities and avoid claiming generic process/snapshot portability.

The implemented design has twelve Environment nodes within the current 140-node, 643-connection graph and 26 selector entries. Validation is recorded in the [implementation checklist](../../../development/implementation-plans/studio/completed/lina-execution-environment.md). Source studies remain historical evidence; simulation does not validate production sandbox enforcement. Whole-agent deployment can be documented without adding a parallel agent loop or replacing State/Memory ownership. Computer Use remains deferred.
