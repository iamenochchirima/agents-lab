import type { LinaDocument, LinaNode } from './linaModel';

export type StateRequestKind = 'load' | 'record' | 'checkpoint';
export interface StateRequestRoute {
  id: string; source: string; target: string; kind: StateRequestKind; phase: string;
  returnId: string; returnTarget: string;
}
const request = (short: string, source: string, kind: StateRequestKind, phase: string, returnTarget = source): StateRequestRoute => ({
  id: `lina-state-edge-${short}-${kind}`, source, target: `lina-state-${kind}`, kind, phase,
  returnId: `lina-state-edge-${kind}-${short}`, returnTarget,
});

/** Phase identifies the continuation inside a requester. A saved outcome returns
 * to its recorder; it never recursively restarts that requester's external effect.
 * Recovery reads alone enter Recover, while ordinary reads return to their owner. */
export const STATE_REQUEST_ROUTES: readonly StateRequestRoute[] = [
  request('claim', 'lina-input-claim', 'record', 'claim-input'),
  request('claim', 'lina-input-claim', 'load', 'inspect-claim-transaction'),
  request('accept', 'lina-input-accept', 'record', 'commit-acceptance'),
  request('accept', 'lina-input-accept', 'load', 'inspect-acceptance'),
  request('delivery', 'lina-input-delivery', 'load', 'inspect-delivery'),
  request('delivery', 'lina-input-delivery', 'record', 'record-delivery'),
  request('duplicate', 'lina-input-duplicate', 'load', 'inspect-duplicate'),
  request('claim-recovery', 'lina-input-claim-recovery', 'load', 'inspect-claim'),
  request('queue', 'lina-input-queue', 'record', 'queue-mutation'),
  request('queue', 'lina-input-queue', 'load', 'select-queue'),
  request('admission', 'lina-input-admission', 'record', 'acquire-owner'),
  request('release', 'lina-execution-release', 'record', 'release-owner'),
  request('wait', 'lina-execution-wait', 'record', 'persist-wait'),
  request('grants', 'lina-safety-grants', 'load', 'inspect-grants'),
  request('grants', 'lina-safety-grants', 'record', 'commit-grants'),
  request('context', 'lina-context-load', 'load', 'read-history'),
  request('dispatch', 'lina-tools-dispatch', 'record', 'record-tool-intent'),
  request('collect', 'lina-tools-collect', 'record', 'record-tool-outcome'),
  request('model-invoke', 'lina-model-invoke', 'record', 'record-model-intent'),
  request('model-normalize', 'lina-model-normalize', 'record', 'record-model-outcome'),
  request('settle', 'lina-execution-settle', 'record', 'settle-turn'),
  request('cancel', 'lina-execution-cancel', 'record', 'persist-stop'),
  request('reconcile', 'lina-input-reconcile', 'record', 'record-reconciliation'),
  request('controls', 'lina-execution-controls', 'checkpoint', 'round-boundary'),
  request('outcomes', 'lina-execution-tool-outcomes', 'checkpoint', 'tool-boundary'),
  request('wait', 'lina-execution-wait', 'checkpoint', 'wait-boundary'),
  request('settle', 'lina-execution-settle', 'checkpoint', 'terminal-boundary'),
  { ...request('recovery', 'lina-input-recovery', 'load', 'read-recovery', 'lina-state-recover'), returnId: 'lina-state-edge-recovery-ready' },
  request('recover', 'lina-state-recover', 'load', 'inspect-recovery'),
  request('recover', 'lina-state-recover', 'record', 'reacquire-owner'),
];
const references = 'docs/research/lina/state-persistence-research.md; state-existing-design-audit.md; state-hermes-openclaw.md; state-pi-waku.md. State records and restart transitions are deterministic design fixtures, not a deployed durable execution service.';
const node = (id: string, title: string, x: number, y: number, purpose: string, inputs: string, outputs: string, decisions: string, experiments: string): LinaNode => ({
  id: `lina-state-${id}`, title, area: 'State, persistence and recovery', status: 'proposed', x, y, purpose, inputs, outputs, decisions, references, experiments,
});

