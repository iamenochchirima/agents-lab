# Development playground

The development playground is a hands-on inspection environment for Agent Harness Lab.
Each playground slice isolates one small implementation concept so a maintainer can run
the real code path, inspect what happens, and deliberately change conditions while
learning the system.

This is not the automated test suite, a benchmark scenario, or an experiment. It is a
developer-facing learning bench that may be removed, reorganized, or converted into
contributor documentation as the project matures.

## What belongs here

A playground slice should focus on one question that is useful to observe directly.
Examples include:

- how a standalone tool-using turn moves from context construction to a final result
- what a model request contains after instructions, skills, and memory are assembled
- how tool policy validation changes a requested action
- what is persisted before and after a checkpoint or an injected failure
- how a retry behaves after a controlled timeout

Each slice must exercise production implementation code at its relevant boundaries. A
deterministic fake model, tool, clock, or external service is encouraged when it makes
the walkthrough reproducible; the fake must sit behind the same adapter boundary used
by the real dependency.

## What does not belong here

- Regression assertions that must run in continuous integration: put those in `tests/`.
- Reusable agent workloads: put those in `lab/scenarios/`.
- Controlled, comparable hypotheses or fault studies: put those in `lab/experiments/`.
- Production modules that lack a proper platform, environment, or shared-package home.
- Secrets, personal data, live production credentials, or unbounded generated output.

The playground may help design all of those things, but it does not replace them and
does not produce evidence for published comparisons.

## Slice structure

Create one directory per learning slice. Start from
[`template/`](template/) and keep the scope narrow.

```text
development/playground/<slice-name>/
  README.md       # Question, setup, expected observations, and limits
  run.ts          # Explicit local walkthrough; added when implementation exists
  fixtures/       # Deterministic inputs, fake services, or workspace files
  notes.md        # Maintainer observations, questions, and content ideas
```

The first slice is `computer-native-terminal-turn`. It makes one text-only terminal turn
observable from input through persisted session evidence. A later tool-loop slice can
build on the same playground conventions once the Computer Native terminal lifecycle is
stable.

## Expectations for every slice

- State the exact question the slice is intended to answer.
- Use a readable, explicit entry command; avoid hidden setup.
- Show a concise terminal timeline and preserve the underlying run evidence.
- Explain what to inspect: resolved configuration, constructed context, model and tool
  requests, state transitions, events, artifacts, and final result as appropriate.
- State which dependencies are fake, which are real, and why.
- Keep fixtures deterministic by default. A live-model mode must be opt-in and must
  record its model configuration and cost-relevant metadata.
- Record observations separately from facts established by tests or experiments.

## Relationship to formal validation

When a playground exposes meaningful expected behavior, add the corresponding automated
tests in the appropriate `tests/` location. When it becomes a reusable workload, a
failure study, or contributor-facing guide, promote it deliberately rather than quietly
depending on the playground forever.
