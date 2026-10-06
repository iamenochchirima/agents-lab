import type { ExplorerGraph } from '../types';

/** Pinned source study; illustrative traces do not execute pi. */
export const piGraph: ExplorerGraph = {
  "id": "pi",
  "name": "Pi",
  "repository": "https://github.com/earendil-works/pi",
  "commit": "a276dabe57911253350bffb93cb7d7aff6a73261",
  "description": "Stable coding-agent architecture with provider-independent Agent core, branch-projected requests and an explicitly separate experimental durable/client-server system.",
  "scope": "Pinned local earendil-works/pi source: stable CLI/SDK/RPC, coding-agent state and tools, model/provider boundary, built-in integrations, session/compaction lifecycle and experimental remote/durable infrastructure.",
  "limitations": [
    "Surface architecture study from code, not measured runtime telemetry. Trace outcomes are assumptions and do not invoke providers or tools.",
    "Groups and graph edges are explanatory views; components, stored data and execution states are distinct. One map edge may summarize several calls inside its linked owner.",
    "Stable AgentSession persists finalized JSONL messages. Experimental Harness uses durable transactional tasks/storage; their guarantees and APIs must not be conflated.",
    "Provider APIs share a normalized message boundary but differ internally. OpenAI Responses is a concrete adapter anchor, not a claim all providers use its transport/retry behavior.",
    "Experimental client/server, Chord services and durable subagent demo are explicit source-only/alternate paths. They are not unconditional parts of normal pi execution.",
    "MCP and extensions are configurable; permissions can be implemented through tool_call hooks. A universal built-in approval manager is not invented.",
    "Examples, eval runner internals, every TUI widget, packaging/install/update machinery and full provider/MCP protocol implementations are outside this surface map."
  ],
  "groups": [
    {
      "id": "entry",
      "label": "CLI and application modes",
      "summary": "Stable local entry points and application mode selection."
    },
    {
      "id": "host",
      "label": "Session runtime and lifecycle",
      "summary": "Creation, restoration, replacement and shutdown of cwd-bound services."
    },
    {
      "id": "resources",
      "label": "Settings, trust and resources",
      "summary": "Global/project configuration, packages, project instructions and loaded resources."
    },
    {
      "id": "input",
      "label": "Input and prompt preparation",
      "summary": "Commands, extension interception, image preparation and busy-agent queues."
    },
    {
      "id": "core",
      "label": "Agent core and loop",
      "summary": "Provider-independent Agent state and nested turn/follow-up loops."
    },
    {
      "id": "request",
      "label": "Request projection and routing",
      "summary": "Canonical branch context, prompt/tool deltas and request-only transformations."
    },
    {
      "id": "provider",
      "label": "Models, credentials and providers",
      "summary": "ModelRuntime, auth, provider adapters and request-level retry."
    },
    {
      "id": "tools",
      "label": "Tool pipeline and filesystem",
      "summary": "Validation, interception, execution policies, builtin tools and side effects."
    },
    {
      "id": "integrations",
      "label": "MCP and codemode",
      "summary": "Discovery, remote tool/resource exposure and nested script tool execution."
    },
    {
      "id": "history",
      "label": "Session tree and persistence",
      "summary": "JSONL history, active branch projection, context edits and export."
    },
    {
      "id": "compaction",
      "label": "Compaction and recovery",
      "summary": "Manual/automatic summaries, overflow omission, retry and branch summaries."
    },
    {
      "id": "extensions",
      "label": "Extension events and settlement",
      "summary": "Reloadable handlers, turn boundaries and settled-run notifications."
    },
    {
      "id": "presentation",
      "label": "Presentation and diagnostics",
      "summary": "TUI, event output, usage and opt-in/background facilities."
    },
    {
      "id": "remote",
      "label": "Experimental client/server",
      "summary": "Source-only remote transport, host services and worker attachment."
    },
    {
      "id": "durable",
      "label": "Experimental durable harness",
      "summary": "Alternate transactional task/conversation architecture; not the stable AgentSession."
    },
    {
      "id": "chord",
      "label": "Chord services and replication",
      "summary": "Facet lifecycles, generated service catalogues and replicated state transport."
    }
  ],
  "nodes": [
    {
      "id": "cli",
      "label": "main()",
      "groupId": "entry",
      "kind": "component",
      "summary": "Bootstraps CLI configuration, resolves session/runtime, prepares initial input and dispatches one application mode.",
      "source": [
        {
          "file": "packages/coding-agent/src/main.ts",
          "line": 573,
          "symbol": "main()"
        }
      ],
      "inputs": "Arguments, terminal TTY status, environment and stdin.",
      "outputs": "InteractiveMode, runRpcMode or runPrintMode.",
      "failures": "Invalid flags, missing cwd or startup diagnostics can stop startup."
    },
    {
      "id": "mode",
      "label": "resolveAppMode()",
      "groupId": "entry",
      "kind": "decision",
      "summary": "Selects RPC or JSON when explicitly requested; print when --print or a stream is non-TTY; otherwise interactive.",
      "source": [
        {
          "file": "packages/coding-agent/src/main.ts",
          "line": 112,
          "symbol": "resolveAppMode()"
        }
      ],
      "conditions": "RPC/json flags have priority; print is also selected for piped input/output."
    },
    {
      "id": "initial",
      "label": "prepareInitialMessage()",
      "groupId": "entry",
      "kind": "component",
      "summary": "Combines initial CLI/file content and piped stdin for the chosen application mode.",
      "source": [
        {
          "file": "packages/coding-agent/src/main.ts",
          "line": 211,
          "symbol": "prepareInitialMessage()"
        }
      ],
      "inputs": "CLI messages, file arguments, piped stdin.",
      "outputs": "Text and optional image content."
    },
    {
      "id": "tui",
      "label": "InteractiveMode",
      "groupId": "entry",
      "kind": "component",
      "summary": "Stable terminal host owns editor commands, agent-event rendering, extension UI context and session switching.",
      "source": [
        {
          "file": "packages/coding-agent/src/modes/interactive/interactive-mode.ts",
          "line": 447,
          "symbol": "InteractiveMode"
        }
      ],
      "inputs": "AgentSessionRuntime and terminal events.",
      "outputs": "Prompts, queues, runtime operations and rendered transcript."
    },
    {
      "id": "print",
      "label": "runPrintMode()",
      "groupId": "entry",
      "kind": "component",
      "summary": "Noninteractive host runs initial/additional messages and prints text or JSON events.",
      "source": [
        {
          "file": "packages/coding-agent/src/modes/print-mode.ts",
          "line": 33,
          "symbol": "runPrintMode()"
        }
      ],
      "conditions": "Selected for print/json application mode.",
      "outputs": "Stdout response/events and process exit status."
    },
    {
      "id": "rpc",
      "label": "runRpcMode()",
      "groupId": "entry",
      "kind": "component",
      "summary": "Stable JSONL stdin/stdout command host exposes prompt, queue, abort and session operations.",
      "source": [
        {
          "file": "packages/coding-agent/src/modes/rpc/rpc-mode.ts",
          "line": 54,
          "symbol": "runRpcMode()"
        }
      ],
      "notes": "This is distinct from experimental pi-client/pi-server transport."
    },
    {
      "id": "rpc-client",
      "label": "RpcClient",
      "groupId": "entry",
      "kind": "component",
      "summary": "SDK helper spawns a pi RPC child process, correlates command responses and publishes events.",
      "source": [
        {
          "file": "packages/coding-agent/src/modes/rpc/rpc-client.ts",
          "line": 56,
          "symbol": "RpcClient"
        }
      ],
      "inputs": "Commands and child process options.",
      "failures": "Process exit or protocol/command error rejects pending operations."
    },
    {
      "id": "services",
      "label": "createAgentSessionServices()",
      "groupId": "host",
      "kind": "component",
      "summary": "Creates cwd-bound settings/resources and model runtime; loads resources and registers extension providers/virtual models.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session-services.ts",
          "line": 135,
          "symbol": "createAgentSessionServices()"
        }
      ],
      "outputs": "Services and setup diagnostics."
    },
    {
      "id": "sdk",
      "label": "createAgentSession()",
      "groupId": "host",
      "kind": "component",
      "summary": "SDK factory restores branch messages/model/thinking, selects initial tools and constructs Agent plus AgentSession.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/sdk.ts",
          "line": 175,
          "symbol": "createAgentSession()"
        }
      ],
      "inputs": "Optional model, managers, resources, tool allow/deny lists and custom tools.",
      "outputs": "AgentSession, extensions result and possible model fallback warning."
    },
    {
      "id": "runtime",
      "label": "AgentSessionRuntime",
      "groupId": "host",
      "kind": "component",
      "summary": "Owns the current AgentSession and services; replaces the runtime for new/resume/fork/import.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session-runtime.ts",
          "line": 74,
          "symbol": "AgentSessionRuntime"
        }
      ],
      "notes": "Creation errors propagate after teardown; replacement is not presented as transactional rollback."
    },
    {
      "id": "session",
      "label": "AgentSession",
      "groupId": "host",
      "kind": "component",
      "summary": "Stable coding-agent orchestrator installs persistence, request projection, tool hooks, next-turn refresh and lifecycle boundaries.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 362,
          "symbol": "AgentSession"
        }
      ],
      "inputs": "Agent, SessionManager, SettingsManager, resources and ModelRuntime.",
      "outputs": "Public session operations and events."
    },
    {
      "id": "replace",
      "label": "switchSession() / newSession() / fork()",
      "groupId": "host",
      "kind": "component",
      "summary": "Validates target and cancellable extension hooks, builds a replacement runtime and rebinds the host.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session-runtime.ts",
          "line": 196,
          "symbol": "switchSession() / newSession() / fork()"
        }
      ],
      "conditions": "Explicit host/session operation.",
      "failures": "Unknown fork entry, unavailable cwd or recreation failure propagates."
    },
    {
      "id": "shutdown",
      "label": "teardownCurrent()",
      "groupId": "host",
      "kind": "component",
      "summary": "Aborts and settles active work before session_shutdown, UI invalidation and session disposal.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session-runtime.ts",
          "line": 167,
          "symbol": "teardownCurrent()"
        }
      ],
      "outputs": "Outgoing aborted response/tool results preserved before replacement."
    },
    {
      "id": "settings",
      "label": "SettingsManager",
      "groupId": "resources",
      "kind": "store",
      "summary": "Combines global/project settings with configured storage and project trust; exposes retry, tool, model and compaction settings.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/settings-manager.ts",
          "line": 379,
          "symbol": "SettingsManager"
        }
      ],
      "failures": "Load errors are retained as diagnostics instead of silently claiming valid configuration."
    },
    {
      "id": "trust",
      "label": "ProjectTrustStore",
      "groupId": "resources",
      "kind": "store",
      "summary": "Stores trusted project roots; startup can ask extensions to resolve trust before project resources/settings load.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/trust-manager.ts",
          "line": 210,
          "symbol": "ProjectTrustStore"
        }
      ],
      "notes": "Project-resource trust is not a built-in per-tool approval dialog."
    },
    {
      "id": "resources",
      "label": "DefaultResourceLoader.reload()",
      "groupId": "resources",
      "kind": "component",
      "summary": "Reloads trusted settings, resolves package resources, loads extensions/skills/prompts/themes and project context files.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/resource-loader.ts",
          "line": 505,
          "symbol": "DefaultResourceLoader.reload()"
        }
      ],
      "outputs": "Resource sets and collision/load diagnostics."
    },
    {
      "id": "packages",
      "label": "DefaultPackageManager",
      "groupId": "resources",
      "kind": "component",
      "summary": "Resolves configured package and CLI sources into enabled extensions, skills, prompts and themes.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/package-manager.ts",
          "line": 812,
          "symbol": "DefaultPackageManager"
        }
      ],
      "inputs": "Settings package list and temporary CLI extension sources."
    },
    {
      "id": "agents-files",
      "label": "loadProjectContextFiles()",
      "groupId": "resources",
      "kind": "component",
      "summary": "Loads global and ancestor project context instruction files for prompt construction.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/resource-loader.ts",
          "line": 232,
          "symbol": "loadProjectContextFiles()"
        }
      ],
      "outputs": "Global instruction file followed by ancestor files from root to cwd, deduplicated by path; linked-worktree counterpart can be shadowed."
    },
    {
      "id": "skills",
      "label": "loadSkills()",
      "groupId": "resources",
      "kind": "component",
      "summary": "Discovers skill files and metadata with diagnostics; full skill body is expanded when a skill command is invoked.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/skills.ts",
          "line": 409,
          "symbol": "loadSkills()"
        }
      ]
    },
    {
      "id": "templates",
      "label": "expandPromptTemplate()",
      "groupId": "resources",
      "kind": "component",
      "summary": "Expands a named prompt template and its positional arguments into user input.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/prompt-templates.ts",
          "line": 304,
          "symbol": "expandPromptTemplate()"
        }
      ],
      "conditions": "Expansion enabled and input matches a loaded template."
    },
    {
      "id": "extension-loader",
      "label": "loadExtensions()",
      "groupId": "resources",
      "kind": "component",
      "summary": "Loads extension factories and gathers registered handlers/tools/commands/providers with individual load errors.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/extensions/loader.ts",
          "line": 711,
          "symbol": "loadExtensions()"
        }
      ]
    },
    {
      "id": "builtin-ext",
      "label": "builtInExtensions",
      "groupId": "resources",
      "kind": "component",
      "summary": "Bundles llama.cpp, codemode, tool-search and MCP; selected integrations can be replaced by third-party registrations.",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/index.ts",
          "line": 7,
          "symbol": "builtInExtensions"
        }
      ],
      "notes": "Registration does not imply configured MCP servers or executing scripts."
    },
    {
      "id": "prompt",
      "label": "AgentSession.prompt()",
      "groupId": "input",
      "kind": "component",
      "summary": "Checks commands/input hooks, expands skills/templates, queues busy input or validates model/auth and starts a prepared prompt.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1921,
          "symbol": "AgentSession.prompt()"
        }
      ],
      "failures": "Prompt during manual compaction, busy input without streamingBehavior, missing model or auth is rejected."
    },
    {
      "id": "commands",
      "label": "_tryExecuteExtensionCommand()",
      "groupId": "input",
      "kind": "component",
      "summary": "Executes registered slash commands immediately, including while the agent is streaming.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 2069,
          "symbol": "_tryExecuteExtensionCommand()"
        }
      ],
      "conditions": "Leading slash and matching extension command; bypasses model run.",
      "failures": "Command exceptions emit extension errors and count as handled."
    },
    {
      "id": "input-hooks",
      "label": "_runInputHandlers()",
      "groupId": "input",
      "kind": "decision",
      "summary": "Input extensions can handle input, transform text/images or pass it through before expansion.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1870,
          "symbol": "_runInputHandlers()"
        }
      ],
      "outputs": "Transformed input or no input to send."
    },
    {
      "id": "skill-expand",
      "label": "_expandSkillCommand()",
      "groupId": "input",
      "kind": "component",
      "summary": "Reads /skill:name body and adds its path/base-directory context to the user message.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 2100,
          "symbol": "_expandSkillCommand()"
        }
      ],
      "failures": "Unknown skill passes through; file read failure emits an error and preserves original text."
    },
    {
      "id": "busy",
      "label": "isStreaming / streamingBehavior",
      "groupId": "input",
      "kind": "decision",
      "summary": "Busy user input is routed to steer or followUp rather than starting a second concurrent prompt.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1966,
          "symbol": "isStreaming / streamingBehavior"
        }
      ],
      "conditions": "A streamingBehavior is required when AgentSession.prompt is called during active work."
    },
    {
      "id": "steer",
      "label": "Agent.steer() queue",
      "groupId": "input",
      "kind": "store",
      "summary": "Queues user input to be consumed at a turn boundary, including after tool batches.",
      "source": [
        {
          "file": "packages/agent/src/agent.ts",
          "line": 299,
          "symbol": "Agent.steer() queue"
        }
      ],
      "notes": "Steering is not injected mid-stream. Queue is process memory; its message is persisted only when admitted as message_end."
    },
    {
      "id": "followup",
      "label": "Agent.followUp() queue",
      "groupId": "input",
      "kind": "store",
      "summary": "Queues input for the outer loop when the agent would otherwise stop.",
      "source": [
        {
          "file": "packages/agent/src/agent.ts",
          "line": 304,
          "symbol": "Agent.followUp() queue"
        }
      ],
      "conditions": "Queue mode controls all versus one-at-a-time drain.",
      "notes": "Queue is process memory; admitted user messages later become transcript entries. End decisions can leave queued work for a later higher-level continuation."
    },
    {
      "id": "before-start",
      "label": "emitBeforeAgentStart()",
      "groupId": "input",
      "kind": "component",
      "summary": "Allows extensions to adjust prompt options/model/tools and add custom messages before constructing user history.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 2015,
          "symbol": "emitBeforeAgentStart()"
        }
      ]
    },
    {
      "id": "images",
      "label": "_normalizePromptImages()",
      "groupId": "input",
      "kind": "component",
      "summary": "Processes images against the selected model resize profile, appending processing hints to user text.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1890,
          "symbol": "_normalizePromptImages()"
        }
      ],
      "outputs": "Normalized image blocks and hints; invalid images are omitted with explanation."
    },
    {
      "id": "loadout",
      "label": "_preparePromptAndToolLoadout()",
      "groupId": "input",
      "kind": "component",
      "summary": "Applies executable tool loadout and records changed structured system-prompt sections as a system message.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1689,
          "symbol": "_preparePromptAndToolLoadout()"
        }
      ],
      "outputs": "Optional prompt-section delta plus active executable tools."
    },
    {
      "id": "agent",
      "label": "Agent",
      "groupId": "core",
      "kind": "component",
      "summary": "Provider-independent mutable state, run lifecycle, queues, event subscribers and AbortController.",
      "source": [
        {
          "file": "packages/agent/src/agent.ts",
          "line": 188,
          "symbol": "Agent"
        }
      ],
      "inputs": "Prompt messages or continuation plus hook/stream configuration."
    },
    {
      "id": "run",
      "label": "_runAgentPrompt()",
      "groupId": "core",
      "kind": "component",
      "summary": "Runs Agent.prompt then checks retry/recovery, queued work and before-settle continuation until the coding-agent activity settles.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1775,
          "symbol": "_runAgentPrompt()"
        }
      ]
    },
    {
      "id": "loop",
      "label": "runLoop()",
      "groupId": "core",
      "kind": "component",
      "summary": "Inner loop processes tool rounds/steering; outer loop admits follow-ups or explicit context-only continuation.",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 163,
          "symbol": "runLoop()"
        }
      ],
      "outputs": "agent_start, turn_start/end and agent_end events."
    },
    {
      "id": "refresh",
      "label": "prepareNextTurn / prompt refresh",
      "groupId": "core",
      "kind": "component",
      "summary": "Reprojects persisted context and refreshes model/prompt/tool state between assistant responses.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 870,
          "symbol": "prepareNextTurn / prompt refresh"
        }
      ],
      "conditions": "After a completed turn, before the next assistant response."
    },
    {
      "id": "turn-decision",
      "label": "finishTurn() continuation",
      "groupId": "core",
      "kind": "decision",
      "summary": "An end decision stops immediately. A continue decision requests another context-only turn only when no natural tool/steering/follow-up work is selected.",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 286,
          "symbol": "finishTurn() continuation"
        }
      ]
    },
    {
      "id": "stop",
      "label": "error / aborted response",
      "groupId": "core",
      "kind": "state",
      "summary": "Low-level loop finishes the failed/aborted turn and emits agent_end without executing its tool calls.",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 245,
          "symbol": "error / aborted response"
        }
      ],
      "notes": "AgentSession may subsequently retry a retryable error; aborted user work does not auto-retry."
    },
    {
      "id": "abort",
      "label": "AgentSession.abort()",
      "groupId": "core",
      "kind": "component",
      "summary": "Cancels agent activity and associated compaction/retry work, then waits for active work to settle.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 2387,
          "symbol": "AgentSession.abort()"
        }
      ],
      "inputs": "User/host cancellation.",
      "outputs": "Abort signals and settled activity."
    },
    {
      "id": "projection",
      "label": "_installAgentRequestProjection()",
      "groupId": "request",
      "kind": "component",
      "summary": "Builds canonical messages from SessionManager projection for every request and keeps executable tools separate from declarations.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 759,
          "symbol": "_installAgentRequestProjection()"
        }
      ]
    },
    {
      "id": "route",
      "label": "ModelRuntime.resolveModel()",
      "groupId": "request",
      "kind": "decision",
      "summary": "Optional virtual selection routes each request to a physical model using user/continuation/retry reason and branch routing state.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/model-runtime.ts",
          "line": 994,
          "symbol": "ModelRuntime.resolveModel()"
        }
      ],
      "conditions": "Only registered virtual models.",
      "failures": "Unregistered virtual model, nonphysical target or missing credentials rejects routing."
    },
    {
      "id": "route-state",
      "label": "Virtual model branch state",
      "groupId": "request",
      "kind": "store",
      "summary": "Persists changed routing state as a custom entry; physical response names do not replace the virtual selection.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 804,
          "symbol": "Virtual model branch state"
        }
      ]
    },
    {
      "id": "tool-delta",
      "label": "declareToolChanges()",
      "groupId": "request",
      "kind": "component",
      "summary": "Diffs transcript tool declarations against executable tools and emits toolsAdded/toolsRemoved in system messages.",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 333,
          "symbol": "declareToolChanges()"
        }
      ],
      "outputs": "Provider-visible tool loadout can be reconstructed from transcript."
    },
    {
      "id": "transform",
      "label": "transformContext projections",
      "groupId": "request",
      "kind": "component",
      "summary": "Runs extension context transforms, hides declarations selected by loadout hooks and optionally projects a forced leading prompt.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1720,
          "symbol": "transformContext projections"
        }
      ],
      "notes": "Forced text changes the request view; structured prompt history is still recorded."
    },
    {
      "id": "convert",
      "label": "convertToLlm()",
      "groupId": "request",
      "kind": "component",
      "summary": "Converts coding-agent custom/bash/summary messages to provider-compatible messages; SDK can defensively block image content.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/messages.ts",
          "line": 148,
          "symbol": "convertToLlm()"
        }
      ]
    },
    {
      "id": "stream",
      "label": "streamAssistantResponse()",
      "groupId": "request",
      "kind": "component",
      "summary": "Transforms context, converts/normalizes messages, resolves request credentials and streams assistant events into the current turn.",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 381,
          "symbol": "streamAssistantResponse()"
        }
      ],
      "outputs": "Partial updates and final AssistantMessage with requested thinking level."
    },
    {
      "id": "prompt-sections",
      "label": "buildSystemPromptSections()",
      "groupId": "request",
      "kind": "component",
      "summary": "Builds structured prompt sections from tools/rules/docs/project context/skills/cwd and optional custom prompt.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/system-prompt.ts",
          "line": 121,
          "symbol": "buildSystemPromptSections()"
        }
      ],
      "outputs": "Section map whose changes are stored as deltas."
    },
    {
      "id": "model-runtime",
      "label": "ModelRuntime",
      "groupId": "provider",
      "kind": "component",
      "summary": "Owns provider/model catalogue, credential composition, physical/virtual model registration and chat/classification/image operations.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/model-runtime.ts",
          "line": 171,
          "symbol": "ModelRuntime"
        }
      ]
    },
    {
      "id": "auth",
      "label": "ModelRuntime.getAuth()",
      "groupId": "provider",
      "kind": "component",
      "summary": "Resolves current auth/base URL/headers/env for a request, supporting refreshed credentials rather than static startup keys.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/model-runtime.ts",
          "line": 549,
          "symbol": "ModelRuntime.getAuth()"
        }
      ],
      "failures": "Auth resolution/synchronization errors can stop request preparation."
    },
    {
      "id": "catalog",
      "label": "ModelRuntime.refresh()",
      "groupId": "provider",
      "kind": "component",
      "summary": "Refreshes model/provider availability; setup refresh can disable network, while interactive/RPC hosts can refresh in background.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/model-runtime.ts",
          "line": 839,
          "symbol": "ModelRuntime.refresh()"
        }
      ]
    },
    {
      "id": "provider-stream",
      "label": "ModelRuntime.streamSimple()",
      "groupId": "provider",
      "kind": "component",
      "summary": "Dispatches a normalized model request through the selected provider/API implementation.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/model-runtime.ts",
          "line": 715,
          "symbol": "ModelRuntime.streamSimple()"
        }
      ],
      "outputs": "Unified assistant event stream."
    },
    {
      "id": "adapters",
      "label": "Provider API adapters",
      "groupId": "provider",
      "kind": "component",
      "summary": "Provider-specific adapters translate transcript/tool schemas and decode provider events; OpenAI Responses is one concrete owner.",
      "source": [
        {
          "file": "packages/ai/src/api/openai-responses.ts",
          "line": 127,
          "symbol": "Provider API adapters"
        }
      ],
      "notes": "Anthropic, Google, Bedrock and other APIs are separate implementations, not this single adapter.",
      "failures": "Provider stop/error/length outcomes feed the common assistant-message contract."
    },
    {
      "id": "provider-retry",
      "label": "retryProviderRequest()",
      "groupId": "provider",
      "kind": "component",
      "summary": "Request-level retry utilities apply retryability/delay/abort rules within supported provider implementations.",
      "source": [
        {
          "file": "packages/ai/src/utils/provider-retry.ts",
          "line": 105,
          "symbol": "retryProviderRequest()"
        }
      ],
      "notes": "Separate from AgentSession auto-retry after an assistant error."
    },
    {
      "id": "provider-hooks",
      "label": "Provider payload/header/response hooks",
      "groupId": "provider",
      "kind": "component",
      "summary": "Extensions can transform provider headers/payload and observe response headers/raw provider stream events.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/sdk.ts",
          "line": 358,
          "symbol": "Provider payload/header/response hooks"
        }
      ]
    },
    {
      "id": "endpoint",
      "label": "Configured model endpoint",
      "groupId": "provider",
      "kind": "external",
      "summary": "External provider or local model endpoint receives API-specific requests.",
      "source": [
        {
          "file": "packages/ai/src/types.ts",
          "line": 1102,
          "symbol": "Model.baseUrl"
        }
      ],
      "notes": "Map does not execute endpoints or claim measured provider behavior."
    },
    {
      "id": "dispatch",
      "label": "executeToolCalls()",
      "groupId": "tools",
      "kind": "decision",
      "summary": "Chooses sequential batch execution if configured or any selected tool requires it; otherwise executes a parallel batch.",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 508,
          "symbol": "executeToolCalls()"
        }
      ],
      "notes": "Parallel mode prepares calls serially, then launches prepared executions with Promise.all; result messages are emitted in original call order after the join. A batch terminates only when all finalized results request terminate."
    },
    {
      "id": "truncated",
      "label": "failToolCallsFromTruncatedMessage()",
      "groupId": "tools",
      "kind": "state",
      "summary": "A length-stopped response fails every tool call without executing potentially truncated arguments.",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 478,
          "symbol": "failToolCallsFromTruncatedMessage()"
        }
      ],
      "outputs": "Error tool results asking for complete reissued calls."
    },
    {
      "id": "prepare-tool",
      "label": "prepareToolCall()",
      "groupId": "tools",
      "kind": "component",
      "summary": "Looks up tool, prepares/validates arguments and invokes beforeToolCall; unknown/blocked/invalid calls become error results.",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 707,
          "symbol": "prepareToolCall()"
        }
      ],
      "outputs": "Prepared call or immediate error result."
    },
    {
      "id": "tool-hook",
      "label": "_beforeToolCall()",
      "groupId": "tools",
      "kind": "decision",
      "summary": "Runs extension tool_call interception for direct and nested calls, including block/reason/terminate decisions.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 630,
          "symbol": "_beforeToolCall()"
        }
      ],
      "notes": "Permissions are extension hooks here; no universal built-in approval service is assumed."
    },
    {
      "id": "execute-tool",
      "label": "executePreparedToolCall()",
      "groupId": "tools",
      "kind": "component",
      "summary": "Invokes selected tool with abort signal/progress updates; exceptions become structured error outcomes.",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 820,
          "symbol": "executePreparedToolCall()"
        }
      ]
    },
    {
      "id": "tool-result",
      "label": "_afterToolCall()",
      "groupId": "tools",
      "kind": "component",
      "summary": "Allows tool_result extensions to replace outcome and normalizes returned images, including extension-injected images.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 656,
          "symbol": "_afterToolCall()"
        }
      ]
    },
    {
      "id": "read",
      "label": "createReadTool()",
      "groupId": "tools",
      "kind": "component",
      "summary": "Reads text or supported images with offset/limit, truncation and model-aware processing.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/tools/read.ts",
          "line": 201,
          "symbol": "createReadTool()"
        }
      ]
    },
    {
      "id": "bash",
      "label": "createBashTool()",
      "groupId": "tools",
      "kind": "component",
      "summary": "Runs shell commands through configured operations, streams output and supports timeout/cancellation.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/tools/bash.ts",
          "line": 434,
          "symbol": "createBashTool()"
        }
      ]
    },
    {
      "id": "edit",
      "label": "createEditTool()",
      "groupId": "tools",
      "kind": "component",
      "summary": "Applies exact text replacements and returns a diff or matching/path errors.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/tools/edit.ts",
          "line": 218,
          "symbol": "createEditTool()"
        }
      ]
    },
    {
      "id": "write",
      "label": "createWriteTool()",
      "groupId": "tools",
      "kind": "component",
      "summary": "Writes content to a target path, creating parent directories where needed.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/tools/write.ts",
          "line": 95,
          "symbol": "createWriteTool()"
        }
      ]
    },
    {
      "id": "search",
      "label": "grep / find / ls tools",
      "groupId": "tools",
      "kind": "component",
      "summary": "Optional builtin filesystem inspection tools complement the default read/bash/edit/write loadout.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/tools/grep.ts",
          "line": 321,
          "symbol": "grep / find / ls tools"
        }
      ],
      "conditions": "Tools must be enabled or selected; availability is not equivalent to default declaration."
    },
    {
      "id": "mutation",
      "label": "withFileMutationQueue()",
      "groupId": "tools",
      "kind": "component",
      "summary": "Serializes builtin mutations targeting the same canonical file; mutations for different files can run in parallel.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/tools/file-mutation-queue.ts",
          "line": 32,
          "symbol": "withFileMutationQueue()"
        }
      ]
    },
    {
      "id": "filesystem",
      "label": "Working directory and shell",
      "groupId": "tools",
      "kind": "external",
      "summary": "External filesystem/process environment where builtin tool effects occur.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/tools/path-utils.ts",
          "line": 48,
          "symbol": "Working directory and shell"
        }
      ],
      "notes": "Stable tool execution is not represented as crash-safe exactly-once work."
    },
    {
      "id": "mcp-ext",
      "label": "createMcpExtension()",
      "groupId": "integrations",
      "kind": "component",
      "summary": "Tracks configured MCP servers and publishes tool/resource registrations and server prompt contribution.",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/mcp/index.ts",
          "line": 276,
          "symbol": "createMcpExtension()"
        }
      ],
      "conditions": "Configured enabled servers; integration loads runtime lazily.",
      "notes": "Default exposure is codemode; it auto-activates codemode unless disabled. Direct servers are awaited with a startup bound; indirect servers connect in background and are awaited on demand."
    },
    {
      "id": "mcp-conn",
      "label": "McpServerConnection",
      "groupId": "integrations",
      "kind": "component",
      "summary": "Owns connection/discovery/call state, reconnects dropped connections and handles expired sessions/auth requirements.",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/mcp/runtime.ts",
          "line": 155,
          "symbol": "McpServerConnection"
        }
      ]
    },
    {
      "id": "mcp-transport",
      "label": "createDefaultTransport()",
      "groupId": "integrations",
      "kind": "decision",
      "summary": "Creates Streamable HTTP for URL servers or stdio subprocess transport for command servers.",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/mcp/runtime.ts",
          "line": 97,
          "symbol": "createDefaultTransport()"
        }
      ],
      "inputs": "Server config, cwd, headers/env and optional OAuth provider."
    },
    {
      "id": "mcp-resources",
      "label": "MCP resource tools",
      "groupId": "integrations",
      "kind": "component",
      "summary": "Lists resources/templates and reads resource content from configured servers; resource support is separate from tool discovery.",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/mcp/resources.ts",
          "line": 197,
          "symbol": "MCP resource tools"
        }
      ]
    },
    {
      "id": "mcp-server",
      "label": "Configured MCP server",
      "groupId": "integrations",
      "kind": "external",
      "summary": "External server can be connecting, connected, disconnected, needs-auth, failed or closed.",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/mcp/runtime.ts",
          "line": 56,
          "symbol": "Configured MCP server"
        }
      ],
      "failures": "Disconnect/auth/protocol/timeout failures surface through connection and tool outcomes."
    },
    {
      "id": "tool-search",
      "label": "tool_search / BM25 discovery",
      "groupId": "integrations",
      "kind": "component",
      "summary": "Ranks undeclared codemode/deferred tools and loads matches for the next request, recording the loadout on the branch.",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/tool-search/tool.ts",
          "line": 119,
          "symbol": "tool_search / BM25 discovery"
        }
      ],
      "conditions": "Registered inactive by builtin extension; requires explicit activation or configured MCP deferred exposure."
    },
    {
      "id": "codemode",
      "label": "createCodemodeToolDefinition()",
      "groupId": "integrations",
      "kind": "component",
      "summary": "Model writes JavaScript against callable tools; loadout mode controls direct declarations and script catalogue.",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/codemode/tool.ts",
          "line": 365,
          "symbol": "createCodemodeToolDefinition()"
        }
      ],
      "conditions": "Registered inactive by builtin extension; activated explicitly or automatically for configured indirect MCP tools.",
      "notes": "Model-only exposure prevents nested scripts from recursively starting codemode."
    },
    {
      "id": "sandbox",
      "label": "executeCodemode() / QuickJS sandbox",
      "groupId": "integrations",
      "kind": "component",
      "summary": "Lazily starts QuickJS worker sandbox with tool proxies/discovery/model globals; collects output and cancels unfinished calls.",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/codemode/execute.ts",
          "line": 320,
          "symbol": "executeCodemode() / QuickJS sandbox"
        }
      ],
      "inputs": "Raw script, output/timeout options and branch store.",
      "outputs": "Script result with nested-call details and partial output on failure."
    },
    {
      "id": "nested",
      "label": "NestedToolCallRunner",
      "groupId": "integrations",
      "kind": "component",
      "summary": "ctx.executeTool runs callable nested tools through the same validation/interception pipeline and tracks parent call IDs/usage.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/nested-tool-calls.ts",
          "line": 160,
          "symbol": "NestedToolCallRunner"
        }
      ],
      "notes": "Nested results reach script; the outer result carries nested-call records instead of inserting each result into main history."
    },
    {
      "id": "script-store",
      "label": "codemode-store branch entries",
      "groupId": "integrations",
      "kind": "store",
      "summary": "Successful script writes are custom entries; load replays only the selected session branch.",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/codemode/execute.ts",
          "line": 220,
          "symbol": "codemode-store branch entries"
        }
      ],
      "conditions": "Script success, nonempty storeWrites and installed appendEntry callback; without session context writes are dropped."
    },
    {
      "id": "manager",
      "label": "SessionManager",
      "groupId": "history",
      "kind": "store",
      "summary": "Owns append-only entry tree, current leaf, model/thinking metadata and optional JSONL persistence.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/session-manager.ts",
          "line": 987,
          "symbol": "SessionManager"
        }
      ]
    },
    {
      "id": "jsonl",
      "label": "Session JSONL file",
      "groupId": "history",
      "kind": "store",
      "summary": "Writes header and accumulated entries once conversation exists, then appends entries synchronously.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/session-manager.ts",
          "line": 1172,
          "symbol": "Session JSONL file"
        }
      ],
      "notes": "In-memory sessions skip disk writes; no claim of crash durability equivalent to durable SQLite.",
      "failures": "Filesystem write errors propagate."
    },
    {
      "id": "event-persist",
      "label": "_handleAgentEvent()",
      "groupId": "history",
      "kind": "component",
      "summary": "Dispatches extension/public events then persists message_end entries and tracks assistant/result state.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1074,
          "symbol": "_handleAgentEvent()"
        }
      ],
      "notes": "Partial assistant updates are not each stored as stable JSONL message entries."
    },
    {
      "id": "branch",
      "label": "Active leaf / getBranch()",
      "groupId": "history",
      "kind": "store",
      "summary": "Follows parent IDs from current leaf to reconstruct a branch; other branches remain in the entry tree.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/session-manager.ts",
          "line": 1469,
          "symbol": "Active leaf / getBranch()"
        }
      ]
    },
    {
      "id": "context",
      "label": "buildSessionProjection()",
      "groupId": "history",
      "kind": "component",
      "summary": "Projects branch entries after compaction/context edits into model messages and links messages back to source entries.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/session-manager.ts",
          "line": 543,
          "symbol": "buildSessionProjection()"
        }
      ]
    },
    {
      "id": "context-edit",
      "label": "appendContextEdit()",
      "groupId": "history",
      "kind": "store",
      "summary": "Persists context replacement/omission records without deleting original source entries.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/session-manager.ts",
          "line": 1360,
          "symbol": "appendContextEdit()"
        }
      ],
      "notes": "Recovery omissions and extension boundary edits are inspectable historical entries."
    },
    {
      "id": "tree",
      "label": "navigateTree()",
      "groupId": "history",
      "kind": "component",
      "summary": "Selects tree entry, optionally summarizes abandoned work, changes leaf and refreshes context/model/loadout.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 3915,
          "symbol": "navigateTree()"
        }
      ],
      "conditions": "Explicit stable session tree navigation; experimental controller lacks this operation."
    },
    {
      "id": "fork",
      "label": "createBranchedSession()",
      "groupId": "history",
      "kind": "component",
      "summary": "Creates a separate session from selected ancestry while preserving relevant branch context.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/session-manager.ts",
          "line": 1632,
          "symbol": "createBranchedSession()"
        }
      ],
      "outputs": "New session file or in-memory branch state."
    },
    {
      "id": "export",
      "label": "exportToHtml() / exportToJsonl()",
      "groupId": "history",
      "kind": "component",
      "summary": "Exports inspectable session history/metadata to standalone artifacts.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 4239,
          "symbol": "exportToHtml() / exportToJsonl()"
        }
      ],
      "notes": "Export is user initiated, distinct from ordinary persistence."
    },
    {
      "id": "pressure",
      "label": "shouldCompact()",
      "groupId": "compaction",
      "kind": "decision",
      "summary": "Compares context token estimate against context window minus configured reserve, when compaction enabled.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/compaction/compaction.ts",
          "line": 267,
          "symbol": "shouldCompact()"
        }
      ]
    },
    {
      "id": "manual",
      "label": "AgentSession.compact()",
      "groupId": "compaction",
      "kind": "component",
      "summary": "Manual compaction prepares branch, allows extension interception and writes successful summary then refreshes context.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 2717,
          "symbol": "AgentSession.compact()"
        }
      ],
      "conditions": "Explicit compact() first awaits abort(), then installs an independently abortable manual compaction controller."
    },
    {
      "id": "auto",
      "label": "_runAutoCompaction()",
      "groupId": "compaction",
      "kind": "component",
      "summary": "Threshold/overflow compaction prepares kept history, permits cancel/custom summary hook and commits successful result.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 3050,
          "symbol": "_runAutoCompaction()"
        }
      ],
      "failures": "Cancellation or summary failure emits compaction_end/session_compact_failed without claiming success."
    },
    {
      "id": "prepare-summary",
      "label": "prepareCompaction()",
      "groupId": "compaction",
      "kind": "component",
      "summary": "Selects cut point and recent retained entries, preserving relevant turn structure and prior summary/file-operation context.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/compaction/compaction.ts",
          "line": 872,
          "symbol": "prepareCompaction()"
        }
      ]
    },
    {
      "id": "summarize",
      "label": "compact() / generateSummaryWithUsage()",
      "groupId": "compaction",
      "kind": "component",
      "summary": "Generates summary, optionally split turn-prefix summary and usage through a model stream; combines compaction result.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/compaction/compaction.ts",
          "line": 965,
          "symbol": "compact() / generateSummaryWithUsage()"
        }
      ]
    },
    {
      "id": "compact-entry",
      "label": "appendCompaction()",
      "groupId": "compaction",
      "kind": "store",
      "summary": "Records summary, firstKeptEntryId, tokensBefore, details/usage and current system-message checkpoint; projection reads this boundary.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/session-manager.ts",
          "line": 1261,
          "symbol": "SessionManager.appendCompaction()"
        }
      ]
    },
    {
      "id": "overflow",
      "label": "_checkCompaction()",
      "groupId": "compaction",
      "kind": "decision",
      "summary": "Recognizes same-model overflow/recoverable length, skips stale usage and limits compact-and-retry recovery to one attempt.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 2900,
          "symbol": "_checkCompaction()"
        }
      ]
    },
    {
      "id": "omit",
      "label": "_omitRecoveryAttempt()",
      "groupId": "compaction",
      "kind": "component",
      "summary": "Persistently omits failed selected assistant/tool-result attempt through context edits before recovery compaction.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1208,
          "symbol": "_omitRecoveryAttempt()"
        }
      ]
    },
    {
      "id": "auto-retry",
      "label": "_prepareRetry()",
      "groupId": "compaction",
      "kind": "component",
      "summary": "Session-level exponential backoff retries eligible assistant errors, omitting failed attempt from projected request history.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 3713,
          "symbol": "_prepareRetry()"
        }
      ],
      "conditions": "Settings enabled, retryable error and remaining attempts; overflow has a separate recovery path."
    },
    {
      "id": "branch-summary",
      "label": "generateBranchSummary()",
      "groupId": "compaction",
      "kind": "component",
      "summary": "Summarizes abandoned branch entries during optional tree navigation, preserving file-operation details.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/compaction/branch-summarization.ts",
          "line": 293,
          "symbol": "generateBranchSummary()"
        }
      ]
    },
    {
      "id": "runner",
      "label": "ExtensionRunner",
      "groupId": "extensions",
      "kind": "component",
      "summary": "Owns ordered handlers, commands and extension contexts; specialized emitters apply event-specific merge/block semantics.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/extensions/runner.ts",
          "line": 356,
          "symbol": "ExtensionRunner"
        }
      ]
    },
    {
      "id": "boundary",
      "label": "emitBoundary / turn_end",
      "groupId": "extensions",
      "kind": "component",
      "summary": "Turn-end handlers receive persisted assistant/result IDs and can draft context changes or request continuation.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 818,
          "symbol": "emitBoundary / turn_end"
        }
      ]
    },
    {
      "id": "settle",
      "label": "agent_before_settle / agent_settled",
      "groupId": "extensions",
      "kind": "component",
      "summary": "Checks late queued work and extension continuation before final activity settlement.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1846,
          "symbol": "agent_before_settle / agent_settled"
        }
      ],
      "outputs": "Additional continuation or final agent_settled notification."
    },
    {
      "id": "reload",
      "label": "AgentSession.reload()",
      "groupId": "extensions",
      "kind": "component",
      "summary": "Emits shutdown, reloads resources/provider registrations and rebuilds extension runtime; emits session_start when host bindings exist.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 3612,
          "symbol": "AgentSession.reload()"
        },
        {
          "file": "packages/coding-agent/src/modes/interactive/interactive-mode.ts",
          "line": 6356,
          "symbol": "handleReloadCommand()"
        }
      ],
      "conditions": "Interactive /reload rejects busy or compacting state. Direct SDK callers must arrange safe lifecycle ordering; reload() does not call abort()."
    },
    {
      "id": "events",
      "label": "Session event subscribers",
      "groupId": "presentation",
      "kind": "component",
      "summary": "Hosts subscribe to streamed assistant/tool, queue, retry, compaction and settlement events.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1339,
          "symbol": "Session event subscribers"
        }
      ],
      "notes": "These are observed runtime events when pi runs; Studio traces are illustrative."
    },
    {
      "id": "usage",
      "label": "getSessionStats()",
      "groupId": "presentation",
      "kind": "component",
      "summary": "Aggregates persisted message and standalone usage entries, including provider token/cache/cost records.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 4134,
          "symbol": "getSessionStats()"
        }
      ]
    },
    {
      "id": "cache",
      "label": "CacheWarmer",
      "groupId": "presentation",
      "kind": "component",
      "summary": "Optional timer replays eligible selected-model context to retain prompt cache while transcript prefix remains current.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/cache-warmer.ts",
          "line": 162,
          "symbol": "CacheWarmer"
        }
      ],
      "conditions": "Cache settings/model TTL and replay safety checks; extension can influence warming.",
      "notes": "Background warming is not an extra user turn."
    },
    {
      "id": "output",
      "label": "stdout ownership / backpressure",
      "groupId": "presentation",
      "kind": "component",
      "summary": "Protects RPC/JSON stdout from incidental logs and serializes raw writes with transient buffer retry.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/output-guard.ts",
          "line": 45,
          "symbol": "stdout ownership / backpressure"
        }
      ]
    },
    {
      "id": "diagnostics",
      "label": "recordCrash() / diagnostics",
      "groupId": "presentation",
      "kind": "component",
      "summary": "Records crash details and resource/settings startup diagnostics for inspection; distinct from usage accounting.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/crash-log.ts",
          "line": 124,
          "symbol": "recordCrash() / diagnostics"
        }
      ]
    },
    {
      "id": "telemetry",
      "label": "Install telemetry gate",
      "groupId": "presentation",
      "kind": "component",
      "summary": "Settings/environment gate controls install telemetry preference.",
      "source": [
        {
          "file": "packages/coding-agent/src/core/telemetry.ts",
          "line": 8,
          "symbol": "Install telemetry gate"
        }
      ],
      "notes": "This gate is not evidence of automatic full turn tracing or benchmark collection."
    },
    {
      "id": "experimental",
      "label": "Experimental command dispatch",
      "groupId": "remote",
      "kind": "component",
      "summary": "Source-only experimental commands select separate client/server operation; not default stable CLI mode.",
      "source": [
        {
          "file": "packages/coding-agent/src/cli/experimental/cli.ts",
          "line": 16,
          "symbol": "Experimental command dispatch"
        }
      ],
      "conditions": "Experimental feature enabled and explicit command."
    },
    {
      "id": "remote-client",
      "label": "pi-client Client",
      "groupId": "remote",
      "kind": "component",
      "summary": "Correlates remote requests, maintains attachment/connection state and hydrates/decodes replicated service subscriptions.",
      "source": [
        {
          "file": "packages/client/src/client.ts",
          "line": 62,
          "symbol": "pi-client Client"
        }
      ]
    },
    {
      "id": "remote-server",
      "label": "pi-server Server",
      "groupId": "remote",
      "kind": "component",
      "summary": "Accepts byte listeners, validates handshake, routes service requests and publishes attachments/events.",
      "source": [
        {
          "file": "packages/server/src/server.ts",
          "line": 46,
          "symbol": "pi-server Server"
        }
      ],
      "failures": "Wrong server/version/frame/host failures are protocol errors; shutdown disposes routes."
    },
    {
      "id": "frame",
      "label": "Protocol framing / codec",
      "groupId": "remote",
      "kind": "component",
      "summary": "Encodes typed client/server envelopes and length-framed payloads with validation/frame limits.",
      "source": [
        {
          "file": "packages/protocol/src/codec.ts",
          "line": 56,
          "symbol": "Protocol framing / codec"
        }
      ],
      "notes": "Transport carries service payloads; coding-agent service inventory belongs to service hosts."
    },
    {
      "id": "launcher",
      "label": "activateServer()",
      "groupId": "remote",
      "kind": "component",
      "summary": "Uses private server directory/identity locks to connect or launch logical Unix server safely.",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/server.ts",
          "line": 145,
          "symbol": "activateServer()"
        }
      ]
    },
    {
      "id": "coordinator",
      "label": "CoordinatorConnection",
      "groupId": "remote",
      "kind": "component",
      "summary": "Server-side endpoint of the coordinator router tracks registered peers and replacement, routes opaque control messages and detects connection loss.",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/coordinator.ts",
          "line": 43,
          "symbol": "CoordinatorConnection"
        }
      ],
      "notes": "ensureCoordinator/startup leases belong to server startup; this class is the registered server endpoint."
    },
    {
      "id": "workers",
      "label": "SessionWorkerManager",
      "groupId": "remote",
      "kind": "component",
      "summary": "Starts/attaches per-session workers and manages branch plugin selections and retirement.",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/session-worker-manager.ts",
          "line": 95,
          "symbol": "SessionWorkerManager"
        }
      ]
    },
    {
      "id": "worker",
      "label": "runSessionWorkerWithHarness()",
      "groupId": "remote",
      "kind": "component",
      "summary": "Worker owns durable Harness storage, loads service facets and stays alive for demand/live tasks.",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/session-worker.ts",
          "line": 739,
          "symbol": "runSessionWorkerWithHarness()"
        }
      ]
    },
    {
      "id": "catalog-store",
      "label": "Experimental session catalogue",
      "groupId": "remote",
      "kind": "store",
      "summary": "meta.json stores session identity/cwd; session.sqlite belongs to worker durable storage.",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/session-catalog.ts",
          "line": 58,
          "symbol": "Experimental session catalogue"
        }
      ],
      "notes": "Separate from stable SessionManager JSONL history."
    },
    {
      "id": "controller",
      "label": "createAgentController()",
      "groupId": "remote",
      "kind": "component",
      "summary": "Presentation-safe service prompts, steers, queues, aborts and compacts root durable conversation.",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/services/agent-controller-provider.ts",
          "line": 18,
          "symbol": "createAgentController()"
        }
      ],
      "notes": "Current service does not expose stable tree navigation, subagent conversation services or old-history paging."
    },
    {
      "id": "open-durable",
      "label": "openDurable()",
      "groupId": "durable",
      "kind": "component",
      "summary": "Alternate local demonstration opens SQLite Harness with coding registry, settings, environments and foreground Subagent.",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/durable/runtime.ts",
          "line": 124,
          "symbol": "openDurable()"
        }
      ],
      "conditions": "Explicit experimental durable entry; not createAgentSession."
    },
    {
      "id": "harness",
      "label": "Harness / HarnessImpl",
      "groupId": "durable",
      "kind": "component",
      "summary": "Transactional durable owner of conversations, registry, submissions, tasks, views and commits.",
      "source": [
        {
          "file": "packages/durable/src/harness/harness.ts",
          "line": 164,
          "symbol": "Harness / HarnessImpl"
        }
      ]
    },
    {
      "id": "sqlite",
      "label": "openNodeSqliteStorage()",
      "groupId": "durable",
      "kind": "store",
      "summary": "SQLite-backed durable Storage opened under session directory lock.",
      "source": [
        {
          "file": "packages/durable/src/storage/sqlite/node.ts",
          "line": 205,
          "symbol": "openNodeSqliteStorage()"
        }
      ],
      "notes": "Durable subsystem also offers memory/JSONL storage implementations, not selected by this local demo."
    },
    {
      "id": "conversation",
      "label": "ConversationImpl.submit()",
      "groupId": "durable",
      "kind": "component",
      "summary": "Conversation handle delegates input/steering/follow-up submissions and compaction to durable host.",
      "source": [
        {
          "file": "packages/durable/src/harness/harness.ts",
          "line": 82,
          "symbol": "ConversationImpl.submit()"
        }
      ]
    },
    {
      "id": "scheduler",
      "label": "TaskScheduler",
      "groupId": "durable",
      "kind": "component",
      "summary": "Schedules persisted task execution, wait ownership and recovery lifecycle.",
      "source": [
        {
          "file": "packages/durable/src/harness/scheduler.ts",
          "line": 174,
          "symbol": "TaskScheduler"
        }
      ]
    },
    {
      "id": "generation",
      "label": "GenerationTask",
      "groupId": "durable",
      "kind": "component",
      "summary": "Durable model generation task commits live partial/final state and coordinates tool tasks/next work.",
      "source": [
        {
          "file": "packages/durable/src/harness/generation.ts",
          "line": 115,
          "symbol": "GenerationTask"
        }
      ]
    },
    {
      "id": "durable-tool",
      "label": "ToolTask",
      "groupId": "durable",
      "kind": "component",
      "summary": "Persisted tool task uses declared replay policy and checkpoint/recovery semantics.",
      "source": [
        {
          "file": "packages/durable/src/harness/tool.ts",
          "line": 50,
          "symbol": "ToolTask"
        }
      ],
      "notes": "Side effects depend on tool replay contract; durable storage does not imply all tools execute exactly once."
    },
    {
      "id": "subagent",
      "label": "Subagent extension",
      "groupId": "durable",
      "kind": "component",
      "summary": "Foreground tool finds/creates task-owned child, submits idempotent request and waits for answer; child can outlive call.",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/durable/subagent.ts",
          "line": 24,
          "symbol": "Subagent extension"
        }
      ],
      "conditions": "Installed by openDurable; removed from child configuration to prevent recursive delegation.",
      "notes": "Child copies agent configuration, not parent conversation transcript."
    },
    {
      "id": "view",
      "label": "ConversationViews / viewState()",
      "groupId": "durable",
      "kind": "component",
      "summary": "Projects transcript and built-in live/inbox/agent/usage documents into replicated conversation view.",
      "source": [
        {
          "file": "packages/durable/src/harness/view.ts",
          "line": 71,
          "symbol": "ConversationViews / viewState()"
        }
      ]
    },
    {
      "id": "task-graph",
      "label": "TaskGraphView",
      "groupId": "durable",
      "kind": "component",
      "summary": "Exposes tasks, ownership and waits for optional live task panel.",
      "source": [
        {
          "file": "packages/durable/src/harness/task-graph.ts",
          "line": 62,
          "symbol": "TaskGraphView"
        }
      ],
      "notes": "Task-graph structure differs from this explanatory Studio component map."
    },
    {
      "id": "facets",
      "label": "FacetHost / FacetKernel",
      "groupId": "chord",
      "kind": "component",
      "summary": "Validates setup-produced dependency graph, activates providers before consumers and reloads compatible generations.",
      "source": [
        {
          "file": "packages/chord/src/facets/host.ts",
          "line": 340,
          "symbol": "FacetHost / FacetKernel"
        }
      ]
    },
    {
      "id": "service-source",
      "label": "createServerServiceSource() / createSessionServiceSource()",
      "groupId": "chord",
      "kind": "component",
      "summary": "Binds generated server/session catalogues into connected service handles, with detached availability.",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/services/connection.ts",
          "line": 354,
          "symbol": "createServerServiceSource() / createSessionServiceSource()"
        }
      ]
    },
    {
      "id": "transcript-service",
      "label": "Transcript provider",
      "groupId": "chord",
      "kind": "component",
      "summary": "Serves durable Conversation.viewState directly as replicated state rather than reducing events again.",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/services/transcript-provider.ts",
          "line": 6,
          "symbol": "Transcript provider"
        }
      ]
    },
    {
      "id": "replica",
      "label": "createServiceStateDecoder() / encoder",
      "groupId": "chord",
      "kind": "component",
      "summary": "Encodes snapshots/operations with per-client path dictionaries; replica machinery owns hydration and sequencing.",
      "source": [
        {
          "file": "packages/chord/src/services/state-codec.ts",
          "line": 99,
          "symbol": "createServiceStateDecoder() / encoder"
        }
      ]
    },
    {
      "id": "plugins",
      "label": "PresentationPlugins / SessionPlugins",
      "groupId": "chord",
      "kind": "component",
      "summary": "Contracts let server prepare matching session/TUI facets and reload selected plugin generations.",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/services/plugins.ts",
          "line": 12,
          "symbol": "PresentationPlugins / SessionPlugins"
        }
      ]
    }
  ],
  "edges": [
    {
      "id": "cli-mode-1",
      "to": "mode",
      "label": "select application mode",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/main.ts",
          "line": 651,
          "symbol": "main → resolveAppMode"
        }
      ],
      "from": "cli"
    },
    {
      "id": "cli-initial-2",
      "to": "initial",
      "label": "prepare initial input",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/main.ts",
          "line": 900,
          "symbol": "main → prepareInitialMessage"
        }
      ],
      "from": "cli"
    },
    {
      "id": "mode-tui-3",
      "to": "tui",
      "label": "interactive TTY",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/main.ts",
          "line": 951,
          "symbol": "interactive TTY"
        }
      ],
      "from": "mode",
      "condition": "Interactive mode selected"
    },
    {
      "id": "mode-print-4",
      "to": "print",
      "label": "print or JSON",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/main.ts",
          "line": 985,
          "symbol": "print or JSON"
        }
      ],
      "from": "mode",
      "condition": "Print or JSON mode selected"
    },
    {
      "id": "mode-rpc-5",
      "to": "rpc",
      "label": "JSONL RPC",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/main.ts",
          "line": 949,
          "symbol": "JSONL RPC"
        }
      ],
      "from": "mode",
      "condition": "RPC mode selected"
    },
    {
      "id": "rpc-client-rpc-6",
      "to": "rpc",
      "label": "spawn RPC child",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/modes/rpc/rpc-client.ts",
          "line": 94,
          "symbol": "spawn RPC child"
        }
      ],
      "from": "rpc-client",
      "condition": "RpcClient started"
    },
    {
      "id": "cli-services-7",
      "to": "services",
      "label": "construct cwd services",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/main.ts",
          "line": 749,
          "symbol": "construct cwd services"
        }
      ],
      "from": "cli"
    },
    {
      "id": "services-model-runtime-8",
      "to": "model-runtime",
      "label": "create model/auth runtime",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session-services.ts",
          "line": 142,
          "symbol": "create model/auth runtime"
        }
      ],
      "from": "services"
    },
    {
      "id": "services-settings-9",
      "to": "settings",
      "label": "create settings manager",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session-services.ts",
          "line": 147,
          "symbol": "create settings manager"
        }
      ],
      "from": "services"
    },
    {
      "id": "services-resources-10",
      "to": "resources",
      "label": "reload discovered resources",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session-services.ts",
          "line": 154,
          "symbol": "reload discovered resources"
        }
      ],
      "from": "services"
    },
    {
      "id": "services-sdk-11",
      "to": "sdk",
      "label": "services supplied to session factory",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session-services.ts",
          "line": 217,
          "symbol": "create session from services"
        }
      ],
      "from": "services"
    },
    {
      "id": "cli-runtime-12",
      "to": "runtime",
      "label": "create replaceable host runtime",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/main.ts",
          "line": 862,
          "symbol": "create replaceable host runtime"
        }
      ],
      "from": "cli"
    },
    {
      "id": "sdk-manager-13",
      "to": "manager",
      "label": "create/default or supplied manager",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/sdk.ts",
          "line": 185,
          "symbol": "createAgentSession → SessionManager.create"
        }
      ],
      "from": "sdk"
    },
    {
      "id": "sdk-agent-14",
      "to": "agent",
      "label": "construct core Agent",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/sdk.ts",
          "line": 387,
          "symbol": "construct core Agent"
        }
      ],
      "from": "sdk"
    },
    {
      "id": "sdk-session-15",
      "to": "session",
      "label": "construct coding session",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/sdk.ts",
          "line": 437,
          "symbol": "construct coding session"
        }
      ],
      "from": "sdk"
    },
    {
      "id": "runtime-session-16",
      "to": "session",
      "label": "owns current session",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session-runtime.ts",
          "line": 90,
          "symbol": "owns current session"
        }
      ],
      "from": "runtime"
    },
    {
      "id": "runtime-replace-17",
      "to": "replace",
      "label": "session switch/new/fork",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session-runtime.ts",
          "line": 196,
          "symbol": "session switch/new/fork"
        }
      ],
      "from": "runtime"
    },
    {
      "id": "replace-shutdown-18",
      "to": "shutdown",
      "label": "settle outgoing work",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session-runtime.ts",
          "line": 212,
          "symbol": "settle outgoing work"
        }
      ],
      "from": "replace"
    },
    {
      "id": "shutdown-abort-19",
      "to": "abort",
      "label": "abort before disposal",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session-runtime.ts",
          "line": 170,
          "symbol": "abort before disposal"
        }
      ],
      "from": "shutdown"
    },
    {
      "id": "replace-services-20",
      "to": "services",
      "label": "recreate services/runtime",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session-runtime.ts",
          "line": 214,
          "symbol": "recreate services/runtime"
        }
      ],
      "from": "replace"
    },
    {
      "id": "replace-fork-21",
      "to": "fork",
      "label": "fork branch ancestry",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session-runtime.ts",
          "line": 316,
          "symbol": "fork branch ancestry"
        }
      ],
      "from": "replace"
    },
    {
      "id": "resources-settings-22",
      "to": "settings",
      "label": "reload trusted settings",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/resource-loader.ts",
          "line": 520,
          "symbol": "reload → settingsManager.reload"
        }
      ],
      "from": "resources"
    },
    {
      "id": "resources-packages-23",
      "to": "packages",
      "label": "resolve packages",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/resource-loader.ts",
          "line": 521,
          "symbol": "resolve packages"
        }
      ],
      "from": "resources"
    },
    {
      "id": "resources-trust-24",
      "to": "trust",
      "label": "resolve project trust before reload",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/resource-loader.ts",
          "line": 515,
          "symbol": "resolve project trust before reload"
        }
      ],
      "from": "resources",
      "condition": "Host supplies trust resolver"
    },
    {
      "id": "resources-extension-loader-25",
      "to": "extension-loader",
      "label": "load final extension set",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/resource-loader.ts",
          "line": 574,
          "symbol": "load final extension set"
        }
      ],
      "from": "resources"
    },
    {
      "id": "cli-builtin-ext-26",
      "to": "builtin-ext",
      "label": "supply builtin extension factories",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/main.ts",
          "line": 575,
          "symbol": "supply builtin extension factories"
        }
      ],
      "from": "cli"
    },
    {
      "id": "resources-skills-27",
      "to": "skills",
      "label": "load skill paths",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/resource-loader.ts",
          "line": 592,
          "symbol": "reload → updateSkillsFromPaths"
        }
      ],
      "from": "resources"
    },
    {
      "id": "resources-templates-28",
      "to": "templates",
      "label": "load prompt paths",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/resource-loader.ts",
          "line": 607,
          "symbol": "reload → updatePromptsFromPaths"
        }
      ],
      "from": "resources"
    },
    {
      "id": "resources-agents-files-29",
      "to": "agents-files",
      "label": "discover project context",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/resource-loader.ts",
          "line": 637,
          "symbol": "reload → loadProjectContextFiles"
        }
      ],
      "from": "resources",
      "condition": "Context files enabled (noContextFiles is false); project instruction text loading itself is not gated by project trust"
    },
    {
      "id": "tui-prompt-30",
      "to": "prompt",
      "label": "submit editor input",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/modes/interactive/interactive-mode.ts",
          "line": 1243,
          "symbol": "editor submit → session.prompt"
        }
      ],
      "from": "tui"
    },
    {
      "id": "print-prompt-31",
      "to": "prompt",
      "label": "submit initial/messages",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/modes/print-mode.ts",
          "line": 132,
          "symbol": "submit initial/messages"
        }
      ],
      "from": "print"
    },
    {
      "id": "rpc-prompt-32",
      "to": "prompt",
      "label": "prompt command",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/modes/rpc/rpc-mode.ts",
          "line": 399,
          "symbol": "prompt command"
        }
      ],
      "from": "rpc"
    },
    {
      "id": "prompt-commands-33",
      "to": "commands",
      "label": "registered slash command",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1931,
          "symbol": "registered slash command"
        }
      ],
      "from": "prompt",
      "condition": "Input starts slash and registered command matches"
    },
    {
      "id": "prompt-input-hooks-34",
      "to": "input-hooks",
      "label": "intercept input",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1946,
          "symbol": "intercept input"
        }
      ],
      "from": "prompt"
    },
    {
      "id": "input-hooks-runner-35",
      "to": "runner",
      "label": "emit input handlers",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1880,
          "symbol": "emit input handlers"
        }
      ],
      "from": "input-hooks"
    },
    {
      "id": "prompt-skill-expand-36",
      "to": "skill-expand",
      "label": "expand skill command",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1961,
          "symbol": "expand skill command"
        }
      ],
      "from": "prompt",
      "condition": "Prompt expansion enabled"
    },
    {
      "id": "prompt-templates-37",
      "to": "templates",
      "label": "expand template",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1962,
          "symbol": "expand template"
        }
      ],
      "from": "prompt",
      "condition": "Prompt expansion enabled"
    },
    {
      "id": "skill-expand-skills-38",
      "to": "skills",
      "label": "find loaded skill",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 2107,
          "symbol": "find loaded skill"
        }
      ],
      "from": "skill-expand"
    },
    {
      "id": "prompt-busy-39",
      "to": "busy",
      "label": "busy input decision",
      "kind": "transition",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1966,
          "symbol": "busy input decision"
        }
      ],
      "from": "prompt"
    },
    {
      "id": "busy-steer-40",
      "to": "steer",
      "label": "steer while active",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1975,
          "symbol": "steer while active"
        }
      ],
      "from": "busy",
      "condition": "streamingBehavior = steer"
    },
    {
      "id": "busy-followup-41",
      "to": "followup",
      "label": "follow up while active",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1973,
          "symbol": "follow up while active"
        }
      ],
      "from": "busy",
      "condition": "streamingBehavior = followUp"
    },
    {
      "id": "prompt-before-start-42",
      "to": "before-start",
      "label": "adjust run before constructing messages",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 2015,
          "symbol": "adjust run before constructing messages"
        }
      ],
      "from": "prompt",
      "condition": "Idle input accepted"
    },
    {
      "id": "before-start-images-43",
      "to": "images",
      "label": "prompt resumes with image normalization",
      "kind": "transition",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 2028,
          "symbol": "normalize after model selection"
        }
      ],
      "from": "before-start",
      "condition": "before_agent_start handlers finished; normalization is owned by AgentSession.prompt"
    },
    {
      "id": "prompt-loadout-44",
      "to": "loadout",
      "label": "prepare prompt/tool delta",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 2058,
          "symbol": "prompt → _preparePromptAndToolLoadout"
        }
      ],
      "from": "prompt"
    },
    {
      "id": "loadout-prompt-sections-45",
      "to": "prompt-sections",
      "label": "build and diff prompt sections",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1700,
          "symbol": "build and diff prompt sections"
        }
      ],
      "from": "loadout"
    },
    {
      "id": "prompt-sections-agents-files-46",
      "to": "agents-files",
      "label": "include context files",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/system-prompt.ts",
          "line": 164,
          "symbol": "buildSystemPromptSections → renderProjectContext"
        }
      ],
      "from": "prompt-sections"
    },
    {
      "id": "prompt-sections-skills-47",
      "to": "skills",
      "label": "include skill metadata",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/system-prompt.ts",
          "line": 167,
          "symbol": "buildSystemPromptSections → formatSkillsForPrompt"
        }
      ],
      "from": "prompt-sections",
      "condition": "Selected tools include read or bash and skills are loaded"
    },
    {
      "id": "prompt-run-48",
      "to": "run",
      "label": "start prepared messages",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 2063,
          "symbol": "start prepared messages"
        }
      ],
      "from": "prompt"
    },
    {
      "id": "run-agent-49",
      "to": "agent",
      "label": "prompt then conditional continue",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1785,
          "symbol": "prompt then conditional continue"
        }
      ],
      "from": "run"
    },
    {
      "id": "agent-loop-50",
      "to": "loop",
      "label": "run low-level loop",
      "kind": "call",
      "source": [
        {
          "file": "packages/agent/src/agent.ts",
          "line": 437,
          "symbol": "run low-level loop"
        }
      ],
      "from": "agent"
    },
    {
      "id": "loop-refresh-51",
      "to": "refresh",
      "label": "prepare subsequent turn",
      "kind": "call",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 186,
          "symbol": "prepare subsequent turn"
        }
      ],
      "from": "loop",
      "condition": "Previous completed turn exists"
    },
    {
      "id": "loop-tool-delta-52",
      "to": "tool-delta",
      "label": "declare executable tool changes",
      "kind": "call",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 211,
          "symbol": "declare executable tool changes"
        }
      ],
      "from": "loop"
    },
    {
      "id": "loop-projection-53",
      "to": "projection",
      "label": "prepare canonical request",
      "kind": "call",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 219,
          "symbol": "prepare canonical request"
        }
      ],
      "from": "loop"
    },
    {
      "id": "projection-context-54",
      "to": "context",
      "label": "read canonical projection",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 765,
          "symbol": "prepareRequest → buildSessionProjection"
        }
      ],
      "from": "projection"
    },
    {
      "id": "projection-route-55",
      "to": "route",
      "label": "route virtual selection",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 794,
          "symbol": "prepareRequest → ModelRuntime.resolveModel"
        }
      ],
      "from": "projection",
      "condition": "Selected model is virtual"
    },
    {
      "id": "route-route-state-56",
      "to": "route-state",
      "label": "persist changed router state",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 804,
          "symbol": "persist changed router state"
        }
      ],
      "from": "route",
      "condition": "Returned route state changed"
    },
    {
      "id": "projection-pressure-57",
      "to": "pressure",
      "label": "check routed physical model size",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 810,
          "symbol": "check routed physical model size"
        }
      ],
      "from": "projection",
      "condition": "Virtual model routed"
    },
    {
      "id": "refresh-pressure-58",
      "to": "pressure",
      "label": "check next response context",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 752,
          "symbol": "check next response context"
        }
      ],
      "from": "refresh",
      "condition": "Physical model and context pressure"
    },
    {
      "id": "loop-stream-59",
      "to": "stream",
      "label": "stream one assistant response",
      "kind": "call",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 242,
          "symbol": "stream one assistant response"
        }
      ],
      "from": "loop"
    },
    {
      "id": "stream-transform-60",
      "to": "transform",
      "label": "apply context transforms",
      "kind": "call",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 391,
          "symbol": "apply context transforms"
        }
      ],
      "from": "stream"
    },
    {
      "id": "transform-runner-61",
      "to": "runner",
      "label": "extension context transformation",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/sdk.ts",
          "line": 415,
          "symbol": "extension context transformation"
        }
      ],
      "from": "transform"
    },
    {
      "id": "stream-convert-62",
      "to": "convert",
      "label": "convert at model boundary",
      "kind": "call",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 395,
          "symbol": "convert at model boundary"
        }
      ],
      "from": "stream"
    },
    {
      "id": "stream-provider-stream-63",
      "to": "provider-stream",
      "label": "invoke selected stream function",
      "kind": "call",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 403,
          "symbol": "invoke selected stream function"
        }
      ],
      "from": "stream"
    },
    {
      "id": "model-runtime-auth-64",
      "to": "auth",
      "label": "resolve per-request auth",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/model-runtime.ts",
          "line": 547,
          "symbol": "resolve per-request auth"
        }
      ],
      "from": "model-runtime"
    },
    {
      "id": "model-runtime-catalog-65",
      "to": "catalog",
      "label": "refresh provider availability",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/model-runtime.ts",
          "line": 839,
          "symbol": "refresh provider availability"
        }
      ],
      "from": "model-runtime"
    },
    {
      "id": "provider-stream-adapters-66",
      "to": "adapters",
      "label": "provider/API implementation dispatch",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/model-runtime.ts",
          "line": 738,
          "symbol": "streamSimple → provider.streamSimple"
        }
      ],
      "from": "provider-stream",
      "condition": "Model API implementation selected"
    },
    {
      "id": "adapters-endpoint-67",
      "to": "endpoint",
      "label": "send API request",
      "kind": "call",
      "source": [
        {
          "file": "packages/ai/src/api/openai-responses.ts",
          "line": 184,
          "symbol": "send API request"
        }
      ],
      "from": "adapters",
      "condition": "Concrete OpenAI Responses example"
    },
    {
      "id": "adapters-provider-retry-68",
      "to": "provider-retry",
      "label": "provider retry policy",
      "kind": "call",
      "source": [
        {
          "file": "packages/ai/src/api/openai-responses.ts",
          "line": 183,
          "symbol": "provider retry policy"
        }
      ],
      "from": "adapters",
      "condition": "Concrete OpenAI Responses adapter wraps initial request; retries require retryable failure and remaining configured budget"
    },
    {
      "id": "sdk-provider-hooks-69",
      "to": "provider-hooks",
      "label": "install payload/response callbacks",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/sdk.ts",
          "line": 408,
          "symbol": "install payload/response callbacks"
        }
      ],
      "from": "sdk"
    },
    {
      "id": "provider-hooks-runner-70",
      "to": "runner",
      "label": "emit provider hook",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/sdk.ts",
          "line": 361,
          "symbol": "emit provider hook"
        }
      ],
      "from": "provider-hooks"
    },
    {
      "id": "stream-stop-71",
      "to": "stop",
      "label": "failed or aborted final response",
      "kind": "transition",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 245,
          "symbol": "failed or aborted final response"
        }
      ],
      "from": "stream",
      "condition": "stopReason error or aborted"
    },
    {
      "id": "stream-dispatch-72",
      "to": "dispatch",
      "label": "tool calls in assistant response",
      "kind": "transition",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 270,
          "symbol": "tool calls in assistant response"
        }
      ],
      "from": "stream",
      "condition": "Tool calls and response not error/aborted/length"
    },
    {
      "id": "stream-truncated-73",
      "to": "truncated",
      "label": "reject potentially truncated arguments",
      "kind": "transition",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 269,
          "symbol": "reject potentially truncated arguments"
        }
      ],
      "from": "stream",
      "condition": "Tool calls and stopReason length"
    },
    {
      "id": "dispatch-prepare-tool-74",
      "to": "prepare-tool",
      "label": "validate calls before execution",
      "kind": "call",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 549,
          "symbol": "validate calls before execution"
        }
      ],
      "from": "dispatch"
    },
    {
      "id": "prepare-tool-tool-hook-75",
      "to": "tool-hook",
      "label": "beforeToolCall interception",
      "kind": "call",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 728,
          "symbol": "beforeToolCall interception"
        }
      ],
      "from": "prepare-tool"
    },
    {
      "id": "tool-hook-runner-76",
      "to": "runner",
      "label": "tool_call event",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 640,
          "symbol": "tool_call event"
        }
      ],
      "from": "tool-hook"
    },
    {
      "id": "dispatch-execute-tool-77",
      "to": "execute-tool",
      "label": "sequential or parallel execution",
      "kind": "call",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 558,
          "symbol": "sequential or parallel execution"
        }
      ],
      "from": "dispatch"
    },
    {
      "id": "execute-tool-tool-result-78",
      "to": "tool-result",
      "label": "caller finalizes executed outcome",
      "kind": "transition",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 864,
          "symbol": "post-execution interception"
        }
      ],
      "from": "execute-tool",
      "condition": "Prepared execution returned; dispatcher or runToolCall invokes finalizeExecutedToolCall"
    },
    {
      "id": "tool-result-runner-79",
      "to": "runner",
      "label": "tool_result event",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 662,
          "symbol": "tool_result event"
        }
      ],
      "from": "tool-result"
    },
    {
      "id": "session-read-80",
      "to": "read",
      "label": "register builtin implementation",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/tools/index.ts",
          "line": 121,
          "symbol": "register builtin implementation"
        }
      ],
      "from": "session"
    },
    {
      "id": "read-filesystem-81",
      "to": "filesystem",
      "label": "filesystem or process operations",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/tools/read.ts",
          "line": 81,
          "symbol": "filesystem or process operations"
        }
      ],
      "from": "read"
    },
    {
      "id": "session-bash-82",
      "to": "bash",
      "label": "register builtin implementation",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/tools/index.ts",
          "line": 123,
          "symbol": "register builtin implementation"
        }
      ],
      "from": "session"
    },
    {
      "id": "bash-filesystem-83",
      "to": "filesystem",
      "label": "filesystem or process operations",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/tools/bash.ts",
          "line": 261,
          "symbol": "filesystem or process operations"
        }
      ],
      "from": "bash"
    },
    {
      "id": "session-edit-84",
      "to": "edit",
      "label": "register builtin implementation",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/tools/index.ts",
          "line": 127,
          "symbol": "register builtin implementation"
        }
      ],
      "from": "session"
    },
    {
      "id": "edit-filesystem-85",
      "to": "filesystem",
      "label": "filesystem or process operations",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/tools/edit.ts",
          "line": 159,
          "symbol": "filesystem or process operations"
        }
      ],
      "from": "edit"
    },
    {
      "id": "session-write-86",
      "to": "write",
      "label": "register builtin implementation",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/tools/index.ts",
          "line": 129,
          "symbol": "register builtin implementation"
        }
      ],
      "from": "session"
    },
    {
      "id": "write-filesystem-87",
      "to": "filesystem",
      "label": "filesystem or process operations",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/tools/write.ts",
          "line": 58,
          "symbol": "filesystem or process operations"
        }
      ],
      "from": "write"
    },
    {
      "id": "session-search-88",
      "to": "search",
      "label": "register builtin implementation",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/tools/index.ts",
          "line": 131,
          "symbol": "register builtin implementation"
        }
      ],
      "from": "session"
    },
    {
      "id": "search-filesystem-89",
      "to": "filesystem",
      "label": "filesystem or process operations",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/tools/grep.ts",
          "line": 81,
          "symbol": "filesystem or process operations"
        }
      ],
      "from": "search"
    },
    {
      "id": "edit-mutation-90",
      "to": "mutation",
      "label": "serialize edit mutation",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/tools/edit.ts",
          "line": 163,
          "symbol": "serialize edit mutation"
        }
      ],
      "from": "edit"
    },
    {
      "id": "builtin-ext-mcp-ext-91",
      "to": "mcp-ext",
      "label": "register MCP extension",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/index.ts",
          "line": 13,
          "symbol": "register MCP extension"
        }
      ],
      "from": "builtin-ext"
    },
    {
      "id": "builtin-ext-codemode-92",
      "to": "codemode",
      "label": "register codemode extension",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/codemode/index.ts",
          "line": 34,
          "symbol": "register codemode extension"
        }
      ],
      "from": "builtin-ext"
    },
    {
      "id": "mcp-ext-mcp-conn-93",
      "to": "mcp-conn",
      "label": "create server connection",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/mcp/index.ts",
          "line": 521,
          "symbol": "create server connection"
        }
      ],
      "from": "mcp-ext"
    },
    {
      "id": "mcp-conn-mcp-transport-94",
      "to": "mcp-transport",
      "label": "construct configured transport",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/mcp/runtime.ts",
          "line": 383,
          "symbol": "McpServerConnection → createTransport"
        }
      ],
      "from": "mcp-conn"
    },
    {
      "id": "mcp-transport-mcp-server-95",
      "to": "mcp-server",
      "label": "connect HTTP or stdio server",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/mcp/runtime.ts",
          "line": 104,
          "symbol": "connect HTTP or stdio server"
        }
      ],
      "from": "mcp-transport",
      "condition": "URL branch shown; command branch uses StdioTransport"
    },
    {
      "id": "mcp-ext-mcp-resources-96",
      "to": "mcp-resources",
      "label": "register resource operations",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/mcp/index.ts",
          "line": 446,
          "symbol": "register resource operations"
        }
      ],
      "from": "mcp-ext"
    },
    {
      "id": "mcp-ext-loadout-97",
      "to": "loadout",
      "label": "register exposed MCP tools",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/mcp/index.ts",
          "line": 403,
          "symbol": "register exposed MCP tools"
        }
      ],
      "from": "mcp-ext",
      "condition": "Tools discovered and enabled exposure"
    },
    {
      "id": "tool-search-loadout-98",
      "to": "loadout",
      "label": "activate undeclared matches",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/tool-search/tool.ts",
          "line": 209,
          "symbol": "activate undeclared matches"
        }
      ],
      "from": "tool-search",
      "condition": "tool_search selected matches"
    },
    {
      "id": "codemode-sandbox-99",
      "to": "sandbox",
      "label": "lazy script executor",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/codemode/tool.ts",
          "line": 383,
          "symbol": "lazy script executor"
        }
      ],
      "from": "codemode"
    },
    {
      "id": "sandbox-nested-100",
      "to": "nested",
      "label": "call tools through ctx.executeTool",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/codemode/execute.ts",
          "line": 363,
          "symbol": "call tools through ctx.executeTool"
        }
      ],
      "from": "sandbox"
    },
    {
      "id": "nested-prepare-tool-101",
      "to": "prepare-tool",
      "label": "shared tool validation and hooks",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 720,
          "symbol": "shared tool validation and hooks"
        }
      ],
      "from": "nested"
    },
    {
      "id": "nested-mcp-conn-102",
      "to": "mcp-conn",
      "label": "MCP nested calls use registered tools",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/mcp/tools.ts",
          "line": 314,
          "symbol": "MCP tool definition → client.callTool"
        }
      ],
      "from": "nested",
      "condition": "Callable selected tool is MCP-backed"
    },
    {
      "id": "sandbox-script-store-103",
      "to": "script-store",
      "label": "read branch store",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/codemode/execute.ts",
          "line": 393,
          "symbol": "read branch store"
        }
      ],
      "from": "sandbox"
    },
    {
      "id": "sandbox-manager-104",
      "to": "manager",
      "label": "commit successful script store writes",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/extensions/codemode/execute.ts",
          "line": 409,
          "symbol": "commit successful script store writes"
        }
      ],
      "from": "sandbox",
      "condition": "Script successful and store writes present"
    },
    {
      "id": "agent-event-persist-105",
      "to": "event-persist",
      "label": "subscribe for internal handling",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 485,
          "symbol": "subscribe for internal handling"
        }
      ],
      "from": "agent"
    },
    {
      "id": "event-persist-manager-106",
      "to": "manager",
      "label": "append finalized message",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1133,
          "symbol": "append finalized message"
        }
      ],
      "from": "event-persist",
      "condition": "message_end for supported roles"
    },
    {
      "id": "event-persist-events-107",
      "to": "events",
      "label": "notify public listeners before append",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1112,
          "symbol": "notify public listeners before append"
        }
      ],
      "from": "event-persist"
    },
    {
      "id": "event-persist-runner-108",
      "to": "runner",
      "label": "extension event before listener/persistence",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1111,
          "symbol": "extension event before listener/persistence"
        }
      ],
      "from": "event-persist"
    },
    {
      "id": "manager-jsonl-109",
      "to": "jsonl",
      "label": "append persistent entry",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/session-manager.ts",
          "line": 1195,
          "symbol": "append persistent entry"
        }
      ],
      "from": "manager",
      "condition": "Persisted manager and conversation exists"
    },
    {
      "id": "manager-branch-110",
      "to": "branch",
      "label": "read current ancestry",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/session-manager.ts",
          "line": 1469,
          "symbol": "read current ancestry"
        }
      ],
      "from": "manager"
    },
    {
      "id": "branch-context-111",
      "to": "context",
      "label": "build projected messages",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/session-manager.ts",
          "line": 543,
          "symbol": "build projected messages"
        }
      ],
      "from": "branch"
    },
    {
      "id": "context-edit-context-112",
      "to": "context",
      "label": "replace or omit projected content",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/session-manager.ts",
          "line": 519,
          "symbol": "replace or omit projected content"
        }
      ],
      "from": "context-edit"
    },
    {
      "id": "tree-branch-113",
      "to": "branch",
      "label": "move active leaf",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 4079,
          "symbol": "move active leaf"
        }
      ],
      "from": "tree",
      "condition": "Navigation proceeds"
    },
    {
      "id": "tree-branch-summary-114",
      "to": "branch-summary",
      "label": "optional abandoned-branch summary",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 4011,
          "symbol": "optional abandoned-branch summary"
        }
      ],
      "from": "tree",
      "condition": "Summarization requested"
    },
    {
      "id": "tree-context-115",
      "to": "context",
      "label": "refresh finalized projection",
      "kind": "transition",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 4088,
          "symbol": "navigateTree → _refreshFinalizedContext"
        }
      ],
      "from": "tree"
    },
    {
      "id": "manager-fork-116",
      "to": "fork",
      "label": "copy selected ancestry to new session",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/session-manager.ts",
          "line": 1632,
          "symbol": "copy selected ancestry to new session"
        }
      ],
      "from": "manager"
    },
    {
      "id": "session-export-117",
      "to": "export",
      "label": "explicit export operation",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 4239,
          "symbol": "explicit export operation"
        }
      ],
      "from": "session"
    },
    {
      "id": "pressure-auto-118",
      "to": "auto",
      "label": "threshold compaction",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 755,
          "symbol": "threshold compaction"
        }
      ],
      "from": "pressure",
      "condition": "Exceeds enabled threshold"
    },
    {
      "id": "manual-prepare-summary-119",
      "to": "prepare-summary",
      "label": "prepare manual cut",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 2733,
          "symbol": "prepare manual cut"
        }
      ],
      "from": "manual"
    },
    {
      "id": "auto-prepare-summary-120",
      "to": "prepare-summary",
      "label": "prepare automatic cut",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 3064,
          "symbol": "prepare automatic cut"
        }
      ],
      "from": "auto"
    },
    {
      "id": "auto-runner-121",
      "to": "runner",
      "label": "cancel or replace summary",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 3079,
          "symbol": "cancel or replace summary"
        }
      ],
      "from": "auto",
      "condition": "Handler registered"
    },
    {
      "id": "auto-summarize-122",
      "to": "summarize",
      "label": "default summary generation",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 3115,
          "symbol": "default summary generation"
        }
      ],
      "from": "auto",
      "condition": "No extension supplied summary"
    },
    {
      "id": "manual-summarize-123",
      "to": "summarize",
      "label": "default manual summary",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 2782,
          "symbol": "default manual summary"
        }
      ],
      "from": "manual",
      "condition": "No extension supplied compaction; operation not cancelled"
    },
    {
      "id": "summarize-provider-stream-124",
      "to": "provider-stream",
      "label": "separate summarization model call",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/compaction/compaction.ts",
          "line": 636,
          "symbol": "separate summarization model call"
        }
      ],
      "from": "summarize",
      "condition": "Default summary generator"
    },
    {
      "id": "auto-compact-entry-125",
      "to": "compact-entry",
      "label": "commit successful summary",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 3130,
          "symbol": "commit successful summary"
        }
      ],
      "from": "auto"
    },
    {
      "id": "compact-entry-context-126",
      "to": "context",
      "label": "project summary plus retained context",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/session-manager.ts",
          "line": 481,
          "symbol": "buildContextEntries: latest compaction selection"
        }
      ],
      "from": "compact-entry"
    },
    {
      "id": "run-auto-retry-127",
      "to": "auto-retry",
      "label": "retry eligible post-run error",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1817,
          "symbol": "retry eligible post-run error"
        }
      ],
      "from": "run",
      "condition": "Retryable error"
    },
    {
      "id": "run-overflow-128",
      "to": "overflow",
      "label": "post-run overflow/threshold check",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1837,
          "symbol": "post-run overflow/threshold check"
        }
      ],
      "from": "run"
    },
    {
      "id": "overflow-omit-129",
      "to": "omit",
      "label": "omit final failed attempt before recovery",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 2996,
          "symbol": "omit final failed attempt before recovery"
        }
      ],
      "from": "overflow",
      "condition": "First eligible recovery and retry needed"
    },
    {
      "id": "omit-context-edit-130",
      "to": "context-edit",
      "label": "persist recovery omission",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1219,
          "symbol": "_omitRecoveryAttempt → appendContextEdit"
        }
      ],
      "from": "omit"
    },
    {
      "id": "overflow-auto-131",
      "to": "auto",
      "label": "compact and possibly retry",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 2997,
          "symbol": "compact and possibly retry"
        }
      ],
      "from": "overflow",
      "condition": "Same-model overflow or recoverable length"
    },
    {
      "id": "auto-retry-agent-132",
      "to": "agent",
      "label": "continue after backoff",
      "kind": "transition",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1789,
          "symbol": "continue after backoff"
        }
      ],
      "from": "auto-retry",
      "condition": "Post-run handler permits retry and not aborted"
    },
    {
      "id": "loop-turn-decision-133",
      "to": "turn-decision",
      "label": "finish completed turn",
      "kind": "call",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 286,
          "symbol": "runLoop → finishTurn"
        }
      ],
      "from": "loop"
    },
    {
      "id": "turn-decision-boundary-134",
      "to": "boundary",
      "label": "persisted turn-end boundary",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 862,
          "symbol": "finishTurn wrapper → _dispatchTurnEndBoundary"
        }
      ],
      "from": "turn-decision"
    },
    {
      "id": "loop-steer-135",
      "to": "steer",
      "label": "poll next steering input",
      "kind": "data",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 176,
          "symbol": "poll next steering input"
        }
      ],
      "from": "loop"
    },
    {
      "id": "loop-followup-136",
      "to": "followup",
      "label": "poll when inner loop would stop",
      "kind": "data",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 302,
          "symbol": "poll when inner loop would stop"
        }
      ],
      "from": "loop"
    },
    {
      "id": "run-settle-137",
      "to": "settle",
      "label": "check pre-settlement continuation",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1792,
          "symbol": "check pre-settlement continuation"
        }
      ],
      "from": "run"
    },
    {
      "id": "settle-loop-138",
      "to": "loop",
      "label": "fresh continuation if accepted",
      "kind": "transition",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 1794,
          "symbol": "_runAgentPrompt → agent.continue after before-settle"
        }
      ],
      "from": "settle",
      "condition": "Valid extension continuation or late queued work"
    },
    {
      "id": "session-reload-139",
      "to": "reload",
      "label": "explicit reload operation",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 3612,
          "symbol": "explicit reload operation"
        }
      ],
      "from": "session"
    },
    {
      "id": "reload-resources-140",
      "to": "resources",
      "label": "reload resource set",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 3623,
          "symbol": "reload resource set"
        }
      ],
      "from": "reload"
    },
    {
      "id": "session-usage-141",
      "to": "usage",
      "label": "aggregate session evidence",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 4134,
          "symbol": "aggregate session evidence"
        }
      ],
      "from": "session"
    },
    {
      "id": "sdk-cache-142",
      "to": "cache",
      "label": "retain eligible request prefix",
      "kind": "background",
      "source": [
        {
          "file": "packages/coding-agent/src/core/sdk.ts",
          "line": 404,
          "symbol": "retain eligible request prefix"
        }
      ],
      "from": "sdk",
      "condition": "Selected-model request with session routing ID and warming enabled"
    },
    {
      "id": "cache-manager-143",
      "to": "manager",
      "label": "record warming usage",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/cache-warmer.ts",
          "line": 342,
          "symbol": "record warming usage"
        }
      ],
      "from": "cache"
    },
    {
      "id": "rpc-output-144",
      "to": "output",
      "label": "protect JSONL output",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/modes/rpc/rpc-mode.ts",
          "line": 61,
          "symbol": "protect JSONL output"
        }
      ],
      "from": "rpc"
    },
    {
      "id": "experimental-launcher-145",
      "to": "launcher",
      "label": "activate explicit remote command",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/server.ts",
          "line": 145,
          "symbol": "activate explicit remote command"
        }
      ],
      "from": "experimental",
      "condition": "Source-only experimental server/client path"
    },
    {
      "id": "launcher-coordinator-146",
      "to": "coordinator",
      "label": "coordinate server startup",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/server.ts",
          "line": 586,
          "symbol": "coordinate server startup"
        }
      ],
      "from": "launcher"
    },
    {
      "id": "launcher-remote-client-147",
      "to": "remote-client",
      "label": "connect existing or launched server",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/server.ts",
          "line": 221,
          "symbol": "connect existing or launched server"
        }
      ],
      "from": "launcher"
    },
    {
      "id": "remote-client-frame-148",
      "to": "frame",
      "label": "encode remote request",
      "kind": "call",
      "source": [
        {
          "file": "packages/client/src/client.ts",
          "line": 290,
          "symbol": "Client.#request → encodeClientMessage(request)"
        }
      ],
      "from": "remote-client"
    },
    {
      "id": "frame-remote-server-149",
      "to": "remote-server",
      "label": "decode server-side client envelope",
      "kind": "data",
      "source": [
        {
          "file": "packages/server/src/server.ts",
          "line": 156,
          "symbol": "Server: new ClientMessageDecoder"
        }
      ],
      "from": "frame"
    },
    {
      "id": "remote-server-workers-150",
      "to": "workers",
      "label": "host routes to worker owner",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/server.ts",
          "line": 589,
          "symbol": "host routes to worker owner"
        }
      ],
      "from": "remote-server"
    },
    {
      "id": "workers-worker-151",
      "to": "worker",
      "label": "spawn session worker",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/session-worker-manager.ts",
          "line": 465,
          "symbol": "spawn session worker"
        }
      ],
      "from": "workers"
    },
    {
      "id": "workers-catalog-store-152",
      "to": "catalog-store",
      "label": "host combines tracked workers and catalogue metadata",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/server.ts",
          "line": 391,
          "symbol": "select catalogue metadata"
        }
      ],
      "from": "workers"
    },
    {
      "id": "worker-harness-153",
      "to": "harness",
      "label": "owns durable Harness",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/session-worker.ts",
          "line": 784,
          "symbol": "owns durable Harness"
        }
      ],
      "from": "worker"
    },
    {
      "id": "worker-facets-154",
      "to": "facets",
      "label": "load service facets",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/services/worker.ts",
          "line": 82,
          "symbol": "createSessionWorkerServices → createFacetHost"
        }
      ],
      "from": "worker"
    },
    {
      "id": "facets-controller-155",
      "to": "controller",
      "label": "provide root agent operations",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/services/worker.ts",
          "line": 62,
          "symbol": "runtime facet → provide AgentController"
        }
      ],
      "from": "facets"
    },
    {
      "id": "controller-conversation-156",
      "to": "conversation",
      "label": "submit/control durable conversation",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/services/agent-controller-provider.ts",
          "line": 25,
          "symbol": "submit/control durable conversation"
        }
      ],
      "from": "controller"
    },
    {
      "id": "facets-transcript-service-157",
      "to": "transcript-service",
      "label": "provide replicated transcript",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/services/transcript-provider.ts",
          "line": 6,
          "symbol": "provide replicated transcript"
        }
      ],
      "from": "facets"
    },
    {
      "id": "transcript-service-view-158",
      "to": "view",
      "label": "serve viewState directly",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/services/transcript-provider.ts",
          "line": 7,
          "symbol": "serve viewState directly"
        }
      ],
      "from": "transcript-service"
    },
    {
      "id": "service-source-remote-client-159",
      "to": "remote-client",
      "label": "bind remote transport",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/services/connection.ts",
          "line": 111,
          "symbol": "bind remote transport"
        }
      ],
      "from": "service-source"
    },
    {
      "id": "remote-client-replica-160",
      "to": "replica",
      "label": "decode service state",
      "kind": "call",
      "source": [
        {
          "file": "packages/client/src/client.ts",
          "line": 183,
          "symbol": "decode service state"
        }
      ],
      "from": "remote-client"
    },
    {
      "id": "plugins-facets-161",
      "to": "facets",
      "label": "reload matching plugin generations",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/services/worker.ts",
          "line": 96,
          "symbol": "SessionPlugins.reload → facetHost.reload"
        }
      ],
      "from": "plugins"
    },
    {
      "id": "open-durable-sqlite-162",
      "to": "sqlite",
      "label": "open storage",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/durable/runtime.ts",
          "line": 139,
          "symbol": "open storage"
        }
      ],
      "from": "open-durable"
    },
    {
      "id": "open-durable-harness-163",
      "to": "harness",
      "label": "open alternate harness",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/durable/runtime.ts",
          "line": 138,
          "symbol": "open alternate harness"
        }
      ],
      "from": "open-durable"
    },
    {
      "id": "open-durable-subagent-164",
      "to": "subagent",
      "label": "install foreground subagent",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/durable/runtime.ts",
          "line": 134,
          "symbol": "install foreground subagent"
        }
      ],
      "from": "open-durable"
    },
    {
      "id": "harness-conversation-165",
      "to": "conversation",
      "label": "create conversation handle",
      "kind": "call",
      "source": [
        {
          "file": "packages/durable/src/harness/harness.ts",
          "line": 314,
          "symbol": "create conversation handle"
        }
      ],
      "from": "harness"
    },
    {
      "id": "harness-scheduler-166",
      "to": "scheduler",
      "label": "own persistent task scheduler",
      "kind": "data",
      "source": [
        {
          "file": "packages/durable/src/harness/harness.ts",
          "line": 181,
          "symbol": "own persistent task scheduler"
        }
      ],
      "from": "harness"
    },
    {
      "id": "scheduler-generation-167",
      "to": "generation",
      "label": "run registered generation tasks",
      "kind": "data",
      "source": [
        {
          "file": "packages/durable/src/harness/registry.ts",
          "line": 10,
          "symbol": "run registered generation tasks"
        }
      ],
      "from": "scheduler"
    },
    {
      "id": "generation-durable-tool-168",
      "to": "durable-tool",
      "label": "schedule tool calls",
      "kind": "transition",
      "source": [
        {
          "file": "packages/durable/src/harness/generation.ts",
          "line": 578,
          "symbol": "GenerationTask tool-round commit → createToolTask"
        }
      ],
      "from": "generation",
      "condition": "Generation returns tool calls"
    },
    {
      "id": "harness-view-169",
      "to": "view",
      "label": "own conversation projections",
      "kind": "data",
      "source": [
        {
          "file": "packages/durable/src/harness/harness.ts",
          "line": 206,
          "symbol": "own conversation projections"
        }
      ],
      "from": "harness"
    },
    {
      "id": "harness-task-graph-170",
      "to": "task-graph",
      "label": "inspect task ownership/waits",
      "kind": "data",
      "source": [
        {
          "file": "packages/durable/src/harness/harness.ts",
          "line": 200,
          "symbol": "inspect task ownership/waits"
        }
      ],
      "from": "harness"
    },
    {
      "id": "harness-sqlite-171",
      "to": "sqlite",
      "label": "transactional storage backend",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/durable/runtime.ts",
          "line": 139,
          "symbol": "transactional storage backend"
        }
      ],
      "from": "harness",
      "condition": "Experimental local durable demo backend"
    },
    {
      "id": "subagent-conversation-172",
      "to": "conversation",
      "label": "create/reuse task-owned child",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/durable/subagent.ts",
          "line": 39,
          "symbol": "create/reuse task-owned child"
        }
      ],
      "from": "subagent",
      "condition": "Tool task starts or replays: reuse existing task-owned child; create only when none exists"
    },
    {
      "id": "subagent-conversation-173",
      "to": "conversation",
      "label": "submit task and wait for answer",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/experimental/durable/subagent.ts",
          "line": 46,
          "symbol": "submit task and wait for answer"
        }
      ],
      "from": "subagent",
      "condition": "Child ready"
    },
    {
      "id": "execute-tool-read-174",
      "to": "read",
      "label": "invoke selected implementation",
      "kind": "call",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 829,
          "symbol": "invoke selected implementation"
        }
      ],
      "from": "execute-tool",
      "condition": "Validated call selects read implementation"
    },
    {
      "id": "execute-tool-bash-175",
      "to": "bash",
      "label": "invoke selected implementation",
      "kind": "call",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 829,
          "symbol": "invoke selected implementation"
        }
      ],
      "from": "execute-tool",
      "condition": "Validated call selects bash implementation"
    },
    {
      "id": "execute-tool-edit-176",
      "to": "edit",
      "label": "invoke selected implementation",
      "kind": "call",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 829,
          "symbol": "invoke selected implementation"
        }
      ],
      "from": "execute-tool",
      "condition": "Validated call selects edit implementation"
    },
    {
      "id": "execute-tool-write-177",
      "to": "write",
      "label": "invoke selected implementation",
      "kind": "call",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 829,
          "symbol": "invoke selected implementation"
        }
      ],
      "from": "execute-tool",
      "condition": "Validated call selects write implementation"
    },
    {
      "id": "execute-tool-search-178",
      "to": "search",
      "label": "invoke selected implementation",
      "kind": "call",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 829,
          "symbol": "invoke selected implementation"
        }
      ],
      "from": "execute-tool",
      "condition": "Validated call selects search implementation"
    },
    {
      "id": "execute-tool-codemode-179",
      "to": "codemode",
      "label": "invoke selected implementation",
      "kind": "call",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 829,
          "symbol": "invoke selected implementation"
        }
      ],
      "from": "execute-tool",
      "condition": "Validated call selects codemode implementation"
    },
    {
      "id": "execute-tool-mcp-conn-180",
      "to": "mcp-conn",
      "label": "invoke MCP-backed tool",
      "kind": "call",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 829,
          "symbol": "invoke MCP-backed tool"
        }
      ],
      "from": "execute-tool",
      "condition": "Selected implementation is registered by MCP"
    },
    {
      "id": "tool-result-loop-181",
      "to": "loop",
      "label": "append finalized results; possibly continue",
      "kind": "transition",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 275,
          "symbol": "append results and continue tool round"
        }
      ],
      "from": "tool-result",
      "condition": "Results are appended even for terminating batch; another tool turn requires nonterminating batch and no finishTurn end override"
    },
    {
      "id": "truncated-loop-182",
      "to": "loop",
      "label": "return error results for model correction",
      "kind": "transition",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 269,
          "symbol": "return error results for model correction"
        }
      ],
      "from": "truncated",
      "condition": "Length-stopped calls produce error results; next correction turn requires no finishTurn end override"
    },
    {
      "id": "steer-loop-183",
      "to": "loop",
      "label": "admit queued message at turn boundary",
      "kind": "transition",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 205,
          "symbol": "admit queued message at turn boundary"
        }
      ],
      "from": "steer",
      "condition": "Steering queue has input"
    },
    {
      "id": "followup-loop-184",
      "to": "loop",
      "label": "resume outer loop with queued input",
      "kind": "transition",
      "source": [
        {
          "file": "packages/agent/src/agent-loop.ts",
          "line": 306,
          "symbol": "resume outer loop with queued input"
        }
      ],
      "from": "followup",
      "condition": "Agent would stop and follow-up queue has input"
    },
    {
      "id": "auto-retry-omit-185",
      "to": "omit",
      "label": "persist retry omission",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 3738,
          "symbol": "persist retry omission"
        }
      ],
      "from": "auto-retry"
    },
    {
      "id": "write-mutation-186",
      "to": "mutation",
      "label": "serialize write mutation",
      "kind": "call",
      "source": [
        {
          "file": "packages/coding-agent/src/core/tools/write.ts",
          "line": 67,
          "symbol": "serialize write mutation"
        }
      ],
      "from": "write"
    },
    {
      "id": "session-read-187",
      "to": "read",
      "label": "create builtin definitions",
      "kind": "data",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 3573,
          "symbol": "create builtin definitions"
        }
      ],
      "from": "session"
    },
    {
      "id": "auto-agent-188",
      "to": "agent",
      "label": "continue interrupted request or queued work",
      "kind": "transition",
      "source": [
        {
          "file": "packages/coding-agent/src/core/agent-session.ts",
          "line": 3160,
          "symbol": "continue interrupted request or queued work"
        }
      ],
      "from": "auto",
      "condition": "Successful post-run compaction requests retry or agent.hasQueuedMessages() is true; pre-request compaction caller refreshes in-place"
    }
  ],
  "traces": [
    {
      "id": "answer",
      "label": "Stable prompt → answer",
      "description": "Illustrative idle local AgentSession path. Assume configured model/auth, no compaction, no hooks consuming input and a text-only response.",
      "steps": [
        {
          "nodeId": "tui",
          "detail": "Editor submits user input to the current stable session."
        },
        {
          "nodeId": "prompt",
          "detail": "Validate idle prompt, input interception and expansion."
        },
        {
          "nodeId": "before-start",
          "detail": "Run before_agent_start hooks before message construction."
        },
        {
          "nodeId": "images",
          "detail": "Prepare supplied images against selected model limits; none assumed here."
        },
        {
          "nodeId": "loadout",
          "detail": "Construct prompt section changes and executable tool loadout."
        },
        {
          "nodeId": "run",
          "detail": "Start the coding-agent activity."
        },
        {
          "nodeId": "agent",
          "detail": "Agent begins low-level prompt lifecycle."
        },
        {
          "nodeId": "event-persist",
          "detail": "Initial finalized system/user messages become session entries."
        },
        {
          "nodeId": "loop",
          "detail": "Enter runLoop after runAgentLoop emitted initial system/user message_end events; enter first assistant turn."
        },
        {
          "nodeId": "projection",
          "detail": "Read the persisted canonical request view."
        },
        {
          "nodeId": "stream",
          "detail": "Transform and convert context before provider call."
        },
        {
          "nodeId": "provider-stream",
          "detail": "Request selected model through ModelRuntime."
        },
        {
          "nodeId": "stream",
          "detail": "Receive streamed text and final successful assistant message."
        },
        {
          "nodeId": "event-persist",
          "detail": "Persist assistant message_end."
        },
        {
          "nodeId": "turn-decision",
          "detail": "Finish turn; assume no continuation request."
        },
        {
          "nodeId": "loop",
          "detail": "No tools, steering or follow-ups: emit agent_end."
        },
        {
          "nodeId": "settle",
          "detail": "No late work; emit agent_settled."
        }
      ]
    },
    {
      "id": "tools",
      "label": "Stable tool round",
      "description": "Assume complete read tool call, validation succeeds, extensions permit execution, and the next model response answers without another tool.",
      "steps": [
        {
          "nodeId": "prompt",
          "detail": "Prepare accepted idle input."
        },
        {
          "nodeId": "run",
          "detail": "Start agent activity."
        },
        {
          "nodeId": "loop",
          "detail": "Enter assistant turn."
        },
        {
          "nodeId": "projection",
          "detail": "Project branch context."
        },
        {
          "nodeId": "stream",
          "detail": "Receive complete assistant read call."
        },
        {
          "nodeId": "event-persist",
          "detail": "Persist assistant call-bearing message."
        },
        {
          "nodeId": "dispatch",
          "detail": "Select tool batch execution policy."
        },
        {
          "nodeId": "prepare-tool",
          "detail": "Validate read parameters."
        },
        {
          "nodeId": "tool-hook",
          "detail": "Assume no tool_call handler blocks."
        },
        {
          "nodeId": "execute-tool",
          "detail": "Invoke read implementation."
        },
        {
          "nodeId": "read",
          "detail": "Read selected file; return bounded content."
        },
        {
          "nodeId": "tool-result",
          "detail": "Normalize result and run result hooks."
        },
        {
          "nodeId": "event-persist",
          "detail": "Persist tool result message_end."
        },
        {
          "nodeId": "turn-decision",
          "detail": "Finish tool turn."
        },
        {
          "nodeId": "refresh",
          "detail": "Refresh prompt/loadout/context for next response."
        },
        {
          "nodeId": "projection",
          "detail": "Canonical projection now includes call and result."
        },
        {
          "nodeId": "stream",
          "detail": "Receive final answer."
        },
        {
          "nodeId": "event-persist",
          "detail": "Persist final assistant."
        },
        {
          "nodeId": "settle",
          "detail": "No follow-up; settle activity."
        }
      ]
    },
    {
      "id": "steering",
      "label": "Busy input → steering → follow-up",
      "description": "Assume a message arrives during provider generation; queues are consumed at their documented boundaries, not inside the ongoing stream.",
      "steps": [
        {
          "nodeId": "prompt",
          "detail": "New user input arrives while streaming."
        },
        {
          "nodeId": "input-hooks",
          "detail": "Hooks pass input through; skill/template expansion follows."
        },
        {
          "nodeId": "busy",
          "detail": "Explicit steer behavior selected."
        },
        {
          "nodeId": "steer",
          "detail": "Message waits in steering queue."
        },
        {
          "nodeId": "stream",
          "detail": "Existing provider response completes."
        },
        {
          "nodeId": "turn-decision",
          "detail": "Existing turn boundary completes."
        },
        {
          "nodeId": "loop",
          "detail": "Poll steering queue for another inner-loop turn."
        },
        {
          "nodeId": "refresh",
          "detail": "Prepare next turn context."
        },
        {
          "nodeId": "event-persist",
          "detail": "Queued user message starts and ends; UI queue updates and persistence follows."
        },
        {
          "nodeId": "projection",
          "detail": "Project next request with admitted steering input."
        },
        {
          "nodeId": "stream",
          "detail": "Respond to the steering message."
        },
        {
          "nodeId": "followup",
          "detail": "A separate follow-up is queued while the steering response is running; this event is concurrent with that response."
        },
        {
          "nodeId": "loop",
          "detail": "Drain follow-up only when inner loop would stop."
        },
        {
          "nodeId": "stream",
          "detail": "Respond to follow-up in another turn."
        },
        {
          "nodeId": "settle",
          "detail": "Both queues empty; settle."
        }
      ]
    },
    {
      "id": "recovery",
      "label": "Overflow → omission → compact → retry",
      "description": "Assume eligible same-model context overflow, recovery not previously attempted, default summary succeeds and continuation answers.",
      "steps": [
        {
          "nodeId": "stream",
          "detail": "Provider returns an assistant error classified as context overflow."
        },
        {
          "nodeId": "event-persist",
          "detail": "Error message is retained in source history."
        },
        {
          "nodeId": "stop",
          "detail": "Low-level failed turn ends."
        },
        {
          "nodeId": "run",
          "detail": "Post-run handler checks recovery."
        },
        {
          "nodeId": "overflow",
          "detail": "Choose first compact-and-retry recovery."
        },
        {
          "nodeId": "omit",
          "detail": "Persist omissions of failed response/result attempt."
        },
        {
          "nodeId": "context-edit",
          "detail": "Original entries remain; projected content changes."
        },
        {
          "nodeId": "auto",
          "detail": "Start overflow compaction."
        },
        {
          "nodeId": "prepare-summary",
          "detail": "Choose summary/kept branch entries."
        },
        {
          "nodeId": "runner",
          "detail": "Assume session_before_compact does not cancel or replace summary."
        },
        {
          "nodeId": "summarize",
          "detail": "Generate default summary using separate model call."
        },
        {
          "nodeId": "compact-entry",
          "detail": "Commit summary boundary only after successful generation."
        },
        {
          "nodeId": "context",
          "detail": "Rebuild projection from summary plus retained entries."
        },
        {
          "nodeId": "agent",
          "detail": "Continue interrupted request; not a new user prompt."
        },
        {
          "nodeId": "projection",
          "detail": "Build reduced canonical request."
        },
        {
          "nodeId": "stream",
          "detail": "Assume successful response."
        },
        {
          "nodeId": "settle",
          "detail": "Settle without further retry."
        }
      ]
    },
    {
      "id": "script",
      "label": "Codemode → nested MCP tool",
      "description": "Assume codemode active, configured MCP server connected, script calls a permitted discovered tool and script completes successfully.",
      "steps": [
        {
          "nodeId": "stream",
          "detail": "Model issues complete codemode script call."
        },
        {
          "nodeId": "event-persist",
          "detail": "Persist outer assistant call."
        },
        {
          "nodeId": "prepare-tool",
          "detail": "Validate script call and run tool_call hooks."
        },
        {
          "nodeId": "codemode",
          "detail": "Load lazy executor."
        },
        {
          "nodeId": "sandbox",
          "detail": "Expose callable tools, discovery globals and branch store."
        },
        {
          "nodeId": "script-store",
          "detail": "Load values from current branch."
        },
        {
          "nodeId": "nested",
          "detail": "Script invokes ctx.executeTool proxy with parent call ID."
        },
        {
          "nodeId": "prepare-tool",
          "detail": "Nested call receives the shared validation pipeline."
        },
        {
          "nodeId": "tool-hook",
          "detail": "Assume extension allows nested call."
        },
        {
          "nodeId": "mcp-conn",
          "detail": "Registered MCP-backed implementation calls configured server."
        },
        {
          "nodeId": "mcp-server",
          "detail": "Assume successful remote response."
        },
        {
          "nodeId": "tool-result",
          "detail": "Nested result passes result interception."
        },
        {
          "nodeId": "sandbox",
          "detail": "Script processes result and emits output. On successful return, nonempty store writes are appended by the installed callback; external tool effects are not rolled back on script failure."
        },
        {
          "nodeId": "event-persist",
          "detail": "Persist outer tool result including nested-call records."
        },
        {
          "nodeId": "refresh",
          "detail": "Prepare next assistant response with outer result."
        },
        {
          "nodeId": "stream",
          "detail": "Model answers from script output."
        },
        {
          "nodeId": "settle",
          "detail": "Settle activity."
        }
      ]
    },
    {
      "id": "durable-subagent",
      "label": "Experimental durable foreground subagent",
      "description": "Separate experimental durable entry. Assume a new session and one subagent call completes; stable AgentSession JSONL operations are not part of this trace.",
      "steps": [
        {
          "nodeId": "open-durable",
          "detail": "Open experimental local demo, registry and Subagent extension."
        },
        {
          "nodeId": "sqlite",
          "detail": "Open locked session.sqlite storage."
        },
        {
          "nodeId": "harness",
          "detail": "Open durable Harness and root conversation."
        },
        {
          "nodeId": "conversation",
          "detail": "Submit user task to root."
        },
        {
          "nodeId": "scheduler",
          "detail": "Schedule durable generation task."
        },
        {
          "nodeId": "generation",
          "detail": "Model produces subagent tool call."
        },
        {
          "nodeId": "durable-tool",
          "detail": "Run persisted tool task under declared replay policy."
        },
        {
          "nodeId": "subagent",
          "detail": "Find/create task-owned child; remove recursive Subagent extension."
        },
        {
          "nodeId": "conversation",
          "detail": "Submit task using tool-task-derived requestId; wait for child answer."
        },
        {
          "nodeId": "generation",
          "detail": "Child model/tool work completes."
        },
        {
          "nodeId": "subagent",
          "detail": "Return child answer text; child remains inspectable."
        },
        {
          "nodeId": "generation",
          "detail": "Parent continuation uses returned tool result."
        },
        {
          "nodeId": "view",
          "detail": "Publish committed conversation state for TUI."
        },
        {
          "nodeId": "task-graph",
          "detail": "Task panel can inspect ownership/wait relationships."
        }
      ]
    }
  ]
};
