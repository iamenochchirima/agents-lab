import { choice, count, executionEdges, fixed, flag, list, nullable, object, output, replaceField, sample, text, union, type Json, type ContractDefinition, type Payload } from './schema';
import { toolsResourceResume, toolsPromptResume } from './toolsContextAcquisition';
import { modelInvocationIntent, modelAbortRequested, modelPrelaunchCancellation, modelReadinessCancelled, modelCredentialReadinessRequest, modelReadinessResume, modelSettlementResume, modelOutcome, modelMetadataReadinessCancelled, modelMetadataCredentialReadinessRequest, modelMetadataReadinessResume, modelField } from './modelRecords';
import { normalizedModelFixtures } from './modelInterface';
import { contextPreparation, contextSnapshot } from './contextAssembly';
import { authority, control, jsonValue, limits, outputRecord, promptAnswer, released, terminal, toolCall as call, toolResult as result, turn, turnState as state, uncertainty } from './shared';

// Tool payloads are governed by each tool's schema. The calculator is an example,
// not the type of every operation the execution coordinator can carry.
const json = jsonValue({ result: 4 });
const round = object({ roundId: text('round-001'), index: count(1) });
const attempt = object({ attemptId: text('attempt-001'), index: count(1) });
const candidate = object({ text: text('4'), inputId: text('input-001'), destinationRef: text('input-001:origin') });
const failure = object({ stage: choice(['prepare', 'model', 'tools', 'settlement']), code: text('provider_timeout'), message: text('The provider attempt timed out.'), retryable: flag(true), certainty: choice(['known', 'unknown']) });
const intent = object({ state, round, nextAction: choice(['continue', 'finish']), candidate: nullable(candidate) });
const failed = object({ turn, outcome: fixed('failed'), reason: text('fatal_tool_failure'), requiredWorkResolved: flag(true) });
const exhausted = object({ turn, outcome: fixed('exhausted'), reason: text('round_limit_reached'), requiredWorkResolved: flag(true) });
const noncompletion = object({ turn, outcome: choice(['failed', 'cancelled', 'exhausted']), reason: text('irrecoverable_failure'), requiredWorkResolved: flag(true) });
const failedEnd = object({ state, round: nullable(round), terminal: noncompletion, candidate: sample(nullable(candidate), null) });
const exhaustedEnd = sample(failedEnd, { ...failedEnd.example as object, terminal: { ...noncompletion.example as object, outcome: 'exhausted', reason: 'retry_budget_exhausted' } });
const releaseTerminal = object({ turn, outcome: choice(['completed', 'failed', 'cancelled', 'exhausted']), reason: text('answer_complete'), requiredWorkResolved: fixed(true) });
const unresolvedTerminal = object({ turn, outcome: choice(['completed', 'failed', 'cancelled', 'exhausted']), reason: text('required_work_unresolved'), requiredWorkResolved: fixed(false) });
const batch = object({ batchId: text('batch-001'), calls: list(call, [call.example], 1) });
const fatalResult = object({ callId: text('call-001'), outcome: fixed('error'), code: text('nonretryable_tool_failure'), message: text('The operation cannot continue.'), correctable: fixed(false) });
const requestMessage = union(object({ role: fixed('user'), content: text('What is 2 + 2?') }), object({ role: fixed('assistant'), toolCalls: list(call, [call.example], 1) }), object({ role: fixed('tool'), callId: text('call-001'), result }));
const modelRequest = object({ contextSnapshot, requestId: text('request-001'), contextRef: text('context:turn-001:round-001:r0'), model: text('configured-model'), messages: list(requestMessage, [{ role: 'user', content: 'What is 2 + 2?' }], 1), tools: list(object({ name: text('calculator'), argumentsSchemaRef: text('tool-schema:calculator:v1') })) });
const response = object({ responseId: text('response-001'), status: choice(['complete', 'truncated', 'malformed']), text: nullable(text('4')), toolCalls: list(call, []), continuationRequested: flag(false), providerPayload: json });
const local = (fields: Record<string, Payload>) => object({ authority, ...fields });
const nodeId = (id: string) => `lina-execution-${id}`;
const edges = executionEdges;

const nullCandidate = sample(nullable(candidate), null);
const observedLimits = sample(limits, { roundsStarted: 1, maxRounds: 3, attempts: 1, retriesRemaining: 1 });
const observedState = replaceField(state, 'limits', observedLimits);
const exhaustedLimits = replaceField(replaceField(limits, 'maxRounds', fixed(3)), 'roundsStarted', { schema: { type: 'integer', minimum: 3 }, example: 3 });
const exhaustedState = replaceField(observedState, 'limits', exhaustedLimits);
const retryState = replaceField(observedState, 'limits', sample(limits, { roundsStarted: 1, maxRounds: 3, attempts: 1, retriesRemaining: 0 }));
const contextRefreshState = replaceField(state, 'limits', sample(limits, { roundsStarted: 0, maxRounds: 3, attempts: 0, retriesRemaining: 0 }));
const correctableResult = object({ callId: text('call-001'), outcome: fixed('error'), code: text('invalid_expression'), message: text('Supply a valid arithmetic expression.'), correctable: fixed(true) });
const deniedResult = object({ callId: text('call-001'), outcome: fixed('denied'), code: text('approval_denied'), message: text('The approver denied this operation.'), correctable: fixed(false) });
const skippedResult = object({ callId: text('call-001'), outcome: fixed('skipped'), code: text('batch_stopped_before_launch'), message: text('This call did not start.'), correctable: fixed(false) });
const cancelledResult = object({ callId: text('call-001'), outcome: fixed('cancelled'), code: text('operation_cancelled'), message: text('The operation reports cancellation with a known outcome.'), correctable: fixed(false) });
const successResult = object({ callId: text('call-001'), outcome: fixed('success'), value: jsonValue(4) });
const replacementCall = replaceField(call, 'callId', text('call-002'));
const replacementSuccess = replaceField(successResult, 'callId', text('call-002'));
const stateWithResults = (outcomes: Payload[]) => replaceField(observedState, 'results', list(result, outcomes.map(outcome => outcome.example), 1));
const knownOutcomes = (outcomes: Payload[]) => object({ state: stateWithResults(outcomes), round, batchId: text('batch-001'), results: list(result, outcomes.map(outcome => outcome.example), 1) });
const terminalReason = (outcome: 'completed' | 'failed' | 'cancelled' | 'exhausted', reason: string) => object({ turn, outcome: fixed(outcome), reason: text(reason), requiredWorkResolved: flag(true) });
const terminalRequest = (outcome: 'completed' | 'failed' | 'cancelled' | 'exhausted', reason: string, currentState = observedState) => object({ state: currentState, round: nullable(round), terminal: terminalReason(outcome, reason), candidate: outcome === 'completed' ? nullable(candidate) : nullCandidate });
const completeResponse = replaceField(response, 'status', fixed('complete'));
const answerResponse = replaceField(replaceField(completeResponse, 'toolCalls', fixed([])), 'continuationRequested', fixed(false));
const toolsResponse = replaceField(replaceField(replaceField(completeResponse, 'text', sample(nullable(text('4')), null)), 'toolCalls', list(call, [call.example], 1)), 'continuationRequested', fixed(false));
const continuationResponse = replaceField(replaceField(completeResponse, 'toolCalls', fixed([])), 'continuationRequested', fixed(true));
const truncatedResponse = replaceField(replaceField(replaceField(response, 'status', fixed('truncated')), 'toolCalls', fixed([])), 'providerPayload', jsonValue({ toolCallFragments: [{ callId: 'call-001', name: 'calculator', argumentsFragment: '{"expression":' }] }));
const observedResponse = (value: Payload) => object({ state: observedState, round, attempt, response: value });
const providerFailure = replaceField(replaceField(replaceField(failure, 'stage', fixed('model')), 'retryable', fixed(true)), 'certainty', fixed('known'));
const abortedFailure = replaceField(replaceField(replaceField(replaceField(failure, 'stage', fixed('model')), 'retryable', fixed(false)), 'certainty', fixed('known')), 'code', text('provider_aborted'));
const fatalProviderFailure = replaceField(replaceField(replaceField(replaceField(failure, 'stage', fixed('model')), 'retryable', fixed(false)), 'certainty', fixed('known')), 'code', text('invalid_model_configuration'));
const secondRound = replaceField(replaceField(round, 'roundId', text('round-002')), 'index', count(2));
const thirdRound = replaceField(replaceField(round, 'roundId', text('round-003')), 'index', count(3));
const secondAttempt = replaceField(replaceField(attempt, 'attemptId', text('attempt-002')), 'index', count(2));
const thirdAttempt = replaceField(replaceField(attempt, 'attemptId', text('attempt-003')), 'index', count(3));
const successState = stateWithResults([successResult]);
const correctableState = stateWithResults([correctableResult]);
const replacementState = replaceField(stateWithResults([correctableResult, replacementSuccess]), 'limits', sample(limits, { roundsStarted: 2, maxRounds: 3, attempts: 2, retriesRemaining: 1 }));
const afterLaunch = (value: Payload, roundsStarted: number, attempts: number) => replaceField(value, 'limits', sample(limits, { roundsStarted, maxRounds: 3, attempts, retriesRemaining: 1 }));
const continuedRequest = (id: string, contextId: string, outcomes: Payload[]) => replaceField(replaceField(replaceField(modelRequest, 'requestId', text(id)), 'contextRef', text(contextId)), 'messages', list(requestMessage, [{ role: 'user', content: 'What is 2 + 2?' }, ...outcomes.flatMap((value): Json[] => [{ role: 'assistant', toolCalls: [{ ...call.example as object, callId: (value.example as { callId: string }).callId }] }, { role: 'tool', callId: (value.example as { callId: string }).callId, result: value.example }])], 1));
const secondSuccessRequest = continuedRequest('request-002', 'context:turn-001:round-002', [successResult]);
const secondErrorRequest = continuedRequest('request-002', 'context:turn-001:round-002', [correctableResult]);
const thirdReplacementRequest = continuedRequest('request-003', 'context:turn-001:round-003', [correctableResult, replacementSuccess]);
const correctionResponse = replaceField(toolsResponse, 'toolCalls', list(call, [replacementCall.example], 1));
const permissionForRound = (value: Payload, nextRound: Payload) => object({ state: value, round: nextRound, permission: fixed('new-round'), authority });
const requestReady = (value: Payload, currentRound: Payload, request: Payload) => {
  const roundId = (currentRound.example as { roundId: string }).roundId;
  const retained = (request.example as Record<string, Json>).messages as Json[];
  const selected = retained.map((record, index) => {
    const message = record as Record<string, Json>;
    if (message.role === 'user') return { recordId: 'input-001', role: 'user', content: message.content, sourceRef: 'input-001', protected: true } as Json;
    if (message.role === 'assistant') return { recordId: `assistant-${index}`, role: 'assistant', calls: message.toolCalls, sourceRef: `history:assistant-${index}`, protected: true } as Json;
    return { recordId: `result-${index}`, role: 'tool', callId: message.callId, result: message.result, sourceRef: `${message.callId}:result`, artifactRef: null, protected: true } as Json;
  });
  const snapshot = replaceField(replaceField(replaceField(contextSnapshot, 'contextSnapshotRef', text(`context:turn-001:${roundId}:r0`)), 'identities', replaceField({ schema: contextSnapshot.schema.properties!.identities, example: (contextSnapshot.example as Record<string, Json>).identities }, 'roundId', text(roundId))), 'modelContext', replaceField({ schema: contextSnapshot.schema.properties!.modelContext, example: (contextSnapshot.example as Record<string, Json>).modelContext }, 'messages', { schema: contextSnapshot.schema.properties!.modelContext.properties!.messages, example: selected }));
  return object({ state: value, round: currentRound, modelRequest: replaceField(replaceField(request, 'contextSnapshot', snapshot), 'contextRef', text(`context:turn-001:${roundId}:r0`)), launchPermission: fixed('allowed') });
};
const continuation = (value: Payload, previousRound: Payload) => object({ state: value, previousRound, nextAction: fixed('request-next-round'), consumedControlIds: list(text('control-001'), []) });

