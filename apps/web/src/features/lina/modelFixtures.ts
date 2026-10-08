/** Deterministic protocol examples for Studio. These shapes teach provider
 * differences; they are not live adapters or exhaustive provider wire schemas. */
export type ModelProtocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'gemini-generate-content';
export type ModelCase = 'answer' | 'interleaved-tools' | 'text-tools' | 'usage-unavailable' | 'usage-partial' | 'refusal' | 'truncated' | 'malformed' | 'duplicate-calls' | 'missing-finish' | 'unknown-finish' | 'local-settlement-wait' | 'retry-before-output' | 'retry-after-output' | 'unsupported-media' | 'unsupported-schema' | 'unsupported-setting' | 'binding-change' | 'budget-change' | 'context-overflow' | 'credential-wait' | 'metadata-credential-wait' | 'opaque-mismatch' | 'unknown-event' | 'http200-error' | 'empty' | 'unknown-tool';
export const MODEL_PROTOCOLS: readonly { value: ModelProtocol; label: string }[] = [
  { value: 'openai-chat', label: 'Chat Completions fixture' },
  { value: 'openai-responses', label: 'Responses fixture' },
  { value: 'anthropic-messages', label: 'Messages fixture' },
  { value: 'gemini-generate-content', label: 'GenerateContent fixture' },
];
export const MODEL_CASES: readonly { value: ModelCase; label: string }[] = [
  { value: 'answer', label: 'Ordinary response' }, { value: 'interleaved-tools', label: 'Two interleaved calls' },
  { value: 'text-tools', label: 'Text and calls' }, { value: 'usage-unavailable', label: 'Usage unavailable' },
  { value: 'usage-partial', label: 'Partial usage' }, { value: 'refusal', label: 'Refusal / blocked' },
  { value: 'truncated', label: 'Truncated arguments' }, { value: 'malformed', label: 'Malformed arguments' },
  { value: 'duplicate-calls', label: 'Duplicate call IDs' }, { value: 'missing-finish', label: 'Missing terminal marker' },
  { value: 'unknown-finish', label: 'Unknown finish reason' }, { value: 'local-settlement-wait', label: 'Delayed local Stop settlement' },
  { value: 'retry-before-output', label: 'Failure before output' }, { value: 'retry-after-output', label: 'Failure after preview' },
  { value: 'unsupported-media', label: 'Unsupported required media' }, { value: 'unsupported-schema', label: 'Unsupported schema' },
  { value: 'unsupported-setting', label: 'Unsupported setting' }, { value: 'binding-change', label: 'Changed model binding' },
  { value: 'budget-change', label: 'Changed capability budget' },
  { value: 'context-overflow', label: 'Provider context overflow' }, { value: 'credential-wait', label: 'Credential readiness wait' },
  { value: 'metadata-credential-wait', label: 'Metadata readiness wait' },
  { value: 'opaque-mismatch', label: 'Incompatible continuation' }, { value: 'unknown-event', label: 'Unknown progress event' },
  { value: 'http200-error', label: 'Error inside HTTP 200' }, { value: 'empty', label: 'Empty terminal content' },
  { value: 'unknown-tool', label: 'Unknown tool name' },
];

export interface ModelUsage {
  availability: 'reported' | 'partial' | 'unavailable'; inputTokens: number | null; outputTokens: number | null;
  cacheReadTokens: number | null; cacheWriteTokens: number | null; reasoningTokens: number | null;
  totalTokens: number | null; accountingSemantics: string; rawUsage: Record<string, unknown> | null;
}
export interface ModelFailure { code: string; stage: 'resolve' | 'encode' | 'invoke' | 'normalize'; retryable: boolean; contextRefresh?: boolean; readinessWait?: boolean; reprepare?: boolean }
export interface ModelFixtureCall { callId: string; name: string; arguments: Record<string, unknown>; wireIndex: number; catalogMapped: boolean }
export interface ModelContinuation {
  artifactRef: string; agentId: string; accountId: string; protocol: ModelProtocol; bindingRevision: number;
  historyRevision: number; required: boolean; position: number;
}
export interface ModelOutcome {
  status: 'complete' | 'incomplete' | 'malformed' | 'failed' | 'aborted' | 'unknown';
  kind: 'answer' | 'tools' | 'text-tools' | 'continuation' | 'refusal' | 'blocked' | 'error';
  text: string; toolCalls: ModelFixtureCall[]; rawFinishReason: string | null; usage: ModelUsage;
  failure?: ModelFailure; localSettlement: 'settled' | 'pending'; remoteStatus: 'observed-complete' | 'unknown';
  continuationHint: boolean; continuation: ModelContinuation[]; attemptId: string | null; responseId: string | null;
}
export interface ModelBuffer { itemId: string; kind: 'text' | 'tool'; wireIndex: number; callId?: string; name?: string; text: string; argumentsJson: string; closed: boolean }
interface EventIdentity { attemptId: string; sequence: number; rawEvent: Record<string, unknown> }
export type ModelFixtureEvent = EventIdentity & (
  | { type: 'launch' }
  | { type: 'item-start'; itemId: string; kind: 'text' | 'tool'; wireIndex: number; callId?: string; name?: string }
  | { type: 'text-delta'; itemId: string; text: string }
  | { type: 'arguments-delta'; itemId: string; fragment: string }
  | { type: 'item-end'; itemId: string }
  | { type: 'usage'; usage: Record<string, unknown>; complete: boolean }
  | { type: 'heartbeat' }
  | { type: 'unknown' }
  | { type: 'cancel'; reason: string }
  | { type: 'terminal'; status: ModelOutcome['status']; finishReason: string | null; marker: boolean;
      kind?: ModelOutcome['kind']; failure?: ModelFailure; usage?: Record<string, unknown>;
      usageComplete?: boolean; continuationHint?: boolean; continuation?: ModelContinuation[]; responseId?: string }
);
export interface ModelFixtureState {
  attemptId: string; protocol: ModelProtocol; lifecycle: 'planned' | 'running' | 'settled';
  lastSequence: number; buffers: ModelBuffer[]; usage: ModelUsage; outcome?: ModelOutcome;
  evidence: ModelFixtureEvent[]; diagnostics: string[]; launchCount: number; protocolFailure?: string;
}

