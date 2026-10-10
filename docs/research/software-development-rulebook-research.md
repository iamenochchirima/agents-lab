# Research for a personal software development rule book

Research date: 2026-10-10.

Scope: first-party engineering guidance that can inform a personal, cross-project
workflow for planning and delivering software. This is a research note, not a new
repository policy. Existing project instructions still govern work in each project.

Method: inspect official Google, GitLab, AWS, GOV.UK and Basecamp publications.
The source findings below describe their guidance. The proposed rules are a
synthesis for personal use, rather than claims that these organisations follow
one identical process. These sources are practitioner guidance, not controlled
evidence that one workflow always produces better results.

## Findings from primary sources

### Planning effort should follow uncertainty and impact

GitLab recommends its architecture workflow for cross-team work, substantial
operational impact, system stability concerns, new services and work spanning
multiple milestones. It excludes routine small changes and says familiar complex
work may not need the workflow. Its design documents can start with one paragraph,
change as engineers learn, and are explicitly not complete blueprints written
before implementation. The workflow asks authors to consider process cost against
benefit. [GitLab architecture design workflow](https://handbook.gitlab.com/handbook/engineering/architecture/workflow/)

Personal implication: require a short explanation of the goal and validation for
every task. Require a substantial plan when unfamiliarity, coordination,
irreversible effects or architectural impact justify it. Start useful exploration
without pretending that every implementation detail is settled.

### Discovery includes existing constraints and a reason to build

GOV.UK discovery investigates users, their wider journey, existing processes,
legacy technology and hard or changeable constraints. It asks teams to consider
alternatives to building a service and decide how success will be measured. It
allows stopping when discovery shows that proceeding is not worthwhile.
[GOV.UK discovery guidance](https://www.gov.uk/service-manual/agile-delivery/how-the-discovery-phase-works)

Google asks reviewers to inspect the surrounding file and system, rather than
judge isolated changed lines. It checks design fit, complexity, concurrent
behaviour, meaningful tests and documentation. Its warning against speculative
generality is useful when a plan starts designing capabilities that nobody needs
yet. [Google code review guidance](https://google.github.io/eng-practices/review/reviewer/looking-for.html)

Personal implication: before non-trivial changes, trace the actual execution path,
read existing contracts, tests and decisions, and reproduce current behaviour where
practical. Record discovered constraints with file or source links. A new module is
not automatically the right answer just because the task describes a new feature.

### Acceptance criteria describe outcomes

GOV.UK defines a user story around the actor, need and goal. Acceptance criteria
are outcomes that establish whether that need has been met, and can link to
supporting evidence. Large stories should be split when possible, with more detail
added when the team is ready to work on them.
[GOV.UK user stories and acceptance criteria](https://www.gov.uk/service-manual/agile-delivery/writing-user-stories)

Personal implication: translate requests into observable behaviour, including
important failure cases. Pair each criterion with a way to inspect it. Avoid
criteria such as "implement module X" when the actual need is that a user can
complete a task or recover from a failure.

### Resolve dangerous unknowns before committing the delivery scope

Basecamp's Shape Up guidance walks through use cases to find missing design,
technical assumptions and interdependencies. It recommends consulting technical
experts, checking feasibility within the available time, and declaring excluded
cases. The chapter acknowledges that unknowns remain after shaping.
[Shape Up: risks and rabbit holes](https://basecamp.com/shapeup/1.4-chapter-05)

GOV.UK alpha uses limited prototypes to test the riskiest assumptions. Teams do
not need to prototype the whole journey or produce production code; they should
expect to discard prototype code. Integration with existing technology can itself
be the assumption that needs testing.
[GOV.UK alpha guidance](https://www.gov.uk/service-manual/agile-delivery/how-the-alpha-phase-works)

Personal implication: when an unknown could invalidate the approach, run a bounded
spike with a question, evidence target and stopping condition. Record the result
and revise the plan before dependent implementation. Label disposable prototypes
so that an experiment does not silently become production infrastructure.

### Architectural decisions need reasons and consequences

AWS describes architectural decision records as records of significant choices
about structure, non-functional requirements, dependencies, interfaces and
construction techniques. Each record includes context, decision and consequences.
Accepted records remain historical records; a changed decision uses a new record
that supersedes the earlier one.
[AWS architectural decision record process](https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/adr-process.html)

Personal implication: record consequential choices separately from the changing
task checklist. Include alternatives, assumptions and what would make the choice
worth revisiting. Use a short note for local decisions; reserve an ADR for decisions
that future maintainers will otherwise have to rediscover.

### Interfaces must explain failures and effects

Amazon's retry guidance explains how a lost response can leave callers uncertain
whether a side effect succeeded. Caller request identifiers can establish retry
intent. Recording the identifier and executing the mutation must be atomic to
avoid a resource without its deduplication record, or the reverse. Reusing an
identifier with different parameters needs defined behaviour; the article uses a
validation error. It also acknowledges the cost of this stronger contract.
[Amazon Builders' Library: making retries safe](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)

Personal implication: for stateful or external operations, define inputs, outputs,
state ownership, persistence points, error categories, timeout and cancellation
behaviour, and retry or duplicate semantics before dependent work proceeds. Ask
what happens after the action succeeds but acknowledgement is lost. Avoid blanket
"exactly once" claims; describe the scope and mechanism of the actual guarantee.

### Plan changes that can be reviewed and leave the system working

Google defines a small change by conceptual focus, not a universal line limit.
It recommends planning how to split dependent changes before coding, including
related tests, keeping the system working after each submitted change, and showing
a use of a new API so that its contract can be assessed. Substantial refactoring
usually belongs in a separate change from behaviour changes.
[Google: small changes](https://google.github.io/eng-practices/review/developer/small-cls.html)

Personal implication: write implementation steps around reviewable behaviours and
explicit dependencies. Independent work can proceed in parallel once ownership
and contracts are clear. Splitting by file or by layer alone does not establish
independence or prove that the integrated feature works.

### Validation continues through release

Google SRE explains that canaries need representative traffic and observation
time. Metrics should indicate user-visible problems, distinguish the candidate
from its control and have sensible acceptance thresholds. Bad signals should
trigger a pause, rollback or investigation. Synthetic testing alone can miss
production state and traffic behaviour.
[Google SRE: canarying releases](https://sre.google/workbook/canarying-releases/)

Personal implication: define relevant checks before implementing, then preserve
the evidence. For operational changes, include deployment order, compatibility,
observation and a recovery path. A source-code rollback may not undo a data
migration or an external action; plan recovery for those effects explicitly.

## Suggested planning levels

This table is a personal synthesis, not a source organisation's mandated scale.

| Work | Minimum useful preparation | Reasons to increase preparation |
| --- | --- | --- |
| Small, familiar, reversible change | Goal, relevant context, intended change, acceptance check | Unexpected coupling, broken baseline, unclear requirement |
| Feature or substantial bug fix | Existing behaviour, scope and exclusions, acceptance criteria, relevant contracts, risks, steps and validation | Multiple components, parallel work, persistent state or external effects |
| Architecture, migration or consequential operation | Design note, alternatives and decisions, compatibility, state and failure lifecycle, staged execution, rollout and recovery | Unproven integrations, irreversible effects, security boundaries or operational uncertainty |
| Exploration | Question, assumptions, bounded experiment, evidence and decision to make afterward | Results show that broader design or user research is necessary |

## A reusable plan outline

Use only the sections that help resolve or communicate the task. A small change
may fit all relevant information into a few sentences.

1. State the problem, desired outcome, scope and exclusions.
2. Record the existing behaviour, relevant code and documentation, constraints and
   baseline validation. Distinguish observed facts from assumptions.
3. Write acceptance criteria and how each will be demonstrated.
4. Describe boundaries, interfaces and ownership. For relevant stateful work,
   include transitions, persistence, side effects and failure behaviour.
5. Compare consequential alternatives and record the chosen approach and reasons.
6. List dangerous unknowns and the smallest experiments that can settle them.
7. Divide delivery into reviewable steps with dependencies and integration points.
8. State validation, documentation changes and release or recovery requirements.
9. Keep a short record of discoveries and deviations. Update the plan when evidence
   changes a decision, and report the final behaviour and remaining limitations.

## Limits on transferring these practices

The source contexts differ. GOV.UK describes public service delivery; Basecamp
describes its product organisation and fixed time commitments; Google and AWS
describe engineering and operational concerns at large scale. Their phase lengths,
review structures and deployment machinery are not universal requirements.

The common lesson is to make uncertainty, intended outcomes and consequential
decisions explicit. These publications do not establish an optimal number of
planning documents, a universal planning duration or a requirement to finish all
design before writing code. A personal rule book should retain the practices that
help a contributor understand and verify the work, then adjust their depth to the
task and the project's own rules.