/** Proposed contracts for diagram inspection. Examples are synthetic and do not
 * prove runtime validation, durability, execution or policy agreement. Incoming
 * graph payloads are assembled centrally from these labelled output variants.
 */
export const turnExecutionContracts: ContractDefinition[] = [
  {
    nodeId: nodeId('start'),
    context: local({ defaultLimits: limits, initialStateRef: text('execution-state:turn-001'), ownershipStatus: choice(['held', 'lost']) }),
    contextSource: 'Conversation admission supplies the turn and authority. Execution configuration supplies limits; the execution-state owner supplies its current ownership record.',
    reads: ['Admitted turn, ordered inputs and origin destination', 'Current authority/fence and configured execution limits'],
    writes: ['Initial execution state keyed by the admitted turn ID', 'Initial counters and empty tool-result/control collections'],
    rules: ['Consume the admitted identity and ownership; do not create another turn or reacquire admission.', 'Start is for fresh admitted work. Safe restart checkpoints use the separate unresolved recovery entry.', 'References preserve original inputs and authority; initialization does not execute a model or tool.'],
    outputs: [output('execution.initialized', 'Initialized turn', object({ state, nextAction: fixed('request-first-round') }), edges('start-limits'), 'The admitted turn is initialized under its existing authority.')],
  },
  {
    nodeId: nodeId('limits'),
    context: local({ configuredLimits: limits, stopRequested: flag(false), ownerCurrent: flag(true) }),
    contextSource: 'Execution configuration and current owner/control records. Incoming execution state contains the logical-round counters.',
    reads: ['Requested next logical round and launched round count', 'Configured maximum rounds, stop intent and current authority'],
    writes: ['Candidate identity/permission for one next logical round', 'Exhausted terminal reason when another round is unavailable'],
    rules: ['Permit a new logical round only while roundsStarted is below maxRounds.', 'The gate grants permission without incrementing roundsStarted. Model launch counts the new logical round once. A provider retry retains that round ID and bypasses this new-round gate.', 'Forward retained tool results, attempt counters and consumed retry allowance unchanged. New round permission is not execution-state initialization.', 'The exhausted example fixes maxRounds to 3 and constrains roundsStarted to at least 3. Other configurations use the same comparison rule, not a universal limit of 3.', 'Exhaustion prevents preparation of another logical round and goes to settlement.', 'Stop/ownership changes must prevent launch; their precise routing and fencing implementation remain proposed.'],
    outputs: [
      output('execution.round-permitted', 'New logical round permitted', object({ state, round, permission: fixed('new-round'), authority }), edges('limits-prepare'), 'The round budget permits another logical round and launch authority is current.'),
      output('execution.round-permitted-after-tool-success', 'Second round after tool success', permissionForRound(successState, secondRound), edges('limits-prepare'), 'Round-001 launched once and its call-001 success remains in results. Grant round-002 without changing counters.'),
      output('execution.round-permitted-after-tool-error', 'Second round after correctable error', permissionForRound(correctableState, secondRound), edges('limits-prepare'), 'Round-001 launched once. Retain call-001 error while granting round-002 for a model correction decision.'),
      output('execution.round-permitted-after-replacement', 'Third round after replacement success', permissionForRound(replacementState, thirdRound), edges('limits-prepare'), 'Two logical rounds launched. Retain both call-001 error and call-002 success while granting round-003.'),
      output('execution.round-exhausted', 'Round limit exhausted', object({ state: exhaustedState, round: nullable(round), terminal: exhausted, candidate: nullCandidate }), edges('limits-terminal'), 'The launched round count has reached maxRounds. No new model attempt is launched.'),
    ],
  },
  {
    nodeId: nodeId('prepare'),
    context: local({ contextService: object({ strategyId: text('context-policy-demo'), snapshotRef: sample(nullable(text('context:turn-001:round-001:r0')), null), snapshotValidForRound: flag(false) }), modelConfigurationRef: text('model-config:demo'), toolCatalogRef: text('tool-catalog:demo'), launchAllowed: flag(true), stopRequested: flag(false) }),
    contextSource: 'Coordinator dependencies include Context snapshot availability and Model/Tools configuration. modelContext is a separate model-visible projection. Execution ownership and control state are rechecked locally.',
    reads: ['Turn inputs, retained tool results and accepted guidance', 'Current round identity and context/model/tool configuration', 'Launch authority after context preparation'],
    writes: ['Prepared model-request reference for the existing round', 'Classified preparation failure or pending-control intent'],
    rules: ['Request Context when no valid snapshot exists. A context.ready return does not recursively request Context; bind the returned immutable snapshot, then recheck launch authority.', 'Context and Memory own retrieval/assembly internals. Preserve original references alongside derived context.', 'Copy incoming counters and retained results without resetting them; preparation changes context/request fields only.', 'Provider retry keeps the incoming logical round and retained results; preparation does not count another round or restore consumed retry allowance.', 'Recheck authority and stop intent before the model handoff.', 'Recoverable context pressure can request refresh; fatal preparation failure goes to settlement.'],
    outputs: [
      output('execution.context-requested', 'Prepare context for this round', contextPreparation, ['lina-context-edge-prepare-scope'], 'No valid snapshot exists for this agent/turn/round/source revision. Request Context without launching a model or changing counters.'),
      output('execution.context-requested-after-tool-success', 'Prepare next-round context with retained tool results', replaceField(replaceField(replaceField(replaceField(contextPreparation, 'state', successState), 'round', secondRound), 'identities', replaceField({ schema: contextPreparation.schema.properties!.identities, example: (contextPreparation.example as Record<string, Json>).identities }, 'roundId', text('round-002'))), 'toolResultRefs', list(text('call-001:result'), ['call-001:result'])), ['lina-context-edge-prepare-scope'], 'New round context receives existing counters and canonical tool-result refs; Context never initializes the execution state.'),
      output('execution.model-request-ready', 'Prepared model request', object({ state, round, modelRequest, launchPermission: fixed('allowed') }), edges('prepare-model'), 'A valid context.ready snapshot for this exact round has returned (or a retry reuses it); the current owner may launch a provider attempt.'),
      output('execution.model-request-after-tool-success', 'Prepared second round with tool success', requestReady(successState, secondRound, secondSuccessRequest), edges('prepare-model'), 'Retain roundsStarted=1, attempts=1 and call-001 success; request round-002 context containing that result.'),
      output('execution.model-request-after-tool-error', 'Prepared second round with tool error', requestReady(correctableState, secondRound, secondErrorRequest), edges('prepare-model'), 'Retain roundsStarted=1, attempts=1 and call-001 error; request round-002 context containing that error.'),
      output('execution.model-request-after-replacement', 'Prepared third round with both tool results', requestReady(replacementState, thirdRound, thirdReplacementRequest), edges('prepare-model'), 'Retain roundsStarted=2, attempts=2 and both historical call outcomes; request round-003 context.'),
      output('execution.model-request-provider-retry', 'Prepared retry of the same round', requestReady(retryState, round, replaceField(modelRequest, 'requestId', text('request-001-retry'))), edges('prepare-model'), 'Retain round-001, roundsStarted=1, attempts=1 and retriesRemaining=0. The next provider launch is attempt-002.'),
      output('execution.preparation-controls', 'Controls before launch', intent, edges('prepare-controls'), 'Pending guidance or stop intent requires checkpoint handling before launch.'),
      output('execution.context-recovery', 'Context refresh requested', object({ state, round, attempt: sample(nullable(attempt), null), failure: object({ stage: fixed('prepare'), code: text('context_overflow'), message: text('Prepared context exceeds the model limit.'), retryable: fixed(true), certainty: fixed('known') }), requestedRecovery: fixed('context-refresh') }), edges('prepare-recover'), 'Preparation reports recoverable context pressure before a provider attempt launches.'),
      output('execution.preparation-terminal', 'Terminal preparation failure', failedEnd, edges('prepare-terminal'), 'Preparation is irrecoverable or its applicable budget/authority prevents further work.'),
    ],
  },
  {
    nodeId: nodeId('model'),
    context: local({ providerConfigurationRef: text('provider-config:demo'), attemptPolicy: object({ timeoutMs: count(30000), streaming: flag(true) }), launchAllowed: flag(true), abortRequested: flag(false) }),
    contextSource: 'Model component configuration and provider observation; execution ownership and cancellation state at the launch boundary.',
    reads: ['Prepared request and logical round ID', 'Current launch authority, provider configuration and attempt budget'],
    writes: ['One provider attempt identity and observed outcome', 'Provider response/failure evidence, without claiming logical-turn completion'],
    rules: ['Count a logical round when its first model attempt launches, and increment provider-attempt accounting at each attempt launch. A retry increments attempts only.', 'Preserve turn ID and round ID on complete, truncated, malformed, failed and aborted outcomes.', 'Incomplete tool arguments stay in raw fragments and cannot appear as launchable calls. Tool-specific validation remains owned by Tools.', 'An observation timeout or cancellation request does not prove remote work stopped.'],
    outputs: [
      output('execution.model-answer', 'Complete answer response', observedResponse(answerResponse), edges('model-decide'), 'The model returns a complete answer without tools or explicit continuation.'),
      output('execution.model-answer-after-tool-success', 'Second-round answer retains tool success', object({ state: afterLaunch(successState, 2, 2), round: secondRound, attempt: secondAttempt, response: replaceField(answerResponse, 'responseId', text('response-002')) }), edges('model-decide'), 'Round-002 launches and returns an answer with roundsStarted=2, attempts=2 and call-001 success preserved.'),
      output('execution.model-correction-after-tool-error', 'Second-round correction retains tool error', object({ state: afterLaunch(correctableState, 2, 2), round: secondRound, attempt: secondAttempt, response: replaceField(correctionResponse, 'responseId', text('response-002')) }), edges('model-decide'), 'Round-002 observes call-001 error and requests new call-002; counters advance to two rounds/two attempts and history remains intact.'),
      output('execution.model-answer-after-replacement', 'Third-round answer retains error and replacement success', object({ state: afterLaunch(replacementState, 3, 3), round: thirdRound, attempt: thirdAttempt, response: replaceField(answerResponse, 'responseId', text('response-003')) }), edges('model-decide'), 'Round-003 returns an answer after call-002 success, preserving both call outcomes and recording three rounds/three attempts.'),
      output('execution.model-answer-after-provider-retry', 'Retried answer within original round', object({ state: replaceField(retryState, 'limits', sample(limits, { roundsStarted: 1, maxRounds: 3, attempts: 2, retriesRemaining: 0 })), round, attempt: secondAttempt, response: replaceField(answerResponse, 'responseId', text('response-001-retry')) }), edges('model-decide'), 'Provider attempt-002 succeeds in round-001. Logical rounds remain one; attempts become two and consumed retry allowance stays zero.'),
      output('execution.model-tool-calls', 'Complete tool-call response', observedResponse(toolsResponse), edges('model-decide'), 'The model returns complete tool-call argument objects for Tools validation.'),
      output('execution.model-continuation', 'Explicit continuation response', observedResponse(continuationResponse), edges('model-decide'), 'The complete response requests another logical round without tool work.'),
      output('execution.model-truncated', 'Truncated response with incomplete call', observedResponse(truncatedResponse), edges('model-decide'), 'The provider returns a truncated response. Incomplete call fragments remain unlaunchable raw evidence.'),
      output('execution.model-malformed', 'Malformed response', observedResponse(replaceField(replaceField(response, 'status', fixed('malformed')), 'toolCalls', fixed([]))), edges('model-decide'), 'The provider response cannot be interpreted safely and needs a repair/terminal decision.'),
      output('execution.model-retryable-failure', 'Known retryable attempt failure', object({ state: observedState, round, attempt, status: fixed('failed'), failure: providerFailure }), edges('model-decide'), 'The provider reports a known retryable attempt failure.'),
      output('execution.model-aborted', 'Observed aborted attempt', object({ state: observedState, round, attempt, status: fixed('aborted'), failure: abortedFailure }), edges('model-decide'), 'The attempt is observed aborted. Required work still goes through settlement.'),
      output('execution.model-nonretryable-failure', 'Nonretryable provider failure', object({ state: observedState, round, attempt, status: fixed('failed'), failure: fatalProviderFailure }), edges('model-decide'), 'A known nonretryable provider failure requires failed settlement.'),
    ],
  },
  {
    nodeId: nodeId('decide'),
    context: local({ continuationPolicyRef: text('continuation-policy:demo'), terminationPolicyRef: text('termination-policy:demo'), responseValidation: object({ toolArgumentsComplete: flag(true), responseUsable: flag(true) }) }),
    contextSource: 'Execution continuation/termination policy and Model response interpretation. Tools owns tool-specific schema and permission validation.',
    reads: ['Response or failure with original turn/round/attempt identities', 'Continuation gates and applicable recovery budgets'],
    writes: ['Next action and candidate answer, tool batch, recovery request or terminal reason'],
    rules: ['A candidate answer still passes controls and settlement.', 'Never dispatch incomplete or invalid tool arguments from a truncated/malformed response.', 'Explicit continuation may open another round without tools.', 'Only classified retryable failures enter recovery; fatal failures, aborts or exhaustion settle with their explicit reason.'],
    outputs: [
      output('execution.tool-batch-requested', 'Requested tool batch', object({ state: observedState, round, batch }), edges('decide-tools'), 'Complete tool calls are present and their next step is Tools admission.'),
      output('execution.replacement-tool-requested', 'New call after correctable error', object({ state: replaceField(stateWithResults([correctableResult]), 'limits', sample(limits, { roundsStarted: 2, maxRounds: 3, attempts: 2, retriesRemaining: 1 })), round: replaceField(replaceField(round, 'roundId', text('round-002')), 'index', count(2)), batch: replaceField(replaceField(batch, 'batchId', text('batch-002')), 'calls', list(call, [replacementCall.example], 1)) }), edges('decide-tools'), 'The model chooses a corrected replacement operation with a new call ID after observing call-001 failure.'),
      output('execution.answer-candidate', 'Candidate answer', object({ state, round, nextAction: fixed('finish'), candidate }), edges('decide-answer'), 'The response supplies a candidate final answer and no continuation is required.'),
      output('execution.explicit-continuation', 'Continue without tools', object({ state, round, nextAction: fixed('continue'), candidate: nullable(candidate) }), edges('decide-continue'), 'The response or continuation policy requests another logical round without tool work.'),
      output('execution.response-recovery', 'Recoverable provider failure', object({ state: observedState, round, attempt, failure: providerFailure, requestedRecovery: fixed('provider-retry') }), edges('decide-recover'), 'A classified provider failure can safely request bounded retry of the existing round.'),
      output('execution.response-terminal', 'Nonretryable model failure', terminalRequest('failed', 'nonretryable_provider_failure'), edges('decide-terminal'), 'The classified response/failure is nonretryable.'),
      output('execution.response-cancelled', 'Aborted model outcome', terminalRequest('cancelled', 'provider_aborted'), edges('decide-terminal'), 'The model attempt is observed aborted and execution needs cancellation settlement.'),
    ],
  },
  {
    nodeId: nodeId('tools'),
    context: local({ toolCatalogRef: text('tool-catalog:demo'), schedulingPolicy: choice(['sequential', 'parallel', 'mixed']), resultOrderPolicy: choice(['call-order', 'completion-order']), launchAllowed: flag(true), persistencePolicyRef: text('tool-intent-policy:demo'), pendingWaits: list(object({ promptId: text('prompt-001'), callId: text('call-001'), turnId: text('turn-001'), status: choice(['waiting', 'resolved', 'expired']) }), []) }),
    contextSource: 'Tools supplies validation, permission/approval, dispatch and outcomes. Execution state supplies ownership, cancellation, intent recording and wait correlations.',
    reads: ['Requested calls and their arbitrary tool-defined argument objects', 'Tool schema/permissions, call launch authority and scheduling policy', 'Pending prompt answers matched by turn/call/prompt identity'],
    writes: ['Call-intent and per-call outcomes paired by call ID', 'Pending-wait identity or uncertain-effect evidence when an outcome is unavailable'],
    rules: ['Required design baseline: execute independent eligible calls concurrently within configured limits; serialize dependent or conflicting operations. Sequential-only scheduling remains a comparison mode. Detailed design playback illustrates overlapping eligible calls; it does not measure real adapter concurrency.', 'Use the same versioned registered tool definitions exposed by Context; model-visible selection does not grant execution permission.', 'Validate each call against its own registered schema and permissions before dispatch.', 'Recheck stop/launch permission before each new operation; unstarted calls receive explicit skipped outcomes.', 'Wait for required started work to settle before the next model round; preserve every call/result identity regardless of completion order. Partial updates are not settled results.', 'Known failures do not imply uncertainty. Unknown external effects go to reconciliation without automatic replay.', 'Waiting approval retains the owning call and prompt. No new wait path is invented in this graph slice; answers target owning work through the existing coordinator boundary.'],
    outputs: [
      output('tools.batch-delegated', 'Delegate a tool batch to Tools', object({ state: observedState, round, batch }), ['lina-tools-edge-execution-resolve'], 'The coordinator hands requested calls to the detailed Tools design. Catalogue and binding resolution belong to Tools; ownership and launched-round counters remain unchanged.'),
      output('tools.batch-delegated-parallel', 'Delegate independent calls in the same batch', object({ state: observedState, round, batch: replaceField(batch, 'calls', list(call, [call.example, { ...call.example as object, callId: 'call-002', arguments: { expression: '3 + 3' } }], 1)) }), ['lina-tools-edge-execution-resolve'], 'Two calculator reads are requested in one model round. Tools must establish parallel eligibility and capacity before launching; this example does not perform concurrent execution.'),
      output('execution.tool-batch-success', 'Known tool success', knownOutcomes([successResult]), [], 'The call succeeded with a known returned value.'),
      output('execution.tool-batch-correctable-error', 'Known correctable tool error', knownOutcomes([correctableResult]), [], 'The call failed with a known error that the model can address in a new call.'),
      output('execution.tool-batch-denied', 'Known denied tool call', knownOutcomes([deniedResult]), [], 'Permission or approval denied the operation; it did not execute.'),
      output('execution.tool-batch-skipped', 'Known skipped tool call', knownOutcomes([skippedResult]), [], 'A stop or batch policy prevented this call from starting.'),
      output('execution.tool-batch-cancelled', 'Known cancelled tool call', knownOutcomes([cancelledResult]), [], 'Started work reports a known cancellation result. Unknown effects use reconciliation instead.'),
      output('execution.tool-batch-fatal-error', 'Known fatal tool error', knownOutcomes([fatalResult]), [], 'The tool returned a known nonretryable failure for outcome classification.'),
      output('execution.tool-batch-replacement-success', 'Replacement call succeeded', object({ state: replaceField(stateWithResults([correctableResult, replacementSuccess]), 'limits', sample(limits, { roundsStarted: 2, maxRounds: 3, attempts: 2, retriesRemaining: 1 })), round: replaceField(replaceField(round, 'roundId', text('round-002')), 'index', count(2)), batchId: text('batch-002'), results: list(result, [replacementSuccess.example], 1) }), [], 'A separately authorized new call-002 succeeds after the model observed call-001 error. Both historical results are retained.'),
      output('execution.tool-controller-terminal', 'Fatal controller failure', object({ state: observedState, round, batchId: text('batch-001'), terminal: failed, results: list(result, []), candidate: nullCandidate }), edges('tools-terminal'), 'Controller/admission failure is terminal after required started work is accounted for.'),
      output('execution.tool-controller-stopped', 'Stopped tool batch', object({ state: stateWithResults([skippedResult]), round, batchId: text('batch-001'), terminal: terminalReason('cancelled', 'tool_batch_stopped'), results: list(result, [skippedResult.example], 1), candidate: nullCandidate }), edges('tools-terminal'), 'A stop prevents further launches and known outcomes for required started work have been accounted for.'),
      output('execution.tool-effect-uncertain', 'Uncertain external effect', object({ state: observedState, round, batchId: text('batch-001'), uncertainty, pendingCallIds: list(text('call-001'), ['call-001'], 1) }), edges('tools-uncertain'), 'An external operation lacks a known outcome. Retain fenced authority and reconcile instead of retrying it blindly.'),
      output('execution.tool-wait-retained', 'Pending approval or external wait', object({ state: observedState, round, batchId: text('batch-001'), callId: text('call-001'), promptId: text('prompt-001'), status: fixed('waiting'), waitKind: choice(['approval', 'external-input']), authorityRetained: fixed(true) }), [], 'The owning call is waiting locally. No continuation or settlement is emitted until matched resolution. Wait registration is a side notification; no fresh call or model round starts.'),
    ],
  },
  {
    nodeId: nodeId('tool-outcomes'),
    context: local({ errorClassificationPolicyRef: text('tool-error-policy:demo'), knownCallIds: list(text('call-001'), ['call-001'], 1) }),
    contextSource: 'Tools outcome records and the proposed execution error-classification policy.',
    reads: ['Known per-call results and their requested call IDs', 'Correctable versus fatal/nonretryable failure classification'],
    writes: ['Retained model-visible results or a failed terminal reason'],
    rules: ['Pair every outcome with its original call ID; a replacement call gets a new ID.', 'Success and correctable error results can inform the next model round through controls and the round-limit gate.', 'Correctable errors do not themselves authorize retrying the original side effect.', 'Fatal/nonretryable outcomes settle failed. Uncertain effects never enter this known-result branch.'],
    outputs: [
      output('execution.tool-results-success', 'Success retained for next round', object({ state: stateWithResults([successResult]), round, batchId: text('batch-001'), results: list(result, [successResult.example], 1), nextAction: fixed('continue'), candidate: nullCandidate }), edges('outcomes-controls'), 'Known success results are retained for model consumption.'),
      output('execution.tool-results-correctable', 'Correctable error retained for next round', object({ state: stateWithResults([correctableResult]), round, batchId: text('batch-001'), results: list(result, [correctableResult.example], 1), nextAction: fixed('continue'), candidate: nullCandidate }), edges('outcomes-controls'), 'The model may choose a new corrective call, using a new call ID. The failed effect is not silently retried.'),
      output('execution.tool-results-replacement-success', 'Replacement success retains both historical results', object({ state: replacementState, round: secondRound, batchId: text('batch-002'), results: list(result, [replacementSuccess.example], 1), nextAction: fixed('continue'), candidate: nullCandidate }), edges('outcomes-controls'), 'The latest batch contains call-002 success; cumulative state retains call-001 error and call-002 success for the third round.'),
      output('execution.tool-results-fatal', 'Fatal tool outcome', object({ state: stateWithResults([fatalResult]), round, batchId: text('batch-001'), terminal: failed, results: list(result, [fatalResult.example], 1), candidate: sample(nullable(candidate), null) }), edges('outcomes-terminal'), 'Selected terminal-on-selected-error policy marks this known operation error terminal. Nonretryability alone is not a controller failure or default terminal decision.'),
      output('execution.tool-results-denied', 'Denial ends this execution policy', object({ state: stateWithResults([deniedResult]), round, batchId: text('batch-001'), terminal: terminalReason('failed', 'tool_approval_denied'), results: list(result, [deniedResult.example], 1), candidate: nullCandidate }), edges('outcomes-terminal'), 'Selected terminal-on-selected-error policy treats this denial as terminal. Default model-visible-known-errors policy instead retains it for model consumption.'),
      output('execution.tool-results-cancelled', 'Cancelled or skipped work settles cancelled', object({ state: stateWithResults([cancelledResult]), round, batchId: text('batch-001'), terminal: terminalReason('cancelled', 'tool_batch_cancelled'), results: list(result, [cancelledResult.example], 1), candidate: nullCandidate }), edges('outcomes-terminal'), 'Known cancellation after stop prevents further rounds. Required-work settlement still follows.'),
      output('execution.tool-results-skipped', 'Unstarted calls settle after stop', object({ state: stateWithResults([skippedResult]), round, batchId: text('batch-001'), terminal: terminalReason('cancelled', 'tool_batch_stopped'), results: list(result, [skippedResult.example], 1), candidate: nullCandidate }), edges('outcomes-terminal'), 'Known skipped work after stop is settled without starting another model round.'),
    ],
  },
  {
    nodeId: nodeId('controls'),
    context: local({ queuedControls: list(control, []), resolvedPromptAnswers: list(promptAnswer, []), checkpointPolicyRef: text('control-checkpoint-policy:demo'), owningWaits: list(object({ turnId: text('turn-001'), promptId: text('prompt-001'), operationId: text('call-001') }), []) }),
    contextSource: 'Input control/prompt-resolution handlers and the active execution owner. Local checkpoint policy decides how guidance and stop intent are consumed.',
    reads: ['Intended next action and candidate answer', 'Exact-turn controls, compatible authority and matched waiting answers', 'Started/required work that must settle after stop'],
    writes: ['Consumed guidance/control status and updated execution state', 'Preserved continuation intent or terminal completion/cancellation reason'],
    rules: ['Reject stale controls rather than applying them to a newer turn.', 'Consume steering at a supported boundary; cancellation may already have been signalled to active work before this checkpoint.', 'Matched answers route to Await external work without another turn. Guidance checkpoints do not resolve external work themselves.', 'Continue forwards incoming counters and retained results unchanged to the next-round gate. Finish/stop requests settlement; stop does not undo completed effects.'],
    outputs: [
      output('execution.controls-continue', 'Continue after checkpoint', continuation(observedState, round), edges('controls-continue'), 'The preserved next action requests another round after a model continuation. Counters remain one launched round/one attempt.'),
      output('execution.controls-continue-after-tool-success', 'Continue with retained tool success', continuation(successState, round), edges('controls-continue'), 'Forward round-001 counters and call-001 success unchanged to the round limit gate.'),
      output('execution.controls-continue-after-tool-error', 'Continue with retained correctable error', continuation(correctableState, round), edges('controls-continue'), 'Forward round-001 counters and call-001 error unchanged to the round limit gate.'),
      output('execution.controls-continue-after-replacement', 'Continue with error and replacement success', continuation(replacementState, secondRound), edges('controls-continue'), 'Forward round-002 counters and both call outcomes unchanged to the next-round gate.'),
      output('execution.controls-finish', 'Finish candidate answer', terminalRequest('completed', 'answer_complete'), edges('controls-finish'), 'The candidate completion remains final after checkpoint handling.'),
      output('execution.controls-stop', 'Stop existing turn', terminalRequest('cancelled', 'stop_requested'), edges('controls-finish'), 'An exact-turn Stop/Interrupt requests cancellation settlement, without implying prior effects were undone.'),
    ],
  },
  {
    nodeId: nodeId('recover'),
    context: local({ recoveryPolicy: object({ allowedStages: list(choice(['model', 'prepare']), ['model', 'prepare']), retriesRemaining: count(1), backoffMs: count(0) }), settledCallIds: list(text('call-001'), []), contextRefreshAvailable: flag(true) }),
    contextSource: 'Proposed recovery policy, retained execution evidence and the Context component refresh capability.',
    reads: ['Classified failure and requested recovery', 'Current logical round, prior attempts and remaining retry budget', 'Settled tool outcomes that must be preserved'],
    writes: ['Consumed attempt retry allowance or requested context refresh', 'Recovery decision and failure/exhaustion reason'],
    rules: ['Retry only known, classified recoverable failures within the applicable budget.', 'Retain turn ID and logical round ID. A provider retry creates another attempt, not another logical round.', 'Preserve settled tool results; never replay tools to recover a provider call.', 'Context refresh returns to preparation. Restart and uncertain side-effect recovery remain separate reconciliation boundaries.'],
    outputs: [
      output('execution.provider-retry-permitted', 'Retry provider within existing round', object({ state: retryState, round, previousAttempt: attempt, recoveryAction: fixed('provider-retry'), retainedCallIds: list(text('call-001'), []) }), edges('recover-prepare'), 'One retry allowance is consumed. Turn/round remain unchanged; the next model launch creates attempt-002 without another round.'),
      output('execution.context-refresh-permitted', 'Refresh context before model launch', object({ state: contextRefreshState, round, previousAttempt: sample(nullable(attempt), null), recoveryAction: fixed('context-refresh'), retainedCallIds: list(text('call-001'), []) }), edges('recover-prepare'), 'One applicable refresh allowance is consumed before a model attempt. Existing logical round identity and retained results remain intact.'),
      output('execution.recovery-terminal', 'Recovery unavailable or exhausted', exhaustedEnd, edges('recover-terminal'), 'Recovery is nonretryable, unavailable or has exhausted its applicable retry allowance.'),
    ],
  },
  {
    nodeId: nodeId('settle'),
    context: local({ persistencePolicyRef: text('turn-persistence-policy:demo'), requiredOperations: list(object({ operationId: text('call-001'), status: choice(['resolved', 'pending', 'uncertain']) }), []), outcomeStoreRef: text('outcome-store:demo'), outputStoreRef: text('output-store:demo') }),
    contextSource: 'Execution evidence, required-work owners and the configured outcome/output persistence boundary. Output owns transport delivery.',
    reads: ['Candidate answer or terminal reason and retained results', 'Required-work/cleanup/persistence outcomes and authority state', 'Origin destination retained from admitted input'],
    writes: ['Terminal outcome and any saved output record', 'Release-ready status or fenced unresolved-work evidence'],
    rules: ['Classify completed, failed, cancelled and exhausted reasons explicitly.', 'Withhold release while required work or uncertain effects remain unresolved under the selected settlement contract.', 'Produced output is a separate delivery handoff; output creation is not proof of successful user receipt.', 'Outcome durability and cleanup semantics remain proposed; a failed required write must not be silently labelled success.'],
    outputs: [
      output('execution.settled-release-ready', 'Completed turn ready for release', object({ state: observedState, terminal: replaceField(releaseTerminal, 'outcome', fixed('completed')), releaseReady: fixed(true), savedOutputIds: list(text('output-001'), ['output-001'], 1) }), edges('settle-release'), 'The completed outcome and answer output-001 are recorded according to the selected contract; required work is resolved.'),
      output('execution.settled-failed-release-ready', 'Failed turn ready for release', object({ state: stateWithResults([fatalResult]), terminal: replaceField(replaceField(releaseTerminal, 'outcome', fixed('failed')), 'reason', text('fatal_tool_failure')), releaseReady: fixed(true), savedOutputIds: list(text('output-001'), []) }), edges('settle-release'), 'The failed outcome is recorded and required work is resolved. Release retains failed status and does not imply an answer was produced.'),
      output('execution.settled-cancelled-release-ready', 'Cancelled turn ready for release', object({ state: observedState, terminal: replaceField(replaceField(releaseTerminal, 'outcome', fixed('cancelled')), 'reason', text('stop_requested')), releaseReady: fixed(true), savedOutputIds: list(text('output-001'), []) }), edges('settle-release'), 'Cancellation is settled with required started work resolved. Release retains cancelled status without undoing prior effects.'),
      output('execution.settled-exhausted-release-ready', 'Exhausted turn ready for release', object({ state: exhaustedState, terminal: replaceField(replaceField(releaseTerminal, 'outcome', fixed('exhausted')), 'reason', text('round_limit_reached')), releaseReady: fixed(true), savedOutputIds: list(text('output-001'), []) }), edges('settle-release'), 'The exhausted outcome is recorded and required work is resolved. No further round or answer production is implied.'),
      output('execution.output-produced', 'Produced answer for delivery', object({ turnId: text('turn-001'), output: replaceField(replaceField(outputRecord, 'category', fixed('answer')), 'saved', fixed(true)) }), edges('output'), 'A saved answer is available for separate delivery. This can accompany settlement without implying transport success.'),
      output('execution.failure-output-produced', 'Produced failure status for delivery', object({ turnId: text('turn-001'), output: replaceField(replaceField(replaceField(outputRecord, 'category', fixed('status')), 'saved', fixed(true)), 'text', text('The turn ended because its tool operation could not continue.')) }), edges('output'), 'A saved failure/cancellation/exhaustion status can be delivered without rerunning execution.'),
      output('execution.settlement-unresolved', 'Unresolved required work', object({ state, terminal: unresolvedTerminal, uncertainty, unresolvedOperationIds: list(text('call-001'), ['call-001'], 1), releaseReady: fixed(false) }), edges('settle-unresolved'), 'Required work or uncertain effects prevent release; retain or explicitly transfer fenced ownership to reconciliation.'),
    ],
  },
  {
    nodeId: nodeId('release'),
    context: local({ ownershipRecordRef: text('owner-record:conversation-demo'), releaseStatus: choice(['held', 'released']), queueServiceRef: text('conversation-queue:demo') }),
    contextSource: 'Conversation ownership service and the settlement release-ready evidence. Queue admission remains owned by the existing service.',
    reads: ['Release-ready terminal outcome and resolved required work', 'Current owner identity/fence and prior release record'],
    writes: ['Ownership release record', 'Correlated owner-release lifecycle event'],
    rules: ['Release only the matching current ownership identity/fence after settlement authorizes it.', 'Retain the terminal outcome in the lifecycle event; failure/exhaustion is not completion success.', 'The queue rechecks admission after release. Emitting this event does not execute queue draining.', 'Design playback illustrates terminal release. Actual safe-release persistence/idempotency semantics remain unimplemented.'],
    outputs: [
      output('execution.owner-released', 'Completed owner-release event', object({ release: replaceField(released, 'outcome', fixed('completed')), terminalBoundary: fixed(true) }), edges('owner-release'), 'Ownership is released for the settled completed turn. Preserve its turn/conversation IDs, owner and fence.'),
      output('execution.owner-released-failed', 'Failed owner-release event', object({ release: replaceField(released, 'outcome', fixed('failed')), terminalBoundary: fixed(true) }), edges('owner-release'), 'Ownership is released for the settled failed turn. Preserve its turn/conversation IDs, owner, fence and failed outcome.'),
      output('execution.owner-released-cancelled', 'Cancelled owner-release event', object({ release: replaceField(released, 'outcome', fixed('cancelled')), terminalBoundary: fixed(true) }), edges('owner-release'), 'Ownership is released for the settled cancelled turn. Preserve its turn/conversation IDs, owner, fence and cancelled outcome.'),
      output('execution.owner-released-exhausted', 'Exhausted owner-release event', object({ release: replaceField(released, 'outcome', fixed('exhausted')), terminalBoundary: fixed(true) }), edges('owner-release'), 'Ownership is released for the settled exhausted turn. Preserve its turn/conversation IDs, owner, fence and exhausted outcome.'),
    ],
  },
];

