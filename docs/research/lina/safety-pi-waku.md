# Safety boundaries in Pi and Waku

Reviewed 2026-10-08. This study uses first-party documentation and source at
Pi `a276dabe57911253350bffb93cb7d7aff6a73261` and Waku
`24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01`, matching the revisions in the
[approval scope study](approval-modes-research.md). These are inspected revisions,
not claims about every release, extension or deployment. Sources were read from
local Git objects; official documentation was also retrieved online. No agent
was run against real accounts, and no security guarantee was experimentally proven.

## Pi: permission hooks are extensible, isolation is separate

### Resource trust and operation permission

Pi's official security guide explicitly distinguishes project trust from tool
permissions. Trust controls loading project settings, executable extensions,
skills and MCP configuration. It does not constrain filesystem or network access
by enabled tools. The working directory is not a filesystem boundary, and
extensions run with the Pi process's permissions. Instructions can still enter
context even when resource trust is declined. [Security guide](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/docs/security.md)

Pi has actual session-only and saved trust choices, including directory/parent
scope and saved denial. `ProjectTrustStore` persists canonical-path decisions in
`trust.json`, resolves the nearest directory decision, locks modifications and
removes entries when set to null. This is a useful scope/storage pattern, but
it grants resource-loading trust, not authority to execute all future actions.
[Trust implementation](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/trust-manager.ts)

### Where tools can be blocked

The agent core resolves a registered tool, prepares and schema-validates its
arguments, awaits `beforeToolCall`, handles a block as a tool error, checks
cancellation after the hook and then invokes the captured tool implementation.
Hook exceptions become errors rather than permission to proceed. This provides
an admission seam; it does not install a universal approval policy by itself.
`runToolCall` applies the same preparation and hooks to nested calls.
[Core execution](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/agent/src/agent-loop.ts)

The coding session connects that seam to extension `tool_call` handlers and
supplies nested-call correlation through `parentToolCallId`. The extension runner
awaits handlers in order and stops on a blocking result. Directly invoking an
arbitrary function outside this route is not automatically covered.
[Session hook wiring](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/agent-session.ts),
[Handler runner](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/extensions/runner.ts)

The first-party permission-gate example asks Yes/No for selected dangerous bash
patterns, rejects without an interactive UI and stores no reusable operation
grants. It is an optional example, not the default behavior of every Pi session.
Its regexes are illustrative; they do not establish comprehensive shell safety.
[Permission example](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/examples/extensions/permission-gate.ts)

Two contract details matter for Lina:

- `tool_call` input is mutable; subsequent handlers see earlier mutations, and
  the contract explicitly says arguments are not revalidated afterward. An
  approval before a later mutation could therefore describe a different action.
- Tool annotations such as read-only and destructive hints come from the tool
  author and are not verified. Exposure controls determine reachability/model
  declaration; an inactive declaration is not necessarily an unreachable tool.

[Extension contracts](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/extensions/types.ts)

### Review waits, cancellation and MCP

Extension dialogs accept a dismissal signal and timeout, but the permission
example does not pass those options. Core cancellation checks prevent execution
once an awaited hook returns after abort; they do not by themselves promptly
close a dialog or persist a recoverable approval wait. A suspended promise is
not evidence of durable suspension. [Dialog contract](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/extensions/types.ts),
[Core execution](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/agent/src/agent-loop.ts)

MCP sign-in is separate. Pi stores OAuth credentials bound to server name and
URL, refreshes them and deletes them on logout; exposing or hiding tools is a
separate setting. Successful sign-in is not a per-operation approval.
[MCP guide](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/docs/mcp.md)

The MCP tool adapter forwards the operation signal to the client. The client
rejects an already-aborted request, removes pending state when aborted/timed out
and sends a cancellation notification for cancellable requests. That settles
local waiting; it does not prove a remote side effect was rolled back.
[MCP tool adapter](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/extensions/mcp/tools.ts),
[MCP client](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/mcp/src/client.ts)

### Sandbox example limitations

Pi's sandbox extension wraps bash with filesystem/network restrictions and kills
its process group on cancellation. It also covers user-entered bash through a
separate hook. This is narrower than isolating the whole harness. When disabled,
unsupported or not initialized, the inspected implementation falls back to local
bash. Lina must distinguish optional isolation from required isolation: failure
to initialize a required environment must not silently launch unrestricted work.
[Sandbox example](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/examples/extensions/sandbox/index.ts)

## Waku: explicit tool restrictions, no generic review service in inspected paths

Waku's loop calls the registry synchronously for each model tool request. The
registry resolves by name, calls the registered Python function and converts
exceptions to error strings. These two paths contain neither a generic human
approval request nor a session/durable per-operation grant lookup. The registry
publishes input schemas, but does not itself run a general JSON Schema validator
before invocation. This is a bounded observation, not a claim that every Waku
tool lacks checks. [Loop](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/loop/agent.py),
[Registry](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/registry.py)

