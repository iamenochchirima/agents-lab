# Safety and permissions in Hermes and OpenClaw

Reviewed 2026-10-08. Research for Lina's design graph and future harness. This
document records inspected mechanisms and their limits. It does not implement
Safety or establish that either agent provides complete containment.

## Evidence boundary

| Evidence | Revision | What was inspected |
| --- | --- | --- |
| Hermes local official checkout | `0e21933114c911075782d5744cee5403996d38ae` | Tool middleware, command guards, approval state/persistence, gateway waits, terminal preparation, delegation and slash authorization |
| OpenClaw local official checkout | `912685f442286233fbbd40762482d98598299497` | Tool policy, exec admission, operation bindings, durable grants, gateway approval lifecycle and channel reviewer authorization |
| Hermes upstream HEAD | `dde8800ed91c6e128064a17d5db914d74622594b` | Downloaded approval floors, gateway waits and terminal preparation were byte-identical to the local files. Gateway runner differed. Approval facade download returned HTTP 429, so its detailed findings remain local-pin claims |
| OpenClaw upstream HEAD | `d94fe35027e7f04c3220bfb7794097e01460b4e5` | Downloaded approval manager, registration, mutation authority, recovery, authorization kernel, policy, standing grants and shared gateway methods. Several changed. MCP tool binding and node approval eligibility matched the local files |
| Official guides | Accessed 2026-10-08 | Security and exec approval guidance. These pages are versionless and cannot establish behavior at an older source revision |

The upstream HEADs came from the official Git remotes. Neither local checkout
was updated. No upstream test suites, human approval exchanges, OAuth flows or
adversarial executions were run. Source inspection establishes intended checks
and ordering, not measured enforcement guarantees.

This extends [approval choices and grant scope](approval-modes-research.md).
Use the newer pins here for these observations; do not attribute them to older
OpenClaw research revisions.

## What the separate permissions mean

Both agents distinguish whether a tool belongs in an agent's available tools
from whether its requested operation may execute. Authentication is another
question: a valid connector credential supplies an account, not consent for
every operation on that account. A user allowed to chat with an agent is also
not automatically entitled to administer its permission configuration.

Hermes checks deferred tool scope before plugin hooks, checks rewritten
arguments for unusable compression markers, then runs guardrails before its
single dispatch. Plugin pre-hook exceptions are fail-open in this inspected
path, so such hooks alone cannot be described as a mandatory enforcement owner.
[Hermes tool executor][h-executor]

OpenClaw composes configured agent/provider/group/sandbox restrictions and
inherited subagent restrictions. Its name matcher checks deny patterns first.
An empty general policy allowlist means all names not denied; an explicitly
empty runtime capability list means no tools. These are distinct semantics that
Lina should represent explicitly. [Tool policy][o-tool-policy],
[tool matcher][o-tool-match]

OpenClaw describes one trusted operator boundary per Gateway, not a hostile
multi-tenant boundary. Consequently its approval infrastructure should not be
copied as proof that unrelated adversarial users can safely share Lina's process,
credentials and filesystem. [Official trust model][o-security-doc]

## Hermes

### Admission and hard denials

On the ordinary host path, `check_all_command_guards` runs catastrophic-command,
runtime-self-deletion, sudo-input and user deny checks before prepared consent,
YOLO/off, permanent allowlist and risk/prompt handling. A human answer therefore
does not override those floors on that path. Smart mode uses a separate risk
assessment, with uncertain results reaching a human and some rejected cases
limiting which grant choices are offered. [Command approval facade][h-approval],
[risk assessor][h-smart]

There is an important source qualification. The isolated-backend shortcut runs
first and returns after the user deny check. Thus the pinned combined guard does
not execute `_floor_block` for backends classified as isolated, such as Docker
without host access and the other explicitly classified sandboxes. The guide's
broad hardline wording should not be promoted into a claim that every backend
uses identical guards. Operator deny rules remain before this shortcut's allow
result. [Command guard ordering][h-approval],
[current official Security guide][h-security-doc]

Pattern/glob checks do not prove containment against every shell, interpreter,
alias or executable rename. Hermes' guide expressly distinguishes command
policy from OS restrictions. [Official Security guide][h-security-doc]

### Grants and persistence

Hermes exposes once, session, always and deny where the approval adapter permits
them. Once writes no standing grant. Session and always record dangerous-pattern
keys, which may cover more than an exact command. Always also saves the selected
profile's `command_allowlist`; explicit command/glob entries use another matching
path that refuses compound shell shortcuts. Session teardown clears in-memory
approvals and pending waits. [Grant state and persistence][h-approval],
[command/glob matching][h-floors]

