export interface ControlConfig {
  /** The initial policy handles model tool calls one at a time. */
  readonly toolCallOrder: "serial";
}

export const DEFAULT_CONTROL_CONFIG: ControlConfig = Object.freeze({
  toolCallOrder: "serial",
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
  rejectUnknownKeys(input, ["toolCallOrder"]);
  const toolCallOrder = input.toolCallOrder === undefined ? DEFAULT_CONTROL_CONFIG.toolCallOrder : input.toolCallOrder;
  if (toolCallOrder !== "serial") {
    throw new ControlConfigError('toolCallOrder must be "serial".');
  }
  return Object.freeze({ toolCallOrder });
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new ControlConfigError(`Unknown control config field: ${unknown}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
