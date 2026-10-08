import type { LinaDocument, LinaNode } from './linaModel';

const research = 'docs/research/lina/model-interface-research.md; model-provider-protocols.md; model-hermes-openclaw.md; model-pi-waku.md. Versioned provider profiles are design fixtures, not deployed adapters or measured inference.';
const node = (id: string, title: string, x: number, purpose: string, inputs: string, outputs: string, decisions: string, experiments: string): LinaNode => ({ id: `lina-model-${id}`, title, area: 'Model Interface', status: 'proposed', x, y: 7060, purpose, inputs, outputs, decisions, references: research, experiments });
const edge = (id: string, source: string, target: string, label: string) => ({ id: `lina-model-edge-${id}`, source: source.startsWith('lina-') ? source : `lina-model-${source}`, target: target.startsWith('lina-') ? target : `lina-model-${target}`, label });

/** One provider boundary reused by every logical round. Credential readiness and
 * local settlement return to the existing Execution owner, without another retry loop. */
export const linaModelBlock: LinaDocument = {
 version: 1,
 nodes: [
  node('resolve', 'Resolve model binding', 80, '- Resolve configured provider/model, protocol, scoped account readiness and versioned capabilities.', '- Metadata dependency or invocation intent; retained readiness completion or exact prelaunch cancellation.', '- Metadata for the same Context preparation, current invocation binding, readiness wait, bounded reprepare or prelaunch failure.', '- Metadata resolution launches no inference. Binding includes effective output/reasoning budget revision. Secrets stay with credential owner. Readiness is tagged Model work, never a fabricated MCP session or tool call. Stop invalidates pending intent and continuation.', '- Compare explicit routing/fallback policies later; baseline exact configured route has fallback disabled.'),
  node('encode', 'Encode provider request', 500, '- Project the exact admitted snapshot into the selected protocol and validate final request compatibility and size.', '- Snapshot artifact, current binding/capabilities/budget profile, complete correlated history, media and registered schemas.', '- Safe fixture request plus fidelity manifest, bounded Context reprepare or unlaunchable preflight failure.', '- Preserve schema and tool identity through aliases. Record media/replay transformations. Required unsupported settings or signatures fail explicitly. Validation grants no permission and creates no physical attempt.', '- Compare faithful cache placement or constrained-output policies on equivalent tasks and models.'),
  node('invoke', 'Invoke and collect response', 920, '- Launch one physical request; collect item-indexed stream drafts, terminal evidence, usage and cancellation settlement.', '- Valid encoded request and current launch authority, exact active-attempt abort or local settlement continuation.', '- Nonexecutable progress, one locally settled terminal observation, or retained settlement wait.', '- First launch consumes one round and one attempt; retry consumes only an attempt. No hidden retry. Cancellation is local abort/drain evidence, not remotely confirmed cancellation. Late superseded events remain diagnostic. Partial calls never reach Tools.', '- Compare supported transports later; early provider-completed asynchronous tools require a separate policy.'),
  node('normalize', 'Normalize model outcome', 1340, '- Interpret terminal protocol evidence into answer/calls/continuation or classified failure without starting further work.', '- Locally settled terminal observation or explicit prelaunch failure/cancellation.', '- Correlated complete, incomplete, malformed, failed, aborted or unknown outcome for Execution decision.', '- Strictly parse complete object arguments and retain call IDs, response model, usage availability and scoped opaque replay refs. Never silently repair prefixes or treat HTTP200 as semantic success. Tools still validates registered schemas and permission. Execution owns recovery and next rounds.', '- Compare bounded repair or truncation continuation only as explicit later policies.'),
 ],
 edges: [
  edge('context-resolve','lina-context-load','resolve','request metadata only'),
  edge('resolve-context','resolve','lina-context-load','same preparation: capabilities / failure'),
  edge('execution-resolve','lina-execution-model','resolve','invocation intent; no dispatch'),
  edge('resolve-encode','resolve','encode','current binding and budget'),
  edge('resolve-normalize','resolve','normalize','prelaunch failure / cancellation'),
  edge('cancel-resolve','lina-execution-cancel','resolve','cancel pending resolution'),
  edge('cancel-encode','lina-execution-cancel','encode','cancel before dispatch'),
  edge('cancel-readiness','lina-execution-cancel','lina-execution-wait','invalidate Model readiness continuation'),
  edge('resolve-reprepare','resolve','lina-execution-prepare','changed binding / budget'),
  edge('encode-invoke','encode','invoke','validated request; launch recheck'),
  edge('encode-normalize','encode','normalize','prelaunch failure / cancellation'),
  edge('encode-reprepare','encode','lina-execution-prepare','pressure / stale projection'),
  edge('invoke-progress','invoke','invoke','draft progress; not executable'),
  edge('invoke-normalize','invoke','normalize','one terminal local observation'),
  edge('normalize-decide','normalize','lina-execution-decide','semantic model outcome'),
  edge('cancel-invoke','lina-execution-model','invoke','abort exact active attempt'),
  edge('invoke-wait','invoke','lina-execution-wait','retain pending local settlement'),
  edge('wait-invoke','lina-execution-wait','invoke','same attempt; never redispatch'),
  edge('resolve-wait','resolve','lina-execution-wait','retain Model readiness intent'),
  edge('wait-auth','lina-execution-wait','lina-tools-auth','registered native-provider auth request'),
  edge('wait-resolve','lina-execution-wait','resolve','matched readiness; recheck purpose'),
 ],
};
