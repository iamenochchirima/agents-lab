# Implementation plan template

Copy this file into `active/` and rename it for the implementation slice. Replace every
`[placeholder]`, including example links. Remove sections that are truly irrelevant only
after writing `Not applicable — [reason]`; do not silently omit failure semantics for
stateful, networked, or side-effecting work.

**Created:** `[YYYY-MM-DDTHH:MM:SS±HH:MM]`
**Last updated:** `[YYYY-MM-DDTHH:MM:SS±HH:MM]`
**Status:** Active
**Owner:** `[person or team, if useful]`

## Start here

Read these before changing code:

- `[link to repository-root AGENTS.md]`
- `[relevant architecture or ownership document]`
- `[relevant implementation directory README]`
- `[relevant test or contract documentation]`

Optional references, if they help answer a specific design question:

- `[reference harness map or upstream documentation]`

These references are inspiration, not requirements. State which existing decisions this
plan must preserve: `[boundaries, terminology, compatibility constraints]`.

## Purpose

[One short paragraph: the engineering outcome, why it matters, and the question it lets
the Lab answer.]

## Definition of done

[Describe the exact command or user flow that works when this slice is finished. Include
what a contributor can inspect to verify it is real rather than simulated.]

```text
[input] → [system boundary] → [real work] → [observable result/evidence]
```

## Scope

- [ ] [concrete deliverable]
- [ ] [concrete deliverable]
- [ ] [concrete deliverable]

## Explicitly out of scope

- [feature deliberately deferred]
- [feature deliberately deferred]

Do not add partial versions of deferred work merely to make the implementation look more
complete.

## Finished behaviour

### User-visible behaviour

[What a user, API client, or operator sees on success, failure, cancellation, and restart.]

### Ownership and boundaries

```text
[interface or component]  → [owns]
[runtime or worker]       → [owns]
[persistence/evidence]    → [owns]
```

State explicitly:

- Which module is the sole writer for each durable record.
- Which module owns in-flight execution.
- Which module may read or expose data to a user.
- Which dependencies and framework APIs must remain local to a platform boundary.

## State, persistence, and evidence

Not applicable — `[reason]`; **or** define the following.

```text
[durable-root]/[entity-id]/
  [file]  # owner, write timing, retention purpose
```

- [ ] Every record has an identity and clear cardinality: per `[run/session/turn/request]`.
- [ ] Write order and atomicity are defined.
- [ ] Retention, redaction, and safe inspection rules are defined.
- [ ] A restart/reconciliation path is defined for incomplete records.
- [ ] Metrics, trajectory, artifacts, and native-framework evidence are included or
      explicitly deferred with a reason.

## Failure, retry, and recovery semantics

Not applicable — `[reason]`; **or** answer every question below.

- [ ] What may be retried, and with which limit/backoff?
- [ ] What proves an external request was not sent?
- [ ] What happens after an ambiguous timeout, lost acknowledgement, or process crash?
- [ ] Which action is idempotent, and what is its idempotency key or deduplication rule?
- [ ] What happens on cancellation?
- [ ] What happens when a worker, server, or dependency restarts?
- [ ] How are duplicate, out-of-order, or orphaned events/executions handled?
- [ ] Which outcome is reported when the real external outcome is unknown?

Never call a behaviour exactly-once unless the implementation and tests establish the
precise guarantee.

## Security and configuration

Not applicable — `[reason]`; **or** define:

- [ ] configuration source, validation, and safe defaults
- [ ] credential/secrets handling and redaction boundaries
- [ ] permissions, approval, isolation, or resource limits where relevant
- [ ] local-development configuration and unavailable-dependency behaviour

## Implementation checklist

### 1. Contracts and configuration

- [ ] [types, schemas, public interfaces, validation]
- [ ] [configuration/defaults]

### 2. Core implementation

- [ ] [first implementation step]
- [ ] [second implementation step]

### 3. Integration and user surface

- [ ] [API, CLI, UI, worker, or integration work]
- [ ] [observable status/result behaviour]

### 4. Documentation and learning material

- [ ] [architecture/ownership document]
- [ ] [local run guide or example]
- [ ] [playground or inspection procedure, if useful]

## Test coverage

### Unit tests

- [ ] normal state transitions and output shape
- [ ] invalid input and configuration failures
- [ ] serialization, redaction, and public contract rules
- [ ] retry/idempotency rules, if applicable

### Integration tests

- [ ] real local dependency path, using deterministic fixtures where possible
- [ ] failure and timeout path
- [ ] cancellation path
- [ ] restart/recovery and evidence reconciliation path
- [ ] duplicate, ambiguous, or out-of-order path when relevant

### Manual acceptance checks

- [ ] [successful end-to-end flow]
- [ ] [failure/recovery flow]
- [ ] inspect `[specific evidence, logs, artifacts, or UI state]`
- [ ] verify no secret or unsafe data was retained

## Required validation commands

```bash
[exact narrow checks]
[exact integration checks]
[exact build/typecheck]
git diff --check
```

State any expected warning, external prerequisite, or deliberately unavailable test
profile here: `[details]`.

## Completion gate

Before moving this plan to `completed/`, verify:

- [ ] Every applicable implementation and test checkbox is complete.
- [ ] The finished behaviour is real and inspectable, not simulated.
- [ ] Failure, retry, cancellation, and recovery semantics are implemented and tested.
- [ ] Documentation and examples match the implementation.
- [ ] Required validation commands passed.

## Commit discipline and handoff

- [ ] Divide implementation into reviewable commits as coherent sections become complete;
      for example contracts, a persistence/runtime boundary, a user surface, or docs.
- [ ] Before each commit, run the narrow validation relevant to that section and include
      its tests and documentation when they belong to the same change.
- [ ] Do not combine unrelated completed sections into one large end-of-plan commit.
- [ ] Review `git status` and each diff; preserve unrelated user changes.
- [ ] Record changed files, validation results, and known limitations in the handoff.
- [ ] Record all implementation commit hashes, or their contiguous range, in the completion
      record. If commits are deliberately deferred, record why.

## Completion record

Complete this section only when archiving the plan.

**Completed:** `[YYYY-MM-DDTHH:MM:SS±HH:MM]`
**Commits:** `[commit hashes or contiguous range]`

### Validation

- `[command]` — `[passed/failed and concise result]`
- `[manual check]` — `[what was observed]`

### Known limitations

- `[deliberate limitation or follow-up]`

### Historical-scope note

[If later architecture changes make terminology or scope outdated, explain that the plan
records the decision at its completion time and link to the current source of truth.]
