import type { LinaDocument } from './linaModel';

export type SimulationChannel = 'cli' | 'whatsapp' | 'telegram';
export type SimulationCase = 'direct-answer' | 'tool-round' | 'model-retry' | 'tool-error-correction' | 'tool-failure' | 'model-failure' | 'loop-exhausted';
export type TurnOutcome = 'completed' | 'failed' | 'exhausted';
export interface SimulationProgress {
  rounds: number;
  attempts: number;
  toolOutcome?: 'success' | 'correctable-error' | 'fatal-error';
  outcome?: TurnOutcome;
  detail?: string;
}
export interface SimulationState extends SimulationProgress {
  channel: SimulationChannel;
  executionCase: SimulationCase;
  maxRounds: number;
  /** Ordered visits, including repeated nodes within the same turn. */
  route: string[];
  /** Transition i joins route[i] to route[i + 1]. */
  transitions: string[];
  /** Synthetic state after each visit, shared by automatic and manual playback. */
  progress: SimulationProgress[];
  step: number;
  status: 'running' | 'paused' | 'completed' | 'blocked';
  error?: string;
}

// Compile deterministic fixtures through the round-limit policy. This is a design
// simulation: model responses and tool outcomes are supplied, never executed.
function scriptedRoute(channel: SimulationChannel, executionCase: SimulationCase, maxRounds: number) {
  const inputRoute = [
    `lina-input-${channel}`,
    ...(channel === 'telegram' ? ['lina-input-telegram-route'] : []),
    ...['envelope', 'identity', 'access', 'activation', 'conversation', 'claim',
      'intent', 'accept', 'dispatch', 'burst', 'admission', 'runtime']
      .map(component => `lina-input-${component}`),
  ];
  const visits: [string, string][] = [];
  let current: SimulationProgress = { rounds: 0, attempts: 0 };
  const progress = inputRoute.map(() => ({ ...current }));
  function visit(node: string, edge: string, update: Partial<SimulationProgress> = {}) {
    current = { ...current, detail: undefined, ...update };
    visits.push([node, edge]);
    progress.push({ ...current });
  }
  visit('start', 'handoff');
  let gateEdge = 'start-limits';
  while (true) {
    const exhausted = current.rounds >= maxRounds;
    visit('limits', gateEdge, { detail: exhausted ? 'Round limit reached' : `Round ${current.rounds + 1} allowed` });
    if (exhausted) {
      visit('settle', 'limits-terminal', { outcome: 'exhausted', detail: 'No further model call allowed' });
      break;
    }
    visit('prepare', 'limits-prepare');
    visit('model', 'prepare-model', { rounds: current.rounds + 1, attempts: current.attempts + 1 });
    visit('decide', 'model-decide');
    if (executionCase === 'model-failure') {
      visit('settle', 'decide-terminal', { outcome: 'failed', detail: 'Non-retryable model failure' });
      break;
    }
    if (executionCase === 'model-retry' && current.rounds === 1) {
      visit('recover', 'decide-recover', { detail: 'Transient model failure; one retry allowed' });
      visit('prepare', 'recover-prepare');
      // Provider retry keeps the same logical round and does not replay tools.
      visit('model', 'prepare-model', { attempts: current.attempts + 1, detail: 'Retry within the same round' });
      visit('decide', 'model-decide');
    }
    const needsTools = executionCase === 'tool-failure'
      || executionCase === 'tool-round' && current.rounds === 1
      || executionCase === 'tool-error-correction' && current.rounds <= 2;
    if (needsTools) {
      const toolOutcome = executionCase === 'tool-failure' ? 'fatal-error'
        : executionCase === 'tool-error-correction' && current.rounds === 1 ? 'correctable-error' : 'success';
      visit('tools', 'decide-tools', { toolOutcome: undefined });
      visit('tool-outcomes', 'tools-outcomes', { toolOutcome, detail: toolOutcome === 'correctable-error'
        ? 'Tool error returned to model for correction' : toolOutcome === 'fatal-error' ? 'Terminal tool failure' : 'Tool result returned' });
      if (toolOutcome === 'fatal-error') {
        visit('settle', 'outcomes-terminal', { outcome: 'failed', detail: 'Tool failure stops the turn' });
        break;
      }
      visit('controls', 'outcomes-controls');
    } else if (executionCase === 'loop-exhausted') {
      visit('controls', 'decide-continue', { detail: 'Model requests another round' });
    } else {
      visit('controls', 'decide-answer');
      visit('settle', 'controls-finish', { outcome: 'completed', detail: 'Answer complete' });
      break;
    }
    gateEdge = 'controls-continue';
  }
  visit('release', 'settle-release');
  return { inputRoute, visits, progress };
}

function routeError(state: Pick<SimulationState, 'route' | 'transitions'>, document: LinaDocument): string | undefined {
  for (const id of state.route) {
    if (!document.nodes.some(node => node.id === id)) {
      return `Simulation needs the missing component: ${id}.`;
    }
  }
  for (let i = 0; i < state.route.length - 1; i++) {
    const source = state.route[i];
    const target = state.route[i + 1];
    const id = state.transitions[i];
    if (!document.edges.some(edge => edge.id === id && edge.source === source && edge.target === target)) {
      return `Simulation needs the missing connection: ${source} → ${target}.`;
    }
  }
}

/** Start one scripted turn against the current graph; missing routes block playback. */
export function startSimulation(
  channel: SimulationChannel,
  document: LinaDocument,
  running = true,
  executionCase: SimulationCase = 'direct-answer',
  maxRounds = 3,
): SimulationState {
  const limit = Math.max(1, Math.min(10, Math.trunc(maxRounds) || 3));
  const { inputRoute, visits, progress } = scriptedRoute(channel, executionCase, limit);
  // Input's ordinary path has one edge per pair. Resolve it from the maintained
  // graph, then choose execution branch IDs explicitly so parallel edges stay distinct.
  const transitions = inputRoute.slice(1).map((target, index) =>
    document.edges.find(edge => edge.source === inputRoute[index] && edge.target === target)?.id ?? '');
  const route = [...inputRoute, ...visits.map(([node]) => `lina-execution-${node}`)];
  transitions.push(...visits.map(([, edge]) => `lina-execution-edge-${edge}`));
  const error = routeError({ route, transitions }, document);
  return {
    channel, executionCase, maxRounds: limit, route, transitions, progress, step: 0, ...progress[0],
    status: error ? 'blocked' : running ? 'running' : 'paused',
    ...(error ? { error } : {}),
  };
}

/** Advance one visit. Both automatic playback and Next use this operation. */
export function advanceSimulation(state: SimulationState, document: LinaDocument): SimulationState {
  if (state.status === 'blocked' || state.status === 'completed') return state;
  const error = routeError(state, document);
  if (error) return { ...state, status: 'blocked', error };
  const step = Math.min(state.step + 1, state.route.length - 1);
  return {
    ...state,
    step,
    ...state.progress[step],
    status: step === state.route.length - 1 ? 'completed' : state.status,
  };
}

/** Keep the channel and case, clear progress and return paused to the adapter. */
export function resetSimulation(state: SimulationState, document: LinaDocument): SimulationState {
  return startSimulation(state.channel, document, false, state.executionCase, state.maxRounds);
}
