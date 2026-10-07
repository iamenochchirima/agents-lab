# Lina design document

The [Lina input architecture](input-design.md) is the single working document for
input decisions, proposed control behavior, open questions, and source references.
It accompanies the architecture workspace at `/studio/lina`.

Supporting research and review:

- [Input mechanism alternatives](input-mechanism-experiments.md) identifies
  small variation points, primary-source evidence, proposed experiments, and
  the correctness contracts needed before measuring performance.
- [Input architecture audit](input-architecture-audit.md) reviews the maintained
  decisions, map, and walkthroughs at `e3e3b44`, separates diagram findings from
  open decisions, and records verification limits.

These reports propose questions and repairs. They do not change the agreed
Input decisions or establish measured performance improvements.

Turn execution research, before the next block is finalized:

- [Comparative architecture research](turn-execution-research.md) compares
  ownership, model/tool rounds, controls, waiting and settlement, and proposes
  a responsibility boundary and mechanism experiments.
- Source studies: [Hermes](turn-execution-hermes.md),
  [OpenClaw](turn-execution-openclaw.md), [Pi](turn-execution-pi.md),
  and [Waku](turn-execution-waku.md). These use the explorer revisions,
  distinguish static evidence from inference, and record what remains unverified.

These turn execution notes are research proposals. They do not finalize the
next block or change Lina's agreed architecture.

- [Turn Execution completeness audit](turn-execution-completeness-audit.md)
  checks essential agent-loop and tool-lifecycle contracts against the pinned
  sources, records graph repairs, and distinguishes future Tools internals
  from the three currently simulated paths.

- [Node contracts and reference examples](node-contracts.md): precise provisional input/output contracts, multiple input forms and corrected handoffs.
