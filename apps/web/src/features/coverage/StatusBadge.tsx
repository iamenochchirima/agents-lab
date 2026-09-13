import { coverageStatusLabels } from "./coverageModel";
import type { CoverageStatus } from "./coverageTypes";

interface StatusBadgeProps {
  status: CoverageStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return <span className={`coverage-status coverage-status-${status}`}>{coverageStatusLabels[status]}</span>;
}
