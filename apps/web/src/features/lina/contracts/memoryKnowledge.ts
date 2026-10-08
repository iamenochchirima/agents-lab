import { MEMORY_EDGES, MEMORY_STATE_ROUTES } from '../memoryBlock';
import { choice, count, fixed, flag, list, nullable, object, replaceField, sample, text, type ContractDefinition, type Payload } from './schema';
import { output } from './schema';
import { memoryCandidate, memoryCorrelation, memoryEvidence, memoryForgetPlan, memoryKnowledge, memoryKnowledgeVariants, memoryLocalContext, memoryMutation, memoryQuery, memoryRetrieved, memorySelection, memoryTransaction } from './memoryRecords';

const ids = ['scope', 'query', 'retrieve', 'select', 'capture', 'extract', 'validate', 'resolve', 'commit', 'index', 'consolidate', 'forget'];
const rules: Record<string, string[]> = {
 scope: ['Resolve read, propose, commit, forget and maintenance independently against current principal and namespace policy. Private is the default.', 'Child delegation is explicit and bounded. A child proposal cannot publish into shared parent knowledge without review.', 'Every return retains the original request and continuation; a response never broadens access.'],
 query: ['Profile and exact lookup may bypass query rewriting. Preserve the original query and any rewrite provenance.', 'No recall needed is a legitimate outcome, distinct from failed retrieval. Query generation does not change visibility.'],
 retrieve: ['Use bounded access-checked authoritative records or a declared derived-index watermark. Empty matches are distinct from stale index and unavailable backend.', 'Exact reads may bypass semantic ranking, but never retirement, revision or visibility checks. Do not initialize an empty memory store after a failed read.'],
 select: ['Deduplicate and rank only permitted current evidence within its budget. Retired, forgotten or newly revoked data cannot enter a fresh selection.', 'Selection is evidence, not system instruction authority. Context owns final assembly and model-visible budget.', 'Revalidate the visibility generation before a new invocation; already issued snapshots remain historical execution evidence.'],
 capture: ['Bind source identity, revision, authority, sensitive-data class and allowed extraction egress before any extraction call.', 'A model interpretation, external instruction or recalled memory cannot become an independent user assertion by passing through extraction.', 'Exclude credentials and disallowed retention. Explicit structured writes bypass extraction only after the same evidence admission.'],
 extract: ['Propose facts, episodes and derived procedures from admitted evidence. Generated output is a candidate, never permission to persist.', 'Explicit structured writes require no extraction model call. Automatic candidates still need validation and semantic change resolution.', 'Cancellation or no eligible observations produces no new committed knowledge. Procedures do not become executable skills automatically.'],
 validate: ['Validate scope, source binding, retention, sensitivity and current policy independently of extractor fluency.', 'Parent publication review and Safety permission are distinct from semantic validity. Pending review cannot commit.', 'Historical and current assertions must retain their evidence and time semantics.'],
 resolve: ['Compare expected current revisions and temporal claims. Exact duplicates become no-op; explicit corrections supersede rather than erase history.', 'Preserve ambiguous contradictions as disputed claims. Newer prose alone does not authorize a silent overwrite.', 'Forgetting uses revocation and deletion, separate from supersession and relevance decay.'],
 commit: ['Use stable transaction identity, fingerprint, expected revisions and a supported all-mutations commit boundary. State acknowledges persistence; Memory owns semantic decisions.', 'Unknown acknowledgment requires inspection of the original transaction before any retry. Same identity and changed contents conflict.', 'Policy, visibility and Stop must be rechecked before commit. A committed record may remain unsearchable until the index catches up.'],
 index: ['Indexes are rebuildable derivatives, never authoritative records. Apply exact revisions and visibility generations.', 'Direct record/file reads may need no index. Pending or failed index publication does not undo a known record commit.', 'Revoked knowledge remains excluded even while index cleanup is pending.'],
 consolidate: ['Maintenance is optional, bounded and cancellable. Disabled maintenance performs no model work.', 'Derived summaries and procedures preserve evidence lineage and re-enter validation/resolution; maintenance cannot directly overwrite knowledge.', 'Recheck deletion generations before publication so delayed jobs cannot resurrect forgotten content.'],
 forget: ['Authorized forgetting immediately revokes fresh recall of targets and affected descendants, fences pending jobs and invalidates selections.', 'Physical cleanup reports covered records, summaries, indexes, caches and configured replicas separately from exclusions and retained backups.', 'A content-free tombstone may block resurrection. Do not promise global erasure or rollback already issued historical model requests.'],
};
export const memoryKnowledgeContracts: ContractDefinition[] = ids.map(id => ({ nodeId: `lina-memory-${id}`, context: memoryLocalContext, contextSource: 'Trusted design coordinator supplies the current policy, visibility and namespace revisions. Records and backends are deterministic fixtures, not installed live storage.', reads: ['Scoped correlated request, current generations and evidence lineage'], writes: ['Phase-specific memory response with explicit continuation and outcome'], rules: rules[id], outputs: [] }));

