# Connected business-agent foundation

Research date: 2026-10-08. Scope: official protocol/provider documentation and
read-only inspection of the current Lab. This records design evidence for a
standalone implementation plan; it does not report implemented changes or new
model trials.

The implementation observations below describe the planning baseline. Later
partial implementation and its verification are tracked in the
[standalone plan](../../development/implementation-plans/platforms/completed/connected-business-agent-tools.md).

## Goal and architectural boundary

Keep model decisions, orchestration, context, state and recovery native to each
platform. Share the boundary for connected tools, credentials, authorization
and retained execution evidence. Filesystem access is an optional external tool
provider; the harness must not create or manage agent workspaces. Lab evidence
storage and reading trusted skill packages are infrastructure responsibilities,
not model-facing filesystem access.

## What the current implementation establishes

The [package loader](../../server/src/capabilities/extensions/packages.ts)
already binds configured MCP tools and HTTP operations without adding tool
names to native loops. Source identities, schemas and routing descriptors are
frozen at admission. The authenticated
[capability host](../../server/src/capabilities/extensions/host.ts) rechecks
the admitted tool and its permissions, reserves a durable call identity before
execution, replays confirmed receipts, and returns uncertainty for interrupted
pending receipts. Full sanitized connection evidence survives alongside native
result projections. These are useful foundations to preserve.

The current configuration still exposes native workspace packages and loads
the workspace example by default. Connected credentials are headers resolved
from environment variables once at startup. HTTP bindings have fixed paths,
GET-query arguments and otherwise JSON bodies. The MCP client supports tool
discovery/invocation over HTTP, rather than every MCP feature. Approvals are
upfront tool-name grants for a run, not approval of a particular invocation and
its arguments. These are observed limits, not claims that the existing agent
loops are simulations.

## Verified standards and interoperability

The official MCP `latest` transport, authorization and tools URLs resolved to
**2026-07-28** when inspected. That revision has per-request metadata and removes
the earlier initialize/session handshake. It defines stdio and Streamable HTTP
bindings. Older integrations must use the rules of their explicitly selected
revision; a latest-version claim must not silently borrow old session rules.
[Transport overview](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports).

Streamable HTTP accepts JSON replies and request-scoped SSE. Progress/log
notifications may precede the correlated final response; final responses should
terminate the stream, but clients should recognize completion when the matching
JSON-RPC response arrives. The current client waits for EOF before parsing.
Recommendation: incrementally parse bounded SSE events, retain useful
notifications, validate the correlated envelope, then return and release the
reader without waiting indefinitely for closure. EOF before a valid result
remains an unconfirmed acknowledgement.

This revision also requires clients to mirror schema-designated `x-mcp-header`
parameters and safely encode header values. The current client does not do
that. Implement it or explicitly declare the narrower supported subset;
unsupported client interactions must fail clearly rather than appear complete.
[Streamable HTTP specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http).

MCP tools are model-invoked operations with schemas. Discovery may depend on the
authorization presented, and annotations alone should not grant authority.
Preserve result content blocks and structured content, and keep tool errors
distinct from protocol failures.
[Tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).