export const unavailableModelUsage = (): ModelUsage => ({ availability: 'unavailable', inputTokens: null, outputTokens: null,
  cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, totalTokens: null,
  accountingSemantics: 'Usage not observed; unknown is not zero.', rawUsage: null });
const record = (value: unknown): Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const tokens = (value: unknown): number | null => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

/** Provider counters have different inclusion rules. Each cumulative observation
 * replaces the prior counters; it never adds them a second time. */
export function normalizeModelUsage(protocol: ModelProtocol, raw: Record<string, unknown> | undefined, complete = true): ModelUsage {
  if (!raw) return unavailableModelUsage();
  let input: number | null, output: number | null, read: number | null, write: number | null, reasoning: number | null, total: number | null;
  let semantics: string;
  if (protocol === 'anthropic-messages') {
    const uncached = tokens(raw.input_tokens); read = tokens(raw.cache_read_input_tokens); write = tokens(raw.cache_creation_input_tokens);
    input = uncached === null || read === null || write === null ? null : uncached + read + write;
    output = tokens(raw.output_tokens); reasoning = null; total = input === null || output === null ? null : input + output;
    semantics = 'Input = uncached + cache read + cache creation; output includes provider thinking. Cumulative replacement.';
  } else if (protocol === 'gemini-generate-content') {
    input = tokens(raw.promptTokenCount); output = tokens(raw.candidatesTokenCount); read = tokens(raw.cachedContentTokenCount);
    write = null; reasoning = tokens(raw.thoughtsTokenCount); total = tokens(raw.totalTokenCount);
    semantics = 'Input includes cached tokens; candidate output and thought counters are separate. Provider total retained.';
  } else {
    const responses = protocol === 'openai-responses'; input = tokens(raw[responses ? 'input_tokens' : 'prompt_tokens']);
    output = tokens(raw[responses ? 'output_tokens' : 'completion_tokens']); total = tokens(raw.total_tokens);
    const details = record(raw[responses ? 'input_tokens_details' : 'prompt_tokens_details']);
    read = tokens(details.cached_tokens); write = tokens(details.cache_write_tokens);
    reasoning = tokens(record(raw[responses ? 'output_tokens_details' : 'completion_tokens_details']).reasoning_tokens);
    semantics = 'Input includes cached tokens; output includes reasoning tokens. Provider total retained.';
  }
  return { availability: complete && input !== null && output !== null ? 'reported' : 'partial', inputTokens: input, outputTokens: output,
    cacheReadTokens: read, cacheWriteTokens: write, reasoningTokens: reasoning, totalTokens: total, accountingSemantics: semantics, rawUsage: raw };
}
export function createModelFixtureState(attemptId: string, protocol: ModelProtocol): ModelFixtureState {
  return { attemptId, protocol, lifecycle: 'planned', lastSequence: -1, buffers: [], usage: unavailableModelUsage(), evidence: [], diagnostics: [], launchCount: 0 };
}
const catalogNames = new Set(['calculator','workspace_fixture','spawn_subagent','await_subagent']);
const knownFinishReasons: Record<ModelProtocol, Set<string>> = {
  'openai-chat': new Set(['stop', 'tool_calls', 'function_call', 'length', 'content_filter']),
  'openai-responses': new Set(['completed', 'max_output_tokens', 'content_filter']),
  'anthropic-messages': new Set(['end_turn', 'tool_use', 'max_tokens', 'stop_sequence', 'refusal', 'pause_turn', 'model_context_window_exceeded']),
  'gemini-generate-content': new Set(['STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'MALFORMED_FUNCTION_CALL', 'UNEXPECTED_TOOL_CALL', 'MALFORMED_RESPONSE']),
};
function terminalOutcome(state: ModelFixtureState, event: Extract<ModelFixtureEvent, { type: 'terminal' }>): ModelOutcome {
  let status = event.status, failure = event.failure;
  const text = state.buffers.filter(buffer => buffer.kind === 'text').sort((a, b) => a.wireIndex - b.wireIndex).map(buffer => buffer.text).join('');
  const calls: ModelFixtureCall[] = [];
  if (status === 'complete' && state.lifecycle === 'planned') { status = 'malformed'; failure = { code: 'terminal_before_launch', stage: 'invoke', retryable: false }; }
  if (status === 'complete' && state.protocolFailure) { status = 'malformed'; failure = { code: state.protocolFailure, stage: 'normalize', retryable: false }; }
  if (status === 'complete' && !event.marker) { status = 'unknown'; failure = { code: 'terminal_marker_missing', stage: 'normalize', retryable: false }; }
  if (status === 'complete' && (!event.finishReason || !knownFinishReasons[state.protocol].has(event.finishReason))) { status = 'unknown'; failure = { code: 'unknown_finish_reason', stage: 'normalize', retryable: false }; }
  if (status === 'complete' && !['refusal', 'blocked'].includes(event.kind ?? '')) {
    const seen = new Set<string>();
    for (const buffer of [...state.buffers].sort((a, b) => a.wireIndex - b.wireIndex)) {
      if (!buffer.closed) { status = 'incomplete'; failure = { code: 'unclosed_content_item', stage: 'normalize', retryable: false }; break; }
      if (buffer.kind !== 'tool') continue;
      let args: unknown;
      try { args = JSON.parse(buffer.argumentsJson); } catch { status = 'malformed'; failure = { code: 'invalid_arguments_json', stage: 'normalize', retryable: false }; break; }
      if (!buffer.name?.trim() || typeof args !== 'object' || args === null || Array.isArray(args)) {
        status = 'malformed'; failure = { code: 'invalid_call_structure', stage: 'normalize', retryable: false }; break;
      }
      const callId = buffer.callId ?? `${state.attemptId}:wire-${buffer.wireIndex}`;
      if (!callId.trim() || seen.has(callId)) { status = 'malformed'; failure = { code: 'ambiguous_call_id', stage: 'normalize', retryable: false }; break; }
      seen.add(callId); calls.push({ callId, name: buffer.name, arguments: args as Record<string, unknown>, wireIndex: buffer.wireIndex, catalogMapped: catalogNames.has(buffer.name) });
    }
    if (status === 'complete' && !calls.length && !text.trim() && !event.continuationHint) {
      status = 'malformed'; failure = { code: 'empty_terminal_content', stage: 'normalize', retryable: false };
    }
  }
  const executableCalls = status === 'complete' && !['refusal', 'blocked'].includes(event.kind ?? '') ? calls : [];
  const kind: ModelOutcome['kind'] = status !== 'complete' ? 'error' : event.kind === 'refusal' || event.kind === 'blocked' ? event.kind
    : executableCalls.length ? text ? 'text-tools' : 'tools' : event.continuationHint ? 'continuation' : 'answer';
  let usage = event.usage ? normalizeModelUsage(state.protocol, event.usage, event.usageComplete ?? true) : state.usage;
  if (!event.usage && usage.availability === 'reported') usage = { ...usage, availability: 'partial' };
  return { status, kind, text, toolCalls: executableCalls, rawFinishReason: event.finishReason, usage, ...(failure ? { failure } : {}),
    localSettlement: 'settled', remoteStatus: state.launchCount > 0 && event.marker && ['complete', 'incomplete', 'malformed'].includes(status) ? 'observed-complete' : 'unknown',
    continuationHint: status === 'complete' && Boolean(event.continuationHint), continuation: event.continuation ?? [],
    attemptId: state.attemptId, responseId: event.responseId ?? null };
}

/** One reducer drives both playback modes. Sequence identities make replay
 * idempotent; a terminal attempt never accepts later progress or a second launch. */
export function applyModelFixtureEvent(state: ModelFixtureState, event: ModelFixtureEvent): ModelFixtureState {
  if (event.attemptId !== state.attemptId || event.sequence <= state.lastSequence) return state;
  if (state.lifecycle === 'settled') return { ...state, lastSequence: event.sequence, diagnostics: [...state.diagnostics, `Late ${event.type} retained diagnostically; attempt stays settled.`], evidence: [...state.evidence, event] };
  let next: ModelFixtureState = { ...state, lastSequence: event.sequence, buffers: state.buffers.map(buffer => ({ ...buffer })), evidence: [...state.evidence, event], diagnostics: [...state.diagnostics] };
  if (event.type === 'launch') {
    if (state.lifecycle === 'planned') next = { ...next, lifecycle: 'running', launchCount: 1 };
    return next;
  }
  if (event.type === 'cancel') {
    const usage = state.usage.availability === 'reported' ? { ...state.usage, availability: 'partial' as const } : state.usage;
    return { ...next, lifecycle: 'settled', outcome: { status: 'aborted', kind: 'error', text: state.buffers.filter(item => item.kind === 'text').map(item => item.text).join(''),
      toolCalls: [], rawFinishReason: null, usage, failure: { code: event.reason, stage: 'invoke', retryable: false },
      localSettlement: 'settled', remoteStatus: 'unknown', continuationHint: false, continuation: [], attemptId: state.launchCount > 0 ? state.attemptId : null, responseId: null } };
  }
  if (event.type === 'terminal') {
    const outcome = terminalOutcome(next, event);
    return { ...next, lifecycle: 'settled', usage: outcome.usage, outcome };
  }
  if (state.lifecycle !== 'running') return { ...next, diagnostics: [...next.diagnostics, 'Progress before dispatch rejected.'] };
  if (event.type === 'usage') return { ...next, usage: normalizeModelUsage(state.protocol, event.usage, event.complete) };
  if (event.type === 'heartbeat' || event.type === 'unknown') return next;
  if (event.type === 'item-start') {
    if (next.buffers.some(buffer => buffer.itemId === event.itemId || buffer.wireIndex === event.wireIndex)) return { ...next, protocolFailure: 'ambiguous_content_identity', diagnostics: [...next.diagnostics, 'Duplicate content identity rejected.'] };
    return { ...next, buffers: [...next.buffers, { itemId: event.itemId, kind: event.kind, wireIndex: event.wireIndex,
      ...(event.callId !== undefined ? { callId: event.callId } : {}), ...(event.name !== undefined ? { name: event.name } : {}), text: '', argumentsJson: '', closed: false }] };
  }
  const buffer = next.buffers.find(buffer => buffer.itemId === event.itemId);
  if (!buffer || buffer.closed || (event.type === 'text-delta' && buffer.kind !== 'text') || (event.type === 'arguments-delta' && buffer.kind !== 'tool')) return { ...next, protocolFailure: 'invalid_content_delta', diagnostics: [...next.diagnostics, 'Delta for absent/closed/mismatched content item rejected.'] };
  if (event.type === 'item-end') buffer.closed = true;
  if (event.type === 'text-delta' && buffer.kind === 'text') buffer.text += event.text;
  if (event.type === 'arguments-delta' && buffer.kind === 'tool') buffer.argumentsJson += event.fragment;
  return next;
}

export interface ModelBindingFixture {
  protocol: ModelProtocol; profileId: string; bindingRevision: number; capabilityRevision: number; accountId: string;
  provider: string; model: string; endpointRef: string; credentialRef: string; sourceLinks: string[];
  limits: { contextTokens: number; maxOutputTokens: number }; synthetic: true;
}
export interface ModelEncodeInput {
  protocol: ModelProtocol; agentId?: string; accountId?: string; bindingRevision?: number; capabilityRevision?: number;
  expectedBindingRevision?: number; expectedCapabilityRevision?: number; inputTokens?: number; maxOutputTokens?: number;
  requiredMedia?: 'text' | 'image' | 'audio'; schema?: Record<string, unknown>; settings?: Record<string, unknown>;
  continuation?: ModelContinuation[]; historyRevision?: number; callIds?: string[]; includePriorToolResult?: boolean; snapshotRef?: string; requestId?: string;
  priorToolResults?: ModelPriorToolResult[];
  instruction?:string; userText?:string; toolNames?:string[]; profileId?:string; modelName?:string;
}
export interface ModelPriorToolResult { callId: string; name: string; arguments: Record<string, unknown>; result: unknown }
export interface ModelEncodedFixture {
  binding: ModelBindingFixture; requestId: string; snapshotRef: string; wireBody: Record<string, unknown>;
  manifest: { synthetic: true; originalSchema: Record<string, unknown>; projectedSchema: Record<string, unknown>; originalSchemaDigest: string; projectedSchemaDigest: string;
    transformations: string[]; toolAliases: Record<string, string>; continuationRefs: string[]; mediaFidelity: string; inputTokens: number; outputReservation: number };
  failure?: ModelFailure;
}
const sourceLinks: Record<ModelProtocol, string[]> = {
  'openai-chat': ['https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create'],
  'openai-responses': ['https://developers.openai.com/api/docs/guides/function-calling', 'https://developers.openai.com/api/docs/guides/streaming-responses'],
  'anthropic-messages': ['https://platform.claude.com/docs/en/build-with-claude/streaming', 'https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons'],
  'gemini-generate-content': ['https://ai.google.dev/api/generate-content', 'https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures'],
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const digest = (value: unknown) => {
  let hash = 2166136261;
  for (const character of JSON.stringify(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `fixture-fnv32:${(hash >>> 0).toString(16)}`;
};
const arithmeticSchema = { type: 'object', properties: { expression: { type: 'string', minLength: 1 } }, required: ['expression'], additionalProperties: false };
/** Reject unsupported or stale requirements before any launch. The examples use
 * explicit fake limits, not production tokenizer or capability measurements. */
export function encodeModelFixture(input: ModelEncodeInput): ModelEncodedFixture {
  const protocol = input.protocol, accountId = input.accountId ?? 'account-demo', agentId = input.agentId ?? 'lina';
  const bindingRevision = input.bindingRevision ?? 1, capabilityRevision = input.capabilityRevision ?? 1;
  const binding: ModelBindingFixture = { protocol, profileId: input.profileId ?? `${protocol}-fixture-v1`, bindingRevision, capabilityRevision, accountId,
    provider: protocol.split('-')[0], model: input.modelName ?? 'fixture-model', endpointRef: `fixture-endpoint:${protocol}`, credentialRef: `credential-ref:${accountId}:model`,
    sourceLinks: sourceLinks[protocol], limits: { contextTokens: 4096, maxOutputTokens: 1024 }, synthetic: true };
  const original: Record<string, unknown> = clone(input.schema ?? arithmeticSchema), projected = clone(original), suppliedContinuation = input.continuation ?? [];
  const compatibleContinuation = (item: ModelContinuation) => item.protocol === protocol && item.agentId === agentId && item.accountId === accountId
    && item.bindingRevision === bindingRevision && item.historyRevision === (input.historyRevision ?? item.historyRevision);
  const continuation = suppliedContinuation.filter(compatibleContinuation).sort((a, b) => a.position - b.position);
  const inputTokens = input.inputTokens ?? 120, outputReservation = input.maxOutputTokens ?? Number(input.settings?.max_output_tokens ?? 512);
  let failure: ModelFailure | undefined;
  if (bindingRevision !== (input.expectedBindingRevision ?? bindingRevision) || capabilityRevision !== (input.expectedCapabilityRevision ?? capabilityRevision)) failure = { code: 'binding_changed', stage: 'resolve', retryable: false, reprepare: true };
  else if (input.requiredMedia && !['text', 'image'].includes(input.requiredMedia)) failure = { code: 'unsupported_required_media', stage: 'encode', retryable: false };
  else if (original.$ref !== undefined || original.oneOf !== undefined) failure = { code: 'unsupported_fixture_schema', stage: 'encode', retryable: false };
  else if (Object.keys(input.settings ?? {}).some(key => !['temperature', 'max_output_tokens'].includes(key)) || (input.settings?.temperature !== undefined && (typeof input.settings.temperature !== 'number' || input.settings.temperature < 0 || input.settings.temperature > 2)) || (input.settings?.max_output_tokens !== undefined && typeof input.settings.max_output_tokens !== 'number')) failure = { code: 'unsupported_fixture_setting', stage: 'encode', retryable: false };
  else if (!Number.isInteger(inputTokens) || inputTokens < 0 || !Number.isInteger(outputReservation) || outputReservation <= 0 || outputReservation > binding.limits.maxOutputTokens || inputTokens + outputReservation > binding.limits.contextTokens) failure = { code: 'encoded_context_overflow', stage: 'encode', retryable: false, reprepare: true, contextRefresh: true };
  else if (suppliedContinuation.some(item => item.required && !compatibleContinuation(item))) failure = { code: 'incompatible_continuation', stage: 'encode', retryable: false };
  const instruction = input.instruction ?? 'Fixture only: calculate using the available functions.', user = input.userText ?? 'Calculate 2 + 2 and 3 + 3.', callId = input.callIds?.[0] ?? 'call-001';
  const resultHistory = { callId, name: 'calculator', arguments: { expression: '2+2' }, result: 4 };
  const tools = (input.toolNames ?? ['calculator']).map(name => ({ name, description: `Fixture ${name}`, schema: projected }));
  let wireBody: Record<string, unknown>;
  if (protocol === 'openai-chat') wireBody = { model: binding.model, messages: [{ role: 'developer', content: instruction }, { role: 'user', content: user },
    { role: 'assistant', content: null, tool_calls: [{ id: callId, type: 'function', function: { name: resultHistory.name, arguments: JSON.stringify(resultHistory.arguments) } }] },
    { role: 'tool', tool_call_id: callId, content: JSON.stringify(resultHistory.result) }], tools: tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.schema, strict: false } })), stream: true, stream_options: { include_usage: true }, max_completion_tokens: outputReservation };
  else if (protocol === 'openai-responses') wireBody = { model: binding.model, instructions: instruction, input: [{ role: 'user', content: [{ type: 'input_text', text: user }] },
    { type: 'function_call', call_id: callId, name: 'calculator', arguments: JSON.stringify(resultHistory.arguments) }, { type: 'function_call_output', call_id: callId, output: JSON.stringify(resultHistory.result) }],
    tools: tools.map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.schema, strict: false })), stream: true, store: false, max_output_tokens: outputReservation };
  else if (protocol === 'anthropic-messages') wireBody = { model: binding.model, system: instruction, messages: [{ role: 'user', content: [{ type: 'text', text: user }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: callId, name: 'calculator', input: resultHistory.arguments }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: callId, content: JSON.stringify(resultHistory.result) }] }],
    tools: tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.schema })), stream: true, max_tokens: outputReservation };
  else wireBody = { systemInstruction: { parts: [{ text: instruction }] }, contents: [{ role: 'user', parts: [{ text: user }] },
    { role: 'model', parts: [{ functionCall: { name: 'calculator', args: resultHistory.arguments }, ...(continuation.length ? { thoughtSignature: continuation[0].artifactRef } : {}) }] },
    { role: 'user', parts: [{ functionResponse: { name: 'calculator', response: { result: resultHistory.result } } }] }], tools: [{ functionDeclarations: tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.schema })) }], generationConfig: { maxOutputTokens: outputReservation } };
  if (!input.includePriorToolResult && !input.priorToolResults?.length) {
    if (protocol === 'openai-chat') wireBody.messages = (wireBody.messages as unknown[]).slice(0, 2);
    if (protocol === 'openai-responses') wireBody.input = (wireBody.input as unknown[]).slice(0, 1);
    if (protocol === 'anthropic-messages') wireBody.messages = (wireBody.messages as unknown[]).slice(0, 1);
    if (protocol === 'gemini-generate-content') wireBody.contents = (wireBody.contents as unknown[]).slice(0, 1);
  }
  if (input.priorToolResults?.length) {
    const history = input.priorToolResults;
    if (new Set(history.map(item => item.callId)).size !== history.length || history.some(item => !item.callId || !item.name)) failure = { code: 'invalid_history_pairing', stage: 'encode', retryable: false };
    if (protocol === 'openai-chat') wireBody.messages = [{ role: 'developer', content: instruction }, { role: 'user', content: user },
      { role: 'assistant', content: null, tool_calls: history.map(item => ({ id: item.callId, type: 'function', function: { name: item.name, arguments: JSON.stringify(item.arguments) } })) },
      ...history.map(item => ({ role: 'tool', tool_call_id: item.callId, content: JSON.stringify(item.result) }))];
    if (protocol === 'openai-responses') wireBody.input = [{ role: 'user', content: [{ type: 'input_text', text: user }] },
      ...history.map(item => ({ type: 'function_call', call_id: item.callId, name: item.name, arguments: JSON.stringify(item.arguments) })),
      ...history.map(item => ({ type: 'function_call_output', call_id: item.callId, output: JSON.stringify(item.result) }))];
    if (protocol === 'anthropic-messages') wireBody.messages = [{ role: 'user', content: [{ type: 'text', text: user }] },
      { role: 'assistant', content: history.map(item => ({ type: 'tool_use', id: item.callId, name: item.name, input: item.arguments })) },
      { role: 'user', content: history.map(item => ({ type: 'tool_result', tool_use_id: item.callId, content: JSON.stringify(item.result) })) }];
    if (protocol === 'gemini-generate-content') wireBody.contents = [{ role: 'user', parts: [{ text: user }] },
      { role: 'model', parts: history.map((item, index) => ({ functionCall: { name: item.name, args: item.arguments }, ...(index === 0 && continuation.length ? { thoughtSignature: continuation[0].artifactRef } : {}) })) },
      { role: 'user', parts: history.map(item => ({ functionResponse: { name: item.name, response: { result: item.result } } })) }];
  }
  if (input.settings?.temperature !== undefined) {
    if (protocol === 'gemini-generate-content') record(wireBody.generationConfig).temperature = input.settings.temperature;
    else wireBody.temperature = input.settings.temperature;
  }
  if (input.requiredMedia === 'image') {
    if (protocol === 'openai-chat') record((wireBody.messages as Record<string, unknown>[])[1]).content = [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: 'https://example.test/fixture.png' } }];
    if (protocol === 'openai-responses') (record((wireBody.input as Record<string, unknown>[])[0]).content as unknown[]).push({ type: 'input_image', image_url: 'https://example.test/fixture.png' });
    if (protocol === 'anthropic-messages') (record((wireBody.messages as Record<string, unknown>[])[0]).content as unknown[]).push({ type: 'image', source: { type: 'url', url: 'https://example.test/fixture.png' } });
    if (protocol === 'gemini-generate-content') (record((wireBody.contents as Record<string, unknown>[])[0]).parts as unknown[]).push({ fileData: { mimeType: 'image/png', fileUri: 'https://example.test/fixture.png' } });
  }
  return { binding, requestId: input.requestId ?? 'request:fixture', snapshotRef: input.snapshotRef ?? 'snapshot:fixture:1', wireBody,
    manifest: { synthetic: true, originalSchema: original, projectedSchema: projected, originalSchemaDigest: digest(original), projectedSchemaDigest: digest(projected),
      transformations: ['Provider field names and result placement mapped; catalog constraints retained.', ...(suppliedContinuation.some(item => !item.required && !compatibleContinuation(item)) ? ['Optional incompatible continuation omitted under the explicit fixture scope policy.'] : [])], toolAliases: Object.fromEntries(tools.map(tool=>[tool.name,tool.name])),
      continuationRefs: continuation.map(item => item.artifactRef),
      mediaFidelity: input.requiredMedia === 'image' ? 'Required fixture image retained.' : 'Text retained.', inputTokens, outputReservation }, ...(failure ? { failure } : {}) };
}

