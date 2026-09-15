# AWS Step Functions baseline platform

**Created:** 2026-09-15T10:35:00+02:00
**Last updated:** 2026-09-15T10:35:00+02:00
**Status:** Active
**Owner:** Assigned platform agent
**Platform:** `aws-step-functions`
**Variant:** `baseline`

## Start here

Read the [parallel coordination plan](platform-parallel-implementation.md), the
[platform plan template](../templates/platform-baseline.md), the [generic runner
port](../../../server/src/control-plane/ports/README.md), and the [completed server
foundation](../completed/server-platform-foundation.md).

Use the official [AWS SDK for JavaScript](https://github.com/aws/aws-sdk-js-v3),
[Step Functions documentation](https://docs.aws.amazon.com/step-functions/), and
the selected LocalStack or AWS local-development documentation. Pin SDK and emulator
versions before implementation.

## Purpose and definition of done

Implement one Step Functions state-machine execution for the common prompt request.
The baseline must run against an isolated LocalStack profile first, and only add an
AWS profile when credentials, cost, region, and cleanup rules are explicit. It must
produce normalized records and `native/aws-step-functions.json` containing the safe
state-machine and execution identities.

```text
POST /api/runs → Step Functions runner adapter → state-machine execution → evidence
```

LocalStack evidence must not be presented as proof of every AWS-managed production
guarantee. The plan must compare the emulator and AWS profiles explicitly.

## Ownership and parallel boundary

Owned files:

```text
server/src/platforms/aws-step-functions/**
server/tests/platforms/aws-step-functions/**
server/integration-tests/aws-step-functions-baseline.test.ts
development/playground/aws-step-functions-baseline/**
```

Do not edit common control-plane files, root manifests/lockfiles, local-stack startup,
web catalog, or documentation navigation. The primary agent owns registration, shared
environment forwarding, and any CI/cloud profile changes.

## Runtime and infrastructure decision

- Language/runtime: TypeScript on Node.js using the AWS SDK behind this platform
  boundary.
- Local infrastructure: isolated LocalStack Step Functions endpoint, state-machine
  definition, region, account profile, and deterministic readiness check.
- Hosted profile: optional and opt-in; never required for offline unit tests.
- Native identity: state-machine ARN/name, execution ARN, start timestamp, status,
  and safe state-transition metadata.
- Secrets: AWS credentials and provider keys remain environment-only.

## Lifecycle and failure semantics

Define state-machine admission, execution start idempotency, polling, terminal status,
stop/cancel behaviour, retry/backoff, timeout, duplicate starts, lost acknowledgements,
LocalStack restart, AWS throttling, and unknown outcomes. The execution name must be
derived from `runId` with the platform's actual uniqueness constraints. A successful
external state-machine start followed by a lost response must be reconciled, not
started again blindly. Orphan executions are retained as diagnostics but not adopted.

## Evidence and tests

Required checks:

- unit tests for state-machine input, execution identity, status mapping, retry,
  cancellation, throttling, and redaction;
- LocalStack integration success, failure, timeout, cancellation, restart, and
  unavailable-emulator tests;
- duplicate-start and lost-acknowledgement tests;
- native evidence and normalized result inspection after the adapter exits;
- opt-in AWS smoke test only when credentials and cleanup are available;
- server/web compatibility checks after primary integration;
- a playground explaining emulator versus hosted observations.

## Documentation and handoff

Document state-machine definitions, emulator setup, AWS profile setup, IAM scope,
cost/cleanup controls, retries, recovery, evidence, and known emulator limitations.
Use focused runtime, tests/infrastructure, and docs commits. The handoff must state
whether the implementation is LocalStack-only or AWS-validated and list primary
integration changes without editing shared files.
