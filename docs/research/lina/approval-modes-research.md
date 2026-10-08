# Approval choices and grant scope

Research date: 2026-10-08. This is a focused correction to the proposed Safety block,
not a completed Safety architecture study or an implementation. Official live docs
can change; pinned source observations below identify the inspected revision.

The later [full Safety research](safety-permissions-research.md) and supporting
source studies now cover policy, grant lifecycle and final dispatch authorization.
Use that synthesis for the proposed block; this note retains the focused comparison.

## What the reference agents actually offer

### Hermes

The CLI offers **Once, Session, Always, Deny**. Once authorizes one execution;
Session allows the matching dangerous-command pattern for the session; Always
persists a command allowlist entry in configuration. Entries may identify exact
commands, globs or dangerous-pattern rules. Deny blocks the requested command.
These choices are separate from `approvals.mode` (`smart`, `manual`, `off`). Hard
deny rules still take precedence. Messaging surfaces need not expose the CLI's
full choice set. [Official Security guide](https://hermes-agent.nousresearch.com/docs/user-guide/security/)

ACP documents `allow_once`, `allow_session`, `allow_always` and `deny`, with
session grants cleared when the session ends and permanent grants surviving it.
A host can answer a permission request programmatically; a protocol response
does not itself prove a person saw a prompt. [Official ACP guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp/)

At source revision `0e21933114c911075782d5744cee5403996d38ae`, the generic ACP
bridge conditionally offers `deny_always` with wire kind `reject_always`, but
maps it to the ordinary internal `deny` answer. This code alone does **not**
establish a durable denial rule. The session option uses wire kind
`allow_always` while its distinct option ID remains `allow_session`; preserve
both instead of interpreting the wire kind as persistence.
[Permission bridge source](https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/acp_adapter/permissions.py)

Available choices also depend on the gate: the inspected edit-approval adapter
offers only allow-once and deny. Lina should therefore advertise options per
request rather than assume every operation supports every scope.
[Edit approval source](https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/acp_adapter/edit_approval.py)

### OpenClaw

Exec approvals offer **Allow once, Allow always, Deny**. Durable permission is
scoped: generated command grants bind exact argument vectors and working
directory. The documented generated-rule format changed in 2026.8.1; older
rules without directory binding are inactive after upgrading. Its Gateway-owned
MCP integration instead binds agent, configured server and tool name, allowing
any arguments for that tool. Neither means "allow everything forever."
[Official Exec approvals guide](https://docs.openclaw.ai/tools/exec-approvals)

Execution policy modes (`deny`, `allowlist`, `ask`, `auto`, `full`) answer how
admission operates. Approval choices answer what authority this particular
decision grants. Always-ask policy can still require a prompt despite a durable
grant. Adapter and policy constraints determine whether a lasting grant is
available. [Official Exec approvals guide](https://docs.openclaw.ai/tools/exec-approvals)

### Pi

At `a276dabe57911253350bffb93cb7d7aff6a73261`, Pi's official permission-gate
extension example intercepts dangerous bash calls and presents Yes/No. Without
interactive UI it blocks those calls. It does not implement session or durable
grants. This is an extension example, not evidence that every Pi installation
has that gate or that Pi's complete trust system is binary.
[Official extension source](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/examples/extensions/permission-gate.ts)

### Waku

At `24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01`, the inspected agent loop sends
model tool requests directly to `ToolRegistry.execute`; the registry invokes
the registered function and catches failures. Neither path supplies a generic
once/session/always approval service. Tool-specific or operating-system prompts
are a different concern. This observation is limited to those paths and that
revision; it does not establish the absence of every approval mechanism.
[Agent loop](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/loop/agent.py),
[Registry](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/registry.py)

## Consequence for Lina

The [existing three-node proposal](revisit-planned-blocks.md#safety-and-permissions-three-nodes-new-block-development)
separates evaluation, approval resolution and final authorization correctly,
but its approval record captures only approved/denied lifecycle outcomes.
It does not model grant scope, a session grant store, durable grants or
revocation. That proposal has not established the complete Safety block.

Keep those responsibilities and enrich their contracts before implementation:

- Evaluation supplies supported choices and an explicit scope description.
  Start with Allow once, Allow for this session, Always allow this scope, Deny;
  omit unsupported choices for a particular adapter or operation.
- Resolution records both lifecycle status and chosen permission scope,
  responder, operation binding, policy revision, session/tenant/account,
  issue time, expiry and grant reference. "Approved" alone loses meaning.
- Single-use authority is consumed for its bound operation. Session grants
  end with the session. Durable grants require acknowledged storage, expiry
  where applicable, inspectability and revocation; "always" means until changed
  or revoked within the displayed scope.
- Authorization rechecks live scope, policy, revocation and launch ownership.
  Changed arguments invalidate an exact-argument grant; a deliberately broader
  tool grant can admit new arguments only under its stated policy boundaries.
- Expired, cancelled, ineligible or stale answers never launch work. Denying a
  request and configuring a standing deny rule are separate operations.

Simulation should demonstrate all four offered choices, a second matching
operation using a session grant, session end, durable-grant reuse/revocation,
changed-scope rejection and a stale answer after cancellation. Keep the
automatic admission policy separate from the human's grant choice. These are
design cases with fake authority records, not live security guarantees.
