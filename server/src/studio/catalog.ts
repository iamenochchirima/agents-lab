import type { ContextMessage } from "../capabilities/context/contracts.js";
import {
  FullHistoryStrategy,
  RelevanceRankedStrategy,
  SlidingWindowStrategy,
  ContextStrategyRegistry,
} from "./strategies/index.js";
import type {
  StudioCatalogProjection,
  StudioComponentDescriptor,
  StudioEnvironmentProfile,
  StudioExperimentDefinition,
  StudioScenarioCase,
  StudioSystemDefinition,
} from "./domain/types.js";

export class StudioCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioCatalogError";
  }
}

export const studioSystem: StudioSystemDefinition = {
  id: "neutral-agent",
  version: "1",
  name: "Neutral agent runtime",
  baselineComponents: {
    "input-perception": "baseline",
    "context-management": "selected-by-experiment",
    "planning-reasoning": "baseline",
    memory: "baseline",
    "tool-use": "baseline",
    "control-orchestration": "baseline",
    "execution-environment": "contained-local",
    "output-actions": "baseline",
    "safety-guardrails": "baseline",
    "model-interface": "replay",
    observability: "studio-events-v1",
  },
};

export const replayEnvironment: StudioEnvironmentProfile = {
  id: "deterministic-replay",
  version: "1",
  name: "Deterministic replay environment",
  model: { provider: "replay", model: "context-replay-v1" },
  contextWindowTokens: 1_200,
  reservedOutputTokens: 240,
  safetyMarginTokens: 60,
  maxStrategies: 3,
};

const sessionId = "studio-context-old-fact";

export const contextScenario: StudioScenarioCase = {
  id: "context-old-important-fact",
  version: "1",
  name: "Old important fact",
  task: "What language should the support agent use for my account?",
  requiredMessageId: "context-fact-language",
  expectedAnswer: "The support agent should use English for this account.",
  messages: messages([
    ["user", "My account reference is AC-4821 and my preferred support language is English.", "context-fact-language"],
    ["assistant", "I have noted the account reference and preferred support language."],
    ["user", "I need help understanding a recent invoice."],
    ["assistant", "I can help inspect the invoice and explain its line items."],
    ["user", "The invoice contains a service fee I do not recognize."],
    ["assistant", "We can treat that as the main issue for this conversation."],
    ["user", "The fee appeared after I changed my plan."],
    ["assistant", "That timing may be relevant when checking the account history."],
    ["user", "I also want to know whether the plan change can be reversed."],
    ["assistant", "The reversal policy can be checked after the fee is understood."],
    ["user", "Please answer the question using the conversation context."],
  ]),
};

export const contextExperiment: StudioExperimentDefinition = {
  id: "compare-context-retention",
  version: "1",
  name: "Compare context retention strategies",
  hypothesis: "Retaining older relevant context may preserve the answer that a recent-only window omits.",
  changedComponent: "context-management",
  scenario: { id: contextScenario.id, version: contextScenario.version },
  strategies: [
    { id: "full-history", version: "1", parameters: {} },
    { id: "sliding-window", version: "1", parameters: { recentMessages: "4" } },
  ],
};

const contextStrategyDescriptors = [
  {
    id: "full-history",
    version: "1",
    name: "Full history",
    summary: "Retain every available message in source order.",
    parameters: [],
  },
  {
    id: "sliding-window",
    version: "1",
    name: "Sliding window",
    summary: "Retain system messages and the newest configured non-system messages.",
    parameters: [{ id: "recentMessages", description: "Number of newest non-system messages to retain.", defaultValue: "4", options: ["1", "2", "4", "8"] }],
  },
  {
    id: "relevance-ranked",
    version: "1",
    name: "Relevance ranked",
    summary: "Retain non-system messages with the most lexical overlap with the task, then restore source order.",
    parameters: [{ id: "maxMessages", description: "Maximum number of highest-scoring non-system messages to retain.", defaultValue: "4", options: ["1", "2", "4", "8"] }],
  },
] as const;

