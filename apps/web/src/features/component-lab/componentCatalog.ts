import type {
  ComponentAreaDescriptor,
  ComponentCaseDescriptor,
  ComponentStrategyDescriptor,
  ContextEnvelopeField,
  ContextEvidenceItem,
} from "./componentTypes";

const proposalDocument = {
  documentId: "docs/planning/component-lab.md",
  label: "Component Lab proposal",
} as const;

export const componentAreas: readonly ComponentAreaDescriptor[] = [
  {
    id: "input-perception",
    name: "Input and perception",
    summary: "Normalize raw input and identify the task before planning begins.",
    status: "planned",
    nextAction: "Define canonical input blocks for text, files, images, and API payloads.",
    document: proposalDocument,
  },
  {
    id: "context-management",
    name: "Context management",
    summary: "Decide which instructions, history, memory, and tool results reach the model.",
    status: "designing",
    nextAction: "Connect the preview envelope to one executable context strategy.",
    document: proposalDocument,
  },
  {
    id: "planning-reasoning",
    name: "Planning and reasoning",
    summary: "Break a goal into work and inspect how the agent reasons between actions.",
    status: "planned",
    nextAction: "Choose a first planning case that keeps control flow separate.",
    document: proposalDocument,
  },
  {
    id: "memory",
    name: "Memory",
    summary: "Study working, episodic, semantic, and procedural memory as separate concerns.",
    status: "planned",
    nextAction: "Define a memory case with inspectable writes, reads, and provenance.",
    document: proposalDocument,
  },
  {
    id: "tool-use",
    name: "Tool use",
    summary: "Select, validate, dispatch, normalize, and recover from tool calls.",
    status: "planned",
    nextAction: "Start with a read-only tool case before introducing side effects.",
    document: proposalDocument,
  },
  {
    id: "control-orchestration",
    name: "Control and orchestration",
    summary: "Compare loops, graphs, state machines, delegation, and termination rules.",
    status: "planned",
    nextAction: "Hold planning constant while defining the first loop comparison.",
    document: proposalDocument,
  },
  {
    id: "execution-environment",
    name: "Execution environment",
    summary: "Make isolation, permissions, resource limits, and lifecycle visible.",
    status: "planned",
    nextAction: "Describe one environment fixture with explicit capability limits.",
    document: proposalDocument,
  },
  {
    id: "output-actions",
    name: "Output and actions",
    summary: "Separate response rendering from proposed, verified, and committed actions.",
    status: "planned",
    nextAction: "Define a case that distinguishes proposal from irreversible execution.",
    document: proposalDocument,
  },
  {
    id: "safety-guardrails",
    name: "Safety and guardrails",
    summary: "Inspect filtering, anomaly detection, scope checks, and confirmation gates.",
    status: "planned",
    nextAction: "Add a deterministic adversarial-input case and its observable decision.",
    document: proposalDocument,
  },
  {
    id: "model-interface",
    name: "Model interface",
    summary: "Compare routing, prompt formatting, retry policy, and cost instrumentation.",
    status: "planned",
    nextAction: "Keep the model fixed while defining the first interface variable.",
    document: proposalDocument,
  },
  {
    id: "observability",
    name: "Observability",
    summary: "Capture traces, metrics, artifacts, and diagnostics without secrets or hidden reasoning.",
    status: "planned",
    nextAction: "Define the minimum evidence record for one focused component run.",
    document: proposalDocument,
  },
] as const;

