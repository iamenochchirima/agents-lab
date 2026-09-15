import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type StepFunctionsSdk = typeof import("@aws-sdk/client-sfn");
type SmithyHttpSdk = typeof import("@smithy/node-http-handler");

const requireFromPlatform = createRequire(import.meta.url);
const platformDirectory = dirname(fileURLToPath(import.meta.url));

/**
 * The platform owns its AWS SDK installation instead of adding it to the
 * shared server manifest. `tsc` places server output under `server/dist`, so
 * normal bare-package lookup would miss `server/src/platforms/.../node_modules`
 * after compilation. Resolve from both locations explicitly.
 */
function requirePlatformDependency<T>(specifier: string): T {
  const sourceDirectory = platformDirectory.replace(/\/dist\/src(?=\/|$)/, "/src");
  const candidates = [
    platformDirectory,
    sourceDirectory,
    resolve(process.cwd(), "src/platforms/aws-step-functions"),
    resolve(process.cwd(), "server/src/platforms/aws-step-functions"),
  ];
  for (const candidate of candidates) {
    try {
      return requireFromPlatform(requireFromPlatform.resolve(specifier, { paths: [candidate] })) as T;
    } catch {
      // Try the next platform-local location. The final error below gives the
      // contributor the actual dependency and install boundary to fix.
    }
  }
  throw new Error(
    `Unable to resolve ${specifier} for the AWS Step Functions platform. Install it with npm --prefix server/src/platforms/aws-step-functions install.`,
  );
}

const stepFunctionsSdk = requirePlatformDependency<StepFunctionsSdk>("@aws-sdk/client-sfn");
const smithyHttpSdk = requirePlatformDependency<SmithyHttpSdk>("@smithy/node-http-handler");

export const {
  CreateActivityCommand,
  CreateStateMachineCommand,
  DescribeExecutionCommand,
  DescribeStateMachineCommand,
  GetActivityTaskCommand,
  GetExecutionHistoryCommand,
  ListActivitiesCommand,
  ListExecutionsCommand,
  ListStateMachinesCommand,
  SFNClient,
  SendTaskFailureCommand,
  SendTaskSuccessCommand,
  StartExecutionCommand,
  StopExecutionCommand,
  UpdateStateMachineCommand,
} = stepFunctionsSdk;

export const { NodeHttpHandler } = smithyHttpSdk;
