# Execution Environment: Hermes and OpenClaw

Reviewed 2026-10-08. Source study for Lina's architecture and deterministic simulation. No upstream environments, commands, recovery experiments or benchmarks were executed.

## Evidence boundary

Fresh isolated shallow checkouts were inspected, preserving the repository's sibling reference checkouts. Official live documentation was cross-checked; pinned source links govern implementation claims.

| Agent | Revision | Commit timestamp |
| --- | --- | --- |
| Hermes | `d94b70f675205c2c046138997819428772cd2678` | 2026-10-08T12:41:27-07:00 |
| OpenClaw | `d76f6ec74ec63dafea02cfda258bdcf6ad055a52` | 2026-10-08T13:40:14-07:00 |

These are development revisions, not a claim about every released installation. An SSH target establishes execution placement, not proof of restricted filesystem or network access.

## Two runtime decisions

Whole-agent deployment and tool execution placement are independent. Hermes distinguishes running Hermes in Docker from using Docker as its terminal backend. OpenClaw tool sandboxing leaves the Gateway outside; plugins and MCP tools may remain Gateway-side. Therefore a single `sandboxed` boolean cannot accurately classify all capabilities. [Hermes deployment][h-deploy], [OpenClaw capabilities][o-capabilities]

Lina's accepted local default is consistent with both systems. Hermes selects a local terminal environment. OpenClaw defaults ordinary sandbox mode off; implicit exec placement resolves to the Gateway, while an explicit unavailable sandbox fails closed. A remotely deployed Gateway sees that machine as its local host, not the user's desktop. [Hermes dispatcher][h-terminal], [OpenClaw exec][o-exec-doc]

## Hermes

### Commands and files share a configured environment

The dispatcher resolves backend, effective task identity and cwd, then obtains a cached environment under a creation lock. Backends include local, Docker, SSH, Singularity, Modal, managed Modal, Daytona, Vercel Sandbox and plugins. `BaseEnvironment` owns command execution, wait/timeout behavior, session setup, cwd tracking and bounded file fetching. Capabilities differ: some adapters cancel by stopping an entire sandbox, so safe bounded probing is explicitly opt-in. [Dispatcher][h-terminal], [environment contract][h-base]

File tools use the same configured environment creation path, even when a file read happens before the first shell command. They resolve the same container/task identity and cache `ShellFileOperations` against the active environment. This supports a common Lina workspace binding; it does not imply every external integration executes there. [File tools][h-files]

Cwd state, shell lifetime and environment lifetime are separate. The base snapshots shell state, wraps commands and parses a per-command cwd marker; a killed command without that marker retains the previous cwd. PTY and persistent-shell availability should be capabilities, not universal promises. [Base environment][h-base], [terminal description][h-terminal]

### Sharing, persistence and cleanup

Current persistent Docker is profile-scoped: sessions and delegated children can share a long-lived container. Explicit shared keys allow trusted profiles to share. Nonpersistent Docker uses session identities; child aliases follow the parent's environment. Image/backend overrides can create isolation, but a cwd-only override is not proof of isolation. [Scope resolution][h-terminal]

Persistent mode mounts managed host home/workspace directories. Optional host-cwd mounting exposes the actual project at its mapped container path. Nonpersistent unmounted workspace/home use tmpfs. Reuse checks labels/configuration; persistent cleanup normally leaves the container running across Hermes process exits, with configurable teardown/reaping. Filesystem survival does not guarantee live process survival. [Docker mounts, reuse and cleanup][h-docker]

### Processes and recovery limits

The registry tracks background sessions, bounded output, owners, completion notifications and explicit process actions. Terminal background execution returns a session ID; local PTY and `persist_on_release` are distinct settings. A deliberately retained process can outlive ordinary agent cleanup. [Registry][h-process], [terminal description][h-terminal]

Checkpoint recovery probes host PID start-time identity to avoid adopting or signalling a recycled PID. Recovered host processes are detached: status/stop remain possible, but pipes/output are not reattached. Non-host PIDs are skipped when the environment handle is gone. Recovery never re-executes the saved command. This is a concrete limit on any claim of generic process recovery or exactly-once execution. [Checkpoint recovery][h-checkpoint]

### Browser and artifacts

Browser providers have separate placement/session lifecycles, including local CDP attachment and cloud providers. Terminal sandbox selection must not be presented as isolating every browser. Computer Use remains deferred for Lina. [Browser documentation][h-browser-doc]

`BaseEnvironment.fetch_file` provides bounded environment-to-host transfer. Gateway media path translation resolves container paths through actual sandbox roots and mounts, warning when a producing sandbox was pruned or its path unresolved. A returned file path alone is not a durable exported artifact. [Transfer][h-base], [media translation][h-media]

## OpenClaw

### Policy, identity and provisioning

