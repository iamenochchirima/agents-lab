/** Admission-time limits. Native runtimes own waiting, cancellation and recovery. */
export interface RunExecutionRequest {
  readonly mode: "sustained";
  readonly maxDurationMs?: number;
  readonly modelTimeoutMs?: number;
}
export interface RunExecutionPolicy {
  readonly schemaVersion: 1;
  readonly mode: "sustained";
  readonly deadlineAt: string;
  readonly modelTimeoutMs: number;
}
export const SUSTAINED_TOOL_LIMITS = { maxRounds: 24, maxCalls: 48 } as const;
export const DEFAULT_TASK_DURATION_MS = 60 * 60 * 1_000;

/** Validate before creating a session or dispatching a native run. */
export function validateExecutionRequest(value: unknown): asserts value is RunExecutionRequest | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("execution must be an object.");
  const input = value as Record<string, unknown>;
  if (input.mode !== "sustained" || Object.keys(input).some(key => !["mode", "maxDurationMs", "modelTimeoutMs"].includes(key))) {
    throw new Error("execution requires sustained mode and supported limit fields.");
  }
  for (const [name, maximum] of [["maxDurationMs", DEFAULT_TASK_DURATION_MS], ["modelTimeoutMs", 300_000]] as const) {
    const limit = input[name];
    if (limit !== undefined && (!Number.isInteger(limit) || Number(limit) < 1_000 || Number(limit) > maximum)) {
      throw new Error(`execution.${name} must be an integer between 1000 and ${maximum}.`);
    }
  }
}

/** The absolute deadline is retained once; resume never receives a fresh budget. */
export function admitExecutionPolicy(request: RunExecutionRequest | undefined, createdAt: string): RunExecutionPolicy | undefined {
  validateExecutionRequest(request);
  if (!request) return undefined;
  const startedAt = Date.parse(createdAt);
  if (!Number.isFinite(startedAt)) throw new Error("Execution admission requires a valid timestamp.");
  return { schemaVersion: 1, mode: "sustained",
    deadlineAt: new Date(startedAt + (request.maxDurationMs ?? DEFAULT_TASK_DURATION_MS)).toISOString(),
    modelTimeoutMs: request.modelTimeoutMs ?? 60_000 };
}

/** Invalid retained deadlines fail closed instead of allowing unbounded dispatch. */
export function remainingExecutionMs(policy: RunExecutionPolicy | undefined, nowMs: number): number {
  if (!policy) return Infinity;
  const deadline = Date.parse(policy.deadlineAt);
  return Number.isFinite(deadline) && Number.isFinite(nowMs) ? Math.max(0, deadline - nowMs) : 0;
}
export function executionDeadlineReached(policy: RunExecutionPolicy | undefined, nowMs: number): boolean {
  return remainingExecutionMs(policy, nowMs) === 0;
}
