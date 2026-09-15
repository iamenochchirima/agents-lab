import { NodeHttpHandler, SFNClient } from "./aws-sdk.js";

import type { AwsStepFunctionsConfig } from "./config.js";

export interface AwsStepFunctionsApi {
  send(command: object, options?: { readonly abortSignal?: AbortSignal }): Promise<unknown>;
}

export interface AwsStepFunctionsClientHandle {
  readonly api: AwsStepFunctionsApi;
  readonly close: () => void;
}

/** Creates the SDK client only inside the AWS platform boundary. */
export function createAwsStepFunctionsClient(
  config: AwsStepFunctionsConfig,
): AwsStepFunctionsClientHandle {
  const client = new SFNClient({
    region: config.region,
    ...(config.endpointUrl === null ? {} : { endpoint: config.endpointUrl }),
    ...(config.profile === "local"
      ? { credentials: { accessKeyId: "local", secretAccessKey: "local" } }
      : {}),
    // GetActivityTask is a 60-second long poll. AWS documents a client socket
    // timeout of at least 65 seconds so an idle poll is not cut off early.
    requestHandler: new NodeHttpHandler({ requestTimeout: config.activityPollSocketTimeoutMs }),
  });

  return {
    api: {
      send(command, options) {
        return client.send(command as never, options as never) as Promise<unknown>;
      },
    },
    close: () => client.destroy(),
  };
}