const correlationFor = (purpose: string, nodeId: string): Payload => replaceField(memoryCorrelation, 'requester', object({ nodeId: text(nodeId), purpose: fixed(purpose), continuationRef: text('continuation:memory:001') }));
const phaseCorrelation = (phase: string): Payload => ['scope', 'query', 'retrieve', 'select'].includes(phase) ? memoryCorrelation : correlationFor(phase === 'forget' ? 'forget' : phase === 'consolidate' ? 'maintenance' : 'explicit-write', 'lina-tools-dispatch');

const statusByNode: Record<string, string[]> = {
 scope: ['admitted', 'denied', 'unavailable'], query: ['ready', 'not-needed', 'invalid', 'cancelled'], retrieve: ['found', 'empty', 'stale', 'unavailable', 'denied'], select: ['selected', 'empty', 'revoked', 'budget-exhausted'], capture: ['eligible', 'rejected', 'no-op', 'egress-blocked'], extract: ['candidates', 'no-op', 'cancelled', 'failed'], validate: ['eligible', 'rejected', 'needs-review', 'stale-policy'], resolve: ['resolved', 'no-op', 'disputed', 'stale'], commit: ['applied', 'already-applied', 'conflict', 'failed', 'unknown', 'cancelled'], index: ['ready', 'pending', 'failed', 'not-required'], consolidate: ['candidates', 'disabled', 'no-op', 'cancelled', 'failed', 'revoked'], forget: ['planned', 'logically-removed', 'purge-pending', 'erased-within-coverage', 'denied', 'unknown'],
};
/** Payload identity survives every branch. The graph inspector sees both the
 * request mode and the phase artifact, including non-success returns. */
