import { flowNodes, type FlowSource } from './hermesFlow';
import { expansionGroups, expansionNodes, expansionEdges } from './hermesExpansion';

/** A source-grounded coverage skeleton, awaiting detailed review with the reader. */
export type ArchitectureNodeKind = 'component' | 'state' | 'decision' | 'store' | 'external';
export type ArchitectureEdgeKind = 'call' | 'data' | 'transition' | 'background';
export type ArchitectureGroup = {
  id: string; label: string; x: number; y: number; width: number; height: number;
};
export type ArchitectureNode = {
  id: string; label: string; kind: ArchitectureNodeKind; groupId: string;
  x: number; y: number; summary: string; source: readonly FlowSource[];
  flowIds: readonly string[]; reviewStatus: 'surface';
};
export type ArchitectureEdge = {
  id: string; from: string; to: string; kind: ArchitectureEdgeKind; label: string;
  source?: readonly FlowSource[]; condition?: string;
};

export const architectureNodeSize = { width: 250, height: 88 } as const;
const originalGroups: readonly ArchitectureGroup[] = [
  { id: 'host', label: 'Host · CLI surface', x: 40, y: 40, width: 900, height: 600 },
  { id: 'initialization', label: 'AIAgent · initialization', x: 1000, y: 40, width: 900, height: 600 },
  { id: 'state', label: 'Session ownership · durable state', x: 1960, y: 40, width: 900, height: 600 },
  { id: 'turn', label: 'Turn construction · prompt and memory', x: 40, y: 720, width: 900, height: 660 },
  { id: 'loop', label: 'conversation_loop · generic runtime', x: 1000, y: 720, width: 900, height: 660 },
  { id: 'provider', label: 'Provider boundary · calls and recovery', x: 1960, y: 720, width: 900, height: 660 },
  { id: 'compression', label: 'Context engine · history rewrite', x: 40, y: 1460, width: 900, height: 700 },
  { id: 'tools', label: 'Tool execution · delegated agents', x: 1000, y: 1460, width: 900, height: 700 },
  { id: 'completion', label: 'Completion · alternative runtime', x: 1960, y: 1460, width: 900, height: 700 },
];


// New responsibility regions continue the existing three-column layout. Each row
// reserves its tallest group so expanded regions never overlap their neighbors.
const addedGroups: ArchitectureGroup[] = [];
let nextRowY = 2240;
for (let index = 0; index < expansionGroups.length; index += 3) {
  const row = expansionGroups.slice(index, index + 3);
  const heights = row.map(group => Math.max(600, 110 + Math.ceil(expansionNodes.filter(n => n.groupId === group.id).length / 2) * 145));
  row.forEach((group, column) => addedGroups.push({ ...group, x: 40 + column * 960, y: nextRowY, width: 900, height: heights[column] }));
  nextRowY += Math.max(...heights) + 80;
}
export const architectureGroups: readonly ArchitectureGroup[] = [...originalGroups, ...addedGroups];
export const architectureCanvas = { width: 2920, height: nextRowY } as const;

const flowById = new Map(flowNodes.map(node => [node.id, node]));
const groupById = new Map(architectureGroups.map(group => [group.id, group]));
const anchor = (file: string, line: number, symbol: string): FlowSource => ({ file, line, symbol });

// Slots are explicit layout positions, not execution order. Components remain stable across paths.
function node(
  id: string, label: string, kind: ArchitectureNodeKind, groupId: string, slot: number,
  summary: string, flowIds: readonly string[], extraSource: readonly FlowSource[] = [],
): ArchitectureNode {
  const group = groupById.get(groupId);
  if (!group) throw new Error(`Unknown Hermes architecture group: ${groupId}`);
  const source = [...extraSource, ...flowIds.flatMap(flowId => {
    const flow = flowById.get(flowId);
    if (!flow) throw new Error(`Unknown Hermes flow node: ${flowId}`);
    return flow.source;
  })];
  return {
    id, label, kind, groupId,
    x: group.x + 70 + (slot % 2) * 470,
    y: group.y + 90 + Math.floor(slot / 2) * 145,
    summary, source, flowIds, reviewStatus: 'surface',
  };
}

