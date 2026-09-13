import { capabilityCatalog, capabilityGroups } from "./capabilityCatalog";
import type {
  CoverageCatalog,
  CoverageLink,
  EnvironmentCoverage,
  HarnessVariantCoverage,
  InfrastructureCoverage,
  PlatformCoverage,
  StrategyCoverage,
  WorkloadCoverage,
} from "./coverageTypes";

const environmentNames = [
  ["api-native", "API-native"],
  ["browser", "Browser"],
  ["filesystem-native", "Filesystem-native"],
  ["remote-computer", "Remote computer"],
  ["sandboxed-container", "Sandboxed container"],
] as const;

const scenarioNames = [
  ["research", "Research"],
  ["coding", "Coding"],
  ["transactional", "Transactional"],
  ["customer-support", "Customer support"],
  ["long-running", "Long-running"],
  ["human-approval", "Human approval"],
  ["event-driven", "Event-driven"],
  ["multi-agent", "Multi-agent"],
  ["filesystem", "Computer / filesystem"],
  ["context-stress", "Context stress"],
] as const;

const experimentNames = [
  ["worker-crash", "Worker crash"],
  ["tool-timeout", "Tool timeout"],
  ["side-effect-ack-loss", "Side-effect acknowledgement loss"],
  ["duplicate-event", "Duplicate event"],
  ["http-500", "HTTP 500"],
  ["http-429", "HTTP 429"],
] as const;

const strategyNames = [
  ["model", "Model configuration"],
  ["context", "Context strategy"],
  ["memory", "Memory strategy"],
  ["tools", "Tool strategy"],
  ["durability", "Durability strategy"],
  ["observability", "Observability strategy"],
] as const;

function documentLink(documentId: string, label: string): CoverageLink {
  return { documentId, label };
}

function unassessedEnvironments(): readonly EnvironmentCoverage[] {
  return environmentNames.map(([id, name]) => ({
    id,
    name,
    notes: "No environment adapter has been selected for this harness variant.",
    status: "not-assessed",
  }));
}

function unassessedWorkloads(
  definitions: ReadonlyArray<readonly [string, string]>,
): readonly WorkloadCoverage[] {
  return definitions.map(([id, name]) => ({ id, name, status: "not-assessed" }));
}

function unassessedStrategies(): readonly StrategyCoverage[] {
  return strategyNames.map(([id, name]) => ({
    id,
    name,
    notes: "The strategy will be selected and documented with the first runnable slice.",
    status: "not-assessed",
  }));
}

function commonInfrastructure(): readonly InfrastructureCoverage[] {
  return [
    {
      id: "compose",
      name: "Local service orchestration",
      notes: "Optional until the variant requires supporting local services.",
      requirement: "optional",
      status: "not-assessed",
    },
    {
      id: "observability",
      name: "Shared observability stack",
      notes: "Optional until the common telemetry path is implemented.",
      requirement: "optional",
      status: "not-assessed",
    },
  ];
}

interface BaselineOptions {
  agentName: string;
  agentNotes: string;
  agentTopology: string;
  infrastructure?: readonly InfrastructureCoverage[];
  platformId: string;
  platformName: string;
}

function baselineVariant(options: BaselineOptions): HarnessVariantCoverage {
  const variantDocumentId = `platforms/${options.platformId}/variants/baseline/README.md`;

  return {
    id: "baseline",
    name: `${options.platformName} baseline`,
    description: "The first comparable harness variant for this platform. It is currently a documented skeleton.",
    stage: "skeleton",
    nextDecision: "Choose the first vertical slice and write its explicit harness configuration.",
    agentDefinitions: [
      {
        id: "baseline-agent",
        name: options.agentName,
        notes: options.agentNotes,
        status: "planned",
        topology: options.agentTopology,
      },
    ],
    environments: unassessedEnvironments(),
    infrastructure: [...(options.infrastructure ?? []), ...commonInfrastructure()],
    strategies: unassessedStrategies(),
    scenarios: unassessedWorkloads(scenarioNames),
    experiments: unassessedWorkloads(experimentNames),
    verifiedCombinations: [],
    capabilityAssessments: {},
    evidence: [documentLink(variantDocumentId, "Baseline variant notes")],
  };
}

function platform(
  id: string,
  name: string,
  role: string,
  language: string,
  runtime: string,
  description: string,
  baseline: Omit<BaselineOptions, "platformId" | "platformName">,
): PlatformCoverage {
  return {
    id,
    name,
    role,
    language,
    runtime,
    description,
    evidence: [documentLink(`platforms/${id}/README.md`, `${name} platform notes`)],
    variants: [baselineVariant({ ...baseline, platformId: id, platformName: name })],
  };
}

