# Runner

Owns run lifecycle orchestration, resolution of the selected harness configuration,
execution-mode selection, cancellation, supervision, and handoff to the runnable
harness.

The runner coordinates work. It does not implement the agent's reasoning loop.
