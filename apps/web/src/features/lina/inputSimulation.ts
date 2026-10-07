import type { LinaDocument } from './linaModel';

export type SimulationChannel = 'cli' | 'whatsapp' | 'telegram';
export interface SimulationState {
  channel: SimulationChannel;
  route: string[];
  /** Index of the currently highlighted node. */
  step: number;
  status: 'running' | 'paused' | 'completed' | 'blocked';
  error?: string;
}

// Baseline: new ordinary input, no attachments, admitted source, idle conversation.
// The runtime node is a handoff boundary; no model or external service executes.
function baselineRoute(channel: SimulationChannel): string[] {
  return [
    `lina-input-${channel}`,
    ...['envelope', 'identity', 'access', 'activation', 'conversation', 'claim',
      'intent', 'accept', 'dispatch', 'burst', 'admission', 'runtime']
      .map(component => `lina-input-${component}`),
  ];
}

function routeError(route: string[], document: LinaDocument): string | undefined {
  for (const id of route) {
    if (!document.nodes.some(node => node.id === id)) {
      return `Simulation needs the missing component: ${id}.`;
    }
  }
  for (let i = 1; i < route.length; i++) {
    const source = route[i - 1];
    const target = route[i];
    if (!document.edges.some(edge => edge.source === source && edge.target === target)) {
      return `Simulation needs the missing connection: ${source} → ${target}.`;
    }
  }
}

/** Start a design simulation against the current document; missing routes block it. */
export function startSimulation(
  channel: SimulationChannel,
  document: LinaDocument,
  running = true,
): SimulationState {
  const route = baselineRoute(channel);
  const error = routeError(route, document);
  return {
    channel, route, step: 0,
    status: error ? 'blocked' : running ? 'running' : 'paused',
    ...(error ? { error } : {}),
  };
}

/** Advance one connection. Manual stepping preserves paused mode until completion. */
export function advanceSimulation(state: SimulationState, document: LinaDocument): SimulationState {
  if (state.status === 'blocked' || state.status === 'completed') return state;
  const error = routeError(state.route, document);
  if (error) return { ...state, status: 'blocked', error };
  const step = Math.min(state.step + 1, state.route.length - 1);
  return {
    ...state,
    step,
    status: step === state.route.length - 1 ? 'completed' : state.status,
  };
}

/** Return to the adapter with the same channel, paused and ready for another run. */
export function resetSimulation(state: SimulationState, document: LinaDocument): SimulationState {
  return startSimulation(state.channel, document, false);
}
