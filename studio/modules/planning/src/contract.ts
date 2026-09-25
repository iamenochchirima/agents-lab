import type { ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";
import type { PlanningConfig } from "./config.js";

export interface PlanningMessage {
  readonly role: "system" | "developer" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly sourceIds: readonly string[];
}

export interface PlanningObservation {
  readonly observationId: string;
  readonly kind: "tool-result" | "computer-observation" | "user-update" | "system-event";
  readonly summary: string;
  readonly sourceId: string;
}

export type ProposedStepKind = "respond" | "tool" | "computer" | "gather-information";

export interface ProposedStep {
  readonly stepId: string;
  readonly kind: ProposedStepKind;
  readonly description: string;
  readonly target?: string;
}

export interface ProposedPlan {
  readonly planId: string;
  readonly summary: string;
  readonly steps: readonly ProposedStep[];
  readonly completionCondition: string;
  readonly assumptions: readonly string[];
  readonly evidence: { readonly sourceIdsConsidered: readonly string[] };
}

export interface PlanningInput {
  readonly scope: RunScope;
  readonly task: string;
  readonly context: readonly PlanningMessage[];
  readonly observations: readonly PlanningObservation[];
  readonly previousPlan?: ProposedPlan;
}

export type PlanningErrorCode = "INVALID_PLANNING_INPUT" | "PLAN_LIMIT_EXCEEDED" | "PLANNING_FAILED";

export class PlanningError extends Error {
  constructor(readonly code: PlanningErrorCode, message: string) {
    super(message);
    this.name = "PlanningError";
  }
}

/** A plan proposes work; Control determines what runs and in what order. */
export interface Planner {
  readonly identity: ModuleIdentity;
  propose(input: PlanningInput, signal: AbortSignal): Promise<ProposedPlan>;
}

export type PlannerFactory = (config: PlanningConfig) => Planner;
