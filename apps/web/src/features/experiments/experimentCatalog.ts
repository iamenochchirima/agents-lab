export interface ExperimentOption {
  description: string;
  id: string;
  name: string;
}

export const experimentCatalog: readonly ExperimentOption[] = [
  { id: "none", name: "No failure injection", description: "Run the selected task under normal conditions." },
  { id: "agent-capabilities-live", name: "Free model capability trial", description: "Use an approved free tool model with zero-price routing, paid fallback disabled, and bounded output." },
  { id: "worker-crash", name: "Worker crash", description: "Terminate the execution process at a recorded point." },
  { id: "tool-timeout", name: "Tool timeout", description: "Delay a tool until its configured deadline is exceeded." },
  { id: "http-500", name: "HTTP 500", description: "Return a controlled server error from an external service." },
];
