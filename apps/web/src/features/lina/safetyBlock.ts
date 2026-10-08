import type { LinaDocument, LinaNode } from './linaModel';

const references = 'docs/research/lina/safety-permissions-research.md; safety-existing-design-audit.md; safety-hermes-openclaw.md; safety-pi-waku.md. This graph and its grant records are design fixtures, not a live authorization service.';
const node = (id: string, title: string, x: number, y: number, purpose: string, inputs: string, outputs: string, decisions: string, experiments: string): LinaNode => ({ id: `lina-safety-${id}`, title, area: 'Safety and permissions', status: 'proposed', x, y, purpose, inputs, outputs, decisions, references, experiments });
const edge = (id: string, source: string, target: string, label: string) => ({ id: `lina-safety-edge-${id}`, source: source.startsWith('lina-') ? source : `lina-safety-${source}`, target: target.startsWith('lina-') ? target : `lina-safety-${target}`, label });

/** Safety owns operation permission, while Tools owns effects and Execution owns
 * retained waits. Admission before scheduling is distinct from final launch admission.
 * State supplies fixture storage acknowledgments; future subagent dependencies remain references. */
export const linaSafetyBlock: LinaDocument = {
  version: 1,
  nodes: [
    node('policy', 'Resolve policy', 3700, 5420, 'Resolve trusted versioned rules and scope ceilings for the requesting principal, workspace and agent.', 'Exact operation identity, trusted configuration references and requested policy revision.', 'Policy ready, denied or unavailable; precedence, review mode and supported grant choices.', 'Hard deny and scope ceilings outrank grants. Mandatory review outranks reusable grants unless the rule explicitly permits reuse. Unavailable required policy withholds launch. The model cannot amend trusted rules.', 'Compare revision-aware caching with fresh resolution under identical final invalidation rules.'),
    node('evaluate', 'Evaluate operation', 3700, 5700, 'Join the validated final operation with resolved policy and matching grant evidence.', 'Tool call, resource read or prompt retrieval; final arguments/schema/account/target and policy/grant lookup responses.', 'Allowed, denied, approval-required or unavailable with exact binding and reason references.', 'Post-hook changes require fresh validation. Tool visibility, project trust, provider login and untrusted read-only annotations grant no operation authority. Evaluation launches no effect.', 'Compare reviewed matcher granularity or review selection within fixed hard constraints.'),
    node('approval', 'Await approval', 3700, 5980, 'Register and resolve one exact four-choice review while retaining independent sibling waits.', 'Exact review request, displayed matcher, eligible responders, retained registration acknowledgment and correlated answer/expiry/Stop.', 'Waiting, accepted resolution, rejected answer, expired or cancelled; prompt delivery only after registration.', 'Allow once, allow for this session, always allow this scope, or deny. Validate offered choice, responder, prompt, scope and expiry. Duplicate or stale answers cannot revive stopped work. Auto pauses for an explicit choice.', 'Compare per-operation versus grouped review with distinct decisions and prompt frequency.'),
    node('grants', 'Manage permission grants', 4120, 5980, 'Match, commit, reserve, consume, release, inspect and revoke operation-bound permission grants.', 'Tagged transaction command with stable request ID; reviewed choice/matcher and current session or permission generation.', 'Match/miss, committed/failed/conflict/unknown, reservation evidence or revocation acknowledgment.', 'Once is one logical operation, with fresh admission per attempt. Session ends invalidate session grants; persistent grants require acknowledged commit. Unknown commits require inspection, not blind retry. Grants contain references rather than credentials and are nondelegable by default. Initial persistence is fixture-only.', 'Compare scope and lifetime under the same policy ceilings; measure reuse and stale authority exposure.'),
    node('authorize', 'Authorize execution', 4120, 5700, 'Issue admission evidence, then recheck live permission for the exact physical launch immediately before dispatch.', 'Evaluation/resolution, grant commit/reservation and current operation/attempt, binding, policy generation, owner fence and Stop.', 'Admission decision or fresh bounded launch permit; deny, recheck, wait or unavailable without effects.', 'Admission is not an unlimited dispatch token. Reject changed arguments/account/schema/policy, revoked grants and stale ownership. Duplicate launch cannot reuse a consumed attempt. Known-no-effect retry requires fresh admission; unknown effects belong to Tools reconciliation. The graph does not establish production atomicity.', 'Compare policy lookup cost while preserving final generation and binding checks.'),
  ],
  edges: [
    edge('tool-request', 'lina-tools-permissions', 'evaluate', 'exact validated operation; request admission'),
    edge('evaluate-policy', 'evaluate', 'policy', 'resolve trusted policy'),
    edge('policy-evaluate', 'policy', 'evaluate', 'ready / denied / unavailable; same request'),
    edge('evaluate-grants', 'evaluate', 'grants', 'lookup reviewed operation matcher'),
    edge('grants-evaluate', 'grants', 'evaluate', 'match / miss / expired / revoked / unavailable'),
    edge('evaluate-authorize', 'evaluate', 'authorize', 'allow / deny / unavailable evaluation'),
    edge('evaluate-approval', 'evaluate', 'approval', 'review required; exact displayed scope'),
    edge('approval-wait-tools', 'approval', 'lina-tools-permissions', 'retain tool approval wait before prompt'),
    edge('wait-registered', 'lina-execution-wait', 'approval', 'retained approval wait acknowledged'),
    edge('approval-prompt', 'approval', 'lina-input-delivery', 'registered four-choice prompt delivery'),
    edge('approval-answer', 'lina-tools-permissions', 'approval', 'correlated answer via Input and Execution'),
    edge('approval-grants', 'approval', 'grants', 'accepted allow choice; commit reviewed scope'),
    edge('grants-authorize', 'grants', 'authorize', 'commit outcome; unknown withholds launch'),
    edge('approval-authorize', 'approval', 'authorize', 'deny / expired / cancelled; no launch'),
    edge('authorize-grants', 'authorize', 'grants', 'reserve / consume / inspect exact attempt'),
    edge('reservation-authorize', 'grants', 'authorize', 'matched transaction outcome'),
    edge('decision-tools', 'authorize', 'lina-tools-permissions', 'admission / no-launch / recheck; not dispatch'),
    edge('dispatch-authorize', 'lina-tools-dispatch', 'authorize', 'fresh queued launch admission'),
    edge('authorize-dispatch', 'authorize', 'lina-tools-dispatch', 'bounded launch decision; recheck fence'),
    edge('resource-read-request', 'lina-tools-resource-read', 'evaluate', 'exact Context resource dependency'),
    edge('resource-read-return', 'authorize', 'lina-tools-resource-read', 'same dependency admission / failure'),
    edge('resource-read-authorize', 'lina-tools-resource-read', 'authorize', 'fresh resource launch admission'),
    edge('approval-wait-resource', 'approval', 'lina-tools-resource-read', 'retain resource approval dependency'),
    edge('resource-read-answer', 'lina-tools-resource-read', 'approval', 'dependency answer via Execution'),
    edge('prompt-get-request', 'lina-tools-prompt-get', 'evaluate', 'exact Context prompt dependency'),
    edge('prompt-get-return', 'authorize', 'lina-tools-prompt-get', 'same dependency admission / failure'),
    edge('prompt-get-authorize', 'lina-tools-prompt-get', 'authorize', 'fresh prompt retrieval launch admission'),
    edge('approval-wait-prompt', 'approval', 'lina-tools-prompt-get', 'retain prompt approval dependency'),
    edge('prompt-get-answer', 'lina-tools-prompt-get', 'approval', 'dependency answer via Execution'),
    edge('cancel-approval', 'lina-execution-cancel', 'approval', 'cancel exact pending review; retain siblings'),
    edge('cancel-authorization', 'lina-execution-cancel', 'authorize', 'invalidate pending operation / launch authority'),
  ],
};
