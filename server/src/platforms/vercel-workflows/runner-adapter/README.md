# Lab runner adapter

`vercel-workflows-runner.ts` implements the Lab runner port for the baseline.

`executionId` is the stable Lab run identity. The native Workflow run ID remains in
the `native.workflowRunId` field, along with the Workflow SDK version, local World,
workflow ID, and admission acknowledgement.

If admission loses its acknowledgement, the adapter does not invent a failure or
retry blindly. It returns a deterministic reference whose inspection result is
`reconciliation_required`.
