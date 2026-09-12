# Agent Harness Lab — Development Rules

This repository is an open-source experimental laboratory for understanding AI agent harnesses. Work here must be deliberate, explainable, reproducible, and approachable to contributors who are learning the system.

These rules apply to the whole repository unless a more specific `AGENTS.md` in a subdirectory adds narrower guidance.

## Project priorities

In order of importance:

1. Preserve the scientific and architectural neutrality of the laboratory.
2. Make every important design decision understandable to a careful reader.
3. Keep experiments reproducible and their evidence inspectable.
4. Keep harnesses, scenarios, experiments, and infrastructure properly separated.
5. Prefer simple, explicit designs over abstractions added for appearance.
6. Keep the project welcoming and practical for external contributors.

The project is not intended to promote a particular framework or produce one universal winner. Unexpected results, limitations, and failed experiments are valuable evidence and must not be hidden.

## Before changing code

Before making a non-trivial change:

- Inspect the relevant files, tests, documentation, and neighbouring architecture.
- Identify which layer the change belongs to and avoid spreading framework-specific assumptions beyond that layer.
- State important assumptions in the design or implementation notes.
- Prefer a small, reviewable change over a speculative refactor.
- Do not introduce a general abstraction until at least two concrete uses justify it, unless the abstraction is required for a clearly documented boundary.
- Check for existing user changes and preserve work that is unrelated to the current task.

When a design choice is uncertain, record the alternatives, trade-offs, and reason for the choice rather than silently choosing one.

## Architectural boundaries

The repository should keep these concepts distinct wherever practical:

- **Harness:** how an agent is built and executed.
- **Scenario:** what the agent must accomplish.
- **Experiment:** what is being tested or learned.
- **Run:** one concrete execution of a harness × scenario × experiment combination.
- **Telemetry and metrics:** the evidence emitted by a run and the analysis derived from it.

Harness implementations should be isolated enough that framework-specific APIs, lifecycle assumptions, and state models do not leak into scenarios or the common experiment layer.

The architecture should also distinguish, where relevant:

- reasoning and agent orchestration
- durable execution
- state and memory
- tools and external integrations
- computer or filesystem environment
- model configuration
- observability

Technologies may be composed in layers. Do not represent layered combinations as mutually exclusive competitors unless the experiment explicitly requires that interpretation.

Common interfaces should describe genuine shared semantics, not force every framework into an artificial lowest common denominator. Preserve useful framework-specific behaviour and telemetry alongside normalized records.

## Documentation is part of the implementation

Documentation is a deliverable, not an afterthought. A change is incomplete when a reader cannot understand how to use it, why it exists, and what assumptions or limitations it has.

Update documentation when a change affects:

- public commands, configuration, interfaces, schemas, or file formats
- architecture or responsibility boundaries
- experiment methodology or interpretation
- failure behaviour, recovery, idempotency, or side effects
- local setup, infrastructure, dependencies, or deployment
- reproducibility or result collection

Use the appropriate document for the job:

- README: project orientation and a concise getting-started path.
- Guides: task-oriented instructions for users and contributors.
- Architecture documentation: component responsibilities, boundaries, data flow, and lifecycle.
- Experiment documentation: hypothesis, variables, controls, procedure, expected observations, and limitations.
- ADRs or decision records: important choices, alternatives considered, and consequences.
- Code documentation: local contracts, invariants, edge cases, and non-obvious reasons.

Write for a technically capable contributor who has not seen the code before. Explain terminology when it is project-specific. Include runnable examples where they reduce ambiguity. Keep documentation near the code or experiment it describes, while maintaining a clear index from the main documentation entry points.

Never claim that an experiment proves more than it measures. Clearly separate observed results, interpretation, assumptions, and open questions.

## Comments and code explanation

Comments should explain information that is not obvious from the code, especially:

- why a design or ordering constraint exists
- invariants that must remain true
- failure and recovery semantics
- idempotency requirements and side-effect boundaries
- compatibility workarounds and their removal conditions
- experiment controls or deliberately unusual behaviour
- security, isolation, or resource-limit decisions