// Retained work is coordinator state, not a second adapter request. Each owner
// receives only its correlated continuation; pending sibling results survive.
const waitIdentity = object({ waitId: text('wait:approval:call-001'), waitKind: choice(['tool-approval', 'tool-input', 'connection-authorization', 'user-clarification']), owningNodeId: text('lina-tools-permissions'), batchId: text('batch-001'), callId: nullable(text('call-001')), attemptId: sample(nullable(text('adapter-attempt-001')), null), promptId: nullable(text('prompt-001')), authorizationFlowRef: sample(nullable(text('auth-flow:files-001')), null), connectionId: text('conn-files'), accountId: text('account-files-demo'), bindingGeneration: count(4), policyRevision: count(2), argumentsDigest: text('digest:files-read-001'), continuationRef: text('continuation:approval:call-001'), expiresAt: nullable(text('2026-10-08T10:05:00Z')) });
const siblingSuccess = replaceField(replaceField(successResult, 'callId', text('call-002')), 'value', jsonValue(6));
const retainedCalls = list(call, [{ ...call.example as object, name: 'files_read_file', arguments: { path: 'README.md' } }, { ...call.example as object, callId: 'call-002', arguments: { expression: '3 + 3' } }], 1);
const retainedWork = object({ requestedCalls: retainedCalls, state: stateWithResults([siblingSuccess]), round, batchId: text('batch-001'), requestedCallIds: list(text('call-001'), ['call-001', 'call-002'], 1), settledResults: list(result, [siblingSuccess.example]), pendingCallIds: list(text('call-001'), ['call-001']), activeAttemptIds: list(text('adapter-attempt-001'), []), pendingWaitIds: list(text('wait:approval:call-001'), ['wait:approval:call-001']), authorityRetained: fixed(true), nextModelRoundAllowed: fixed(false) });
const waitRegistration = object({ retainedWork, wait: waitIdentity });
const waitAnswer = object({ retainedWork, wait: waitIdentity, answerEvidenceRef: text('answer-evidence:prompt-001'), responderId: text('person-demo'), answerRef: text('answer:prompt-001'), acceptedInputId: text('input-answer-001') });
const cancellation = object({ retainedWork, controlId: text('control-stop-001'), action: choice(['stop', 'interrupt']), requestedAt: text('2026-10-08T10:00:03Z'), reason: text('stop_requested'), activeProviderAttemptIds: list(text('attempt-001'), []), activeToolAttempts: list(object({ callId: text('call-001'), attemptId: text('adapter-attempt-001') })), pendingWaitIds: list(text('wait:approval:call-001'), []), replacementInputRef: sample(nullable(text('input:replacement-001')), null), freshLaunchAllowed: fixed(false) });
turnExecutionContracts.push({
  nodeId: nodeId('wait'),
  external: [
    { label: 'Verified owner connection-completion event', source: 'Connection authorization owner; callbacks never enter chat as an unverified answer.', value: object({ kind: fixed('connection.authorization-completed'), retainedWork, wait: replaceField(replaceField(replaceField(waitIdentity, 'waitKind', fixed('connection-authorization')), 'owningNodeId', fixed('lina-tools-resolve')), 'authorizationFlowRef', text('auth-flow:files-001')), authorizationEvidenceRef: text('auth-evidence:files-001'), verifiedAccountId: text('account-files-demo'), readinessGeneration: count(5) }) },
    { label: 'Scoped wait expiry', source: 'Coordinator clock correlated with the retained wait; no provider effect is inferred.', value: object({ kind: fixed('execution.wait-expiry'), retainedWork, wait: waitIdentity, observedAt: text('2026-10-08T10:05:01Z') }) },
  ],
  context: local({ retainedWork, waits: list(waitIdentity), currentBindingGeneration: count(4), currentPolicyRevision: count(2), continuationOwnerAvailable: flag(true) }),
  contextSource: 'Execution retains wait records and sibling results. Input validates responder/route; Tools validates the exact operation; connection owner verifies authentication.',
  reads: ['Exact wait/turn/batch/call/attempt and owner identity', 'Correlated answer evidence or verified connection-generation event', 'Settled siblings and current binding/policy/argument revisions'],
  writes: ['Retained or resolved wait status and single consumed continuation identity'],
  rules: ['Do not launch a second task, reset counters or rerun a dispatched effect.', 'A matched answer is evidence, not a permission grant. The receiving owner rechecks binding, policy and arguments.', 'Duplicate or stale completion keeps the original settled siblings and cannot consume the continuation twice.', 'Pending waits block next round and clean release. Expiry is operation-specific, not turn Stop.', 'Call-readiness authorization completion has one resume route. Startup readiness does not create an execution wait.'],
  outputs: [
    output('execution.wait-approval-answer', 'Forward matched approval evidence', waitAnswer, edges('wait-approval'), 'Wait owner and exact operation correlation match; permissions revalidates approval.'),
    output('execution.wait-auth-ready', 'Re-resolve retained pre-dispatch work', object({ retainedWork, wait: replaceField(replaceField(replaceField(waitIdentity, 'waitKind', fixed('connection-authorization')), 'owningNodeId', fixed('lina-tools-resolve')), 'authorizationFlowRef', text('auth-flow:files-001')), authorizationEvidenceRef: text('auth-evidence:files-001'), verifiedAccountId: text('account-files-demo'), readinessGeneration: count(5), freshDispatchPermitted: fixed(false) }), edges('wait-auth'), 'Verified owner event matches the authorization flow/account; resolution and permissions rerun before launch.'),
    output('execution.wait-input-answer', 'Resume supported protocol continuation', object({ retainedWork, wait: replaceField(replaceField(replaceField(waitIdentity, 'waitKind', fixed('tool-input')), 'attemptId', text('adapter-attempt-001')), 'owningNodeId', fixed('lina-tools-collect')), protocolContinuationRef: text('private-continuation:adapter-attempt-001'), answerRef: text('answer:prompt-001'), answerEvidenceRef: text('answer-evidence:prompt-001') }), edges('wait-input'), 'The exact dispatched attempt supports continuation; do not submit the original tool call again.'),
    output('execution.wait-cancellation', 'Cancel retained work', cancellation, edges('wait-cancel'), 'Exact-turn Stop/Interrupt targets retained active work.'),
    output('execution.wait-retained', 'Keep pending work', waitRegistration, [], 'No valid owner completion is available; sibling results and authority remain retained.'),
    output('execution.wait-answer-rejected', 'Reject stale or duplicate continuation', object({ retainedWork, wait: waitIdentity, reason: choice(['expired', 'wrong-account', 'wrong-prompt', 'arguments-changed', 'binding-changed', 'already-consumed']), answerEvidenceRef: text('answer-evidence:stale-001'), continuationConsumed: fixed(false) }), [], 'Answer correlation or revisions do not match; no effect is dispatched.'),
    output('execution.wait-expired', 'Record operation-specific expiry', object({ retainedWork, wait: waitIdentity, ownerEventRef: text('wait-expiry:approval:call-001'), ownerMustClassify: fixed(true), effectOutcome: fixed('not-inferred') }), [], 'Owner must classify known denial/no-launch versus started work. No completed cancellation or turn release is fabricated.'),
  ],
}, {
  nodeId: nodeId('cancel'),
  context: local({ retainedWork, cancellationLatched: flag(false), currentOwnerFence: count(1), providerOwnerAvailable: flag(true), toolsOwnerAvailable: flag(true), persistenceOwner: object({ serviceRef: text('future-state-owner'), implemented: fixed(false) }) }),
  contextSource: 'Execution coordinator owns cancellation intent; provider and Tools own signals/outcomes. State persistence is a future dependency, not a implemented graph endpoint.',
  reads: ['Exact-turn fenced Stop/Interrupt and current active work', 'Known sibling outcomes and required-work settlement evidence'],
  writes: ['Idempotent cancellation latch and per-owner signal identities', 'No-launch gate, known terminal state or uncertainty retained for reconciliation'],
  rules: ['Stop playback pause and cancellation are separate operations.', 'Signal only matching active attempts; request does not prove cancellation or undo effects.', 'Retain late success and sibling success under the original call IDs.', 'Unstarted calls are skipped by Tools launch gates; started calls still require collection.', 'No release until required work is known settled or explicitly transferred under a documented policy.'],
  outputs: [
    output('execution.provider-cancellation-requested', 'Signal active provider attempt', object({ cancellation, providerAttemptId: text('attempt-001'), cancellationSignalId: text('cancel:attempt-001'), invocationRequested: fixed(false) }), edges('cancel-model'), 'An exact provider attempt is active; this is a signal, never another invocation.'),
    output('execution.tool-cancellation-requested', 'Signal active adapter owners', object({ cancellation, cancelRequestedCallIds: list(text('call-001'), ['call-001']), activeAttempts: list(object({ callId: text('call-001'), attemptId: text('adapter-attempt-001') })), settledResults: list(result, [siblingSuccess.example]), outcomeConfirmed: fixed(false) }), edges('cancel-tools'), 'Tools signals the active adapters and still collects actual outcomes. This may accompany the provider signal.'),
    output('execution.cancellation-resolved', 'Required cancellation work resolved', terminalRequest('cancelled', 'stop_requested', stateWithResults([cancelledResult, siblingSuccess])), edges('cancel-settle'), 'Every required operation is settled; cancelled call-001 and successful sibling call-002 are retained.'),
    output('execution.cancellation-uncertain', 'Retain uncertain effect', object({ retainedWork, uncertainty, cancellationRequested: fixed(true), releaseReady: fixed(false), settledResults: list(result, [siblingSuccess.example]) }), edges('cancel-reconcile'), 'Cancellation or timeout leaves an external effect unknown; reconcile without replay.'),
    output('execution.cancellation-pending', 'Await actual outcomes', object({ cancellation, signalledCallIds: list(text('call-001'), ['call-001']), settledCallIds: list(text('call-002'), ['call-002']), outcomeConfirmed: fixed(false), releaseReady: fixed(false) }), [], 'Signals have been recorded but required work has not settled.'),
  ],
});

