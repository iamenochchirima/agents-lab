/** A continuation is a separate observation, never an initial end-to-end pass.
 * State confirmation permits moving past an applied mutation without replaying it;
 * retrieval and review-denial stages still need their original passing evidence. */
export function validateConnectedContinuation(
  scenario: { id: string; provider: string; profileId: string; stages: readonly { id: string; decision: string | null; expected: Record<string, unknown> }[] },
  source: any, platform: string, startStage: string, observed: Record<string, unknown>, selectedModel: string,
): { namespace: string; sourceRunIds: string[]; confirmedEffects: string[]; startIndex: number } {
  if (source?.mode !== 'real-model-controlled-connected' || source.scenario?.fixtureOnly !== true ||
      source.scenario.id !== scenario.id || source.scenario.provider !== scenario.provider || source.scenario.profileId !== scenario.profileId)
    throw new Error('Continuation source must reference this controlled scenario/profile/provider');
  if (source.controls?.model?.id !== selectedModel) throw new Error('Retained sessions bind their original model; select that exact model for continuation');
  const outcome = source.outcomes?.find((value: any) => value.platform === platform);
  if (!outcome || !/^cap-[a-z0-9-]{1,100}$/.test(outcome.namespace) || outcome.namespace.startsWith('cap-chat-manual-'))
    throw new Error('Continuation requires a retained automated fixture namespace');
  const startIndex = scenario.stages.findIndex(stage => stage.id === startStage);
  if (startIndex < 0) throw new Error('Continuation start stage does not exist');
  const latest = outcome.stages?.at(-1);
  if (!latest?.after || latest.nativeStatus === 'reconciliation_required' || latest.error?.failureKind === 'outcome_unknown')
    throw new Error('Unknown or missing effect state cannot be continued');
  if (!Object.entries(latest.after).every(([key, value]) => observed[key] === value))
    throw new Error('Provider state drifted from the retained observation; reconcile before continuation');
  const confirmedEffects: string[] = [];
  for (const stage of scenario.stages.slice(0, startIndex)) {
    const record = outcome.stages.find((value: any) => value.id === stage.id);
    if (record?.verdict === 'pass') continue;
    if (stage.decision === 'approved' && record?.reviews?.some((review: any) => review.decision === 'approved') &&
        record.after && Object.entries(stage.expected).every(([key, value]) => record.after[key] === value)) {
      confirmedEffects.push(stage.id); continue;
    }
    throw new Error(`Prior stage ${stage.id} has no passing observation or confirmed approved effect`);
  }
  const next = scenario.stages[startIndex];
  if (next.decision === 'approved' && (!(typeof next.expected.effectCount === 'number') ||
      !(typeof observed.effectCount === 'number') || next.expected.effectCount <= observed.effectCount))
    throw new Error('Continuation would replay an already applied mutation');
  return { namespace: outcome.namespace, sourceRunIds: outcome.stages.map((value: any) => value.runId), confirmedEffects, startIndex };
}
