import type { TurnStatus } from "./contracts.js";
import { assertLifecycleTransition } from "./lifecycle.js";

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
  assertLifecycleTransition(transitions, from, to, (previous, next) => `Invalid turn transition: ${previous} → ${next}.`);
}
export function allowedTransitions(from: TurnStatus): readonly TurnStatus[] {
  return transitions[from];
}
