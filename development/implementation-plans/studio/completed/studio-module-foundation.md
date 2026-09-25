# Studio module package and interface foundation

**Created:** `2026-09-25T00:48:15+02:00`

**Last updated:** `2026-09-25T02:54:44+02:00`

**Status:** Complete

**Owner:** Agent Harness Lab

## Start here

Read these before changing code:

- [Repository rules](../../../../AGENTS.md)
- [Documentation guide](../../../../docs/contributing/documentation.md)
- [Modular agent Studio program](../modular-agent-studio.md)
- [Studio plan index](../README.md)
- [Studio assembly discovery](../../../../docs/planning/studio-assembly-discovery.md)
- [Existing Studio server module](../../../../server/src/studio/README.md)
- [Current workspace configuration](../../../../pnpm-workspace.yaml)

The completed Studio plans describe the current implementation. Treat them as
reference material, not constraints on the new package and app ownership.
The existing `server/src/studio/` implementation remains in place during this
foundation slice. New module contracts and the new API must not depend on it; a
later focused plan must decide when and how its routes and storage are retired.

## Purpose

Establish the code ownership and package interfaces needed to develop Studio's
agent modules independently. This first implementation slice creates the workspace
and Studio API host structure, defines shared run concepts and twelve role-specific
interfaces, and proves the package pattern with a narrow standalone example. It does
not implement all twelve role behaviors or assemble them into a running agent.

## Definition of done

A contributor can build and check each role's interface package without importing
Studio's API host or the existing Lab server. A representative module implementation
also runs its checks through the public interface. The separate Studio API host starts
and exposes a small health/identity endpoint. The browser-facing transport contract
is distinct from internal module contracts, so `apps/web` communicates over HTTP and
cannot import module implementations. The browser client issues a health request
and the API's HTTP/CORS boundary is checked; browser automation and agent runs are
outside this slice.

```text
module package → role-specific interface → standalone check
apps/web → HTTP transport contract → apps/studio-api
```

## Scope

- [x] Add pnpm workspace globs for `studio/*` and `studio/modules/*`.
- [x] Create `studio/agent-protocol/` for a minimal set of shared run concepts.
- [x] Create `studio/http-contract/` for JSON-safe browser/API request and response
      schemas, separate from runtime protocol types.
- [x] Create `studio/agent-kernel/` as an owned package shell; defer assembly
      execution to a later plan.
- [x] Create one workspace package under `studio/modules/` for each of the twelve
      Studio module areas.
- [x] Define each role-specific interface, versioning rule, configuration shape,
      state ownership, lifecycle, cancellation, error behavior, and evidence output.
- [x] Record package contract version separately from the selected implementation
      ID/version in the declarative assembly shape.
- [x] Give each role package a README, package exports, and an independent
      interface/contract check.
- [x] Implement one narrow representative module behavior and test it through its
      public interface to prove the package pattern.
- [x] Create `apps/studio-api/` as a separate HTTP host with a health/identity
      endpoint. Keep it independent from `server/`.
- [x] Define a browser-safe HTTP transport contract. Keep internal protocol and
      implementation types out of the web bundle.
- [x] Add a minimal `apps/web` request through that transport contract to prove the
      browser-to-API connection without adding run controls.
- [x] Document the ownership rules, package development commands, and known limits.
- [x] Reconcile the existing Studio-in-server ADR with the agreed ownership direction.
- [x] Record the migration boundary for the existing server-hosted Studio module;
      do not remove its routes or data as part of this package-foundation slice.

## Explicitly out of scope

- Wiring all twelve modules into an assembled agent or implementing the full control
  loop.
- Run submission, cancellation, event streaming, durable evidence, or comparison
  endpoints beyond the host health/identity check.
- The full Studio browser workflow. The web app only needs a clear HTTP client seam
  for this stage.
- Baseline behavior for all twelve roles. Each role's first behavior implementation
  will have a focused follow-on plan after this foundation is reviewed.
- Alternative implementations, a general dynamic plugin loader, or module-specific
  processes.
- Publishing packages or splitting any package into a separate repository.
- Production filesystem, network, or computer-use permissions.

This slice defines package homes and contracts for all twelve roles. It only claims
an executable implementation for the representative role or roles selected in the
plan. Later module plans must implement actual behavior rather than turn the other
package shells into permanent placeholders.

## Ownership and boundaries

```text
studio/agent-protocol/    → shared run identity, events, cancellation, capabilities
studio/http-contract/     → JSON-safe Studio API wire schemas
studio/modules/<role>/   → role interface, configuration, implementation, tests
studio/agent-kernel/      → assembly and lifecycle contracts; execution comes later
apps/studio-api/          → HTTP host and browser-facing transport
apps/web/                 → browser UI and HTTP client; no agent execution code
server/                   → existing Platform Lab APIs and runtime
```

