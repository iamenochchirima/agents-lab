import { useEffect, useState } from 'react';
import { linaExecutionPaths, type LinaExecutionStep } from './executionPaths';
import type { LinaDocument } from './linaModel';

type Props = { document: LinaDocument; onFocus: (id: string) => void; onTrail: (ids: string[]) => void };

/** Walk through the designed input routes without executing tools or modifying the design. */
export function LinaExecutionPath({ document, onFocus, onTrail }: Props) {
  const [scenarioId, setScenarioId] = useState(linaExecutionPaths[0].id);
  const scenario = linaExecutionPaths.find(path => path.id === scenarioId)!;
  const [trail, setTrail] = useState<LinaExecutionStep[]>([scenario.steps[0]]);
  const custom = trail.some((step, index) => step.nodeId !== scenario.steps[index]?.nodeId);
  const current = trail[trail.length - 1];
  const node = document.nodes.find(n => n.id === current.nodeId);
  const outgoing = document.edges.filter(edge => edge.source === current.nodeId);
  const next = !custom ? scenario.steps[trail.length] : undefined;
  const ended = !next && !custom;
  useEffect(() => {
    onTrail(trail.map(step => step.nodeId));
    onFocus(current.nodeId);
  }, [trail]);

  function restart(id = scenarioId) {
    const path = linaExecutionPaths.find(value => value.id === id)!;
    setScenarioId(id); setTrail([path.steps[0]]);
  }
  function choose(target: string, label: string) {
    const detail = current.choices.find(choice => choice.target === target)?.detail
      ?? `Follow the ${label} connection. This route's outcome still depends on the receiving component.`;
    const choices = linaExecutionPaths.flatMap(path => path.steps).find(value => value.nodeId === target)?.choices ?? [];
    const step = next?.nodeId === target ? next : { nodeId: target, detail, choices };
    setTrail([...trail, step]);
  }
  return <section className="lina-execution" aria-label="Message execution path">
    <div className="lina-execution-controls"><label>Scenario<select value={scenarioId} onChange={event => restart(event.target.value)}>{linaExecutionPaths.map(path => <option key={path.id} value={path.id}>{path.title}</option>)}</select></label><button onClick={() => restart()}>Restart</button><button disabled={trail.length < 2} onClick={() => { setTrail(trail.slice(0, -1)); }}>Back</button><button disabled={!next || !document.edges.some(edge => edge.source === current.nodeId && edge.target === next.nodeId)} onClick={() => next && setTrail([...trail, next])}>Next step</button></div>
    <p className="lina-execution-scope">Design walkthrough · input block only. Model, tool, and subagent execution are still boundary handoffs.</p>
    <p>{scenario.description}</p>
    <div className="lina-execution-body"><div><small>Step {trail.length}{custom ? ' · alternate route' : ` of ${scenario.steps.length}`}</small><h2>{node?.title ?? current.nodeId}</h2><p>{current.detail}</p>{ended && <p className="lina-execution-outcome">{scenario.outcome}</p>}{!node && <p role="alert">This component is missing from the saved design.</p>}</div><div className="lina-route-choices"><h3>{current.nodeId === 'lina-input-accept' ? 'Connections after acceptance' : 'Possible next routes'}</h3>{current.nodeId === 'lina-input-accept' && <p>The receipt and dispatch are separate consequences, not competing outcomes.</p>}{current.nodeId === 'lina-input-control' && <p>Control status can be reported separately. Queue or replacement admission requires safe turn ownership.</p>}{current.nodeId === 'lina-input-runtime' && <p>Owner release is a later lifecycle notification to the queue, not an immediate next step for this input.</p>}{outgoing.length ? outgoing.map(edge => <button key={edge.id} disabled={!document.nodes.some(n => n.id === edge.target)} onClick={() => choose(edge.target, edge.label)}><span>{edge.label}<small>→ {document.nodes.find(n => n.id === edge.target)?.title ?? edge.target}</small><small>{current.choices.find(choice => choice.target === edge.target)?.detail}</small></span><span>→</span></button>) : <p>End of this block's mapped route. No downstream lifecycle is specified here.</p>}</div></div>
    <div className="lina-execution-trail" aria-label="Visited components">{trail.map((step, index) => <button key={`${index}-${step.nodeId}`} aria-current={index === trail.length - 1 ? 'step' : undefined} onClick={() => { setTrail(trail.slice(0, index + 1)); }}>{index + 1}. {document.nodes.find(n => n.id === step.nodeId)?.title ?? step.nodeId}</button>)}</div>
  </section>;
}
