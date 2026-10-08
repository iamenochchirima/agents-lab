# Workspace capability task

## Goal and inputs

Investigate fictional Cedar launch readiness using the files in `fixtures/`.
The agent must discover and load the `evidence-report` skill, read
`references/report-format.md`, inspect the dated source documents, and save a
report at `artifacts/cedar-report.md`. A second turn in the same session adds the
heading `Immediate action` and states that a documentation owner must be assigned.
The exact prompts are retained by the acceptance driver.

`brief.md` defines the task. `planning.md` proposes 2026-10-15;
`release-status.md` replaces that proposal with the approved date 2026-10-22 and
records incomplete integration documentation. These are fictional facts, not
external research targets. The skill is shipped separately in
`server/capability-packages/skills/evidence-report/`.

## Environment and controls

The `workspace-agent` profile combines the configured workspace and skill
packages. Each fresh session receives its own copy of the fixture template under
`lab/runs/.workspaces/<session-id>/`; both turns share that copy. Only the
`artifacts` directory accepts writes. Overwriting an existing file requires its
current digest. Path confinement is not an operating-system sandbox.

The acceptance driver approves the selected profile's declared write operations.
Skills grant no permission, and their scripts do not become executable tools.
The model selects tool steps through the chosen native baseline. The scenario
contains no model, platform, retry policy or injected fault configuration; those
belong to [the capability experiment](../../experiments/agent-capabilities-live/README.md).

## Expected artifact and grader

The saved report must contain 2026-10-22, the integration-documentation dependency,
a reference to `release-status.md`, and the correction's heading and owner action.
The driver inspects the file independently of the assistant's final response.
It also inspects retained capability receipts and native event ordering:

- The first turn loads a procedure, reads the specified reference, reads a source,
  writes the report and reads the saved report.
- The correction reads the report before an actual write or patch and reads it
  again afterward.
- Both turns complete and retain inspectable tool evidence.

These checks are deliberately bounded. They do not validate every citation's line
number, assess prose quality, or establish reliable task success from one trial.
A completed native run with no saved report fails artifact acceptance.

## Run and evidence

Follow [the tools and skills guide](../../../docs/guides/capability-packages.md)
for package loading, workers and credentials, then run from the repository root:

```sh
pnpm --filter @agent-harness-lab/lab-server eval:workspace -- \
  --api http://127.0.0.1:4318 --platforms mastra,langgraph,temporal,restate
```

The aggregate report lives at
`lab/runs/.evals/capabilities-<uuid>/summary.json`. Its run IDs lead to canonical
run configuration, events, native details and `artifacts/capability-calls/`
receipts. Preserve failed reports alongside successful ones.
