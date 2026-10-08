# Execution environments: backend boundaries and agent patterns

Reviewed 2026-10-08. Research input for Lina's Execution Environment block;
no runtime backend or graph implementation is introduced by this document.
The accepted direction is local execution in the selected current-PC workspace
by default, with configurable sandbox execution. Whole-harness deployment in a
container or VM is compatible with this direction but is a separate deployment
choice.

## Sources and limits

Docker, E2B and Daytona findings use first-party documentation retrieved on the
review date. Provider pages are mutable and describe different capabilities;
they are not interchangeable guarantees. Pi source is pinned at
`6fb2e7815167e6b19006fc526d1a5d0f5f998787` in `earendil-works/pi`, the destination
of the former `badlogic/pi-mono` repository redirect. Waku uses the existing
Studio research pin `24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01`.

No containers, cloud sandboxes or real tools were launched. This is a source
study, not isolation testing, a production security assessment or performance
evidence. Absence findings below are bounded to the inspected code paths.

## Docker: what a backend actually provides

Docker uses kernel namespaces for isolation and control groups for resource
accounting. Configuration, kernel security and daemon access remain part of the
boundary; merely selecting Docker is not a sufficient description of isolation.
[Docker Engine security](https://docs.docker.com/engine/security/).

Bind mounts expose a host path directly. They are writable by default;
read-only mounts restrict container writes. The path belongs to the Docker
daemon's host, so a remote daemon cannot directly mount a directory from the
client PC. Docker Desktop implements host sharing through its Linux VM.
[Bind mounts](https://docs.docker.com/engine/storage/bind-mounts/).

Named volumes are Docker-managed storage whose lifecycle can outlive a
container. This differs from a container's writable layer and from an explicit
host bind mount. Record the storage kind rather than describing all three as
"the workspace". [Volumes](https://docs.docker.com/engine/storage/volumes/).

`docker exec` starts a command only in a running container; the command depends
on the container's primary process and is not restarted when the container
restarts. It supports a working-directory override, per-command environment,
user, detached execution and optional terminal allocation. A restarted
container therefore does not establish successful process resumption.
[Container exec](https://docs.docker.com/reference/cli/docker/container/exec/).

Stopping a container sends its configured stop signal, normally SIGTERM, then
SIGKILL after the grace period. That is an environment-wide operation, not an
appropriate implementation of cancelling one owned command in a shared
container. [Container stop](https://docs.docker.com/reference/cli/docker/container/stop/).

Containers have no resource constraints by default. Memory and CPU restrictions
must be configured, and out-of-memory behavior is a separate failure from a
command timeout. [Resource constraints](https://docs.docker.com/engine/containers/resource_constraints/).

Files can be copied between host and running or stopped containers. Copying is
an explicit transfer, not continuing synchronization; parent directories and
ownership also matter. Artifact export should retain the transfer result before
removing its source environment.
[Container copy](https://docs.docker.com/reference/cli/docker/container/cp/).

**Implication for Lina:** the Docker adapter needs environment identity,
workspace mapping, runtime profile and actual capabilities. It must not convert
"container restarted" into "command completed", or container-wide stop into
per-tool cancellation.

## E2B: sandbox identity, process reconnection and persistence

E2B exposes an isolated Linux VM lifecycle with create, connect, pause, resume
and kill operations. Sandbox information includes an ID, template, state,
start/end timestamps and resource information. The sandbox timeout is a
lifetime setting that can be reset; it is distinct from a command timeout.
[Sandbox lifecycle](https://docs.e2b.dev/sandbox).

Background command execution returns a handle while work continues in the
sandbox. The documented reconnect pattern saves both sandbox ID and command
PID, then connects to that sandbox and command later. SDK disconnection does
not itself terminate the command. Waiting and killing are explicit operations.
This supports persistent work without treating an open client connection as
the owner of process existence.
[Background commands](https://docs.e2b.dev/commands/background).

The default pause preserves filesystem and memory, including running processes;
filesystem-only pause instead cold-boots on resume. Killed sandboxes cannot be
resumed. The documented auto-pause fallback during snapshot backlog can preserve
disk without memory, so a provider state transition must report what was
actually retained. A single generic "resume" guarantee would hide this
distinction. [Sandbox persistence](https://docs.e2b.dev/sandbox/persistence).

File APIs read and write through the same sandbox object that exposes commands.
The example API supports text and binary reads. A command-produced file and a
file-tool read can consequently refer to the same remote filesystem rather than
the harness host. [Read and write files](https://docs.e2b.dev/filesystem/read-write).

**Implication for Lina:** environment identity and process identity should be
separate records. Record observed preservation as `filesystem-only` or
`filesystem-and-memory`, and renew lifetime separately from command deadlines.
Reconnection is inspection of existing work, not permission to submit it again.

## Daytona: sessions and provider-specific preservation

Daytona separates command execution, persistent shell sessions, stateless code
execution and persistent interpreter contexts. Session commands have identities
that support status/log retrieval and input. Session enumeration exposes
commands and exit codes. Stateless interpreter execution does not imply an
empty sandbox filesystem; interpreter state and environment state are distinct.
The documentation also exposes explicit session deletion for cleanup.
[Process and code execution](https://www.daytona.io/docs/en/process-code-execution/).

The current persistence documentation distinguishes backend classes. Container
sandboxes preserve files across stop/start but clear memory and do not support
pause/resume. VM sandboxes offer memory-preserving pause/resume and hot
snapshots. GPU environments have different retention behavior. Volumes preserve
data beyond an individual sandbox. Consequently, selecting "Daytona" alone does
not establish which recovery operation is supported.
[Persistence](https://www.daytona.io/docs/en/persistence/).

Sandbox lifecycle configuration includes auto-stop/auto-delete behavior and an
ephemeral setting. Sandboxes can be retrieved by ID or name, and metadata labels
are available. Those controls matter to attachment and cleanup ownership: an
idle session can lose availability because of a lifecycle policy even though
the agent has not explicitly cancelled its work.
[Sandboxes](https://www.daytona.io/docs/en/sandboxes/).

**Implication for Lina:** normalize the intent (attach, inspect, stop owned
process, release), while retaining backend details such as session ID, command
ID, sandbox class and observed lifecycle state. Capability checks should precede
pause/snapshot routes. Environment stop, process cancellation, interpreter
context deletion and environment deletion are four different operations.

## Pi: local default with replaceable operations

Pi's bash tool defaults to a local shell subprocess with an explicit working
directory. It streams stdout/stderr, accepts a timeout and AbortSignal, and
uses process-tree termination on timeout/abort. Its injectable `BashOperations`
interface explicitly supports replacing execution with a remote system such as
SSH. The reviewed built-in operation waits for termination; it does not expose
the remote provider-style durable process reconnection record discussed above.
[Pinned bash source](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/coding-agent/src/core/tools/bash.ts#L64).

Pi separately exposes replaceable filesystem operations: `ReadOperations`
defaults to local filesystem reads/access, while edit and write have their own
operation interfaces. Replacing command execution alone therefore does not
automatically redirect file reads or writes. This is a useful existing adapter
pattern, but the caller must configure a coherent set.
[Read](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/coding-agent/src/core/tools/read.ts#L38),
[edit](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/coding-agent/src/core/tools/edit.ts),
[write](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/coding-agent/src/core/tools/write.ts).

**Implication for Lina:** select the environment once and bind all workspace
tools to it. Adapters can remain concrete implementations rather than imposing
a provider SDK on the turn loop. Built-in local operations are a legitimate
default, with their weaker recovery guarantees stated explicitly.

## Waku: do not infer an implemented sandbox from planned tools

At the reviewed pin, Waku's tool registry invokes registered Python functions;
it does not itself select an execution environment. Its experimental terminal
and browser tools are labeled skeletons that require a real sandbox/safety
surface. The implemented `delegate_task` runs Pi locally through a subprocess,
using a provided directory or a generated workspace. It applies a deadline and
collects the child transcript on its normal return path. The JSON subprocess
deadline kills the Pi process; this code does not establish verified descendant
process termination or reconnectable child execution.
[Registry](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/registry.py),
[experimental tools and delegation](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/experimental.py).

**Implication for Lina:** distinguish a tool's availability from its execution
environment. Waku contributes a concrete local workspace/delegation example;
its planned sandbox tool must not be credited as a working runtime backend.

## Proposed common contract boundary

The following is a design proposal inferred from the sources, not an existing
shared industry schema. Preserve backend-specific records beside common fields.

| Record | Required information |
| --- | --- |
| Environment request | Agent/run owner, selected backend/profile, existing environment reference or creation intent, workspace policy |
| Environment binding | Lina environment ID, backend-native ID, owner/attachment relationship, workspace root, generation, status, capabilities |
| Workspace binding | Environment ID/generation, root, copied/mounted/volume/local storage, source mapping, read/write rights |
| Process request | Stable operation/attempt ID, environment generation, working directory, executable/arguments or explicit shell command, input, timeout, output limits |
| Process handle | Lina process ID, native PID/session/command IDs, owning agent/run, state, timestamps, cancellation state |
| Process observation | Running/exited/failed/unknown, exit code/signal if known, stdout/stderr sequence or cursor, truncation, evidence source |
| Environment retention | Lease/lifetime policy, owned vs attached, active references, retain/release/delete action, export dependencies |
| Snapshot reference | Source environment generation, disk/memory coverage, backend snapshot ID, restore capabilities and constraints |
| Artifact manifest | Origin environment/process, path, media type, size/hash where known, destination, export state and retention |

Local execution's workspace root is a convenience/path convention, not a
security boundary. File containment enforced by a restricted adapter does not
contain unrestricted shell commands. Security must remain an explicit profile
and Safety decision rather than a promise implied by the directory name.

### Failure and retry rules to represent

1. Record launch intent before calling the backend. If the launch response is
   lost, state becomes uncertain; inspect by retained backend identity or
   correlation if supported. Do not invent provider idempotency guarantees.
2. Missing output connection does not prove process death. Resume observation
   from a cursor where supported; otherwise disclose an output gap.
3. Cancellation requested is distinct from cancellation confirmed. Late success
   can race cancellation; keep the actual exit/result instead of overwriting it.
4. After an environment restart, validate its generation and whether processes
   survived. A numeric PID alone is insufficient across identity/lifecycle reuse.
5. A restored filesystem or VM memory does not roll back an external API side
   effect. Existing Tools/State reconciliation must remain responsible for it.
6. Cleanup releases an attachment or owned resource under policy; it never
   deletes an attached user workspace by treating it as a temporary sandbox.
7. Export failure blocks destructive cleanup when the artifact is required.
   A path inside a deleted environment is not a retained artifact.

These are Lina requirements derived from lifecycle differences and ambiguous
distributed-call outcomes. They are not claims that every examined agent or
provider already implements them.

## Suggested graph responsibilities

Keep these responsibilities distinct, while letting the main proposal group
them into readable nodes:

- Resolve execution profile and validate required backend capabilities.
- Acquire/create/attach environment and inspect readiness.
- Bind workspace, prepare configured software and enforce resource/access profile.
- Admit the already-authorized operation to its bound environment.
- Launch and register process/file operation; stream or collect evidence.
- Inspect existing work, send input and cancel owned work.
- Renew lifetime and recover/rebind after interruption.
- Export artifacts, retain/release environment and report cleanup outcome.

The routes must accommodate local execution without pretending a PC workspace
was provisioned as an owned disposable sandbox. Remote API/MCP operations can
bypass workspace execution; moving Lina's workspace tools does not move the
remote service. Subagent orchestration selects shared or separate bindings;
Execution Environment implements that binding and retains ownership details.

## Candidate deterministic cases

For later Studio simulation: local success; Docker unavailable; invalid mount;
read-only write denied; resource exhaustion; short command; background process
and later observation; interactive input; disconnect/reconnect; uncertain
launch acknowledgement; cancellation racing completion; lease expiry; disk-only
restart; memory-preserving resume; unsupported snapshot; child shared workspace;
child separate workspace; artifact export failure; attached workspace release;
cleanup refused while an owned process remains active.

These are architecture scenarios, not benchmark outcomes. No choice here
establishes an objectively faster backend without controlled measurements.
