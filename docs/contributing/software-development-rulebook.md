# Personal software development rulebook

Status: proposed cross-project workflow, not an automatically adopted repository policy.
Researched: 2026-10-10. These rules are a practical synthesis of the linked practices,
not a claim that every engineering team follows the same process.

## Governing rule

Before substantive implementation, understand the problem, inspect the existing system,
define success, investigate consequential unknowns, and write a proportionate plan.
Plan the whole outcome; detail the next implementable slice. Revise the plan when
research or working code provides better evidence.

## Scale the preparation

| Change | Preparation |
| --- | --- |
| Small, familiar, reversible fix | A short issue or task note: problem, affected behavior, approach, verification |
| Feature or unfamiliar integration | A design and checklist covering user flow, ownership, contracts, risks, slices and validation |
| New project, major migration, security-sensitive or costly change | Add alternatives, risk investigations, data lifecycle, compatibility, deployment and recovery decisions |

Do not repeat research already supported by current project evidence. Reverify facts
that might have changed. Do not require a formal design document for trivial edits.
GitLab explicitly weighs architecture-process cost against benefit and lists situations
where a lightweight process is sufficient. [GitLab architecture workflow](https://handbook.gitlab.com/handbook/engineering/architecture/workflow/)

## Before implementation

- [ ] **Define the problem.** Name the user, their task, current difficulty and intended
  improvement. Distinguish a requested solution from the problem it is meant to solve.
  Write what is out of scope. Discovery should establish the problem and constraints
  before committing to a solution. [GOV.UK discovery](https://www.gov.uk/service-manual/agile-delivery/how-the-discovery-phase-works)
- [ ] **Inspect what exists.** Read relevant instructions, code, tests, docs and decision
  records. Run the affected user path where practical. Identify actual ownership,
  dependencies, existing changes and reusable components. Record observed behavior
  separately from assumptions. This is a recommended application of discovery to an
  existing codebase, not a prescribed corporate checklist.
- [ ] **Define observable success.** Write acceptance criteria before tasks. Include the
  important normal, empty, invalid and failure states. If making a performance claim,
  identify the baseline, measurement and acceptable result. Use criteria that can be
  checked through the real interface, not only implementation details. GOV.UK defines
  acceptance criteria as outcomes and connects them to supporting evidence.
  [GOV.UK user stories](https://www.gov.uk/service-manual/agile-delivery/writing-user-stories)
- [ ] **Research the consequential unknowns.** Use official docs, source code, standards
  or direct experiments. For important decisions, compare credible alternatives and
  their trade-offs. Investigate blockers with a bounded prototype or technical spike;
  state the question and stopping condition. Basecamp's shaping process searches for
  technical unknowns and misunderstood dependencies before commitment.
  [Shape Up risks](https://basecamp.com/shapeup/1.4-chapter-05)
- [ ] **Sketch the user experience and system flow.** For a UI, cover navigation, loading,
  error, empty and interrupted states. For backend work, identify who calls whom, who
  owns state, and what crosses each boundary. Use a small sketch or prototype where
  it resolves uncertainty. Do not decide every file or visual detail upfront.
  [Shape Up design techniques](https://basecamp.com/shapeup/1.3-chapter-04)
- [ ] **Address relevant lifecycle and trust concerns.** For persistent or side-effecting
  work, decide what happens on retries, duplicate requests, cancellation, restart and
  partial success. Identify credentials, private data, permissions and external inputs.
  Do not defer basic protection until after real data or effects are involved. NIST
  recommends incorporating secure development practices into the lifecycle.
  [NIST SSDF](https://www.nist.gov/publications/secure-software-development-framework-ssdf-version-11-recommendations-mitigating-risk)
- [ ] **Record significant decisions.** Write the context, choice, alternatives and
  consequences. Use a short decision record for choices that would otherwise be
  expensive to reconstruct. Preserve superseded decisions when the direction changes.
  [AWS decision records](https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/adr-process.html)
- [ ] **Write an executable checklist.** Break work into small slices with clear outcomes,
  dependencies, verification and documentation tasks. Detail the next slice and leave
  later assumptions visible. Identify any migration, compatibility or rollout work.
  Keep scope within an explicit effort budget. [Shape Up boundaries](https://basecamp.com/shapeup/1.2-chapter-03)

## Ready to start

Start when the next slice has a clear purpose, plausible design, inspectable result and
verification path, and no unresolved uncertainty likely to invalidate it. Unknowns in
later slices may remain documented. Investigation code can come before a settled
implementation plan when its purpose is to answer a design question.

## During implementation

- [ ] Build small, reviewable changes and integrate regularly. Avoid combining unrelated
  cleanup with a feature. Google explains why small changes are easier to review and
  reason about; continuous integration detects incompatibilities earlier.
  [Google small changes](https://google.github.io/eng-practices/review/developer/small-cls.html),
  [Continuous integration](https://martinfowler.com/articles/continuousIntegration.html)
- [ ] Update the plan when evidence changes it. Notify the user about material scope,
  behavior or architecture changes; ask for decisions only when needed. Keep code,
  relevant contracts and design docs aligned. Never force code to preserve an inaccurate
  diagram or create one module per diagram node.
- [ ] Verify component connections through the real entry point. Use focused automated
  tests for important behavior and regression risks, and direct user-path checks where
  needed. Review design, complexity, tests and documentation, not just syntax.
  [Google review guidance](https://github.com/google/eng-practices/blob/master/review/index.md)
- [ ] Capture enough evidence to diagnose the change. Keep optional telemetry separate
  from execution, avoid exposing sensitive content, and make performance measurements
  reflect the actual configuration. These are recommendations for this rulebook,
  especially for agent-assisted development.

## Before completion and after release

- [ ] Check acceptance criteria against working behavior, not merely checked tasks.
  Report what was tested, what remains unimplemented and any material limitations.
- [ ] Review the diff for accidental changes, secrets, unnecessary dependencies and
  unmaintainable complexity. Update commands and documentation to match reality.
- [ ] For deployed or stateful changes, know how to enable, disable or recover them.
  Use backups, migration rehearsal or gradual rollout where the consequences justify
  them. A rollback must account for data and external effects, not just old code.
- [ ] Observe the released behavior with relevant signals and defined failure criteria.
  Google SRE describes canaries that evaluate a limited deployment before broader
  rollout. Adopt that technique when deployment risk warrants it, not for every local
  prototype. [Google SRE canary releases](https://sre.google/workbook/canarying-releases/)
- [ ] Record unexpected findings and follow-up work. Remove temporary scaffolding when
  its purpose is finished. Feed lessons back into the plan and project rules.

## Minimal plan template

1. Problem, user and intended outcome
2. Scope and non-goals
3. Existing behavior and relevant owners
4. Acceptance criteria
5. Research, alternatives, assumptions and open questions
6. Proposed flow, boundaries and relevant lifecycle behavior
7. Ordered implementation slices with checklist items
8. Verification and inspection method
9. Migration, rollout and recovery, when applicable
10. Documentation and completion evidence

A plan is ready when it enables the next correct change. Its length is not evidence
of its quality. The recurring upfront effort should remove ambiguity and expensive
risks, rather than predict every implementation detail.
