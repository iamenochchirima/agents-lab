import { useRef, useState } from 'react';
import type { SimulationChannel, SimulationState } from './inputSimulation';
import type { LinaDocument } from './linaModel';

type Props = {
  document: LinaDocument;
  state: SimulationState | null;
  active: boolean;
  disabled: boolean;
  onStart: (channel: SimulationChannel, automatic: boolean) => void;
  onPause: () => void;
  onResume: () => void;
  onNext: () => void;
  onReset: () => void;
};
const channelNames = { cli: 'CLI', whatsapp: 'WhatsApp', telegram: 'Telegram' };

/** Configure a synthetic input and control playback; no message or transport is sent. */
export function LinaSimulation({ document, state, active, disabled, onStart, onPause, onResume, onNext, onReset }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [channel, setChannel] = useState<SimulationChannel>('cli');
  const [playback, setPlayback] = useState('automatic');
  const current = state && document.nodes.find(node => node.id === state.route[state.step]);
  const terminal = state?.status === 'completed' || state?.status === 'blocked';
  return <div className="lina-simulation" aria-label="Input simulation">
    <button className="lina-primary" disabled={disabled} onClick={() => dialog.current?.showModal()}>Run</button>
    {state && active && <>
      <div className="lina-simulation-progress" role="status" aria-live="polite">
        <span>{channelNames[state.channel]} · {state.status === 'completed' ? 'Input simulation complete' : state.status === 'blocked' ? 'Simulation blocked' : state.status === 'running' ? 'Auto-running' : 'Paused'} · {state.step + 1}/{state.route.length}</span>
        <strong>{current?.title ?? state.route[state.step]}</strong>
      </div>
      <div className="lina-simulation-controls">
        <button disabled={disabled || terminal} onClick={state.status === 'running' ? onPause : onResume}>{state.status === 'running' ? 'Pause' : 'Resume'}</button>
        <button disabled={disabled || terminal} onClick={onNext}>Next</button>
        <button disabled={disabled} onClick={onReset}>Reset</button>
      </div>
      {state.error && <span role="alert" className="lina-simulation-error">{state.error}</span>}
    </>}
    <dialog ref={dialog} className="lina-run-dialog" aria-labelledby="lina-run-title">
      <form onSubmit={event => { event.preventDefault(); onStart(channel, playback === 'automatic'); dialog.current?.close(); }}>
        <h2 id="lina-run-title">Run simulation</h2>
        <label htmlFor="lina-simulation-channel">Channel</label><select id="lina-simulation-channel" value={channel} onChange={event => setChannel(event.target.value as SimulationChannel)} autoFocus>
          <option value="cli">CLI</option><option value="whatsapp">WhatsApp</option><option value="telegram">Telegram</option>
        </select>
        <label className="lina-playback-label" htmlFor="lina-simulation-playback">Playback</label><select id="lina-simulation-playback" value={playback} onChange={event => setPlayback(event.target.value)}>
          <option value="automatic">Automatic</option><option value="manual">Manual · Next button</option>
        </select>
        <div className="lina-run-actions"><button type="button" onClick={() => dialog.current?.close()}>Cancel</button><button type="submit" className="lina-primary" disabled={disabled}>Run simulation</button></div>
      </form>
    </dialog>
  </div>;
}
