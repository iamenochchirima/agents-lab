import type { ContextBudgetPolicy, ContextMessage } from "../../capabilities/context/contracts.js";
import type { StudioComparisonManifest, StudioScenarioCase } from "../domain/types.js";

export interface StudioTrialEnvironment {
  readonly task: string;
  readonly messages: readonly ContextMessage[];
  readonly contextWindowTokens: number;
  readonly budgetPolicy: ContextBudgetPolicy;
}

export interface StudioEnvironmentAssembler {
  assemble(manifest: StudioComparisonManifest, scenario: StudioScenarioCase): StudioTrialEnvironment;
}

/**
 * Builds the fixed envelope shared by every trial in the first replay profile.
 * Strategies can select from these messages, but cannot change the fixture or
 * budget controls that make the comparison meaningful.
 */
export class ReplayEnvironmentAssembler implements StudioEnvironmentAssembler {
  assemble(manifest: StudioComparisonManifest, scenario: StudioScenarioCase): StudioTrialEnvironment {
    return {
      task: scenario.task,
      messages: [
        {
          schemaVersion: 1,
          messageId: `studio-system-${manifest.comparisonId}`,
          sessionId: `studio-${scenario.id}`,
          sequence: 0,
          role: "system",
          content: "You are a deterministic Studio context inspection agent.",
          source: "system",
          createdAt: manifest.createdAt,
        },
        ...scenario.messages,
      ],
      contextWindowTokens: manifest.environment.contextWindowTokens,
      budgetPolicy: {
        reservedOutputTokens: manifest.environment.reservedOutputTokens,
        safetyMarginTokens: manifest.environment.safetyMarginTokens,
        compactionThresholdPercent: 20,
      },
    };
  }
}
