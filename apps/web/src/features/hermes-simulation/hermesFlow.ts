/** Source-grounded symbolic paths through Hermes; these are not recorded executions. */
export type FlowSource = { file: string; line: number; symbol: string };

export type FlowNode = {
  id: string;
  label: string;
  phase: string;
  detail: string;
  input: string;
  output: string;
  source: readonly FlowSource[];
  kind?: 'decision' | 'boundary';
};

export type FlowScenario = {
  id: string;
  label: string;
  description: string;
  steps: readonly string[];
};

export const sourceCommit = 'ddc0e65958b326a89f6c440c76c812d31ac27e2a';

const source = (file: string, line: number, symbol: string): FlowSource => ({ file, line, symbol });

export const flowNodes: readonly FlowNode[] = [
  {
    id: 'input', label: 'Receive CLI input', phase: 'Input',
    detail: 'The CLI chat entry checks credentials and resolves the route for this incoming message. Route changes retire the previous agent.',
    input: 'User message and optional images or voice input', output: 'Selected model/runtime route',
    source: [source('hermes_cli/cli_chat_turn_mixin.py', 49, 'CLIChatTurnMixin.chat')],
  },
  {
    id: 'runtime', label: 'Initialize or reuse agent', phase: 'Runtime',
    detail: 'First use joins preloaded skills, discovers MCP tools and constructs AIAgent through the initialization phases below. An existing agent is reused when its route remains suitable; the reused-agent path skips the initialization substeps.',
    input: 'Route, configured toolsets, callbacks and session identity', output: 'Agent with runtime, tools and session integration',
    source: [source('hermes_cli/cli_agent_setup_mixin.py', 625, '_init_agent'), source('agent/agent_init.py', 2388, 'init_agent')],
  },
  {
    id: 'runtime-client', label: 'Resolve client and load tools', phase: 'Runtime',
    detail: 'Builds the selected provider client, initializes fallback routes, then loads enabled tools. Capability definitions are actual runtime configuration, before prompt construction.',
    input: 'Resolved route, credentials and enabled/disabled toolsets', output: 'Provider client, fallback chain and tool registry',
    source: [source('agent/agent_init.py', 2490, 'init_agent')],
  },
  {
    id: 'runtime-session', label: 'Initialize session state', phase: 'Runtime',
    detail: 'Creates or adopts session identity and session-store handle, checkpoint and todo state before loading memory configuration.',
    input: 'Session identifier, optional store and parent relationship', output: 'Session and local state managers',
    source: [source('agent/agent_init.py', 2493, 'init_agent'), source('agent/agent_init.py', 1209, '_init_session_state')],
  },
  {
    id: 'runtime-memory', label: 'Initialize memory providers', phase: 'Runtime',
    detail: 'Loads eligible built-in MEMORY/USER storage and initializes the configured external provider when enabled. This supplies prompt-memory sources; synchronous per-turn recall occurs later.',
    input: 'Memory configuration, skip flags and platform', output: 'Eligible built-in store and optional memory manager',
    source: [source('agent/agent_init.py', 2506, 'init_agent'), source('agent/agent_init.py', 1323, '_init_memory')],
  },
  {
    id: 'runtime-engine', label: 'Resolve window and context engine', phase: 'Runtime',
    detail: 'Resolves context length and compression policy, builds the configured engine, applies local-runtime constraints and gated engine tool injection, then invokes engine session-start lifecycle.',
    input: 'Effective model, route and context/compression configuration', output: 'Context engine, window and usage state',
    source: [source('agent/agent_init.py', 2509, 'init_agent'), source('agent/agent_init.py', 2129, '_inject_context_engine_tools')],
  },
  {
    id: 'stage-input', label: 'Prepare and stage user row', phase: 'Input',
    detail: 'CLI routes images, expands context references, cleans surrogates and stages the user dictionary. Its worker passes prior history without that staged row, while one-shot notes may produce a separate model-facing input.',
    input: 'Incoming message and current CLI transcript', output: 'Staged user row plus clean persistence override when needed',
    source: [source('hermes_cli/cli_chat_turn_mixin.py', 83, 'chat'), source('hermes_cli/cli_chat_turn_mixin.py', 222, '_chat_stage_user_message'), source('hermes_cli/cli_chat_turn_mixin.py', 311, '_chat_run_agent')],
  },
  {
    id: 'lease', label: 'Admit session turn', phase: 'Session', kind: 'boundary',
    detail: 'The facade acquires the durable turn lease, adopts refreshed history and binds relay, accounting and interrupt scopes. Admission can return early; this path assumes admission succeeds.',
    input: 'Session identity, user input and supplied history', output: 'Admitted turn with authoritative refreshed history',
    source: [source('agent/turn_facade.py', 22, 'TurnFacadeMixin.run_conversation'), source('agent/turn_facade.py', 82, 'admit_durable_turn_lease')],
  },
  {
    id: 'turn', label: 'Build working turn', phase: 'Turn',
    detail: 'Copies the history list, stages the current user dictionary, hydrates prior state and appends the user. The list copy initially shares historical dictionaries; the request copy is created later.',
    input: 'Admitted history and staged user input', output: 'Working messages and current-user boundary',
    source: [source('agent/turn_context.py', 1016, 'build_turn_context'), source('agent/turn_context.py', 1092, 'build_turn_context')],
  },
  {
    id: 'prompt', label: 'Restore or build prompt', phase: 'Turn',
    detail: 'Reuses the cached prompt, or restores/builds it when absent, then ensures the session row. Prompt construction includes instruction/skill sources and available built-in memory/profile or external provider prompt sections. Prompt and pinned tools participate in session caching; compaction can establish a rebuild boundary.',
    input: 'Cached or stored prompt, instructions and runtime', output: 'Active system prompt and session row',
    source: [source('agent/turn_context.py', 1122, 'build_turn_context'), source('agent/conversation_loop.py', 745, '_restore_or_build_system_prompt')],
  },
  {
    id: 'turn-pressure', label: 'Check turn-start pressure', phase: 'Turn', kind: 'decision',
    detail: 'Optional idle maintenance and threshold preflight can compact before augmentation. The returned history and current-user boundary replace the turn inputs when a rewrite succeeds.',
    input: 'Working history and active prompt', output: 'History admitted for this turn, or a blocked/timeout outcome',
    source: [source('agent/turn_context.py', 1148, 'build_turn_context'), source('agent/turn_context_compaction.py', 129, 'run_turn_start_compaction')],
  },
  {
    id: 'augment', label: 'Collect hooks and host notes', phase: 'Turn',
    detail: 'Runs pre_llm_call hooks once per turn and consumes one-shot gateway/surface notes. Oversized hook text can spill to disk before admission into the user context.',
    input: 'Current input, hook outputs and host notes', output: 'Collected per-turn context text or multimodal host notes',
    source: [source('agent/turn_context.py', 1159, 'build_turn_context'), source('agent/turn_context.py', 781, '_collect_pre_llm_call_context')],
  },
  {
    id: 'recall', label: 'Await per-turn memory recall', phase: 'Turn',
    detail: 'Notifies the memory manager of this turn, then synchronously awaits prefetch for a nontrivial query. Missing manager or trivial input can yield no recalled context.',
    input: 'Original user query and optional memory manager', output: 'External recall text, possibly empty',
    source: [source('agent/turn_context.py', 889, '_memory_turn_start_and_prefetch'), source('agent/turn_context.py', 1169, 'build_turn_context')],
  },
  {
    id: 'inject', label: 'Preserve augmented user input', phase: 'Turn',
    detail: 'String augmentation is stamped in api_content for exact request replay; multimodal input receives durable text parts. Inline MoA and app-server string inputs follow their dedicated handling.',
    input: 'User content, hook/host context and recall', output: 'Augmented user representation and replay sidecar',
    source: [source('agent/turn_context.py', 1177, 'build_turn_context'), source('agent/turn_context.py', 920, '_stamp_api_content_sidecar'), source('agent/turn_context.py', 967, '_append_multimodal_context')],
  },
  {
    id: 'persist-start', label: 'Persist turn start', phase: 'Session', kind: 'boundary',
    detail: 'Attempts turn-start persistence after prompt setup and augmentation, before model execution; missing/disabled store provides no durable write.',
    input: 'Working messages and persistence metadata', output: 'Turn-start persistence attempt',
    source: [source('agent/turn_context.py', 999, '_persist_turn_start'), source('agent/turn_context.py', 1189, 'build_turn_context')],
  },
  {
    id: 'runtime-gate', label: 'Choose turn runtime', phase: 'Runtime', kind: 'decision',
    detail: 'codex_app_server hands the turn to its dedicated runtime. Other modes enter the generic loop. Dedicated runtime failure can activate a configured generic fallback.',
    input: 'Agent api_mode and prepared turn', output: 'Generic loop or dedicated app-server turn',
    source: [source('agent/conversation_loop.py', 1622, '_run_conversation_turn')],
  },
  {
    id: 'iteration', label: 'Prepare iteration', phase: 'Model loop',
    detail: 'Checks interrupt and iteration budget, drains steer, adds budget notices and repairs live message sequence/tool arguments. Repairs may modify working history before a request copy exists.',
    input: 'Working transcript, pending steer and loop state', output: 'Prepared history or turn-stop verdict',
    source: [source('agent/conversation_loop.py', 1636, '_run_conversation_turn'), source('agent/turn_iteration_prep.py', 149, 'prepare_iteration'), source('agent/turn_iteration_prep.py', 363, 'begin_iteration')],
  },
  {
    id: 'request', label: 'Assemble request copy', phase: 'Model loop',
    detail: 'Canonicalizes the replay prefix, structurally clones messages, replays sidecars and reasoning, adds effective system text and prefill. This assembly is distinct from rebuilding provider kwargs on a transport retry.',
    input: 'Prepared history, prompt, schemas and selection policy', output: 'Request-local messages and schemas before selection and cleanup',
    source: [source('agent/turn_context.py', 1220, 'build_api_messages'), source('agent/turn_request_assembly.py', 106, 'assemble_api_request'), source('agent/conversation_loop.py', 1281, '_apply_context_engine_selection')],
  },
  {
    id: 'selection', label: 'Apply context-engine selection', phase: 'Model loop',
    detail: 'An overriding engine can select or replace this request using cloned reference history and incoming input. The actual request list is supplied to the hook; invalid replacement handling does not undo arbitrary in-place edits to that request list.',
    input: 'Request messages, cloned history/input and engine budget', output: 'Selected request-local messages',
    source: [source('agent/turn_request_assembly.py', 145, 'assemble_api_request'), source('agent/conversation_loop.py', 1281, '_apply_context_engine_selection')],
  },
  {
    id: 'request-clean', label: 'Clean request and plan cache', phase: 'Model loop',
    detail: 'Suppresses rejected thinking, sanitizes messages, evicts stale outbound tool images, drops thinking-only rows/merges users and normalizes text/tool JSON. Cache markers follow cleanup; route-aware and usage-anchored pressure are estimated afterward.',
    input: 'Selected request-local messages and schemas', output: 'Sanitized cache layout and request pressure',
    source: [source('agent/turn_request_assembly.py', 153, 'assemble_api_request'), source('agent/turn_request_assembly.py', 205, 'assemble_api_request'), source('agent/turn_request_assembly.py', 266, 'assemble_api_request')],
  },
  {
    id: 'request-gate', label: 'Admit model request', phase: 'Model loop', kind: 'decision',
    detail: 'The preflight gate can send, stop or trigger compaction and restart the outer iteration. A refusal does not imply a provider request was sent.',
    input: 'Assembled request and context pressure', output: 'Send permission, rewrite/rebuild or typed stop',
    source: [source('agent/turn_preflight_gate.py', 20, 'run_preflight_gate'), source('agent/conversation_loop.py', 1641, '_run_conversation_turn')],
  },
  {
    id: 'provider', label: 'Build provider payload and call', phase: 'Provider', kind: 'boundary',
    detail: 'Each attempt applies route-specific reasoning/cache policy, converts messages and tools to the selected protocol, runs request middleware/hooks and performs the call. Protocols include Chat Completions, Anthropic Messages, Bedrock Converse and Responses.',
    input: 'Admitted request-local messages and active provider', output: 'Provider response or classified call failure',
    source: [source('agent/turn_api_request.py', 93, 'build_api_request'), source('agent/chat_completion_helpers.py', 1555, '_build_api_kwargs_for_mode'), source('agent/turn_api_call.py', 68, 'perform_api_call')],
  },
  {
    id: 'retry', label: 'Retry transport attempt', phase: 'Provider', kind: 'decision',
    detail: 'Retryable failure can back off and rebuild provider kwargs from the existing assembled request. Fallback, redirect or context rewrite can instead request a new outer iteration; retry exhaustion can terminate after recovery options.',
    input: 'Classified provider error and retry state', output: 'Another attempt, outer-loop restart or terminal error',
    source: [source('agent/conversation_loop.py', 1501, '_run_api_retry_loop'), source('agent/turn_api_error.py', 356, 'handle_api_error')],
  },
  {
    id: 'response', label: 'Normalize model response', phase: 'Model loop', kind: 'decision',
    detail: 'Checks and normalizes the provider response, observes usage and appends provider-agent projection when present. Tool calls and accepted text take different branches; empty/truncated responses can require recovery or continuation.',
    input: 'Provider response and usage', output: 'Normalized assistant message and next branch',
    source: [source('agent/conversation_loop.py', 1665, '_run_conversation_turn'), source('agent/turn_response_intake.py', 120, 'normalize_model_response')],
  },
  {
    id: 'persist-calls', label: 'Persist tool-call row', phase: 'Tools', kind: 'boundary',
    detail: 'Validates calls, appends the assistant call row and flushes it before tool side effects. A flush returning false halts before tools run; without a bound SessionDB the flush returns None and is admitted as a no-op. Persisted calls alone do not establish exactly-once external effects.',
    input: 'Normalized tool calls and working history', output: 'Call flush success/no-store outcome, or persistence failure',
    source: [source('agent/turn_tool_round.py', 107, 'run_tool_round'), source('agent/turn_tool_round.py', 130, 'run_tool_round')],
  },
  {
    id: 'tools', label: 'Execute admitted tools', phase: 'Tools', kind: 'boundary',
    detail: 'The segment planner runs eligible parallel-safe calls in concurrent segments separated by sequential barriers, with approval/guardrail handling. Execution may produce an ordinary result, a blocked/error result or a delegated-child result.',
    input: 'Admitted tool calls and task environment', output: 'Tool execution outcomes',
    source: [source('agent/turn_tool_round.py', 163, 'run_tool_round'), source('run_agent.py', 1330, '_execute_tool_calls'), source('agent/tool_executor.py', 1898, 'execute_tool_calls_segmented')],
  },
  {
    id: 'persist-results', label: 'Shape and persist tool results', phase: 'Tools', kind: 'boundary',
    detail: 'Spills oversized output, attaches discovered subdirectory hints and adapts image content. Appends and flushes each result before an unblocked completion callback. Failed persistence prevents another model request using the process-only result.',
    input: 'Raw tool outcome and output budget', output: 'Bounded result with successful/no-store flush, or persistence failure',
    source: [source('agent/tool_executor.py', 1107, '_commit_tool_result'), source('agent/tool_executor.py', 1146, '_commit_tool_result'), source('agent/turn_tool_round.py', 168, 'run_tool_round')],
  },
  {
    id: 'tool-pressure', label: 'Check after tool results', phase: 'Model loop', kind: 'decision',
    detail: 'Reconsiders pressure after appended results. A successful rewrite installs returned history and reanchors the current user before the next iteration; otherwise the loop continues or stops.',
    input: 'Transcript with durable tool feedback', output: 'Next iteration, context rewrite or stop',
    source: [source('agent/turn_tool_round.py', 202, 'compress_after_tool_results')],
  },
  {
    id: 'text', label: 'Settle final text', phase: 'Completion',
    detail: 'Stop gates may require continuation. Once accepted, output transformation occurs before appending/flushing the final assistant row. If that flush fails, finalization attempts persistence again.',
    input: 'Normalized assistant text and stop-gate state', output: 'Accepted assistant row or continuation',
    source: [source('agent/turn_final_response.py', 55, 'finish_text_response'), source('agent/turn_final_response.py', 323, 'finish_text_response'), source('agent/turn_final_response.py', 350, 'finish_text_response')],
  },
  {
    id: 'finalize', label: 'Finalize transcript and turn', phase: 'Completion',
    detail: 'Resolves budget/abnormal exits, closes transcript tails, optionally micro-compacts successful turns and persists the session. Updates the history snapshot and observes context-engine completion. Early terminal-result paths can bypass this generic finalizer.',
    input: 'Working history and completion/interruption/failure state', output: 'Structured turn result and finalized history',
    source: [source('agent/turn_finalizer.py', 509, 'finalize_turn'), source('agent/turn_finalizer.py', 604, '_persist_step'), source('agent/turn_finalizer.py', 652, '_notify_context_engine_turn_complete')],
  },
  {
    id: 'postturn', label: 'Schedule memory sync and review', phase: 'Completion',
    detail: 'Finalization asks external memory to sync the completed turn and queue future prefetch. Eligible memory/skill review is scheduled on a separate cloned snapshot. Normally queued work may still be pending at completion; memory executor creation/submission failure can fall back inline; provider session-end cleanup belongs to the host.',
    input: 'Final response, user input and review policy', output: 'Best-effort background memory/review work',
    source: [source('agent/turn_finalizer.py', 746, 'finalize_turn'), source('agent/turn_finalizer.py', 755, 'finalize_turn')],
  },
  {
    id: 'release', label: 'Release turn scopes and lease', phase: 'Session', kind: 'boundary',
    detail: 'After entering the admission try, the facade records the outcome and runs guarded cleanup in finally, including early results. Setup before that try is outside its cleanup scope.',
    input: 'Returned result or exception', output: 'Turn ownership released',
    source: [source('agent/turn_facade.py', 162, 'TurnFacadeMixin.run_conversation'), source('agent/turn_facade.py', 188, 'TurnFacadeMixin.run_conversation')],
  },
  {
    id: 'delivery', label: 'Settle and render in CLI', phase: 'Delivery',
    detail: 'CLI settles streams/audio, adopts returned messages and live session identity, then renders answer or failure/interruption status. Text can already have streamed during the provider call.',
    input: 'Agent result, streamed content and interruption state', output: 'User-visible completion and history for the next turn',
    source: [source('hermes_cli/cli_chat_turn_mixin.py', 477, '_chat_settle_turn'), source('hermes_cli/cli_chat_turn_mixin.py', 514, '_chat_render_turn')],
  },
  {
    id: 'compact', label: 'Prepare guarded compaction', phase: 'Compaction', kind: 'decision',
    detail: 'Host compression checks feasibility/breakers and acquires a durable compression lease over the relevant generation. Cooldown, insufficient eligible history or contention can preserve history and defer the attempt.',
    input: 'History snapshot, pressure trigger and compression policy', output: 'Admitted summary work or unchanged/blocked outcome',
    source: [source('agent/conversation_compression.py', 4072, 'compress_context'), source('agent/conversation_compression.py', 4150, '_acquire_compression_lease')],
  },
  {
    id: 'compact-summary', label: 'Prepare memory checkpoint and summary', phase: 'Compaction',
    detail: 'Gathering memory obeys checkpoint policy. The built-in engine prunes candidate-only result bodies/media, selects protected head and recent tail, and summarizes the middle. Classified failures may abort or use eligible fallback; this node does not imply a successful summary.',
    input: 'Admitted history snapshot and memory/checkpoint policy', output: 'Candidate summary/history or original history on abort',
    source: [source('agent/conversation_compression.py', 3897, '_run_summary_phase'), source('agent/context_compressor.py', 5563, 'ContextCompressor.compress')],
  },
  {
    id: 'compact-admission', label: 'Admit candidate to commit fence', phase: 'Compaction', kind: 'decision',
    detail: 'Rejects stale, cancelled, no-op or ineffective candidates before commit. A successful candidate must pass the cooperative commit fence and retain required user/reply anchors.',
    input: 'Candidate history and held generation', output: 'Commit permission or preserved original history',
    source: [source('agent/conversation_compression.py', 4216, '_candidate_rejected')],
  },
  {
    id: 'compact-commit', label: 'Commit active history rewrite', phase: 'Compaction', kind: 'boundary',
    detail: 'After admission, preserves required anchors, refreshes prompt/tools and commits active/archive state. Default in-place storage retains session identity; legacy rotation creates a child. Clears usage anchors so later real provider usage can establish a new anchor.',
    input: 'Admitted candidate and current session generation', output: 'Committed active history for a newly assembled request',
    source: [source('agent/conversation_compression.py', 3713, '_commit_compaction'), source('agent/conversation_compression.py', 3463, '_finish_compaction_boundary')],
  },
  {
    id: 'overflow', label: 'Recover provider overflow', phase: 'Recovery', kind: 'decision',
    detail: 'Classifies context-limit/output-reservation/payload-size rejection. Recovery may adopt a confirmed limit, reduce output cap, compact or strip request images; blocked or exhausted recovery can return a partial failure.',
    input: 'Provider rejection and measured/runtime limits', output: 'Context recovery/rebuild or terminal failure',
    source: [source('agent/turn_overflow.py', 461, 'recover_from_overflow')],
  },
  {
    id: 'delegate', label: 'Build delegated child agent', phase: 'Delegation', kind: 'boundary',
    detail: 'delegate_task builds a fresh child session with a focused ephemeral prompt and inherited allowed runtime configuration. It requests skip_context_files and skip_memory, and blocks the memory tool; it does not inherit the parent transcript. Top-level model dispatch requests background execution; nested orchestrators join. Missing later-result consumers (including one-shot CLI) or async capacity cause inline joining.',
    input: 'Delegated task and allowed parent-derived configuration', output: 'Child agent and child task',
    source: [source('tools/delegate_tool.py', 190, '_build_child_agent'), source('tools/delegate_tool.py', 474, 'delegate_task'), source('run_agent.py', 1366, '_dispatch_delegate_task'), source('tools/delegate_tool_dispatch.py', 417, '_dispatch_background')],
  },
  {
    id: 'child', label: 'Run child and collect result', phase: 'Delegation',
    detail: 'Registers the child, seeds its workspace, awaits its lifecycle and builds a structured result with completion/failure status. The parent receives this through the ordinary tool-result persistence boundary.',
    input: 'Prepared child and delegated goal', output: 'Structured child result for parent tool feedback',
    source: [source('tools/delegate_tool.py', 333, '_run_single_child')],
  },
  {
    id: 'interrupt', label: 'Stop on interrupt', phase: 'Recovery',
    detail: 'Iteration entry stops on an interrupt. During a provider call, the handler preserves eligible streamed partial text and persists history. A pending redirect is a different branch that clears cancellation and rebuilds the outer iteration.',
    input: 'Interrupt signal and any partial response', output: 'Interrupted turn state for finalization',
    source: [source('agent/turn_iteration_prep.py', 363, 'begin_iteration'), source('agent/turn_api_call.py', 171, 'handle_api_interrupt')],
  },
  {
    id: 'persistence-failure', label: 'Halt on tool persistence failure', phase: 'Recovery',
    detail: 'Failed call-row flush prevents tool execution. Failed result flush prevents sending that result to the model. The generic loop breaks with session_persistence_failed and finalizes a failed turn.',
    input: 'Failed tool-call or tool-result persistence', output: 'Failed turn; no next tool/model step from unsafe process-only state',
    source: [source('agent/turn_tool_round.py', 142, 'run_tool_round'), source('agent/turn_tool_round.py', 168, 'run_tool_round')],
  },
  {
    id: 'terminal-error', label: 'Return terminal provider failure', phase: 'Recovery',
    detail: 'A nonretryable error with no applicable fallback, or exhausted attempts with no remaining recovery, settles partial output and returns a structured failure. This direct result exits before generic finalize_turn; facade cleanup and host delivery still run.',
    input: 'Terminal classified failure and partial transcript', output: 'Early structured failure result',
    source: [source('agent/turn_api_error.py', 347, 'handle_api_error'), source('agent/turn_api_error.py', 390, 'handle_api_error'), source('agent/conversation_loop.py', 1654, '_run_conversation_turn')],
  },
  {
    id: 'native', label: 'Run app-server turn', phase: 'Native runtime', kind: 'boundary',
    detail: 'The dedicated codex_app_server runtime owns its model/tool loop. Hermes receives event projections and usage through its integration; the generic request/tool sequence is bypassed unless a fallback activates.',
    input: 'Prepared Hermes turn and app-server session', output: 'Native runtime result and projected messages',
    source: [source('agent/conversation_loop.py', 1622, '_run_conversation_turn'), source('agent/codex_runtime.py', 718, 'run_codex_app_server_turn')],
  },
  {
    id: 'native-persist', label: 'Persist native projection', phase: 'Native runtime', kind: 'boundary',
    detail: 'Projects app-server messages into Hermes history and flushes them through Hermes session persistence. Flush failure is logged but does not prevent dedicated finish or retract streamed output; thread binding publication requires successful persistence.',
    input: 'App-server events and completed turn', output: 'Hermes-native result; projected transcript may be undurable after flush failure',
    source: [source('agent/codex_runtime.py', 659, '_persist_projected_messages'), source('agent/codex_runtime.py', 693, '_finish_codex_turn')],
  },
];

