export type CoverageStatus =
  | "not-assessed"
  | "planned"
  | "in-progress"
  | "implemented"
  | "verified"
  | "blocked"
  | "unsupported"
  | "not-applicable";

export type CapabilityOwner =
  | "platform"
  | "lab"
  | "environment"
  | "composition"
  | "external";

export interface CoverageLink {
  documentId: string;
  label: string;
}

export interface ChecklistDefinition {
  id: string;
  label: string;
}

export interface CapabilityDefinition {
  checks: readonly ChecklistDefinition[];
  groupId: string;
  id: string;
  summary: string;
  title: string;
}

export interface CapabilityGroup {
  description: string;
  id: string;
  title: string;
}

export interface CapabilityAssessment {
  approach?: string;
  blockedBy?: string;
  completedChecks?: readonly string[];
  disposition?: "blocked" | "unsupported" | "not-applicable";
  evidence?: readonly CoverageLink[];
  nextAction?: string;
  owner?: CapabilityOwner;
}

export interface AgentDefinitionCoverage {
  id: string;
  name: string;
  notes: string;
  status: CoverageStatus;
  topology: string;
}

export interface EnvironmentCoverage {
  id: string;
  name: string;
  notes: string;
  status: CoverageStatus;
}

export interface InfrastructureCoverage {
  id: string;
  name: string;
  notes: string;
  requirement: "required" | "optional";
  status: CoverageStatus;
}

export interface StrategyCoverage {
  id: string;
  name: string;
  notes: string;
  owner?: CapabilityOwner;
  status: CoverageStatus;
}

export interface WorkloadCoverage {
  id: string;
  name: string;
  status: CoverageStatus;
}

export interface VerifiedCombination {
  evidence: readonly CoverageLink[];
  experimentId: string;
  scenarioId: string;
  status: CoverageStatus;
}

export interface HarnessVariantCoverage {
  agentDefinitions: readonly AgentDefinitionCoverage[];
  capabilityAssessments: Readonly<Record<string, CapabilityAssessment>>;
  description: string;
  environments: readonly EnvironmentCoverage[];
  evidence: readonly CoverageLink[];
  experiments: readonly WorkloadCoverage[];
  id: string;
  infrastructure: readonly InfrastructureCoverage[];
  name: string;
  nextDecision: string;
  scenarios: readonly WorkloadCoverage[];
  stage: "skeleton" | "designing" | "implementing" | "operational";
  strategies: readonly StrategyCoverage[];
  verifiedCombinations: readonly VerifiedCombination[];
}

export interface PlatformCoverage {
  description: string;
  evidence: readonly CoverageLink[];
  id: string;
  language: string;
  name: string;
  role: string;
  runtime: string;
  variants: readonly HarnessVariantCoverage[];
}

export interface CompositionCoverage {
  evidence: readonly CoverageLink[];
  id: string;
  layers: readonly string[];
  name: string;
  notes: string;
  status: CoverageStatus;
}

export interface CoverageCatalog {
  capabilityGroups: readonly CapabilityGroup[];
  capabilities: readonly CapabilityDefinition[];
  currentFocus: {
    activeExperiment: string;
    activeHarnessVariant: string;
    activePlatform: string;
    activeScenario: string;
    currentWork: string;
    lastReviewed: string;
    nextCheckpoint: string;
    projectPhase: string;
  };
  compositions: readonly CompositionCoverage[];
  platforms: readonly PlatformCoverage[];
}
