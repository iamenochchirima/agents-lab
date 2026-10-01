# Studio remaining module baselines

**Created:** `2026-09-25`

**Last updated:** `2026-09-25`

**Status:** Complete

## Purpose

Give the remaining Studio roles one small, independently usable implementation
each. These baselines complete the first pass across the twelve role packages
before a separate plan wires them into the general kernel and reference
assembly.

## Scope

Implement the first baseline in each package that still has only a contract and
configuration: Planning, Computer Use, Output Actions, and Observability. Each
implementation must be constructible and checked through its package exports,
without importing the Studio API, browser, kernel, or another role's internals.

This plan does not connect the four roles to the chat runtime, add alternate
implementations, introduce a live model or real browser, or claim that all
combinations are compatible. Those belong to later focused plans.

## Baselines

| Role | First behavior | Boundary to preserve |
| --- | --- | --- |
| Planning | A deterministic, bounded planner that proposes one response step for a task. | It proposes work; Control still owns execution and continuation. |
| Computer Use | A scoped wrapper that observes, performs one supplied action through an injected environment, captures the result, and reports verification. | The host supplies the environment and calls Safety before acting. Tests use a controlled fixture, not a real desktop or browser. |
| Output Actions | Prepare a bounded text response, then deliver it through an injected host sink with an honest receipt. | Preparation has no side effect; delivery reports committed, rejected, or uncertain. Safety remains the caller's responsibility. |
| Observability | Append ordered protocol events to a run-scoped JSONL file with bounded module detail and explicit persistence status. | Buffered data must not be called durable. The host owns event IDs, ordering, exclusive writer ownership, and run lifecycle. |

## Implementation rules

- Keep each role's own lifecycle, configuration, errors, and result types. Do not
  add a shared `run(input) -> output` interface.
- Add behavior to each existing package and export it from that package's public
  entry point. Preserve independent package checks.
- Define the missing Output Actions sink seam in its own package contract before
  implementing delivery. Do not add a hidden dependency on the chat API.
- For Observability, use the host-supplied local run directory as the storage
  boundary. Retain duplicate, conflict, ordering, capacity, flush, and
  interruption behavior; document the single-writer and filesystem assumptions.
- Record integration gaps for the later kernel plan. In particular, the current
  Control contract has no Planning port, and the kernel does not yet create
  protocol events or select an Observability implementation.

## Completion checks

- [x] Each of the four packages exports one concrete baseline implementation and
      has behavior tests through its public API.
- [x] Tests cover normal behavior, invalid or bounded inputs, cancellation, and
      the role-specific failure or uncertainty paths that apply.
- [x] Package guides explain construction, configuration, state lifetime,
      side effects, error behavior, evidence, and limitations.
- [x] Each package builds, typechecks, and tests without starting Studio's API or
      browser.
- [x] The Studio program and this plan identify unresolved kernel connections and
      hand off full assembly work to a new focused plan.

## Progress

- [x] Planning: `single-step-response-planner@0.1.0` proposes one deterministic
      response step, validates its inputs and configured description limits, and
      reports source IDs. Its package typecheck passed and all 14 tests passed.
- [x] Computer Use: `scoped-computer-use@0.1.0` uses an injected environment to
      observe, perform one action, capture after state, and report verification.
      Its package typecheck passed and all 18 tests passed. Reviews caught
      pre-dispatch cancellation and concurrent quota races; preflight failures
      leave the quota available, concurrent calls cannot spend one slot twice,
      and scope keys distinguish missing IDs from literal IDs.
- [x] Output Actions: `text-output-actions@0.1.0` prepares bounded final text and
      passes it to an injected host sink. Its package typecheck passed and all 19
      tests passed.
- [x] Observability: `jsonl-observability-recorder@0.1.0` writes ordered
      run-scoped JSONL. It bounds event, buffer, tracking, and stored sizes;
      rejects symlinked paths; and uses file plus directory sync before a
      durable receipt. Recovery reconciles incomplete and uncertain writes. Its
      package typecheck passed and all 16 tests passed. One active writer per
      run is a host-enforced precondition.

## Sequence

1. [x] Implement and independently check the deterministic Planning baseline.
2. [x] Implement and independently check Computer Use against an injected controlled
   environment fixture.
3. [x] Add the explicit host-sink contract and implement Output Actions delivery.
4. [x] Implement an Observability baseline whose durability receipts match its
   storage behavior.
5. [x] Review the four package guides and contracts together; record the questions
   the kernel/reference assembly plan must answer.

## Validation

Run each package's own `typecheck` and `test` scripts after its implementation.
At the end, run all four package checks, `git diff --check`, and the documentation
generator if public documentation changed. Do not run a chat integration check as
evidence for standalone behavior.

## Handoff

Once these baselines pass, write a separate kernel/reference-assembly plan for the
first complete cycle. That plan must specify how Control invokes Planning, how
Computer Use receives Safety-approved actions, how final output reaches the host
sink, how the kernel creates and orders AgentEvents, and which run evidence is
transient or durable. The existing Studio chat and calculator round-trip remain
bounded integration probes, not proof that this general assembly exists.

The completed handoff is [Studio kernel and reference assembly](studio-kernel-reference-assembly.md).
