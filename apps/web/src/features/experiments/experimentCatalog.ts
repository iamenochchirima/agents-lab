export interface ExperimentOption {
  description: string;
  id: string;
  name: string;
}

export const experimentCatalog: readonly ExperimentOption[] = [
  { id: "none", name: "No failure injection", description: "Run the selected task under normal conditions." },
  { id: "worker-crash", name: "Worker crash", description: "Terminate the execution process at a recorded point." },
  { id: "tool-timeout", name: "Tool timeout", description: "Delay a tool until its configured deadline is exceeded." },
  { id: "http-500", name: "HTTP 500", description: "Return a controlled server error from an external service." },
];