Each module package owns its role-specific interface and implementation. The kernel
may depend on those public interfaces, but modules must not import one another's
internals. The kernel coordinates modules without absorbing their algorithms. A
single generic `run(input) -> output` contract is explicitly out of scope.

The `agent-protocol` package must stay small. It may define shared run IDs, event
envelopes, cancellation, and capability descriptors. Memory's read/write semantics,
Context's assembly result, Tool Use's dispatch result, and other role-specific data
belong with their owning module.

The web client uses JSON-compatible transport data only. It calls the Studio API
over HTTP. It does not import `agent-kernel`, role packages, provider SDKs, storage
adapters, or environment implementations.

## Package standard

Each module package should have a small, predictable structure:

```text
studio/modules/<role>/
  package.json
  README.md
  src/
    index.ts
    contract.ts
    config.ts
    implementations/           # when the implementation is large enough to split
  tests/
    config.test.mjs
    <behavior>.test.mjs
```

The package README documents its responsibility, interface, configuration,
dependencies, supported behavior, limitations, and independent commands. Small
implementations may sit beside the contract; larger ones may use an
`implementations/` subdirectory. The implementation accepts host-provided
capabilities rather than creating global clients or reaching into Studio. Tests
import from the public package entry point and exercise the same contract that the
kernel will later use.

## Interface requirements

For each role, record:

- the operation's input and returned value or receipt;
- configuration fields, defaults, and validation errors;
- state owned by the module and whether it survives turns or process restarts;
- initialization, close, and cancellation behavior where applicable;
- external capabilities and compatibility requirements;
- error categories, retry safety, and side-effect uncertainty where applicable;
- evidence emitted and data that must be redacted;
- one example call and one independent check.

Interfaces should expose the smallest useful surface for the initial behavior while
leaving module-specific telemetry intact. Do not invent common methods solely to
make the twelve roles look uniform.

## Representative implementation

Choose one narrow implementation, preferably for a stateful module such as Memory,
or a small Memory/Context pair if one role alone cannot prove the package exchange.
Use deterministic local fixtures. The selected behavior validates the package and
contract pattern; it is not a variation study or a complete agent. All remaining
baseline implementations belong to later focused plans. Those plans
must define an honest local path for Computer Use and Execution Environment rather
than representing unsupported work as completed.

## Failure, retry, and recovery semantics

This slice defines contracts and standalone behavior, not a durable multi-module run.
Each role contract must still state whether its initial operation can be retried,
what happens on cancellation, and whether an interrupted side effect has an unknown
outcome. Stateful modules must state when their state is written and what survives a
process restart. The later kernel plan will define cross-module recovery.

## Security and configuration

- [x] Keep provider credentials and environment secrets in the API host, never in
      browser transport data or module configuration sent by the browser.
- [x] Validate package configuration before constructing an implementation.
- [x] Declare filesystem, network, process, and computer capabilities explicitly.
- [x] Do not load arbitrary package names or execute user-supplied code in this slice.
- [x] Keep defaults deterministic and locally runnable.

## Implementation checklist

### 1. Workspace and ownership

- [x] Confirm package naming and pnpm workspace globs for `studio/`.
- [x] Create `agent-protocol`, `agent-kernel`, and twelve role package shells.
- [x] Create the separate `apps/studio-api` host shell and health/identity route.
- [x] Define the browser-safe HTTP transport schema without importing internal
      runtime types into `apps/web`.
- [x] Add the minimal web request to the Studio API health/identity route.
- [x] Link the umbrella and this focused plan from the Studio index, and mark the
      previous roadmap as historical.
- [x] Reconcile the existing Studio-in-server ADR with the agreed ownership direction.
- [x] Confirm the old `server/src/studio/` code remains isolated from new packages
      and record removal/migration as a later decision.

### 2. Shared protocol and module contracts

- [x] Define only cross-role run identity, event envelope, cancellation, and
      capability concepts in `agent-protocol`.
- [x] Keep browser transport schemas in `studio/http-contract`, with no dependency
      on module implementation packages.
- [x] Write the twelve role-specific interfaces and configuration shapes with
      explicit ownership, lifecycle, and error semantics.
- [x] Review the proposed interfaces against one reference assembly flow on paper.
- [x] Record unresolved contracts rather than hiding assumptions in shared types.

### 3. Representative package implementation

- [x] Select one representative package after reviewing the twelve role interfaces.
- [x] Add one narrow, executable implementation to the selected package or related
      pair of packages.
- [x] Use injected dependencies and declared capabilities.
- [x] Add contract checks for valid results, invalid configuration, cancellation,
      and role-specific failures where applicable.
- [x] Confirm every interface package and the representative implementation build
      and run checks without importing the Studio API host or existing server.

