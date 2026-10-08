import type { LinaDocument, LinaNode } from './linaModel';
import type { StateRequestRoute } from './stateBlock';

/** Every storage reply resumes its requesting phase; a receipt never launches work. */
const storage = (short: string, source: string, kind: StateRequestRoute['kind'], phase: string): StateRequestRoute => ({ id: `lina-planning-edge-${short}-state-${kind}`, source: `lina-planning-${source}`, target: `lina-state-${kind}`, kind, phase, returnId: `lina-planning-edge-state-${kind}-${short}`, returnTarget: `lina-planning-${source}` });
export const PLANNING_STATE_ROUTES: readonly StateRequestRoute[] = [
  storage('load', 'load', 'load', 'read-exact-scoped-plan-revision'),
  storage('update', 'update', 'record', 'conditional-plan-command'),
  storage('update-inspect', 'update', 'load', 'inspect-original-plan-command'),
  storage('bind', 'bind', 'record', 'record-task-attempt-binding'),
  storage('review', 'review', 'record', 'record-correlated-task-assessment'),
  storage('replan', 'replan', 'record', 'record-revision-decision-and-budget'),
  storage('complete', 'complete', 'record', 'record-assessed-goal-outcome'),
];
export const PLANNING_TOOL_ROUTES = [
  { id: 'lina-planning-edge-tools-update', source: 'lina-tools-dispatch', target: 'lina-planning-update', phase: 'admitted registered plan command', returnId: 'lina-planning-edge-update-tools', returnSource: 'lina-planning-update', returnTarget: 'lina-tools-collect' },
] as const;
const references = 'docs/research/lina/planning-research.md; planning-hermes-openclaw.md; planning-pi-waku.md; planning-patterns-and-evaluation.md; planning-existing-design-audit.md. Ledger transitions and evidence checks are design simulation, not live planning or durable storage.';
const node = (id: string, title: string, x: number, y: number, purpose: string, inputs: string, outputs: string, decisions: string, experiments: string): LinaNode => ({ id: `lina-planning-${id}`, title, area: 'Planning and task management', status: 'proposed', x, y, purpose, inputs, outputs, decisions, references, experiments });
const edge = (id: string, source: string, target: string, label: string) => ({ id: `lina-planning-edge-${id}`, source: source.startsWith('lina-') ? source : `lina-planning-${source}`, target: target.startsWith('lina-') ? target : `lina-planning-${target}`, label });
export const linaPlanningBlock: LinaDocument = {
  version: 1,
  nodes: [
    node('policy', 'Resolve planning policy', 4500, 3260, 'Bind optional task strategy, execution mode, scope and bounded revision policy for the active agent.', 'Admitted goal, user preference, trusted policy, agent/conversation/history branch and active loop budgets.', 'Effective direct/model-led/authored policy; execute/plan-only/review-before-execution mode; bypass or refused policy.', 'Simple turns bypass the ledger. User or policy may require plan-first. Plan-only capability restrictions are enforced through Tools/Safety; accepting a plan grants no action permission. Child plans remain child-scoped; planning never resets model-round or tree limits.', 'Direct loop versus structured planning; separate planner/executor strategy under equal resource budgets.'),
    node('load', 'Load task plan', 4920, 3260, 'Restore the exact scoped canonical revision and expose a bounded task projection.', 'Goal/plan ID, workspace/agent/conversation/branch scope, revision selector and requester phase.', 'Found/absent/conflict/unavailable/incompatible plan plus revision/provenance; bounded Context contribution.', 'Absent differs from inaccessible or unavailable. Required saved plans fail explicitly. Compaction alters presentation rather than canonical state. Recovery preserves attempts, bindings and evidence; parent context cannot silently read child-private plans.', 'Projection granularity and reload cadence while preserving canonical state and scope.'),
    node('update', 'Apply task updates', 5340, 3260, 'Validate typed plan commands and conditionally record a revision through State.', 'Stable command/call/fingerprint, actor scope, expected revision, create/update/revise operation and declared task graph.', 'Applied/duplicate/conflict/invalid/failed/unknown receipt with original identity and accepted revision; no launched work.', 'Reject missing/self/cyclic dependencies. Same identity and changed content conflicts. Unknown commit acknowledgment inspects the original command. Retain accepted historical evidence; changing a plan neither repeats effects nor implicitly cancels active work. Required work is removed only by an accepted goal revision.', 'Coarse/fine decomposition and model-led versus authored task structure; correctness rules remain fixed.'),
    node('ready', 'Select ready work', 5760, 3260, 'Resolve dependencies, blockers and declared immutable input bindings without launching tasks.', 'Accepted plan revision, task/attempt assessments, dependency condition, Stop and effective planning policy.', 'Independent ready set, blocked/waiting set or completion candidate with exact producing evidence references.', 'Accepted-success is the default prerequisite; terminal-outcome cleanup is explicit. Failed/cancelled work is not success. A ready task does not authorize a call. Existing Tools/Subagents own actual parallel capacity and launch. Preserve unrelated independent readiness when a sibling blocks.', 'Sequential versus parallel ready work; task granularity and dependency shape at equal limits.'),
    node('bind', 'Bind work execution', 5760, 3540, 'Correlate a selected task attempt with already admitted tool calls or child tasks.', 'Plan revision/task/attempt IDs; exact call/child/operation identities, controller, input artifact bindings and admission.', 'Recorded binding/receipt, refused assignment or unresolved binding; actual execution remains with its owner.', 'Bind only admitted execution identities. Preserve producing attempt/artifact inputs. Late results attach to original attempts and cannot complete replacement tasks. Plan changes require explicit owner cancellation or reassignment; they cannot steal a running operation.', 'Parent tools versus specialist delegation and assignment strategies.'),
    node('review', 'Review task evidence', 5340, 3540, 'Assess correlated observations against declared task acceptance criteria.', 'Original task/attempt/revision, tool/child result and artifact references, provenance, effect certainty and verification method.', 'Accepted/insufficient/failed/blocked/uncertain assessment with retained evidence and declared evaluator.', 'A successful child or tool result does not prove the task goal. Separate lifecycle from assessment. Record deterministic, model or human review; model assertions are not independent verification. Unknown effects remain with existing reconciliation and prevent unsupported completion.', 'Per-step versus milestone review; deterministic/model/human evaluation under fixed criteria.'),
    node('replan', 'Decide plan revision', 4920, 3540, 'Choose continuation, revision request or retained wait within shared execution limits.', 'Task assessment, user scope guidance, current revision, revision counters and remaining loop/task budgets.', 'Continue/revise/wait/exhausted decision; retained completed evidence and explicit proposed change references.', 'Replanning uses ordinary model preparation and admitted plan commands. It does not create an unbounded second loop or reset budgets. Preserve acknowledged effects and historical attempts. Waiting for user guidance retains exact correlation; paused plans do not auto-resume.', 'Fixed plan versus observation-triggered revision; separate planner/executor routing.'),
    node('complete', 'Assess goal completion', 4500, 3540, 'Check required tasks, goal criteria and unresolved obligations before whole-goal settlement.', 'Candidate answer, assessed plan revision, required task set, accepted evidence, Stop and uncertain effect references.', 'Complete/partial/needs-work/blocked/failed/cancelled outcome with assessed revision and completion method.', 'Skipped required work, failed dependencies or unverified model claims do not silently count as success. Keep unresolved effects visible. Respect explicit Stop/pause and settle honestly; completion assessment neither delivers user output nor releases active ownership.', 'Completion evidence policy and unsupported-completion frequency; preserve required-task truth.'),
  ],
  edges: [
    ...PLANNING_STATE_ROUTES.flatMap(route => [{ id: route.id, source: route.source, target: route.target, label: route.phase }, { id: route.returnId, source: route.target, target: route.returnTarget, label: `${route.phase}; same command and requester` }]),
    ...PLANNING_TOOL_ROUTES.flatMap(route => [{ id: route.id, source: route.source, target: route.target, label: route.phase }, { id: route.returnId, source: route.returnSource, target: route.returnTarget, label: 'exact call receipt; no launched work' }]),
    edge('start-policy', 'lina-execution-start', 'policy', 'bind active-agent planning mode before first preparation'),
    edge('policy-load', 'policy', 'load', 'scoped planning enabled / required saved revision'),
    edge('policy-prepare', 'policy', 'lina-execution-prepare', 'direct bypass / missing optional ledger; shared loop'),
    edge('policy-safety', 'policy', 'lina-safety-policy', 'plan-only exploration ceiling / execution-mode policy'),
    edge('safety-policy', 'lina-safety-policy', 'policy', 'trusted restriction resolution; no action grant'),
    edge('policy-settle', 'policy', 'lina-execution-settle', 'refused / required policy unavailable'),
    edge('load-update', 'load', 'update', 'absent plan with admitted typed creation command'),
    edge('load-ready', 'load', 'ready', 'found exact accepted task revision'),
    edge('load-prepare', 'load', 'lina-execution-prepare', 'absent optional ledger; model may propose plan'),
    edge('load-wait', 'load', 'lina-execution-wait', 'required source unavailable; retain exact read'),
    edge('wait-load', 'lina-execution-wait', 'load', 'matched source/recovery event; same revision'),
    edge('load-complete', 'load', 'complete', 'incompatible required plan; honest blocked/failed outcome'),
    edge('context-load', 'lina-context-load', 'load', 'permitted scoped task-plan contribution request'),
    edge('load-context-load', 'load', 'lina-context-load', 'same manifest requester; bounded view with provenance'),
    edge('load-context-task', 'load', 'lina-context-task', 'bounded goals/constraints/task evidence projection'),
    edge('update-ready', 'update', 'ready', 'accepted revision / retained prior revision after rejected mutation'),
    edge('update-wait', 'update', 'lina-execution-wait', 'unknown original write; await inspection, no new command'),
    edge('wait-update', 'lina-execution-wait', 'update', 'matched original transaction evidence'),
    edge('ready-prepare', 'ready', 'lina-execution-prepare', 'publish ready set for ordinary model decision'),
    edge('ready-bind', 'ready', 'bind', 'selected task with actual admitted execution identities'),
    edge('ready-wait', 'ready', 'lina-execution-wait', 'blocked / pending producing attempt'),
    edge('wait-ready', 'lina-execution-wait', 'ready', 'matched dependency event / user guidance'),
    edge('ready-complete', 'ready', 'complete', 'candidate required set satisfied / terminal blockers'),
    edge('tools-bind', 'lina-tools-dispatch', 'bind', 'already admitted task-linked call before launch'),
    edge('bind-tools', 'bind', 'lina-tools-dispatch', 'same admitted call after binding receipt; recheck launch'),
    edge('subagents-bind', 'lina-subagents-prepare', 'bind', 'admitted immutable child assignment packet'),
    edge('bind-subagents', 'bind', 'lina-subagents-launch', 'same recorded child task; owner authorizes launch'),
    edge('bind-controls', 'bind', 'lina-execution-controls', 'recorded binding handoff; actual owner controls execution'),
    edge('bind-review', 'bind', 'review', 'unresolved / refused assignment evidence; no invented result'),
    edge('tools-review', 'lina-tools-collect', 'review', 'matched task attempt tool result / effect certainty'),
    edge('subagents-review', 'lina-subagents-return', 'review', 'matched child outcome as candidate evidence'),
    edge('review-ready', 'review', 'ready', 'accepted retained assessment; derive remaining work'),
    edge('review-update', 'review', 'update', 'validated task assessment/status command; same attempt'),
    edge('review-replan', 'review', 'replan', 'insufficient / failed / scope-changed evidence'),
    edge('review-complete', 'review', 'complete', 'accepted evidence; recheck all required obligations'),
    edge('review-reconcile', 'review', 'lina-input-reconcile', 'unknown effects retain original reconciliation owner'),
    edge('reconcile-review', 'lina-input-reconcile', 'review', 'original task attempt certainty evidence'),
    edge('controls-replan', 'lina-execution-controls', 'replan', 'safe checkpoint user guidance / revision trigger'),
    edge('replan-update', 'replan', 'update', 'admitted typed revision command; no free-form mutation'),
    edge('replan-ready', 'replan', 'ready', 'continue unchanged accepted revision'),
    edge('replan-prepare', 'replan', 'lina-execution-prepare', 'bounded model revision request; shared round limits'),
    edge('replan-wait', 'replan', 'lina-execution-wait', 'review-before-execution / user guidance retained'),
    edge('wait-replan', 'lina-execution-wait', 'replan', 'matched plan review; actions still require admission'),
    edge('replan-complete', 'replan', 'complete', 'revision budget exhausted / paused / terminal failure'),
    edge('controls-complete', 'lina-execution-controls', 'complete', 'planned candidate answer / user termination'),
    edge('complete-controls', 'complete', 'lina-execution-controls', 'needs-work / partial continuation under remaining budget'),
    edge('complete-settle', 'complete', 'lina-execution-settle', 'assessed complete / blocked / failed / cancelled outcome'),
    edge('complete-wait', 'complete', 'lina-execution-wait', 'retained required obligation / explicit pause'),
    edge('recovery-load', 'lina-state-recover', 'load', 'compatible checkpoint exact plan revision; no replay'),
    edge('cancel-complete', 'lina-execution-cancel', 'complete', 'after actual owner cancellation; retain unresolved work'),
  ],
};
export const PLANNING_EDGES = linaPlanningBlock.edges;
