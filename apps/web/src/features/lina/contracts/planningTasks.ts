/** Eight Planning contracts. Every edge preserves the accepted plan revision and
 * attempt identity; no readiness or plan acceptance is execution authorization. */
import { PLANNING_EDGES, PLANNING_STATE_ROUTES, PLANNING_TOOL_ROUTES } from '../planningBlock';
import { choice, count, fixed, flag, list, nullable, object, output, replaceField, sample, text, type ContractDefinition, type Payload } from './schema';
import { planningAssessment, planningAttempt, planningCommand, planningCommandFor, planningCommandVariants, planningIdentity, planningLocalContext, planningMutationReceipt, planningPlan, planningPolicy, planningProjection, planningReadiness, planningScope } from './planningRecords';

const phases = ['policy', 'load', 'update', 'ready', 'bind', 'review', 'replan', 'complete'];
export const planningStatuses: Record<string, string[]> = {
 policy: ['planning', 'bypass', 'refused'], load: ['found', 'absent', 'stale', 'conflict', 'unavailable', 'denied'],
 update: ['applied', 'duplicate', 'conflict', 'invalid', 'failed', 'unknown'], ready: ['ready', 'blocked', 'waiting', 'completion-candidate', 'invalid'],
 bind: ['bound', 'refused', 'unresolved', 'stale-revision', 'cancelled'], review: ['accepted', 'insufficient', 'failed', 'blocked', 'uncertain', 'late-result'],
 replan: ['continue', 'revision-required', 'user-wait', 'exhausted'], complete: ['complete', 'partial', 'needs-work', 'blocked', 'failed', 'cancelled'],
};
const rules: Record<string, string[]> = {
 policy: ['The main model or user may choose planning. Direct mode bypasses this block; a configured plan-first requirement is explicit.', 'Plan-only admits only the configured exploration capabilities through Tools/Safety. Accepting a plan does not approve its actions.', 'A child has its own scoped policy and plan; parent assignment references do not expose mutable parent or child private history.'],
 load: ['Load the exact workspace, agent, conversation and history branch revision through State. Missing is distinct from unavailable or denied.', 'Context receives only a bounded permitted projection with canonical provenance. Compaction cannot edit canonical task records.', 'Recovery checks record and owner compatibility; loading a plan never replays completed operations.'],
 update: ['Validate missing, self and cyclic dependencies semantically. JSON shape validation cannot establish those relationships.', 'Conditionally commit expected revision and original command identity/fingerprint through State. Same ID with different content conflicts.', 'Unknown acknowledgement inspects the original transaction; never create a replacement mutation. Required skipped work needs an accepted requirement revision.', 'Plan edits retain history/evidence and do not implicitly cancel running tools or child tasks.'],
 ready: ['Default dependencies require accepted success, rather than a completed status alone. Explicit terminal-outcome dependencies support cleanup after failure.', 'Select independent ready work and immutable producer attempt/artifact bindings without launching it or granting permission.', 'Failed required work, uncertain effects, active attempts and unmet evidence remain visible. An empty ready set is not whole-goal success.'],
 bind: ['Bind admitted execution to task, plan revision, attempt, call/child task, operation fingerprint, generation and controller.', 'The existing Tools/Subagents owners enforce access, capacity, launch, waits and cancellation. Planning does not become another scheduler.', 'Unknown or stale binding cannot launch replacement work. Late results attach to the original attempt without completing replacement tasks.'],
 review: ['Assess retained observations against declared criteria using the recorded deterministic, model or human evidence method.', 'A child success is an observation requiring parent review. Model assertion is not independently verified evidence.', 'Maintain each sibling outcome and uncertainty. Invalid or incomplete evidence cannot become accepted by changing task status.'],
 replan: ['Changes affect remaining work while retaining completed attempts and evidence. Replacement tasks get distinct attempts.', 'Count planning/evaluation model work against the existing loop budget and bounded replan policy; never reset main loop limits.', 'User guidance may require waiting or cancellation through execution owners. A plan revision alone cancels nothing.'],
 complete: ['Assess the exact plan revision against required task and whole-goal criteria. Failed, cancelled or unaccepted required tasks do not count as success.', 'Retain unresolved effects and running required work; report partial, blocked, failed or cancelled honestly.', 'User Stop/pause may settle without completing the goal. Completion assessment does not publish a user message or revoke retained obligations.'],
};
export const planningTaskContracts: ContractDefinition[] = phases.map(phase => ({ nodeId: `lina-planning-${phase}`, context: planningLocalContext, contextSource: 'Trusted scoped coordinator fixtures. Canonical plan state is owned by State; this is a design contract, not live persistence.', reads: ['Accepted plan identity, revision, scope and execution policy', 'Phase-specific commands, dependency conditions and correlated evidence'], writes: ['Revision-bound phase observation or conditional plan mutation request'], rules: rules[phase], outputs: [] }));

