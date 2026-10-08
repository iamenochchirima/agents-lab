import { assertFreeModelRequest } from "../models/openrouter/free-model-policy.js";

/** Validate retained dispatch bodies across phased TS and combined Python telemetry.
 * Every run must retain a request; an absent observation never proves free routing.
 */
export function validateCapabilityRouting(runs: readonly { readonly events: readonly { readonly kind: string; readonly payload: Readonly<Record<string, unknown>> }[] }[], model: string, experimentId: string): boolean {
  if (!runs.length) return false;
  return runs.every(run => {
    let observed = false;
    for (const event of run.events) {
      if (event.kind !== "EvalModelObserved") continue;
      const observation = event.payload.observation as { providerRequest?: unknown } | undefined;
      if (observation?.providerRequest === undefined) continue;
      observed = true;
      try { assertFreeModelRequest(observation.providerRequest, model, experimentId); }
      catch { return false; }
    }
    return observed;
  });
}