const enrichContext = (definition: ContractDefinition, fields: Record<string, Payload>) => {
  const enrich = (value: Payload) => object({ ...Object.fromEntries(Object.entries(value.schema.properties ?? {}).map(([key, schema]) => [key, { schema, example: (value.example as Record<string, Json>)[key] }])), ...fields });
  definition.context = enrich(definition.context);
  definition.contextExamples = definition.contextExamples?.map(example => ({ ...example, value: enrich(example.value) }));
};
for (const definition of turnExecutionContracts) {
  if (['start', 'prepare', 'recover'].some(id => definition.nodeId === nodeId(id))) enrichContext(definition, { executionScope: object({ agentId: text('agent:lina-main'), parentAgentId: fixed(null), stateRevision: count(3), configurationRevision: count(2), environmentRef: text('environment:configured-demo'), scopeRef: text('agent-scope:lina-main') }) });
  if (definition.nodeId === nodeId('limits')) enrichContext(definition, { additionalBudgetRefs: object({ deadlineRef: sample(nullable(text('deadline:turn-001')), null), toolCallBudgetRef: nullable(text('tool-budget:turn-001')), costBudgetRef: sample(nullable(text('cost-budget:turn-001')), null), measuredCostAvailable: fixed(false) }) });
  if (definition.nodeId === nodeId('prepare')) enrichContext(definition, { preparedRevisions: object({ instructions: count(2), history: count(3), task: count(1), catalog: count(4), model: count(2), agentScope: count(1) }), stalePreparationAllowed: fixed(false) });
  if (definition.nodeId === nodeId('model')) definition.rules.push('Cancellation inputs signal an exact active attempt, never invoke another provider request. Streaming fragments do not constitute validated complete calls.');
  if (definition.nodeId === nodeId('tools')) {
    definition.rules = definition.rules.filter(rule => !rule.includes('No new wait path'));
    definition.rules.push('Tools owns scheduling and adapters. Its permissions boundary invokes policy ownership; Safety is a future explicit service dependency, not another permission inferred from Input admission.');
    definition.outputs.push(output('execution.tool-batch-mixed-known', 'Known error and successful sibling', knownOutcomes([correctableResult, siblingSuccess]), [], 'All requested calls have known outcomes; preserve call IDs and successful siblings.'));
  }
  if (definition.nodeId === nodeId('tool-outcomes')) {
    enrichContext(definition, { batchOutcomePolicy: choice(['model-visible-known-errors', 'terminal-on-selected-error'], 'model-visible-known-errors') });
    definition.rules = definition.rules.filter(rule => !rule.startsWith('Fatal/nonretryable'));
    definition.rules.push('A nonretryable operation error is distinct from controller failure. Default policy exposes known errors/denials with successful siblings; terminal policy must be selected explicitly.');
    for (const [id, outcomes] of [['mixed-known', [correctableResult, siblingSuccess]], ['denied-and-success', [deniedResult, siblingSuccess]], ['cancelled-and-success', [cancelledResult, siblingSuccess]]] as [string, Payload[]][]) definition.outputs.push(output(`execution.tool-results-${id}`, 'Retain complete mixed batch', object({ ...Object.fromEntries(Object.entries(knownOutcomes(outcomes).schema.properties!).map(([key, schema]) => [key, { schema, example: (knownOutcomes(outcomes).example as Record<string, Json>)[key] }])), nextAction: fixed('continue'), candidate: nullCandidate }), edges('outcomes-controls'), 'Every requested call is known settled. Explicit model-visible outcome policy preserves every outcome; stopped turns instead take cancellation.'));
  }
  if (definition.nodeId === nodeId('controls')) {
    definition.outputs = definition.outputs.map(value => value.id === 'execution.controls-stop' ? { ...value, edgeIds: edges('controls-cancel') } : value);
    definition.rules = definition.rules.filter(rule => !rule.includes('Detailed waiting resumption'));
    definition.rules.push('Answers route directly through Await external work. Stop requests active cancellation; a checkpoint cannot claim that effects have been undone.');
  }
  if (definition.nodeId === nodeId('settle')) for (const [status, certainty] of [['failed', 'known'], ['unknown', 'unknown']] as const) definition.outputs.push(output(`execution.settlement-write-${status}`, 'Required outcome write unconfirmed', object({ state: observedState, terminal: unresolvedTerminal, writeId: text('state-write:turn-001:settlement'), writeStatus: fixed(status), certainty: fixed(certainty), stateRevision: count(3), releaseReady: fixed(false), replayEffectsAllowed: fixed(false) }), [], 'Required persistence has not established a committed terminal record. Known failure may retry the write; unknown commit requires inspection using the same write identity.'));
  if (definition.nodeId === nodeId('release')) {
    definition.outputs.push(output('execution.release-stale-owner', 'Refuse stale owner release', object({ turn, expectedFence: count(1), currentFence: count(2), releaseApplied: fixed(false), queueDrainAllowed: fixed(false) }), [], 'Current owner fence differs; releasing old authority must not unlock newer work.'), output('execution.release-write-unconfirmed', 'Withhold unconfirmed release', object({ turn, writeId: text('state-write:turn-001:release'), writeStatus: choice(['failed', 'unknown']), releaseApplied: fixed(false), queueDrainAllowed: fixed(false) }), [], 'Required ownership release write is not known committed. Inspect or retry idempotently before emitting owner release.'));
  }
}