/** Status-specific examples keep branch claims consistent with their evidence. */
export function planningPhasePayload(phase: string, status: string): Payload {
 const fields: Record<string, Payload> = { identity: planningIdentity, phase: fixed(phase), status: fixed(status), storage: fixed('fixture-only'), grantsExecutionPermission: fixed(false) };
 if (phase === 'policy') { fields.policy = replaceField(planningPolicy, 'strategy', status === 'bypass' ? fixed('direct') : choice(['model-led', 'authored-workflow'])); fields.userPreferenceRef = text('user-preference:planning:001'); fields.planningRequired = flag(false); fields.actionAuthorityRef = text('safety-policy:turn:001'); }
 if (phase === 'load') { fields.plan = status === 'found' ? planningPlan : fixed(null); fields.projection = status === 'found' ? planningProjection : fixed(null); fields.requestedRevision = count(3); fields.absenceVerified = fixed(status === 'absent'); fields.replaysEffects = fixed(false); fields.errorRef = ['stale', 'conflict', 'unavailable', 'denied'].includes(status) ? text(`plan-load-error:${status}:001`) : fixed(null); }
 if (phase === 'update') {
  let receipt = replaceField(planningMutationReceipt, 'status', fixed(status));
  receipt = replaceField(receipt, 'revision', ['applied', 'duplicate'].includes(status) ? count(4) : fixed(null));
  receipt = replaceField(receipt, 'receiptRef', ['applied', 'duplicate'].includes(status) ? text('state-receipt:plan-update:001') : fixed(null));
  receipt = replaceField(receipt, 'inspectOriginalTransaction', fixed(status === 'unknown'));
  if (status === 'invalid' || status === 'conflict') receipt = replaceField(receipt, 'errors', list(object({ code: fixed(status === 'invalid' ? 'cyclic-dependency' : 'revision-conflict'), taskId: text('task:synthesize'), message: text(status === 'invalid' ? 'The proposed dependency graph contains a cycle.' : 'Expected revision does not match current canonical record.') })));
  fields.command = planningCommandFor('update_task'); fields.receipt = receipt; fields.launchOnCommit = fixed(false);
 }
 if (phase === 'ready') { let ready = replaceField(planningReadiness, 'readyTaskIds', list(text('task:synthesize'), status === 'ready' ? ['task:synthesize'] : [])); ready = replaceField(ready, 'completionCandidate', fixed(status === 'completion-candidate')); ready = replaceField(ready, 'requiredTaskIds', list(text('task:synthesize'), status === 'completion-candidate' ? [] : ['task:synthesize'])); ready = replaceField(ready, 'dependencyGraphValidated', fixed(status !== 'invalid')); fields.readiness = ready; fields.selectionPolicyRef = text('task-selection:dependencies:v1'); }
 if (phase === 'bind') { fields.attempt = replaceField(replaceField(planningAttempt, 'status', fixed(status === 'bound' ? 'running' : status === 'unresolved' ? 'unknown' : 'cancelled')), 'outcomeCertainty', fixed(status === 'unresolved' ? 'unknown' : 'known')); fields.attempt = replaceField(fields.attempt, 'resultRefs', list(text('result:inspect:001'), [])); if (status === 'unresolved') fields.attempt = replaceField(fields.attempt, 'unresolvedEffectRefs', list(text('effect:inspect:unknown'))); fields.acceptedRevision = count(3); fields.controllerAlreadyAdmitted = fixed(status === 'bound'); fields.replacementLaunchAllowed = fixed(false); fields.executionStartedByThisNode = fixed(false); }
 if (phase === 'review') { fields.attempt = status === 'uncertain' ? replaceField(replaceField(replaceField(planningAttempt, 'status', fixed('unknown')), 'outcomeCertainty', fixed('unknown')), 'unresolvedEffectRefs', list(text('effect:inspect:unknown'))) : planningAttempt; fields.resultRef = text('result:inspect:001'); fields.assessment = replaceField(planningAssessment, 'status', fixed(status === 'late-result' ? 'insufficient' : status)); fields.lateResultRetainedAtOriginalAttempt = fixed(status === 'late-result'); fields.completesReplacement = fixed(false); fields.childrenIndependentlyProveParentGoal = fixed(false); }
 if (phase === 'replan') { fields.policy = planningPolicy; fields.trigger = choice(['observation', 'user-guidance', 'failed-prerequisite', 'evidence-gap']); fields.requestedRevision = status === 'revision-required' ? count(4) : fixed(null); fields.preservedAttemptIds = list(text('attempt:inspect:001')); fields.pendingControlRefs = list(text('control:inspect:cancel:001'), []); fields.requiresModelProposal = fixed(status === 'revision-required'); fields.resetsMainLoopBudget = fixed(false); fields.implicitCancellation = fixed(false); }
 if (phase === 'complete') { fields.goalAssessment = replaceField(planningAssessment, 'status', fixed(status === 'complete' ? 'accepted' : status === 'blocked' ? 'blocked' : status === 'failed' ? 'failed' : 'insufficient')); fields.goalAssessment = replaceField(fields.goalAssessment, 'criterionIds', list(text('criterion:goal:001'))); fields.remainingRequiredTaskIds = list(text('task:synthesize'), status === 'complete' ? [] : ['task:synthesize']); fields.unresolvedEffectRefs = list(text('effect:inspect:unknown'), status === 'blocked' ? ['effect:inspect:unknown'] : []); fields.runningRequiredAttemptIds = list(text('attempt:synthesize:001'), status === 'needs-work' ? ['attempt:synthesize:001'] : []); fields.goalCompleted = fixed(status === 'complete'); fields.publicationPerformed = fixed(false); fields.userStopRespected = fixed(status === 'cancelled'); }
 return object(fields);
}

