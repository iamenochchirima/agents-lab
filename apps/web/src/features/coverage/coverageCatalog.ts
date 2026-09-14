import { capabilityCatalog, capabilityGroups } from "./capabilityCatalog";
import { platformCatalog } from "../platforms/platformCatalog";
import { environmentCatalog } from "../environments/environmentCatalog";
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

function unassessedEnvironments(environmentIds: readonly string[]): readonly EnvironmentCoverage[] {
  return environmentCatalog.filter((environment) => environmentIds.includes(environment.id)).map((environment) => ({
    id: environment.id,
    name: environment.name,
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
  environmentIds: readonly string[];
  infrastructure?: readonly InfrastructureCoverage[];
  platformId: string;
  platformName: string;
  variantDocumentId?: string;
}

function baselineVariant(options: BaselineOptions): HarnessVariantCoverage {
  const variantDocumentId = options.variantDocumentId ?? `platforms/${options.platformId}/variants/baseline/README.md`;

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
    environments: unassessedEnvironments(options.environmentIds),
    infrastructure: [...(options.infrastructure ?? []), ...commonInfrastructure()],
    strategies: unassessedStrategies(),
    scenarios: unassessedWorkloads(scenarioNames),
    experiments: unassessedWorkloads(experimentNames),
    verifiedCombinations: [],
    capabilityAssessments: {},
    evidence: [documentLink(variantDocumentId, "Baseline variant notes")],
  };
}

const platforms: readonly PlatformCoverage[] = platformCatalog.map((descriptor) => ({
  id: descriptor.id,
  name: descriptor.name,
  role: descriptor.role,
  language: descriptor.language,
  runtime: descriptor.runtime,
  description: descriptor.description,
  evidence: [documentLink(descriptor.implementationDocumentId, `${descriptor.name} platform notes`)],
  variants: [baselineVariant({
    agentName: `${descriptor.name} baseline agent`,
    agentNotes: descriptor.description,
    agentTopology: "single agent",
    infrastructure: descriptor.infrastructure.map((item) => ({
      id: item.id,
      name: item.name,
      notes: item.description,
      requirement: item.requirement,
      status: item.status === "ready" ? "implemented" : item.status === "in-progress" ? "in-progress" : "planned",
    })),
    platformId: descriptor.id,
    platformName: descriptor.name,
    environmentIds: descriptor.computerEnvironmentIds,
    variantDocumentId: descriptor.kind === "computer-native" ? descriptor.implementationDocumentId : undefined,
  })],
}));

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