turnExecutionContracts.find(definition => definition.nodeId === nodeId('wait'))!.outputs.push(
  output('execution.wait-resource-resume', 'Resume retained resource dependency', toolsResourceResume, ['lina-tools-edge-wait-resource-resume'], 'Verified owner completion resolves the correlated dependency wait. Preserve preparation identity; resource owner rechecks binding and policy.'),
  output('execution.wait-prompt-resume', 'Resume retained prompt dependency', toolsPromptResume, ['lina-tools-edge-wait-prompt-resume'], 'Verified owner completion resolves the selected prompt dependency wait without a fabricated tool call or model round.'),
);
const parallelCalls = list(call, [call.example, { ...call.example as object, callId: 'call-002', arguments: { expression: '3 + 3' } }], 1);
const parallelResponse = replaceField(toolsResponse, 'toolCalls', parallelCalls);
const mixedResponse = replaceField(parallelResponse, 'text', text('I will calculate both values.'));
const decision = turnExecutionContracts.find(definition => definition.nodeId === nodeId('decide'))!;
decision.outputs.push(
  output('execution.model-parallel-calls', 'Two complete calls in one response', object({ state: observedState, round, attempt, response: parallelResponse, batch: replaceField(batch, 'calls', parallelCalls) }), edges('decide-tools'), 'Both calls are complete and validated for orchestration; Tools still validates arguments, binding and permissions.'),
  output('execution.model-text-and-calls', 'Candidate text waits for the tool batch', object({ state: observedState, round, attempt, response: mixedResponse, batch: replaceField(batch, 'calls', parallelCalls), accompanyingTextIsFinal: fixed(false) }), edges('decide-tools'), 'Text accompanying tool calls cannot bypass required batch join or become the final answer.'),
);
const invocation = turnExecutionContracts.find(definition => definition.nodeId === nodeId('model'))!;
enrichContext(invocation, { providerAttemptLifecycle: object({ attemptId: text('attempt-001'), status: choice(['requested', 'streaming', 'completed', 'failed', 'cancellation-requested', 'cancelled', 'unknown']), streamEvidenceRef: sample(nullable(text('provider-stream:attempt-001')), null), modelOwnerRef: text('lina-model-invoke'), modelOwnerImplemented: fixed(false), modelGraphBoundaryPresent: fixed(true), implementationStatus: fixed('design-fixture') }) });
const recovery = turnExecutionContracts.find(definition => definition.nodeId === nodeId('recover'))!;
recovery.outputs.push(
  output('execution.catalog-refresh-required', 'Reprepare changed catalog binding', object({ state: stateWithResults([siblingSuccess]), round, previousAttempt: attempt, recoveryAction: fixed('context-refresh'), retainedCallIds: list(text('call-002'), ['call-002']), previousCatalogRevision: count(4), currentCatalogRevision: count(5), staleDispatchAllowed: fixed(false) }), edges('recover-prepare'), 'Changed catalog/account invalidates stale preparation, preserving known sibling success and logical round counters.'),
  output('execution.provider-ambiguity-retained', 'Inspect uncertain provider attempt', object({ state: observedState, round, attempt, evidenceRef: text('provider-evidence:attempt-001'), outcome: fixed('unknown'), retryAllowed: fixed(false), replayToolsAllowed: fixed(false) }), [], 'Provider lifecycle is ambiguous; apply the configured provider policy before consuming another attempt. Tool effects are never repeated as provider recovery.'),
);