export function memoryPhasePayload(phase: string, status: string): Payload {
 const fields: Record<string, Payload> = { correlation: phaseCorrelation(phase), phase: fixed(phase), status: fixed(status), scopeRechecked: fixed(true), continuationGrantedBroaderAccess: fixed(false) };
 if (phase === 'scope') fields.access = object({ decision: fixed(status), generation: count(3), childAccessExplicit: fixed(true), sharedPublicationRequiresParentReview: fixed(true) });
 if (phase === 'query' || phase === 'retrieve') fields.query = memoryQuery;
 if (phase === 'retrieve') {
  fields.candidates = list(memoryRetrieved, status === 'found' ? [memoryRetrieved.example] : []);
  fields.index = object({ generation: count(6), authoritativeWatermark: count(2), searchableWatermark: count(status === 'stale' ? 1 : 2), matchesMeanCompleteStore: fixed(false) });
  fields.failedReadMayInitializeEmptyStore = fixed(false);
 }
 if (phase === 'select') fields.selection = status === 'selected' ? memorySelection : object({ selectionId: text('memory-selection:001'), records: list(memoryRetrieved, []), visibilityGeneration: count(status === 'revoked' ? 8 : 7), recheckBeforeNewInvocation: fixed(true), contextOwnsFinalModelBudget: fixed(true) });
 if (['capture', 'extract', 'validate', 'consolidate'].includes(phase)) {
  fields.evidence = list(memoryEvidence, ['rejected', 'no-op', 'egress-blocked', 'disabled', 'cancelled', 'failed', 'revoked'].includes(status) ? [] : [memoryEvidence.example]);
  fields.candidates = list(memoryCandidate, ['candidates', 'eligible', 'needs-review'].includes(status) ? memoryKnowledgeVariants.map(knowledge => replaceField(memoryCandidate, 'proposedKnowledge', knowledge).example) : []);
  fields.modelEgressAuthorized = flag(status !== 'egress-blocked');
  fields.generatedTextGrantsWritePermission = fixed(false);
  fields.pendingJobsMayIgnoreDeletionFence = fixed(false);
 }
 if (phase === 'resolve') {
  fields.mutations = list(memoryMutation, status === 'resolved' ? [memoryMutation.example] : []);
  fields.conflict = status === 'disputed' ? object({ conflictId: text('memory-conflict:001'), recordRefs: list(text('memory:preference:001')), preserveBothClaims: fixed(true), silentNewestWins: fixed(false) }) : fixed(null);
 }
 if (phase === 'commit') {
  const known = ['applied', 'already-applied'].includes(status);
  fields.transaction = memoryTransaction;
  fields.acknowledgedRevision = known ? count(5) : fixed(null);
  fields.recordCommitted = fixed(known);
  fields.searchable = fixed(false);
  fields.inspectBeforeRetry = fixed(status === 'unknown');
  fields.permissionToRepeatUnknownMutation = fixed(false);
 }
 if (phase === 'index') fields.indexReceipt = object({ transactionId: text('memory-tx:001'), generation: count(7), authoritativeWatermark: count(5), searchableWatermark: count(status === 'ready' || status === 'not-required' ? 5 : 4), recordCommitUndone: fixed(false), forgottenRecordsEligibleDuringCleanup: fixed(false) });
 if (phase === 'consolidate') fields.maintenance = object({ jobId: text('memory-job:001'), enabled: fixed(status !== 'disabled'), maxRecords: count(20), maxModelAttempts: count(1), actualModelAttempts: count(['disabled', 'no-op', 'cancelled', 'revoked'].includes(status) ? 0 : 1), generationAtStart: count(7), publishRequiresCurrentGeneration: fixed(true), directlyCommits: fixed(false) });
 if (phase === 'forget') {
  fields.plan = status === 'erased-within-coverage' ? replaceField(memoryForgetPlan, 'pendingCleanupRefs', list(text('cleanup:index:001'), [])) : memoryForgetPlan;
  fields.revocationAcknowledged = fixed(['logically-removed', 'purge-pending', 'erased-within-coverage'].includes(status));
  fields.cleanupCompleteWithinCoverage = fixed(status === 'erased-within-coverage');
  fields.pendingCleanupRefs = list(text('cleanup:index:001'), status === 'erased-within-coverage' ? [] : ['cleanup:index:001']);
  fields.excludedCopiesStillReported = fixed(true);
 }
 return object(fields);
}

