# Hatchet runner adapter

`hatchet-runner.ts` implements the common runner port while keeping Hatchet
workflow/task IDs and lifecycle rules platform-local.

The adapter submits the task with the Lab `runId` in both task input and safe
additional metadata. Its returned `executionId` remains `hatchet:<runId>` for
the lifetime of the Lab run. Native workflow/task IDs are retained only in the
opaque native reference.

The adapter distinguishes three admission outcomes:

- confirmed accepted;
- confirmed duplicate, pointing at the existing Hatchet run;
- unknown acknowledgement, which requires reconciliation before a retry.
