# Restate baseline playground

This is a hands-on learning path for the first Restate platform slice. It is not a
production test suite and it is not a scenario or experiment record. The durable
behaviour is tested by `server/integration-tests/restate-baseline.test.ts`; this
playground exists to make the boundary easy to inspect while learning it.

## Walkthrough

1. Start the local Restate server using
   [`local-development.md`](../../../server/src/platforms/restate/docs/local-development.md).
2. Start the separately running TypeScript service.
3. Register `AgentLabRestateBaseline` and confirm it appears in the deployment list.
4. Submit a prompt with the `fake-success` model.
5. Inspect the workflow key, invocation ID, status, workflow output, and state in the
   Restate UI/Admin API.
6. Stop and restart the service while a delayed run is executing. Observe that the
   Restate journal, not service process memory, resumes the workflow.
7. Compare the native identifiers with the normalized evidence written by the common
   server after the primary integration handoff.

## Native MCP service replacement

With the local Restate service and the no-Docker HTTP fixture running, run the focused
restart exercise:

```bash
AGENTLAB_RUN_RESTATE_NATIVE_RESTART_INTEGRATION=1 \
  pnpm --filter @agent-harness-lab/lab-server run test:restate
```

The exercise selects `local-mcp-safe`, waits for the native `fixture.lookup` MCP call,
replaces the Restate service, and registers it again. Restate replays the durable
journal and the fixture call count remains one; the Lab evidence retains the same
workflow and invocation identity. This demonstrates journal replay for a completed
MCP action. It does not claim that an interrupted provider acknowledgement is
exactly-once: an in-flight dispatch remains `unknown` unless the provider proves its
outcome.

## Questions to answer while reading

- Which identity prevents a second workflow for the same Lab run?
- Which operation is inside `ctx.run`, and why is it not ordinary handler code?
- Which status comes from Restate, and which records are only Lab projections?
- What can be known after an OpenRouter transport failure?
- What remains after the service process is replaced?

The platform implementation and its limitations are documented in
[`architecture.md`](../../../server/src/platforms/restate/docs/architecture.md) and
[`semantics.md`](../../../server/src/platforms/restate/docs/semantics.md).
