/** Observer expiry is separate from a native execution deadline. Cancellation is
 * requested once, then observed for a bounded window without resubmitting work. */
export interface ObserverTermination {
  reason: "deadline" | "user-interrupt";
  observedAt: string;
  statusAtDeadline: string | null;
  statusAtInterruption: string;
  cancellationRequestedAt: string;
  cancellationAcknowledgedAt: string | null;
  cancellationError: string | null;
  settledStatus: string | null;
  settlementObservedAt: string | null;
  settlementError: string | null;
  cancellationDeadlineMs: number;
  settlementWindowMs: number;
  settlementWindowExhausted: boolean;
}
const active = (status: string) => ["queued", "running", "suspended"].includes(status);
export async function terminateObservation<T extends { status: string }>(options: {
  reason: ObserverTermination["reason"]; snapshot: T;
  cancel(signal: AbortSignal): Promise<T>; inspect(signal: AbortSignal): Promise<T>;
  cancellationDeadlineMs?: number; settlementWindowMs?: number; pollMs?: number;
  now?: () => number; sleep?: (ms: number) => Promise<void>;
}): Promise<{ snapshot: T; termination: ObserverTermination }> {
  const now = options.now ?? Date.now, sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const cancellationDeadlineMs = options.cancellationDeadlineMs ?? 5000, settlementWindowMs = options.settlementWindowMs ?? 5000, pollMs = options.pollMs ?? 250;
  if (![cancellationDeadlineMs, settlementWindowMs, pollMs].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("Observer settlement budgets must be positive integers.");
  const observedAt = new Date(now()).toISOString();
  const termination: ObserverTermination = { reason: options.reason, observedAt,
    statusAtDeadline: options.reason === "deadline" ? options.snapshot.status : null,
    statusAtInterruption: options.snapshot.status, cancellationRequestedAt: observedAt,
    cancellationAcknowledgedAt: null, cancellationError: null, settledStatus: null, settlementObservedAt: null,
    settlementError: null, cancellationDeadlineMs, settlementWindowMs, settlementWindowExhausted: false };
  let snapshot = options.snapshot;
  try {
    snapshot = await bounded(options.cancel, cancellationDeadlineMs);
    termination.cancellationAcknowledgedAt = new Date(now()).toISOString();
  } catch (error) { termination.cancellationError = message(error); }
  const deadline = now() + settlementWindowMs;
  while (active(snapshot.status) && now() < deadline) {
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
    const remaining = deadline - now();
    if (remaining <= 0) break;
    try { snapshot = await bounded(options.inspect, remaining); }
    catch (error) { termination.settlementError = message(error); break; }
  }
  if (!active(snapshot.status)) { termination.settledStatus = snapshot.status; termination.settlementObservedAt = new Date(now()).toISOString(); }
  else termination.settlementWindowExhausted = now() >= deadline;
  return { snapshot, termination };
}
async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, milliseconds: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation(controller.signal), new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("Observer control request exceeded its bounded window.")); }, milliseconds);
  })]); } finally { if (timer) clearTimeout(timer); }
}
function message(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 512); }

/** Raw native configuration remains authoritative. Equal numerical values across
 * these scopes do not establish equal execution budgets. Unknown stays null. */
export function describeExecutionBudgets(platform: string, configuration: Readonly<Record<string, unknown>>, admittedTools: unknown) {
  const number = (key: string) => typeof configuration[key] === "number" ? configuration[key] : null;
  return {
    admittedTools,
    nativeDeadline: platform === "mastra" ? { milliseconds: number("executionTimeoutMs"), scope: "active-generation-segment; suspended review excluded" }
      : platform === "temporal" ? { milliseconds: number("activityTimeoutMs"), scope: "each model activity StartToClose; review waiting excluded" }
      : { milliseconds: null, scope: "No comparable active-generation deadline retained in this manifest" },
    runnerTransportDeadline: platform === "langgraph" ? { milliseconds: number("timeoutMs"), scope: "runner HTTP request; not total agent execution" } : null,
    providerRequestDeadline: { milliseconds: null, scope: "not retained by this manifest; inspect mapped request/native model configuration" },
  };
}