const originalNodes: readonly ArchitectureNode[] = [
  node('cli-chat', 'CLIChatTurnMixin.chat', 'component', 'host', 0,
    'Receives a CLI message, checks credentials and resolves the route.', ['input']),
  node('stage-input', '_chat_stage_user_message', 'state', 'host', 1,
    'Stages the user row and prepares message references, media and host notes.', ['stage-input']),
  node('cli-delivery', '_chat_settle_turn / _chat_render_turn', 'component', 'host', 2,
    'Adopts returned history and presents completion, interruption or failure.', ['delivery']),
  node('init-agent', '_init_agent / AIAgent initialization', 'component', 'initialization', 0,
    'CLI creates or reuses AIAgent; gateway and cron construct it through their own hosts. Shared initialization sets up client, tools, session, memory and context engine.', ['runtime']),
  node('client-tools', 'Client + tool initialization', 'component', 'initialization', 1,
    'Resolves the configured client, fallback routes and enabled tool capabilities.', ['runtime-client']),
  node('session-init', '_init_session_state', 'component', 'initialization', 2,
    'Binds session identity, optional persistence and local state managers.', ['runtime-session']),
  node('memory-init', '_init_memory', 'component', 'initialization', 3,
    'Initializes eligible built-in memory and configured external memory providers.', ['runtime-memory']),
  node('engine-init', 'Context engine initialization', 'component', 'initialization', 4,
    'Resolves model window, compression policy, engine tools and session-start lifecycle.', ['runtime-engine']),
  node('turn-facade', 'TurnFacadeMixin.run_conversation', 'component', 'state', 0,
    'Admits the durable turn and binds ownership, accounting and interrupt scopes.', ['lease']),
  node('session-db', 'SessionDB', 'store', 'state', 1,
    'Optional SQLite store for session metadata, transcript and durable coordination.', [],
    [anchor('hermes_state.py', 454, 'SessionDB')]),
  node('persist-start', '_persist_turn_start', 'state', 'state', 2,
    'Attempts to persist the prepared turn before runtime execution.', ['persist-start']),
  node('release', 'TurnFacadeMixin · finally', 'state', 'state', 3,
    'Runs guarded facade cleanup after entering the admission try, including early results; pre-try setup exceptions are outside this finally.', ['release']),
  node('build-turn', 'build_turn_context', 'component', 'turn', 0,
    'Hydrates working history and appends the current user boundary.', ['turn']),
  node('prompt', '_restore_or_build_system_prompt', 'component', 'turn', 1,
    'Restores or constructs the session prompt from instructions, skills and memory.', ['prompt']),
  node('turn-pressure', 'run_turn_start_compaction', 'decision', 'turn', 2,
    'Applies optional idle maintenance and turn-start history pressure checks.', ['turn-pressure']),
  node('hooks', '_collect_pre_llm_call_context', 'component', 'turn', 3,
    'Collects per-turn hooks and one-shot host notes before request assembly.', ['augment']),
  node('recall', '_memory_turn_start_and_prefetch', 'state', 'turn', 4,
    'Awaits eligible external memory recall for this user query.', ['recall']),
  node('memory-manager', 'MemoryManager', 'component', 'turn', 5,
    'Fans recall, completed-turn sync and lifecycle hooks out to configured providers.', [],
    [anchor('agent/memory_manager.py', 336, 'MemoryManager'), anchor('agent/memory_manager.py', 447, 'prefetch_all'), anchor('agent/memory_manager.py', 533, 'sync_all')]),
  node('augment-input', 'api_content / multimodal context', 'state', 'turn', 6,
    'Preserves augmented user input so model-facing requests can replay it.', ['inject']),
  node('runtime-choice', '_run_conversation_turn · runtime', 'decision', 'loop', 0,
    'Selects the generic conversation loop or dedicated app-server runtime.', ['runtime-gate']),
  node('iteration', 'prepare_iteration / begin_iteration', 'state', 'loop', 1,
    'Checks cancellation and budgets, consumes steer and repairs working messages.', ['iteration']),
  node('assemble', 'assemble_api_request', 'component', 'loop', 2,
    'Creates a request-local copy with effective system prompt, replay and schemas.', ['request']),
  node('selection', '_apply_context_engine_selection', 'component', 'loop', 3,
    'Allows an overriding context engine to select the outbound request.', ['selection']),
  node('clean-cache', 'Request cleanup + cache plan', 'state', 'loop', 4,
    'Sanitizes the outbound copy, plans cache markers and estimates pressure.', ['request-clean']),
  node('preflight', 'run_preflight_gate', 'decision', 'loop', 5,
    'Admits the request, requests a history rewrite or returns a stop verdict.', ['request-gate']),
  node('response', 'normalize_model_response', 'decision', 'loop', 6,
    'Normalizes usage and assistant output, then branches to tools, text or continuation.', ['response']),
  node('provider-call', 'build_api_request / perform_api_call', 'component', 'provider', 0,
    'Builds protocol-specific kwargs and sends an admitted provider attempt.', ['provider']),
  node('provider-api', 'Configured model provider', 'external', 'provider', 1,
    'The selected model service returns responses or protocol/transport errors.', ['provider']),
  node('api-retry', '_run_api_retry_loop / handle_api_error', 'decision', 'provider', 2,
    'Classifies failure: retry current request, restart the loop, recover or terminate.', ['retry']),
  node('overflow', 'recover_from_overflow', 'decision', 'provider', 3,
    'Handles rejected context or payload limits using eligible recovery strategies.', ['overflow']),
  node('interrupt', 'handle_api_interrupt', 'state', 'provider', 4,
    'Preserves eligible partial output and stops an interrupted call.', ['interrupt']),
  node('terminal-error', 'Terminal provider result', 'state', 'provider', 5,
    'Returns an early failure result that bypasses generic finalize_turn.', ['terminal-error']),
  node('context-engine', 'ContextEngine', 'component', 'compression', 0,
    'Defines request selection, compaction and session/turn lifecycle capabilities.', [],
    [anchor('agent/context_engine.py', 48, 'ContextEngine')]),
  node('compression-lease', 'compress_context', 'decision', 'compression', 1,
    'Checks rewrite feasibility and acquires a guarded compression generation.', ['compact']),
  node('summary', '_run_summary_phase / ContextCompressor', 'component', 'compression', 2,
    'Prepares eligible memory checkpoint and a candidate summarized history.', ['compact-summary']),
  node('commit-fence', '_candidate_rejected', 'decision', 'compression', 3,
    'Rejects stale, cancelled or ineffective candidates before commit.', ['compact-admission']),
  node('compaction-commit', '_commit_compaction', 'state', 'compression', 4,
    'Commits an admitted active/archive rewrite and refreshes prompt/usage boundaries.', ['compact-commit']),
  node('tool-calls', 'run_tool_round · call-row flush', 'state', 'tools', 0,
    'Validates and persists assistant tool calls before admitting side effects.', ['persist-calls']),
  node('tool-executor', '_execute_tool_calls · segment planner', 'component', 'tools', 1,
    'Plans eligible parallel runs and sequential barriers; applies authorization and guardrails before dispatch.', ['tools'], [anchor('run_agent.py', 1330, '_execute_tool_calls')]),
  node('tool-environment', 'Configured tools + task environment', 'external', 'tools', 2,
    'Tool implementations interact with configured services, files and execution backends.', ['tools'], [anchor('run_agent.py', 1330, '_execute_tool_calls')]),
  node('tool-results', '_commit_tool_result', 'state', 'tools', 3,
    'Shapes bounded feedback and checks flush before continuation; SQLite durability requires a bound store.', ['persist-results']),
  node('post-tool', 'compress_after_tool_results', 'decision', 'tools', 4,
    'Rechecks pressure after durable feedback, then continues, rewrites or stops.', ['tool-pressure']),
  node('delegate', 'delegate_task / _build_child_agent', 'component', 'tools', 5,
    'Builds isolated children and chooses detached dispatch or joined execution according to depth, consumer availability and capacity.', ['delegate']),
  node('child', '_run_single_child', 'component', 'tools', 6,
    'Runs one child lifecycle; joined batches return results in the tool round, while detached units publish later completion.', ['child']),
  node('persistence-failure', 'session_persistence_failed', 'state', 'tools', 7,
    'Halts before unsafe tool execution or reuse of process-only tool feedback.', ['persistence-failure']),
  node('final-text', 'finish_text_response', 'decision', 'completion', 0,
    'Applies stop gates; accepted text is transformed and persisted, or execution continues.', ['text']),
  node('finalizer', 'finalize_turn', 'component', 'completion', 1,
    'Settles generic completion, interruption and budget/failure exits into a turn result.', ['finalize']),
  node('background', 'Memory sync + review scheduling', 'component', 'completion', 2,
    'Queues best-effort external memory sync/prefetch and eligible snapshot reviews; memory worker allocation failure can fall back inline.', ['postturn']),
  node('async-completion', 'Async delegation completion', 'state', 'completion', 5,
    'Detached units publish completion receipts and queue events for a later host consumer; child execution itself is not restart-resumable.', [],
    [anchor('tools/async_delegation.py', 875, '_finalize'), anchor('tools/async_delegation.py', 897, '_push_completion_event')]),
  node('native-runtime', 'run_codex_app_server_turn', 'component', 'completion', 3,
    'Runs the dedicated runtime with its own model/tool loop and Hermes event integration.', ['native']),
  node('native-projection', '_persist_projected_messages / _finish_codex_turn', 'state', 'completion', 4,
    'Attempts to flush projected app-server history and returns through dedicated completion; streamed output may survive a failed flush.', ['native-persist']),
];


