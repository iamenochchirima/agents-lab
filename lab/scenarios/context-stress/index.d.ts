export type ContextStressRole = "user" | "assistant";

export interface ContextStressTask {
  readonly sourceId: string;
  readonly content: string;
}

export interface ContextStressPriorMessage {
  readonly sourceId: string;
  readonly role: ContextStressRole;
  readonly content: string;
  readonly sequence: number;
}

export interface ContextStressFixture {
  readonly scenarioId: string;
  readonly fixtureId: string;
  readonly fixtureVersion: string;
  readonly task: ContextStressTask;
  readonly priorMessages: readonly ContextStressPriorMessage[];
}

export declare const CONTEXT_STRESS_SCENARIO_ID: "context-stress";
export declare const OLD_IMPORTANT_FACT_FIXTURE_ID: "old-important-fact";
export declare const OLD_IMPORTANT_FACT_FIXTURE_VERSION: "1";
export declare const OLD_IMPORTANT_FACT_TASK_ID: "old-important-fact:task:v1";
export declare const OLD_IMPORTANT_FACT_TASK: ContextStressTask;
export declare const OLD_IMPORTANT_FACT_PRIOR_MESSAGES: readonly ContextStressPriorMessage[];
export declare const OLD_IMPORTANT_FACT_FIXTURE: ContextStressFixture;
