# Service capability task

## Goal and inputs

Assign a documentation owner for fictional Cedar using a controlled release
application. The first turn loads the `release-coordination` skill, reads through
MCP, assigns Morgan through the approved HTTP connector and verifies through MCP.
The correction assigns Avery using the current revision and verifies again.
The acceptance driver gives each task a fresh `cap-...` namespace.

A new namespace starts with owner `null`, status `blocked`, revision 1, approved
date 2026-10-22 and dependency `Integration documentation incomplete`.
The two successful edits produce revisions 2 and 3 and status `in_progress`.
The date and dependency remain unchanged. Assignment does not establish launch
readiness.

## Application and capability configuration

The real local HTTP service lives in
`server/src/capabilities/integrations/task-service/service.ts`. It listens on
`127.0.0.1:9196` and persists namespace records under
`lab/runs/.service-task/`. The acceptance package explicitly composes the MCP read,
HTTP write and skills packages into `service-agent`.

| Interface | Behaviour |
| --- | --- |
| MCP `/mcp`, `release.lookup` | Reads the namespace record with text and structured content |
| HTTP `PUT /records` | Changes owner and status using `expectedRevision` |
| HTTP `GET /records` | Independent acceptance inspection |

A stale revision returns HTTP 409 without changing the record. The service
serializes local writes and saves each successful revision through a temporary
file and rename. It is a controlled fixture with no external accounts or
application authorization layer. Host admission and explicit capability approval
own agent permissions. Namespace validation prevents accidental path selection;
it does not provide tenant authentication.

The MCP fixture supports `tools/list` and `tools/call` for the configured modern
protocol only. It is not a general MCP server or a full conformance test.
There is no automatic retry guarantee for a lost write acknowledgement.

## Grader and controls

The driver inspects successful MCP reads before and after a successful HTTP edit
on each turn, retained tool receipts, procedure activation and both native
completion statuses. An independent HTTP read after each turn must find Morgan at
revision 2 and Avery at revision 3, with the unchanged date and dependency and
status `in_progress`. An assistant's claim is insufficient.

Every task uses its own namespace; the correction uses the same namespace.
No fault is injected by this scenario. Model, platform, output allowances and
provider routing are controlled by
[the capability experiment](../../experiments/agent-capabilities-live/README.md).
The focused service test separately checks an actual stale-revision conflict and
record survival across service restart.

## Run and evidence

Follow [the tools and skills guide](../../../docs/guides/capability-packages.md).
Start the task service before starting the control plane with
`server/capability-packages/acceptance.json`, so discovery sees a running service:

```sh
pnpm --filter @agent-harness-lab/lab-server dev:capability-service
```

With the configured control plane and selected native workers running:

```sh
pnpm --filter @agent-harness-lab/lab-server eval:capabilities -- \
  --api http://127.0.0.1:4318 --tasks service \
  --platforms mastra,langgraph,temporal,restate
```

`lab/runs/.evals/capabilities-<uuid>/summary.json` retains the actual prompts,
namespace, run IDs, call ordering, independent state snapshots and assertions.
Canonical run directories retain catalog identity and native details.
One successful workflow shows observed integration behavior, not general business
agent competence or production reliability.
