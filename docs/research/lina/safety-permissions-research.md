# Lina Safety and permissions research

Reviewed 2026-10-08. This is a research synthesis and proposed graph design. It does not add Safety nodes, change running permission policy, or implement a grant store. The current graph and deterministic playback are design tools, not evidence of production enforcement.

Implementation follow-up on the same date: the [completed Safety slice](../../../development/implementation-plans/studio/completed/lina-safety-permissions.md) now applies this proposal to the graph, JSON inspector and fixture playback. The dated research below retains its preimplementation findings; live enforcement and durable storage remain pending.

## Recommendation

Use five nodes: Resolve policy, Evaluate operation, Await approval, Manage permission grants, and Authorize execution. Keep the four agreed choices: Allow once, Allow for this session, Always allow this scope, and Deny. The earlier three-node proposal needs two explicit responsibilities for policy resolution and grant lifecycle.

This is Lina's proposed baseline, inferred from the sources below. The reference agents have different boundaries and defaults; they do not establish one universal permission architecture. These five nodes describe responsibilities without requiring five services or a new policy-engine dependency.

## Evidence and scope

The supporting studies contain immutable source links, detailed observations, limitations, and the current Lina contract audit:

- [Hermes and OpenClaw](safety-hermes-openclaw.md), distinguishing inspected source from newer official documentation.
- [Pi and Waku](safety-pi-waku.md), including tool hooks, project trust, graph calls, and cancellation.
- [Current Lina design and runtime audit](safety-existing-design-audit.md), with exact node/edge IDs, JSON record sketches and required branch coverage.
- [Approval choices](approval-modes-research.md), the narrower study that prompted this full review.

No reference agent was exercised against live accounts. Source inspection establishes what the inspected paths implement, not the security of every deployment. Web specifications and official documentation were checked on the review date; versioned URLs below retain the protocol era.

### What the agents contribute

| Agent | Observed approach | Consequence for Lina |
| --- | --- | --- |
| Hermes | CLI supports once/session/always/deny. Approval keys and persistent rules depend on the adapter and command pattern. Different frontends expose different choices. | Preserve the chosen lifetime and explicit matcher. Do not equate a protocol option's UI kind with its internal grant lifetime. |
| OpenClaw | Separates tool access, execution policy and operation approval. Current documentation describes exact command grants and differently scoped Gateway MCP grants. | Tool visibility, account authentication and permission to execute are distinct. Define matching per adapter, including final arguments, account and target where required. |
| Pi | Core tool hooks support blocking; approval policy can come from extensions. Resource-loading trust has session and stored decisions but is separate from operation permission. Hooks may mutate inputs after validation. | Revalidate transformed arguments before permission evaluation. A trusted project or enabled plugin is not blanket permission for its operations. |
| Waku | Inspected loop/registry and graph-function paths do not supply the complete reusable operation-grant lifecycle. | Future graph execution must use the same authorization boundary as model-selected tools. Do not mistake one gated loop for coverage of every executor. |

The linked source studies qualify these statements by revision. In particular, they do not claim all Hermes gates share one matcher or that Pi/Waku have no permission features anywhere.

### Primary web sources beyond the four agents

ACP v1 supplies `session/request_permission`, explicit option IDs, UI kind hints, and selected/cancelled outcomes. A client may resolve requests automatically using user settings. Its standard kinds do not separately name session-only permission. Record the actual selected option, its configured lifetime, and the decision source; a wire response alone does not prove human review. [ACP tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls)

MCP recommends the ability to deny invocations and confirmation interfaces, but does not prescribe one UI. It requires treating annotations as untrusted unless they come from trusted servers. A tool advertising a read-only hint cannot assign itself permission. HTTP authorization is a transport-level OAuth concern; STDIO credentials follow a separate environment-based path. Neither replaces Lina's decision on the proposed operation. [MCP tools, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), [MCP authorization, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)

Claude Code documents deny-before-ask-before-allow rule evaluation. A saved allow does not bypass a matching ask rule, and hooks cannot override managed deny/ask requirements. This supports explicit precedence and policy ceilings. It does not mean Lina should copy Claude Code's modes or matcher syntax. [Claude Code permissions](https://code.claude.com/docs/en/permissions)

LangChain's human-in-the-loop middleware pauses selected calls and resumes with per-action decisions using checkpointed graph state and a thread identity. Its approve/edit/reject/respond choices describe workflow responses, not reusable grant lifetimes. Multiple interrupted calls require distinct decisions; responding as an ask-user tool must not be interpreted as denial of a side-effecting call. Lina keeps its agreed four choices and explicit wait IDs. Any future edit action must revalidate the changed request. [Human-in-the-loop documentation](https://docs.langchain.com/oss/python/langchain/human-in-the-loop)