const branchStatuses: Record<string, string[]> = {
 'policy-load': ['planning'], 'policy-prepare': ['bypass'], 'policy-settle': ['refused'],
 'load-update': ['absent'], 'load-ready': ['found'], 'load-prepare': ['absent'], 'load-wait': ['unavailable'], 'load-complete': ['stale', 'conflict', 'denied'],
 'update-ready': ['applied', 'duplicate', 'conflict', 'invalid'], 'update-wait': ['unknown'],
 'ready-prepare': ['ready'], 'ready-bind': ['ready'], 'ready-wait': ['blocked', 'waiting'], 'ready-complete': ['completion-candidate', 'blocked', 'invalid'],
 'bind-tools': ['bound'], 'bind-subagents': ['bound'], 'bind-controls': ['bound'], 'bind-review': ['refused', 'unresolved', 'stale-revision', 'cancelled'],
 'review-ready': ['accepted'], 'review-update': ['accepted', 'insufficient', 'failed', 'blocked'], 'review-replan': ['insufficient', 'failed', 'blocked', 'late-result'], 'review-complete': ['accepted'], 'review-reconcile': ['uncertain'],
 'replan-update': ['revision-required'], 'replan-ready': ['continue'], 'replan-prepare': ['revision-required'], 'replan-wait': ['user-wait'], 'replan-complete': ['exhausted'],
 'complete-controls': ['partial', 'needs-work'], 'complete-settle': ['complete', 'blocked', 'failed', 'cancelled'], 'complete-wait': ['blocked'],
};
type Edge = { id: string; source: string; target: string };
function statePayload(edge: Edge, outcome?: string): Payload | undefined {
 const route = PLANNING_STATE_ROUTES.find(item => item.id === edge.id || item.returnId === edge.id);
 if (!route) return undefined;
 const inspecting = route.phase === 'inspect-original-plan-command';
 const transactionPhase = inspecting ? 'conditional-plan-command' : route.phase;
 const record = route.phase.includes('binding') ? object({ kind: fixed('task-attempt'), payload: planningAttempt }) : route.phase.includes('assessment') || route.phase.includes('outcome') ? object({ kind: fixed('task-assessment'), payload: planningAssessment }) : route.phase.includes('budget') ? object({ kind: fixed('plan-revision-decision'), policy: planningPolicy, preservedAttemptIds: list(text('attempt:inspect:001')), resetsMainBudget: fixed(false) }) : object({ kind: fixed('task-plan'), payload: planningPlan, originalCommand: planningCommandFor('update_task') });
 const fields = { identity: planningIdentity, requesterNodeId: fixed(route.source), returnToNodeId: fixed(route.returnTarget), requestPhase: fixed(route.phase), transactionId: text(`planning-tx:${transactionPhase}:001`), commandId: text('plan-update:001'), callId: text('call:plan-update:001'), fingerprint: text(`sha256:planning:${transactionPhase}:001`), expectedRevision: count(3), expectedOwnerGeneration: count(2), record, storageOwner: fixed('state'), planSemanticsOwner: fixed('planning'), launchedWork: fixed(false), replaysExternalEffects: fixed(false) };
 if (edge.source.startsWith('lina-state-')) return object({ ...fields, storageOutcome: fixed(outcome ?? 'found'), acknowledgedRevision: ['applied', 'already-applied'].includes(outcome ?? '') ? count(4) : fixed(null), originalIdentityVerified: fixed(true), inspectBeforeRetry: fixed(['unknown', 'still-unknown'].includes(outcome ?? '')), absenceProvesEffectAbsent: fixed(false) });
 return object({ ...fields, command: fixed(route.phase), retriesUseOriginalIdentity: fixed(true), newMutationWhileUnknown: fixed(false) });
}
function dependencyPayload(edge: Edge, outcome?: string): Payload {
 const stored = statePayload(edge, outcome);
 if (stored) return stored;
 if (PLANNING_TOOL_ROUTES.some(route => route.id === edge.id)) return object({ identity: planningIdentity, command: planningCommand, capabilityRef: text('capability:plan-update:v1'), registryRevision: count(7), exactCallId: text('call:plan-update:001'), admittedByTools: fixed(true), grantsActionPermission: fixed(false) });
 if (edge.id === 'lina-planning-edge-update-tools') return object({ identity: planningIdentity, exactCallId: text('call:plan-update:001'), receipt: planningMutationReceipt, valueIsCanonicalPlanReceipt: fixed(true), launchedWork: fixed(false) });
 if (edge.id.includes('context')) return object({ identity: planningIdentity, preparationId: text('prepare:turn-001:round-001:r0'), requesterNodeId: text('lina-context-load'), projection: planningProjection, projectionOnly: fixed(true), mutatesCanonicalState: fixed(false), privateChildPlansIncluded: fixed(false), sourceGenerationRechecked: fixed(true) });
 if (edge.id.includes('safety')) return object({ identity: planningIdentity, policy: planningPolicy, explorationCapabilities: list(text('capability:source-read:v1')), effectfulCallsDeniedInPlanOnly: fixed(true), reviewedRequestFingerprint: text('sha256:planning-policy:001'), policyGeneration: count(2), planAcceptanceGrantsActionPermission: fixed(false), expandsCurrentAuthority: fixed(false) });
 if (edge.id.includes('bind')) return object({ identity: planningIdentity, taskId: text('task:inspect'), attempt: planningAttempt, admittedExecutionRef: text('admission:inspect:001'), originalCallId: text('call:inspect:001'), childTaskRef: sample(nullable(text('child-task:inspect:001')), edge.id.includes('subagents') ? 'child-task:inspect:001' : null), actualExecutionOwner: fixed(edge.id.includes('subagents') ? 'subagents' : 'tools'), operationAlreadyAdmitted: fixed(true), launchByPlanReadiness: fixed(false), immutableInputBindings: list(object({ field: text('sourceFindings'), artifactRef: text('artifact:source-findings:001'), producerAttemptId: text('attempt:source:001'), artifactRevision: count(1) }), []), unknownOriginalCannotBeReplaced: fixed(true) });
 if (edge.id.includes('review') || edge.id.includes('reconcile')) return object({ identity: planningIdentity, taskId: text('task:inspect'), attempt: planningAttempt, observationRef: text('result:inspect:001'), evidenceRefs: list(text('artifact:source-findings:001')), assessment: planningAssessment, outcomeCertainty: choice(['known', 'unknown']), childSuccessIsGoalProof: fixed(false), unresolvedEffectsRemainOwned: fixed(true) });
 if (edge.id.includes('wait')) return object({ identity: planningIdentity, waitId: text(`wait:planning:${edge.target}:001`), waitRevision: count(1), owner: fixed('planning'), continuationNodeId: text(edge.source === 'lina-execution-wait' ? edge.target : edge.source), reason: choice(['dependency-pending', 'saved-plan-unavailable', 'original-write-unknown', 'plan-review', 'user-guidance']), matchedOriginalEventRequired: fixed(true), grantsExecutionPermission: fixed(false), timeoutImpliesSuccess: fixed(false), pausedPlanAutoResumes: fixed(false) });
 return object({ identity: planningIdentity, scope: planningScope, policy: planningPolicy, planRef: text('state:plan:review:r3'), currentRevision: count(3), activeAttemptIds: list(text('attempt:inspect:001'), []), unresolvedEffectRefs: list(text('effect:inspect:unknown'), []), parentTurnId: text('turn:main:001'), externalEvidenceGrantsPermission: fixed(false), preservesMainLoopCounters: fixed(true), replaysCompletedOperations: fixed(false) });
}
for (const edge of PLANNING_EDGES) {
 const definition = planningTaskContracts.find(item => item.nodeId === edge.source);
 if (!definition) continue;
 const phase = edge.source.replace('lina-planning-', '');
 const short = edge.id.replace('lina-planning-edge-', '');
 // Storage and capability replies are exact dependency payloads. Loop exits still
 // carry phase-specific status; otherwise a generic receipt could imply success.
 const dependency = PLANNING_STATE_ROUTES.some(route => route.id === edge.id) || short.includes('context') || short.includes('safety') || short === 'update-tools';
 if (dependency) definition.outputs.push(output(`planning.${phase}.${short}`, `${phase}: exact dependency handoff`, dependencyPayload(edge), [edge.id], 'Preserve original command, accepted scope and requester. A receipt or projection launches no work.'));
 else for (const status of branchStatuses[short] ?? planningStatuses[phase]) {
  let body = planningPhasePayload(phase, status);
  if (short === 'load-update' || short === 'review-update' || short === 'replan-update') body = object({ phaseOutcome: body, command: planningCommandFor(short === 'load-update' ? 'create_plan' : short === 'review-update' ? 'record_assessment' : 'revise_plan'), commandAlreadyAdmitted: fixed(true), expectedRevision: count(3), launchOnMutation: fixed(false) });
  if (short === 'ready-bind' || short === 'bind-tools' || short === 'bind-subagents') body = object({ phaseOutcome: body, binding: dependencyPayload(edge), grantsExecutionPermission: fixed(false) });
  definition.outputs.push(output(`planning.${phase}.${status}.${short}`, `${phase}: ${status}`, body, [edge.id], 'Only the named phase outcome follows this route. Preserve assessed revision and original attempts.'));
 }
}
/** Existing owners expose exact handoffs without replacing their original records. */
export function attachPlanningProducerHandoffs(definitions: ContractDefinition[]): void {
 for (const edge of PLANNING_EDGES.filter(item => !item.source.startsWith('lina-planning-'))) {
  const source = definitions.find(item => item.nodeId === edge.source);
  if (!source) throw new Error(`Missing Planning producer ${edge.source}`);
  const route = PLANNING_STATE_ROUTES.find(item => item.returnId === edge.id);
  const statuses = route ? route.kind === 'record' ? ['applied', 'already-applied', 'conflict', 'failed', 'unknown'] : route.phase.startsWith('inspect') ? ['found', 'absent', 'still-unknown', 'unavailable'] : ['found', 'missing', 'stale', 'unavailable', 'denied'] : [undefined];
  for (const status of statuses) source.outputs.push(output(`planning.handoff.${edge.id}${status ? `.${status}` : ''}`, `Planning ${status ?? 'request or continuation'}`, dependencyPayload(edge, status), [edge.id], 'Return only to the correlated scoped planning phase; retain identity and current authority.'));
 }
}
planningTaskContracts.find(item => item.nodeId === 'lina-planning-policy')!.external = [{ label: 'Admitted goal and planning preference', source: 'User request and trusted harness policy', value: object({ goalId: text('goal:review:001'), goal: text('Review the change and report supported findings.'), scope: planningScope, policy: planningPolicy }) }];
planningTaskContracts.find(item => item.nodeId === 'lina-planning-update')!.external = planningCommandVariants.map(value => ({ label: `Admitted ${String((value.example as Record<string, import('./schema').Json>).operation)} command`, source: 'Registered plan capability after Tools admission', value }));
for (const definition of planningTaskContracts) definition.contextExamples = [
 { label: 'Direct loop with no canonical plan', value: replaceField(replaceField(planningLocalContext, 'currentPlan', fixed(null)), 'policy', replaceField(planningPolicy, 'strategy', fixed('direct'))) },
 { label: 'Plan-only admits exploration, not task effects', value: replaceField(planningLocalContext, 'policy', replaceField(planningPolicy, 'executionMode', fixed('plan-only'))) },
 { label: 'Required plan with review before execution', value: replaceField(planningLocalContext, 'policy', replaceField(replaceField(planningPolicy, 'executionMode', fixed('review-before-execution')), 'requirement', fixed('plan-first'))) },
 { label: 'Unknown effect remains visible', value: replaceField(planningLocalContext, 'unresolvedEffectRefs', list(text('effect:inspect:unknown'))) },
 { label: 'Fresh child-local scope has no parent plan', value: replaceField(replaceField(replaceField(planningLocalContext, 'scope', replaceField(replaceField(planningScope, 'agentId', text('lina-child:001')), 'historyBranchRef', text('history:child:001'))), 'currentPlan', fixed(null)), 'projection', fixed(null)) },
];