const waitingCoordinator = turnExecutionContracts.find(definition => definition.nodeId === nodeId('wait'))!;
waitingCoordinator.outputs.push(
  output('execution.wait-approval-expired', 'Send approval expiry to exact owner', object({ retainedWork, wait: waitIdentity, ownerEvent: fixed('wait-expired'), approvalGranted: fixed(false), effectStarted: fixed(false) }), edges('wait-approval'), 'Approval expired before dispatch. Permissions produces a known denial while retaining successful siblings.'),
  output('execution.wait-input-expired', 'Send continuation expiry to collection owner', object({ retainedWork, wait: replaceField(replaceField(replaceField(waitIdentity, 'waitKind', fixed('tool-input')), 'attemptId', text('adapter-attempt-001')), 'owningNodeId', fixed('lina-tools-collect')), ownerEvent: fixed('wait-expired'), effectOutcome: fixed('not-inferred'), protocolContinuationRef: text('private-continuation:adapter-attempt-001') }), edges('wait-input'), 'Started work continuation expired. Collection determines its actual result or uncertainty; expiry cannot invent cancellation.'),
);

const controlCheckpoint = turnExecutionContracts.find(definition => definition.nodeId === nodeId('controls'))!;
controlCheckpoint.outputs = controlCheckpoint.outputs.map(value => value.id === 'execution.controls-stop' ? output(value.id, value.label, object({ state: observedState, round, cancellation }), edges('controls-cancel'), 'An exact-turn cancellation request reaches Cancel active work; this does not claim completed cancellation or resolved external effects.') : value);

