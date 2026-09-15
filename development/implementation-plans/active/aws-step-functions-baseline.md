# AWS Step Functions baseline platform

**Created:** 2026-09-15T10:35:00+02:00<br>
**Last updated:** 2026-09-15T15:10:00+02:00<br>
**Status:** Active — platform-local implementation and shared registration complete; emulator validation is pending<br>
**Owner:** Assigned platform agent<br>
**Platform:** `aws-step-functions`<br>
**Variant:** `baseline`

## Purpose

Implement one Standard AWS Step Functions execution for the Lab's common prompt
request. The execution is a real Step Functions state-machine run with one
platform-owned Activity worker. The worker performs the fake or optional
OpenRouter model call and reports the result through the Activity task token.

This is a Standard-only baseline. Express, Lambda, HTTP service integrations,
Map workflows, and hosted deployment automation remain separate work.

```text
Lab runner → platform-local HTTP service → Standard state machine → Activity worker → normalized/native evidence
```

## First-party verification

Research was checked on 2026-09-15 against:

- [Step Functions overview and workflow types](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html)
- [Activities and Activity workers](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-activities.html)
- [`StartExecution`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html)
- [`DescribeExecution`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_DescribeExecution.html)
- [`GetExecutionHistory`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_GetExecutionHistory.html)
- [`StopExecution`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StopExecution.html)
- [`GetActivityTask`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_GetActivityTask.html)
- [Step Functions error handling](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)
- [Step Functions Local](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-local.html)
- [AWS SDK for JavaScript v3 source](https://github.com/aws/aws-sdk-js-v3)

Observed/package values recorded for reproducibility:

- `@aws-sdk/client-sfn` `3.1132.0`.
- `@smithy/node-http-handler` `4.12.1`.
- Official local image name: `amazon/aws-stepfunctions-local`; AWS does not
  publish a production-equivalence guarantee for the emulator. An image tag or
  digest still needs to be pinned before automated emulator validation.

The [coordinated platform source audit](../../../docs/research/platform-plan-source-audit.md)
was used as related Lab context. Hermes, OpenClaw, and Waku are not platform
dependencies for this implementation; they remain reference harnesses.

## Scope and ownership

Owned by this plan:

```text
server/src/platforms/aws-step-functions/**
server/tests/platforms/aws-step-functions/**
server/integration-tests/aws-step-functions-baseline.test.ts
development/playground/aws-step-functions-baseline/**
```

The common control plane, root/server manifests, startup scripts, UI/catalog,
documentation navigation, and Computer Native files are deliberately outside
this change. The platform-owned `package.json` and lockfile are the dependency
boundary; no shared package file is changed.

## Platform identity and design

| Concern | Decision |
| --- | --- |
| Runtime | TypeScript on Node.js `>=22.13.0` |
| SDK | Platform-local AWS SDK v3 Step Functions client `3.1132.0` |
| Execution model | AWS Standard state machine with one Activity Task |
| Durability | Step Functions owns execution state/history; the Lab owns normalized projection/evidence |
| Local dependency | Step Functions Local at a configured HTTP endpoint, normally port `8083` |
| Hosted dependency | Opt-in AWS profile with pre-created state-machine and Activity ARNs |
| Model | Deterministic fake by default; OpenRouter only from service-process environment |
| Native identity | Deterministic `executionName` plus returned `executionArn` |
| Common identity | `executionId = aws-step-functions:<runId>`; it is stable but intentionally not the native identity |
| State machine | One `RequestModel` Activity state with bounded timeout and retry policy |
| Worker | Long-polls `GetActivityTask`, then sends exactly one success/failure completion attempt per task result |

## Definition of done

- [x] A validated local profile can create/reuse the Activity and Standard state
      machine through the AWS API.
- [x] A runner can admit, dispatch, inspect, and cancel a run through the
      platform-local HTTP service.
- [x] The deterministic execution name obeys Step Functions' 80-character
      constraint; long IDs use a stable SHA-256-derived name.
- [x] Duplicate starts with the same canonical input return the existing native
      execution; different input is a conflict.
- [x] Native status/history are projected into normalized events, trajectory,
      metrics, and terminal results while retaining native fields.
- [x] A lost start acknowledgement or uninspectable returned ARN produces a
      `reconciliation_required` result with no fabricated output.
- [x] The platform-owned SDK resolver works for source execution and compiled
      `server/dist` tests after the documented platform-local install.
- [x] Unit tests cover identity, config, state machine, worker, models, history,
      retry/cancellation projection, duplicate input, redaction, and unknown outcomes.
- [x] An opt-in Step Functions Local integration test covers success, retry,
      restart inspection, and unavailable dependency reporting.
- [ ] Step Functions Local integration has been run with a pinned emulator image.
- [ ] Hosted AWS smoke validation has been run with reviewed credentials,
      resource scope, cost limits, and cleanup.

## Implementation map

| Responsibility | Owner |
| --- | --- |
| SDK dependency resolution | `aws-sdk.ts`, platform-local `package.json` |
| Configuration and secret-safe manifest settings | `config.ts` |
| AWS client construction | `client.ts` |
| State-machine ASL and execution naming | `variants/baseline/execution/state-machine.ts` |
| Model boundary | `variants/baseline/models/{factory,fake,openrouter}.ts` |
| Activity lifecycle and task-token completion | `service/activity-worker.ts` |
| AWS resource setup, start/inspect/stop, HTTP boundary | `service/step-functions-service.ts` |
| Native history normalization | `service/history.ts` |
| Generic Lab runner adapter | `runner-adapter/aws-step-functions-runner.ts` |
| Process entry point | `service-entry.ts` |
| Normalized/native persistence | common server evidence store after runner inspection; native reference stays platform-shaped |

SDK commands and AWS-specific types remain inside this directory. The common
runner receives only `PlatformExecutionReference` and normalized inspection
data.

## Lifecycle and recovery rules

1. Validate the immutable Lab input and resolve the platform resources.
2. Derive `executionName = agentlab-<runId>` when valid and short enough; use a
   stable hash form otherwise.
3. Call Standard `StartExecution` with canonical JSON input.
4. If AWS reports `ExecutionAlreadyExists`, inspect the deterministic native
   execution and compare canonical input before returning `already_accepted`.
5. If the start response is lost, retain `submissionOutcome: unknown`; inspect
   by the same native ARN/name and return `reconciliation_required` until the
   outcome is observable.
6. The Activity worker runs the model call with a timeout below the Activity
   timeout. Retryable Activity errors are named `RetryableModelError` so ASL
   applies the bounded retry policy.
7. `StopExecution` is asynchronous. Later inspection maps `ABORTED` to
   `cancelled`; it never claims cancellation completed synchronously.
8. Native history order becomes the source sequence for normalized event
   intents. The common evidence store deduplicates repeated observations.
9. A visible execution is adopted only when both its state-machine ARN and
   deterministic execution name match. Unrelated/orphan executions are not
   adopted.

The native reference contains state-machine/activity names and ARNs, execution
name/ARN, status, timestamps, history count/last event, retry count, provider
request ID, submission outcome, and acknowledgement state. Credentials, task
tokens, provider keys, raw authorization headers, and raw provider responses
are excluded.

## Local operation

The exact install, Docker, service, focused-test, integration-test, hosted-profile,
permission, and emulator limitation instructions live in:

- [`platform README`](../../../server/src/platforms/aws-step-functions/README.md)
- [`local-development.md`](../../../server/src/platforms/aws-step-functions/docs/local-development.md)
- [`semantics.md`](../../../server/src/platforms/aws-step-functions/docs/semantics.md)
- [`playground README`](../../../development/playground/aws-step-functions-baseline/README.md)

## Test checklist

### Offline checks

- [x] Config defaults, hosted-profile requirements, timeout bounds, and secret redaction.
- [x] State-machine parameters, retry policy, execution-name limit, and ARN derivation.
- [x] Fake retry/failure fixtures and OpenRouter request/usage boundary.
- [x] Activity success/failure task-token output and invalid-input handling.
- [x] Native history ordering, state names, trajectory, and metrics.
- [x] Service resource setup, duplicate input conflict, native identity, cancellation,
      and reconciliation-required results.
- [x] Runner HTTP mapping, stable common/native identities, and lost dispatch acknowledgement.
- [x] `npm --prefix server test` discovers the platform tests without SDK resolution failure.

### Emulator/hosted checks

- [x] Integration test is implemented and skips unless explicitly enabled.
- [ ] Local emulator success, retry, restart, and unavailable checks executed.
- [ ] Local emulator failure, timeout, cancellation, and evidence inspection executed.
- [ ] Hosted AWS smoke executed only with an approved profile and cleanup procedure.

## Required validation and recorded results

Executed on 2026-09-15:

- `npm --prefix server run build` — passed.
- `npm --prefix server test` — passed: 131 passed, 0 skipped, 0 failed; the
  AWS platform tests were included in discovery.
- `npm --prefix server run build && node --test server/dist/integration-tests/aws-step-functions-baseline.test.js`
  — passed with 2 expected skips because the opt-in flag was not set.
- `git diff --check` for the owned AWS/platform plan paths — passed.

Not run:

- Emulator integration with `AGENTLAB_RUN_AWS_STEP_FUNCTIONS_INTEGRATION=1`:
  Docker is installed, but the local Docker daemon was unavailable at
  `unix:///home/enoch/.docker/desktop/docker.sock`.
- Hosted AWS smoke: no hosted credentials, resource ARNs, cost guard, or cleanup
  approval were supplied.
- Shared UI/API compatibility: completed by the primary integration pass; local
  emulator and hosted AWS acceptance remain pending.

## Documentation and release record

- Documentation: completed in the platform README, local-development guide,
  semantics guide, component READMEs, and playground; official AWS links are
  included near each operational decision.
- Analytics: not applicable; this slice adds no product analytics.
- Structured logging: service entrypoint emits only its local listening endpoint;
  run data remains in common evidence and native references are redacted.
- Metrics/telemetry: normalized metrics come from observed execution history and
  Activity output; no synthetic latency or cost values are added.
- Version/release identity: SDK versions are pinned in the platform-owned lockfile;
  manifests identify Standard execution and the platform schema version.
- Migration/compatibility: not applicable to existing evidence; native data is
  additive behind the existing opaque execution reference.
- Rollout: local-only and opt-in; no shared bootstrap or UI registration is part
  of this plan.
- Rollback: remove/disable the platform-local directory or stop its service;
  no shared data migration is required.
- Security: credentials remain environment-only; local emulator use is limited to
  fake credentials and non-sensitive test data. Hosted IAM/resource review remains open.
- Known limitations: Step Functions Local is unsupported/non-parity; emulator tag
  pinning and execution of the opt-in integration are pending; Express and hosted
  deployment are out of scope; Activity completion transport ambiguity is retained
  for reconciliation rather than blindly replayed.

## Commit boundaries

Recorded commits:

- `0f6cbffddfe705a88e2f1cea7e0345376242af77` — platform runtime, SDK boundary,
  service, runner, state machine, and model adapters.
- `fbe6e66a7ba7958450cebac40d3d3ec6ce78faa1` — offline tests, opt-in emulator
  integration, and playground.
- `5d2447dd6f4136d37adb6efdf8d027ddf6972a59` — documentation and this active
  plan's implementation/validation record.
- `191cd8a1d6eba0e811aaaca93302033e3dbb6270` — final handoff record with the
  exact validation count and commit boundaries.

Each commit contains only the paths owned by this plan. Unrelated dirty
worktree changes remain unstaged.