const componentDescriptors: readonly StudioComponentDescriptor[] = [
  plannedComponent("input-perception", 1, "Input / perception", "Normalize what enters the agent before planning."),
  {
    id: "context-management",
    ordinal: 2,
    name: "Context management",
    summary: "Choose and budget what reaches the model this turn.",
    status: "available",
    strategies: contextStrategyDescriptors,
    experiments: [{
      id: contextExperiment.id,
      version: contextExperiment.version,
      name: contextExperiment.name,
      hypothesis: contextExperiment.hypothesis,
      scenario: {
        id: contextScenario.id,
        version: contextScenario.version,
        name: contextScenario.name,
        task: contextScenario.task,
        intendedObservation: "Compare whether an older account preference remains in the model-bound context.",
        controls: ["scenario fixture", "replay model", "seed", "context window", "reserved output budget", "safety margin"],
      },
      strategies: contextStrategyDescriptors,
    }],
  },
  plannedComponent("planning-reasoning", 3, "Planning / reasoning", "Compare ways to decompose and review work before acting."),
  plannedComponent("memory", 4, "Memory", "Control what is retained, retrieved, consolidated, or forgotten."),
  plannedComponent("tool-use", 5, "Tool use", "Select, validate, execute, and recover from tool calls."),
  plannedComponent("control-orchestration", 6, "Control / orchestration", "Coordinate loops, graphs, delegation, termination, and interruption."),
  plannedComponent("execution-environment", 7, "Execution environment", "Constrain filesystem, network, process, and resource access."),
  plannedComponent("output-actions", 8, "Output / actions", "Verify, commit, and render agent actions and responses."),
  plannedComponent("safety-guardrails", 9, "Safety / guardrails", "Inspect input, output, tool results, risk, and runaway behavior."),
  plannedComponent("model-interface", 10, "Model interface", "Route, format, retry, and instrument model calls."),
  plannedComponent("observability", 11, "Observability", "Persist trajectories, events, metrics, and diagnostic artifacts."),
];

export const studioCatalog: StudioCatalogProjection = {
  schemaVersion: 1,
  system: studioSystem,
  environment: replayEnvironment,
  components: componentDescriptors,
};

export const contextStrategies = new ContextStrategyRegistry([
  new FullHistoryStrategy(),
  new SlidingWindowStrategy(),
  new RelevanceRankedStrategy(),
]);

function plannedComponent(id: Exclude<StudioComponentDescriptor["id"], "context-management">, ordinal: number, name: string, summary: string): StudioComponentDescriptor {
  return { id, ordinal, name, summary, status: "planned", strategies: [], experiments: [] };
}

export function resolveStudioCatalog(request: {
  readonly system: { readonly id: string; readonly version: string };
  readonly environment: { readonly id: string; readonly version: string };
  readonly experiment: {
    readonly id: string;
    readonly version: string;
    readonly scenario: { readonly id: string; readonly version: string };
  };
}) {
  if (request.system.id !== studioSystem.id || request.system.version !== studioSystem.version) {
    throw new StudioCatalogError(`Unknown Studio system: ${request.system.id}@${request.system.version}.`);
  }
  if (request.environment.id !== replayEnvironment.id || request.environment.version !== replayEnvironment.version) {
    throw new StudioCatalogError(`Unknown Studio environment: ${request.environment.id}@${request.environment.version}.`);
  }
  if (request.experiment.id !== contextExperiment.id || request.experiment.version !== contextExperiment.version) {
    throw new StudioCatalogError(`Unknown Studio experiment: ${request.experiment.id}@${request.experiment.version}.`);
  }
  if (request.experiment.scenario.id !== contextScenario.id || request.experiment.scenario.version !== contextScenario.version) {
    throw new StudioCatalogError(`Unknown Studio scenario: ${request.experiment.scenario.id}@${request.experiment.scenario.version}.`);
  }
  return { system: studioSystem, environment: replayEnvironment, experiment: contextExperiment, scenario: contextScenario } as const;
}

function messages(entries: readonly [ContextMessage["role"], string, string?][]): readonly ContextMessage[] {
  return entries.map(([role, content, messageId], index) => ({
    schemaVersion: 1,
    messageId: messageId ?? `context-message-${String(index + 1).padStart(2, "0")}`,
    sessionId,
    sequence: index + 1,
    role,
    content,
    source: "transcript",
    createdAt: `2026-09-16T00:00:${String(index).padStart(2, "0")}.000Z`,
  }));
}
