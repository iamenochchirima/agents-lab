# AWS Step Functions platform

This directory contains the Standard AWS Step Functions baseline. Step Functions owns
the state-machine execution; a platform-local Activity worker performs the model call
and reports the result with the Step Functions task-token APIs.

The implementation supports two profiles:

- `local`: an isolated AWS Step Functions Local endpoint, intended only for tests and
  learning;
- `aws`: an opt-in hosted profile that uses pre-created state-machine and Activity ARNs.

The baseline intentionally uses an Activity rather than an AWS-managed Lambda or HTTP
integration. That keeps the model call in the Lab's process while preserving the real
Step Functions admission, retry, timeout, cancellation, execution-history, and
reconciliation boundary.

## Files

- [`config.ts`](config.ts) — validated profile and timing configuration.
- [`service/step-functions-service.ts`](service/step-functions-service.ts) — resource
  setup, HTTP boundary, execution inspection, and native history projection.
- [`service/activity-worker.ts`](service/activity-worker.ts) — Activity polling and
  task-token completion.
- [`runner-adapter/aws-step-functions-runner.ts`](runner-adapter/aws-step-functions-runner.ts)
  — adapter for the Lab runner contract.
- [`variants/baseline/`](variants/baseline/) — ASL definition, model adapters, and
  baseline contracts.
- [`docs/`](docs/) — local operation, semantics, and AWS profile notes.

## Official references

- [What is AWS Step Functions?](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html)
- [Activities and Activity workers](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-activities.html)
- [`StartExecution`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html)
- [`DescribeExecution`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_DescribeExecution.html)
- [`GetExecutionHistory`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_GetExecutionHistory.html)
- [`StopExecution`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StopExecution.html)
- [Step Functions Local](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-local.html)

AWS currently labels Step Functions Local unsupported and not feature-complete. Local
results are therefore development evidence, not proof of every hosted AWS guarantee.
