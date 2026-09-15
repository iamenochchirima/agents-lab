# Mastra baseline playground

This is a small inspection path for learning one real Mastra execution. It is not a
test suite, scenario, experiment, or published result.

## What to inspect

1. Read [`server/src/platforms/mastra/variants/baseline/agent.ts`](../../../server/src/platforms/mastra/variants/baseline/agent.ts).
2. Follow [`server/src/platforms/mastra/runner-adapter/mastra-runner.ts`](../../../server/src/platforms/mastra/runner-adapter/mastra-runner.ts)
   from `start()` into `execute()`.
3. Run the focused checks in the [local development guide](../../../server/src/platforms/mastra/docs/local-development.md).
4. Compare the event intents and terminal result in
   [`server/integration-tests/mastra-baseline.test.ts`](../../../server/integration-tests/mastra-baseline.test.ts).

The key lesson is the boundary: Mastra owns the agent call; the Lab owns run identity,
normalized evidence, and the explicit process-loss limitation.