Cedar provides a useful principal/action/resource/context request shape, default denial and forbid-overrides-permit rules. It skips policies that error and reports diagnostics; it does not universally deny on evaluation errors. Lina should explicitly withhold dispatch when required policy evidence is unavailable or erroneous. That is our proposed application rule, not a claim about Cedar. No Cedar dependency is proposed. [Cedar authorization semantics](https://docs.cedarpolicy.com/auth/authorization.html)

## Boundaries

| Concern | Owner and meaning |
| --- | --- |
| Sender admission | Input decides whether and how an incoming request enters a conversation. An admitted sender has not thereby approved a tool action. |
| Project/plugin trust | Capability setup decides which code/configuration may load. Loaded code does not create its own operation grants. |
| Connector/provider authentication | Existing protected credential and connection owners bind accounts and token audiences. Safety stores references, never secret tokens. |
| Tool visibility | Tools/Context select the permitted catalog. Omission can reduce exposure; appearing in context does not authorize execution. |
| Operation permission | Safety evaluates one validated operation and any applicable reusable grants. |
| Waiting and controls | Execution owns retained waits, settled siblings, Stop, and continuation authority. Input correlates responses. |
| Effects and retries | Tools owns scheduling, dispatch, result certainty and retry/reconciliation. Authorization is not proof of completion or replay safety. |
| Environment isolation | Future Environment enforces filesystem/process/network boundaries. A permission prompt is not a sandbox. |
| Evidence | Existing telemetry records the decision, reasons and references with redacted review data. It must not expose credentials or sensitive argument values unnecessarily. |

## Proposed nodes

| Exact ID and label | Inputs | Outputs and responsibility |
| --- | --- | --- |
| `lina-safety-policy`, Resolve policy | Principal, workspace/agent scope, trusted policy configuration and revision request | Versioned rules, scope ceilings, precedence, required-review mode and supported grant choices; denied/unavailable branches. The model cannot amend trusted rules. |
| `lina-safety-evaluate`, Evaluate operation | Validated final operation, policy result, grant lookup response | Allowed, denied, approval-required or unavailable with reasons and binding references. Evaluation performs no external effect. |
| `lina-safety-approval`, Await approval | Exact request, displayed matcher, eligible responders, registered wait, correlated answer/control | Waiting/resolved/expired/cancelled/rejected outcomes. Four choices with explicit lifetime. Registration precedes prompt delivery. |
| `lina-safety-grants`, Manage permission grants | Tagged lookup/commit/reserve/consume/release/revoke/inspect commands | Match/miss and transaction evidence. Owns scope, session lifetime, acknowledged durable storage, one-use admission and revocation. Uses future State through a declared boundary. |
| `lina-safety-authorize`, Authorize execution | Evaluation/resolution, grant evidence and current queued operation/launch identity | Admission decision, then a fresh bounded dispatch decision. Rechecks bindings, policy/grant generation, live ownership and Stop immediately before launch. |

Keep these as one Safety block with clear internal branches. Grant persistence is an operation of the grants node, not another credential-storage node. Risk assessment is part of evaluation; a separate model-based reviewer is an optional later mechanism.

## Four choices and their precise meaning

| Choice | Proposed semantics |
| --- | --- |
| Allow once | Authorize one logical operation with exact final arguments and bindings. Each physical launch attempt needs fresh admission. A duplicate answer or dispatch event cannot create another operation authorization. A retry with authoritative no-effect evidence can remain the same logical operation under Tools retry policy. Unknown effects require reconciliation. |
| Allow for this session | Save a constrained matcher for the declared runtime session. It can cover subsequent matching operations within current policy. Session end invalidates it. Conversation/turn IDs do not implicitly define the permission session. Initially session grants do not survive runtime restart. |
| Always allow this scope | Commit a constrained durable grant and reuse it until revoked, expired or invalidated. Show its actual matcher before selection. A failed/unknown storage acknowledgment cannot be displayed as a successfully saved grant. |
| Deny | Refuse this pending operation. Do not quietly create a permanent deny rule. Standing denial is a separate policy-management action. |

Offer all four for the initial supported simulation operation. Protected policy or an adapter may disable unsupported scopes with an explicit reason. Never offer "always" while secretly implementing only once.

An example scope is document update, connector A, account B, workspace C, and one reviewed document target. Whether changed content is included depends on the displayed argument matcher. An exact matcher rejects any changed argument; a broader declared matcher can accept selected changes while retaining policy constraints. There is no universal wildcard scope implied by the word "always".

Proposed precedence is hard deny/scope ceiling, then mandatory review, then policy allow or eligible reusable grant, then approval where policy permits it. Missing configuration withholds launch. A grant can satisfy a policy's review requirement only if that rule explicitly permits grant reuse; an always-review rule still prompts. Session and persistent grants do not automatically delegate to children.

## Connections and execution

Tools permissions submits the post-hook, revalidated operation to Evaluate operation. Evaluation joins policy resolution and grant lookup. Known denial returns through the existing Tools no-launch outcome. A permitted request receives admission evidence and enters existing scheduling.

For review, Await approval registers the retained wait through the Tools owner and Execution before requesting Input delivery. The response follows the existing route: Input prompt correlation → Execution wait → owning Tools permission/acquisition node → Safety approval. Accepted allow choices go through grant commit. Denial, expiry and Stop keep a known no-launch result. Wrong or stale answers do not clear the real pending wait.

After scheduling, Tools dispatch requests fresh Authorize execution for the exact launch attempt. Admission before scheduling is insufficient if policy, account, arguments or grant status changed while queued. Authorization and launch must share an admission generation/fence so a change between them cannot be ignored. A future real runtime must choose the enforcement transaction or equivalent boundary; the graph alone supplies no atomicity guarantee.

Resource reads and prompt retrieval use their actual Tools acquisition owners, retaining Context preparation/dependency identity. They do not invent a model round to obtain approval. Provider-auth waits retain their separate owner and cannot be answered with an operation approval.

Parallel batches retain independent wait records and completed siblings. The simulation needs a selected-wait control, since one global `state.wait` cannot accurately represent two pending approvals. Both Auto and Next use the same transition rules. Auto advances simulation steps and pauses for explicit review choices; it does not silently fabricate human approval.

The [local audit](safety-existing-design-audit.md#graph-ready-routes) specifies proposed edge IDs and JSON records. Keep original Safety IDs for evaluate/approval/authorize and add policy/grants. No edges should point to invented State or Subagents nodes. Declare those future dependencies honestly.

## Lifecycle cases to model

The initial graph implementation should demonstrate the following rather than claim a live secure grant service:

- Policy allow, hard deny and mandatory-review rules, including a saved grant that cannot override them.
- Each of the four choices, matching grant reuse, nonmatching account/target/arguments, session end, persistence and revocation.
- Changed arguments after a hook, changed policy/account while queued, and a stale authorization rejected before dispatch.
- Two pending approvals with an independently completed sibling. Resolving or denying one retains the other.
- Wrong responder, wrong prompt, duplicate reply, expired reply and Stop before/after launch. Stop cancels the operation; it does not automatically revoke unrelated persistent grants.
- Grant commit failure and unknown acknowledgment, inspected by stable transaction ID before retry. Grant-store uncertainty and external-effect uncertainty remain different records.
- A duplicate launch attempt, a known-no-effect retry and an unknown tool effect. Permission cannot make unsafe replay safe.
- Resource/prompt approval before inference, with required versus optional Context acquisition failures preserved.
- Explicit future child scope ceilings and nondelegable grant defaults, without pretending subagent execution already exists.

Grant revocation cannot undo an already-started effect. Cancellation must preserve known results and unknown effects, rather than reporting all stopped calls as rolled back. Define the launch-versus-revocation ordering in any future real executor.

## What can be experimented with

Correct argument binding, authorized response correlation, explicit precedence, revocation checks, and retention of unresolved effects are baseline requirements. They are not optional performance treatments.

| Mechanism | Controlled comparison | Evidence to collect |
| --- | --- | --- |
| Grant scope | Exact operation versus reviewed resource/command pattern, under the same deny ceilings | Prompt frequency, overbroad matches, unexpected denials, approval latency |
| Grant lifetime | Once, session, bounded-expiry persistent grants | Reuse, review burden, stale authority exposure, revocation behavior |
| Review presentation | Per-call versus grouped review with distinct per-operation choices | Decision errors, missing decisions, wait duration and sibling progress |
| Review selection | Deterministic rules versus an optional classifier inside fixed policy boundaries | False allows/denials, escalation, cost and time; retain deterministic hard constraints |
| Policy lookup | Per-operation resolution versus revision-aware cached snapshots with mandatory final invalidation | Lookup cost, stale admissions rejected, dispatch latency |

These are proposed experiments, not measured improvements. Real evaluation requires a chosen policy, reviewer behavior, fixtures/seeds and recorded scope/version metadata. Deterministic Studio playback alone cannot establish human decision quality or remote enforcement.

## Documentation and implementation follow-up

This synthesis supersedes the Safety portion of the earlier [remaining-block proposal](revisit-planned-blocks.md#safety-and-permissions-three-nodes-new-block-development). It does not mark its pending implementation complete.

When implementation is authorized, update the active cross-block plan and paired graph manifest, Tools permission/dispatch/acquisition contracts, Input typed answers, Execution waits/cancellation, Context permission-generation references, inspector examples and simulation together. The audit identifies the exact files. Completed documents need concise corrections where their baseline changes, rather than another checklist that labels completed work unfinished.

Open implementation decisions are the production grant-store transaction boundary, exact per-adapter matcher syntax, session identity across channels/restarts, and future child delegation. Initial Studio fixtures can state these assumptions explicitly. Durable storage, OS isolation, external account sign-in and subagents remain separate implementation work.
