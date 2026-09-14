import type { Availability } from "./platformTypes";

const labels: Record<Availability, string> = {
  planned: "Planned",
  "in-progress": "In progress",
  ready: "Ready",
};

export function AvailabilityBadge({ status }: { status: Availability }) {
  return <span className={`availability-badge availability-${status}`}>{labels[status]}</span>;
}