const transactionPhase = (phase: string): string => ({ 'inspect-memory-transaction': 'commit-memory-mutation', 'inspect-memory-revocation': 'revoke-memory-visibility' } as Record<string, string>)[phase] ?? phase;
const requestPayload = (edge: { id: string; source: string; target: string }, storageOutcome?: string): Payload => {
 if (edge.source === 'lina-execution-cancel') return object({ correlation: phaseCorrelation(edge.target.replace('lina-memory-', '')), stopId: text('stop:memory:001'), admissionGeneration: count(8), operationId: text('memory-operation:001'), cancelUnstartedWork: fixed(true), invalidatePendingExtraction: fixed(true), rollbackAcknowledgedMemoryWrites: fixed(false), unresolvedCommitRequiresInspection: fixed(true), immediateRecallRevocationMayBeUndone: fixed(false) });
 if (edge.source === 'lina-execution-wait') return object({ correlation: correlationFor('explicit-write', 'lina-tools-dispatch'), waitId: text('wait:memory-parent-review:001'), promptId: text('parent-review:memory:001'), candidateRef: text('memory-candidate:001'), expectedCandidateRevision: count(1), eligibleResponderRef: text('agent:lina-main'), decision: choice(['approve-publication', 'deny-publication', 'expired', 'cancelled']), publicationNamespaceId: text('workspace:demo'), sourceChildAgentId: text('lina-child:001'), currentScopeMustBeRechecked: fixed(true), grantsAnyToolPermission: fixed(false) });
 const stateRoute = MEMORY_STATE_ROUTES.find(route => route.id === edge.id || route.returnId === edge.id);
 if (stateRoute) {
  const phase = stateRoute.phase;
  const txPhase = transactionPhase(phase);
  const base = { correlation: memoryCorrelation, requesterNodeId: fixed(stateRoute.source), returnToNodeId: fixed(stateRoute.returnTarget), requestPhase: fixed(phase), transactionId: text(`memory-tx:${txPhase}:001`), requestFingerprint: text(`sha256:fixture-memory:${txPhase}`), expectedNamespaceRevision: count(4), executionFence: count(8), visibilityGeneration: count(7), containsCredentials: fixed(false) };
  if (edge.source.startsWith('lina-state-')) {
   const status = storageOutcome ?? (stateRoute.kind === 'record' ? 'applied' : 'found');
   const known = ['applied', 'already-applied'].includes(status);
   return object({ ...base, storageOutcome: fixed(status), acknowledgedRevision: known ? count(5) : fixed(null), records: list(memoryKnowledge, status === 'found' ? [memoryKnowledge.example] : []), commitEvidenceRef: known ? text(`commit-evidence:${txPhase}:001`) : fixed(null), inspectBeforeRetry: fixed(status === 'unknown' || status === 'still-unknown'), recordsSearchable: fixed(false), semanticAdmissionOwnedByMemory: fixed(true), originalIdentityVerified: fixed(true), absenceProvesExternalEffectAbsence: fixed(false) });
  }
  return object({ ...base, command: fixed(phase), transaction: stateRoute.kind === 'record' ? replaceField(replaceField(replaceField(memoryTransaction, 'transactionId', base.transactionId), 'requestFingerprint', base.requestFingerprint), 'mutationSet', list(memoryMutation, phase === 'commit-memory-mutation' ? [memoryMutation.example] : [])) : fixed(null), recordKinds: list(choice(['memory-knowledge', 'memory-visibility', 'memory-transaction', 'memory-index-watermark', 'memory-maintenance', 'memory-purge-receipt']), [phase.includes('visibility') || phase.includes('revocation') ? 'memory-visibility' : phase.includes('inspect') ? 'memory-transaction' : phase.includes('index') ? 'memory-index-watermark' : phase.includes('maintenance') ? 'memory-maintenance' : phase.includes('purge') ? 'memory-purge-receipt' : 'memory-knowledge']), mutations: list(memoryMutation, phase === 'commit-memory-mutation' ? [memoryMutation.example] : []), recordPayload: phase.includes('index') ? object({ kind: fixed('memory-index-watermark'), namespaceId: text('user:demo'), generation: count(7), authoritativeWatermark: count(5), searchableWatermark: count(4) }) : phase.includes('maintenance') ? object({ kind: fixed('memory-maintenance'), jobId: text('memory-job:001'), cursor: text('cursor:20'), sourceRevision: count(4), deletionFence: count(7) }) : phase.includes('purge') ? object({ kind: fixed('memory-purge-receipt'), deletionId: text('forget:001'), coverageComplete: fixed(false), pendingCleanupRefs: list(text('cleanup:index:001')) }) : phase.includes('visibility') || phase.includes('revocation') ? object({ kind: fixed('memory-visibility'), plan: memoryForgetPlan, previousGeneration: count(7), revokedGeneration: count(8) }) : memoryKnowledge, deletionPlan: phase.includes('deletion') || phase.includes('revocation') || phase.includes('visibility') || phase.includes('purge') ? memoryForgetPlan : fixed(null), inspectOriginalIdentity: fixed(true), requiredCommitBoundary: fixed(phase === 'commit-memory-mutation' ? 'all-listed-memory-mutations' : 'all-listed-phase-records'), credentialsIncluded: fixed(false) });
 }
 if (edge.target.startsWith('lina-model-') || edge.source.startsWith('lina-model-')) {
  const purpose = edge.id.includes('consolidate') ? 'memory-consolidation' : 'memory-extraction';
  const response = edge.source.startsWith('lina-model-');
  return object({ correlation: phaseCorrelation(purpose.endsWith('consolidation') ? 'consolidate' : 'extract'), purpose: fixed(purpose), memoryOperationId: text(`memory-operation:${purpose}:001`), preparationId: text(`memory-preparation:${purpose}:001`), returnToNodeId: fixed(`lina-memory-${purpose.endsWith('consolidation') ? 'consolidate' : 'extract'}`), admittedSourceEvidence: list(memoryEvidence), egressPolicy: fixed('local-only-or-approved-model-provider'), requestedOutputSchemaRevision: fixed('memory-candidates:v1'), separateBudget: object({ owner: fixed('Memory'), maxAttempts: count(1), maxInputTokens: count(1200), maxOutputTokens: count(600) }), consumesMainAgentRound: fixed(false), physicalAttemptAccountedSeparately: fixed(true), candidates: list(memoryCandidate, response ? [memoryCandidate.example] : []), outcome: response ? choice(['candidates', 'no-op', 'malformed', 'failed', 'cancelled', 'unknown']) : fixed('requested'), extractorAuthorizesPersistence: fixed(false), modelToolsAllowed: fixed(false) });
 }
 if (edge.source.startsWith('lina-safety-')) return object({ correlation: memoryCorrelation, permissionDecision: choice(['allow-once', 'allow-session', 'allow-always', 'deny']), permissionEvidenceRef: text('safety-decision:memory:001'), policyGeneration: count(3), reviewedFingerprint: text('sha256:fixture-memory-mutations'), childPublicationReviewRef: nullable(text('parent-review:001')), permissionGrantsSemanticTruth: fixed(false) });
 if (edge.target.startsWith('lina-safety-')) return object({ correlation: memoryCorrelation, operation: fixed('memory-mutation'), mutationSet: list(memoryMutation), requestFingerprint: text('sha256:fixture-memory-mutations'), visibilityGeneration: count(7), semanticValidationComplete: fixed(true), implicitApprovalFromExtractor: fixed(false) });
 const mode = edge.source === 'lina-execution-settle' ? 'automatic-write' : 'search';
 return object({ correlation: correlationFor(mode, edge.source), requestMode: choice(['profile', 'search', 'exact-read', 'explicit-write', 'automatic-write', 'correction', 'forget', 'maintenance'], mode), query: memoryQuery, evidence: list(memoryEvidence), explicitCandidate: sample(nullable(memoryCandidate), null), forgetTargets: list(text('memory:preference:001'), []), originalRequesterNodeId: fixed(edge.source), required: flag(false), scopePolicySuppliedByTrustedCoordinator: fixed(true) });
};