const platforms: readonly PlatformCoverage[] = [
  platform(
    "standalone",
    "Standalone",
    "Independent control implementation",
    "TypeScript",
    "Node.js",
    "Owns the execution loop directly and provides a baseline for understanding framework value.",
    {
      agentName: "Standalone single-agent loop",
      agentNotes: "A direct model/tool loop with no external agent framework.",
      agentTopology: "single agent",
    },
  ),
  platform(
    "openai-agents",
    "OpenAI Agents SDK",
    "Lightweight agent SDK",
    "TypeScript",
    "Node.js",
    "Examines code-first agent primitives without adopting a separate workflow runtime.",
    {
      agentName: "OpenAI SDK baseline agent",
      agentNotes: "A single SDK agent using the shared lab contracts at its boundaries.",
      agentTopology: "single agent",
    },
  ),
  platform(
    "langgraph",
    "LangGraph",
    "Graph and state-machine orchestration",
    "Python",
    "Python process",
    "Examines explicit nodes, transitions, state, and graph-level control.",
    {
      agentName: "LangGraph baseline graph",
      agentNotes: "A single-agent graph whose state and transitions remain inspectable.",
      agentTopology: "single graph agent",
    },
  ),
  platform(
    "temporal",
    "Temporal",
    "Durable workflow execution",
    "TypeScript",
    "Node.js worker + Temporal",
    "Treats agent execution as a durable workflow with histories, retries, timers, and signals.",
    {
      agentName: "Temporal workflow-hosted agent",
      agentNotes: "An agent loop divided across deterministic workflow code and side-effecting activities.",
      agentTopology: "single agent in one workflow",
      infrastructure: [
        {
          id: "temporal",
          name: "Temporal development server",
          notes: "Required for workflow execution, event history, timers, and recovery.",
          requirement: "required",
          status: "planned",
        },
      ],
    },
  ),
  platform(
    "restate",
    "Restate",
    "Durable application runtime",
    "TypeScript",
    "Node.js service + Restate",
    "Examines durable state and communication through a service-oriented runtime model.",
    {
      agentName: "Restate durable service agent",
      agentNotes: "An agent exposed through durable service handlers with explicit state ownership.",
      agentTopology: "single durable service agent",
      infrastructure: [
        {
          id: "restate",
          name: "Restate runtime",
          notes: "Required for durable invocation, state, and communication.",
          requirement: "required",
          status: "planned",
        },
      ],
    },
  ),
  platform(
    "mastra",
    "Mastra",
    "TypeScript agent platform",
    "TypeScript",
    "Node.js",
    "Provides a TypeScript-native implementation for studying higher-level agent primitives.",
    {
      agentName: "Mastra baseline agent",
      agentNotes: "A single Mastra agent with platform-native details preserved in telemetry.",
      agentTopology: "single agent",
    },
  ),
  platform(
    "vercel-ai-sdk",
    "Vercel AI SDK",
    "TypeScript model and tool primitives",
    "TypeScript",
    "Node.js",
    "Examines a TypeScript-native tool loop and its relationship to optional hosted services.",
    {
      agentName: "Vercel AI SDK tool-loop agent",
      agentNotes: "A code-first tool loop built from Vercel AI SDK primitives.",
      agentTopology: "single agent",
      infrastructure: [
        {
          id: "vercel",
          name: "Vercel services",
          notes: "Optional hosted infrastructure; the baseline must document whether it is used.",
          requirement: "optional",
          status: "not-assessed",
        },
      ],
    },
  ),
];

export const coverageCatalog: CoverageCatalog = {
  capabilityGroups,
  capabilities: capabilityCatalog,
  platforms,
  compositions: [
    {
      id: "langgraph-temporal",
      name: "LangGraph + Temporal",
      layers: ["LangGraph orchestration", "Temporal durable execution"],
      notes: "Planned composition for separating graph reasoning from workflow durability.",
      status: "planned",
      evidence: [documentLink("platforms/compositions/langgraph-temporal/README.md", "Composition notes")],
    },
    {
      id: "openai-agents-restate",
      name: "OpenAI Agents SDK + Restate",
      layers: ["OpenAI Agents SDK orchestration", "Restate durable runtime"],
      notes: "Planned composition for combining lightweight agent primitives with durable services.",
      status: "planned",
      evidence: [documentLink("platforms/compositions/openai-agents-restate/README.md", "Composition notes")],
    },
  ],
  currentFocus: {
    projectPhase: "Architecture, documentation, and UI foundation",
    activePlatform: "None selected",
    activeHarnessVariant: "None selected",
    activeScenario: "None selected",
    activeExperiment: "None selected",
    currentWork: "Build the interactive harness coverage document",
    nextCheckpoint: "Review this coverage model, then select the first vertical slice",
    lastReviewed: "2026-09-12",
  },
};