/** State supplies conditional storage and checkpoint manifests. Input and Execution
 * keep admission, wait and effect reconciliation decisions. Memory owns knowledge;
 * telemetry projections and stored credentials do not become execution authority. */
export const linaStateBlock: LinaDocument = {
  version: 1,
  nodes: [
    node('load', 'Load state', 80, 8500, 'Read scoped versioned records or inspect the outcome of an original transaction.', 'Correlated read request: record kind, scope, selection/revision, transaction identity and requester phase.', 'Found, missing, incompatible, corrupt or unavailable; original record and revision references.', 'Missing differs from unavailable. Bounded history selection preserves original identity. Inspect lost acknowledgments by the original transaction ID and fingerprint. Ordinary reads return to the requester; only recovery-specific reads enter recovery. Safe credential references only.', 'Compare indexed journal reads with snapshot reads under identical consistency and selection requirements.'),
    node('record', 'Record state', 500, 8500, 'Persist scoped observations and conditional lifecycle changes under stable transaction identity.', 'Claim, receipt, queue, owner, wait, grant, Stop, operation intent/result or settlement command; expected revision/fence and fingerprint.', 'Applied, already-applied, conflict, failed or unknown; acknowledged revision and commit evidence.', 'Same identity with changed contents conflicts. Owner acquire/renew/release compares revision and execution fence. Required record sets need an acknowledged atomic boundary. Persist intent before launch and result after observation; unknown write acknowledgment is inspected before retry. A recorded intent alone proves neither launch nor absence of effect.', 'Compare journal plus snapshots with transactional records; retain the same duplicate, fence and acknowledgment semantics.'),
    node('checkpoint', 'Create execution checkpoint', 80, 8780, 'Publish a coherent versioned manifest at an explicitly requested safe execution boundary.', 'Exact turn/round counters, record revisions, safe resume entry, Context/artifact references, waits, settled siblings, unresolved work and Stop intent.', 'Committed, already-committed, incomplete, conflict, failed or unknown checkpoint publication.', 'Only committed manifests become recovery candidates. Validate required references and compatibility. Partial fragments are not a usable checkpoint. A generic Record acknowledgment does not trigger Checkpoint. Unknown publication acknowledgment requires inspection of the same ID before retry.', 'Compare checkpoint cadence and commit modes while exposing their actual recoverable progress and latency.'),
    node('recover', 'Recover execution', 500, 8780, 'Validate saved execution, inspect uncertainty and reacquire ownership before proposing continuation to Input recovery.', 'Recovery-specific checkpoint read; current compatibility, policy/binding generations, transaction evidence and conditional owner reacquisition result.', 'Resume, restore-waits, reconcile, required-review or reject; original work identities and new owner revision/fence.', 'Reject incompatible or incomplete evidence and conflicts with a live newer owner. Restored waits retain exact correlation and settled siblings remain settled. Stop blocks fresh launches. Session grants expire across restart and persistent grants require revalidation. Unknown effects enter the existing reconciliation owner; this node never dispatches tools or models.', 'Compare recovery selection and checkpoint frequency under deterministic crash positions, not simulated performance claims.'),
  ],
  edges: [
    ...STATE_REQUEST_ROUTES.flatMap(route => [
      { id: route.id, source: route.source, target: route.target, label: `${route.phase}; correlated ${route.kind} request` },
      { id: route.returnId, source: route.target, target: route.returnTarget, label: `${route.phase}; same request outcome / revision` },
    ]),
    { id: 'lina-state-edge-recovery-plan', source: 'lina-state-recover', target: 'lina-input-recovery', label: 'validated recovery plan; resume / waits / reconcile / review / reject' },
  ],
};
