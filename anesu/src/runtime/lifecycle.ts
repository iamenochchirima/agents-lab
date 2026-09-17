import { AnesuError } from "./errors.js";

export type LifecycleTransitions<TStatus extends string> = Readonly<Record<TStatus, readonly TStatus[]>>;

/**
 * Validate one state transition at the shared persistence boundary.
 *
 * Repeating the current state is idempotent because durable acknowledgement can be
 * lost after a successful replacement. Component-specific validators remain
 * responsible for immutable identity, outcome fields, and any recovery-only rules.
 */
export function assertLifecycleTransition<TStatus extends string>(
  transitions: LifecycleTransitions<TStatus>,
  from: TStatus,
  to: TStatus,
  errorMessage: (from: TStatus, to: TStatus) => string,
): void {
  if (from === to) return;
  if (!transitions[from]?.includes(to)) {
    throw new AnesuError("persistence", errorMessage(from, to));
  }
}
