import { ComputerNativeError } from "./errors.js";
import type { TurnStatus } from "./contracts.js";

const transitions: Readonly<Record<TurnStatus, readonly TurnStatus[]>> = {
  idle: ["submitting"],
  submitting: ["streaming", "failed", "cancelled", "interrupted"],
  streaming: ["completed", "failed", "cancelled", "interrupted"],
  completed: [],
  failed: [],
  cancelled: [],
  interrupted: [],
};

export function assertTransition(from: TurnStatus, to: TurnStatus): void {
  if (!transitions[from].includes(to)) {
    throw new ComputerNativeError("persistence", `Invalid turn transition: ${from} → ${to}.`);
  }
}
export function allowedTransitions(from: TurnStatus): readonly TurnStatus[] {
  return transitions[from];
}
