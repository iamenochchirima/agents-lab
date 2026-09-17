import type { StudioComparisonStatus } from "./types.js";

const transitions: Record<StudioComparisonStatus, readonly StudioComparisonStatus[]> = {
  created: ["running", "cancelled", "failed"],
  running: ["completed", "failed", "cancelled", "recovery_required"],
  completed: [],
  failed: [],
  cancelled: [],
  recovery_required: [],
};

export class InvalidStudioTransitionError extends Error {
  constructor(readonly from: StudioComparisonStatus, readonly to: StudioComparisonStatus) {
    super(`Invalid Studio comparison transition: ${from} → ${to}`);
    this.name = "InvalidStudioTransitionError";
  }
}

export function transitionStudioComparison(from: StudioComparisonStatus, to: StudioComparisonStatus): StudioComparisonStatus {
  if (!transitions[from].includes(to)) throw new InvalidStudioTransitionError(from, to);
  return to;
}
