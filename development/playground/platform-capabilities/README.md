# Platform capability walkthrough

This playground answers one question: what does a selected capability profile become
before a platform runs it?

It is a learning walkthrough, not a regression suite, scenario, experiment, or published
run. It uses the production capability catalog, context session, tool policy, and local
MCP/direct-API/OAuth fixtures. No credentials, Docker service, or external account is
needed.

## Run the focused checks

From the repository root:

```bash
pnpm --filter @agent-harness-lab/lab-server run build
node --test server/dist/tests/capabilities/integrations.test.js server/dist/tests/capabilities/catalog.test.js server/dist/tests/context/context-service.test.js
```

## Inspect

- `local-safe` resolves `calculator`, `fixture_lookup`, and the untrusted
  `research-summary` skill.
- the skill appears in a request snapshot as `source: "skills"`, with no authority;
  `context.json` redacts its body.
- `fixture_write` is denied until an approval matches the capability version and
  operation.
- local connection tests expose MCP request IDs, direct-API retry attempts, OAuth state
  and refresh behaviour, while keeping credentials out of results.

The automated tests are the durable safety net. This directory is for stepping through
the same boundaries while learning and recording observations.