/** Successful phase continuations and requester returns are different paths.
 * Failure outcomes must not accidentally become extraction, commit or launch. */
function statusesForEdge(edge: { id: string; source: string; target: string }): string[] {
 const phase = edge.source.replace('lina-memory-', '');
 const localSuccess: Record<string, string[]> = {
  'scope-query': ['admitted'], 'query-retrieve': ['ready'], 'scope-retrieve': ['admitted'], 'retrieve-select': ['found', 'empty', 'stale', 'unavailable', 'denied'],
  'scope-capture': ['admitted'], 'capture-extract': ['eligible'], 'capture-validate': ['eligible'], 'extract-validate': ['candidates'], 'validate-resolve': ['eligible'], 'resolve-commit': ['resolved'], 'commit-index': ['applied', 'already-applied'],
  'scope-consolidate': ['admitted'], 'consolidate-validate': ['candidates'], 'scope-forget': ['admitted'], 'forget-resolve': ['logically-removed'], 'index-forget': ['ready', 'pending', 'failed', 'not-required'], 'forget-index': ['logically-removed', 'purge-pending'],
  'validate-parent-wait': ['needs-review'], 'index-context': ['ready', 'pending', 'failed', 'not-required'], 'forget-context': ['logically-removed', 'purge-pending', 'erased-within-coverage'],
 };
 const short = edge.id.replace('lina-memory-edge-', '');
 if (localSuccess[short]) return localSuccess[short];
 if (short.endsWith('-cancel')) return (statusByNode[phase] ?? []).filter(status => ['cancelled', 'unknown', 'applied', 'already-applied', 'purge-pending', 'logically-removed', 'erased-within-coverage'].includes(status));
 return statusByNode[phase];
}
for (const edge of MEMORY_EDGES) {
 const definition = memoryKnowledgeContracts.find(node => node.nodeId === edge.source);
 if (!definition) continue;
 const phase = edge.source.replace('lina-memory-', '');
 const transport = edge.target.startsWith('lina-state-') || edge.target.startsWith('lina-safety-') || edge.target.startsWith('lina-model-');
 if (transport) definition.outputs.push(output(`memory.${phase}.${edge.id}`, `${phase}: dependency request`, requestPayload(edge), [edge.id], 'Correlated dependency request; requester retains semantic and continuation ownership.'));
 else for (const status of statusesForEdge(edge)) {
  let value = memoryPhasePayload(phase, status);
  if (edge.target === 'lina-tools-collect') value = replaceField(value, 'correlation', correlationFor(['scope', 'query', 'retrieve', 'select'].includes(phase) ? 'search' : phase === 'forget' ? 'forget' : phase === 'consolidate' ? 'maintenance' : 'explicit-write', 'lina-tools-dispatch'));
  if (edge.target === 'lina-execution-settle') value = replaceField(value, 'correlation', correlationFor('automatic-write', 'lina-execution-settle'));
  definition.outputs.push(output(`memory.${phase}.${status}.${edge.id}`, `${phase}: ${status}`, value, [edge.id], 'Follow this path only for its original request purpose and this phase outcome.'));
 }
}

