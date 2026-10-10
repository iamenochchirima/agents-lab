import { Workflow, type AnyWorkflow } from "@mastra/core/workflows";

/**
 * Core 1.66.0 prunes completed mapping outputs that native restart reads again.
 * Keep running state until upstream preserves those recovery inputs. Only the
 * opt-in durable baseline installs this policy, and suspended pruning is retained.
 * See the killed-worker test and docs/semantics.md for the reproduced boundary.
 */
export function preserveDurableRecoveryInputs(workflow: AnyWorkflow): void {
  const prune = workflow.options.pruneSnapshot;
  workflow.options.pruneSnapshot = parameters => parameters.workflowStatus === "running"
    ? parameters.snapshot : prune?.(parameters) ?? parameters.snapshot;
  for (const step of Object.values(workflow.steps)) {
    if (step instanceof Workflow) preserveDurableRecoveryInputs(step);
  }
}
