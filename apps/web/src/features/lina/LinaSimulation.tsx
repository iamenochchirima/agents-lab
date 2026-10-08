import { OUTPUT_CASES, DEFAULT_OUTPUT_SETTINGS, outputScenarioSettings, type OutputCase, type OutputSettings } from './outputFixtures';
import { ENVIRONMENT_CASES, DEFAULT_ENVIRONMENT_SETTINGS, environmentScenarioSettings, type EnvironmentCase, type EnvironmentSettings } from './environmentFixtures';
import { PLANNING_CASES, DEFAULT_PLANNING_SETTINGS, planningScenarioSettings, type PlanningCase, type PlanningSettings } from './planningFixtures';
import { SUBAGENT_CASES, DEFAULT_SUBAGENT_SETTINGS, subagentScenarioSettings, type SubagentCase, type SubagentSettings } from './subagentsFixtures';
import { simulationView } from './inputSimulation';
import { MEMORY_CASES, memoryScenarioSettings, type MemoryCase } from './memoryFixtures';
import { useRef, useState } from 'react';
import type { SimulationChannel, SimulationCase, SimulationState, ContextCase, ToolScenario, SimulationAnswer } from './inputSimulation';
import { MODEL_CASES, MODEL_PROTOCOLS, type ModelProtocol, type ModelCase } from './modelFixtures';
import { safetyCases as SAFETY_CASES, type SafetyCase } from './safetyFixtures';
import { STATE_CASES, stateScenarioSettings, type StateCase } from './stateFixtures';
import { JsonView } from './LinaNodeContract';
import type { LinaDocument } from './linaModel';

type Props = {
  document: LinaDocument;
  state: SimulationState | null;
  active: boolean;
  disabled: boolean;
  onStart: (channel: SimulationChannel, automatic: boolean, executionCase: SimulationCase, maxRounds: number, contextCase: ContextCase, toolScenario: ToolScenario, follow: boolean, modelProtocol: ModelProtocol, modelCase: ModelCase, safetyCase: SafetyCase, stateCase: StateCase, memoryCase: MemoryCase, subagentCase: SubagentCase, subagentSettings: Partial<SubagentSettings>, planningCase: PlanningCase, planningSettings: Partial<PlanningSettings>, environmentCase: EnvironmentCase, environmentSettings: Partial<EnvironmentSettings>, outputCase: OutputCase, outputSettings: Partial<OutputSettings>) => void;
  onPause: () => void;
  onResume: () => void;
  onNext: () => void;
  onReset: () => void;
  onStop: () => void;
  onAnswer: (answer: SimulationAnswer) => void;
  onSelectWait: (waitId: string) => void;
  onSelectAgent: (agentId: string) => void;
};
const channelNames = { cli: 'CLI', whatsapp: 'WhatsApp', telegram: 'Telegram' };