Mode (`off`, `non-main`, `all`), scope (`agent`, `session`, `shared`) and backend are separate settings; default scope is agent. Non-main includes group/channel sessions. Role-required sandboxing and workspace-qualified identities can tighten ordinary configuration. Docker, Podman, SSH, OpenShell and Crabbox are available choices at this pin, with different capabilities. [Modes][o-modes], [configuration][o-config]

Context construction resolves ownership/workspace, prepares skills, creates the backend and optional browser, then attaches a filesystem bridge. Backend handles expose runtime identity, cwd validation, exec construction, optional finalization and termination-only cleanup custody. Environment acquisition and admission of a specific process are distinct. [Context][o-context], [backend handle][o-handle]

Docker defaults include read-only root, no network, dropped capabilities and tmpfs. The minimal image does not include Node. One-time setup runs after creation, not per tool call; revoked/incomplete setup is retained for inspection and rejected later rather than blindly replayed. These are readiness states worth modelling. [Configuration][o-config], [images][o-images], [setup lifecycle][o-setup]

### Workspace access and file-tool limitations

Workspace access is `none` (isolated workspace), `ro` (shared agent workspace read-only) or `rw` (shared workspace writable). Extra mounts and skills mirroring are explicit. SSH/OpenShell shell restrictions depend on remote policy: a workspace access label alone does not enforce remote shell restrictions. [Workspace][o-workspace]

Docker file tools currently require a host-backed bind projection. Image/tmpfs/volume storage may be visible to exec but unavailable to file tools; hidden host files must not be read instead. The bridge rejects unprojectable paths. Thus the conversational “all tools see every file” is a Lina consistency goal, not an exact OpenClaw guarantee. Unsupported paths require explicit failure or another supported access operation. [Docker limits][o-docker-doc], [filesystem bridge][o-fs]

### Process ownership and cancellation

Exec can finish synchronously, yield a handle for ordinary continuing work, or explicitly start an independent service. Process actions inspect status/output, supply input and request termination. Clearing a record is not termination. The process registry is in memory with bounded retention; handles must not be represented as durable across restart. [Lifecycle][o-background], [registry][o-process]

Exec suppresses late tool updates on invocation disposal; request ownership separately retains cancellation of ordinary commands after yield. Explicit independent background services have different ownership. Node/cloud-worker background commands may survive between turns in the same environment, while retirement/movement/replacement stops them. Unconfirmed physical cleanup remains pending. Stop, process termination, environment retirement and record deletion therefore need separate paths. [Exec implementation][o-exec-run], [worker lifecycle][o-background]

Pruning uses runtime/browser registries, timestamps, backend managers and generation/ownership checks. Failures are logged rather than reported as successful removal. Current defaults are 24 idle hours and seven-day maximum age; these are configurable upstream defaults, not universal best values. [Pruning][o-prune], [constants][o-constants]

### Browser and external tools

Sandbox browser execution uses a separate Docker browser container/control bridge with its own image/network/binds. Unsupported backend capabilities fail explicitly. Browser tool policy is also independent. Plugins/MCP can be permitted by normal and sandbox policy while remaining Gateway-side; placement cannot silently move an external service. [Context][o-context], [configuration][o-config], [capabilities][o-capabilities]

## Graph-ready implications for Lina

The following are inferred responsibilities, not upstream nodes with these exact names.

| Responsibility | Output/branch |
| --- | --- |
| Resolve environment policy | Local default or explicit sandbox profile; required placement per capability |
| Bind scope and ownership | Environment ID/generation, workspace owner, agent/session/run scope, created vs attached |
| Provision or attach | Ready handle, unavailable backend, incomplete setup, stale configuration |
| Prepare workspace | Canonical cwd, copied/mounted roots, access modes, child assignment |
| Prepare runtime/resources | Image/dependencies, network policy, limits and readiness |
| Resolve filesystem operation | Backend path/bridge, access checks or explicit unsupported result |
| Admit/start process | Operation/attempt ID, environment generation, cwd, owner and persistence intent |
| Observe/interact | Handle, output cursor/truncation, status, stdin/PTY capability |
| Stop and reconcile | Requested termination vs observed stop; unknown is not retry-safe |
| Export artifacts | Source environment/path, bounded transfer, retained destination/acknowledgement |
| Reconnect/recover | Probe identity/state before replacement or retry |
| Release/retain/retire | Ownership-aware cleanup, live process/export checks, pending failure |
| Optional browser capability | Separate placement/profile/session and capability-based provisioning |

Tools owns action/adapter selection; Safety authorizes access; Execution Environment owns workspace/process lifecycle; State retains identities/observations; Subagents assigns shared/private environments; Output consumes exported artifacts. Lina must never delete user-owned projects during environment cleanup. That last rule is a Lina recommendation, not an audited universal upstream guarantee.

