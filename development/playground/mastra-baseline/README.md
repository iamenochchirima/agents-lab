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

To inspect the native MCP tool, select `local-mcp-safe` in the run setup and send:

```text
Read alpha through MCP.
```

Expand **MCP connection** and **Native execution**. The run should show the Lab
capability `mcp_fixture_lookup`, the remote tool `fixture.lookup`, and a bounded
provider request ID. This is a local protocol fixture, not a connected remote account;
an interrupted call remains `outcome_unknown` rather than being retried blindly.
