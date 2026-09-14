# Documentation guide

Documentation is part of an implementation. Write it for a technically capable
reader who has not seen the code or the experiment before.

## Where information belongs

| Need | Home |
| --- | --- |
| Project orientation and first reading path | `docs/` curated pages and root README |
| Stable boundaries, lifecycle, data flow, and diagrams | `docs/architecture/` |
| A platform variant's implementation decisions | Its `server/src/platforms/<platform>/variants/<variant>/README.md` and curated platform page when usable |
| A scenario's goal and grading rules | `lab/scenarios/<scenario>/README.md` |
| An experiment's hypothesis and procedure | `lab/experiments/<experiment>/README.md` |
| A decision and its alternatives | `docs/adr/` |
| Local contract, invariant, ordering, or recovery rule | Code docstring or focused comment beside the code |
| Working study notes and temporary mental models | `docs/research/` or **Initial development** |

Do not put every local `README.md` into the curated docs sidebar. The
Repository Map exists to expose repository-local notes without making them look
like finished product documentation.

## Required content for a platform variant

Document the variant's execution model, instructions and context sources, tools,
state and persistence, durability and recovery semantics, environment,
permissions, telemetry mapping, local setup, limitations, and validation.

State what is absent. Do not claim durable execution, idempotency, or exactly
once behaviour unless the implementation and experiment establish it.

## Required content for scenarios and experiments

A scenario documents its goal, inputs, fixtures, expected artifacts, grader,
and controls. An experiment documents its hypothesis, changed variable, failure
injection, procedure, recorded evidence, and limits on interpretation.

Keep observed results separate from the explanation of those results.

## Diagrams

Use a diagram when it clarifies ownership, state, or a multi-step interaction.
Keep the main diagram small. Add a focused sequence, state, or context diagram
when one view cannot explain the behaviour clearly. Every box and arrow must
have a real owner in code or configuration.

## Before review

Check that commands, schemas, paths, and examples match the implementation.
Update the relevant architecture, platform, scenario, experiment, or local-code
documentation in the same change. Run the documentation generator and the
narrowest relevant validation.