export const contextStrategies: readonly ComponentStrategyDescriptor[] = [
  {
    id: "full-history",
    name: "Full history",
    summary: "Pass the available conversation history into the request until the budget is reached.",
    status: "planned",
    parameters: [{
      id: "overflow",
      label: "Overflow handling",
      description: "What the future adapter should do when the full history no longer fits.",
      options: ["Stop with an explicit error", "Compact before sending", "Drop oldest turns"],
      defaultValue: "Stop with an explicit error",
    }],
    inputs: ["System instructions", "Ordered conversation history", "Tool-result fixture"],
    outputs: ["Retained source IDs", "Budget estimate", "Overflow decision"],
    limitations: ["Context grows with the transcript.", "It does not rank older material by relevance."],
  },
  {
    id: "sliding-window",
    name: "Sliding window",
    summary: "Keep the newest turns inside a configured window while preserving required instructions.",
    status: "planned",
    parameters: [{
      id: "window",
      label: "Recent turns",
      description: "The number of recent conversational turns the future adapter should retain.",
      options: ["4 turns", "8 turns", "12 turns"],
      defaultValue: "8 turns",
    }],
    inputs: ["System instructions", "Ordered conversation history", "Window size"],
    outputs: ["Retained source IDs", "Omitted source IDs", "Budget estimate"],
    limitations: ["An old relevant fact may be omitted.", "Recency is not the same as importance."],
  },
  {
    id: "relevance-ranked",
    name: "Relevance-ranked retention",
    summary: "Rank candidate context by task relevance and retain the highest-scoring material first.",
    status: "planned",
    parameters: [{
      id: "ranking",
      label: "Ranking signal",
      description: "The signal that the future implementation will use to order candidate sources.",
      options: ["Lexical match", "Recency plus lexical match", "Explicit source priority"],
      defaultValue: "Recency plus lexical match",
    }],
    inputs: ["Current task", "Candidate context sources", "Source priority"],
    outputs: ["Ranked source IDs", "Dropped source IDs", "Ranking details", "Budget estimate"],
    limitations: ["A ranking score is not a correctness guarantee.", "The ranking policy can hide unexpected omissions."],
  },
  {
    id: "hierarchical-summary",
    name: "Hierarchical summary",
    summary: "Replace older groups of turns with summaries at more than one level of detail.",
    status: "planned",
    parameters: [{
      id: "levels",
      label: "Summary levels",
      description: "How many summary layers the future implementation may keep available.",
      options: ["One level", "Two levels", "Three levels"],
      defaultValue: "Two levels",
    }],
    inputs: ["Conversation groups", "Summary policy", "Current task"],
    outputs: ["Summary source IDs", "Retained recent turns", "Compaction record", "Budget estimate"],
    limitations: ["Summaries can lose wording and provenance.", "Summary quality must be graded separately from context fit."],
  },
  {
    id: "token-budget-allocation",
    name: "Token-budget allocation",
    summary: "Split a bounded context budget across source groups before selecting their contents.",
    status: "planned",
    parameters: [{
      id: "allocation",
      label: "Allocation profile",
      description: "The future policy for dividing the available budget among context sources.",
      options: ["History-heavy", "Balanced", "Task-heavy"],
      defaultValue: "Balanced",
    }],
    inputs: ["Total token budget", "Source groups", "Reserved output budget"],
    outputs: ["Per-source budgets", "Selected source IDs", "Unfilled or exceeded budget", "Allocation details"],
    limitations: ["A fair allocation can still select the wrong content.", "Budget estimates may be conservative."],
  },
] as const;

export const contextCases: readonly ComponentCaseDescriptor[] = [
  {
    id: "long-conversation",
    name: "Long conversation",
    task: "Answer the current question while retaining the turns that explain the user's ongoing goal.",
    fixtureSummary: "A multi-turn conversation contains recent filler, an early task constraint, and a final question.",
    intendedObservation: "Which source turns survive as the context budget tightens?",
    controls: ["Same conversation fixture", "Same current question", "Same token limit"],
  },
  {
    id: "old-important-fact",
    name: "Old important fact",
    task: "Use a preference stated early in the conversation when answering a later request.",
    fixtureSummary: "An important preference appears early, followed by several unrelated turns.",
    intendedObservation: "Whether the strategy keeps or reconstructs an old but relevant fact.",
    controls: ["Same preference", "Same distractor turns", "Same grading question"],
  },
  {
    id: "conflicting-instructions",
    name: "Conflicting instructions",
    task: "Follow the higher-priority instruction when a later source conflicts with it.",
    fixtureSummary: "System, user, and tool-result sources contain deliberately conflicting directions.",
    intendedObservation: "Whether selection preserves source priority and makes omissions inspectable.",
    controls: ["Same source priorities", "Same conflict text", "Same model settings"],
  },
  {
    id: "large-tool-output",
    name: "Large tool output",
    task: "Answer using the relevant part of a large tool result without exceeding the request budget.",
    fixtureSummary: "A tool returns a large structured result with a small relevant region and noisy fields.",
    intendedObservation: "How each strategy treats large tool output and whether it preserves provenance.",
    controls: ["Same tool result", "Same relevant record", "Same output reservation"],
  },
  {
    id: "strict-token-budget",
    name: "Strict token budget",
    task: "Produce a useful answer when the input budget leaves little room for output.",
    fixtureSummary: "The context window is intentionally small and the output reservation is explicit.",
    intendedObservation: "Where each strategy spends the budget and how it reports pressure or failure.",
    controls: ["Same small window", "Same output reservation", "Same task grader"],
  },
] as const;

export const contextEnvelopeFields: readonly ContextEnvelopeField[] = [
  {
    label: "Case fixture",
    value: "Selected case",
    detail: "The source conversation or tool result stays the same across slots.",
  },
  {
    label: "Task",
    value: "Selected case task",
    detail: "Every strategy receives the same question and grading target.",
  },
  {
    label: "Model and settings",
    value: "Connected later",
    detail: "The model is a future fixed control, not a value produced by this preview.",
  },
  {
    label: "Budget",
    value: "Explicit assumption",
    detail: "Window size and reserved output belong to the shared envelope.",
  },
  {
    label: "Changed variable",
    value: "Context strategy",
    detail: "Only the strategy and its named parameters vary between comparison slots.",
  },
] as const;

export const contextEvidenceItems: readonly ContextEvidenceItem[] = [
  {
    label: "Source decisions",
    description: "Which source IDs were retained, omitted, or represented by a summary.",
  },
  {
    label: "Budget record",
    description: "Estimated input, reserved output, remaining budget, and count quality.",
  },
  {
    label: "Strategy detail",
    description: "The ranking, window, summary, or allocation decision made by the implementation.",
  },
  {
    label: "Task result",
    description: "The eventual model result, graded separately from context-selection behaviour.",
  },
] as const;