Do not use comments to restate what straightforward code already says. Prefer clear names, small functions, and explicit types first. Keep comments accurate as part of the change; stale comments are defects.

Public modules, interfaces, schemas, commands, and non-trivial algorithms should have focused documentation or docstrings. Include a short example when the correct usage is not obvious. Document error behaviour and lifecycle expectations, not only the happy path.

## Experiments and reproducibility

Every experiment should make its hypothesis and comparison meaningful. Record, at minimum, the harness and version, scenario, experiment, model and parameters, tool configuration, context and memory strategies, environment, failure injection, timestamps, and random seeds where applicable.

Runs should produce durable evidence in a standardized structure such as:

```text
runs/<run-id>/
  config.json
  events.jsonl
  trajectory.json
  metrics.json
  result.json
  logs/
  artifacts/
```

Do not silently discard framework-specific telemetry or useful diagnostic data. Normalize common events while retaining the original detail needed to understand what happened.

Separate model quality from harness quality. Keep controls, prompts, model settings, tool behaviour, and infrastructure conditions explicit. Avoid optimizations that make one implementation look better without applying the same experimental standard to comparable implementations.

Failure injection is a first-class capability. Prefer deterministic or seeded failures and record when, where, and why a failure was injected. Test crashes before and after persistence and side effects, duplicate events, retries, timeouts, restarts, and interrupted external calls where those behaviours are relevant.

## Reliability and side effects

For any stateful or side-effecting code, make the lifecycle explicit:

- What can be retried?
- What can be duplicated?
- What must be idempotent?
- What is persisted, and when?
- What happens if acknowledgement is lost after an external operation succeeds?
- What state is safe to use after restart or resumption?
- How is cancellation handled?

Do not describe behaviour as exactly-once unless the implementation and experiment establish the precise guarantee. Prefer explicit at-least-once or at-most-once semantics plus idempotency where appropriate.

## Testing and validation

Tests should cover meaningful behaviour rather than merely increasing line coverage. Add or update tests for:

- normal completion
- invalid inputs and important error paths
- retries, restart, recovery, and cancellation
- duplicate or out-of-order events
- persistence and resumption
- failure injection
- telemetry and execution records
- deterministic reproducibility
- public examples and documented commands where practical

Run the narrowest relevant checks first, then the broader suite when the change warrants it. Report what was run and any limitations. Never weaken a test or hide an error solely to make a benchmark pass.

## Dependencies and infrastructure

Keep dependencies minimal and purposeful. Before adding one, document why the standard library or an existing dependency is insufficient, what operational burden it adds, and how it affects reproducibility and local development.

Infrastructure requirements must be explicit. A contributor should be able to tell which services are required, which are optional, how to run them locally, and what the experiment does when a service is unavailable.

Do not commit secrets, credentials, personal data, generated machine-specific state, or unreviewed large artifacts. Use safe fixtures and clearly fake credentials in tests.

## Open-source contributor experience

Use consistent naming, predictable file locations, readable control flow, and focused modules. Prefer errors that explain what failed and how a contributor can diagnose it.

Public-facing changes should include enough context for review: purpose, scope, design, trade-offs, tests, documentation updates, and known limitations. Keep commits and pull requests focused when possible.

Examples should be runnable or explicitly labelled as pseudocode. Avoid relying on undocumented local paths, private services, or personal configuration.

## Change checklist

Before considering a substantial change complete, verify:

- The change has a clear purpose and belongs to the correct architectural layer.
- Existing boundaries between harness, scenario, experiment, run records, and telemetry remain understandable.
- Non-obvious decisions, invariants, and failure semantics are documented.
- Relevant tests and failure cases exist.
- Reproducibility metadata and evidence are preserved where applicable.
- User-facing documentation and examples match the implementation.
- Framework-specific behaviour has not been erased merely to simplify normalization.
- No secrets, unexplained generated files, or accidental unrelated changes were introduced.
- Validation results and known limitations are recorded for reviewers.

When these rules conflict with an explicit task requirement, follow the task but document the exception and its consequences.
