# Context Stress scenario

The `context-stress` scenario provides a small, deterministic conversation history
for inspecting how Context policies select prior messages. Its first fixture is
`old-important-fact`, data version `1`, exported by the workspace package
`@agent-harness-lab/scenario-context-stress@0.1.0`.

## Workload

The fixed task asks which food preference was stated for future meal suggestions.
The six prior messages are ordered by `sequence` and use stable IDs from
`old-important-fact:history:0` through `old-important-fact:history:5`. Sequence 0
contains the preference, sequence 1 acknowledges it, and sequences 2–5 describe
unrelated garden and desk-light details with brief acknowledgements. The task ID is
`old-important-fact:task:v1`.

The task and prior messages are plain JSON-safe data. Each prior record contains
`sourceId`, `role`, `content`, and `sequence`; the fixture contains the scenario ID,
fixture ID and version, task, and ordered prior messages. The package has no runtime
dependencies and does not import Studio modules, an experiment, or a platform.

## Inputs and expected artifacts

The fixture is the complete scenario input: one task and six prior messages. It
requires no live service, tool, credential, random seed, or environment capability.
Consumers adapt its neutral records to their own input contract and preserve the
stable source IDs and ordering.

The scenario does not define an answer grader. A Context-retention experiment may
record which source IDs were included or omitted, but that selection evidence does
not establish whether an agent can answer the task from the retained material.

## Controls and limits

All content is synthetic. The fixture intentionally places the requested preference
before unrelated later details so a bounded recent-message policy can omit it. The
fixture alone does not prescribe a Context policy, token budget, model, comparison
procedure, or expected policy winner; those belong to an experiment.

See `lab/experiments/context-retention/README.md` for the first comparison procedure
and its fixed controls.
