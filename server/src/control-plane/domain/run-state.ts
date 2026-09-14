import type { RunStatus } from "./types.js";

const transitions: Record<RunStatus, readonly RunStatus[]> = {
  created: ["queued", "failed"],
  queued: ["running", "cancelled", "failed", "reconciliation_required"],
  running: ["completed", "failed", "cancelled", "reconciliation_required"],
  completed: [],
  failed: [],
  cancelled: [],
  reconciliation_required: [],
};

export class InvalidRunTransitionError extends Error {
  constructor(readonly from: RunStatus, readonly to: RunStatus) {
    super(`Invalid run transition: ${from} → ${to}`);
    this.name = "InvalidRunTransitionError";
  }
}

export function transitionRun(from: RunStatus, to: RunStatus): RunStatus {
  if (!transitions[from].includes(to)) {
    throw new InvalidRunTransitionError(from, to);
  }

  return to;
}