Persistence and revocation have limits. Save reconciles the current on-disk
allowlist with entries newly approved by this process instead of resurrecting
deleted entries. Its comment explicitly says the approval hot path does not
reread the file. Removing an entry from configuration is therefore not evidence
of instantaneous revocation in a running process. Always also adds a session
approval, whose separate lifetime remains relevant even after permanent state
is reloaded. Save exceptions are logged;
the inspected helper does not return a durable-commit receipt. Lina should
require an acknowledged grant write before presenting durable reuse as active.
[Persistence implementation][h-approval]

ACP option IDs and wire kinds can differ. The session choice may use wire kind
`allow_always`; a reject-always-looking choice maps to internal deny in the
inspected bridge. Neither wire label alone establishes persistence. Edit
approval offers fewer choices. [ACP bridge][h-acp], [edit bridge][h-edit]

### Prompt lifetime, correlation and cancellation

Each gateway wait has a generated request ID and session-scoped queue entry.
Resolution can target that ID, the oldest entry, or all pending entries.
Committing an answer and removing its pending entry share the same lock as
timeout cleanup. Concurrent identical prompts can coalesce, but a once answer
belongs only to the leader; followers require new consent. Session/always
answers may cover matching followers. Notification failure, expiry and
interruption end the wait without execution. Cancellation carries a cause and
must not become an invented human denial. [Gateway wait][h-wait]

The queue API itself does not authenticate its caller. Chat admission and
per-platform slash access are gateway responsibilities. Slash policy separates
DM and group admin lists; without an admin list its extra gating is disabled.
Lina therefore needs trusted responder identity from its adapter, rather than
accepting any payload containing an approval ID. [Slash access][h-slash-access],
[approve/deny commands][h-slash]

### Final dispatch, automation and children

Prepared terminal approvals bind call ID, command, environment type and host
access classification. Consumption is single-use. Cancellation stops unreleased
workers; an earlier batch failure discards later prepared decisions so live
guarding runs again. Policy-derived approvals are generally not retained as
human consent. This is useful TOCTOU evidence, but not a general executable,
file-content, working-directory and policy-revision binding guarantee.
[Terminal approval preparation][h-batch]

Cron, one-shot and unattended contexts have separate configured deny/approve
handling, rather than an answerable UI being assumed. Some other noninteractive
command paths permit execution when no explicit unattended context applies;
the generic plugin-required approval gate requests fail-closed behavior when
no human bridge exists. Do not claim all headless paths fail closed.
[Approval context][h-context], [approval facade][h-approval]

Children use filtered parent toolsets, have blocked tool names and receive an
approval callback on their worker. Gateway waits already support concurrent
subagent callers; cancellation includes delegation teardown. This supports
reusing an approval service, not granting every child the parent's complete
authority. [Child toolset policy][h-child-tools], [child runner][h-child-run],
[gateway wait][h-wait]

## OpenClaw

### Tool restrictions and operation policy

OpenClaw's exec modes are projections of independent `security`, `ask` and
auto-review settings. A durable grant does not suppress `ask: always`; that
posture offers only allow-once and deny. Restrictive security and stronger ask
requirements combine through `minSecurity` and `maxAsk`. These exec settings
are separate from denying a tool name in the agent's capability inventory.
[Exec types][o-core], [local policy][o-policy]

For projected Codex MCP calls, explicit server/tool approval mode outranks the
prepared session posture. Auto mode asks on destructive or insufficiently safe
annotations. A read-only hint can affect this configured decision, but a server
annotation is not independently verified proof of harmless behavior.
[MCP approval posture][o-mcp-posture]

### Grant subjects and storage

Allow-once uses an explicit consume operation, preserving the decision for audit
while refusing another redemption. Allow-always may create a reusable command
rule. Generated argument grants bind argv and working directory, while older
unbound generated rules are inactive. Separate exact-command markers exist;
therefore not every persisted rule has identical grain. [Approval manager][o-manager],
[command matching][o-command], [durable matching][o-always]

MCP grants target an exact agent, configured server and tool, with any arguments.
They are snapshotted during registration/preparation, not reread at every tool
call. Durable MCP binding uses the actual active run authority object plus call,
server and tool identity and requires exactly one matching owner. A copied run ID
is insufficient. These facts require explicit refresh/revocation policy; a saved
grant alone does not establish instant removal from an existing prepared thread.
[Grant loader][o-mcp-grants], [run-owned binding][o-mcp-binding]