export interface BuildModelFixtureOptions {
  protocol: ModelProtocol; modelCase: ModelCase; attemptId: string; roundId?: string; agentId?: string;
  responseKind?: 'answer' | 'tools' | 'text-tools' | 'continuation'; callIds?: string[]; includePriorToolResult?: boolean;
  priorToolResults?: ModelPriorToolResult[];
  encodeInput?: Omit<ModelEncodeInput, 'protocol'>;
}
export interface ModelFixture { binding: ModelBindingFixture; encodedRequest: ModelEncodedFixture; events: ModelFixtureEvent[]; outcome: ModelOutcome; prelaunchFailure?: ModelFailure; readinessWait: boolean; reprepare: boolean }
const rawUsageFor = (protocol: ModelProtocol): Record<string, unknown> => protocol === 'anthropic-messages'
  ? { input_tokens: 80, cache_read_input_tokens: 30, cache_creation_input_tokens: 10, output_tokens: 20 }
  : protocol === 'gemini-generate-content' ? { promptTokenCount: 120, cachedContentTokenCount: 30, candidatesTokenCount: 20, thoughtsTokenCount: 5, totalTokenCount: 145 }
  : protocol === 'openai-responses' ? { input_tokens: 120, output_tokens: 20, total_tokens: 140, input_tokens_details: { cached_tokens: 30 }, output_tokens_details: { reasoning_tokens: 5 } }
  : { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140, prompt_tokens_details: { cached_tokens: 30 }, completion_tokens_details: { reasoning_tokens: 5 } };