Useful simulation cases: local command/file round-trip; sandbox unavailable without host fallback; read-only mount; missing dependency/setup failure; truncated output; yield then stdin; timeout; unconfirmed termination; stale generation; reuse vs recreation; shared-child conflict vs private workspace; export before ephemeral cleanup; unsupported process recovery; unavailable browser capability. These represent branches, not measured isolation or performance.

## Sources

[h-deploy]: https://github.com/NousResearch/hermes-agent/blob/d94b70f675205c2c046138997819428772cd2678/website/docs/user-guide/docker.md
[h-terminal]: https://github.com/NousResearch/hermes-agent/blob/d94b70f675205c2c046138997819428772cd2678/tools/terminal_tool.py
[h-base]: https://github.com/NousResearch/hermes-agent/blob/d94b70f675205c2c046138997819428772cd2678/tools/environments/base.py
[h-files]: https://github.com/NousResearch/hermes-agent/blob/d94b70f675205c2c046138997819428772cd2678/tools/file_tools.py
[h-docker]: https://github.com/NousResearch/hermes-agent/blob/d94b70f675205c2c046138997819428772cd2678/tools/environments/docker.py
[h-process]: https://github.com/NousResearch/hermes-agent/blob/d94b70f675205c2c046138997819428772cd2678/tools/process_registry.py
[h-checkpoint]: https://github.com/NousResearch/hermes-agent/blob/d94b70f675205c2c046138997819428772cd2678/tools/process_registry_checkpoint.py
[h-media]: https://github.com/NousResearch/hermes-agent/blob/d94b70f675205c2c046138997819428772cd2678/gateway/platforms/base.py
[h-browser-doc]: https://hermes-agent.nousresearch.com/docs/user-guide/features/browser/
[o-capabilities]: https://github.com/openclaw/openclaw/blob/d76f6ec74ec63dafea02cfda258bdcf6ad055a52/docs/gateway/sandboxing/supported-capability-matrix.md
[o-exec-doc]: https://github.com/openclaw/openclaw/blob/d76f6ec74ec63dafea02cfda258bdcf6ad055a52/docs/tools/exec.md
[o-modes]: https://github.com/openclaw/openclaw/blob/d76f6ec74ec63dafea02cfda258bdcf6ad055a52/docs/gateway/sandboxing/modes-scope-and-backend.md
[o-config]: https://github.com/openclaw/openclaw/blob/d76f6ec74ec63dafea02cfda258bdcf6ad055a52/src/agents/sandbox/config.ts
[o-context]: https://github.com/openclaw/openclaw/blob/d76f6ec74ec63dafea02cfda258bdcf6ad055a52/src/agents/sandbox/context.ts
[o-handle]: https://github.com/openclaw/openclaw/blob/d76f6ec74ec63dafea02cfda258bdcf6ad055a52/src/agents/sandbox/backend-handle.types.ts
[o-images]: https://github.com/openclaw/openclaw/blob/d76f6ec74ec63dafea02cfda258bdcf6ad055a52/docs/gateway/sandboxing/images-and-setup.md
[o-setup]: https://github.com/openclaw/openclaw/blob/d76f6ec74ec63dafea02cfda258bdcf6ad055a52/docs/gateway/sandboxing/setup-command.md
[o-workspace]: https://github.com/openclaw/openclaw/blob/d76f6ec74ec63dafea02cfda258bdcf6ad055a52/docs/gateway/sandboxing/workspace-access.md
[o-docker-doc]: https://github.com/openclaw/openclaw/blob/d76f6ec74ec63dafea02cfda258bdcf6ad055a52/docs/gateway/sandboxing/docker-backend.md
[o-fs]: https://github.com/openclaw/openclaw/blob/d76f6ec74ec63dafea02cfda258bdcf6ad055a52/src/agents/sandbox/fs-bridge.ts
[o-background]: https://github.com/openclaw/openclaw/blob/d76f6ec74ec63dafea02cfda258bdcf6ad055a52/docs/gateway/background-process.md
[o-process]: https://github.com/openclaw/openclaw/blob/d76f6ec74ec63dafea02cfda258bdcf6ad055a52/src/agents/bash-process-registry.ts
[o-exec-run]: https://github.com/openclaw/openclaw/blob/d76f6ec74ec63dafea02cfda258bdcf6ad055a52/src/agents/bash-tools.exec-run.ts
[o-prune]: https://github.com/openclaw/openclaw/blob/d76f6ec74ec63dafea02cfda258bdcf6ad055a52/src/agents/sandbox/prune.ts
[o-constants]: https://github.com/openclaw/openclaw/blob/d76f6ec74ec63dafea02cfda258bdcf6ad055a52/src/agents/sandbox/constants.ts