Cron standing grants additionally bind agent, job, job configuration revision
and operation binding. Use checks revocation, expiry, current job revision and
the original allow-always approval row. They can expire or remain valid until
revoked, according to the minted terms. A grant is permission for matching work,
not evidence that a previously executed side effect may be replayed safely.
[Current cron standing grants][o-current-grants]

### Request and reviewer lifecycle

The local manager persists/registers an approval before delivering it or waiting.
Records retain source session/run/tool call, requester, eligible reviewer devices,
runtime epoch and expiry. First terminal decisions and allow-once consumption
have durable owner operations. A repeated response is not a new authorization.
Aborted run authority prevents a pending request from remaining usable.
[Local manager][o-manager], [gateway request methods][o-methods]

Channel replies undergo plugin actor authorization and must select an eligible
account matching the request. The shared gateway resolution uses this custody
when filtering the pending record. Approval IDs alone do not establish a
reviewer's authority. [Channel custody][o-custody],
[shared gateway resolution][o-shared]

Prompt timeout or unavailable UI defaults to denial, but configured `askFallback`
can permit an allowlisted or otherwise policy-eligible operation. It remains a
fallback decision, not a human answer. Live authorization revalidates that
fallback against current policy. [Official exec guide][o-exec-doc],
[current authorization kernel][o-current-kernel]

### TOCTOU, cancellation and newer upstream changes

Delayed human and auto-review decisions bind the persisted policy snapshot.
Launch authorization rejects stricter policy, revoked matches or an incompatible
snapshot rather than using stale consent. Current upstream moved that logic into
an authorization kernel and commit owner; this is more than a presentation check.
[Local authorization][o-authorization], [current kernel][o-current-kernel],
[current commit path][o-current-authorization]

Node execution keeps a canonical plan. Executable identity checks and selected
mutable script/file bindings detect drift. The file binding is intentionally
limited and can refuse work it cannot bind safely; it is not proof that every
interpreter dependency is frozen. [Execution identity binding][o-system-binding]

Current upstream adds guarded approval mutation and recovery after uncertain
storage results. A stale caller refusal is distinct from corruption and must
not settle another owner's pending waiter. Recovery remains tied to the captured
physical persistence target and admitted scope. These current-file findings
must not be attributed to the older local manager. [Current mutation authority][o-current-authority],
[current registration][o-current-registration], [current recovery][o-current-recovery]

Subagent tool policies include fixed role/depth denials and stored inherited
capabilities. Exec approvals bind active delegated runtime authority and abort
signals. A parent selecting a child does not automatically enlarge the child's
capabilities or give it unbounded standing grants. [Subagent policy][o-tool-policy],
[current runtime authority][o-current-authority]

## Implications for Lina, not observed agent behavior

The five responsibilities policy, evaluate, approval, grants and authorize fit a
small Safety block. Grant storage internals can be backing records and connections
to State, rather than one new graph node per database operation.

| Responsibility | Required information and behavior |
| --- | --- |
| Resolve policy | Produce the effective versioned rules for requester/agent/session/automation scope. Keep tool access, automatic admission and supported consent scopes separate. Report which authoritative restrictions cannot be overridden |
| Evaluate operation | Consume validated final arguments, tool/adapter/account/owner bindings, resource targets, effect class and current policy. Enforce hard deny before grants or automatic admission. Return allow, deny or approval-required, reason/rule refs and adapter-supported choices |
| Resolve approval | Register pending identity before delivery. Retain exact reviewed operation, grant scope, eligible responders, policy revision, expiry and parent/run/session ownership. Distinguish explicit deny, timeout, unavailable delivery, cancellation and storage uncertainty. Record the selected choice, not only approved/denied |
| Grant lifecycle | Once is consumed atomically by its operation. Session grants end with their owner session. Durable grants require acknowledged storage and explicit matching/revocation/expiry. Persist provenance and expose actual broadness, such as exact arguments versus any arguments for one tool |
| Authorize dispatch | Recheck final arguments/target/credential-binding revision, active run ownership, live policy and grant status immediately before side effects. Changed requirements return to evaluation. A consumed approval does not authorize a retry of an uncertain side effect |

Tools continues to own argument/schema validation, scheduler admission and actual
dispatch. Input supplies trusted identity and routes the correlated reply.
Execution retains suspended ownership, cancellation and settled siblings. State
owns durable policy/grant records. Connector authentication stays with the
credential lane. Model-generated text, retrieved instructions and MCP hints
must not create authority by themselves.

