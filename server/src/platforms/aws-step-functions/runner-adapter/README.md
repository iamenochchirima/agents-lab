# Lab runner adapter

[`aws-step-functions-runner.ts`](aws-step-functions-runner.ts) keeps the Lab runner
contract independent from AWS SDK types. The adapter talks to the platform-local HTTP
service, retains a deterministic Lab execution ID, and stores the actual execution ARN
inside the native reference when AWS or the emulator returns it.
