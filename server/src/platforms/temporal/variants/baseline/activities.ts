import { cancellationSignal, heartbeat } from "@temporalio/activity";

import type { ModelCallResult, ModelRequestInput } from "./contracts.js";
import { createModelAdapter } from "./models/factory.js";

/**
 * Network and provider I/O belongs in an Activity. The Workflow supplies a
 * stable attempt ID and owns the decision about whether a returned failure is
 * safe to retry.
 */
export async function requestModel(input: ModelRequestInput): Promise<ModelCallResult> {
  const heartbeatTimer = setInterval(() => heartbeat({ attemptId: input.attemptId }), 250);
  try {
    heartbeat({ attemptId: input.attemptId });
    return await createModelAdapter(input.provider).complete(input, cancellationSignal());
  } finally {
    clearInterval(heartbeatTimer);
  }
}

export const baselineActivities = { requestModel };
