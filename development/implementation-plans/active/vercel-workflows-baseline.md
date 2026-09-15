# Vercel Workflows baseline platform

**Created:** 2026-09-15T10:35:00+02:00
**Last updated:** 2026-09-15T10:35:00+02:00
**Status:** Active
**Owner:** Assigned platform agent
**Platform:** `vercel-workflows`
**Variant:** `baseline`

## Start here

Read the [parallel coordination plan](platform-parallel-implementation.md), the
[platform plan template](../templates/platform-baseline.md), the [generic runner
port](../../../server/src/control-plane/ports/README.md), and the [completed server
foundation](../completed/server-platform-foundation.md).

Use the official [Vercel Workflow repository](https://github.com/vercel/workflow),
[Vercel AI SDK repository](https://github.com/vercel/ai), and current Vercel local
and deployment documentation. Record whether the selected baseline is locally
reproducible or requires a Vercel project before marking it runnable.

## Purpose and definition of done

Implement one real Vercel Workflow/AI SDK execution profile for the common prompt
request. The plan must distinguish a local development run from a hosted Vercel run,
capture the platform execution identity, and produce normalized evidence plus
`native/vercel-workflows.json`.

```text
POST /api/runs → Vercel runner adapter → workflow execution → evidence
```

If the workflow cannot be durably exercised without a hosted project, the plan may
keep the variant planned until a safe, reproducible project profile exists. It must
not label a mocked local response as Vercel durability.

## Ownership and parallel boundary

Owned files:

```text
server/src/platforms/vercel-workflows/**
server/tests/platforms/vercel-workflows/**
server/integration-tests/vercel-workflows-baseline.test.ts
development/playground/vercel-workflows-baseline/**
```

Do not edit common server contracts, root manifests/lockfiles, local-stack startup,
the web catalog, or documentation navigation. Hosted project setup and shared
environment forwarding are primary-agent integration work.

## Runtime and infrastructure decision

- Language/runtime: TypeScript on Node.js with Vercel's workflow and AI SDK boundary.
- Infrastructure: an isolated local Vercel dev profile where supported, plus an
  explicitly documented hosted test profile when local execution cannot prove the
  workflow semantics.
- Native identity: workflow execution/run identity, deployment/profile identity, and
  safe step/checkpoint metadata.
- Credentials: Vercel and provider credentials remain environment-only and never enter
  manifests, native evidence, logs, or model prompts.

## Lifecycle and failure semantics

Document workflow admission, step execution, suspend/resume, retry, timeout,
cancellation support, deployment restart, lost acknowledgement, and hosted/local
differences. Record whether an interrupted external model call may be duplicated.
Define the exact result when the Vercel API or deployment is unavailable. Do not claim
the local dev server has production durability unless the platform evidence supports it.

## Evidence and tests

Required checks include unit identity/configuration/redaction tests; local profile tests
where genuinely supported; hosted smoke tests behind an explicit opt-in profile;
failure, timeout, cancellation, and unknown-outcome tests; evidence inspection after
the client exits; and server/web compatibility checks. Native evidence must retain
platform step/deployment information while excluding tokens, cookies, headers, and
provider responses.

## Documentation and handoff

Document local versus hosted semantics, required credentials, cost boundaries, exact
readiness checks, deployment profile, rollback, and known limitations. Use focused
runtime, test/profile, and docs commits. The handoff must state whether the variant is
actually runnable locally, hosted-only, or still planned and list primary integration
changes without editing shared files.