const finishFor = (protocol: ModelProtocol, kind: 'answer' | 'tools' | 'truncated' | 'refusal') => protocol === 'anthropic-messages'
  ? ({ answer: 'end_turn', tools: 'tool_use', truncated: 'max_tokens', refusal: 'refusal' })[kind]
  : protocol === 'gemini-generate-content' ? ({ answer: 'STOP', tools: 'STOP', truncated: 'MAX_TOKENS', refusal: 'SAFETY' })[kind]
  : protocol === 'openai-responses' ? ({ answer: 'completed', tools: 'completed', truncated: 'max_output_tokens', refusal: 'completed' })[kind]
  : ({ answer: 'stop', tools: 'tool_calls', truncated: 'length', refusal: 'content_filter' })[kind];

/** Builds an immutable event script and its expected normalized outcome. The
 * expected outcome is for route planning; UI results use reducer terminal state. */
export function buildModelFixture(options: BuildModelFixtureOptions): ModelFixture {
  const { protocol, modelCase, attemptId } = options, agentId = options.agentId ?? 'lina';
  const encodedRequest = encodeModelFixture({ protocol, agentId, callIds: options.callIds, includePriorToolResult: options.includePriorToolResult, priorToolResults: options.priorToolResults, ...options.encodeInput,
    ...(modelCase === 'unsupported-media' ? { requiredMedia: 'audio' as const } : {}),
    ...(modelCase === 'unsupported-schema' ? { schema: { type: 'object', oneOf: [{ type: 'string' }] } } : {}),
    ...(modelCase === 'unsupported-setting' ? { settings: { unrecognizedSetting: true } } : {}),
    ...(modelCase === 'binding-change' ? { bindingRevision: 2, expectedBindingRevision: 1 } : {}),
    ...(modelCase === 'budget-change' ? { capabilityRevision: 2, expectedCapabilityRevision: 1 } : {}),
    ...(modelCase === 'opaque-mismatch' ? { continuation: [{ artifactRef: 'opaque:foreign:fake', agentId: 'other-agent', accountId: 'account-demo', protocol, bindingRevision: 1, historyRevision: 1, required: true, position: 0 }] } : {}),
  });
  const events: ModelFixtureEvent[] = [];
  function event(payload: Omit<ModelFixtureEvent, keyof EventIdentity>, rawEvent: Record<string, unknown> = {}) {
    events.push({ ...payload, attemptId, sequence: events.length, rawEvent } as ModelFixtureEvent);
  }
  // Event creation accepts the discriminated payload so each branch's required
  // fields remain checked; Omit over the union would erase those fields.
  const emit = (payload: ModelEventPayload, rawEvent: Record<string, unknown> = {}) => event(payload as Omit<ModelFixtureEvent, keyof EventIdentity>, rawEvent);
  const itemStart = (itemId: string, kind: 'text' | 'tool', index: number, name?: string, callId?: string) => emit({ type: 'item-start', itemId, kind, wireIndex: index, ...(name ? { name } : {}), ...(callId !== undefined ? { callId } : {}) },
    protocol === 'anthropic-messages' ? { type: 'content_block_start', index, content_block: kind === 'tool' ? { type: 'tool_use', id: callId, name, input: {} } : { type: 'text', text: '' } }
    : protocol === 'openai-responses' ? { type: 'response.output_item.added', output_index: index, item: kind === 'tool' ? { type: 'function_call', id: itemId, call_id: callId, name, arguments: '' } : { type: 'message', id: itemId, content: [] } }
    : protocol === 'gemini-generate-content' ? { candidates: [{ index: 0, content: { role: 'model', parts: kind === 'tool' ? [{ functionCall: { name, args: {} } }] : [{ text: '' }] } }] }
    : { choices: [{ index: 0, delta: kind === 'tool' ? { tool_calls: [{ index: events.filter(item => item.type === 'item-start' && item.kind === 'tool').length, id: callId, type: 'function', function: { name, arguments: '' } }] } : { role: 'assistant', content: '' } }] });
  const wireIndexFor = (itemId: string) => {
    const item = events.find(event => event.type === 'item-start' && event.itemId === itemId);
    return item?.type === 'item-start' ? item.wireIndex : -1;
  };
  const textDelta = (itemId: string, text: string) => emit({ type: 'text-delta', itemId, text }, protocol === 'anthropic-messages'
    ? { type: 'content_block_delta', index: wireIndexFor(itemId), delta: { type: 'text_delta', text } } : protocol === 'openai-responses'
      ? { type: 'response.output_text.delta', item_id: itemId, delta: text } : protocol === 'gemini-generate-content'
        ? { candidates: [{ index: 0, content: { parts: [{ text }] } }] } : { choices: [{ index: 0, delta: { content: text } }] });
  const argumentsDelta = (itemId: string, fragment: string) => emit({ type: 'arguments-delta', itemId, fragment }, protocol === 'anthropic-messages'
    ? { type: 'content_block_delta', index: wireIndexFor(itemId), delta: { type: 'input_json_delta', partial_json: fragment } } : protocol === 'openai-responses'
      ? { type: 'response.function_call_arguments.delta', item_id: itemId, delta: fragment } : protocol === 'gemini-generate-content'
        ? { fixtureObservation: 'GenerateContent exposes structured function args; this canonical draft is a Studio buffer, not a native JSON-string delta.', argsFragment: fragment }
        : { choices: [{ index: 0, delta: { tool_calls: [{ index: events.filter(item => item.type === 'item-start' && item.kind === 'tool').findIndex(item => item.type === 'item-start' && item.itemId === itemId), function: { arguments: fragment } }] } }] });
  const itemEnd = (itemId: string) => emit({ type: 'item-end', itemId }, { fixtureItemComplete: itemId });
  const prelaunchFailure = encodedRequest.failure ?? (modelCase === 'credential-wait' || modelCase === 'metadata-credential-wait' ? { code: 'credential_not_ready', stage: 'resolve' as const, retryable: false, readinessWait: true } : undefined);
  if (prelaunchFailure) {
    const outcome: ModelOutcome = { status: 'failed', kind: 'error', text: '', toolCalls: [], rawFinishReason: null, usage: unavailableModelUsage(), failure: prelaunchFailure,
      localSettlement: 'settled', remoteStatus: 'unknown', continuationHint: false, continuation: [], attemptId: null, responseId: null };
    return { binding: encodedRequest.binding, encodedRequest, events, outcome, prelaunchFailure, readinessWait: Boolean(prelaunchFailure.readinessWait), reprepare: Boolean(prelaunchFailure.reprepare) };
  }
  emit({ type: 'launch' }, { fixtureDispatch: true, protocol });
  const rawUsage = rawUsageFor(protocol);
  emit({ type: 'heartbeat' }, { fixtureHeartbeat: true });
  if (modelCase === 'unknown-event') emit({ type: 'unknown' }, { type: 'future_provider_event', detail: 'Retained fixture evidence.' });
  let status: ModelOutcome['status'] = 'complete', failure: ModelFailure | undefined, kind: ModelOutcome['kind'] | undefined;
  const responseKind = modelCase === 'interleaved-tools' ? 'tools' : modelCase === 'text-tools' ? 'text-tools' : options.responseKind ?? 'answer';
  const toolCase = ['truncated', 'malformed', 'duplicate-calls', 'unknown-tool'].includes(modelCase) || ['tools', 'text-tools'].includes(responseKind);
  if (modelCase === 'retry-before-output' || modelCase === 'context-overflow' || modelCase === 'http200-error') {
    status = 'failed'; failure = { code: modelCase === 'context-overflow' ? 'context_length_exceeded' : modelCase === 'http200-error' ? 'in_stream_error' : 'provider_unavailable', stage: 'invoke', retryable: modelCase === 'retry-before-output', ...(modelCase === 'context-overflow' ? { contextRefresh: true } : {}) };
  } else if (modelCase === 'refusal') {
    itemStart('text-0', 'text', 0); textDelta('text-0', 'Fixture: request declined.'); itemEnd('text-0'); kind = protocol === 'gemini-generate-content' ? 'blocked' : 'refusal';
  } else if (modelCase !== 'empty') {
    if (!toolCase || responseKind === 'text-tools') { itemStart('text-0', 'text', 0); textDelta('text-0', modelCase === 'retry-after-output' ? 'Draft that failed before completion.' : toolCase ? 'I will calculate both.' : responseKind === 'continuation' ? 'Continue with the next step.' : 'The result is 4.'); itemEnd('text-0'); }
    if (toolCase) {
      const ids = options.callIds ?? ['call-001', 'call-002'];
      itemStart('tool-0', 'tool', 1, modelCase === 'unknown-tool' ? 'not_registered' : 'calculator', ids[0]);
      if (modelCase === 'malformed') { argumentsDelta('tool-0', '{"expression":'); itemEnd('tool-0'); }
      else if (modelCase === 'truncated') argumentsDelta('tool-0', '{"expression":');
      else {
        itemStart('tool-1', 'tool', 2, 'calculator', modelCase === 'duplicate-calls' ? ids[0] : ids[1]);
        argumentsDelta('tool-0', '{"expression":'); argumentsDelta('tool-1', '{"expression":'); argumentsDelta('tool-1', '"3+3"}'); itemEnd('tool-1');
        argumentsDelta('tool-0', '"2+2"}'); itemEnd('tool-0');
      }
    }
    if (modelCase === 'retry-after-output') { status = 'failed'; failure = { code: 'provider_disconnected', stage: 'invoke', retryable: true }; }
    if (modelCase === 'truncated') status = 'incomplete';
  }
  const usageMissing = modelCase === 'usage-unavailable' || modelCase === 'missing-finish';
  if (modelCase === 'usage-partial') emit({ type: 'usage', usage: rawUsage, complete: false }, { fixtureCumulativeUsage: rawUsage });
  if (modelCase === 'unknown-finish') { status = 'unknown'; failure = { code: 'unknown_finish_reason', stage: 'normalize', retryable: false }; }
  const finishReason = modelCase === 'missing-finish' ? null : modelCase === 'unknown-finish' ? 'future_unknown_reason' : finishFor(protocol, modelCase === 'truncated' ? 'truncated' : modelCase === 'refusal' ? 'refusal' : toolCase ? 'tools' : 'answer');
  const terminalRaw = modelCase === 'http200-error' ? { httpStatus: 200, error: { code: 'fixture_provider_error' } }
    : modelCase === 'missing-finish' ? { fixtureSocketClosed: true, terminalMarker: false }
      : protocol === 'openai-chat' ? { choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage: usageMissing ? null : rawUsage }
        : protocol === 'openai-responses' ? { type: status === 'failed' ? 'response.failed' : status === 'incomplete' ? 'response.incomplete' : 'response.completed', response: { id: `response:${attemptId}:fixture`, status: status === 'complete' ? 'completed' : status, incomplete_details: status === 'incomplete' ? { reason: finishReason } : null, usage: usageMissing ? null : rawUsage } }
          : protocol === 'anthropic-messages' ? { events: [{ type: 'message_delta', delta: { stop_reason: finishReason }, usage: usageMissing ? null : rawUsage }, { type: 'message_stop' }] }
            : { candidates: [{ index: 0, finishReason }], usageMetadata: usageMissing ? null : rawUsage };
  emit({ type: 'terminal', status, finishReason, marker: modelCase !== 'missing-finish', ...(kind ? { kind } : {}), ...(failure ? { failure } : {}),
    ...(!usageMissing && modelCase !== 'usage-partial' ? { usage: rawUsage, usageComplete: true } : {}),
    continuationHint: responseKind === 'continuation', responseId: `response:${attemptId}:fixture`,
    continuation: protocol === 'gemini-generate-content' ? [{ artifactRef: `opaque:${attemptId}:signature-fixture`, agentId: options.encodeInput?.agentId ?? agentId, accountId: encodedRequest.binding.accountId, protocol, bindingRevision: encodedRequest.binding.bindingRevision, historyRevision: options.encodeInput?.historyRevision ?? 1, required: true, position: 0 }] : [] },
    terminalRaw);
  const final = events.reduce(applyModelFixtureEvent, createModelFixtureState(attemptId, protocol));
  return { binding: encodedRequest.binding, encodedRequest, events, outcome: final.outcome!, readinessWait: false, reprepare: false };
}
type ModelEventPayload = ModelFixtureEvent extends infer E ? E extends ModelFixtureEvent ? Omit<E, keyof EventIdentity> : never : never;

export function cancelModelFixtureEvent(state: ModelFixtureState, reason = 'stop_requested'): ModelFixtureEvent {
  return { type: 'cancel', attemptId: state.attemptId, sequence: state.lastSequence + 1, reason, rawEvent: { fixtureLocalAbort: true, remoteStatus: 'unknown' } };
}