/** Configure a scripted turn and control playback; no message or transport is sent. */
export function LinaSimulation({ document, state, active, disabled, onStart, onPause, onResume, onNext, onReset, onStop, onAnswer, onSelectWait, onSelectAgent }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [channel, setChannel] = useState<SimulationChannel>('cli');
  const [executionCase, setExecutionCase] = useState<SimulationCase>('direct-answer');
  const [contextCase, setContextCase] = useState<ContextCase>('fits');
  const [maxRounds, setMaxRounds] = useState(3);
  const [playback, setPlayback] = useState('automatic');
  const [toolScenario, setToolScenario] = useState<ToolScenario>('parallel');
  const [follow, setFollow] = useState(true);
  const [modelProtocol, setModelProtocol] = useState<ModelProtocol>('openai-chat');
  const [modelCase, setModelCase] = useState<ModelCase>('answer');
  const [safetyCase, setSafetyCase] = useState<SafetyCase>('policy-allow');
  const [stateCase, setStateCase] = useState<StateCase>('fresh');
  const [outputCase, setOutputCase] = useState<OutputCase>('final');
  const [outputSettings, setOutputSettings] = useState<OutputSettings>({...DEFAULT_OUTPUT_SETTINGS});
  const [environmentCase, setEnvironmentCase] = useState<EnvironmentCase>('disabled');
  const [environmentSettings, setEnvironmentSettings] = useState<EnvironmentSettings>({...DEFAULT_ENVIRONMENT_SETTINGS});
  const [planningCase, setPlanningCase] = useState<PlanningCase>('disabled');
  const [planningSettings, setPlanningSettings] = useState<PlanningSettings>({...DEFAULT_PLANNING_SETTINGS});
  const [memoryCase, setMemoryCase] = useState<MemoryCase>('baseline');
  const [subagentCase, setSubagentCase] = useState<SubagentCase>('disabled');
  const [subagentSettings, setSubagentSettings] = useState<SubagentSettings>({...DEFAULT_SUBAGENT_SETTINGS});
  const [childTools, setChildTools] = useState(DEFAULT_SUBAGENT_SETTINGS.tools.join(', '));
  const inspected = state ? simulationView(state) : null;
  const current = inspected && document.nodes.find(node => node.id === inspected.route[inspected.step]);
  const deliveryOnly = !!state?.outputSnapshot && state.events.slice(0,state.step + 1).some(event => event.nodeId === 'lina-execution-release' && (!event.agentId || event.agentId === 'main'));
  const terminal = state?.status === 'completed' || state?.status === 'blocked';
  return <div className="lina-simulation" aria-label="Turn simulation">
    <button className="lina-primary" disabled={disabled} onClick={() => dialog.current?.showModal()}>Run</button>
    {state && inspected && active && <>
      {state.subagentCase !== 'disabled' && <label className="lina-simulation-wait-picker">Agent instance<select aria-label="Agent instance" value={state.selectedAgentId} onChange={event => onSelectAgent(event.target.value)}><option value="active">Follow active agent · {state.activeAgentId}</option><option value="main">Main</option>{Object.keys(state.agents).filter(id => id !== 'main').map(id => <option key={id} value={id}>{id}</option>)}</select></label>}
      <div className="lina-simulation-progress" role="status" aria-live="polite">
        <span>{channelNames[state.channel]} · {state.status === 'completed' ? inspected.planningSnapshot?.goalStatus === 'planned' ? 'Plan ready' : state.stateCase === 'duplicate-input' ? 'Existing input found' : state.outcome === 'cancelled' ? 'Turn stopped' : state.outcome === 'failed' ? 'Turn failed' : state.outcome === 'exhausted' ? 'Round limit reached' : 'Turn complete' : state.status === 'waiting' ? `Waiting for ${state.wait?.kind==='model-settlement'?'local request settlement':state.wait?.kind}` : state.status === 'blocked' ? 'Simulation blocked' : state.status === 'running' ? 'Auto-running' : 'Paused'} · {state.step + 1}/{state.route.length}</span>
        <strong>{current?.title ?? inspected.route[inspected.step]}</strong>
        <span>{state.subagentCase !== 'disabled' ? `${state.selectedAgentId === 'active' ? state.activeAgentId : state.selectedAgentId} · ` : ''}Fixture context: {inspected.contextPreparations} preparations · {inspected.contextReductions} reductions</span>
        <span>{inspected.rounds}/{inspected.maxRounds} rounds · {inspected.attempts} model attempts{inspected.detail ? ` · ${inspected.detail}` : ''}</span>
      </div>
      <div className="lina-simulation-controls">
        <button disabled={disabled || terminal || state.status === 'waiting'} onClick={state.status === 'running' ? onPause : onResume}>{state.status === 'running' ? 'Pause' : 'Resume'}</button>
        <button disabled={disabled || terminal || state.status === 'waiting'} onClick={onNext}>Next</button>
        <button disabled={disabled || terminal || state.stopRequested || !state.route.slice(0, state.step + 1).includes('lina-execution-start')} onClick={onStop}>{deliveryOnly ? 'Stop delivery' : 'Stop turn'}</button>
        <button disabled={disabled} onClick={onReset}>Reset</button>
      </div>
      {state.waits.length > 1 && <label className="lina-simulation-wait-picker">Pending response<select aria-label="Pending response" value={state.wait?.id ?? ''} onChange={event => onSelectWait(event.target.value)}>{state.waits.map(wait => <option key={wait.id} value={wait.id}>{wait.kind} · {'callId' in wait ? wait.callId : 'intentId' in wait ? wait.intentId : 'candidateId' in wait ? wait.candidateId : 'taskId' in wait ? wait.taskId : 'planId' in wait ? wait.planId : 'environmentId' in wait ? wait.environmentId : wait.deliveryId}</option>)}</select></label>}
      {state.wait && 'reviewedMatcher' in state.wait && state.wait.reviewedMatcher && <details className="lina-simulation-work"><summary>Review {state.wait.callId} · {state.wait.reviewedMatcher.action} · {state.wait.reviewedMatcher.target} · {state.wait.reviewedMatcher.accountId}</summary><JsonView value={state.wait.reviewedMatcher} label="Reviewed permission scope"/></details>}
      {state.wait && <div className="lina-simulation-answers" aria-label="Simulated wait response">
        {state.wait.owner === 'output' ? state.wait.kind === 'output-policy' ? <><button onClick={() => onAnswer('allow-once')}>Allow this message</button><button onClick={() => onAnswer('deny')}>Deny message</button><button onClick={() => onAnswer('expire')}>Expire review</button></> : state.wait.kind === 'output-receipt' ? <button onClick={() => onAnswer('ready')}>Observe provider receipt</button> : <><button onClick={() => onAnswer('known-success')}>Original send confirmed</button><button onClick={() => onAnswer('known-no-effect')}>No send confirmed</button></> : state.wait.owner === 'environment' ? state.wait.kind === 'environment-readiness' ? <button onClick={() => onAnswer('ready')}>Environment ready</button> : <><button onClick={() => onAnswer('known-success')}>Original effect confirmed</button><button onClick={() => onAnswer('known-no-effect')}>No effect confirmed</button></> : state.wait.kind === 'planning-review' ? <><button onClick={() => onAnswer('allow-once')}>Accept plan</button><button onClick={() => onAnswer('deny')}>Decline plan</button><button onClick={() => onAnswer('expire')}>Expire review</button></> : state.wait.kind === 'planning-commit' ? <><button onClick={() => onAnswer('known-success')}>Commit confirmed</button><button onClick={() => onAnswer('known-no-effect')}>No commit confirmed</button></> : state.wait.kind === 'subagent' ? <><button onClick={() => onAnswer('known-success')}>Confirm existing child execution</button><button onClick={() => onAnswer('known-no-effect')}>Confirm launch did not happen</button></> : state.wait.kind === 'memory-review' ? <><button onClick={() => onAnswer('allow-once')}>Publish to shared memory</button><button onClick={() => onAnswer('deny')}>Keep private</button><button onClick={() => onAnswer('expire')}>Expire review</button></> : state.wait.kind === 'approval' ? <><button onClick={() => onAnswer('allow-once')}>Allow once</button><button onClick={() => onAnswer('allow-session')}>Allow for this session</button><button onClick={() => onAnswer('allow-always')}>Always allow this scope</button><button onClick={() => onAnswer('deny')}>Deny</button><button onClick={() => onAnswer('expire')}>Expire</button></>
          : ['reconciliation','delivery-reconciliation'].includes(state.wait.kind) ? <><button onClick={() => onAnswer('known-success')}>Effect confirmed</button><button onClick={() => onAnswer('known-no-effect')}>No effect confirmed</button></>
          : <button onClick={() => onAnswer('ready')}>{state.wait.kind === 'auth' ? 'Account ready' : state.wait.kind==='model-settlement' ? 'Confirm local settlement' : 'Provide input'}</button>}
        {state.wait.owner==='model' && state.wait.kind==='auth' && <><button onClick={() => onAnswer('deny')}>Deny</button><button onClick={() => onAnswer('expire')}>Expire</button></>}
        <button onClick={() => onAnswer(state.wait?.kind === 'auth' ? 'wrong-account' : 'stale')}>Try mismatched response</button>
      </div>}
      {inspected.operations.length > 0 && <details className="lina-simulation-work"><summary>{inspected.operations.filter(op => op.status === 'running').length} running · {inspected.results.length} known results</summary>
        {inspected.operations.map(op => <div key={op.callId}><code>{op.callId}</code><span>{op.status}</span><span>{op.attemptId}</span></div>)}
      </details>}
      {inspected.outputEvidence && <details className="lina-simulation-work"><summary>Delivery evidence · {inspected.outputEvidence.phase} · {inspected.outputEvidence.outcome}</summary><JsonView value={inspected.outputEvidence} label="Output delivery evidence"/>{inspected.outputSnapshot && <details><summary>Recipients, parts, attempts and receipts</summary><JsonView value={inspected.outputSnapshot} label="Fixture Output records"/></details>}</details>}
      {inspected.environmentEvidence && <details className="lina-simulation-work"><summary>Environment evidence · {inspected.environmentEvidence.phase} · {inspected.environmentEvidence.outcome}</summary><JsonView value={inspected.environmentEvidence} label="Environment evidence"/>{inspected.environmentSnapshot && <details><summary>Workspace, processes and artifact custody</summary><JsonView value={inspected.environmentSnapshot} label="Fixture Environment records"/></details>}</details>}
      {inspected.planningEvidence && <details className="lina-simulation-work"><summary>Planning evidence · {inspected.planningEvidence.phase} · {inspected.planningEvidence.outcome}</summary><JsonView value={inspected.planningEvidence} label="Planning evidence"/>{inspected.planningSnapshot && <details><summary>Task plan, revisions and evidence</summary><JsonView value={inspected.planningSnapshot} label="Fixture Planning records"/></details>}</details>}
      {state.subagentEvidence && <details className="lina-simulation-work"><summary>Subagent evidence · {state.subagentEvidence.phase} · {state.subagentEvidence.outcome}</summary><JsonView value={state.subagentEvidence} label="Subagent evidence"/>{state.subagentSnapshot && <details><summary>Fixture child sessions, ownership and results</summary><JsonView value={state.subagentSnapshot} label="Fixture Subagent records"/></details>}</details>}
      {inspected.memoryEvidence && <details className="lina-simulation-work"><summary>Memory evidence · {inspected.memoryEvidence.phase} · {inspected.memoryEvidence.outcome}</summary><JsonView value={inspected.memoryEvidence} label="Memory evidence"/>{inspected.memorySnapshot && <details><summary>Fixture memory records and lineage</summary><JsonView value={inspected.memorySnapshot} label="Fixture Memory records"/></details>}</details>}
      {inspected.stateEvidence && <details className="lina-simulation-work"><summary>State evidence · {inspected.stateEvidence.phase} · {inspected.stateEvidence.outcome}</summary><JsonView value={inspected.stateEvidence} label="State evidence"/>{inspected.stateSnapshot && <details><summary>Fixture records and checkpoints</summary><JsonView value={inspected.stateSnapshot} label="Fixture State records"/></details>}</details>}
      {inspected.safetyEvidence && <details className="lina-simulation-work"><summary>Permission evidence · {inspected.safetyEvidence.phase} · {inspected.safetyEvidence.decision ?? 'pending'}</summary><JsonView value={inspected.safetyEvidence} label="Permission evidence"/></details>}
      {inspected.safetyGrants.length > 0 && <details className="lina-simulation-work"><summary>{inspected.safetyGrants.length} fixture permission grants</summary><JsonView value={inspected.safetyGrants} label="Fixture permission grants"/></details>}
      {(inspected.modelWork || inspected.model) && <details className="lina-simulation-model"><summary>{inspected.model?.lifecycle==='running' ? 'Model request active' : inspected.modelWork?.phase==='waiting' ? 'Model readiness pending' : inspected.modelOutcome ? `Model ${inspected.modelOutcome.status}` : 'Model preparation'} · {inspected.model?.attemptId ?? 'not launched'}</summary>
        {inspected.model && <><p>{inspected.model.buffers.filter(item=>item.kind==='tool').length} call previews · {inspected.modelOutcome?.toolCalls.length ?? 0} normalized calls</p><JsonView value={inspected.model.buffers} label="Model draft buffers"/></>}
        {inspected.modelRequest && <details><summary>Encoded fixture request</summary><JsonView value={inspected.modelRequest} label="Encoded fixture request"/></details>}
        {inspected.modelOutcome && <details><summary>Normalized outcome and fixture usage</summary><p>Synthetic usage · unavailable counters stay unknown.</p><JsonView value={inspected.modelOutcome} label="Normalized model outcome"/></details>}
        {inspected.modelHistory.length>0 && <details><summary>{inspected.modelHistory.length} prior model attempts</summary><JsonView value={inspected.modelHistory} label="Prior model attempts"/></details>}
      </details>}
      {state.error && <span role="alert" className="lina-simulation-error">{state.error}</span>}
    </>}
    <dialog ref={dialog} className="lina-run-dialog" aria-labelledby="lina-run-title">
      <form onSubmit={event => { event.preventDefault(); onStart(channel, playback === 'automatic', executionCase, maxRounds, contextCase, toolScenario, follow, modelProtocol, modelCase, safetyCase, stateCase, memoryCase, subagentCase, {...subagentSettings,tools:childTools.split(',').map(item=>item.trim()).filter(Boolean)}, planningCase, planningSettings, environmentCase, environmentSettings, outputCase, outputSettings); dialog.current?.close(); }}>
        <h2 id="lina-run-title">Run turn simulation</h2>
        <label htmlFor="lina-simulation-channel">Channel</label><select id="lina-simulation-channel" value={channel} onChange={event => setChannel(event.target.value as SimulationChannel)} autoFocus>
          <option value="cli">CLI</option><option value="whatsapp">WhatsApp</option><option value="telegram">Telegram</option>
        </select>
        {(['tool-round', 'tool-error-correction', 'tool-failure'].includes(executionCase) || ['interleaved-tools','text-tools'].includes(modelCase)) && <><label className="lina-playback-label" htmlFor="lina-simulation-tools">Tool batch</label><select id="lina-simulation-tools" value={toolScenario} onChange={event => setToolScenario(event.target.value as ToolScenario)}>
          <option value="parallel">Independent parallel calls</option><option value="conflict">Conflicting ordered calls</option><option value="mixed">Known error and success</option>
          <option value="approval">Approval wait</option><option value="auth">Account authorization wait</option><option value="input">Tool input continuation</option>
          <option value="uncertain">Unknown write outcome</option><option value="retry">Bounded read retry</option><option value="hook">Argument hook</option>
        </select></>}
        <label className="lina-playback-label" htmlFor="lina-simulation-case">Execution case</label><select id="lina-simulation-case" value={executionCase} onChange={event => setExecutionCase(event.target.value as SimulationCase)}>
          <option value="direct-answer">Direct answer</option><option value="tool-round">Tool round</option><option value="model-retry">Model retry</option>
          <option value="tool-error-correction">Tool error and correction</option><option value="tool-failure">Terminal tool failure</option>
          <option value="model-failure">Non-retryable model failure</option><option value="loop-exhausted">Loop limit reached</option>
        </select>
        <details className="lina-model-settings"><summary>Model settings</summary>
          <label htmlFor="lina-model-protocol">Model protocol</label><select id="lina-model-protocol" value={modelProtocol} onChange={event=>setModelProtocol(event.target.value as ModelProtocol)}>{MODEL_PROTOCOLS.map(profile=><option key={profile.value} value={profile.value}>{profile.label}</option>)}</select>
          <label className="lina-playback-label" htmlFor="lina-model-case">Model case</label><select id="lina-model-case" value={modelCase} onChange={event=>setModelCase(event.target.value as ModelCase)}>{MODEL_CASES.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select>
        </details>
        <details className="lina-model-settings"><summary>Output and delivery settings</summary>
          <label htmlFor="lina-output-case">Delivery case</label><select id="lina-output-case" value={outputCase} onChange={event => { const selected=event.target.value as OutputCase;setOutputCase(selected);setOutputSettings({...DEFAULT_OUTPUT_SETTINGS,...outputScenarioSettings(selected)}); }}>{OUTPUT_CASES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          <label className="lina-playback-label" htmlFor="lina-output-stream">Reply presentation</label><select id="lina-output-stream" value={outputSettings.streaming} onChange={event => setOutputSettings({...outputSettings,streaming:event.target.value as OutputSettings['streaming']})}><option value="final-only">Final only</option><option value="preview">Preview then final</option></select>
          <label className="lina-playback-label" htmlFor="lina-output-threshold">Completion evidence</label><select id="lina-output-threshold" value={outputSettings.threshold} onChange={event => setOutputSettings({...outputSettings,threshold:event.target.value as OutputSettings['threshold']})}><option value="accepted">Transport accepted</option><option value="delivered">Provider delivered</option><option value="read">Provider read receipt</option></select>
          <label className="lina-playback-label" htmlFor="lina-output-unknown">Unknown send recovery</label><select id="lina-output-unknown" value={outputSettings.unknownPolicy} onChange={event => setOutputSettings({...outputSettings,unknownPolicy:event.target.value as OutputSettings['unknownPolicy']})}><option value="hold">Hold for reconciliation</option><option value="warned-resend">Resend with duplicate warning</option></select>
          <label className="lina-playback-label" htmlFor="lina-output-attempts">Maximum send attempts</label><input id="lina-output-attempts" type="number" min="1" max="5" value={outputSettings.maxAttempts} onChange={event => setOutputSettings({...outputSettings,maxAttempts:Math.max(1,Math.min(5,Number(event.target.value)||1))})}/>
          <label className="lina-playback-label" htmlFor="lina-output-part-limit">Characters per part · simulation</label><input id="lina-output-part-limit" type="number" min="24" max="4096" value={outputSettings.partLimit} onChange={event => setOutputSettings({...outputSettings,partLimit:Math.max(24,Math.min(4096,Number(event.target.value)||160))})}/>
          {channel === 'cli' && <><label className="lina-playback-label" htmlFor="lina-output-cli">CLI output</label><select id="lina-output-cli" value={outputSettings.cliMode} onChange={event => setOutputSettings({...outputSettings,cliMode:event.target.value as OutputSettings['cliMode']})}><option value="tty">Interactive terminal</option><option value="text">Plain text</option><option value="jsonl">JSON event stream</option><option value="rpc">RPC</option></select></>}
        </details>
        <details className="lina-model-settings"><summary>Execution Environment settings</summary>
          <label htmlFor="lina-environment-case">Environment case</label><select id="lina-environment-case" value={environmentCase} onChange={event => { const selected=event.target.value as EnvironmentCase;setEnvironmentCase(selected);setEnvironmentSettings({...DEFAULT_ENVIRONMENT_SETTINGS,...environmentScenarioSettings(selected)}); }}>{ENVIRONMENT_CASES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          {environmentCase !== 'disabled' && <>
            <label className="lina-playback-label" htmlFor="lina-environment-backend">Execution target</label><select id="lina-environment-backend" value={environmentSettings.backend} onChange={event=>setEnvironmentSettings({...environmentSettings,backend:event.target.value as EnvironmentSettings['backend']})}><option value="local">Current PC</option><option value="docker">Docker sandbox</option><option value="remote">Remote sandbox</option></select>
            <label className="lina-playback-label" htmlFor="lina-environment-workspaceAccess">Workspace access</label><select id="lina-environment-workspaceAccess" value={environmentSettings.workspaceAccess} onChange={event=>setEnvironmentSettings({...environmentSettings,workspaceAccess:event.target.value as EnvironmentSettings['workspaceAccess']})}><option value="copy">Copied workspace</option><option value="read-only">Read-only mount</option><option value="read-write">Writable workspace</option></select>
            <label className="lina-playback-label" htmlFor="lina-environment-sharing">Child workspace sharing</label><select id="lina-environment-sharing" value={environmentSettings.sharing} onChange={event=>setEnvironmentSettings({...environmentSettings,sharing:event.target.value as EnvironmentSettings['sharing']})}><option value="shared">Shared workspace</option><option value="agent">Separate per agent</option></select>
            <label className="lina-playback-label" htmlFor="lina-environment-network">Network</label><select id="lina-environment-network" value={environmentSettings.network} onChange={event=>setEnvironmentSettings({...environmentSettings,network:event.target.value as EnvironmentSettings['network']})}><option value="inherit">Inherit environment</option><option value="none">No network</option><option value="restricted">Restricted network</option></select>
            <label className="lina-playback-label" htmlFor="lina-environment-lifetime">Environment lifetime</label><select id="lina-environment-lifetime" value={environmentSettings.lifetime} onChange={event=>setEnvironmentSettings({...environmentSettings,lifetime:event.target.value as EnvironmentSettings['lifetime']})}><option value="retain">Retain environment</option><option value="release">Release after run</option></select>
            <label className="lina-playback-label" htmlFor="lina-environment-commandTimeoutMs">Command deadline (ms)</label><input id="lina-environment-commandTimeoutMs" type="number" min="1" max="3600000" value={environmentSettings.commandTimeoutMs} onChange={event=>setEnvironmentSettings({...environmentSettings,commandTimeoutMs:Number(event.target.value)})}/>
            <label className="lina-playback-label" htmlFor="lina-environment-maxOutputBytes">Output limit (bytes)</label><input id="lina-environment-maxOutputBytes" type="number" min="1" max="1048576" value={environmentSettings.maxOutputBytes} onChange={event=>setEnvironmentSettings({...environmentSettings,maxOutputBytes:Number(event.target.value)})}/>
          </>}
        </details>
        <details className="lina-model-settings"><summary>Planning settings</summary>
          <label htmlFor="lina-planning-case">Planning case</label><select id="lina-planning-case" value={planningCase} onChange={event => { const selected=event.target.value as PlanningCase;setPlanningCase(selected);setPlanningSettings({...DEFAULT_PLANNING_SETTINGS,...planningScenarioSettings(selected)}); }}>{PLANNING_CASES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          {planningCase !== 'disabled' && <>
            <label className="lina-playback-label" htmlFor="lina-planning-strategy">Task strategy</label><select id="lina-planning-strategy" value={planningSettings.strategy} onChange={event=>setPlanningSettings({...planningSettings,strategy:event.target.value as PlanningSettings['strategy']})}><option value="direct">Direct loop</option><option value="model-led">Model-led plan</option><option value="authored-workflow">Authored workflow</option></select>
            <label className="lina-playback-label" htmlFor="lina-planning-mode">Execution mode</label><select id="lina-planning-mode" value={planningSettings.executionMode} onChange={event=>setPlanningSettings({...planningSettings,executionMode:event.target.value as PlanningSettings['executionMode']})}><option value="execute">Execute</option><option value="plan-only">Plan only</option><option value="review-before-execution">Review plan first</option></select>
            <label className="lina-playback-label" htmlFor="lina-planning-replans">Maximum replans</label><input id="lina-planning-replans" type="number" min="0" max="10" value={planningSettings.maxReplans} onChange={event=>setPlanningSettings({...planningSettings,maxReplans:Number(event.target.value)})}/>
            <label className="lina-playback-label" htmlFor="lina-planning-ready">Ready work limit</label><input id="lina-planning-ready" type="number" min="1" max="20" value={planningSettings.maxReady} onChange={event=>setPlanningSettings({...planningSettings,maxReady:Number(event.target.value)})}/>
          </>}
        </details>
        <details className="lina-model-settings"><summary>Subagent settings</summary>
          <label htmlFor="lina-subagent-case">Subagent case</label><select id="lina-subagent-case" value={subagentCase} onChange={event => { const selected=event.target.value as SubagentCase;setSubagentCase(selected);setSubagentSettings({...DEFAULT_SUBAGENT_SETTINGS,...subagentScenarioSettings(selected)});setChildTools(DEFAULT_SUBAGENT_SETTINGS.tools.join(', '));if(selected !== 'disabled')setExecutionCase('tool-round'); }}>{SUBAGENT_CASES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          {subagentCase !== 'disabled' && <>
            <label className="lina-playback-label" htmlFor="lina-subagent-depth">Maximum delegation depth</label><input id="lina-subagent-depth" type="number" min="0" max="20" value={subagentSettings.maxDepth} onChange={event=>setSubagentSettings({...subagentSettings,maxDepth:Number(event.target.value)})}/>
            <label className="lina-playback-label" htmlFor="lina-subagent-concurrency">Concurrent children</label><input id="lina-subagent-concurrency" type="number" min="1" max="20" value={subagentSettings.maxConcurrent} onChange={event=>setSubagentSettings({...subagentSettings,maxConcurrent:Number(event.target.value)})}/>
            <label className="lina-playback-label" htmlFor="lina-subagent-tree">Total task-tree children</label><input id="lina-subagent-tree" type="number" min="0" max="50" value={subagentSettings.maxTreeChildren} onChange={event=>setSubagentSettings({...subagentSettings,maxTreeChildren:Number(event.target.value)})}/>
            <label className="lina-playback-label" htmlFor="lina-subagent-context">Child context</label><select id="lina-subagent-context" value={subagentSettings.contextMode} onChange={event=>setSubagentSettings({...subagentSettings,contextMode:event.target.value as SubagentSettings['contextMode']})}><option value="selected">Selected parent context</option><option value="fork">Transcript fork</option><option value="task-only">Fresh task only</option></select>
            <label className="lina-playback-label" htmlFor="lina-subagent-completion">Parent behavior</label><select id="lina-subagent-completion" value={subagentSettings.completion} onChange={event=>setSubagentSettings({...subagentSettings,completion:event.target.value as SubagentSettings['completion']})}><option value="await-result">Wait for result</option><option value="return-handle">Continue with child handle</option></select>
            <label className="lina-playback-label" htmlFor="lina-subagent-lifetime">Child ownership</label><select id="lina-subagent-lifetime" value={subagentSettings.lifetime} onChange={event=>setSubagentSettings({...subagentSettings,lifetime:event.target.value as SubagentSettings['lifetime']})}><option value="attached">Attached to parent</option><option value="detached">Detached, supervisor owned</option></select>
            <label className="lina-playback-label" htmlFor="lina-subagent-persistent">Child session</label><select id="lina-subagent-persistent" value={subagentSettings.persistent?'persistent':'task'} onChange={event=>setSubagentSettings({...subagentSettings,persistent:event.target.value==='persistent'})}><option value="task">Task scoped</option><option value="persistent">Persistent session</option></select>
            <label className="lina-playback-label" htmlFor="lina-subagent-profile">Worker profile</label><select id="lina-subagent-profile" value={subagentSettings.workerProfile} onChange={event=>setSubagentSettings({...subagentSettings,workerProfile:event.target.value as SubagentSettings['workerProfile']})}><option value="general">General</option><option value="specialist">Specialist</option></select>
            <label className="lina-playback-label" htmlFor="lina-subagent-model">Child model route</label><input id="lina-subagent-model" value={subagentSettings.modelRoute} onChange={event=>setSubagentSettings({...subagentSettings,modelRoute:event.target.value})}/>
            <label className="lina-playback-label" htmlFor="lina-subagent-tools">Permitted child tools</label><input id="lina-subagent-tools" value={childTools} onChange={event=>setChildTools(event.target.value)}/>
            <label className="lina-playback-label" htmlFor="lina-subagent-memory">Memory access</label><select id="lina-subagent-memory" value={subagentSettings.memoryAccess} onChange={event=>setSubagentSettings({...subagentSettings,memoryAccess:event.target.value as SubagentSettings['memoryAccess']})}><option value="private">Child private</option><option value="shared-read">Permitted shared reads</option></select>
          </>}
        </details>
        <details className="lina-model-settings"><summary>Memory settings</summary>
          <label htmlFor="lina-memory-case">Memory case</label><select id="lina-memory-case" value={memoryCase} onChange={event => { const selected=event.target.value as MemoryCase;setMemoryCase(selected);const configured=memoryScenarioSettings(selected);if(configured.executionCase)setExecutionCase(configured.executionCase);if(configured.toolScenario)setToolScenario(configured.toolScenario); }}>{MEMORY_CASES.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select>
        </details>
        <details className="lina-model-settings"><summary>State and recovery settings</summary>
          <label htmlFor="lina-state-case">Recovery case</label><select id="lina-state-case" value={stateCase} onChange={event => { const selected = event.target.value as StateCase; setStateCase(selected); const configured = stateScenarioSettings(selected); if (configured.executionCase) setExecutionCase(configured.executionCase); if (configured.toolScenario) setToolScenario(configured.toolScenario); if (configured.safetyCase) setSafetyCase(configured.safetyCase); }}>{STATE_CASES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        </details>
        <details className="lina-model-settings"><summary>Safety settings</summary>
          <label htmlFor="lina-safety-case">Permission case</label><select id="lina-safety-case" value={safetyCase} onChange={event => { setSafetyCase(event.target.value as SafetyCase); if (event.target.value !== 'policy-allow') setExecutionCase('tool-round'); }}>{SAFETY_CASES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        </details>
        <label className="lina-playback-label" htmlFor="lina-simulation-context">Context case</label><select id="lina-simulation-context" value={contextCase} onChange={event => setContextCase(event.target.value as ContextCase)}>
          <option value="fits">Fits budget</option><option value="prune">Prune context</option><option value="compact">Compact history</option>
          <option value="compact-failure">Compaction fails</option><option value="too-large">Protected context too large</option><option value="invalid">Invalid context</option>
          <option value="catalog-change">Catalog changes before launch</option><option value="hook">Context projection hook</option><option value="resource">Selected connector resource</option><option value="prompt">Selected connector prompt</option><option value="foreign-scope">Foreign scope refused</option>
        </select>
        <label className="lina-playback-label" htmlFor="lina-simulation-follow">Graph following</label><select id="lina-simulation-follow" value={follow ? 'follow' : 'manual'} onChange={event => setFollow(event.target.value === 'follow')}>
          <option value="follow">Follow current event</option><option value="manual">Explore graph manually</option>
        </select>
        <label className="lina-playback-label" htmlFor="lina-simulation-rounds">Maximum rounds</label><select id="lina-simulation-rounds" value={maxRounds} onChange={event => setMaxRounds(Number(event.target.value))}>
          {[1, 2, 3, 5, 10].map(limit => <option key={limit} value={limit}>{limit}</option>)}
        </select>
        <label className="lina-playback-label" htmlFor="lina-simulation-playback">Playback</label><select id="lina-simulation-playback" value={playback} onChange={event => setPlayback(event.target.value)}>
          <option value="automatic">Automatic</option><option value="manual">Manual · Next button</option>
        </select>
        <div className="lina-run-actions"><button type="button" onClick={() => dialog.current?.close()}>Cancel</button><button type="submit" className="lina-primary" disabled={disabled}>Run simulation</button></div>
      </form>
    </dialog>
  </div>;
}