### 4. Documentation and handoff

- [x] Document the package pattern and how to work on one module independently.
- [x] Document API host startup and the HTTP-only browser relationship.
- [x] Record any package dependency that is needed and why existing dependencies or
      the standard library are insufficient.
- [x] Update the umbrella plan with verified decisions and remaining open questions.

## Test coverage

### Package checks

- [x] Each package type-checks and builds through its public exports.
- [x] Every role interface passes its package-level contract/type checks.
- [x] The representative implementation passes behavior and failure-path checks.
- [x] Invalid configuration and documented error paths are checked.
- [x] Cancellation and retry/side-effect semantics are checked where applicable.
- [x] A package cannot depend on another role package's private source paths.

### API and browser boundary

- [x] Studio API starts independently from `server/` and answers its health/identity
      request.
- [x] The HTTP schema serializes without runtime objects or secrets.
- [x] `apps/web` uses the transport client and does not import kernel or module
      implementation packages.
- [x] The browser client contains its request to the health endpoint, and the API
      health contract and configured CORS policy are tested. Browser automation is
      outside this plan's validation scope.

### Manual acceptance checks

- [x] Build/check one role package directly from the workspace.
- [x] Start the Studio API host without starting the existing Lab server.
- [x] Inspect package and API ownership documentation against the directory layout.

## Required validation commands

The implementation must define and document exact package scripts before execution.
At minimum, the following checks should be available:

```bash
pnpm install --offline --frozen-lockfile
pnpm --filter '@agent-harness-lab/module-*' typecheck
pnpm --filter '@agent-harness-lab/module-*' test
pnpm --filter @agent-harness-lab/agent-protocol build
pnpm --filter @agent-harness-lab/agent-protocol typecheck
pnpm --filter @agent-harness-lab/agent-kernel build
pnpm --filter @agent-harness-lab/agent-kernel typecheck
pnpm --filter @agent-harness-lab/studio-http-contract test
pnpm --filter @agent-harness-lab/studio-api typecheck
pnpm --filter @agent-harness-lab/studio-api test
pnpm --filter @agent-harness-lab/web typecheck
pnpm --filter @agent-harness-lab/web build
git diff --check
```

The plan must revise these commands if final workspace package names or scripts
differ. Do not run browser or external-provider acceptance as part of this slice.

## Completion gate

- [x] The package and process ownership matches the umbrella plan.
- [x] All twelve module interfaces are role-specific and documented.
- [x] Every role package has a documented interface and independent contract check.
- [x] The representative package has one small working implementation and behavior
      checks; remaining roles are explicitly scheduled for follow-on plans.
- [x] The Studio API host runs independently and exposes no internal runtime types
      through its HTTP contract.
- [x] All required package checks pass and the docs match the code.
- [x] The kernel and modules have not been wired into a complete run; that is the
      next focused plan.

## Commit discipline and handoff

- [x] Keep package ownership, protocol, role contracts, and host shell in reviewable
      groups.
- [x] Preserve unrelated work in the shared tree.
- [x] Record validation results, unresolved interfaces, dependency choices, and
      known limitations before the next plan begins.

## Completion record

Complete this section only when archiving the plan.

**Completed:** `2026-09-25T02:54:44+02:00`

**Commits:** None; changes remain uncommitted by request.

### Validation

- `pnpm install --offline --frozen-lockfile` — passed; lockfile is current.
- `pnpm --filter @agent-harness-lab/agent-protocol build`, `typecheck`, and `test` — passed.
- `pnpm --filter '@agent-harness-lab/module-*' test` and `typecheck` — all twelve packages passed.
- `pnpm --filter @agent-harness-lab/agent-kernel build` and `typecheck` — passed.
- `pnpm --filter @agent-harness-lab/studio-http-contract test` — passed.
- `pnpm --filter @agent-harness-lab/studio-api test` and `typecheck` — passed.
- `pnpm --filter @agent-harness-lab/web typecheck` and `build` — passed. Vite warned
  that some built application/documentation chunks exceed 500 kB.
- Studio API `dev` and built `start` modes — both started independently; `/health`
  returned the expected JSON identity, and the configured browser origin was
  returned by the CORS check.
- Static import audit — no module-private source imports from other modules, the
  browser, or the API host.
- `git diff --check` — passed.

### Known limitations

- The kernel is a declarative package shell; modules are not assembled into a full
  agent turn. Kernel composition, run lifecycle, evidence, and API run operations
  need a later focused plan.
- Memory is the only module with executable role behavior. It keeps state in one
  in-memory session object and has no persistence or restart recovery.
- Browser request code and API CORS/contract checks are in place, but browser
  automation and external-provider checks were intentionally not run.
- The prior `server/src/studio/` routes and data remain during the transition; a
  separate plan must determine their migration or retirement.