/** Existing producers retain their own runtime lifecycle. Memory capability
 * adapters return through the original Context, Tools or maintenance owner. */
export function attachMemoryProducerHandoffs(definitions: ContractDefinition[]): void {
 for (const edge of MEMORY_EDGES) {
  if (edge.source.startsWith('lina-memory-')) continue;
  const source = definitions.find(node => node.nodeId === edge.source);
  if (!source) throw new Error(`Missing Memory producer ${edge.source}`);
  const stateRoute = MEMORY_STATE_ROUTES.find(route => route.returnId === edge.id);
  const statuses = stateRoute ? stateRoute.kind === 'record' ? ['applied', 'already-applied', 'conflict', 'failed', 'unknown'] : stateRoute.phase.startsWith('inspect') ? ['applied', 'absent', 'still-unknown', 'unavailable'] : ['found', 'missing', 'stale', 'unavailable', 'denied'] : [undefined];
  for (const status of statuses) source.outputs.push(output(`memory.handoff.${edge.id}${status ? `.${status}` : ''}`, `Memory ${status ?? 'request or continuation'}`, requestPayload(edge, status), [edge.id], 'Preserve request identity, scope generations and original continuation.'));
 }
}

// Explicit maintenance control is outside ordinary conversational input. It is
// shown as an external schema, not an installed scheduler or backend operation.
memoryKnowledgeContracts.find(node => node.nodeId === 'lina-memory-scope')!.external = ['profile', 'search', 'exact-read', 'explicit-write', 'automatic-write', 'correction', 'forget', 'maintenance'].map(mode => ({ label: `Scoped ${mode} request`, source: 'Trusted design fixture coordinator or admitted memory capability', value: object({ correlation: correlationFor(mode, mode === 'automatic-write' ? 'lina-execution-settle' : ['profile', 'search', 'exact-read'].includes(mode) ? 'lina-context-load' : 'lina-tools-dispatch'), mode: fixed(mode), query: memoryQuery, sourceEvidence: list(memoryEvidence), candidates: list(memoryCandidate, ['explicit-write', 'correction'].includes(mode) ? [memoryCandidate.example] : []), authorizedForgetTargets: list(text('memory:preference:001'), mode === 'forget' ? ['memory:preference:001'] : []), enabledMaintenance: fixed(mode === 'maintenance') }) }));
