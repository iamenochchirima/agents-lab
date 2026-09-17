# Local development

## Install the platform dependency

The AWS SDK is owned by this platform and is not added to the shared server
manifest. From the repository root, install it with:

```sh
pnpm install
```

The platform-owned resolver supports both TypeScript source execution and the
server's compiled `server/dist` test output.

## Start Step Functions Local

Step Functions Local is an AWS-provided emulator for development and testing.
The image is not feature-complete or supported for production use. Start an
isolated instance on port `18083`:

```sh
docker run --rm --name agentlab-step-functions-local \
  -p 18083:8083 \
  amazon/aws-stepfunctions-local
```

Point the platform at it:

```sh
export AGENTLAB_AWS_STEP_FUNCTIONS_ENDPOINT_URL=http://127.0.0.1:18083
```

The local profile uses fake credentials (`local`/`local`) and the example
account `012345678901`. They are only emulator values. Do not send sensitive
data to the emulator.

## Run the platform service

The service owns resource setup, the Activity worker, and the platform-local
HTTP boundary. In a second terminal:

```sh
cd server
pnpm exec tsx src/platforms/aws-step-functions/service-entry.ts
```

Its default HTTP endpoint is `http://127.0.0.1:9093`. The generic Lab runner
adapter calls this endpoint; the service then calls Step Functions through the
configured local endpoint.

## Checks

Offline platform checks, including the AWS SDK resolution boundary, run with:

```sh
pnpm --filter @agent-harness-lab/lab-server test
```

To run only this platform's compiled tests:

```sh
cd server
pnpm run build
node --test dist/tests/platforms/aws-step-functions/*.test.js
```

The emulator integration test is opt-in:

```sh
cd server
pnpm run build
AGENTLAB_RUN_AWS_STEP_FUNCTIONS_INTEGRATION=1 \
  AGENTLAB_AWS_STEP_FUNCTIONS_ENDPOINT_URL=http://127.0.0.1:18083 \
  node --test dist/integration-tests/aws-step-functions-baseline.test.js
```

The test must be run with the Docker emulator available. A skipped test means
the opt-in flag was not supplied; it is not evidence that the emulator or AWS
is healthy.

## Hosted AWS profile

The `aws` profile is deliberately not part of the local default. It requires
pre-created state-machine and Activity ARNs:

```sh
export AGENTLAB_AWS_STEP_FUNCTIONS_PROFILE=aws
export AGENTLAB_AWS_STEP_FUNCTIONS_STATE_MACHINE_ARN='arn:aws:states:...:stateMachine:...'
export AGENTLAB_AWS_STEP_FUNCTIONS_ACTIVITY_ARN='arn:aws:states:...:activity:...'
```

The caller needs permissions appropriate to the selected resources for
`StartExecution`, `DescribeExecution`, `GetExecutionHistory`, and
`StopExecution`; the Activity worker also needs `GetActivityTask`,
`SendTaskSuccess`, and `SendTaskFailure`. Resource scoping, account, region,
cost limits, and cleanup are deployment decisions and must be reviewed before
using the hosted profile.

References: [Step Functions Local](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-local.html),
[Activities](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-activities.html),
[`GetActivityTask`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_GetActivityTask.html).