const groupSlots = new Map<string, number>();
export const architectureNodes: readonly ArchitectureNode[] = [...originalNodes, ...expansionNodes.map(spec => {
  const slot = groupSlots.get(spec.groupId) ?? 0;
  groupSlots.set(spec.groupId, slot + 1);
  return node(spec.id, spec.label, spec.kind, spec.groupId, slot, spec.summary, [], spec.source);
})];

const edge = (from: string, to: string, kind: ArchitectureEdgeKind, label: string): ArchitectureEdge => ({
  id: `${from}:${to}:${kind}`, from, to, kind, label,
});

/** Relationship labels describe ownership and alternatives; this is not a total execution ordering. */
export const architectureEdges: readonly ArchitectureEdge[] = [
  edge('cli-chat', 'init-agent', 'call', 'initialize or reuse'),
  edge('cli-chat', 'stage-input', 'transition', 'prepare incoming message'),
  edge('init-agent', 'client-tools', 'call', 'cold start: client and capabilities'),
  edge('init-agent', 'session-init', 'call', 'cold start: session binding'),
  edge('init-agent', 'memory-init', 'call', 'cold start: memory setup'),
  edge('init-agent', 'engine-init', 'call', 'cold start: engine setup'),
  edge('memory-init', 'memory-manager', 'call', 'configured provider manager'),
  edge('engine-init', 'context-engine', 'call', 'instantiate + session start'),
  edge('session-init', 'session-db', 'data', 'bind optional store'),
  edge('stage-input', 'turn-facade', 'call', 'user input + prior history'),
  edge('turn-facade', 'session-db', 'data', 'lease + refreshed history'),
  edge('turn-facade', 'build-turn', 'call', 'admitted turn'),
  edge('turn-facade', 'release', 'transition', 'finally: every returned path'),
  edge('build-turn', 'prompt', 'call', 'restore or build'),
  edge('prompt', 'turn-pressure', 'transition', 'active prompt + working history'),
  edge('turn-pressure', 'compression-lease', 'call', 'maintenance / pressure'),
  edge('turn-pressure', 'hooks', 'transition', 'admitted history'),
  edge('hooks', 'recall', 'transition', 'collect context before recall'),
  edge('recall', 'memory-manager', 'call', 'await eligible prefetch'),
  edge('recall', 'augment-input', 'data', 'recalled text + hook / host context'),
  edge('augment-input', 'persist-start', 'data', 'prepared transcript'),
  edge('persist-start', 'session-db', 'data', 'write turn start'),
  edge('persist-start', 'runtime-choice', 'transition', 'prepared turn'),
  edge('runtime-choice', 'iteration', 'transition', 'generic runtime'),
  edge('runtime-choice', 'native-runtime', 'call', 'codex_app_server'),
  edge('iteration', 'assemble', 'call', 'continue iteration'),
  edge('iteration', 'finalizer', 'transition', 'interrupt / budget / stop verdict'),
  edge('assemble', 'selection', 'call', 'request-local copy'),
  edge('selection', 'context-engine', 'call', 'overridden selection hook'),
  edge('selection', 'clean-cache', 'transition', 'selected request'),
  edge('clean-cache', 'preflight', 'data', 'clean request + pressure'),
  edge('preflight', 'provider-call', 'transition', 'send admitted'),
  edge('preflight', 'compression-lease', 'call', 'rewrite required'),
  edge('preflight', 'finalizer', 'transition', 'stop verdict'),
  edge('preflight', 'release', 'transition', 'early result verdict'),
  edge('provider-call', 'provider-api', 'call', 'protocol-specific request'),
  edge('provider-api', 'response', 'data', 'response + usage'),
  edge('provider-call', 'api-retry', 'transition', 'classified call failure'),
  edge('api-retry', 'provider-call', 'transition', 'retry same assembled request'),
  edge('api-retry', 'iteration', 'transition', 'fallback / redirect restart'),
  edge('api-retry', 'overflow', 'call', 'context / payload rejection'),
  edge('api-retry', 'terminal-error', 'transition', 'no remaining recovery'),
  edge('provider-call', 'interrupt', 'transition', 'interrupted attempt'),
  edge('overflow', 'compression-lease', 'call', 'eligible history rewrite'),
  edge('overflow', 'iteration', 'transition', 'recover and rebuild request'),
  edge('overflow', 'terminal-error', 'transition', 'blocked / exhausted'),
  edge('interrupt', 'finalizer', 'transition', 'interrupted state'),
  edge('terminal-error', 'release', 'transition', 'early result; bypass finalizer'),
  edge('response', 'release', 'transition', 'early partial result: bypass generic finalizer'),
  edge('response', 'tool-calls', 'transition', 'assistant tool calls'),
  edge('response', 'final-text', 'transition', 'assistant text'),
  edge('response', 'iteration', 'transition', 'continuation / recoverable response'),
  edge('summary', 'context-engine', 'call', 'configured compress hook'),
  edge('compression-lease', 'summary', 'call', 'admitted snapshot'),
  edge('summary', 'commit-fence', 'data', 'candidate history'),
  edge('commit-fence', 'compaction-commit', 'transition', 'candidate admitted'),
  edge('commit-fence', 'preflight', 'data', 'rejected candidate: caller handles outcome'),
  edge('commit-fence', 'turn-pressure', 'data', 'turn-start rejection: unchanged history'),
  edge('commit-fence', 'post-tool', 'data', 'post-tool rejection: caller handles outcome'),
  edge('compaction-commit', 'session-db', 'data', 'active / archive commit'),
  edge('compaction-commit', 'iteration', 'transition', 'request-triggered rewrite: rebuild'),
  edge('compaction-commit', 'hooks', 'transition', 'turn-start rewrite: resume construction'),
  edge('tool-calls', 'session-db', 'data', 'flush assistant call row'),
  edge('tool-calls', 'tool-executor', 'transition', 'call flush did not return false; store optional'),
  edge('tool-calls', 'persistence-failure', 'transition', 'call flush failed'),
  edge('tool-executor', 'tool-environment', 'call', 'approved tool dispatch'),
  edge('tool-environment', 'tool-results', 'data', 'outcome / blocked / error'),
  edge('tool-executor', 'delegate', 'call', 'delegate_task selected'),
  edge('delegate', 'tool-results', 'data', 'detached accepted: dispatch handle returns immediately'),
  edge('child', 'async-completion', 'background', 'detached unit: aggregate and publish later'),
  edge('delegate', 'child', 'call', 'joined or detached child lifecycle'),
  edge('child', 'tool-results', 'data', 'joined batch: structured child result'),
  edge('tool-results', 'session-db', 'data', 'flush bounded result'),
  edge('tool-results', 'persistence-failure', 'transition', 'result flush failed'),
  edge('tool-results', 'post-tool', 'transition', 'durable feedback'),
  edge('post-tool', 'iteration', 'transition', 'next model iteration'),
  edge('post-tool', 'compression-lease', 'call', 'post-tool pressure'),
  edge('persistence-failure', 'finalizer', 'transition', 'halt unsafe continuation'),
  edge('final-text', 'iteration', 'transition', 'stop gate requests continuation'),
  edge('final-text', 'finalizer', 'transition', 'accepted text'),
  edge('final-text', 'session-db', 'data', 'flush final assistant row'),
  edge('finalizer', 'session-db', 'data', 'persist settled history'),
  edge('finalizer', 'context-engine', 'call', 'observe turn completion'),
  edge('finalizer', 'background', 'background', 'schedule eligible work'),
  edge('background', 'memory-manager', 'background', 'sync / prefetch queue; inline fallback on executor failure'),
  edge('finalizer', 'release', 'transition', 'structured turn result'),
  edge('native-runtime', 'native-projection', 'data', 'runtime events + completed turn'),
  edge('native-runtime', 'iteration', 'transition', 'configured generic fallback'),
  edge('native-projection', 'session-db', 'data', 'persist event projection'),
  edge('native-projection', 'release', 'transition', 'dedicated finish; bypass finalizer'),
  edge('release', 'cli-delivery', 'transition', 'host settles returned result'),
  ...expansionEdges,
];