// Detailed Tools publication is now the only graph result-return path. Legacy
// coordinator summary examples remain local inspection fixtures without arrows.
const batchDelegator = turnExecutionContracts.find(definition => definition.nodeId === nodeId('tools'))!;
batchDelegator.rules.push('Known batch results return through Tools publication. Local legacy summary examples do not bypass detailed Tools resolution, scheduling and collection.');

waitingCoordinator.outputs.push(output('execution.wait-auth-request', 'Start authorization after retaining wait', object({ retainedWork, wait: replaceField(replaceField(replaceField(waitIdentity, 'waitKind', fixed('connection-authorization')), 'owningNodeId', fixed('lina-tools-resolve')), 'authorizationFlowRef', text('auth-flow:files-001')), originalBatch: object({ batchId: text('batch-001'), calls: retainedCalls }), waitRegistered: fixed(true), authorizationRequested: fixed(true), dispatchStarted: fixed(false), settledResults: list(result, [siblingSuccess.example]) }), edges('wait-auth-request'), 'Execution records the pre-dispatch wait and settled siblings before Tools starts authorization. Completion returns to this retained wait and then the sole resolve/validate/permission route. Startup readiness uses a separate connection lifecycle.'));

// Model Interface now owns provider observations and normalization. Preserve the
// older outcome fixtures for inspection, but never publish them as a graph bypass.
const modelDelegator = turnExecutionContracts.find(definition => definition.nodeId === nodeId('model'))!;
modelDelegator.outputs = modelDelegator.outputs.map(value => ({ ...value, edgeIds: value.edgeIds.filter(id => id !== 'lina-execution-edge-model-decide') }));
modelDelegator.writes = ['Correlated invocation intent with snapshot/capability/budget revisions', 'Forward exact-active-attempt cancellation; no dispatch or usage accounting here'];
modelDelegator.rules = ['Delegate invocation to Model Resolve, which checks credential/route currentness before Encode.', 'Only Model Invoke dispatch allocates a physical attempt and counts the first launch of this logical round. Metadata, encoding, waits and cancellation before dispatch consume neither count.', 'Normalized terminal evidence returns from Model Normalize to Decide next action. Legacy local response fixtures never bypass that boundary.', 'Cancellation forwarding targets the exact active Invoke attempt, not a replacement request. Local abort does not prove remote billing stopped.'];
const modelDecision = turnExecutionContracts.find(definition => definition.nodeId === nodeId('decide'))!;
modelDecision.reads = ['Model Interface normalized outcome with agent/turn/round/intent/nullable attempt identities', 'Complete call arguments and raw finish/failure/usage/opaque continuation evidence', 'Execution continuation/termination/recovery policy and retained successful sibling results'];
modelDecision.rules.push('Model Normalize parses terminal call syntax; Tools validates registered schemas and permissions. No draft, incomplete, malformed or provider-hosted operation is a local tool batch.', 'A Model continuation hint does not open a hidden loop. Execution applies explicit client continuation policy; provider-hosted continuation stays unsupported in this slice.', 'Retain normalized outcome evidence and usage provenance. Unknown inference completion is distinct from an unknown tool side effect.');


// Shared Model leaf records preserve the exact producer payload at every owner
// handoff. These fixtures consume no attempts until Invoke dispatches them.
modelDelegator.outputs.push(
  output('model.invocation-requested', 'Delegate prepared invocation intent', modelInvocationIntent, ['lina-model-edge-execution-resolve'], 'Accepted Context snapshot is ready; delegate currentness/auth/encoding without allocating a physical request.'),
  output('model.invocation-requested-after-feedback', 'Delegate next round retaining tool results', replaceField(replaceField(replaceField(replaceField(modelInvocationIntent, 'executionState', successState), 'round', secondRound), 'identity', replaceField(replaceField(replaceField(modelField(modelInvocationIntent, 'identity'), 'roundId', text('round-002')), 'preparationId', text('prepare:turn-001:round-002:r0')), 'intentId', text('model-intent:turn-001:round-002:1'))), 'contextSnapshotRef', text('context:turn-001:round-002:r0')), ['lina-model-edge-execution-resolve'], 'Retain known call-001 and counters1/1 during next-round metadata/encoding. Invoke alone increments dispatch counts.'),
  output('model.invocation-requested-retry', 'Delegate bounded retry of current round', replaceField(replaceField(modelInvocationIntent, 'executionState', retryState), 'identity', replaceField(modelField(modelInvocationIntent, 'identity'), 'intentId', text('model-intent:turn-001:round-001:retry-1'))), ['lina-model-edge-execution-resolve'], 'Retry uses the same accepted snapshot and logical round; consumed retry allowance stays zero and attempts remain one before dispatch.'),
  output('model.abort-requested', 'Forward exact active Invoke cancellation', modelAbortRequested, ['lina-model-edge-cancel-invoke'], 'The existing Cancel→Call model signal forwards to the exact active physical attempt. Never launch a replacement request.'),
);
const cancellationOwner = turnExecutionContracts.find(definition => definition.nodeId === nodeId('cancel'))!;
cancellationOwner.outputs = cancellationOwner.outputs.map(value => value.id === 'execution.provider-cancellation-requested' ? output(value.id, value.label, modelAbortRequested, edges('cancel-model'), 'Signal the exact active physical Model attempt through Call model; Invoke owns drain/accounting. No new request starts.') : value);
cancellationOwner.outputs.push(
  output('model.intent-cancelled', 'Invalidate pending Model Resolve or Encode intent', modelPrelaunchCancellation, ['lina-model-edge-cancel-resolve', 'lina-model-edge-cancel-encode'], 'Stop targets retained prelaunch intent. Correlated metadata/invocation mode is cancelled without allocating an attempt or counting a launched round.'),
  output('model.readiness-cancelled', 'Invalidate retained Model readiness token', modelReadinessCancelled, ['lina-model-edge-cancel-readiness'], 'Stop invalidates the exact readiness wait; late credential completion cannot revive the intent.'),
);
waitingCoordinator.outputs.push(
  output('model.credential-readiness-requested', 'Ask protected owner for provider credential readiness', modelCredentialReadinessRequest, ['lina-model-edge-wait-auth'], 'Retain original capabilities/invocation purpose and provider audience before shared credential readiness. No MCP flow or Tool call is fabricated.'),
  output('model.readiness-resume', 'Resume exact Model resolution intent', modelReadinessResume, ['lina-model-edge-wait-resolve'], 'Matched provider/account/readiness completion consumes its continuation once. Resolve rechecks currentness and Stop and then branches on the original purpose.'),
  output('model.settlement-resume', 'Resume local Model attempt settlement', modelSettlementResume, ['lina-model-edge-wait-invoke'], 'Exact attempt owner supplies completion/abort evidence. Account existing local work without launching another attempt.'),
  output('execution.model-readiness-invalidated', 'Retain cancellation of Model readiness', object({ cancellation: modelReadinessCancelled, lateCompletionAdmissible: fixed(false), resumeRequested: fixed(false) }), [], 'Model readiness was cancelled; late credential callback remains diagnostic and cannot start a request.'),
);
waitingCoordinator.rules.push('Model waits carry owner:model, original capabilities/invocation purpose, exact binding/provider audience and no Tool batch identity. Provider credential completion only resumes Resolve after currentness and Stop checks.', 'Local Model settlement wait preserves the exact dispatched attempt. Completion accounts local work; it does not promise remote cancellation or known billing.');

