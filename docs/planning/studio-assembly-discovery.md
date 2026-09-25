# Studio component assembly discovery

**Status:** Discussion, 2026-09-24

## Direction

Studio should be able to assemble a runnable agent from replaceable implementations
of its harness components. An assembly selects one implementation and its configuration
for each area. A contributor can replace a selected implementation, run the same
scenario, and inspect what changed while the other choices remain fixed.

Each area needs an interface suited to its responsibility. An implementation should
be buildable and testable through that interface. It may live in the Studio codebase,
a separate package, or a separate service when there is a reason for that boundary.
Packaging and deployment do not determine whether an implementation is replaceable.

| Area | Example replaceable implementation |
| --- | --- |
| Input / perception | Text and file input normalizer |
| Context | Sliding window or relevance ranked assembler |
| Planning | Plan first or interleaved planner |
| Memory | No memory, episodic store, or keyed facts |
| Tool use | Tool selection and execution policy |
| Computer use | Browser or desktop interaction implementation |
| Control | Sequential loop, state machine, or graph |
| Execution environment | Local process, container, or remote computer |
| Output / actions | Response and action executor |
| Safety | Action approval and checking policy |
| Model interface | Provider and routing implementation |
| Observability | Trace and metrics recorder |

Studio needs a small assembly core to resolve the selected implementations, check
that their requirements fit together, manage run lifecycle and cancellation, and
record the exact assembly in run evidence. Compatibility matters: for example,
a desktop computer-use implementation requires an environment that provides a
desktop. Context consumes selected Memory records, but Memory owns their persistence
and retrieval.

The assembly definition should identify each implementation, version, and
configuration. A component experiment changes one selected implementation or its
configuration while keeping the other selections and the scenario fixed. Evidence
should preserve common observations and useful implementation-specific detail so
that a comparison remains explainable.

## Still to explore

- The interface and lifecycle required for each area, especially stateful Memory,
  Control, and side-effecting actions.
- How assembly compatibility and optional capabilities are declared and checked.
- Which implementations should become separate packages or services, and when.
- How component-level checks and complete agent runs establish that a replacement
  actually works.

This note records a direction for discussion. It does not define the final contracts
or change the scope of an active implementation plan.
