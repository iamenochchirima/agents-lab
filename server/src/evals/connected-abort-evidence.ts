import type { RunView } from '../control-plane/application/run-service.js';

export interface ConnectedAbortEvidence {
  readonly recordedAt: string;
  readonly cancellation: { requestedAt: string; response?: unknown; error?: string };
  readonly native?: RunView;
  readonly cancellationConfirmed?: boolean;
  readonly executionTerminalObserved?: boolean;
  readonly nativeObservationError?: string;
  readonly providerState?: unknown;
  readonly providerObservationError?: string;
}

/** An abort is an observation boundary, never authorization for another tool call.
 * Read native and independent provider state even when cancellation is unconfirmed.
 * A single immediate snapshot does not establish that a still-running task stopped.
 */
export async function observeConnectedAbort(input: {
  cancel: () => Promise<unknown>;
  inspect: () => Promise<RunView>;
  readProviderState: () => Promise<unknown>;
}): Promise<ConnectedAbortEvidence> {
  const cancellation: { requestedAt: string; response?: unknown; error?: string } = { requestedAt: new Date().toISOString() };
  try { cancellation.response = await input.cancel(); }
  catch (error) { cancellation.error = observationError(error); }
  let native: RunView | undefined;
  let nativeObservationError: string | undefined;
  try { native = await input.inspect(); }
  catch (error) { nativeObservationError = observationError(error); }
  let providerState: unknown;
  let providerObservationError: string | undefined;
  try { providerState = await input.readProviderState(); }
  catch (error) { providerObservationError = observationError(error); }
  return {
    recordedAt: new Date().toISOString(), cancellation,
    ...(native ? { native, cancellationConfirmed: native.status === 'cancelled',
      executionTerminalObserved: ['completed', 'failed', 'cancelled', 'reconciliation_required'].includes(native.status) } : {}),
    ...(nativeObservationError ? { nativeObservationError } : {}),
    ...(providerObservationError ? { providerObservationError } : { providerState }),
  };
}

function observationError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : 'Observation failed';
}
