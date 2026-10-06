export const CONTEXT_STRESS_SCENARIO_ID = "context-stress";
export const OLD_IMPORTANT_FACT_FIXTURE_ID = "old-important-fact";
export const OLD_IMPORTANT_FACT_FIXTURE_VERSION = "1";

export const OLD_IMPORTANT_FACT_TASK_ID = "old-important-fact:task:v1";
export const OLD_IMPORTANT_FACT_TASK = Object.freeze({
  sourceId: OLD_IMPORTANT_FACT_TASK_ID,
  content: "Using the prior conversation, identify the preference stated for future meal suggestions.",
});

export const OLD_IMPORTANT_FACT_PRIOR_MESSAGES = Object.freeze([
  Object.freeze({
    sourceId: "old-important-fact:history:0",
    role: "user",
    content: "For future meal suggestions, I prefer Mediterranean food.",
    sequence: 0,
  }),
  Object.freeze({
    sourceId: "old-important-fact:history:1",
    role: "assistant",
    content: "Understood. I’ll keep that preference in mind.",
    sequence: 1,
  }),
  Object.freeze({
    sourceId: "old-important-fact:history:2",
    role: "user",
    content: "I planted basil near the south-facing window.",
    sequence: 2,
  }),
  Object.freeze({
    sourceId: "old-important-fact:history:3",
    role: "assistant",
    content: "That sounds like a good spot for basil.",
    sequence: 3,
  }),
  Object.freeze({
    sourceId: "old-important-fact:history:4",
    role: "user",
    content: "My desk lamp has a warm amber bulb.",
    sequence: 4,
  }),
  Object.freeze({
    sourceId: "old-important-fact:history:5",
    role: "assistant",
    content: "A warm light can make the desk feel comfortable.",
    sequence: 5,
  }),
]);

export const OLD_IMPORTANT_FACT_FIXTURE = Object.freeze({
  scenarioId: CONTEXT_STRESS_SCENARIO_ID,
  fixtureId: OLD_IMPORTANT_FACT_FIXTURE_ID,
  fixtureVersion: OLD_IMPORTANT_FACT_FIXTURE_VERSION,
  task: OLD_IMPORTANT_FACT_TASK,
  priorMessages: OLD_IMPORTANT_FACT_PRIOR_MESSAGES,
});