modelDecision.outputs.push(
  output('execution.normalized-answer-candidate', 'Complete normalized Model answer', object({ state: modelField(modelOutcome, 'executionState'), round: modelField(modelOutcome, 'round'), modelOutcome, nextAction: fixed('finish'), candidate }), edges('decide-answer'), 'Normalized complete terminal answer is a candidate; controls and settlement still apply.'),
  output('execution.normalized-prelaunch-failure', 'Fail without a physical Model attempt', object({ state: modelField(normalizedModelFixtures['model.outcome-prelaunch-failed'], 'executionState'), round: modelField(normalizedModelFixtures['model.outcome-prelaunch-failed'], 'round'), modelOutcome: normalizedModelFixtures['model.outcome-prelaunch-failed'], terminal: terminalReason('failed', 'model_prelaunch_rejected'), candidate: nullCandidate }), edges('decide-terminal'), 'Resolve/Encode failed before provider dispatch. Physical attempts and launched rounds remain unchanged.'),
);

// Capability preparation and invocation share credential storage, while retaining
// distinct continuation purposes so metadata completion cannot launch inference.
cancellationOwner.outputs.push(output('model.metadata-readiness-cancelled', 'Invalidate Context capability readiness', modelMetadataReadinessCancelled, ['lina-model-edge-cancel-readiness'], 'Stop invalidates metadata readiness without consuming a Model attempt or converting it into an invocation.'));
waitingCoordinator.outputs.push(
  output('model.metadata-credential-readiness-requested', 'Request provider readiness for Context metadata', modelMetadataCredentialReadinessRequest, ['lina-model-edge-wait-auth'], 'Retain the original Context dependency and preparation while checking the provider account; metadata has no inference attempt.'),
  output('model.metadata-readiness-resume', 'Resume Context capability dependency', modelMetadataReadinessResume, ['lina-model-edge-wait-resolve'], 'Resolve returns capability readiness to the same Context preparation; it does not encode or launch inference.'),
  output('execution.model-metadata-readiness-invalidated', 'Retain cancelled Context metadata wait', object({ cancellation: modelMetadataReadinessCancelled, lateCompletionAdmissible: fixed(false), resumeRequested: fixed(false) }), [], 'A late metadata credential callback cannot revive the cancelled Context preparation.'),
);

const normalizedEnvelope = (value: Payload, fields: Record<string, Payload> = {}) => object({ state: modelField(value, 'executionState'), round: modelField(value, 'round'), modelOutcome: value, ...fields });
for (const [sourceId, outputId] of [['model.outcome-calls', 'execution.normalized-tool-batch'], ['model.outcome-text-and-calls', 'execution.normalized-text-and-tool-batch']] as const) {
  const value = normalizedModelFixtures[sourceId];
  const calls = (value.example as Record<string, Json>).toolCalls as Record<string, Json>[];
  const requested = calls.map(value => ({ callId: value.callId, name: value.name, arguments: value.arguments }));
  modelDecision.outputs.push(output(outputId, 'Complete normalized calls await Tools admission', normalizedEnvelope(value, { batch: replaceField(batch, 'calls', list(call, requested, 1)), accompanyingTextIsFinal: fixed(false) }), edges('decide-tools'), 'Preserve normalized terminal evidence and exact complete call arguments; registered schema and permission checks remain owned by Tools.'));
}
modelDecision.outputs.push(
  output('execution.normalized-continuation', 'Apply explicit next-round continuation policy', normalizedEnvelope(normalizedModelFixtures['model.outcome-continuation'], { nextAction: fixed('continue'), candidate: nullCandidate }), edges('decide-continue'), 'A provider continuation hint reaches the existing controls and round-limit policy without a hidden provider loop.'),
  output('execution.normalized-provider-recovery', 'Assess bounded retry for a known provider failure', normalizedEnvelope(normalizedModelFixtures['model.outcome-retryable-failure'], { requestedRecovery: fixed('provider-retry') }), edges('decide-recover'), 'Keep the consumed physical attempt and raw failure/usage evidence. Execution alone decides whether another attempt may start in the same round.'),
  output('execution.normalized-context-recovery', 'Request Context refresh after provider overflow', normalizedEnvelope(normalizedModelFixtures['model.outcome-context-overflow'], { requestedRecovery: fixed('context-refresh') }), edges('decide-recover'), 'The failed dispatched attempt remains consumed. Context reprepare does not erase counters or silently switch provider.'),
  output('execution.normalized-auth-failure', 'Retain failed provider authentication outcome', normalizedEnvelope(normalizedModelFixtures['model.outcome-auth-failure'], { terminal: terminalReason('failed', 'model_provider_authentication_failed'), candidate: nullCandidate }), edges('decide-terminal'), 'Baseline terminates this failed attempt. Credential readiness is a separate explicit operation and cannot automatically replay inference.'),
  output('execution.normalized-aborted', 'Settle locally accounted Model abort', normalizedEnvelope(normalizedModelFixtures['model.outcome-aborted'], { terminal: terminalReason('cancelled', 'model_locally_aborted'), candidate: nullCandidate }), edges('decide-terminal'), 'Local cancellation is settled without asserting remote completion or zero billing.'),
  output('execution.normalized-unknown-retained', 'Retain uncertain inference completion for policy', normalizedEnvelope(normalizedModelFixtures['model.outcome-unknown-finish'], { retryAllowed: fixed(false), replayToolsAllowed: fixed(false) }), [], 'Unknown inference completion retains authority/evidence. It is not a completed answer or an uncertain Tool side effect.'),
);
for (const sourceId of ['model.outcome-truncated', 'model.outcome-malformed', 'model.outcome-duplicate-call-id', 'model.outcome-refused', 'model.outcome-hosted-continuation-unsupported', 'model.outcome-missing-terminal', 'model.outcome-failed-after-output', 'model.outcome-prelaunch-aborted']) {
  const value = normalizedModelFixtures[sourceId];
  modelDecision.outputs.push(output(`execution.normalized-terminal-${sourceId.slice('model.outcome-'.length)}`, 'Settle unusable normalized Model outcome', normalizedEnvelope(value, { terminal: terminalReason(sourceId.endsWith('prelaunch-aborted') ? 'cancelled' : 'failed', sourceId), candidate: nullCandidate }), edges('decide-terminal'), 'Preserve raw finish/failure/usage and nullable physical attempt identity. No incomplete call or nonfinal preview is admitted to Tools or final delivery.'));
}

for (const id of ['execution.normalized-tool-batch', 'execution.normalized-text-and-tool-batch']) {
  const delegated = modelDecision.outputs.find(value => value.id === id)!;
  batchDelegator.outputs.push(output(`tools.${id.slice('execution.'.length)}-delegated`, 'Delegate normalized complete calls unchanged', { schema: delegated.schema.properties!.payload, example: (delegated.example as Record<string, Json>).payload }, ['lina-tools-edge-execution-resolve'], 'Preserve complete-call arguments, Model evidence and physical/logical counters through the sole Tools admission boundary.'));
}
const providerRecoveryOutcome = normalizedModelFixtures['model.outcome-retryable-failure'];
const retryExecutionState = replaceField(modelField(providerRecoveryOutcome, 'executionState'), 'limits', modelField(retryState, 'limits'));
recovery.outputs.push(
  output('execution.normalized-retry-preparation', 'Retry same round with failed Model evidence retained', object({ state: retryExecutionState, round: modelField(providerRecoveryOutcome, 'round'), modelOutcome: providerRecoveryOutcome, recoveryAction: fixed('provider-retry'), reuseSnapshotRef: modelField(modelInvocationIntent, 'contextSnapshotRef'), roundIdPreserved: fixed(true), freshAttemptNotYetLaunched: fixed(true) }), edges('recover-prepare'), 'Consume one retry allowance while retaining one launched round/attempt and its failure. Prepare rechecks authority; Invoke alone starts the next physical attempt.'),
  output('execution.normalized-overflow-preparation', 'Reprepare same round after provider overflow', normalizedEnvelope(normalizedModelFixtures['model.outcome-context-overflow'], { recoveryAction: fixed('context-refresh'), previousSnapshotRef: modelField(modelInvocationIntent, 'contextSnapshotRef'), requiredContextRevision: count(1), consumedModelAttemptPreserved: fixed(true), freshAttemptNotYetLaunched: fixed(true) }), edges('recover-prepare'), 'Reprepare the existing logical round with the failed physical attempt retained. A revised Context snapshot grants no inference launch permission.'),
);