const start = ['input', 'runtime', 'runtime-client', 'runtime-session', 'runtime-memory', 'runtime-engine', 'stage-input', 'lease', 'turn', 'prompt', 'turn-pressure', 'augment', 'recall', 'inject', 'persist-start', 'runtime-gate'] as const;
const reusedStart = ['input', 'runtime', 'stage-input', 'lease', 'turn', 'prompt', 'turn-pressure', 'augment', 'recall', 'inject', 'persist-start', 'runtime-gate'] as const;
const requestAssembly = ['iteration', 'request', 'selection', 'request-clean', 'request-gate'] as const;
const call = [...requestAssembly, 'provider', 'response'] as const;
const compaction = ['compact', 'compact-summary', 'compact-admission', 'compact-commit'] as const;
const finish = ['text', 'finalize', 'postturn', 'release', 'delivery'] as const;

export const flowScenarios: readonly FlowScenario[] = [
  { id: 'answer', label: 'Normal answer · cold start', description: 'Symbolic first CLI turn including initialization, followed by accepted text; no tool round or context rewrite. Other detailed examples also show first initialization.', steps: [...start, ...call, ...finish] },
  { id: 'reused-answer', label: 'Normal answer · reused agent', description: 'Symbolic later CLI turn reusing an unchanged route and existing agent. Tools, memory and context engine initialization are skipped; the cached prompt is reused.', steps: [...reusedStart, ...call, ...finish] },
  { id: 'tools', label: 'Tool round', description: 'Symbolic successful persistence around one tool round, followed by another assembled request and accepted answer.', steps: [...start, ...call, 'persist-calls', 'tools', 'persist-results', 'tool-pressure', ...call, ...finish] },
  { id: 'compaction', label: 'Request pressure compaction', description: 'Symbolic successful batch rewrite at the request gate; the outer loop assembles a fresh request afterward.', steps: [...start, ...requestAssembly, ...compaction, ...call, ...finish] },
  { id: 'overflow', label: 'Provider overflow recovery', description: 'Symbolic input-overflow rejection with successful guarded compaction and request rebuild; other overflow outcomes are described at the recovery node.', steps: [...start, ...requestAssembly, 'provider', 'overflow', ...compaction, ...call, ...finish] },
  { id: 'delegation', label: 'Delegated task · joined fallback', description: 'Assumes a one-shot CLI with no later-result consumer, so requested background dispatch joins children and returns results in this tool call. Ordinary eligible top-level sessions instead receive a dispatch handle and later completion.', steps: [...start, ...call, 'persist-calls', 'tools', 'delegate', 'child', 'persist-results', 'tool-pressure', ...call, ...finish] },
  { id: 'interrupted', label: 'Interrupted provider call', description: 'Symbolic interruption during a call, followed by interrupted finalization and host delivery; this path has no redirect.', steps: [...start, ...requestAssembly, 'provider', 'interrupt', 'finalize', 'release', 'delivery'] },
  { id: 'persistence-failure', label: 'Tool result persistence failure', description: 'Symbolic tool execution whose result cannot be made durable. The agent halts before another model request.', steps: [...start, ...call, 'persist-calls', 'tools', 'persist-results', 'persistence-failure', 'finalize', 'release', 'delivery'] },
  { id: 'call-persistence-failure', label: 'Tool call persistence failure', description: 'Symbolic assistant call-row flush failure; tool execution never begins.', steps: [...start, ...call, 'persist-calls', 'persistence-failure', 'finalize', 'release', 'delivery'] },
  { id: 'retry', label: 'Transport retry', description: 'Symbolic retryable call failure and successful second attempt. Provider kwargs rebuild, while the assembled request is reused.', steps: [...start, ...requestAssembly, 'provider', 'retry', 'provider', 'response', ...finish] },
  { id: 'terminal-error', label: 'Terminal provider error', description: 'Symbolic classified provider failure with no remaining recovery; direct result bypasses the generic finalizer.', steps: [...start, ...requestAssembly, 'provider', 'terminal-error', 'release', 'delivery'] },
  { id: 'app-server', label: 'App-server runtime', description: 'Symbolic successful dedicated runtime turn; Hermes generic model/tool loop is bypassed.', steps: [...start, 'native', 'native-persist', 'release', 'delivery'] },
];