The simulator should show once versus matching second use, session end, durable
write failure/reuse/revocation, changed arguments/account/target/policy,
ineligible/duplicate/late answers, timeout without UI, Stop before launch,
cancelled subagent authority and a denied parallel call with a successful peer.
Show an acknowledged unknown tool effect requiring reconciliation rather than
turning its approved status into permission to repeat it.

Automatic risk assessment, broader grant matching and confirmation UX can be
experiment choices. Hard-deny precedence, honest scope, exact reply correlation,
final currentness and preserved uncertain-effect ownership are implementation
requirements for the chosen policy, not benchmark options to omit silently.

Open questions for implementation are Lina's trust boundary, revocation freshness
for already prepared tool inventories, grant backend/transactions, adapter-specific
target fingerprints and which operations support session or durable consent.
The inspected agents supply mechanisms and trade-offs, not a universal answer.

[h-approval]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/approval.py
[h-floors]: https://github.com/NousResearch/hermes-agent/blob/dde8800ed91c6e128064a17d5db914d74622594b/tools/approval_floors.py
[h-wait]: https://github.com/NousResearch/hermes-agent/blob/dde8800ed91c6e128064a17d5db914d74622594b/tools/approval_gateway_wait.py
[h-batch]: https://github.com/NousResearch/hermes-agent/blob/dde8800ed91c6e128064a17d5db914d74622594b/agent/terminal_approval_batch.py
[h-context]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/approval_context.py
[h-smart]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/approval_smart.py
[h-executor]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/agent/tool_executor.py
[h-slash-access]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/gateway/slash_access.py
[h-slash]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/gateway/slash_commands.py
[h-child-tools]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/delegate_tool_toolsets.py
[h-child-run]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/delegate_tool_child_run.py
[h-acp]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/acp_adapter/permissions.py
[h-edit]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/acp_adapter/edit_approval.py
[h-security-doc]: https://hermes-agent.nousresearch.com/docs/user-guide/security/
[o-tool-policy]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/agent-tools.policy.ts
[o-tool-match]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/tool-policy-match.ts
[o-core]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/infra/exec-approvals-core.ts
[o-policy]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/infra/exec-approvals-policy.ts
[o-command]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/infra/exec-command-resolution.ts
[o-always]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/infra/exec-approvals-allow-always.ts
[o-manager]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/gateway/exec-approval-manager.ts
[o-methods]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/gateway/server-methods/exec-approval.ts
[o-shared]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/gateway/server-methods/approval-shared.ts
[o-custody]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/gateway/approval-channel-custody.ts
[o-mcp-posture]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/mcp-codex-tool-approval.ts
[o-mcp-grants]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/infra/exec-approvals-mcp.ts
[o-mcp-binding]: https://github.com/openclaw/openclaw/blob/d94fe35027e7f04c3220bfb7794097e01460b4e5/src/infra/mcp-tool-approval-binding.ts
[o-authorization]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/infra/exec-approvals-authorization.ts
[o-system-binding]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/infra/system-run-approval-binding.ts
[o-current-kernel]: https://github.com/openclaw/openclaw/blob/d94fe35027e7f04c3220bfb7794097e01460b4e5/src/infra/exec-approvals-authorization.kernel.ts
[o-current-authorization]: https://github.com/openclaw/openclaw/blob/d94fe35027e7f04c3220bfb7794097e01460b4e5/src/infra/exec-approvals-authorization.ts
[o-current-authority]: https://github.com/openclaw/openclaw/blob/d94fe35027e7f04c3220bfb7794097e01460b4e5/src/gateway/exec-approval-authority.ts
[o-current-registration]: https://github.com/openclaw/openclaw/blob/d94fe35027e7f04c3220bfb7794097e01460b4e5/src/gateway/exec-approval-registration.ts
[o-current-recovery]: https://github.com/openclaw/openclaw/blob/d94fe35027e7f04c3220bfb7794097e01460b4e5/src/gateway/exec-approval-recovery.ts
[o-current-grants]: https://github.com/openclaw/openclaw/blob/d94fe35027e7f04c3220bfb7794097e01460b4e5/src/gateway/operator-approval-standing-grants.ts
[o-exec-doc]: https://docs.openclaw.ai/tools/exec-approvals
[o-security-doc]: https://docs.openclaw.ai/gateway/security
