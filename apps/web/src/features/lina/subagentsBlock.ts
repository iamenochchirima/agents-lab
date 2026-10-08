import type { LinaDocument, LinaNode } from './linaModel';
import type { StateRequestRoute } from './stateBlock';

/** Delegation and later lifecycle controls are distinct operations. Responses
 * preserve parent agent, tool-call and operation identities even after a restart. */
export const SUBAGENT_REQUEST_ROUTES = [
  { id: 'lina-subagents-edge-tools-request', source: 'lina-tools-dispatch', target: 'lina-subagents-validate', phase: 'delegation-or-session-control', returnId: 'lina-subagents-edge-return-tools', returnSource: 'lina-subagents-return', returnTarget: 'lina-tools-collect' },
] as const;
const storage = (short: string, source: string, kind: StateRequestRoute['kind'], phase: string): StateRequestRoute => ({ id: `lina-subagents-edge-${short}-state-${kind}`, source: `lina-subagents-${source}`, target: `lina-state-${kind}`, kind, phase, returnId: `lina-subagents-edge-state-${kind}-${short}`, returnTarget: `lina-subagents-${source}` });
export const SUBAGENT_STATE_ROUTES: readonly StateRequestRoute[] = [
  storage('validate', 'validate', 'record', 'reserve-delegation-capacity'),
  storage('validate-inspect', 'validate', 'load', 'inspect-task-tree-reservation'),
  storage('prepare', 'prepare', 'record', 'record-immutable-child-packet'),
  storage('prepare-session', 'prepare', 'load', 'read-persistent-child-session'),
  storage('launch', 'launch', 'record', 'record-child-launch-intent'),
  storage('launch-inspect', 'launch', 'load', 'inspect-original-child-launch'),
  storage('coordinate', 'coordinate', 'record', 'record-child-lifecycle-event'),
  storage('coordinate-session', 'coordinate', 'load', 'read-child-status-and-session'),
  storage('join', 'join', 'record', 'record-child-join-set'),
  storage('join-results', 'join', 'load', 'read-retained-child-results'),
  storage('cancel', 'cancel', 'record', 'record-child-cancel-intent'),
  storage('cancel-inspect', 'cancel', 'load', 'inspect-descendant-cancellation'),
  storage('reconcile', 'reconcile', 'load', 'inspect-child-execution-certainty'),
  storage('reconcile', 'reconcile', 'record', 'record-child-reconciliation-evidence'),
  storage('return', 'return', 'record', 'record-parent-result-delivery'),
  storage('return-inspect', 'return', 'load', 'inspect-parent-result-delivery'),
];
const references = 'docs/research/lina/subagents-research.md; subagents-hermes-openclaw.md; subagents-pi-waku.md; subagents-existing-design-audit.md. Instance-tagged child lifecycle is an architectural simulation, not a live multi-agent scheduler.';
const node = (id: string, title: string, x: number, y: number, purpose: string, inputs: string, outputs: string, decisions: string, experiments: string): LinaNode => ({ id: `lina-subagents-${id}`, title, area: 'Subagents / multi-agent orchestration', status: 'proposed', x, y, purpose, inputs, outputs, decisions, references, experiments });
const edge = (id: string, source: string, target: string, label: string) => ({ id: `lina-subagents-edge-${id}`, source: source.startsWith('lina-') ? source : `lina-subagents-${source}`, target: target.startsWith('lina-') ? target : `lina-subagents-${target}`, label });
export const linaSubagentsBlock: LinaDocument = {
  version: 1,
  nodes: [
    node('validate', 'Validate delegation', 1800, 10000, 'Admit spawn, resume, status, steer, join or cancel against current parent authority and task-tree capacity.', 'Parent agent/session/turn/call and stable operation identity; worker profile, requested task, context mode, depth and tree budgets.', 'Admitted reservation, capacity wait, refused, failed or unknown; effective inherited restrictions.', 'Main model requests help; harness admits it. Recursive spawning is configurable, not structurally limited. Check depth, per-parent concurrency and aggregate tree budgets separately. Detached work requires an explicit durable owner; child permissions cannot silently exceed their admitted scope.', 'Model-led delegation versus prescribed routing, decomposition and worker allocation.'),
    node('prepare', 'Prepare child task', 2220, 10000, 'Freeze a fresh or resumed child task packet with explicit context, identity, policy and output expectations.', 'Admitted operation/reservation, fresh/selected/transcript-fork mode, source revisions, persistent session and worker configuration.', 'Immutable child packet, source unavailable, scope refused or cancelled.', 'Each child owns history, counters and waits. Selected and forked history retain provenance and exclude credentials. Bind model, tool/skill/connector/account/environment scopes and Memory namespaces through references. Persistent session continuation acquires its own turn; a fork never shares mutable parent history.', 'Fresh versus selected versus transcript-fork handoff; specialist profiles and model allocation.'),
    node('launch', 'Launch child execution', 2640, 10000, 'Persist exact launch intent, recheck authority and start the existing harness under a child-owned turn.', 'Immutable packet, original operation fingerprint, reservation, owner generation and final admission.', 'Started handle, known unstarted, failed or unknown launch.', 'Repeated launch requests reuse original child identity or inspect evidence. Foreground/background describes parent waiting; attached/detached describes ownership. Persisted intent alone does not prove launch. No fresh child is started to resolve an uncertain acknowledgment.', 'Launch timing and concurrency at fixed capacity and budgets.'),
    node('coordinate', 'Coordinate child work', 3060, 10000, 'Track instance-tagged progress, persistent sessions, terminal/release events and authorized follow-up controls.', 'Child handles/events with event IDs and revisions; status, steering, follow-up, parent or durable-owner lifecycle.', 'Running, waiting, terminal observed, released, control accepted, rejected or unknown.', 'Deduplicate late/out-of-order events without resurrecting ended parent turns. Route steering to safe child checkpoints; follow-up creates a new admitted child turn. Acknowledged background handles differ from terminal results. Detached work remains owned and inspectable after the parent ends.', 'Parent continuation, status/message granularity and session reuse.'),
    node('join', 'Join child results', 3060, 10280, 'Resolve selective required child sets with explicit all/any/quorum completion policy.', 'Owned join operation, child IDs, completion policy, retained results, deadline and partial-failure rule.', 'Pending wait, result ready, partial terminal, wait expired or unresolved.', 'A wait timeout does not cancel or imply child completion. Completion and owner release are distinct. Preserve each failure/effect certainty; do not treat successful siblings as full success. Stable joins survive restart and exclude unrelated child events.', 'All/any/quorum joins, partial result policies and parent waiting strategies.'),
    node('cancel', 'Cancel child work', 2640, 10280, 'Apply exact child or descendant cancellation under attached versus detached ownership.', 'Cancellation identity, target session/task subtree, admitted controller, owner generation and active effect certainty.', 'Prevented before launch, cancel requested, settled or unresolved.', 'Parent Stop cascades attached descendants, including pending spawns; detached work follows its durable owner policy. Signal active attempts but retain acknowledged writes and results. Cancellation acknowledgment is not remote rollback or proof all work stopped. Release capacity only from settled ownership evidence.', 'Cascade policy and responsiveness while preserving effect accounting.'),
    node('reconcile', 'Reconcile child execution', 2220, 10280, 'Inspect uncertain startup, missing completion, interrupted owners or cancellation using original identities.', 'Original launch/control/result IDs, durable records, runtime observations and compatible checkpoint metadata.', 'Known running, known unstarted, known terminal, still unknown or incompatible.', 'Keep unresolved effects visible and withhold unsafe parent release. Inspect before replay; do not duplicate child launch or automatically repeat child tools. Reattach known work, restore compatible checkpoints or return declared failure with evidence.', 'Recovery boundaries and retained-result delivery after interruption.'),
    node('return', 'Return delegation outcome', 1800, 10280, 'Return a bounded handle or terminal observation to the exact requesting parent operation.', 'Correlated handle/result set, output requirements, raw trace/artifact references, parent currentness and delivery receipt.', 'Accepted handle, success, invalid result, failed, exhausted, cancelled or unresolved.', 'Validate result shape; retain raw evidence behind references. Child text remains evidence, not elevated instructions. Late results are durably retained even when the original parent no longer waits; they cannot restart it. Duplicate delivery reuses the existing parent observation.', 'Result representation, evidence density and synthesis location.'),
  ],
  edges: [
    ...SUBAGENT_REQUEST_ROUTES.flatMap(route => [{ id: route.id, source: route.source, target: route.target, label: route.phase }, { id: route.returnId, source: route.returnSource, target: route.returnTarget, label: 'exact parent operation; handle or terminal observation' }]),
    ...SUBAGENT_STATE_ROUTES.flatMap(route => [{ id: route.id, source: route.source, target: route.target, label: route.phase }, { id: route.returnId, source: route.target, target: route.returnTarget, label: `${route.phase}; same identity and continuation` }]),
    edge('validate-prepare', 'validate', 'prepare', 'admitted spawn / persistent follow-up'),
    edge('validate-coordinate', 'validate', 'coordinate', 'admitted status / steer'),
    edge('validate-join', 'validate', 'join', 'admitted selective wait'),
    edge('validate-cancel', 'validate', 'cancel', 'admitted exact-child / subtree cancellation'),
    edge('validate-return', 'validate', 'return', 'refused / invalid / budget exhausted'),
    edge('validate-wait', 'validate', 'lina-execution-wait', 'retain capacity wait; no reservation beyond limits'),
    edge('wait-validate', 'lina-execution-wait', 'validate', 'matched capacity event; recheck depth and budgets'),
    edge('validate-safety', 'validate', 'lina-safety-evaluate', 'review exact delegation and requested scopes'),
    edge('safety-validate', 'lina-safety-authorize', 'validate', 'same delegation admission / refusal'),
    edge('prepare-coordinate', 'prepare', 'coordinate', 'prepared packet awaiting admitted launch capacity; no active child'),
    edge('reconcile-wait', 'reconcile', 'lina-execution-wait', 'retain original uncertain launch / control; await inspect evidence'),
    edge('wait-reconcile', 'lina-execution-wait', 'reconcile', 'matched inspection event; original operation identity'),
    edge('prepare-launch', 'prepare', 'launch', 'immutable packet ready'),
    edge('prepare-return', 'prepare', 'return', 'source unavailable / invalid session / cancelled'),
    edge('launch-safety', 'launch', 'lina-safety-authorize', 'final launch scope / owner generation recheck'),
    edge('safety-launch', 'lina-safety-authorize', 'launch', 'exact child launch admission / no launch'),
    edge('launch-child-start', 'launch', 'lina-execution-start', 'internal child turn; instance-tagged existing loop'),
    edge('launch-coordinate', 'launch', 'coordinate', 'accepted child handle'),
    edge('launch-reconcile', 'launch', 'reconcile', 'unknown startup; inspect original operation'),
    edge('launch-return', 'launch', 'return', 'known unstarted / failed launch'),
    edge('child-settle-coordinate', 'lina-execution-settle', 'coordinate', 'child-only terminal; bypass external user delivery'),
    edge('child-release-coordinate', 'lina-execution-release', 'coordinate', 'child-only owner released; bypass parent input queue'),
    edge('coordinate-child-controls', 'coordinate', 'lina-execution-controls', 'exact child steering at safe checkpoint'),
    edge('coordinate-validate', 'coordinate', 'validate', 'follow-up / recursive child spawn; new admitted operation'),
    edge('coordinate-join', 'coordinate', 'join', 'foreground / explicit required child set'),
    edge('coordinate-return', 'coordinate', 'return', 'background handle / status / control receipt'),
    edge('coordinate-cancel', 'coordinate', 'cancel', 'owner expiry / explicit child stop'),
    edge('coordinate-reconcile', 'coordinate', 'reconcile', 'missing event / owner restart / uncertain child'),
    edge('join-wait', 'join', 'lina-execution-wait', 'persist exact required child set and completion policy'),
    edge('wait-join', 'lina-execution-wait', 'join', 'matched child event / deadline; no fabricated completion'),
    edge('join-return', 'join', 'return', 'bounded results / partial failure / wait expired'),
    edge('join-reconcile', 'join', 'reconcile', 'required child outcome remains uncertain'),
    edge('parent-cancel', 'lina-execution-cancel', 'cancel', 'attached descendant cascade; detached owner policy separate'),
    edge('cancel-child-cancel', 'cancel', 'lina-execution-cancel', 'instance-tagged exact active child signal'),
    edge('cancel-coordinate', 'cancel', 'coordinate', 'known cancellation accounting / retained results'),
    edge('cancel-reconcile', 'cancel', 'reconcile', 'uncertain active effects; retain ownership'),
    edge('cancel-return', 'cancel', 'return', 'prevented before launch / settled cancellation'),
    edge('reconcile-coordinate', 'reconcile', 'coordinate', 'known running / retained terminal event'),
    edge('reconcile-launch', 'reconcile', 'launch', 'proven unstarted; same intent reauthorized'),
    edge('reconcile-return', 'reconcile', 'return', 'known outcome / incompatible resume / unresolved evidence'),
    edge('execution-reconcile', 'lina-input-reconcile', 'reconcile', 'inspect required child execution before parent release'),
    edge('reconcile-execution', 'reconcile', 'lina-input-reconcile', 'same parent reconciliation evidence; no child replay'),
    edge('return-join', 'return', 'join', 'delivery uncertain; inspect retained original result'),
  ],
};
export const SUBAGENTS_EDGES = linaSubagentsBlock.edges;
