import { choice, count, executionEdges, fixed, flag, list, nullable, object, output, replaceField, sample, text, type ContractDefinition, type Payload } from './schema';
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
const modelRequest = object({ requestId: text('request-001'), contextRef: text('context:turn-001:round-001'), model: text('configured-model'), messages: list(json, [{ role: 'user', content: 'What is 2 + 2?' }], 1), tools: list(object({ name: text('calculator'), argumentsSchemaRef: text('tool-schema:calculator:v1') })) });
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
const continuedRequest = (id: string, contextId: string, outcomes: Payload[]) => replaceField(replaceField(replaceField(modelRequest, 'requestId', text(id)), 'contextRef', text(contextId)), 'messages', list(json, [{ role: 'user', content: 'What is 2 + 2?' }, ...outcomes.map(value => ({ role: 'tool', result: value.example }))], 1));
const secondSuccessRequest = continuedRequest('request-002', 'context:turn-001:round-002', [successResult]);
const secondErrorRequest = continuedRequest('request-002', 'context:turn-001:round-002', [correctableResult]);
const thirdReplacementRequest = continuedRequest('request-003', 'context:turn-001:round-003', [correctableResult, replacementSuccess]);
const correctionResponse = replaceField(toolsResponse, 'toolCalls', list(call, [replacementCall.example], 1));
const permissionForRound = (value: Payload, nextRound: Payload) => object({ state: value, round: nextRound, permission: fixed('new-round'), authority });
const requestReady = (value: Payload, currentRound: Payload, request: Payload) => object({ state: value, round: currentRound, modelRequest: request, launchPermission: fixed('allowed') });
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
    context: local({ contextService: object({ strategyId: text('context-policy-demo'), snapshotRef: text('context:turn-001:round-001') }), modelConfigurationRef: text('model-config:demo'), toolCatalogRef: text('tool-catalog:demo'), launchAllowed: flag(true), stopRequested: flag(false) }),
    contextSource: 'Context/Memory supply assembled context; Model and Tools supply their configured interfaces. Execution ownership and control state are rechecked locally.',
    reads: ['Turn inputs, retained tool results and accepted guidance', 'Current round identity and context/model/tool configuration', 'Launch authority after context preparation'],
    writes: ['Prepared model-request reference for the existing round', 'Classified preparation failure or pending-control intent'],
    rules: ['Context and Memory own retrieval/assembly internals. Preserve original references alongside derived context.', 'Copy incoming counters and retained results without resetting them; preparation changes context/request fields only.', 'Provider retry keeps the incoming logical round and retained results; preparation does not count another round or restore consumed retry allowance.', 'Recheck authority and stop intent before the model handoff.', 'Recoverable context pressure can request refresh; fatal preparation failure goes to settlement.'],
    outputs: [
      output('execution.model-request-ready', 'Prepared model request', object({ state, round, modelRequest, launchPermission: fixed('allowed') }), edges('prepare-model'), 'Context is prepared and the current owner may launch a provider attempt.'),
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
    rules: ['Validate each call against its own registered schema and permissions before dispatch.', 'Recheck stop/launch permission before each new operation; unstarted calls receive explicit skipped outcomes.', 'Wait for required started work to settle; partial updates are not settled results.', 'Known failures do not imply uncertainty. Unknown external effects go to reconciliation without automatic replay.', 'Waiting approval retains the owning call and prompt. No new wait path is invented in this graph slice; answers target owning work through the existing coordinator boundary.'],
    outputs: [
      output('execution.tool-batch-success', 'Known tool success', knownOutcomes([successResult]), edges('tools-outcomes'), 'The call succeeded with a known returned value.'),
      output('execution.tool-batch-correctable-error', 'Known correctable tool error', knownOutcomes([correctableResult]), edges('tools-outcomes'), 'The call failed with a known error that the model can address in a new call.'),
      output('execution.tool-batch-denied', 'Known denied tool call', knownOutcomes([deniedResult]), edges('tools-outcomes'), 'Permission or approval denied the operation; it did not execute.'),
      output('execution.tool-batch-skipped', 'Known skipped tool call', knownOutcomes([skippedResult]), edges('tools-outcomes'), 'A stop or batch policy prevented this call from starting.'),
      output('execution.tool-batch-cancelled', 'Known cancelled tool call', knownOutcomes([cancelledResult]), edges('tools-outcomes'), 'Started work reports a known cancellation result. Unknown effects use reconciliation instead.'),
      output('execution.tool-batch-fatal-error', 'Known fatal tool error', knownOutcomes([fatalResult]), edges('tools-outcomes'), 'The tool returned a known nonretryable failure for outcome classification.'),
      output('execution.tool-batch-replacement-success', 'Replacement call succeeded', object({ state: replaceField(stateWithResults([correctableResult, replacementSuccess]), 'limits', sample(limits, { roundsStarted: 2, maxRounds: 3, attempts: 2, retriesRemaining: 1 })), round: replaceField(replaceField(round, 'roundId', text('round-002')), 'index', count(2)), batchId: text('batch-002'), results: list(result, [replacementSuccess.example], 1) }), edges('tools-outcomes'), 'A separately authorized new call-002 succeeds after the model observed call-001 error. Both historical results are retained.'),
      output('execution.tool-controller-terminal', 'Fatal controller failure', object({ state: observedState, round, batchId: text('batch-001'), terminal: failed, results: list(result, []), candidate: nullCandidate }), edges('tools-terminal'), 'Controller/admission failure is terminal after required started work is accounted for.'),
      output('execution.tool-controller-stopped', 'Stopped tool batch', object({ state: stateWithResults([skippedResult]), round, batchId: text('batch-001'), terminal: terminalReason('cancelled', 'tool_batch_stopped'), results: list(result, [skippedResult.example], 1), candidate: nullCandidate }), edges('tools-terminal'), 'A stop prevents further launches and known outcomes for required started work have been accounted for.'),
      output('execution.tool-effect-uncertain', 'Uncertain external effect', object({ state: observedState, round, batchId: text('batch-001'), uncertainty, pendingCallIds: list(text('call-001'), ['call-001'], 1) }), edges('tools-uncertain'), 'An external operation lacks a known outcome. Retain fenced authority and reconcile instead of retrying it blindly.'),
      output('execution.tool-wait-retained', 'Pending approval or external wait', object({ state: observedState, round, batchId: text('batch-001'), callId: text('call-001'), promptId: text('prompt-001'), status: fixed('waiting'), waitKind: choice(['approval', 'external-input']), authorityRetained: fixed(true) }), [], 'The owning call is waiting locally. No continuation or settlement is emitted until matched resolution. Waiting playback and a graph resumption route remain deferred.'),
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
      output('execution.tool-results-fatal', 'Fatal tool outcome', object({ state: stateWithResults([fatalResult]), round, batchId: text('batch-001'), terminal: failed, results: list(result, [fatalResult.example], 1), candidate: sample(nullable(candidate), null) }), edges('outcomes-terminal'), 'A known tool outcome is fatal or nonretryable under the selected policy.'),
      output('execution.tool-results-denied', 'Denial ends this execution policy', object({ state: stateWithResults([deniedResult]), round, batchId: text('batch-001'), terminal: terminalReason('failed', 'tool_approval_denied'), results: list(result, [deniedResult.example], 1), candidate: nullCandidate }), edges('outcomes-terminal'), 'This provisional policy treats noncorrectable approval denial as failed settlement. A future policy could expose denial to the model.'),
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
    rules: ['Reject stale controls rather than applying them to a newer turn.', 'Consume steering at a supported boundary; cancellation may already have been signalled to active work before this checkpoint.', 'Matched answers resolve the owning wait and do not allocate a new turn. Detailed waiting resumption remains deferred.', 'Continue forwards incoming counters and retained results unchanged to the next-round gate. Finish/stop requests settlement; stop does not undo completed effects.'],
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
    rules: ['Release only the matching current ownership identity/fence after settlement authorizes it.', 'Retain the terminal outcome in the lifecycle event; failure/exhaustion is not completion success.', 'The queue rechecks admission after release. Emitting this event does not execute queue draining.', 'This is the scripted simulation terminal boundary; actual safe-release/idempotency semantics remain proposed.'],
    outputs: [
      output('execution.owner-released', 'Completed owner-release event', object({ release: replaceField(released, 'outcome', fixed('completed')), terminalBoundary: fixed(true) }), edges('owner-release'), 'Ownership is released for the settled completed turn. Preserve its turn/conversation IDs, owner and fence.'),
      output('execution.owner-released-failed', 'Failed owner-release event', object({ release: replaceField(released, 'outcome', fixed('failed')), terminalBoundary: fixed(true) }), edges('owner-release'), 'Ownership is released for the settled failed turn. Preserve its turn/conversation IDs, owner, fence and failed outcome.'),
      output('execution.owner-released-cancelled', 'Cancelled owner-release event', object({ release: replaceField(released, 'outcome', fixed('cancelled')), terminalBoundary: fixed(true) }), edges('owner-release'), 'Ownership is released for the settled cancelled turn. Preserve its turn/conversation IDs, owner, fence and cancelled outcome.'),
      output('execution.owner-released-exhausted', 'Exhausted owner-release event', object({ release: replaceField(released, 'outcome', fixed('exhausted')), terminalBoundary: fixed(true) }), edges('owner-release'), 'Ownership is released for the settled exhausted turn. Preserve its turn/conversation IDs, owner, fence and exhausted outcome.'),
    ],
  },
];
