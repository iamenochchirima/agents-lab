import type { ExplorerGraph } from '../types';

/** Pinned source teaching map; traces describe assumptions rather than recorded runs. */
export const openclawGraph: ExplorerGraph = {
  "id": "openclaw",
  "name": "OpenClaw",
  "repository": "https://github.com/openclaw/openclaw",
  "commit": "e40ed06f23cb8bd939c9a6ff537eba7136074686",
  "description": "Gateway, reply lifecycle, pluggable harnesses, agent loop, state, tools and independent work producers.",
  "scope": "Source-derived surface architecture. Built-in execution expanded; alternate harnesses, channels and external services remain explicit boundaries.",
  "limitations": [
    "Surface map, not executable OpenClaw or recorded telemetry; illustrative traces state assumed outcomes.",
    "Gateway and channel intake have different admission/delivery paths; no universal user-message chain is claimed.",
    "Channel adapters, native apps, provider wire protocols, browser internals and external ACP/Codex agents are collapsed boundaries.",
    "Optional plugins/capabilities require configuration; memory, compaction and background hooks are not mandatory stages.",
    "SQLite session/transcript ownership reflects the pinned source, not older JSONL/Pi runner diagrams.",
    "Surface regions group responsibilities; connections are source-backed calls/data/transition/background relationships, not one global executable state machine. Selected intermediate adapters and class layers are collapsed.",
    "2026-10-04 semantic audit inspected all mapped items; per-item evidence and unresolved deeper contracts are recorded in the OpenClaw audit ledger. Review does not establish exhaustive branch coverage or observed runtime behavior."
  ],
  "groups": [
    {
      "id": "gateway",
      "label": "Gateway lifecycle",
      "summary": "Startup, transports, authenticated dispatch and plugin owners."
    },
    {
      "id": "security",
      "label": "Identity and policy",
      "summary": "Authentication, operator access, config and live execution authority."
    },
    {
      "id": "channels",
      "label": "Channel ingress and routing",
      "summary": "Plugin adapters, normalized context and agent/session route selection."
    },
    {
      "id": "reply",
      "label": "Reply preparation",
      "summary": "Dispatch admission, commands, session setup, queues and execution."
    },
    {
      "id": "runs",
      "label": "Run orchestration",
      "summary": "Lanes, prepared runtime, candidate fallback and attempt lifecycle."
    },
    {
      "id": "harness",
      "label": "Harnesses and agent loop",
      "summary": "Built-in OpenClaw, plugin and CLI runtime boundaries."
    },
    {
      "id": "prompt",
      "label": "Prompt and replay",
      "summary": "Bootstrap, skills, prompt construction, history and provider requests."
    },
    {
      "id": "state",
      "label": "Sessions and durable state",
      "summary": "SQLite transcript ownership, admitted writes, projections and recovery."
    },
    {
      "id": "context",
      "label": "Context engines and compaction",
      "summary": "Engine selection, assembly, compaction, turn outbox and maintenance."
    },
    {
      "id": "tools",
      "label": "Tool capabilities and execution",
      "summary": "Policy, deferred catalog, admission, middleware and results."
    },
    {
      "id": "integrations",
      "label": "Execution environments",
      "summary": "Shell, files, sandbox, browser, nodes, MCP and message actions."
    },
    {
      "id": "children",
      "label": "Subagents and ACP",
      "summary": "Child launch, registry, completion, requester wake and alternate ACP backend."
    },
    {
      "id": "memory",
      "label": "Memory plugins",
      "summary": "Memory-core indexing/search and optional LanceDB recall/capture."
    },
    {
      "id": "delivery",
      "label": "Streaming and delivery",
      "summary": "Event projection, reply dispatch and source completion."
    },
    {
      "id": "background",
      "label": "Independent work producers",
      "summary": "Cron, heartbeat, HTTP hooks and plugin lifecycle extension points."
    },
    {
      "id": "operations",
      "label": "Observability and operations",
      "summary": "Diagnostics, usage, reload, worker placement and shutdown."
    }
  ],
  "nodes": [
    {
      "id": "gateway-start",
      "label": "startGatewayServerCore",
      "groupId": "gateway",
      "kind": "component",
      "summary": "Creates the resource-host scope, kernel and transport, completes startup and arranges startup-failure cleanup.",
      "source": [
        {
          "file": "src/gateway/server-start.ts",
          "line": 22,
          "symbol": "startGatewayServerCore"
        }
      ],
      "inputs": "Port, startup options and SDK resource host.",
      "outputs": "Running Gateway close handle or startup error with owned cleanup."
    },
    {
      "id": "kernel",
      "label": "createGatewayKernel",
      "groupId": "gateway",
      "kind": "component",
      "summary": "Composes Gateway runtime state, request context and server-owned lifecycle services.",
      "source": [
        {
          "file": "src/gateway/server-kernel.ts",
          "line": 123,
          "symbol": "createGatewayKernel"
        }
      ],
      "inputs": "Port/options and runtime dependency bundle.",
      "outputs": "Kernel/request context plus startup/shutdown owner handles."
    },
    {
      "id": "ws",
      "label": "WebSocket connection lifecycle",
      "groupId": "gateway",
      "kind": "component",
      "summary": "Binds handshake, message handling and cleanup to accepted WebSocket connections.",
      "source": [
        {
          "file": "src/gateway/server/ws-connection.ts",
          "line": 36,
          "symbol": "attachGatewayWsConnectionHandler"
        }
      ],
      "inputs": "Accepted WebSocket and connection runtime.",
      "outputs": "Connection state, handshake handling and close cleanup."
    },
    {
      "id": "handshake",
      "label": "Connect admission",
      "groupId": "security",
      "kind": "decision",
      "summary": "Checks preliminary connect origin, client, startup and role/scope constraints before credential and device authentication.",
      "source": [
        {
          "file": "src/gateway/server/ws-connection/connect-admission.ts",
          "line": 204,
          "symbol": "admitGatewayConnect"
        }
      ],
      "inputs": "Connect parameters, origin and startup/configuration policy.",
      "outputs": "Preliminary role/scope admission or rejection; final identity establishment follows."
    },
    {
      "id": "auth",
      "label": "Connect authentication",
      "groupId": "security",
      "kind": "component",
      "summary": "Resolves handshake authentication; rejection blocks authenticated methods.",
      "source": [
        {
          "file": "src/gateway/server/ws-connection/connect-auth.ts",
          "line": 57,
          "symbol": "authenticateGatewayConnect"
        }
      ],
      "inputs": "Connect parameters, device proof and auth policy.",
      "outputs": "Authenticated identity/method facts or rejection."
    },
    {
      "id": "device",
      "label": "Device proof",
      "groupId": "security",
      "kind": "component",
      "summary": "Validates signed device proof during connection identity establishment.",
      "source": [
        {
          "file": "src/gateway/server/ws-connection/connect-device-proof.ts",
          "line": 15,
          "symbol": "verifyGatewayConnectDeviceProof"
        }
      ],
      "notes": "Device identity proof is separate from authorization for an operation.",
      "inputs": "Device/public key, signed proof and handshake context.",
      "outputs": "Validated device proof or security rejection."
    },
    {
      "id": "operator",
      "label": "Operator access",
      "groupId": "security",
      "kind": "component",
      "summary": "Prepares the operator access facts for this connected client.",
      "source": [
        {
          "file": "src/gateway/server/ws-connection/connect-operator-access.ts",
          "line": 14,
          "symbol": "prepareGatewayConnectOperatorAccess"
        }
      ],
      "inputs": "Authenticated caller and operator profile/permissions.",
      "outputs": "Prepared operator access for this connection."
    },
    {
      "id": "rpc",
      "label": "Authenticated request dispatch",
      "groupId": "gateway",
      "kind": "component",
      "summary": "Dispatches authenticated method requests with their request lifecycle and context.",
      "source": [
        {
          "file": "src/gateway/server/ws-connection/authenticated-request-dispatch.ts",
          "line": 62,
          "symbol": "createGatewayAuthenticatedRequestDispatcher"
        }
      ],
      "inputs": "Authenticated client and validated RPC frame.",
      "outputs": "Method response/error under request lifecycle."
    },
    {
      "id": "method-auth",
      "label": "Method authorization",
      "groupId": "security",
      "kind": "decision",
      "summary": "Checks the permission requirements of Gateway methods.",
      "source": [
        {
          "file": "src/gateway/server-methods/method-authorization.ts",
          "line": 28,
          "symbol": "export function authorizeGatewayMethod"
        }
      ]
    },
    {
      "id": "chat",
      "label": "chat.send admission",
      "groupId": "gateway",
      "kind": "component",
      "summary": "Admits a chat send with prepared session, input and caller constraints.",
      "source": [
        {
          "file": "src/gateway/server-methods/chat-send-admission.ts",
          "line": 75,
          "symbol": "admitChatSend"
        }
      ],
      "inputs": "Validated message/session options and caller facts.",
      "outputs": "Bound chat admission or rejection."
    },
    {
      "id": "chat-dispatch",
      "label": "startChatDispatch",
      "groupId": "gateway",
      "kind": "component",
      "summary": "Prepares workspace/input facts, runs admitted chat reply work, and closes delivery/error lifecycle.",
      "source": [
        {
          "file": "src/gateway/server-methods/chat-send-agent-dispatch.ts",
          "line": 57,
          "symbol": "startChatDispatch"
        }
      ],
      "inputs": "Accepted request, active owner and transcript binding.",
      "outputs": "Settled dispatch/delivery result with source/error finalization."
    },
    {
      "id": "agent-rpc",
      "label": "Agent run handler",
      "groupId": "gateway",
      "kind": "component",
      "summary": "Handles agent execution RPC requests through session/model/admission owners.",
      "source": [
        {
          "file": "src/gateway/server-methods/agent-run-handler.ts",
          "line": 13,
          "symbol": "agentRunHandler"
        }
      ]
    },
    {
      "id": "config",
      "label": "Runtime configuration",
      "groupId": "security",
      "kind": "store",
      "summary": "Reads and publishes validated OpenClaw configuration through the configuration I/O owner.",
      "source": [
        {
          "file": "src/config/io.ts",
          "line": 2,
          "symbol": "createConfigIO"
        }
      ]
    },
    {
      "id": "secrets",
      "label": "Secret runtime",
      "groupId": "security",
      "kind": "component",
      "summary": "Maintains prepared secret runtime facts for configured integrations.",
      "source": [
        {
          "file": "src/secrets/runtime.ts",
          "line": 113,
          "symbol": "prepareSecretsRuntimeSnapshot"
        }
      ],
      "notes": "Secret values are excluded from this teaching map."
    },
    {
      "id": "plugins",
      "label": "Plugin loader",
      "groupId": "gateway",
      "kind": "component",
      "summary": "Loads a caller-owned plugin registry handle without changing the process-wide active registry.",
      "source": [
        {
          "file": "src/plugins/loader.ts",
          "line": 17,
          "symbol": "loadPluginRegistryHandle"
        }
      ],
      "notes": "Gateway activation uses the separate runtime-loader owner; this handle API does not itself publish an active registry."
    },
    {
      "id": "channel-registry",
      "label": "Channel plugin registry",
      "groupId": "channels",
      "kind": "component",
      "summary": "Resolves registered channel plugins and their channel-specific behavior.",
      "source": [
        {
          "file": "src/channels/plugins/registry.ts",
          "line": 75,
          "symbol": "getChannelPlugin"
        }
      ]
    },
    {
      "id": "route",
      "label": "resolveAgentRoute",
      "groupId": "channels",
      "kind": "decision",
      "summary": "Selects agent and session key from channel/account/peer/thread bindings and defaults.",
      "source": [
        {
          "file": "src/routing/resolve-route.ts",
          "line": 269,
          "symbol": "export function resolveAgentRoute"
        }
      ],
      "inputs": "Config, channel/account, peer, guild/team/thread and bindings.",
      "outputs": "Agent ID, session key, matched binding and last-route policy."
    },
    {
      "id": "session-key",
      "label": "Session key construction",
      "groupId": "channels",
      "kind": "component",
      "summary": "Constructs logical conversation keys with scope-specific identity rules.",
      "source": [
        {
          "file": "src/routing/session-key.ts",
          "line": 206,
          "symbol": "buildAgentPeerSessionKey"
        }
      ],
      "inputs": "Agent identity and configured conversation scope.",
      "outputs": "Logical session key with scope-specific identity."
    },
    {
      "id": "inbound",
      "label": "finalizeInboundContext",
      "groupId": "channels",
      "kind": "component",
      "summary": "Normalizes inbound message context fields for downstream reply preparation.",
      "source": [
        {
          "file": "src/auto-reply/reply/inbound-context.ts",
          "line": 202,
          "symbol": "finalizeInboundContext"
        }
      ],
      "inputs": "Channel/Gateway MsgContext.",
      "outputs": "Finalized context for reply preparation."
    },
    {
      "id": "dedupe",
      "label": "Inbound deduplication",
      "groupId": "channels",
      "kind": "decision",
      "summary": "Tracks inbound claims/replays so dispatch distinguishes duplicate intake.",
      "source": [
        {
          "file": "src/auto-reply/reply/inbound-dedupe.ts",
          "line": 80,
          "symbol": "claimInboundDedupe"
        }
      ],
      "notes": "Ingress replay protection does not establish exactly-once arbitrary side effects.",
      "inputs": "Inbound identity and owner claim/replay facts.",
      "outputs": "Claim/duplicate/replay state with side-effect-safe status."
    },
    {
      "id": "media",
      "label": "Inbound media staging",
      "groupId": "channels",
      "kind": "component",
      "summary": "Stages remote media under the channel/request preparation contract.",
      "source": [
        {
          "file": "src/auto-reply/reply/stage-remote-inbound-media.ts",
          "line": 21,
          "symbol": "stageRemoteInboundMediaIfNeeded"
        }
      ],
      "inputs": "Remote media and permitted local roots.",
      "outputs": "Staged media facts or explicit error."
    },
    {
      "id": "dispatch",
      "label": "dispatchReplyFromConfig",
      "groupId": "reply",
      "kind": "component",
      "summary": "Owns gather, preparation, route selection, execution and finalization; refreshes a raced session snapshot once.",
      "source": [
        {
          "file": "src/auto-reply/reply/dispatch-from-config.ts",
          "line": 27,
          "symbol": "dispatchReplyFromConfig"
        }
      ],
      "inputs": "Config/context, options and prepared dispatcher.",
      "outputs": "Dispatch result with reservation/audit lifecycle closed."
    },
    {
      "id": "gather",
      "label": "Gather dispatch request",
      "groupId": "reply",
      "kind": "component",
      "summary": "Collects request facts before dispatch preparation.",
      "source": [
        {
          "file": "src/auto-reply/reply/dispatch-from-config.gather.ts",
          "line": 67,
          "symbol": "gatherDispatchRequest"
        }
      ],
      "inputs": "Dispatch parameters and current config/context.",
      "outputs": "Request facts for operation admission."
    },
    {
      "id": "reply-admission",
      "label": "Reply admission ticket",
      "groupId": "reply",
      "kind": "state",
      "summary": "Reserves affected reply-session lanes; dispatch releases its ticket on exit.",
      "source": [
        {
          "file": "src/auto-reply/reply/reply-admission-ticket.ts",
          "line": 18,
          "symbol": "reserveReplyAdmissionTicket"
        }
      ],
      "inputs": "Affected reply session keys.",
      "outputs": "Reservation ticket released by dispatch finally."
    },
    {
      "id": "choose-route",
      "label": "chooseDispatchRoute",
      "groupId": "reply",
      "kind": "decision",
      "summary": "Selects ACP/plugin takeover or ordinary execution while coordinating source delivery.",
      "source": [
        {
          "file": "src/auto-reply/reply/dispatch-from-config.choose-route.ts",
          "line": 60,
          "symbol": "chooseDispatchRoute"
        }
      ],
      "inputs": "Prepared operation/session/delivery facts.",
      "outputs": "Handled takeover/ACP route or ordinary execution state."
    },
    {
      "id": "get-reply",
      "label": "getReplyFromConfig",
      "groupId": "reply",
      "kind": "component",
      "summary": "Resolves agent/model/workspace, inbound/session facts and directives before prepared reply execution.",
      "source": [
        {
          "file": "src/auto-reply/reply/get-reply.ts",
          "line": 234,
          "symbol": "getReplyFromConfig"
        }
      ],
      "inputs": "MsgContext, GetReplyOptions and config override.",
      "outputs": "Payloads, handled/no reply or preparation failure."
    },
    {
      "id": "directives",
      "label": "Reply directives",
      "groupId": "reply",
      "kind": "component",
      "summary": "Parses supported directives, which may produce command responses or change runtime/model selection.",
      "source": [
        {
          "file": "src/auto-reply/reply/get-reply-directives.ts",
          "line": 73,
          "symbol": "resolveReplyDirectives"
        }
      ],
      "inputs": "Command/directive input and permission/model facts.",
      "outputs": "Authorized command/model/runtime changes."
    },
    {
      "id": "reply-session",
      "label": "Reply session initialization",
      "groupId": "reply",
      "kind": "component",
      "summary": "Loads or creates reply-session state with reset and lifecycle handling.",
      "source": [
        {
          "file": "src/auto-reply/reply/session.ts",
          "line": 279,
          "symbol": "initSessionState"
        }
      ],
      "inputs": "Config and agent/session/message context.",
      "outputs": "Current/new/reset session entry and lifecycle facts."
    },
    {
      "id": "queue",
      "label": "Follow-up enqueue",
      "groupId": "reply",
      "kind": "state",
      "summary": "Enqueues accepted follow-up work under the resolved queue policy.",
      "source": [
        {
          "file": "src/auto-reply/reply/queue/enqueue.ts",
          "line": 77,
          "symbol": "enqueueFollowupRun"
        }
      ],
      "inputs": "FollowupRun, queue key and resolved policy.",
      "outputs": "Accepted/coalesced/dropped queued work as policy defines."
    },
    {
      "id": "queue-drain",
      "label": "Follow-up drain",
      "groupId": "reply",
      "kind": "component",
      "summary": "Drains queued work with retained delivery and run context.",
      "source": [
        {
          "file": "src/auto-reply/reply/queue/drain.ts",
          "line": 1027,
          "symbol": "scheduleFollowupDrain"
        }
      ],
      "inputs": "Queue key, follow-up runs and run callback.",
      "outputs": "Deferred execution with retained delivery context."
    },
    {
      "id": "turn",
      "label": "executeAgentTurn",
      "groupId": "reply",
      "kind": "component",
      "summary": "Runs fallback/retry, freezes terminal cancellation, and records execution/message-tool outcomes.",
      "source": [
        {
          "file": "src/auto-reply/reply/agent-runner-execution.ts",
          "line": 636,
          "symbol": "executeAgentTurn"
        }
      ],
      "inputs": "AgentTurnParams, admitted run and abort owner.",
      "outputs": "Run ID and completed/rejected/aborted outcome with accounting."
    },
    {
      "id": "fallback",
      "label": "Model fallback cycle",
      "groupId": "runs",
      "kind": "component",
      "summary": "Coordinates model candidate selection and execution under the admitted turn.",
      "source": [
        {
          "file": "src/auto-reply/reply/agent-runner-fallback-cycle.ts",
          "line": 11,
          "symbol": "executeAgentFallbackCycle"
        }
      ],
      "inputs": "Candidate chain, turn policy and admitted context.",
      "outputs": "Candidate result or exhausted/rejected fallback outcome."
    },
    {
      "id": "embedded",
      "label": "runEmbeddedAgent",
      "groupId": "runs",
      "kind": "component",
      "summary": "Establishes session target, lanes, runtime snapshots and requester settlement.",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run-orchestrator.ts",
          "line": 113,
          "symbol": "runEmbeddedAgent"
        }
      ],
      "inputs": "Run parameters, exact session target and model.",
      "outputs": "Embedded run result, usage and requester settlement."
    },
    {
      "id": "lanes",
      "label": "Session and global lanes",
      "groupId": "runs",
      "kind": "component",
      "summary": "Controls lane acquisition, abort progress and lifecycle generation.",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/lane-controller.ts",
          "line": 43,
          "symbol": "createEmbeddedRunLaneController"
        }
      ],
      "inputs": "Lane IDs, lifecycle generation and cancellation.",
      "outputs": "Queued lane ownership or expiry/abort before execution."
    },
    {
      "id": "run-authority",
      "label": "Admitted run context",
      "groupId": "security",
      "kind": "state",
      "summary": "Carries exact live run/operator authority into model execution, tools and guards.",
      "source": [
        {
          "file": "src/agents/admitted-run-context.ts",
          "line": 328,
          "symbol": "resolveAdmittedRunActiveAssertion"
        }
      ],
      "failures": "Closed, aborted, replaced or revoked authority must fail at use time. Retry retains the same admission.",
      "inputs": "Operational run instance and delegated/operator grants.",
      "outputs": "Assertions for the exact admitted run; release closes authority."
    },
    {
      "id": "live-run",
      "label": "Agent run registry",
      "groupId": "runs",
      "kind": "store",
      "summary": "Owns live run registration and current-liveness assertions.",
      "source": [
        {
          "file": "src/infra/agent-run-registry.ts",
          "line": 115,
          "symbol": "registerAgentRunContext"
        }
      ],
      "inputs": "Run registration and lifecycle/delegation identity.",
      "outputs": "Current liveness; revoked/replaced entries cannot authorize."
    },
    {
      "id": "prepared-model",
      "label": "Prepared model runtime",
      "groupId": "runs",
      "kind": "component",
      "summary": "Acquires lifecycle-owned provider/plugin/model facts instead of repeatedly rediscovering them.",
      "source": [
        {
          "file": "src/agents/prepared-model-runtime.ts",
          "line": 372,
          "symbol": "acquireAgentRunPreparedModelRuntime"
        }
      ],
      "inputs": "Agent/model/config and plugin-generation scope.",
      "outputs": "Scoped prepared runtime lease and snapshot."
    },
    {
      "id": "harness-policy",
      "label": "resolveAgentHarnessPolicy",
      "groupId": "runs",
      "kind": "decision",
      "summary": "Selects harness policy from runtime/model/session/configuration facts.",
      "source": [
        {
          "file": "src/agents/harness/policy.ts",
          "line": 27,
          "symbol": "resolveAgentHarnessPolicy"
        }
      ],
      "notes": "Implicit OpenAI routing can select Codex; a plugin harness is not only an explicitly configured alternative.",
      "inputs": "Provider/model/config and session/agent policy.",
      "outputs": "Runtime choice and policy source including implicit OpenAI routing."
    },
    {
      "id": "run-loop",
      "label": "runPreparedEmbeddedLoop",
      "groupId": "runs",
      "kind": "component",
      "summary": "Owns dispatch, normalization, recovery and terminal settlement while retaining admission.",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run-loop.ts",
          "line": 60,
          "symbol": "runPreparedEmbeddedLoop"
        }
      ],
      "failures": "Bounded retry budget, provider/auth review and terminal recovery may stop or fail over the run.",
      "inputs": "Prepared input, lane controller and runtime refresh.",
      "outputs": "Terminal outcome after bounded attempt/recovery loop."
    },
    {
      "id": "builtin",
      "label": "createOpenClawAgentHarness",
      "groupId": "harness",
      "kind": "component",
      "summary": "Registers built-in attempt execution and restricted settled-turn finalization.",
      "source": [
        {
          "file": "src/agents/harness/builtin-openclaw.ts",
          "line": 91,
          "symbol": "createOpenClawAgentHarness"
        }
      ],
      "inputs": "AgentHarnessAttemptParamsV2.",
      "outputs": "Built-in attempt or restricted settled-turn-finalization result."
    },
    {
      "id": "plugin-harness",
      "label": "Selected harness registration check",
      "groupId": "harness",
      "kind": "component",
      "summary": "Validates explicitly selected harness registration in the run-owned registry without loading or activating plugins.",
      "source": [
        {
          "file": "src/agents/harness/runtime-plugin.ts",
          "line": 182,
          "symbol": "ensureSelectedAgentHarnessPlugin"
        }
      ],
      "conditions": "Explicit/session-pinned nondefault runtime must be registered; implicit preferences are resolved by harness selection and may fall back.",
      "notes": "Native transport, persistence and lifecycle differ by plugin; built-in steps are not forced onto it.",
      "inputs": "Selected runtime and harness registration.",
      "outputs": "Registration validation succeeds or throws for a missing explicitly selected harness."
    },
    {
      "id": "codex-harness",
      "label": "Codex harness boundary",
      "groupId": "harness",
      "kind": "component",
      "summary": "Plugin-owned native Codex app-server execution boundary.",
      "source": [
        {
          "file": "extensions/codex/harness.ts",
          "line": 104,
          "symbol": "createCodexAppServerAgentHarness"
        }
      ],
      "notes": "Collapsed external/native harness boundary. Internal Codex behavior is not expanded without separately analyzing that implementation."
    },
    {
      "id": "cli-backend",
      "label": "CLI backend dispatch",
      "groupId": "harness",
      "kind": "component",
      "summary": "Runs eligible configured CLI-backed execution instead of the built-in attempt path.",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/cli-backend-dispatch.ts",
          "line": 29,
          "symbol": "runEmbeddedAgentViaCliBackendIfEligible"
        }
      ],
      "conditions": "Subscription-auth dispatch only; requires a caller-owned transcript target and nonempty named toolsAllow without wildcards. Excludes message_tool_only, disabled-tools and modelRun modes.",
      "inputs": "Subscription-auth opt-in and exact loopback allowlist.",
      "outputs": "CLI result or undefined if ineligible."
    },
    {
      "id": "attempt",
      "label": "runEmbeddedAttempt",
      "groupId": "harness",
      "kind": "component",
      "summary": "Owns resources and preparation for one built-in attempt under model/cancellation authority.",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt.ts",
          "line": 65,
          "symbol": "runEmbeddedAttempt"
        }
      ],
      "inputs": "Admitted model/session/tool parameters and signal.",
      "outputs": "Normalized attempt outcome plus owned cleanup."
    },
    {
      "id": "attempt-setup",
      "label": "Attempt workspace/sandbox setup",
      "groupId": "harness",
      "kind": "component",
      "summary": "Resolves effective workspace, sandbox and provider thinking/settings facts.",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt-setup.ts",
          "line": 75,
          "symbol": "prepareEmbeddedAttemptSetup"
        }
      ],
      "inputs": "Attempt configuration, model and workspace.",
      "outputs": "Effective workspace/sandbox/settings and diagnostics."
    },
    {
      "id": "agent-session",
      "label": "AgentSession",
      "groupId": "harness",
      "kind": "component",
      "summary": "Binds agent event subscriptions, tool hooks and runtime to session feature layers.",
      "source": [
        {
          "file": "src/agents/sessions/agent-session.ts",
          "line": 12,
          "symbol": "AgentSession"
        }
      ],
      "inputs": "AgentSessionConfig and session/resources/tools.",
      "outputs": "Session feature API, event subscription and hooked tools."
    },
    {
      "id": "session-prompt",
      "label": "AgentSessionPrompting",
      "groupId": "harness",
      "kind": "component",
      "summary": "Owns logical prompt activity, preparation and accepted steering/follow-up continuation.",
      "source": [
        {
          "file": "src/agents/sessions/agent-session-prompting.ts",
          "line": 47,
          "symbol": "AgentSessionPrompting"
        }
      ],
      "failures": "A concurrent ordinary prompt rejects. Accepted steering/follow-ups can be queued during the logical prompt.",
      "inputs": "Prompt/images/options and steering/follow-up context.",
      "outputs": "Logical prompt continuation or settled session events."
    },
    {
      "id": "agent-core",
      "label": "Agent",
      "groupId": "harness",
      "kind": "component",
      "summary": "Maintains agent state, streaming and steering/follow-up operations.",
      "source": [
        {
          "file": "packages/agent-core/src/agent.ts",
          "line": 293,
          "symbol": "Agent"
        }
      ],
      "inputs": "State/model/tools and stream/queue callbacks.",
      "outputs": "Agent events and updated in-memory messages."
    },
    {
      "id": "agent-loop",
      "label": "runAgentLoop",
      "groupId": "harness",
      "kind": "component",
      "summary": "Runs model turns, tool batches, steering checkpoints and follow-ups until terminal completion.",
      "source": [
        {
          "file": "packages/agent-core/src/agent-loop.ts",
          "line": 73,
          "symbol": "runAgentLoop"
        }
      ],
      "inputs": "AgentContext, loop config, stream function and signal.",
      "outputs": "Messages, model/tool events and terminal agent_end."
    },
    {
      "id": "loop-decision",
      "label": "Post-turn continuation checkpoint",
      "groupId": "harness",
      "kind": "decision",
      "summary": "After streamed and terminal tool batches, checks continuation, steering/follow-ups, provider failure, abort and terminal intervention.",
      "source": [
        {
          "file": "packages/agent-core/src/agent-loop.ts",
          "line": 332,
          "symbol": "hasMoreToolCalls"
        }
      ],
      "inputs": "Assistant outcome, tool calls, queues and abort state.",
      "outputs": "Tool batch, same-loop continuation or terminal branch.",
      "notes": "Tool batches can begin earlier during provider streaming. endTurn=false and provider continuation can request another turn even without tool calls."
    },
    {
      "id": "bootstrap",
      "label": "Bootstrap files",
      "groupId": "prompt",
      "kind": "component",
      "summary": "Loads bounded workspace instruction/context files for the selected bootstrap mode.",
      "source": [
        {
          "file": "src/agents/bootstrap-files.ts",
          "line": 397,
          "symbol": "resolveBootstrapContextForRun"
        }
      ],
      "inputs": "Workspace files and bootstrap/run mode.",
      "outputs": "Bounded instruction/context files and diagnostics."
    },
    {
      "id": "skills",
      "label": "Embedded skills preparation",
      "groupId": "prompt",
      "kind": "component",
      "summary": "Prepares allowed skills using filters and runtime state.",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/skill-runtime.ts",
          "line": 22,
          "symbol": "prepareEmbeddedSkills"
        }
      ],
      "inputs": "Workspace, skill filters and runtime facts.",
      "outputs": "Allowed skills and resource delivery state."
    },
    {
      "id": "system-prompt",
      "label": "System prompt construction",
      "groupId": "prompt",
      "kind": "component",
      "summary": "Builds prompt sections from enabled capabilities, workspace/instructions and run identity.",
      "source": [
        {
          "file": "src/agents/system-prompt.ts",
          "line": 342,
          "symbol": "buildAgentSystemPrompt"
        }
      ],
      "inputs": "Tools, workspace instructions and runtime identity.",
      "outputs": "Prompt sections matching available capabilities."
    },
    {
      "id": "prompt-prepare",
      "label": "Attempt system prompt preparation",
      "groupId": "prompt",
      "kind": "component",
      "summary": "Combines prepared prompt contributors and attempt-specific prompt reporting.",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt-system-prompt-prepare.ts",
          "line": 42,
          "symbol": "prepareEmbeddedAttemptSystemPrompt"
        }
      ],
      "inputs": "Contributors/tool catalog and provider transform.",
      "outputs": "Attempt prompt/report; raw-mode provider prompt is empty."
    },
    {
      "id": "history",
      "label": "prepareEmbeddedAttemptHistory",
      "groupId": "prompt",
      "kind": "component",
      "summary": "Sanitizes and validates replay history and prepares current prompt context; raw-model runs skip normal history contributions.",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt-history-prepare.ts",
          "line": 28,
          "symbol": "prepareEmbeddedAttemptHistory"
        }
      ],
      "inputs": "Session messages, replay policy, engine and authority.",
      "outputs": "Sanitized/validated/assembled context and prompt-authority facts.",
      "failures": "Engine assembly exception or missing result logs a warning and retains pipeline messages; current authority and other preparation checks still apply."
    },
    {
      "id": "context-guard",
      "label": "Tool-result context guard",
      "groupId": "prompt",
      "kind": "component",
      "summary": "Installs tool-result context transforms; a separate loop-hook owner can reassemble context using the selected engine.",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/tool-result-context-guard.ts",
          "line": 396,
          "symbol": "export function installToolResultContextGuard("
        },
        {
          "file": "src/agents/embedded-agent-runner/tool-result-context-guard.ts",
          "line": 359,
          "symbol": "const assembled = await contextEngine.assemble({"
        }
      ],
      "inputs": "Session budget, current engine and result policy.",
      "outputs": "Context transforms/loop guards and bounded tool representation.",
      "notes": "Engine reassembly and tool-result bounds have separate hooks and conditions; neither implies mandatory durable ingestion."
    },
    {
      "id": "pruning",
      "label": "Tool-result prompt projection",
      "groupId": "prompt",
      "kind": "component",
      "summary": "Bounds tool-result prompt projections and eligible cache-TTL expiry.",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/tool-result-truncation.ts",
          "line": 173,
          "symbol": "pruneExpiredCacheTtlToolResults"
        }
      ],
      "inputs": "Tool messages, live/cache-TTL policy and projection state.",
      "outputs": "Bounded/restored/expired projections or explicit guarded rewrite."
    },
    {
      "id": "transport",
      "label": "Provider stream preparation",
      "groupId": "prompt",
      "kind": "component",
      "summary": "Prepares provider-facing streaming for the active attempt.",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt-stream-prepare.ts",
          "line": 116,
          "symbol": "prepareEmbeddedAttemptStream"
        }
      ],
      "inputs": "Session, provider/model and stream options.",
      "outputs": "Attempt stream and callback preparation."
    },
    {
      "id": "session-manager",
      "label": "SessionManager",
      "groupId": "state",
      "kind": "component",
      "summary": "Session-tree facade for in-memory and durable session state.",
      "source": [
        {
          "file": "src/agents/sessions/session-manager.ts",
          "line": 105,
          "symbol": "export class SessionManager"
        }
      ],
      "notes": "Persistent transcript ownership is SQLite at this commit. sessionFile parameter naming does not imply JSONL persistence.",
      "inputs": "Persistent target or in-memory tree construction.",
      "outputs": "Entry/navigation/context APIs with visible persistence failures."
    },
    {
      "id": "sqlite-transcript",
      "label": "SQLite transcript accessor",
      "groupId": "state",
      "kind": "store",
      "summary": "Reads and writes transcript entries through the SQLite session owner.",
      "source": [
        {
          "file": "src/config/sessions/session-accessor.sqlite-transcript-store.ts",
          "line": 273,
          "symbol": "appendTranscriptEventsInTransaction"
        }
      ],
      "inputs": "Admitted target, transcript fields and read/write request.",
      "outputs": "Durable entries or bounded read results."
    },
    {
      "id": "writer",
      "label": "Transcript writer admission",
      "groupId": "state",
      "kind": "component",
      "summary": "Fences mutations with admitted writer context and active session generation.",
      "source": [
        {
          "file": "src/agents/sessions/session-manager-write-admission.ts",
          "line": 82,
          "symbol": "withSessionManagerWrite"
        }
      ],
      "inputs": "Session manager, writer and lifecycle generation.",
      "outputs": "Guarded mutation scope; retired writer rejects."
    },
    {
      "id": "append",
      "label": "Session transcript append",
      "groupId": "state",
      "kind": "component",
      "summary": "Appends tree entries through persistence and admitted mutation rules.",
      "source": [
        {
          "file": "src/agents/sessions/session-manager-append.ts",
          "line": 47,
          "symbol": "SessionManagerAppend"
        }
      ],
      "inputs": "Admitted entry and append parent/leaf facts.",
      "outputs": "New tree entry through persistence owner."
    },
    {
      "id": "projection",
      "label": "Session row projection",
      "groupId": "state",
      "kind": "store",
      "summary": "Maintains resident materialized session rows invalidated by owner publications.",
      "source": [
        {
          "file": "src/gateway/session-row-projection.ts",
          "line": 44,
          "symbol": "createSessionRowProjection"
        }
      ],
      "notes": "Derived resident rows are not transcript authority. Owner publications invalidate exact session identities.",
      "inputs": "Exact change publications and admitted store topology.",
      "outputs": "Derived resident/list rows, separately from transcript authority."
    },
    {
      "id": "user-transcript",
      "label": "User-turn recorder",
      "groupId": "state",
      "kind": "component",
      "summary": "Records user-turn facts using the prepared Gateway transcript binding.",
      "source": [
        {
          "file": "src/gateway/server-methods/chat-user-turn-recorder.ts",
          "line": 44,
          "symbol": "createGatewayChatUserTurnController"
        }
      ],
      "inputs": "Accepted message and exact transcript binding.",
      "outputs": "Recorded/blocked user-turn facts."
    },
    {
      "id": "cancel",
      "label": "Chat abort runtime",
      "groupId": "state",
      "kind": "component",
      "summary": "Coordinates abort of live/queued work with owning run/session lifecycle.",
      "source": [
        {
          "file": "src/gateway/server-methods/chat-abort-runtime.ts",
          "line": 631,
          "symbol": "abortChatRunsForSessionKeyWithPartials"
        }
      ],
      "inputs": "Authorized run/session, active/queued owners and reason.",
      "outputs": "Abort/cancellation plus terminal receipt under current owner."
    },
    {
      "id": "recovery",
      "label": "Session restart recovery",
      "groupId": "state",
      "kind": "component",
      "summary": "Explicit Gateway recovery surface for retained session/restart facts.",
      "source": [
        {
          "file": "src/gateway/server-methods/sessions-recover.ts",
          "line": 15,
          "symbol": "sessionRecoverHandlers"
        }
      ],
      "notes": "Recovery does not revive stale run/worker authority."
    },
    {
      "id": "engine-select",
      "label": "Context engine selection",
      "groupId": "context",
      "kind": "decision",
      "summary": "Resolves plugins.slots.contextEngine through canonical plugin enablement and default slot policy.",
      "source": [
        {
          "file": "src/context-engine/registry-selection.ts",
          "line": 12,
          "symbol": "resolveEffectiveContextEngineId"
        }
      ],
      "notes": "Absent slot or policy-disallowed selected plugin uses the default slot. A selected engine with missing registration retains equal-ID selection and can fail during acquisition; missing registration does not guarantee fallback.",
      "inputs": "Plugins config and registered engine ownership.",
      "outputs": "Canonical selected context-engine slot ID or default."
    },
    {
      "id": "engine",
      "label": "ContextEngine contract",
      "groupId": "context",
      "kind": "component",
      "summary": "Defines engine bootstrap, ingestion, assembly, compaction and lifecycle capabilities.",
      "source": [
        {
          "file": "src/context-engine/types.ts",
          "line": 358,
          "symbol": "ContextEngine"
        }
      ],
      "notes": "Optional engine hooks are capability contracts, not unconditional execution stages.",
      "inputs": "History, model budget, supported host and lease.",
      "outputs": "Capability-specific assembly/compaction/ingestion results."
    },
    {
      "id": "legacy-engine",
      "label": "LegacyContextEngine",
      "groupId": "context",
      "kind": "component",
      "summary": "Default: no-op ingest, pass-through assembly and compaction delegated to the existing runtime.",
      "source": [
        {
          "file": "src/context-engine/legacy.ts",
          "line": 14,
          "symbol": "LegacyContextEngine"
        }
      ],
      "conditions": "Selected default/legacy engine.",
      "notes": "Engine ingestion does not perform persistence; SessionManager already owns it.",
      "inputs": "Existing messages or compact request.",
      "outputs": "Pass-through assembly/no-op ingest or delegated compaction."
    },
    {
      "id": "engine-outbox",
      "label": "Accepted context-engine turn outbox",
      "groupId": "context",
      "kind": "component",
      "summary": "Accepts intent, publishes closed turns and drains durable engine work with retry/maintenance.",
      "source": [
        {
          "file": "src/agents/harness/context-engine-turn-attempt.ts",
          "line": 180,
          "symbol": "finalizeAcceptedContextEngineTurn"
        }
      ],
      "conditions": "Engine supports durable turn advancement, logical lease is nondegraded, and durable target/admission or recorder facts permit the operation.",
      "notes": "Pending turns may be awaited/drained before subsequent assembly. This is not an unconditional background-only legacy-engine stage.",
      "inputs": "Accepted intent, durable target/recorder and lease.",
      "outputs": "Closed-turn publication, drained engine work or pending retries."
    },
    {
      "id": "engine-maintenance",
      "label": "Deferred engine maintenance",
      "groupId": "context",
      "kind": "component",
      "summary": "Coordinates deferred per-session engine maintenance across embedded runs.",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/context-engine-maintenance.ts",
          "line": 146,
          "symbol": "waitForDeferredTurnMaintenanceForSession"
        }
      ],
      "inputs": "Session/engine lease and maintenance work.",
      "outputs": "Eligible deferred maintenance coordination/completion."
    },
    {
      "id": "compaction",
      "label": "Embedded recovery compaction",
      "groupId": "context",
      "kind": "component",
      "summary": "Invokes the selected context engine for budget, overflow or timeout recovery under the current transcript owner and bounded accounting.",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/compaction-runtime.ts",
          "line": 77,
          "symbol": "export async function compactEmbeddedRunForRecovery("
        }
      ],
      "inputs": "Prepared engine/runtime, history and request budget.",
      "outputs": "Engine compaction result, successor/retry preparation or live-owner failure."
    },
    {
      "id": "session-compaction",
      "label": "AgentSession compaction",
      "groupId": "context",
      "kind": "component",
      "summary": "Owns auto/manual compaction and context replacement under active authority.",
      "source": [
        {
          "file": "src/agents/sessions/agent-session-compaction.ts",
          "line": 66,
          "symbol": "AgentSessionCompaction"
        }
      ],
      "inputs": "History/settings/summarizer and live authority.",
      "outputs": "Context replacement and persisted compaction facts or failure."
    },
    {
      "id": "summary",
      "label": "Compaction summarization",
      "groupId": "context",
      "kind": "component",
      "summary": "Runs core summarization from prepared cut points, model settings and instructions, returning the compacted conversation result.",
      "source": [
        {
          "file": "src/agents/sessions/compaction/compaction.ts",
          "line": 93,
          "symbol": "compact"
        }
      ],
      "inputs": "Already prepared cut point/messages, model, stream runtime and budget.",
      "outputs": "Summary and retained-history metadata.",
      "notes": "Cut-point planning is an upstream preparation owner; this wrapper delegates actual summarization to agent-core compactCore."
    },
    {
      "id": "overflow",
      "label": "Attempt recovery",
      "groupId": "context",
      "kind": "decision",
      "summary": "Classifies failure and performs permitted recovery including context-overflow compaction.",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt-recovery.ts",
          "line": 53,
          "symbol": "recoverEmbeddedRunAttempt"
        }
      ],
      "conditions": "Generic compaction recovery is available only when the selected harness does not own transport; plugin-native recovery remains harness-specific.",
      "inputs": "Attempt failure, replay state and recovery budget.",
      "outputs": "Permitted retry/compact/failover or terminal decision."
    },
    {
      "id": "memory-flush",
      "label": "Pre-compaction memory flush eligibility",
      "groupId": "context",
      "kind": "component",
      "summary": "Checks fresh token/compaction eligibility and prevents repeating a flush for the current compaction.",
      "source": [
        {
          "file": "src/auto-reply/reply/memory-flush.ts",
          "line": 122,
          "symbol": "shouldRunMemoryFlush"
        }
      ],
      "conditions": "Configured flush enabled and token threshold/lifecycle policy makes it eligible.",
      "inputs": "Session token/compaction/flush metadata, optional fresh token count and threshold.",
      "outputs": "Boolean flush eligibility; plan/prompt resolution and execution are separate owners."
    },
    {
      "id": "tool-base",
      "label": "Attempt tool base",
      "groupId": "tools",
      "kind": "component",
      "summary": "Constructs the tool base and per-run capability facts.",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt-tool-prepare.ts",
          "line": 64,
          "symbol": "prepareEmbeddedAttemptToolBase"
        }
      ],
      "inputs": "Capability profile, workspace and sandbox.",
      "outputs": "Prepared tool candidates with guards/metadata."
    },
    {
      "id": "tool-catalog",
      "label": "Attempt tool catalog",
      "groupId": "tools",
      "kind": "component",
      "summary": "Prepares effective admitted tools and deferred search plan.",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt-tool-catalog.ts",
          "line": 42,
          "symbol": "prepareEmbeddedAttemptToolCatalog"
        }
      ],
      "inputs": "Candidates, policy and deferred-search plan.",
      "outputs": "Effective model-visible tools and callable catalog."
    },
    {
      "id": "tool-policy",
      "label": "Tool policy pipeline",
      "groupId": "tools",
      "kind": "decision",
      "summary": "Applies layered allow/deny policy to candidate tool capabilities.",
      "source": [
        {
          "file": "src/agents/tool-policy-pipeline.ts",
          "line": 148,
          "symbol": "applyToolPolicyPipeline"
        }
      ],
      "inputs": "Tools and ordered profile/config/session/runtime layers.",
      "outputs": "Filtered tools with provenance and diagnostics."
    },
    {
      "id": "tool-search",
      "label": "Tool search catalog",
      "groupId": "tools",
      "kind": "component",
      "summary": "Owns deferred catalog discovery and callable-tool lookup.",
      "source": [
        {
          "file": "src/agents/tool-search.ts",
          "line": 241,
          "symbol": "createToolSearchTools"
        }
      ],
      "inputs": "Deferred descriptions/names and admitted resolver.",
      "outputs": "Discovered callable tools within authorized catalog."
    },
    {
      "id": "tool-batch",
      "label": "Tool batch admission",
      "groupId": "tools",
      "kind": "decision",
      "summary": "Resolves and validates requested tool calls, applies optional batch intervention, and schedules parallel groups or sequential execution.",
      "source": [
        {
          "file": "packages/agent-core/src/agent-loop.ts",
          "line": 459,
          "symbol": "async function executeToolCalls("
        },
        {
          "file": "packages/agent-core/src/agent-loop.ts",
          "line": 523,
          "symbol": "const sequential = config.toolExecution === \"sequential\" || hasSequentialToolCall"
        }
      ],
      "inputs": "Tool calls, definitions, arguments and batch hook.",
      "outputs": "Admitted/validated batch or intervention.",
      "notes": "Tool execution may begin while the provider is streaming. A sequential tool or explicit sequential configuration constrains the batch; this is not one universally serial post-response stage."
    },
    {
      "id": "tool-hooks",
      "label": "Before-tool-call middleware",
      "groupId": "tools",
      "kind": "component",
      "summary": "Applies registered before-tool-call hooks and records adjusted/blocked calls.",
      "source": [
        {
          "file": "src/agents/agent-tools.before-tool-call.policy.ts",
          "line": 109,
          "symbol": "export async function runBeforeToolCallHook"
        }
      ],
      "inputs": "Call identity/args and prepared hook policy.",
      "outputs": "Adjusted arguments, blocked fact or admitted invocation."
    },
    {
      "id": "tool-execution",
      "label": "Harness tool execution boundary",
      "groupId": "tools",
      "kind": "component",
      "summary": "Records per-call execution dispatch/start/prevention and adjusted arguments independently of result presentation.",
      "source": [
        {
          "file": "src/agents/harness/tool-execution.ts",
          "line": 31,
          "symbol": "createAgentHarnessToolExecutionBoundaryRegistry"
        }
      ],
      "notes": "This in-memory registry is correlation/accounting, not durable side-effect deduplication or an execution-promise cache.",
      "inputs": "Tool call identity, arguments and execution-boundary lifecycle.",
      "outputs": "Execution snapshot consumed by the caller; consumed or disposed records retire."
    },
    {
      "id": "tool-results",
      "label": "Tool-result redaction preparation cache",
      "groupId": "tools",
      "kind": "component",
      "summary": "Caches sanitized object results while captured model-visible redaction policy and inspected result snapshot remain unchanged.",
      "source": [
        {
          "file": "src/agents/embedded-agent-tool-result-preparation.ts",
          "line": 84,
          "symbol": "export function createToolResultPreparation"
        }
      ],
      "inputs": "Object result, sanitization and redaction policy.",
      "outputs": "Cached sanitized result while policy/object snapshot is unchanged."
    },
    {
      "id": "shell",
      "label": "Exec host dispatch",
      "groupId": "integrations",
      "kind": "component",
      "summary": "Runs prepared shell execution through host/policy boundaries.",
      "source": [
        {
          "file": "src/agents/bash-tools.exec-run.ts",
          "line": 87,
          "symbol": "createExecTool"
        }
      ]
    },
    {
      "id": "approval",
      "label": "Exec approval request",
      "groupId": "integrations",
      "kind": "decision",
      "summary": "Requests approval bound to intended execution identity.",
      "source": [
        {
          "file": "src/agents/bash-tools.exec-approval-request.ts",
          "line": 266,
          "symbol": "registerExecApprovalRequestForHostOrThrow"
        }
      ],
      "notes": "Approval remains bound to exact identity and current live authority; a stored approval fact alone is insufficient."
    },
    {
      "id": "sandbox",
      "label": "Workspace sandbox",
      "groupId": "integrations",
      "kind": "component",
      "summary": "Resolves sandbox execution/filesystem behavior for the attempt.",
      "source": [
        {
          "file": "src/agents/workspace-sandbox.ts",
          "line": 64,
          "symbol": "resolveAttemptWorkspaceSandbox"
        }
      ]
    },
    {
      "id": "files",
      "label": "Core filesystem tools",
      "groupId": "integrations",
      "kind": "component",
      "summary": "Constructs guarded host/sandbox read, write, edit, list and patch capabilities under workspace containment and enabled tool configuration.",
      "source": [
        {
          "file": "src/agents/core-coding-tools.ts",
          "line": 202,
          "symbol": "export function createCoreCodingTools"
        }
      ],
      "inputs": "Coding-root/workspace access, sandbox, filesystem policy and permitted tool configuration.",
      "outputs": "Guarded core tool capabilities; individual tool owners perform actual operations."
    },
    {
      "id": "browser",
      "label": "Browser tool plugin",
      "groupId": "integrations",
      "kind": "component",
      "summary": "Plugin-owned browser capability and dispatch boundary.",
      "source": [
        {
          "file": "extensions/browser/src/browser-tool.ts",
          "line": 179,
          "symbol": "createBrowserTool"
        }
      ],
      "notes": "CDP, browser attachment, tab persistence and browser actions remain an explicit collapsed plugin boundary."
    },
    {
      "id": "nodes",
      "label": "nodes.invoke",
      "groupId": "integrations",
      "kind": "component",
      "summary": "Invokes a connected node under command, connection and authority policy.",
      "source": [
        {
          "file": "src/gateway/server-methods/nodes.invoke.ts",
          "line": 55,
          "symbol": "nodeInvokeHandlers"
        }
      ]
    },
    {
      "id": "mcp",
      "label": "Bundle MCP tool runtime",
      "groupId": "integrations",
      "kind": "component",
      "summary": "Materializes selected MCP tool capability for an admitted run.",
      "source": [
        {
          "file": "src/agents/agent-bundle-mcp-materialize.ts",
          "line": 391,
          "symbol": "materializeBundleMcpToolsForRun"
        }
      ]
    },
    {
      "id": "spawn",
      "label": "sessions_spawn",
      "groupId": "children",
      "kind": "decision",
      "summary": "Validates spawn options and chooses OpenClaw subagent or ACP runtime.",
      "source": [
        {
          "file": "src/agents/tools/sessions-spawn-tool.ts",
          "line": 307,
          "symbol": "createSessionsSpawnTool"
        }
      ],
      "conditions": "ACP needs policy/backend availability; fork/lightContext/collector options have runtime-specific restrictions.",
      "failures": "Invalid option combinations reject; sandboxed ACP spawn is rejected because ACP runs on the host.",
      "inputs": "Task, child runtime/context/delivery and parent authority.",
      "outputs": "Accepted child identity or policy/option rejection."
    },
    {
      "id": "child-plan",
      "label": "Subagent spawn plan",
      "groupId": "children",
      "kind": "component",
      "summary": "Prepares child identity, model, context and launch facts.",
      "source": [
        {
          "file": "src/agents/subagents/spawn/subagent-spawn-child-plan.ts",
          "line": 30,
          "symbol": "resolveSubagentChildPlan"
        }
      ],
      "inputs": "Requester context, target agent/model and options.",
      "outputs": "Child identity/model/context and launch facts."
    },
    {
      "id": "child-launch",
      "label": "Subagent launch",
      "groupId": "children",
      "kind": "component",
      "summary": "Launches the prepared child with session/lifecycle ownership.",
      "source": [
        {
          "file": "src/agents/subagents/spawn/subagent-spawn.ts",
          "line": 62,
          "symbol": "spawnSubagentDirect"
        }
      ],
      "outputs": "Accepted child identity/run registration, or explicit rejection/error. Child completion is asynchronous and independently tracked."
    },
    {
      "id": "child-registry",
      "label": "Subagent registry",
      "groupId": "children",
      "kind": "store",
      "summary": "Coordinates registered child run queries and lifecycle owners.",
      "source": [
        {
          "file": "src/agents/subagents/registry/subagent-registry.ts",
          "line": 628,
          "symbol": "registerSubagentRun"
        }
      ],
      "inputs": "Child registration and lifecycle publications.",
      "outputs": "Tracked durable state; completion is separate."
    },
    {
      "id": "child-completion",
      "label": "Subagent completion lifecycle",
      "groupId": "children",
      "kind": "component",
      "summary": "Settles child completion into registry/requester lifecycle work.",
      "source": [
        {
          "file": "src/agents/subagents/registry/subagent-registry-completion-runtime.ts",
          "line": 21,
          "symbol": "createSubagentRegistryCompletionRuntime"
        }
      ],
      "inputs": "Exact terminal child fact and current owner.",
      "outputs": "Settled lifecycle/cleanup or retained recovery."
    },
    {
      "id": "child-wake",
      "label": "Requester wake commit",
      "groupId": "children",
      "kind": "component",
      "summary": "Commits requester wake facts from settled child outcomes.",
      "source": [
        {
          "file": "src/agents/subagents/registry/subagent-registry-requester-wake-commit.ts",
          "line": 478,
          "symbol": "commitRequesterWake"
        }
      ],
      "inputs": "Settled requester wake facts and owner checks.",
      "outputs": "Committed wake or current-owner suppression/failure."
    },
    {
      "id": "acp-dispatch",
      "label": "ACP reply dispatch",
      "groupId": "children",
      "kind": "component",
      "summary": "Routes an eligible ACP session through the ACP control plane.",
      "source": [
        {
          "file": "src/auto-reply/reply/dispatch-acp.ts",
          "line": 164,
          "symbol": "tryDispatchAcpReplyCore"
        }
      ],
      "inputs": "ACP-bound session/input and delivery options.",
      "outputs": "ACP turn output through ACP finalization/delivery."
    },
    {
      "id": "acp-manager",
      "label": "AcpSessionManager",
      "groupId": "children",
      "kind": "component",
      "summary": "Owns ACP session runtime lifecycle, turns and recovery through the selected backend.",
      "source": [
        {
          "file": "src/acp/control-plane/manager.core.ts",
          "line": 66,
          "symbol": "AcpSessionManager"
        }
      ],
      "inputs": "Session binding, runtime backend and authorized operation.",
      "outputs": "ACP turn/runtime lifecycle and recovery."
    },
    {
      "id": "acpx",
      "label": "acpx backend",
      "groupId": "children",
      "kind": "component",
      "summary": "Registers an external ACP runtime backend.",
      "source": [
        {
          "file": "extensions/acpx/index.ts",
          "line": 18,
          "symbol": "register(api: OpenClawPluginApi)"
        }
      ]
    },
    {
      "id": "memory-core",
      "label": "Memory-core plugin",
      "groupId": "memory",
      "kind": "component",
      "summary": "Registers memory tools/services and optional lifecycle capabilities.",
      "source": [
        {
          "file": "extensions/memory-core/index.ts",
          "line": 209,
          "symbol": "register(api"
        }
      ]
    },
    {
      "id": "memory-tools",
      "label": "Memory tools runtime",
      "groupId": "memory",
      "kind": "component",
      "summary": "Creates memory_search and memory_get implementations using selected manager and visibility/read policies.",
      "source": [
        {
          "file": "extensions/memory-core/src/tools.ts",
          "line": 226,
          "symbol": "export function createMemorySearchTool"
        }
      ],
      "inputs": "Query/path, corpus/manager and visibility policy.",
      "outputs": "Search/read result, unavailable outcome or bounded failure."
    },
    {
      "id": "memory-search",
      "label": "Memory search orchestration",
      "groupId": "memory",
      "kind": "component",
      "summary": "Coordinates keyword/vector search and configured result selection.",
      "source": [
        {
          "file": "extensions/memory-core/src/memory/manager-search-orchestration.ts",
          "line": 44,
          "symbol": "MemorySearchOrchestration"
        }
      ],
      "inputs": "Query, permitted sources, index/settings and deadline.",
      "outputs": "Ranked keyword/vector results under visibility policy."
    },
    {
      "id": "memory-index",
      "label": "Memory source indexing",
      "groupId": "memory",
      "kind": "component",
      "summary": "Prepares source chunks and writes indexed content under a captured provider/database generation.",
      "source": [
        {
          "file": "extensions/memory-core/src/memory/manager-embedding-ops.ts",
          "line": 952,
          "symbol": "protected async indexFile("
        }
      ],
      "inputs": "Admitted content, index generation and settings.",
      "outputs": "Indexed chunks with optional embeddings, or source/provider-specific skip/failure.",
      "notes": "FTS-only paths can index text without embeddings; multimodal content needs a semantic embedding provider."
    },
    {
      "id": "memory-sync",
      "label": "Memory session synchronization",
      "groupId": "memory",
      "kind": "component",
      "summary": "Synchronizes eligible transcript sources into the index.",
      "source": [
        {
          "file": "extensions/memory-core/src/memory/manager-source-sync-ops.ts",
          "line": 188,
          "symbol": "protected override async syncArchiveFiles("
        }
      ],
      "notes": "Eligible archive/transcript synchronization updates retrieval indexes. It may be awaited by search/sync owners; it is not unconditional prompt injection.",
      "inputs": "Eligible transcript sources and sync state.",
      "outputs": "Index source changes under manager lifecycle."
    },
    {
      "id": "lancedb",
      "label": "Optional LanceDB memory",
      "groupId": "memory",
      "kind": "component",
      "summary": "Registers alternate memory search/store and optional recall/capture.",
      "source": [
        {
          "file": "extensions/memory-lancedb/index.ts",
          "line": 93,
          "symbol": "register(api"
        }
      ],
      "conditions": "Plugin selected and recall/capture enabled as configured."
    },
    {
      "id": "auto-recall",
      "label": "LanceDB auto recall",
      "groupId": "memory",
      "kind": "component",
      "summary": "Prepares recall context for configured before-prompt behavior.",
      "source": [
        {
          "file": "extensions/memory-lancedb/auto-recall.ts",
          "line": 39,
          "symbol": "createAutoRecallHook"
        }
      ],
      "conditions": "Optional LanceDB recall is enabled.",
      "inputs": "Configured recall event/query and memory scope.",
      "outputs": "Optional recalled context from the enabled hook."
    },
    {
      "id": "subscribe",
      "label": "Embedded agent event subscription",
      "groupId": "delivery",
      "kind": "component",
      "summary": "Projects model/tool/session events into callbacks and streaming reply state.",
      "source": [
        {
          "file": "src/agents/embedded-agent-subscribe.ts",
          "line": 49,
          "symbol": "subscribeEmbeddedAgentSession"
        }
      ]
    },
    {
      "id": "reply-dispatcher",
      "label": "Reply dispatcher",
      "groupId": "delivery",
      "kind": "component",
      "summary": "Sends selected payloads through prepared dispatch and records outcomes.",
      "source": [
        {
          "file": "src/auto-reply/reply/reply-dispatcher.ts",
          "line": 245,
          "symbol": "createReplyDispatcher"
        }
      ],
      "inputs": "Payload and source/channel route/policy.",
      "outputs": "Delivered/suppressed/failed/deferred outcome."
    },
    {
      "id": "source-completion",
      "label": "Source reply delivery evidence",
      "groupId": "delivery",
      "kind": "component",
      "summary": "Resolves whether current-source final delivery is satisfied from explicit state, final markers and committed delivery evidence.",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/delivery-evidence.ts",
          "line": 94,
          "symbol": "export function hasCompletedSourceReplyDeliveryEvidence("
        }
      ],
      "inputs": "Current run delivery state, messaging-tool final markers and observed delivery.",
      "outputs": "Delivered/missing/failed delivery classification; legacy evidence fallback is preserved.",
      "notes": "A progress message alone does not satisfy final source reply requirements when explicit final markers are available."
    },
    {
      "id": "chat-final",
      "label": "Gateway chat reply finalization",
      "groupId": "delivery",
      "kind": "component",
      "summary": "Settles dispatched chat replies and emits final/error outcomes.",
      "source": [
        {
          "file": "src/gateway/server-methods/chat-send-reply-finalization.ts",
          "line": 115,
          "symbol": "finalizeChatSendDispatchedReplies"
        }
      ],
      "inputs": "Settled chat work and reply/source delivery facts.",
      "outputs": "Final/error delivery and terminal publication."
    },
    {
      "id": "cron",
      "label": "Cron service",
      "groupId": "background",
      "kind": "component",
      "summary": "Owns scheduled job operations through focused scheduler/store/run owners.",
      "source": [
        {
          "file": "src/cron/service.ts",
          "line": 28,
          "symbol": "CronService"
        }
      ]
    },
    {
      "id": "cron-timer",
      "label": "Cron timer scheduler",
      "groupId": "background",
      "kind": "component",
      "summary": "Schedules due-job ticks using current scheduler state.",
      "source": [
        {
          "file": "src/cron/service/timer-scheduler.ts",
          "line": 157,
          "symbol": "onTimer"
        }
      ]
    },
    {
      "id": "cron-run",
      "label": "Isolated cron agent turn",
      "groupId": "background",
      "kind": "component",
      "summary": "Runs isolated scheduled turns with prepared authority/runtime and cleanup.",
      "source": [
        {
          "file": "src/cron/isolated-agent/run.ts",
          "line": 79,
          "symbol": "runCronIsolatedAgentTurn"
        }
      ],
      "inputs": "Job/context/model, authority and delivery policy.",
      "outputs": "Scheduled turn result with owned runtime/MCP cleanup."
    },
    {
      "id": "heartbeat",
      "label": "runHeartbeatOnce",
      "groupId": "background",
      "kind": "component",
      "summary": "Runs one admitted heartbeat using current agent/session/model/prompt facts.",
      "source": [
        {
          "file": "src/infra/heartbeat-runner-run.ts",
          "line": 30,
          "symbol": "runHeartbeatOnce"
        }
      ],
      "conditions": "Scheduler, active-hours, busy-session and cooldown policy permit a heartbeat.",
      "inputs": "Agent/session/prompt and schedule/visibility policy.",
      "outputs": "Heartbeat result or explicit skip; isolated resources cleaned."
    },
    {
      "id": "heartbeat-schedule",
      "label": "Heartbeat scheduler",
      "groupId": "background",
      "kind": "component",
      "summary": "Schedules heartbeat cadence and wake requests.",
      "source": [
        {
          "file": "src/infra/heartbeat-runner-scheduler.ts",
          "line": 53,
          "symbol": "startHeartbeatRunner"
        }
      ]
    },
    {
      "id": "http-hooks",
      "label": "HTTP hooks ingress",
      "groupId": "background",
      "kind": "component",
      "summary": "Authenticates hook requests, validates mapping/scope and handles deduplicated dispatch/fan-out.",
      "source": [
        {
          "file": "src/gateway/server/hooks-request-handler.ts",
          "line": 90,
          "symbol": "createHooksRequestHandler"
        }
      ],
      "conditions": "Configured hook token/scope accepted; wake and agent dispatch use separate operations.",
      "inputs": "HTTP payload, token/scope/mappings and idempotency.",
      "outputs": "Wake/agent/fan-out receipt or rejection."
    },
    {
      "id": "hook-runner",
      "label": "Plugin hook runner",
      "groupId": "background",
      "kind": "component",
      "summary": "Supplies the active hook runner to explicit lifecycle callers.",
      "source": [
        {
          "file": "src/plugins/hook-runner-global.ts",
          "line": 18,
          "symbol": "initializeGlobalHookRunner"
        }
      ],
      "notes": "Hook extension points differ in caller contract. Authorization, approval and required persistence are not best-effort telemetry."
    },
    {
      "id": "diagnostics",
      "label": "Diagnostic events",
      "groupId": "operations",
      "kind": "component",
      "summary": "Emits trusted events to configured diagnostic observers.",
      "source": [
        {
          "file": "src/infra/diagnostic-events.ts",
          "line": 1417,
          "symbol": "emitTrustedDiagnosticEvent"
        }
      ]
    },
    {
      "id": "usage",
      "label": "Usage accumulator",
      "groupId": "operations",
      "kind": "component",
      "summary": "Aggregates model attempt usage and normalized run statistics.",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/usage-accumulator.ts",
          "line": 23,
          "symbol": "createUsageAccumulator"
        }
      ]
    },
    {
      "id": "reload",
      "label": "Gateway reload generation",
      "groupId": "operations",
      "kind": "component",
      "summary": "Monotonic reload-generation helper fences stale/aborted channel reload work; hot-reload owner applies actual configuration changes.",
      "source": [
        {
          "file": "src/gateway/server-reload-generation.ts",
          "line": 4,
          "symbol": "nextGatewayReloadGeneration"
        }
      ]
    },
    {
      "id": "worker-placement",
      "label": "Worker placement admission",
      "groupId": "operations",
      "kind": "component",
      "summary": "Admits execution to an exact selected placement and turn claim.",
      "source": [
        {
          "file": "src/gateway/server-worker-placement-dispatch-admission.ts",
          "line": 9,
          "symbol": "createGatewayWorkerDispatchAdmission"
        }
      ],
      "conditions": "Selected worker placement; local dispatch is another supported path.",
      "notes": "Placement generation and turn claim are live authority, not just signed or unexpired identifiers.",
      "inputs": "Environment/placement, owner epoch and turn claim.",
      "outputs": "Admitted worker assignment or rejection/reprovision."
    },
    {
      "id": "worker-turn",
      "label": "Worker embedded runtime",
      "groupId": "operations",
      "kind": "component",
      "summary": "Runs an admitted worker turn using createAgentSession, worker inference adapter, transcript/live clients and proxy tools.",
      "source": [
        {
          "file": "src/worker/embedded-agent.runtime.ts",
          "line": 83,
          "symbol": "runWorkerEmbeddedTurn"
        }
      ],
      "inputs": "Assignment, inference/transcript/live clients and tools.",
      "outputs": "Worker session turn with guarded proxy/inference/transcript clients."
    },
    {
      "id": "shutdown",
      "label": "Gateway run shutdown preparation",
      "groupId": "operations",
      "kind": "component",
      "summary": "Coordinates restart reply grace or ordinary-stop cancellation before outstanding execution is joined.",
      "source": [
        {
          "file": "src/gateway/server-run-shutdown.ts",
          "line": 351,
          "symbol": "prepareGatewayRunShutdown"
        }
      ],
      "notes": "Resource closing and execution joining belong to separate Gateway close owners; this preparation function does not itself close every runtime."
    },
    {
      "id": "failover-retry",
      "label": "Embedded failover/retry controller",
      "groupId": "runs",
      "kind": "decision",
      "summary": "Coordinates prepared-runtime retry decisions and auth-profile advancement.",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/failover-retry-controller.ts",
          "line": 77,
          "symbol": "createEmbeddedRunFailoverRetryController"
        }
      ],
      "inputs": "Profile/auth failure and fallback availability.",
      "outputs": "Retry, profile advancement, failover or terminal decision."
    },
    {
      "id": "provider",
      "label": "Provider model request",
      "groupId": "prompt",
      "kind": "external",
      "summary": "Transforms current agent context into a provider request and streams the assistant outcome.",
      "source": [
        {
          "file": "packages/agent-core/src/agent-stream-response.ts",
          "line": 125,
          "symbol": "streamAgentResponse"
        }
      ],
      "inputs": "Transformed context, stream runtime/model and signal.",
      "outputs": "Streamed assistant message, usage or failure."
    },
    {
      "id": "message-tool",
      "label": "Message action tool",
      "groupId": "integrations",
      "kind": "component",
      "summary": "Executes shared message actions through channel-owned transports.",
      "source": [
        {
          "file": "src/agents/tools/message-tool-execution.ts",
          "line": 132,
          "symbol": "createMessageTool"
        }
      ]
    },
    {
      "id": "chat-handler",
      "label": "chat.send handler",
      "groupId": "gateway",
      "kind": "component",
      "summary": "Owns chat-send preadmission, lifecycle selection, idempotency and accepted dispatch.",
      "source": [
        {
          "file": "src/gateway/server-methods/chat-send-handler.ts",
          "line": 642,
          "symbol": "handleChatSend"
        }
      ],
      "inputs": "chat.send frame and connection/session lifecycle.",
      "outputs": "Idempotent accepted response plus admitted dispatch, or rejection."
    },
    {
      "id": "intake-dispatch",
      "label": "Inbound message dispatcher",
      "groupId": "channels",
      "kind": "component",
      "summary": "Projects channel/Gateway inbound messages through a prepared dispatcher into reply-from-config execution.",
      "source": [
        {
          "file": "src/auto-reply/dispatch.ts",
          "line": 183,
          "symbol": "dispatchInboundMessage"
        }
      ],
      "inputs": "Normalized context, projected/routed dispatcher and reply options.",
      "outputs": "Reply result and delivery state."
    },
    {
      "id": "cron-branch",
      "label": "Cron target / payload selection",
      "groupId": "background",
      "kind": "decision",
      "summary": "Selects main-session systemEvent, isolated agentTurn/command, or other supported scheduled execution branches.",
      "source": [
        {
          "file": "src/cron/service/timer-execution.ts",
          "line": 214,
          "symbol": "effectiveJob.sessionTarget === \"main\""
        }
      ],
      "inputs": "Due job target/payload and dependencies.",
      "outputs": "Main event, isolated turn, command or invalid-payload skip."
    },
    {
      "id": "system-events",
      "label": "Main-session system events",
      "groupId": "background",
      "kind": "state",
      "summary": "Queues configured main-session system event text and requests a heartbeat according to wakeMode.",
      "source": [
        {
          "file": "src/cron/service/timer-execution.ts",
          "line": 262,
          "symbol": "state.deps.enqueueSystemEvent(text, {"
        }
      ]
    },
    {
      "id": "cron-command",
      "label": "Scheduled command job",
      "groupId": "background",
      "kind": "component",
      "summary": "Runs command payload jobs through the configured command runner with delivery/cancellation outcomes.",
      "source": [
        {
          "file": "src/cron/service/timer-execution.ts",
          "line": 360,
          "symbol": "runCommandJob"
        }
      ]
    },
    {
      "id": "run-reply",
      "label": "runReplyAgent",
      "groupId": "reply",
      "kind": "component",
      "summary": "Reply execution entry that hands preparation/adoption/follow-up/turn/result work to focused owners.",
      "source": [
        {
          "file": "src/auto-reply/reply/agent-runner.ts",
          "line": 1,
          "symbol": "runReplyAgent"
        }
      ],
      "inputs": "Prepared reply parameters and active operation.",
      "outputs": "Queued/steered input or executed turn/result handling."
    }
  ],
  "edges": [
    {
      "id": "gateway-start-kernel-0",
      "from": "gateway-start",
      "to": "kernel",
      "kind": "call",
      "label": "Creates Gateway kernel",
      "source": [
        {
          "file": "src/gateway/server-start.ts",
          "line": 38,
          "symbol": "createGatewayKernel"
        }
      ]
    },
    {
      "id": "gateway-start-shutdown-1",
      "from": "gateway-start",
      "to": "shutdown",
      "kind": "call",
      "label": "Close owner prepares run shutdown",
      "source": [
        {
          "file": "src/gateway/server-close.ts",
          "line": 318,
          "symbol": "prepareGatewayRunShutdown({"
        }
      ],
      "condition": "Gateway close lifecycle reaches run cancellation/grace preparation through server-close"
    },
    {
      "id": "chat-dispatch-user-transcript-8",
      "from": "chat-dispatch",
      "to": "user-transcript",
      "kind": "call",
      "label": "Records user-turn facts",
      "source": [
        {
          "file": "src/gateway/server-methods/chat-send-agent-dispatch.ts",
          "line": 583,
          "symbol": "persistGatewayUserTurnTranscript"
        }
      ],
      "condition": "Prepared transcript binding"
    },
    {
      "id": "chat-dispatch-chat-final-9",
      "from": "chat-dispatch",
      "to": "chat-final",
      "kind": "call",
      "label": "Finalizes dispatched replies",
      "source": [
        {
          "file": "src/gateway/server-methods/chat-send-agent-dispatch.ts",
          "line": 575,
          "symbol": "finalizeChatSendDispatchedReplies"
        }
      ],
      "condition": "Dispatch settles"
    },
    {
      "id": "route-session-key-10",
      "from": "route",
      "to": "session-key",
      "kind": "call",
      "label": "Builds selected session identity",
      "source": [
        {
          "file": "src/routing/resolve-route.ts",
          "line": 321,
          "symbol": "buildAgentSessionKey"
        }
      ],
      "condition": "Agent binding/default resolved"
    },
    {
      "id": "get-reply-inbound-11",
      "from": "get-reply",
      "to": "inbound",
      "kind": "call",
      "label": "Finalizes inbound context",
      "source": [
        {
          "file": "src/auto-reply/reply/get-reply.ts",
          "line": 266,
          "symbol": "finalizeInboundContext"
        }
      ]
    },
    {
      "id": "get-reply-directives-12",
      "from": "get-reply",
      "to": "directives",
      "kind": "call",
      "label": "Resolves directives",
      "source": [
        {
          "file": "src/auto-reply/reply/get-reply.ts",
          "line": 888,
          "symbol": "resolveReplyDirectives({"
        }
      ],
      "condition": "Supported command/directive input"
    },
    {
      "id": "get-reply-reply-session-13",
      "from": "get-reply",
      "to": "reply-session",
      "kind": "call",
      "label": "Initializes reply session",
      "source": [
        {
          "file": "src/auto-reply/reply/get-reply.ts",
          "line": 615,
          "symbol": "initSessionState({"
        }
      ],
      "condition": "Admitted session work"
    },
    {
      "id": "get-reply-config-14",
      "from": "get-reply",
      "to": "config",
      "kind": "data",
      "label": "Consumes prepared runtime config",
      "source": [
        {
          "file": "src/auto-reply/reply/get-reply.ts",
          "line": 247,
          "symbol": "getRuntimeConfig"
        }
      ],
      "condition": "Consumes config override or prepared dispatch snapshot; otherwise resolves current runtime config"
    },
    {
      "id": "get-reply-media-15",
      "from": "get-reply",
      "to": "media",
      "kind": "call",
      "label": "Stages remote inbound media",
      "source": [
        {
          "file": "src/auto-reply/reply/get-reply.ts",
          "line": 530,
          "symbol": "stageRemoteInboundMedia"
        }
      ],
      "condition": "Remote media requires staging"
    },
    {
      "id": "dispatch-reply-admission-16",
      "from": "dispatch",
      "to": "reply-admission",
      "kind": "call",
      "label": "Reserves reply lane ticket",
      "source": [
        {
          "file": "src/auto-reply/reply/dispatch-from-config.ts",
          "line": 45,
          "symbol": "reserveReplyAdmissionTicket"
        }
      ],
      "condition": "Known affected session keys"
    },
    {
      "id": "dispatch-gather-17",
      "from": "dispatch",
      "to": "gather",
      "kind": "call",
      "label": "Gathers dispatch facts",
      "source": [
        {
          "file": "src/auto-reply/reply/dispatch-from-config.ts",
          "line": 92,
          "symbol": "gatherDispatchRequest"
        }
      ]
    },
    {
      "id": "dispatch-choose-route-18",
      "from": "dispatch",
      "to": "choose-route",
      "kind": "call",
      "label": "Chooses dispatch route",
      "source": [
        {
          "file": "src/auto-reply/reply/dispatch-from-config.ts",
          "line": 116,
          "symbol": "chooseDispatchRoute"
        }
      ],
      "condition": "Operation preparation succeeds"
    },
    {
      "id": "choose-route-dedupe-19",
      "from": "choose-route",
      "to": "dedupe",
      "kind": "data",
      "label": "Commits claimed ingress replay fact",
      "source": [
        {
          "file": "src/auto-reply/reply/dispatch-from-config.choose-route.ts",
          "line": 634,
          "symbol": "commitInboundDedupeIfClaimed"
        }
      ],
      "condition": "Accepted/handled source input"
    },
    {
      "id": "choose-route-acp-dispatch-20",
      "from": "choose-route",
      "to": "acp-dispatch",
      "kind": "transition",
      "label": "Offers eligible ACP plugin takeover",
      "source": [
        {
          "file": "src/auto-reply/reply/dispatch-from-config.choose-route.ts",
          "line": 654,
          "symbol": "const replyDispatchTakeover = await runReplyDispatchTakeover("
        },
        {
          "file": "src/auto-reply/reply/dispatch-from-config.reply-dispatch-hook.ts",
          "line": 28,
          "symbol": "hookRunner.runReplyDispatch("
        },
        {
          "file": "extensions/acpx/index.ts",
          "line": 65,
          "symbol": "api.on(\"reply_dispatch\", tryDispatchAcpReplyHook"
        },
        {
          "file": "src/plugin-sdk/acpx.ts",
          "line": 81,
          "symbol": "const result = await runtime.tryDispatchAcpReply({"
        }
      ],
      "condition": "Inbound handlers allowed, session runtime restrictions permit takeover, registered reply_dispatch hook supports ACP dispatch kind, and hook consumes eligible input"
    },
    {
      "id": "choose-route-reply-dispatcher-21",
      "from": "choose-route",
      "to": "reply-dispatcher",
      "kind": "call",
      "label": "Sends prepared payload",
      "source": [
        {
          "file": "src/auto-reply/reply/dispatch-from-config.choose-route.ts",
          "line": 138,
          "symbol": "turnLedger.sendQueued("
        }
      ],
      "condition": "Delivery not suppressed/denied"
    },
    {
      "id": "choose-route-get-reply-22",
      "from": "choose-route",
      "to": "get-reply",
      "kind": "transition",
      "label": "Ordinary reply resolver branch",
      "source": [
        {
          "file": "src/auto-reply/reply/dispatch-from-config.execute.ts",
          "line": 128,
          "symbol": "replyResolver"
        }
      ],
      "condition": "No handled takeover/ACP branch"
    },
    {
      "id": "turn-fallback-23",
      "from": "turn",
      "to": "fallback",
      "kind": "call",
      "label": "Runs model fallback cycle",
      "source": [
        {
          "file": "src/auto-reply/reply/agent-runner-execution.ts",
          "line": 328,
          "symbol": "FallbackCycle"
        }
      ],
      "condition": "Candidate run admitted"
    },
    {
      "id": "fallback-embedded-24",
      "from": "fallback",
      "to": "embedded",
      "kind": "call",
      "label": "Runs embedded candidate",
      "source": [
        {
          "file": "src/auto-reply/reply/agent-runner-embedded-candidate.ts",
          "line": 359,
          "symbol": "runEmbeddedAgent"
        }
      ],
      "condition": "Embedded candidate selected"
    },
    {
      "id": "embedded-lanes-25",
      "from": "embedded",
      "to": "lanes",
      "kind": "call",
      "label": "Controls session/global queue lanes",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run-orchestrator.ts",
          "line": 202,
          "symbol": "createEmbeddedRunLaneController"
        }
      ]
    },
    {
      "id": "embedded-prepared-model-26",
      "from": "embedded",
      "to": "prepared-model",
      "kind": "call",
      "label": "Acquires prepared model runtime",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run-orchestrator.ts",
          "line": 372,
          "symbol": "acquireAgentRunPreparedModelRuntime"
        }
      ],
      "condition": "Normal mutable prepared runtime mode"
    },
    {
      "id": "embedded-cli-backend-27",
      "from": "embedded",
      "to": "cli-backend",
      "kind": "call",
      "label": "Tries eligible CLI backend",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run-orchestrator.ts",
          "line": 261,
          "symbol": "runEmbeddedAgentViaCliBackendIfEligible"
        }
      ],
      "condition": "Configured eligible CLI backend"
    },
    {
      "id": "embedded-run-loop-28",
      "from": "embedded",
      "to": "run-loop",
      "kind": "call",
      "label": "Runs prepared embedded loop",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run-orchestrator.ts",
          "line": 548,
          "symbol": "runPreparedEmbeddedLoop"
        }
      ],
      "condition": "Non-CLI embedded path"
    },
    {
      "id": "embedded-engine-maintenance-29",
      "from": "embedded",
      "to": "engine-maintenance",
      "kind": "call",
      "label": "Waits deferred session maintenance",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run-orchestrator.ts",
          "line": 238,
          "symbol": "waitForDeferredTurnMaintenanceForSession"
        }
      ],
      "condition": "Pending session maintenance"
    },
    {
      "id": "run-loop-run-authority-30",
      "from": "run-loop",
      "to": "run-authority",
      "kind": "data",
      "label": "Carries admitted context",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run-loop.ts",
          "line": 111,
          "symbol": "admittedRunContext"
        }
      ],
      "condition": "Prepared runtime admitted"
    },
    {
      "id": "run-loop-failover-retry-31",
      "from": "run-loop",
      "to": "failover-retry",
      "kind": "call",
      "label": "Creates retry/auth controller",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run-loop.ts",
          "line": 229,
          "symbol": "createEmbeddedRunFailoverRetryController"
        }
      ]
    },
    {
      "id": "run-loop-engine-32",
      "from": "run-loop",
      "to": "engine",
      "kind": "call",
      "label": "Admits selected context engine",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run-loop.ts",
          "line": 245,
          "symbol": "admitEmbeddedContextEngine"
        }
      ]
    },
    {
      "id": "run-loop-overflow-33",
      "from": "run-loop",
      "to": "overflow",
      "kind": "call",
      "label": "Evaluates attempt recovery",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run-loop.ts",
          "line": 446,
          "symbol": "recoverEmbeddedRunAttempt"
        }
      ],
      "condition": "Attempt returns recoverable failure"
    },
    {
      "id": "run-loop-builtin-34",
      "from": "run-loop",
      "to": "builtin",
      "kind": "call",
      "label": "Dispatches selected harness attempt",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run-loop.ts",
          "line": 345,
          "symbol": "prepareAndDispatchEmbeddedRunAttempt({"
        }
      ],
      "condition": "Selected built-in OpenClaw harness"
    },
    {
      "id": "builtin-attempt-37",
      "from": "builtin",
      "to": "attempt",
      "kind": "call",
      "label": "Runs built-in attempt",
      "source": [
        {
          "file": "src/agents/harness/builtin-openclaw.ts",
          "line": 96,
          "symbol": "runEmbeddedAttempt({"
        }
      ],
      "condition": "Built-in selected"
    },
    {
      "id": "attempt-attempt-setup-38",
      "from": "attempt",
      "to": "attempt-setup",
      "kind": "call",
      "label": "Prepares workspace/sandbox/settings",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt.ts",
          "line": 110,
          "symbol": "prepareEmbeddedAttemptSetup"
        }
      ]
    },
    {
      "id": "attempt-bootstrap-39",
      "from": "attempt",
      "to": "bootstrap",
      "kind": "call",
      "label": "Prepares bootstrap context",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt.ts",
          "line": 303,
          "symbol": "prepareEmbeddedAttemptBootstrap"
        }
      ],
      "condition": "Ordinary prompt contributions enabled"
    },
    {
      "id": "attempt-skills-40",
      "from": "attempt",
      "to": "skills",
      "kind": "call",
      "label": "Prepares skills",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt.ts",
          "line": 189,
          "symbol": "prepareEmbeddedSkills"
        }
      ],
      "condition": "Allowed skill preparation"
    },
    {
      "id": "attempt-tool-base-41",
      "from": "attempt",
      "to": "tool-base",
      "kind": "call",
      "label": "Prepares tool base",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt.ts",
          "line": 244,
          "symbol": "prepareEmbeddedAttemptToolBase"
        }
      ],
      "condition": "Tools enabled"
    },
    {
      "id": "attempt-tool-catalog-42",
      "from": "attempt",
      "to": "tool-catalog",
      "kind": "call",
      "label": "Prepares admitted tool catalog",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt.ts",
          "line": 337,
          "symbol": "prepareEmbeddedAttemptToolCatalog"
        }
      ],
      "condition": "Tools enabled"
    },
    {
      "id": "attempt-prompt-prepare-43",
      "from": "attempt",
      "to": "prompt-prepare",
      "kind": "call",
      "label": "Prepares system prompt",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt.ts",
          "line": 357,
          "symbol": "prepareEmbeddedAttemptSystemPrompt"
        }
      ],
      "condition": "Normal prompt mode"
    },
    {
      "id": "attempt-mcp-44",
      "from": "attempt",
      "to": "mcp",
      "kind": "call",
      "label": "Materializes bundle MCP tools",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt-bundle-tools.ts",
          "line": 149,
          "symbol": "? await materializeBundleMcpToolsForRun({"
        }
      ],
      "condition": "Configured bundle MCP capability"
    },
    {
      "id": "attempt-setup-sandbox-45",
      "from": "attempt-setup",
      "to": "sandbox",
      "kind": "call",
      "label": "Resolves workspace sandbox",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt-setup.ts",
          "line": 119,
          "symbol": "resolveAttemptWorkspaceSandbox"
        }
      ],
      "condition": "Sandbox configured"
    },
    {
      "id": "attempt-agent-session-46",
      "from": "attempt",
      "to": "agent-session",
      "kind": "call",
      "label": "Creates session runtime",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt-session-prepare.ts",
          "line": 211,
          "symbol": "createAgentSessionForEmbeddedRunner"
        }
      ]
    },
    {
      "id": "agent-session-agent-core-48",
      "from": "agent-session",
      "to": "agent-core",
      "kind": "data",
      "label": "Binds underlying Agent",
      "source": [
        {
          "file": "src/agents/sessions/sdk.ts",
          "line": 573,
          "symbol": "new Agent"
        }
      ]
    },
    {
      "id": "session-prompt-agent-core-49",
      "from": "session-prompt",
      "to": "agent-core",
      "kind": "call",
      "label": "Prompts/continues agent",
      "source": [
        {
          "file": "src/agents/sessions/agent-session-prompting.ts",
          "line": 103,
          "symbol": "this.agent.prompt"
        }
      ],
      "condition": "Logical prompt accepted"
    },
    {
      "id": "agent-core-agent-loop-50",
      "from": "agent-core",
      "to": "agent-loop",
      "kind": "call",
      "label": "Runs core loop",
      "source": [
        {
          "file": "packages/agent-core/src/agent.ts",
          "line": 550,
          "symbol": "runAgentLoop"
        }
      ]
    },
    {
      "id": "agent-loop-loop-decision-51",
      "from": "agent-loop",
      "to": "loop-decision",
      "kind": "transition",
      "label": "Checks assistant outcome and queues",
      "source": [
        {
          "file": "packages/agent-core/src/agent-loop.ts",
          "line": 332,
          "symbol": "hasMoreToolCalls"
        }
      ],
      "condition": "Assistant turn settles"
    },
    {
      "id": "loop-decision-tool-batch-52",
      "from": "tool-batch",
      "to": "loop-decision",
      "kind": "data",
      "label": "Feeds batch outcome to continuation",
      "source": [
        {
          "file": "packages/agent-core/src/agent-loop.ts",
          "line": 330,
          "symbol": "const toolResults = executedToolBatch?.messages ?? []"
        }
      ],
      "condition": "Streamed/terminal batch results, steering and termination flags become post-turn facts"
    },
    {
      "id": "loop-decision-agent-loop-53",
      "from": "loop-decision",
      "to": "agent-loop",
      "kind": "transition",
      "label": "Continues same core loop",
      "source": [
        {
          "file": "packages/agent-core/src/agent-loop.ts",
          "line": 450,
          "symbol": "pendingMessages"
        }
      ],
      "condition": "Provider continuation/endTurn=false, nonterminal tool batch, accepted steering or follow-up remains; abort/fatal/provider-error/stop policy may terminate"
    },
    {
      "id": "agent-loop-tool-batch-54",
      "from": "agent-loop",
      "to": "tool-batch",
      "kind": "call",
      "label": "Validates and admits batch",
      "source": [
        {
          "file": "packages/agent-core/src/agent-loop.ts",
          "line": 495,
          "symbol": "beforeToolBatch"
        }
      ],
      "condition": "Tool calls requested"
    },
    {
      "id": "attempt-history-55",
      "from": "attempt",
      "to": "history",
      "kind": "call",
      "label": "Prepares replay history",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt-execution-phase.ts",
          "line": 76,
          "symbol": "prepareEmbeddedAttemptHistory"
        }
      ],
      "condition": "Session/stream prepared"
    },
    {
      "id": "history-engine-56",
      "from": "history",
      "to": "engine",
      "kind": "call",
      "label": "Assembles engine context",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt-history-prepare.ts",
          "line": 203,
          "symbol": "contextEngine: activeContextEngine"
        }
      ],
      "condition": "Active engine, ordinary prompt path"
    },
    {
      "id": "engine-legacy-engine-57",
      "from": "engine",
      "to": "legacy-engine",
      "kind": "data",
      "label": "Default engine implementation",
      "source": [
        {
          "file": "src/context-engine/legacy.registration.ts",
          "line": 8,
          "symbol": "legacy"
        }
      ],
      "condition": "Effective engine ID is legacy"
    },
    {
      "id": "engine-outbox-engine-maintenance-58",
      "from": "engine-outbox",
      "to": "engine-maintenance",
      "kind": "call",
      "label": "Runs post-close maintenance",
      "source": [
        {
          "file": "src/agents/harness/context-engine-turn-attempt.ts",
          "line": 281,
          "symbol": "runContextEngineMaintenance"
        }
      ],
      "condition": "Accepted durable-engine closed turn with maintenance eligible."
    },
    {
      "id": "session-compaction-summary-59",
      "from": "session-compaction",
      "to": "summary",
      "kind": "call",
      "label": "Prepares compaction summary",
      "source": [
        {
          "file": "src/agents/sessions/agent-session-compaction.ts",
          "line": 358,
          "symbol": "        compact("
        }
      ],
      "condition": "Manual/automatic compaction eligible"
    },
    {
      "id": "legacy-engine-compaction-60",
      "from": "legacy-engine",
      "to": "session-compaction",
      "kind": "call",
      "label": "Delegates to direct session compaction",
      "source": [
        {
          "file": "src/context-engine/delegate.ts",
          "line": 99,
          "symbol": "const result = await compactEmbeddedAgentSessionOnDemand({"
        },
        {
          "file": "src/agents/embedded-agent-runner/compaction-session-execution.ts",
          "line": 522,
          "symbol": "result: await activeSession.compact(params.customInstructions)"
        }
      ],
      "condition": "Legacy engine compact requested"
    },
    {
      "id": "attempt-writer-61",
      "from": "attempt",
      "to": "writer",
      "kind": "call",
      "label": "Prepares transcript lifecycle",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt-transcript-lifecycle-prepare.ts",
          "line": 97,
          "symbol": "session"
        }
      ],
      "condition": "Writer lifecycle preparation"
    },
    {
      "id": "session-manager-sqlite-transcript-62",
      "from": "session-manager",
      "to": "sqlite-transcript",
      "kind": "data",
      "label": "Persists admitted transcript entries",
      "source": [
        {
          "file": "src/agents/sessions/session-manager-persistence.ts",
          "line": 540,
          "symbol": "appendTranscriptEventSnapshotSync(scope, event, appendOptions, undefined, viewGuard)"
        },
        {
          "file": "src/config/sessions/session-accessor.sqlite-transcript-store.ts",
          "line": 273,
          "symbol": "export function appendTranscriptEventsInTransaction("
        }
      ],
      "condition": "Persistent SessionManager target; inherited persistence owner calls transcript snapshot accessor under current view/writer guard"
    },
    {
      "id": "session-manager-append-63",
      "from": "session-manager",
      "to": "append",
      "kind": "data",
      "label": "Inherits append feature API",
      "source": [
        {
          "file": "src/agents/sessions/session-manager-entries.ts",
          "line": 26,
          "symbol": "export class SessionManagerEntries extends SessionManagerAppend"
        }
      ],
      "condition": "SessionManager → Branching → Metadata → Entries → Append class chain; not runtime ordering"
    },
    {
      "id": "history-session-manager-64",
      "from": "history",
      "to": "session-manager",
      "kind": "data",
      "label": "Reads admitted history snapshot",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt-history-prepare.ts",
          "line": 76,
          "symbol": "sessionManager"
        }
      ]
    },
    {
      "id": "context-guard-engine-65",
      "from": "context-guard",
      "to": "engine",
      "kind": "call",
      "label": "Uses engine loop capability",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/tool-result-context-guard.ts",
          "line": 235,
          "symbol": "export function installContextEngineLoopHook("
        },
        {
          "file": "src/agents/embedded-agent-runner/tool-result-context-guard.ts",
          "line": 359,
          "symbol": "const assembled = await contextEngine.assemble({"
        }
      ],
      "condition": "Optional loop hook supported"
    },
    {
      "id": "tool-catalog-tool-search-66",
      "from": "tool-catalog",
      "to": "tool-search",
      "kind": "data",
      "label": "Prepares deferred search catalog",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt-tool-catalog.ts",
          "line": 122,
          "symbol": "const toolSearchRunPlan = buildToolSearchRunPlan({"
        }
      ],
      "condition": "Deferred tool discovery enabled"
    },
    {
      "id": "tool-execution-tool-hooks-67",
      "from": "tool-execution",
      "to": "tool-hooks",
      "kind": "data",
      "label": "Consumes blocked/adjusted call facts",
      "source": [
        {
          "file": "src/agents/harness/tool-execution.ts",
          "line": 60,
          "symbol": "consumePreExecutionBlockedToolCall"
        }
      ],
      "condition": "Middleware evaluated"
    },
    {
      "id": "tool-base-shell-68",
      "from": "tool-base",
      "to": "shell",
      "kind": "data",
      "label": "Includes exec capability",
      "source": [
        {
          "file": "src/agents/core-coding-tools.ts",
          "line": 415,
          "symbol": "createLazyExecTool({"
        }
      ],
      "condition": "Allowed enabled exec tool"
    },
    {
      "id": "shell-approval-70",
      "from": "shell",
      "to": "approval",
      "kind": "call",
      "label": "Requests required exec approval",
      "source": [
        {
          "file": "src/agents/bash-tools.exec-host-gateway.ts",
          "line": 1067,
          "symbol": "await registerExecApprovalRequestForHostOrThrow({"
        }
      ],
      "condition": "Gateway exec policy requires approval"
    },
    {
      "id": "tool-base-message-tool-71",
      "from": "tool-base",
      "to": "message-tool",
      "kind": "data",
      "label": "Includes message actions",
      "source": [
        {
          "file": "src/agents/openclaw-tools.ts",
          "line": 228,
          "symbol": ": createMessageTool({"
        }
      ],
      "condition": "Allowed channel action capability"
    },
    {
      "id": "tool-base-spawn-72",
      "from": "tool-base",
      "to": "spawn",
      "kind": "data",
      "label": "Includes session spawning",
      "source": [
        {
          "file": "src/agents/openclaw-tools.ts",
          "line": 487,
          "symbol": "? createSessionsSpawnTool({"
        }
      ],
      "condition": "Allowed sessions_spawn capability"
    },
    {
      "id": "spawn-child-launch-73",
      "from": "spawn",
      "to": "child-launch",
      "kind": "call",
      "label": "Spawns OpenClaw child",
      "source": [
        {
          "file": "src/agents/tools/sessions-spawn-tool.ts",
          "line": 605,
          "symbol": "spawnSubagent"
        }
      ],
      "condition": "runtime=subagent and options admitted"
    },
    {
      "id": "spawn-acp-manager-74",
      "from": "spawn",
      "to": "acp-manager",
      "kind": "call",
      "label": "Spawns ACP session",
      "source": [
        {
          "file": "src/agents/tools/sessions-spawn-tool.ts",
          "line": 585,
          "symbol": "spawnAcp"
        }
      ],
      "condition": "runtime=acp, policy/backend available"
    },
    {
      "id": "acp-dispatch-acp-manager-76",
      "from": "acp-dispatch",
      "to": "acp-manager",
      "kind": "call",
      "label": "Runs ACP turn",
      "source": [
        {
          "file": "src/auto-reply/reply/dispatch-acp.ts",
          "line": 699,
          "symbol": "await acpManager.runTurn({"
        }
      ],
      "condition": "ACP route selected"
    },
    {
      "id": "acp-manager-acpx-77",
      "from": "acp-manager",
      "to": "acpx",
      "kind": "data",
      "label": "Streams selected runtime backend",
      "source": [
        {
          "file": "src/acp/control-plane/manager.turn-stream.ts",
          "line": 288,
          "symbol": "const events = params.runtime.runTurn(params.turn)"
        }
      ],
      "condition": "Session backend resolves to registered acpx; other registered ACP runtimes retain the same control-plane boundary"
    },
    {
      "id": "memory-core-memory-tools-78",
      "from": "memory-core",
      "to": "memory-tools",
      "kind": "call",
      "label": "Registers memory tool runtime",
      "source": [
        {
          "file": "extensions/memory-core/index.ts",
          "line": 250,
          "symbol": "for (const contract of [MEMORY_SEARCH_TOOL_CONTRACT, MEMORY_GET_TOOL_CONTRACT])"
        }
      ],
      "condition": "Memory-core enabled"
    },
    {
      "id": "lancedb-auto-recall-80",
      "from": "lancedb",
      "to": "auto-recall",
      "kind": "call",
      "label": "Registers optional before-prompt recall hook",
      "source": [
        {
          "file": "extensions/memory-lancedb/index.ts",
          "line": 465,
          "symbol": "createAutoRecallHook({"
        }
      ],
      "condition": "Plugin configured; hook returns no addition when autoRecall disabled, incognito or enabled-agent/cooldown policy disallows it"
    },
    {
      "id": "subscribe-reply-dispatcher-81",
      "from": "subscribe",
      "to": "reply-dispatcher",
      "kind": "data",
      "label": "Projects events to prepared delivery callbacks",
      "source": [
        {
          "file": "src/agents/embedded-agent-subscribe.ts",
          "line": 207,
          "symbol": "params.onToolResult?.({"
        }
      ],
      "condition": "Configured subscription callbacks feed delivery owners; intermediate progress/payload routing is collapsed"
    },
    {
      "id": "cron-cron-timer-82",
      "from": "cron",
      "to": "cron-timer",
      "kind": "call",
      "label": "Arms timer owner",
      "source": [
        {
          "file": "src/cron/service/ops-lifecycle.ts",
          "line": 90,
          "symbol": "    armTimer(state)"
        }
      ],
      "condition": "Service active, due jobs"
    },
    {
      "id": "cron-run-embedded-83",
      "from": "cron-run",
      "to": "embedded",
      "kind": "call",
      "label": "Runs scheduled embedded agent",
      "source": [
        {
          "file": "src/cron/isolated-agent/run-executor.ts",
          "line": 597,
          "symbol": "const result = await runEmbeddedAgent({"
        }
      ],
      "condition": "Scheduled embedded runtime selected"
    },
    {
      "id": "heartbeat-schedule-heartbeat-84",
      "from": "heartbeat-schedule",
      "to": "heartbeat",
      "kind": "background",
      "label": "Starts heartbeat tick",
      "source": [
        {
          "file": "src/infra/heartbeat-runner-scheduler.ts",
          "line": 265,
          "symbol": "runHeartbeat"
        }
      ],
      "condition": "Cadence/wake and skip policy permit work"
    },
    {
      "id": "http-hooks-heartbeat-schedule-86",
      "from": "http-hooks",
      "to": "heartbeat-schedule",
      "kind": "background",
      "label": "Requests wake",
      "source": [
        {
          "file": "src/gateway/server/hooks-request-handler.ts",
          "line": 384,
          "symbol": "dispatchWakeHook"
        }
      ],
      "condition": "Authenticated wake operation"
    },
    {
      "id": "http-hooks-cron-run-87",
      "from": "http-hooks",
      "to": "cron-run",
      "kind": "background",
      "label": "Dispatches hook agent work",
      "source": [
        {
          "file": "src/gateway/server/hooks-request-handler.ts",
          "line": 613,
          "symbol": "dispatchAgentHook"
        }
      ],
      "condition": "Authenticated mapped agent operation"
    },
    {
      "id": "attempt-diagnostics-88",
      "from": "attempt",
      "to": "diagnostics",
      "kind": "data",
      "label": "Emits attempt diagnostic facts",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt-setup.ts",
          "line": 455,
          "symbol": "emitTrustedDiagnosticEvent"
        }
      ],
      "condition": "Diagnostics configured"
    },
    {
      "id": "auth-device-76",
      "from": "auth",
      "to": "device",
      "kind": "call",
      "label": "Verifies signed device proof",
      "source": [
        {
          "file": "src/gateway/server/ws-connection/connect-auth.ts",
          "line": 333,
          "symbol": "verifyGatewayConnectDeviceProof"
        }
      ],
      "condition": "Device proof supplied"
    },
    {
      "id": "rpc-chat-handler-77",
      "from": "rpc",
      "to": "chat-handler",
      "kind": "call",
      "label": "Dispatches chat.send method",
      "source": [
        {
          "file": "src/gateway/server-methods/chat-send-external-entry.ts",
          "line": 61,
          "symbol": "return handleChatSend(options"
        }
      ],
      "condition": "Method chat.send and authorization accepted"
    },
    {
      "id": "chat-handler-chat-78",
      "from": "chat-handler",
      "to": "chat",
      "kind": "call",
      "label": "Prepares chat-send admission",
      "source": [
        {
          "file": "src/gateway/server-methods/chat-send-setup.ts",
          "line": 140,
          "symbol": "admitted = await admitChatSend("
        }
      ],
      "condition": "Chat send validation proceeds"
    },
    {
      "id": "chat-handler-chat-dispatch-79",
      "from": "chat-handler",
      "to": "chat-dispatch",
      "kind": "call",
      "label": "Starts accepted dispatch",
      "source": [
        {
          "file": "src/gateway/server-methods/chat-send-handler.ts",
          "line": 598,
          "symbol": "startChatDispatch"
        }
      ],
      "condition": "Chat admitted"
    },
    {
      "id": "chat-dispatch-intake-dispatch-80",
      "from": "chat-dispatch",
      "to": "intake-dispatch",
      "kind": "call",
      "label": "Dispatches projected inbound message",
      "source": [
        {
          "file": "src/gateway/server-methods/chat-send-agent-dispatch.ts",
          "line": 320,
          "symbol": "dispatchInboundMessageWithProjectedDispatcher"
        }
      ],
      "condition": "Admitted ordinary message"
    },
    {
      "id": "intake-dispatch-dispatch-81",
      "from": "intake-dispatch",
      "to": "dispatch",
      "kind": "call",
      "label": "Invokes reply-from-config owner",
      "source": [
        {
          "file": "src/auto-reply/dispatch.ts",
          "line": 241,
          "symbol": "const dispatch = params.dispatchReplyFromConfig ?? dispatchReplyFromConfig"
        }
      ],
      "condition": "Finalized inbound context; group-thread dispatch or injected resolver may own the call instead"
    },
    {
      "id": "channel-registry-route-82",
      "from": "channel-registry",
      "to": "route",
      "kind": "data",
      "label": "Channel adapter route facts",
      "source": [
        {
          "file": "extensions/telegram/src/conversation-route.ts",
          "line": 78,
          "symbol": "let route = resolveAgentRoute({"
        }
      ],
      "condition": "A concrete adapter supplies channel/account/peer identity; Telegram example cited, other adapters may differ"
    },
    {
      "id": "channel-registry-intake-dispatch-83",
      "from": "channel-registry",
      "to": "intake-dispatch",
      "kind": "data",
      "label": "Channel adapter dispatch contract",
      "source": [
        {
          "file": "extensions/telegram/src/bot-message-dispatch-turn.ts",
          "line": 126,
          "symbol": "dispatchReplyFromConfig: turn.opts.dispatchReplyFromConfig"
        }
      ],
      "condition": "Adapter prepares inbound turn plan and passes optional channel-owned dispatch resolver; intermediate intake-plan owner collapsed"
    },
    {
      "id": "run-reply-turn-84",
      "from": "run-reply",
      "to": "turn",
      "kind": "call",
      "label": "Executes admitted turn",
      "source": [
        {
          "file": "src/auto-reply/reply/followup-turn-execution.ts",
          "line": 362,
          "symbol": "executeAgentTurn"
        }
      ],
      "condition": "Prepared execution reaches model turn"
    },
    {
      "id": "run-reply-queue-85",
      "from": "run-reply",
      "to": "queue",
      "kind": "call",
      "label": "Queues follow-up work",
      "source": [
        {
          "file": "src/auto-reply/reply/followup-delivery.ts",
          "line": 563,
          "symbol": "enqueueFollowupRun"
        }
      ],
      "condition": "Queue policy defers accepted work"
    },
    {
      "id": "run-reply-queue-drain-86",
      "from": "run-reply",
      "to": "queue-drain",
      "kind": "background",
      "label": "Schedules deferred drain",
      "source": [
        {
          "file": "src/auto-reply/reply/agent-runner-steer-adoption.ts",
          "line": 119,
          "symbol": "scheduleFollowupDrain"
        }
      ],
      "condition": "Follow-up becomes eligible after active owner clears"
    },
    {
      "id": "run-reply-memory-flush-87",
      "from": "run-reply",
      "to": "memory-flush",
      "kind": "call",
      "label": "Checks conditional flush eligibility",
      "source": [
        {
          "file": "src/auto-reply/reply/agent-runner-memory.ts",
          "line": 1111,
          "symbol": "shouldRunMemoryFlush({"
        }
      ],
      "condition": "Turn eligible for pre-compaction memory flush"
    },
    {
      "id": "prompt-prepare-system-prompt-88",
      "from": "prompt-prepare",
      "to": "system-prompt",
      "kind": "call",
      "label": "Builds configured system prompt",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/system-prompt.ts",
          "line": 31,
          "symbol": "buildConfiguredAgentSystemPrompt"
        }
      ],
      "condition": "Ordinary embedded prompt contributors"
    },
    {
      "id": "agent-loop-provider-89",
      "from": "agent-loop",
      "to": "provider",
      "kind": "call",
      "label": "Streams assistant response",
      "source": [
        {
          "file": "packages/agent-core/src/agent-loop.ts",
          "line": 265,
          "symbol": "streamAgentResponse"
        }
      ],
      "condition": "Model turn admitted"
    },
    {
      "id": "attempt-transport-90",
      "from": "attempt",
      "to": "transport",
      "kind": "call",
      "label": "Installs prepared stream",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt-execution-phase.ts",
          "line": 146,
          "symbol": "prepareEmbeddedAttemptStream"
        }
      ],
      "condition": "Attempt execution phase begins"
    },
    {
      "id": "attempt-pruning-91",
      "from": "attempt",
      "to": "pruning",
      "kind": "call",
      "label": "Installs cache-TTL pruning transform",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt-setup.ts",
          "line": 262,
          "symbol": "pruneExpiredCacheTtlToolResults"
        }
      ],
      "condition": "Eligible cache-TTL projections"
    },
    {
      "id": "engine-engine-select-92",
      "from": "engine",
      "to": "engine-select",
      "kind": "call",
      "label": "Resolves canonical engine selection",
      "source": [
        {
          "file": "src/context-engine/registry.ts",
          "line": 645,
          "symbol": "resolveEffectiveContextEngineId"
        }
      ],
      "condition": "Context engine registration acquired"
    },
    {
      "id": "tool-hooks-hook-runner-94",
      "from": "tool-hooks",
      "to": "hook-runner",
      "kind": "call",
      "label": "Runs registered before-tool hooks",
      "source": [
        {
          "file": "src/agents/agent-tools.before-tool-call.policy.ts",
          "line": 353,
          "symbol": "await hookRunner.runBeforeToolCall("
        }
      ],
      "condition": "Before-tool-call hooks registered"
    },
    {
      "id": "tool-base-nodes-95",
      "from": "tool-base",
      "to": "nodes",
      "kind": "data",
      "label": "Constructs nodes tool capability",
      "source": [
        {
          "file": "src/agents/openclaw-tools.ts",
          "line": 249,
          "symbol": "createNodesTool"
        }
      ],
      "condition": "Admitted nodes tool allowed"
    },
    {
      "id": "sandbox-browser-97",
      "from": "sandbox",
      "to": "browser",
      "kind": "data",
      "label": "Sandbox browser control policy",
      "source": [
        {
          "file": "src/agents/agent-tools.ts",
          "line": 368,
          "symbol": "allowHostBrowserControl"
        }
      ],
      "condition": "Browser capability exists and sandbox policy permits it"
    },
    {
      "id": "child-launch-child-plan-98",
      "from": "child-launch",
      "to": "child-plan",
      "kind": "call",
      "label": "Resolves child plan",
      "source": [
        {
          "file": "src/agents/subagents/spawn/subagent-spawn.ts",
          "line": 138,
          "symbol": "resolveSubagentChildPlan"
        }
      ],
      "condition": "Native child spawn accepted"
    },
    {
      "id": "child-registry-child-completion-99",
      "from": "child-registry",
      "to": "child-completion",
      "kind": "call",
      "label": "Coordinates completion runtime",
      "source": [
        {
          "file": "src/agents/subagents/registry/subagent-registry.ts",
          "line": 621,
          "symbol": "await completionRuntime.completeSubagentRunWithRecovery(params, \"subagent-wait\")"
        }
      ],
      "condition": "Child terminal fact observed"
    },
    {
      "id": "child-completion-child-wake-100",
      "from": "child-completion",
      "to": "child-wake",
      "kind": "call",
      "label": "Commits requester wake",
      "source": [
        {
          "file": "src/agents/subagents/registry/subagent-registry-lifecycle-wake.ts",
          "line": 522,
          "symbol": "commitRequesterWake"
        }
      ],
      "condition": "Asynchronous child completion reaches current requester wake owner; commit is awaited and retained on failure"
    },
    {
      "id": "memory-index-memory-search-101",
      "from": "memory-index",
      "to": "memory-search",
      "kind": "data",
      "label": "Searches indexed source facts",
      "source": [
        {
          "file": "extensions/memory-core/src/memory/manager-search-orchestration.ts",
          "line": 109,
          "symbol": "searchCandidates"
        }
      ],
      "condition": "Configured index manager ready"
    },
    {
      "id": "memory-sync-memory-index-102",
      "from": "memory-sync",
      "to": "memory-index",
      "kind": "call",
      "label": "Indexes eligible transcript/archive content",
      "source": [
        {
          "file": "extensions/memory-core/src/memory/manager-source-sync-ops.ts",
          "line": 416,
          "symbol": "await this.indexFile(entry, { source: \"sessions\", content: entry.content })"
        }
      ],
      "condition": "Transcript indexing source configured"
    },
    {
      "id": "cron-cron-branch-103",
      "from": "cron",
      "to": "cron-branch",
      "kind": "call",
      "label": "Executes due job by target",
      "source": [
        {
          "file": "src/cron/service/timer-execution.ts",
          "line": 214,
          "symbol": "effectiveJob.sessionTarget"
        }
      ],
      "condition": "Job admitted"
    },
    {
      "id": "cron-branch-system-events-104",
      "from": "cron-branch",
      "to": "system-events",
      "kind": "transition",
      "label": "Enqueues main-session event",
      "source": [
        {
          "file": "src/cron/service/timer-execution.ts",
          "line": 262,
          "symbol": "state.deps.enqueueSystemEvent(text, {"
        }
      ],
      "condition": "Main target with nonempty systemEvent payload"
    },
    {
      "id": "cron-branch-cron-run-105",
      "from": "cron-branch",
      "to": "cron-run",
      "kind": "transition",
      "label": "Runs isolated agent job",
      "source": [
        {
          "file": "src/cron/service/timer-execution.ts",
          "line": 407,
          "symbol": "runIsolatedAgentJob"
        }
      ],
      "condition": "Isolated target and agentTurn payload"
    },
    {
      "id": "cron-branch-cron-command-106",
      "from": "cron-branch",
      "to": "cron-command",
      "kind": "transition",
      "label": "Runs scheduled command",
      "source": [
        {
          "file": "src/cron/service/timer-execution.ts",
          "line": 360,
          "symbol": "runCommandJob"
        }
      ],
      "condition": "Command payload and command runner configured"
    },
    {
      "id": "system-events-heartbeat-schedule-107",
      "from": "system-events",
      "to": "heartbeat-schedule",
      "kind": "background",
      "label": "Requests immediate main-session heartbeat",
      "source": [
        {
          "file": "src/cron/service/timer-execution.ts",
          "line": 287,
          "symbol": "heartbeatResult = await state.deps.requestHeartbeatAndWait"
        }
      ],
      "condition": "Main systemEvent with wakeMode=now and requestHeartbeatAndWait available; other wake policy uses normal requestHeartbeat."
    },
    {
      "id": "heartbeat-intake-dispatch-108",
      "from": "heartbeat",
      "to": "intake-dispatch",
      "kind": "call",
      "label": "Dispatches heartbeat through routed channel owner",
      "source": [
        {
          "file": "src/infra/heartbeat-runner-run.ts",
          "line": 107,
          "symbol": "dispatchInboundMessageWithRoutedChannelDispatcher"
        }
      ],
      "condition": "Visibility/admission and heartbeat skip policy allow execution"
    },
    {
      "id": "http-hooks-cron-run-109",
      "from": "http-hooks",
      "to": "cron-run",
      "kind": "background",
      "label": "Runs mapped hook agent turn",
      "source": [
        {
          "file": "src/gateway/server/hooks.ts",
          "line": 529,
          "symbol": "runCronIsolatedAgentTurn"
        }
      ],
      "condition": "Authenticated agent hook/mapping dispatch admitted"
    },
    {
      "id": "worker-placement-worker-turn-110",
      "from": "worker-placement",
      "to": "worker-turn",
      "kind": "data",
      "label": "Admitted worker turn assignment",
      "source": [
        {
          "file": "src/worker/embedded-agent.runtime.ts",
          "line": 261,
          "symbol": "operationalRunInstance"
        }
      ],
      "condition": "Exact worker launch assignment and live turn claim"
    },
    {
      "id": "worker-turn-agent-session-111",
      "from": "worker-turn",
      "to": "agent-session",
      "kind": "call",
      "label": "Creates worker AgentSession",
      "source": [
        {
          "file": "src/worker/embedded-agent.runtime.ts",
          "line": 268,
          "symbol": "createAgentSession"
        }
      ],
      "condition": "Worker admitted and capability/proxy surfaces prepared"
    },
    {
      "id": "run-loop-usage-112",
      "from": "run-loop",
      "to": "usage",
      "kind": "data",
      "label": "Returns aggregate usage",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run-loop.ts",
          "line": 556,
          "symbol": "usage"
        }
      ],
      "condition": "Attempt accounting result"
    },
    {
      "id": "rpc-cancel-113",
      "from": "rpc",
      "to": "cancel",
      "kind": "call",
      "label": "Dispatches authorized chat abort",
      "source": [
        {
          "file": "src/gateway/server-methods/chat-abort-handler.ts",
          "line": 627,
          "symbol": "abortChatRunById"
        }
      ],
      "condition": "Authorized matching active run/session"
    },
    {
      "id": "rpc-agent-rpc-114",
      "from": "rpc",
      "to": "agent-rpc",
      "kind": "call",
      "label": "Dispatches agent RPC",
      "source": [
        {
          "file": "src/gateway/server-methods/agent.ts",
          "line": 6,
          "symbol": "agent: agentRunHandler"
        }
      ],
      "condition": "Method agent with admitted caller"
    },
    {
      "id": "rpc-recovery-115",
      "from": "rpc",
      "to": "recovery",
      "kind": "call",
      "label": "Dispatches session recovery RPC",
      "source": [
        {
          "file": "src/gateway/server-methods/sessions-recover.ts",
          "line": 16,
          "symbol": "\"sessions.recover\":"
        }
      ],
      "condition": "Authorized recover request"
    },
    {
      "id": "kernel-secrets-117",
      "from": "kernel",
      "to": "secrets",
      "kind": "data",
      "label": "Owns secret runtime cleanup",
      "source": [
        {
          "file": "src/gateway/server-kernel.ts",
          "line": 290,
          "symbol": "clearSecretsRuntimeSnapshotState"
        }
      ],
      "condition": "Gateway lifecycle cleanup"
    },
    {
      "id": "plugins-channel-registry-118",
      "from": "plugins",
      "to": "channel-registry",
      "kind": "data",
      "label": "Provides channel registration",
      "source": [
        {
          "file": "src/channels/plugins/registry.ts",
          "line": 50,
          "symbol": "getLoadedChannelPluginEntryById(resolvedId)"
        }
      ],
      "condition": "Plugin registry selected"
    },
    {
      "id": "handshake-auth-119",
      "from": "auth",
      "to": "handshake",
      "kind": "call",
      "label": "Checks preliminary connect admission",
      "source": [
        {
          "file": "src/gateway/server/ws-connection/connect-auth.ts",
          "line": 110,
          "symbol": "const admission = await admitGatewayConnect("
        }
      ],
      "condition": "Connect authentication begins; admission rejection prevents credential/device continuation"
    },
    {
      "id": "operator-handshake-120",
      "from": "auth",
      "to": "operator",
      "kind": "data",
      "label": "Authenticated attachment prepares operator access",
      "source": [
        {
          "file": "src/gateway/server/ws-connection/connect-session.ts",
          "line": 498,
          "symbol": "prepareGatewayConnectOperatorAccess(nextClient)"
        }
      ],
      "condition": "Authentication and device authorization accepted; attachment prepares operator-role policy through connect-session"
    },
    {
      "id": "ws-handshake-121",
      "from": "ws",
      "to": "auth",
      "kind": "call",
      "label": "Starts connect authentication and admission",
      "source": [
        {
          "file": "src/gateway/server/ws-connection/message-handler.ts",
          "line": 365,
          "symbol": "const authenticated = await authenticateGatewayConnect("
        }
      ],
      "condition": "Valid connect request"
    },
    {
      "id": "harness-policy-plugin-harness-122",
      "from": "harness-policy",
      "to": "plugin-harness",
      "kind": "data",
      "label": "Selects registered runtime",
      "source": [
        {
          "file": "src/agents/harness/policy.ts",
          "line": 65,
          "symbol": "runtime"
        }
      ],
      "condition": "Explicit or implicit plugin runtime selected"
    },
    {
      "id": "subscribe-tool-results-124",
      "from": "subscribe",
      "to": "tool-results",
      "kind": "data",
      "label": "Shared sanitized tool-result presentation",
      "source": [
        {
          "file": "src/agents/embedded-agent-tool-results.ts",
          "line": 264,
          "symbol": "? createToolResultPreparation(result, () => sanitizeStructuredToolResult(result))"
        }
      ],
      "condition": "Object tool result reaches model/transcript presentation helper; intermediate result owner is collapsed"
    },
    {
      "id": "get-reply-run-reply-121",
      "from": "get-reply",
      "to": "run-reply",
      "kind": "call",
      "label": "Executes prepared reply agent",
      "source": [
        {
          "file": "src/auto-reply/reply/get-reply-run-execute.ts",
          "line": 642,
          "symbol": "runReplyAgent({"
        }
      ],
      "condition": "Ordinary prepared execution selected"
    },
    {
      "id": "run-authority-live-run-122",
      "from": "run-authority",
      "to": "live-run",
      "kind": "call",
      "label": "Validates live delegated authority",
      "source": [
        {
          "file": "src/agents/admitted-run-context.ts",
          "line": 377,
          "symbol": "validateAgentRunDelegatedAuthority"
        }
      ],
      "condition": "Operational context live"
    },
    {
      "id": "agent-session-session-prompt-123",
      "from": "agent-session",
      "to": "session-prompt",
      "kind": "data",
      "label": "Layered session prompting contract",
      "source": [
        {
          "file": "src/agents/sessions/agent-session-models.ts",
          "line": 26,
          "symbol": "export abstract class AgentSessionModels extends AgentSessionPrompting"
        }
      ],
      "condition": "Feature inheritance through session class layers; not execution order"
    },
    {
      "id": "tool-base-tool-policy-124",
      "from": "tool-base",
      "to": "tool-policy",
      "kind": "call",
      "label": "Applies conversation tool policy",
      "source": [
        {
          "file": "src/agents/conversation-tool-policy-pipeline.ts",
          "line": 148,
          "symbol": "applyToolPolicyPipeline"
        }
      ],
      "condition": "Conversation/profile restrictions prepared"
    },
    {
      "id": "child-launch-child-registry-125",
      "from": "child-launch",
      "to": "child-registry",
      "kind": "data",
      "label": "Launch registration contract",
      "source": [
        {
          "file": "src/agents/subagents/registry/subagent-registry.ts",
          "line": 632,
          "symbol": "registerSubagentRun"
        }
      ],
      "condition": "Accepted Gateway launch registers child independently of completion"
    },
    {
      "id": "memory-tools-memory-search-126",
      "from": "memory-tools",
      "to": "memory-search",
      "kind": "call",
      "label": "Executes manager search",
      "source": [
        {
          "file": "extensions/memory-core/src/memory-search-tool-query.ts",
          "line": 122,
          "symbol": "active.manager.search"
        }
      ],
      "condition": "Manager and visibility filter prepared"
    },
    {
      "id": "turn-source-completion-127",
      "from": "turn",
      "to": "source-completion",
      "kind": "data",
      "label": "Records message-tool-only outcome",
      "source": [
        {
          "file": "src/auto-reply/reply/agent-runner-execution-outcome.ts",
          "line": 53,
          "symbol": "outcome?.kind === \"settled\" && hasCompletedSourceReplyDeliveryEvidence(outcome.result)"
        }
      ],
      "condition": "Source mode message_tool_only"
    },
    {
      "id": "reload-config-128",
      "from": "reload",
      "to": "config",
      "kind": "data",
      "label": "Hot reload compares configuration",
      "source": [
        {
          "file": "src/gateway/server-reload-hot.ts",
          "line": 65,
          "symbol": "nextGatewayReloadGeneration"
        }
      ],
      "condition": "Configuration reload admitted"
    },
    {
      "id": "plugin-harness-codex-harness-129",
      "from": "plugin-harness",
      "to": "codex-harness",
      "kind": "data",
      "label": "Registered Codex runtime implementation",
      "source": [
        {
          "file": "extensions/codex/index.ts",
          "line": 278,
          "symbol": "api.registerAgentHarness(createCodexAppServerAgentHarness(agentHarnessOptions)"
        }
      ],
      "condition": "Explicit/implicit policy selects Codex"
    },
    {
      "id": "rpc-method-auth-130",
      "from": "rpc",
      "to": "method-auth",
      "kind": "call",
      "label": "Authorizes requested method",
      "source": [
        {
          "file": "src/gateway/server-methods/request-authorization.ts",
          "line": 81,
          "symbol": "authorizeGatewayMethod"
        }
      ],
      "condition": "Authenticated request proceeds through method authorization"
    },
    {
      "id": "kernel-projection-131",
      "from": "kernel",
      "to": "projection",
      "kind": "call",
      "label": "Creates derived session row projection",
      "source": [
        {
          "file": "src/gateway/server-kernel-request-runtime.ts",
          "line": 65,
          "symbol": "createSessionRowProjection({"
        }
      ],
      "condition": "Runtime request-context projection prepared"
    },
    {
      "id": "tool-base-files-132",
      "from": "tool-base",
      "to": "files",
      "kind": "call",
      "label": "Constructs core filesystem tools",
      "source": [
        {
          "file": "src/agents/agent-tools.ts",
          "line": 251,
          "symbol": "createCoreCodingTools({"
        }
      ],
      "condition": "Core coding capability construction enabled"
    },
    {
      "id": "compaction-engine-audit",
      "from": "compaction",
      "to": "engine",
      "kind": "call",
      "label": "Compacts selected engine",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/compaction-runtime.ts",
          "line": 233,
          "symbol": "return input.contextEngine.compact(backendParams)"
        }
      ],
      "condition": "Current recovery owner and generic recovery policy permit compaction"
    },
    {
      "id": "attempt-context-guard-audit",
      "from": "attempt",
      "to": "context-guard",
      "kind": "call",
      "label": "Installs tool-result context guard",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run/attempt-setup.ts",
          "line": 346,
          "symbol": "const removeToolResultGuard = installToolResultContextGuard({"
        }
      ],
      "condition": "Session context token budget and prepared guard lifecycle exist"
    },
    {
      "id": "fallback-engine-outbox-audit",
      "from": "fallback",
      "to": "engine-outbox",
      "kind": "call",
      "label": "Finalizes accepted engine turn",
      "source": [
        {
          "file": "src/agents/embedded-agent-runner/run-entry.ts",
          "line": 651,
          "symbol": "await finalizeAcceptedContextEngineTurn({"
        }
      ],
      "condition": "Candidate settlement accepted terminal outcome with turnAttempt and supported durable engine lease; intervening run-entry owner collapsed"
    }
  ],
  "traces": [
    {
      "id": "gateway-answer",
      "label": "Gateway chat → built-in answer",
      "description": "Assumes an authenticated operator, an admitted durable session, ordinary reply route, built-in OpenClaw harness, legacy context engine, no tools and a successful provider response. Owner visits are illustrative, not observed telemetry.",
      "steps": [
        {
          "nodeId": "auth",
          "detail": "Connection authentication is already accepted for this client."
        },
        {
          "nodeId": "chat-handler",
          "detail": "chat.send validates and binds the message to the intended session; assume no duplicate/rejection."
        },
        {
          "nodeId": "chat-dispatch",
          "detail": "Starts accepted work with retained run and transcript ownership."
        },
        {
          "nodeId": "intake-dispatch",
          "detail": "Projected dispatcher sends normalized input into shared reply preparation."
        },
        {
          "nodeId": "dispatch",
          "detail": "Reserves reply admission and prepares request/route/delivery."
        },
        {
          "nodeId": "get-reply",
          "detail": "Resolves ordinary session, workspace and model facts."
        },
        {
          "nodeId": "run-reply",
          "detail": "Prepared execution reaches agent turn; assume no queue deferral."
        },
        {
          "nodeId": "turn",
          "detail": "One admitted turn owns candidate execution and terminal accounting."
        },
        {
          "nodeId": "embedded",
          "detail": "Resolves target and enters session/global lanes."
        },
        {
          "nodeId": "run-loop",
          "detail": "Prepared model/runtime selects built-in execution; admission retained."
        },
        {
          "nodeId": "builtin",
          "detail": "Dispatches runEmbeddedAttempt through the built-in harness."
        },
        {
          "nodeId": "attempt",
          "detail": "Prepares resources, prompt, tools and session runtime."
        },
        {
          "nodeId": "history",
          "detail": "Legacy assembly passes sanitized/validated history onward."
        },
        {
          "nodeId": "session-prompt",
          "detail": "Starts the logical prompt through AgentSession."
        },
        {
          "nodeId": "agent-loop",
          "detail": "Issues a model turn."
        },
        {
          "nodeId": "provider",
          "detail": "Assume a final assistant text response without tool calls."
        },
        {
          "nodeId": "loop-decision",
          "detail": "Assume endTurn is not false, no provider continuation, tools or queued work, and no continuation hook requires another turn: agent_end settles."
        },
        {
          "nodeId": "turn",
          "detail": "Records the settled execution outcome."
        },
        {
          "nodeId": "chat-final",
          "detail": "Gateway finalizes reply delivery; assume transport succeeds."
        }
      ]
    },
    {
      "id": "tool-loop",
      "label": "Built-in tool batch and continuation",
      "description": "Assumes a built-in attempt with an enabled allowed filesystem tool; tool arguments pass validation/hooks, execution succeeds and provider returns final text afterward. This skips setup/cleanup visits for readability. Assumes one ordinary sequential filesystem call; streamed/parallel scheduling is an alternative.",
      "steps": [
        {
          "nodeId": "attempt",
          "detail": "Tool candidates and session runtime are prepared."
        },
        {
          "nodeId": "tool-catalog",
          "detail": "Only effective admitted tools are available to this model turn."
        },
        {
          "nodeId": "agent-loop",
          "detail": "Calls provider with current prompt/tool capability."
        },
        {
          "nodeId": "provider",
          "detail": "Assume assistant requests an allowed filesystem tool."
        },
        {
          "nodeId": "tool-batch",
          "detail": "Resolve/validate calls and run beforeToolBatch; assume admitted."
        },
        {
          "nodeId": "tool-hooks",
          "detail": "Prepared before-tool hooks permit the call without argument changes."
        },
        {
          "nodeId": "files",
          "detail": "The allowed tool definition constructed by this factory invokes its operation; concrete filesystem implementation is collapsed."
        },
        {
          "nodeId": "agent-loop",
          "detail": "Tool results are emitted/appended and become continuation context."
        },
        {
          "nodeId": "provider",
          "detail": "Assume subsequent provider turn returns final answer."
        },
        {
          "nodeId": "loop-decision",
          "detail": "No queued work, provider continuation or endTurn=false request: settle the post-turn checkpoint."
        }
      ]
    },
    {
      "id": "overflow",
      "label": "Built-in context overflow recovery",
      "description": "Assumes a built-in harness whose host permits generic compaction recovery, recoverable overflow, sufficient compaction/retry budget and successful summary. Plugin-native transport is not assigned this route.",
      "steps": [
        {
          "nodeId": "run-loop",
          "detail": "One live admission owns the attempt and recovery budget."
        },
        {
          "nodeId": "attempt",
          "detail": "Dispatch built-in attempt with current assembled history."
        },
        {
          "nodeId": "provider",
          "detail": "Assume provider reports recoverable context overflow."
        },
        {
          "nodeId": "overflow",
          "detail": "Normalize failure and choose permitted context recovery rather than ordinary retry."
        },
        {
          "nodeId": "compaction",
          "detail": "Recovery owner invokes selected contextEngine.compact under transcript-write and safety-timeout ownership."
        },
        {
          "nodeId": "legacy-engine",
          "detail": "Default legacy engine delegates through compactEmbeddedAgentSessionOnDemand to direct session compaction."
        },
        {
          "nodeId": "session-compaction",
          "detail": "Compaction uses current session ownership/settings."
        },
        {
          "nodeId": "summary",
          "detail": "Assume summary generation and retained-history plan succeed."
        },
        {
          "nodeId": "session-manager",
          "detail": "Compaction persistence replaces active context through the session owner."
        },
        {
          "nodeId": "run-loop",
          "detail": "Retry retains the admitted context and bounded recovery accounting."
        },
        {
          "nodeId": "provider",
          "detail": "Assume the post-compaction provider request succeeds."
        }
      ]
    },
    {
      "id": "subagent",
      "label": "Native child acceptance and later completion",
      "description": "Assumes sessions_spawn runtime=subagent with admitted policy/options, successful Gateway child launch, and later successful child completion. Acceptance and completion are separate phases; the parent is not assumed to synchronously wait.",
      "steps": [
        {
          "nodeId": "tool-batch",
          "detail": "Assume requested sessions_spawn is available/admitted."
        },
        {
          "nodeId": "spawn",
          "detail": "Select native subagent branch; reject ACP-only incompatible options beforehand."
        },
        {
          "nodeId": "child-launch",
          "detail": "Resolve prepared child launch under requester authority."
        },
        {
          "nodeId": "child-plan",
          "detail": "Derive target agent/model/context; assume allowed."
        },
        {
          "nodeId": "child-registry",
          "detail": "Accepted child run is registered. sessions_spawn returns accepted identity."
        },
        {
          "nodeId": "agent-loop",
          "detail": "Parent can continue its own loop; this does not mean the child is complete."
        },
        {
          "nodeId": "child-completion",
          "detail": "Later child terminal fact reaches registry completion ownership."
        },
        {
          "nodeId": "child-wake",
          "detail": "Assume notification/requester policy permits a committed wake; failure/recovery remains registry-owned."
        }
      ]
    },
    {
      "id": "acp",
      "label": "ACP-bound conversation",
      "description": "Assumes configured ACP session binding, enabled available acpx runtime and admitted input. This route bypasses the built-in OpenClaw attempt/agent loop; backend internals are intentionally collapsed. The acpx reply_dispatch hook must be registered and eligible; command bypass/send-policy/runtime restrictions can decline takeover.",
      "steps": [
        {
          "nodeId": "intake-dispatch",
          "detail": "Normalized source input enters shared dispatch preparation."
        },
        {
          "nodeId": "dispatch",
          "detail": "Prepare session/route and delivery facts."
        },
        {
          "nodeId": "choose-route",
          "detail": "Assume eligible ACP reply_dispatch hook is registered and consumes the prepared session input; otherwise ordinary resolution continues."
        },
        {
          "nodeId": "acp-dispatch",
          "detail": "Build ACP payload and route through the control-plane manager."
        },
        {
          "nodeId": "acp-manager",
          "detail": "Operate selected ACP session backend under its lifecycle policy."
        },
        {
          "nodeId": "acpx",
          "detail": "External ACP backend handles the turn; assume success."
        },
        {
          "nodeId": "reply-dispatcher",
          "detail": "ACP output is delivered through prepared route/payload policy; assume success."
        }
      ]
    },
    {
      "id": "scheduled",
      "label": "Cron main event → heartbeat",
      "description": "Assumes a due admitted cron job targeting main with nonempty systemEvent payload and wakeMode=now; heartbeat visibility/active-hours/busy policy permits execution. Isolated agentTurn and command jobs are alternative branches.",
      "steps": [
        {
          "nodeId": "cron-timer",
          "detail": "Due-job scheduling causes admitted execution."
        },
        {
          "nodeId": "cron-branch",
          "detail": "Choose main-session systemEvent branch."
        },
        {
          "nodeId": "system-events",
          "detail": "Enqueue event text into the intended main-session context."
        },
        {
          "nodeId": "heartbeat-schedule",
          "detail": "Request heartbeat wake under current schedule owner."
        },
        {
          "nodeId": "heartbeat",
          "detail": "Assume heartbeat skip/visibility policy allows a turn."
        },
        {
          "nodeId": "intake-dispatch",
          "detail": "Heartbeat uses the routed channel dispatcher, rather than a universal direct embedded call."
        },
        {
          "nodeId": "dispatch",
          "detail": "Normal reply lifecycle prepares the heartbeat message."
        },
        {
          "nodeId": "get-reply",
          "detail": "Resolves heartbeat-specific model/prompt/session options."
        },
        {
          "nodeId": "reply-dispatcher",
          "detail": "Assume the resulting heartbeat has sendable content and is delivered."
        }
      ]
    }
  ]
};
