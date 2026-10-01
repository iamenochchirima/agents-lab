export interface ControlConfig {
  /** The initial policy handles model tool calls one at a time. */
  readonly toolCallOrder: "serial";
  /** Maximum model generations for one user task, including the final response. */
  readonly maxModelCalls: number;
  /** Maximum tool executions for one user task. */
  readonly maxToolCalls: number;
}

export const DEFAULT_CONTROL_CONFIG: ControlConfig = Object.freeze({
  toolCallOrder: "serial",
  maxModelCalls: 4,
  maxToolCalls: 8,
});

export class ControlConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControlConfigError";
  }
}

/** Parses the control policy options before constructing an implementation. */
export function parseControlConfig(input: unknown = {}): ControlConfig {
  if (!isRecord(input)) throw new ControlConfigError("Control config must be an object.");
  rejectUnknownKeys(input, ["toolCallOrder", "maxModelCalls", "maxToolCalls"]);
  const toolCallOrder = input.toolCallOrder === undefined ? DEFAULT_CONTROL_CONFIG.toolCallOrder : input.toolCallOrder;
  if (toolCallOrder !== "serial") {
    throw new ControlConfigError('toolCallOrder must be "serial".');
  }
  const maxModelCalls = input.maxModelCalls === undefined ? DEFAULT_CONTROL_CONFIG.maxModelCalls : input.maxModelCalls;
  if (!isIntegerInRange(maxModelCalls, 1, 16)) {
    throw new ControlConfigError("maxModelCalls must be an integer from 1 through 16.");
  }
  const maxToolCalls = input.maxToolCalls === undefined ? DEFAULT_CONTROL_CONFIG.maxToolCalls : input.maxToolCalls;
  if (!isIntegerInRange(maxToolCalls, 0, 32)) {
    throw new ControlConfigError("maxToolCalls must be an integer from 0 through 32.");
  }
  return Object.freeze({ toolCallOrder, maxModelCalls, maxToolCalls });
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new ControlConfigError(`Unknown control config field: ${unknown}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