Registry construction gates some adapters through settings and optional extras.
A disabled experimental setting wins over the environment's default; it is not
recomputed into an accidental grant. These choices control installed capability,
not consent for a particular operation. Waku's security policy also distinguishes
inbound gateway access, experimental delegation and review of installed skills.
[Registry construction](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/__init__.py),
[Security policy](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/SECURITY.md)

The GitHub adapter implements a concrete restriction: five read-only operations,
fixed argument-vector construction and validated scalar inputs. Unsupported
operations are rejected before a subprocess exists. It uses the external `gh`
login rather than treating credential possession as permission to expose writes.
This is stronger evidence for this adapter's boundary than a model-facing
"read-only" hint. [GitHub adapter](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/github.py)

Waku MCP supports environment-held bearer credentials or OAuth, rejecting an
ambiguous configuration with both. OAuth tokens/registration persist per named
server with atomic replacement and restrictive file permissions. The bridge
registers discovered tools and invokes them without a separate generic approval
step. A connector's identity and credential store therefore remain distinct
from a Safety grant store.
[MCP bridge](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/mcp_client.py),
[OAuth storage](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/mcp_oauth.py)

The bridge waits on a submitted coroutine with a timeout. Its exception path
returns an error string without explicitly cancelling that future, so a local
timeout does not establish that remote work stopped. The gateway worker's
`cancel_futures` shutdown concerns queued tasks, not a cooperative stop protocol
for an already-running synchronous turn. Neither inspected path provides a
durable approval suspension or post-review authorization check.
[MCP bridge](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/mcp_client.py),
[Gateway runner](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/gateway/runner.py)

Graph function nodes directly invoke their supplied function, while agent nodes
reuse the loop with a scoped registry. Adding graph orchestration alone does
not introduce an authorization boundary around those function nodes.
[Graph nodes](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/graph/nodes.py)

Experimental delegation starts Pi in a selected directory with `-a`; at the
inspected Pi revision that flag trusts project-local files for the run, rather
than installing a universal tool approval mode. Waku's source calls a scratch
folder a sandbox, but that folder creation does not provide OS isolation. The
JSON subprocess timeout kills the launched process; no process-group settlement
or reversal of prior effects is established by that path. Terminal/browser
roadmap tools are honest stubs, not implemented Safety facilities.
[Delegation](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/experimental.py),
[Pi flag semantics](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/cli/args.ts)

## Implementable implications for Lina

These are recommendations drawn from the observed boundaries, not claims that
Pi or Waku implements the entire proposed Lina design.

| Responsibility | Contract implication |
| --- | --- |
| Capability installation/trust | Record source/config trust separately from operation authorization. Loading a plugin, enabling a tool or trusting a project never substitutes for permission to perform its writes. |
| Final operation preparation | Apply transforms, validate final schema, resolve immutable tool/adapter/account/environment bindings, then calculate the approval scope. Later mutation requires preparation and authorization again. |
| Evaluation | Use policy-owned metadata and verified adapter restrictions. Preserve author hints as hints; never derive automatic authority solely from `readOnlyHint`. |
| Approval | Carry operation/call identity, final binding digest, eligible responder, supported choices, timeout and owner revision. Persist retained waits through State when resumption is required. |
| Reusable grants | Separate session and durable grants from trust decisions and credentials. Include explicit matcher, expiry, revision, issuer and revocation. Reuse requires a fresh match. |
| Final authorization | After review/auth/environment waits, recheck cancellation, revocation, policy and bindings immediately before admitting dispatch. A grant does not revive a cancelled owner. |
| Nested calls and graph actions | Require the same permission route for nested tool calls, child launches and side-effecting graph nodes; preserve parent correlation. Pure graph computations need no invented approval step. |
| Environment | Tools chooses an adapter; Environment proves the required execution restrictions. If required isolation is unavailable, return blocked/unavailable rather than silently execute locally. |
| Cancellation/outcomes | Separate local cancellation, acknowledged remote cancellation and unknown external effect. Neither timeout nor closing a prompt proves that an already-started write never happened. |
| Evidence | Record decision, matcher, binding revisions, wait/resume, dispatch and settlement with secrets represented by references. Retain original adapter details beside normalized outcomes. |

Suggested deterministic design cases: hook mutates arguments after review;
annotation claims read-only while policy marks a write; nested call denied;
project trust accepted but operation denied; connector sign-in succeeds but
permission remains missing; required sandbox fails; cancellation during review;
revoked session grant; stale answer; MCP timeout with unknown side effect; direct
graph action passes the same gate. Session/durable grants are additions Lina must
specify explicitly, not behavior inferred from these two agents' reviewed core.
