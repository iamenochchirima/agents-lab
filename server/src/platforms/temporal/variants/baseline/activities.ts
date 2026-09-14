import { cancellationSignal } from "@temporalio/activity";

import type { ModelCallResult, ModelRequestInput } from "./contracts.js";
import { createModelAdapter } from "./models/factory.js";

/**
 * Network and provider I/O belongs in an Activity. The Workflow supplies a
 * stable attempt ID and owns the decision about whether a returned failure is
 * safe to retry.
 */
export async function requestModel(input: ModelRequestInput): Promise<ModelCallResult> {
  return createModelAdapter(input.provider).complete(input, cancellationSignal());
}

export const baselineActivities = { requestModel };
