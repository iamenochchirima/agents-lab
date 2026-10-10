# Connected tool approvals

Research checked on 2026-10-10 against official specifications and documentation. This note informs a proposed shared tool runtime and chat UI. It does not establish that the laboratory implements these behaviors, and it makes no claims about the current ChatGPT or Claude consumer UI.

## Documented behavior

### MCP separates tool use from OAuth authorization

The MCP 2025-11-25 tools specification recommends a human who can deny tool invocations, visible tool exposure and invocation indicators, and confirmation prompts. It leaves interaction design to the application. Tools have names and schemas; names are unique within one server. Clients must treat annotations as untrusted unless they come from trusted servers. These are recommendations and trust rules, not a standardized approval storage or resume protocol. [MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

MCP HTTP authorization uses OAuth access tokens, resource audience binding, and scopes. It specifies insufficient-scope challenges and bounded step-up authorization attempts. This controls access to the protected service. The specification does not define an OAuth grant as approval of one particular generated tool invocation. Distinguishing account access from individual call approval is an application interpretation of these separate mechanisms. [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

### OpenAI has explicit call approvals

The Responses API remote MCP flow returns an `mcp_approval_request` containing an ID, server label, tool name, and arguments. A subsequent `mcp_approval_response` answers that request ID with an approve boolean. The guide explicitly says each approval applies to one tool call. Its default request for approval also covers data sharing with the remote server, rather than only mutations. [OpenAI remote MCP guide](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)

The Agents SDK evaluates `needsApproval` before execution and returns pending interruptions. The application approves or rejects the stored interruption and resumes its run state. Its security guidance requires server-owned state, authenticated and authorized reviewers, validation against stored pending calls, and atomic consumption against replay. It rejects replacement arguments or client-supplied state as authority. Consumption does not guarantee exactly-once external effects; the application must reconcile completed or uncertain effects before recovery. This is SDK guidance, not a requirement to adopt this SDK. [OpenAI Agents SDK human-in-the-loop guide](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)

### Anthropic preserves call-result pairing and denial context

Claude client tools return `tool_use` IDs and receive paired `tool_result` blocks with `tool_use_id`. Error results may set `is_error: true`. Tool results must immediately follow the corresponding tool-use message; a delayed browser decision must therefore resume the pending call rather than insert unrelated chat text between those protocol messages. [Claude tool-call lifecycle](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)

Claude Managed Agents documents per-call allow, deny, and ask outcomes. Denied calls do not execute and the agent receives an error tool result; the session continues. Confirmation events answer waiting calls, and the API rejects confirmation of a call whose evaluated permission was not ask. This establishes a first-party denial pattern. For a plain Messages API adapter, using an error result for an application denial is our proposed mapping, not a separate approval API guaranteed by Messages. [Claude Managed Agents permission policies](https://platform.claude.com/docs/en/managed-agents/permission-policies)

### AI SDK supplies an inline chat pattern

AI SDK UI renders tool parts within `messages.map(...message.parts...)`. Its example places Approve and Deny buttons beside the pending tool input and calls `addToolApprovalResponse` with the approval ID. Documented states include `approval-requested`, `approval-responded`, and `output-denied`. The guide warns that client-supplied message history can fabricate approvals and documents an experimental server approval secret. This supports an inline chat implementation; it does not establish a particular consumer product's UI. Version-sensitive API names must be checked against the repository's installed SDK. [AI SDK chatbot tool usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage)

AI SDK Core documents that `generateText` and `streamText` return approval request parts and complete; a later model call processes the decision. They do not keep a JavaScript invocation suspended for the browser. Denial can be returned to the model, and the guide suggests instructing the model not to repeat a denied call. [AI SDK Core tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)

### LangGraph interruption requires deliberate recovery boundaries

LangGraph interrupts save state through a checkpointer and resume with `Command({ resume })` using the same `thread_id`. The node restarts from its beginning on resume. The guide advises idempotent side effects before an interrupt, placing effects after approval, or separating them into another node. Its illustrative comments about running once after approval should not be expanded into an exactly-once guarantee for arbitrary external APIs. [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)

### Workflow SDK has a separate durable wait and resume contract

Workflow SDK's `"use workflow"` functions coordinate deterministic execution in a restricted runtime. `"use step"` functions have full runtime access, persist results for replay, and retry failures. Calling a step outside a workflow does not supply native retry or observability semantics. Our implication is to put model/network/tool work in steps and keep the tool-round loop and approval wait in workflow orchestration. [Workflow functions and steps](https://workflow-sdk.dev/docs/foundations/workflows-and-steps)

`createHook()` creates a serializable-payload wait; awaiting the hook suspends the workflow. A hook token routes data and does not authorize its sender. Current documentation also warns that creation alone does not commit registration. A step that publishes the token can race registration unless the workflow first awaits `hook.getConflict()`. Check the installed SDK before relying on this latest-version helper. [Workflow createHook](https://workflow-sdk.dev/docs/api-reference/workflow/create-hook)

`resumeHook()` is called outside workflow execution. Current documentation says it durably writes the receive event before publishing the wake. A failed wake may leave a durable event, and a second call can append a second payload; callers need their own request deduplication. Caller authentication and permission checks belong to the surrounding application. For the laboratory's local user, this means preserving the existing server decision checks, not adding a credential administration flow. [Workflow resumeHook](https://workflow-sdk.dev/docs/api-reference/workflow-api/resume-hook)

The Local World stores records in local JSON files but has an in-memory queue, a single-instance limit, and no authentication. Latest documentation describes re-enqueuing active records at startup; this does not turn the queue into persistent distributed infrastructure. [Workflow Local World](https://workflow-sdk.dev/worlds/local) The hosted Vercel World provides managed storage and distributed queuing for deployments on Vercel. Record which World and SDK version a run used; local execution cannot serve as evidence for hosted recovery behavior. [Workflow Vercel World](https://workflow-sdk.dev/worlds/vercel)

The AI SDK inline approval example above does not automatically create a Workflow hook, a native tool loop, or a resume route. The proposed native adapter must explicitly connect a retained review decision to the correct Workflow wait, reject duplicate/stale payloads, execute the bound call in a step, and return its result to the next model round. This is a design implication, not a claim about the current adapter. Latest sources describe Workflow 5.x; the implementation plan must check APIs and semantics against the installed version.

## Existing laboratory review contract

This is a focused code/documentation audit, not evidence of live behavior. The existing [review documentation](../../server/src/capabilities/reviews/README.md), [contracts](../../server/src/capabilities/reviews/contracts.ts), and [store](../../server/src/capabilities/reviews/store.ts) already retain invocation arguments, run and turn identity, catalog revision, source digest, connection identity, argument digest, expiry, and status. A browser decision carries `requestId`, `revision`, `argumentDigest`, `decisionId`, and `decision`, with an optional reason. The server compares these with the retained record, preserves identical repeats, and rejects conflicting or stale decisions. Dispatch claim checks the exact digest, source, catalog, and approved status. The documented run lock is single-host, not distributed.

## Proposed laboratory design

The following are design inferences and proposed contracts. The sources above motivate them but do not prescribe the complete schema.

1. Keep one shared connected-tool catalog. Account connection and per-call approval are separate actions. Keep profiles out of the user flow; internal compatibility records may remain. Avoid a native filesystem tool suite or permissions sidebar in this slice. Show each pending decision inside the assistant message that proposed the call.
2. Gate execution in the server-owned tool dispatcher. Model instructions and the browser card are useful explanations, but neither authorizes execution. Each platform adapter can retain its native pause/resume mechanism while reaching the same dispatcher for the external operation.
3. Reuse the existing retained review identity and digest contract. Persist the proposal before displaying its card. Check stale catalog/source/connection identity and changed arguments using existing fields rather than replacing the schema. Actor authorization and a separate policy revision may matter in a future multi-user deployment; they are outside this local-user slice and do not require a new administration UI.
4. Preserve the existing decision payload of `requestId`, `revision`, `argumentDigest`, `decisionId`, `decision`, and optional reason. The client echoes identity fields; the retained server record remains authoritative. Revalidate that record and its dispatch conditions before external I/O. Editing arguments creates a new proposal. Expired proposals use the documented renewal route and fresh revision, without executing or approving the call.
5. Reuse the existing single-host run lock and dispatch claim. Duplicate clicks and reconnect replays return the recorded decision/status and do not start another call. Cancellation invalidates undispatched permission; once dispatch starts, cancellation cannot promise to undo an external effect. Do not expand the existing lock's guarantee to distributed execution.
6. Record denial as a terminal tool outcome with its original tool-call ID, then let the native model loop explain or take another path. Do not throw a generic run failure or silently treat denial as successful output. A changed proposal may ask again; automatic repetition of the same denied proposal should be blocked for that turn.
7. Distinguish approved, dispatched, succeeded, failed before dispatch, and outcome unknown. Persist a stable operation ID before dispatch. Reuse a provider-supported idempotency key only for the same authorized operation. A timeout after dispatch, lost response, or worker death requires provider reconciliation or a visible unknown outcome. Do not automatically resend a non-idempotent mutation or ask the user to approve a duplicate while implying the first attempt failed.
8. Reload pending requests and terminal results from durable server records after chat refresh or worker restart. Browser memory and stream events only present those records. Platform-native checkpoints, workflow journals, or event histories remain inspectable alongside normalized approval and tool events.

For cross-platform parity, compare the visible and observable contract: a model proposes a real connected tool, the chat shows any required approval, denial never executes it, approval executes the bound call, and the actual result reaches the next model step. Temporal, Restate, LangGraph, Mastra, and Vercel may use different native suspension and durability mechanisms. A uniform chat card does not prove equal recovery guarantees.

## Narrow verification for the eventual implementation

Use a small deterministic test connector with an observable call ledger for dispatcher checks, followed by one real connected read and one approval-gated operation for each enabled platform. A fixture proves lifecycle control; it does not replace proof of actual connector use.

- Pending, denied, expired, cancelled, stale-revision, and changed-argument calls produce zero external invocations.
- One approval survives refresh and resumes the original tool call; duplicate decision submissions do not dispatch twice.
- A denial reaches the model as a paired tool outcome and remains visible in the original chat message.
- A lost response after an external mutation yields an unknown outcome and no automatic duplicate mutation.
- Each platform exposes its native run identity and persistence limits. A transient implementation does not claim restart survival.

Use deterministic local checks for these boundaries. Use the configured free model only for a short real tool smoke path, keeping model behavior separate from dispatcher correctness. This is a proposed validation scope, not evidence that these checks have passed.