Resources are context data selected or incorporated by the host application.
They are not automatically executable tools or permissions.
[Resources specification](https://modelcontextprotocol.io/specification/2026-07-28/server/resources).
Prompts are reusable interaction templates; the verified 2025-11-25 page
describes user-controlled selection. The latest prompts page failed retrieval
in this research, so this note does not claim its latest semantics were checked.
[Prompts specification, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts).
Local skills remain separately versioned procedures/context, not MCP prompts
or authority grants. Resources/prompts can be added through dedicated context
adapters when a concrete workflow requires them; tools-only support should be
labelled honestly meanwhile.

## Connection identity and credentials

MCP HTTP authorization operates on behalf of a resource owner. When supported,
the specification describes protected-resource/authorization-server discovery,
target-resource binding, per-request authorization, scope challenges and token
confidentiality. Static API credentials are a legitimate separate mode, but do
not constitute implemented MCP OAuth discovery.
[MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

OAuth refresh requests go to the authorization server; if it rotates the refresh
token, the client must replace the old value. Refresh tokens must not be sent to
resource servers. [RFC 6749, sections 1.5 and 6](https://www.rfc-editor.org/rfc/rfc6749.html#section-6).

Recommended Lab design, rather than a protocol mandate: bind each admitted
source to a stable connection reference and authorization identity. Resolve
current credential material immediately before dispatch through a trusted
credential provider. Reuse the existing
[OAuthFlow](../../server/src/capabilities/integrations/oauth/flow.ts) and encrypted
secret-store boundary where applicable; record safe refresh/reconnect events.
Freeze account/resource/scope policy identity, not rotating secret bytes, in the
catalog digest. Token rotation for the same grant should not invalidate a run;
account, scope or discovered-tool changes require explicit revalidation. A
revoked or reconnect-required connection must stop before dispatch.

## General HTTP bindings and effect semantics

OpenAPI distinguishes parameters in path, query, headers and cookies from the
request body and its media type. The Lab's current fixed-path JSON adapter
cannot directly express ordinary operations such as updating `/tickets/{id}`.
Add declarative encoded path/query/header and JSON-body mappings, with an
explicit bounded serialization subset. Keep endpoint origin and credential
headers server-owned. Full OpenAPI import, multipart and binary support can
wait for concrete demand; do not claim universal API compatibility.
[OpenAPI 3.1.1 parameter and request-body definitions](https://spec.openapis.org/oas/v3.1.1.html#parameter-object).

Provider semantics matter. Stripe explicitly describes HTTP 500 mutation
outcomes as potentially indeterminate; receipt of an error response is not
universal proof that no state changed.
[Stripe low-level error handling](https://docs.stripe.com/error-low-level).
Stripe's idempotency contract retains the first result for a key, including
500s, and compares subsequent request parameters. Its policy is an example,
not a guarantee transferable to arbitrary APIs.
[Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests).

Current hosted HTTP operations use one transport attempt and no provider
idempotency key. They return all non-2xx writes and successful-write output
schema mismatches as ordinary failed tool feedback. A model can then issue a
new call identity, bypassing receipt deduplication.

Recommendation: record dispatch/effect certainty separately from result
presentation validity. Distinguish known rejection, confirmed effect with
invalid response shape, and uncertain effect. Choose retry/reconciliation rules
from explicit source contracts. Preserve an action's provider idempotency key
across retries where supported; never invent an exactly-once guarantee.
Uncertain writes should produce a reconciliation path rather than model-driven
blind repeats. A successful write's malformed output must not erase the fact
that the write was acknowledged.

## Admission and invocation authorization

Keep server checks at both stages: admission validates selected sources,
connection identity, scopes, risk classes and grants; invocation rechecks the
frozen selection, connection availability and current authorization before
effects. Existing host authentication and tool allowlists should remain.
Separate upfront permission to use a tool from approval of a sensitive business
action. If a workflow needs human action approval, bind the decision to run,
tool, normalized arguments and call identity, persist it, and resume the native
platform execution. UI checkboxes alone must not be represented as per-action
approval. These are Lab recommendations for the stated business-agent goal.

## Native approval and continuation

Mastra's official agent approval mechanism suspends before tool execution and
requires persistent snapshot storage. The installed core 1.66.0 exposes
`approveToolCallGenerate`, `declineToolCallGenerate` and `listSuspendedRuns`.
Configure the existing LibSQL integration for the baseline; snapshot recovery
does not establish recovery of arbitrary in-flight inference.
[Mastra human-in-the-loop](https://mastra.ai/docs/agents/human-in-the-loop).

LangGraph interruption resumes through checkpoint state and a stable thread.
An interrupted node starts again, so an approval node must precede side effects.
The installed 1.2.10 supports plain `interrupt` and `Command(resume=...)`; newer
typed `response_schema` examples require 1.2.12 and should not be copied here.
[LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts).

Temporal workflow Signals and conditions can retain and wait for an invocation
decision before scheduling its tool Activity. Heartbeats on Activities also
enable cancellation delivery. The current tool Activity declares a one-second
heartbeat timeout but sends no heartbeat; repair the wrapper and verify with a
real worker, rather than testing only its signal-aware core.
[Temporal message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing),
[Temporal Activity API](https://typescript.temporal.io/api/namespaces/activity).

Restate's workflow shared context exposes durable promises that can be resolved
from a shared handler. The installed 1.17.0 supports this mechanism. Use a stable
call-specific promise and validate the decision against retained pending state.
[Restate workflow shared context](https://restatedev.github.io/sdk-typescript/interfaces/_restatedev_restate-sdk.WorkflowSharedContext.html).

The Lab already has nonterminal `suspended` status and an optional runner resume
port. Extend these rather than add a parallel lifecycle. The current Chat resume
passes an untyped boolean; the LangGraph protocol has no suspended result yet.
Both need a typed invocation-review path. Keep the context turn active while
waiting and bind approval at the host as well as in native execution. Preserve
the existing Mastra workflow resume path. These recommendations concern normal
approval continuation and restart while waiting, not every possible crash.

## Implementation scope and evidence limits

Prioritize externalizing workspace tools, stable connection/credential
resolution, practical HTTP bindings, incremental MCP completion and explicit
effect outcomes. Exercise these through existing native baselines with one
controlled business workflow and a small set of meaningful checks: successful
read/update/verify, expired credential refresh, denied invocation, correlated
SSE completion, and uncertain write without repeat dispatch. Real model trials
must retain exact free-model routing and observed failures.

This research does not require a plugin marketplace, arbitrary executable
plugins, universal MCP extensions, a VM environment or production multi-tenant
hosting. It establishes boundaries needed for credible connected business
agents; future infrastructure hardening remains separately scoped.

## Follow-up plan review

Agent Skills recommends showing names and descriptions before activation, then
loading full instructions on demand. Dedicated activation tools support agents
without native filesystem access. The Lab should present only permitted metadata
to each native model before its first decision, and retain protected skill context
after activation. This is a concrete integration requirement beyond storing skill
packages. [Agent Skills integration guide](https://agentskills.io/client-implementation/adding-skills-support).

Configured-provider OAuth and MCP authorization discovery are separate compatibility
claims. The MCP path requires protected-resource and authorization-server metadata,
resource indicators and client-registration selection. Callback validation binds
issuer and per-request state before code exchange. State must also bind the Lab
connection and owner. Static bearer credentials do not implement that onboarding
flow. [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

The partial review store rejects expired decisions and can increment a proposal
revision. A suspended native execution still waits on its previous revision.
Therefore, renewal needs an explicit host-to-native transition, tested without
inference or dispatch before fresh approval. This is a repository finding, not a
protocol requirement. Pending-run worker recovery alone does not verify API-server
restart or review renewal.
