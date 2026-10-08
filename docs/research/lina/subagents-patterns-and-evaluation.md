# Subagent patterns and evaluation

Research date: 2026-10-08. Primary-source reading; no execution benchmark or graph
implementation. The [Lina proposal](subagents-research.md) combines this evidence
with the inspected Hermes/OpenClaw and Pi/Waku implementations.

## Distinguish control from scheduling

A supervisor keeps responsibility for a task and invokes workers as tools. A
handoff transfers conversational control to another agent. A graph can express
either, or a fixed workflow. These are different policies rather than different
names for one subagent mechanism. LangChain documents both supervisor tool calls
and state-driven handoffs; Microsoft separately lists sequential, concurrent,
handoff, group-chat and manager-driven orchestration.
[LangChain handoffs](https://docs.langchain.com/oss/python/langchain/multi-agent/handoffs),
[Microsoft orchestration](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/).

LangChain's subagent guide distinguishes blocking calls from background jobs and
tool-per-agent from a single dispatch tool. Its background example uses start,
status and result operations. A supervisor can call workers in parallel. Selected
inputs and returned outputs determine what crosses the context boundary. The
main agent remains responsible for combining results.
[LangChain subagents](https://docs.langchain.com/oss/python/langchain/multi-agent/subagents).

**Lina inference:** model-led delegation can use one registered operation without
requiring a separate orchestration LLM. Internally, each child should have a
handle and status. Whether the original operation awaits a child result or
returns an accepted handle is a separate, explicit delivery contract. Running a
child in another execution instance does not automatically detach it from its
parent's cancellation or budget ownership.

## Context is configurable; isolation has several meanings

Deep Agents documents isolated task context and forked parent context. Its tool
configuration can inherit parent tools or explicitly replace them. Forking changes
the input history and can preserve a prompt-cache prefix; it is not a guarantee of
filesystem, permission or memory isolation. The reference marks fork mode
experimental.
[Deep Agents subagents](https://docs.langchain.com/oss/python/deepagents/subagents),
[create_deep_agent reference](https://reference.langchain.com/python/deepagents/graph/create_deep_agent).

Claude Code documents agent-specific tools, models, permission modes, skills,
memory and environment isolation configuration. Foreground/background behavior
and effective tools differ by mode. Background permission requests can reach the
main session; child permission behavior depends on the parent's mode and version.
These are documented product semantics, not a verified implementation of every
internal mechanism.
[Claude Code subagents](https://code.claude.com/docs/en/sub-agents).

**Lina inference:** record effective configuration rather than only the requested
profile. Keep history selection, Memory namespaces, tool exposure, operation
permission, credential references and Environment access separate. A fresh
conversation can still share a project directory. A permitted memory namespace
does not imply permission to read its backing file through a filesystem tool.
Actual Environment enforcement needs its own implementation.

## Fresh history does not prohibit recovery

LangGraph distinguishes per-invocation state, persistent per-thread state and no
checkpointing. Per-invocation children can start with fresh history while retaining
checkpoints for that invocation and supporting interrupts. Reusing persistent
thread state concurrently can conflict. Nested state inspection depends on how
the subgraph is invoked: tool indirection may hide it from static graph inspection.
[LangGraph subgraphs](https://docs.langchain.com/oss/python/langgraph/use-subgraphs).

**Lina inference:** keep a child task's transcript/checkpoint identity distinct
from long-term Memory. A resumed child is the same invocation, not a new child
with the same description. Explicit task IDs, launch IDs and instance-tagged
events should make it possible to inspect child paths on the shared graph.
Uncertain startup cannot authorize a new child launch without reconciliation.

## Why multiple agents, and when fewer are better

Anthropic describes an orchestrator-workers workflow where a model chooses
subtasks dynamically. It distinguishes this from predetermined parallel work.
Its guidance favors simple workflows where they suffice and evaluates added
complexity against the task.
[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents).

Anthropic's research-system report describes a lead agent, independent workers,
bounded task descriptions and output expectations. It reports substantial gains
on its own research evaluation, greater token use than single-agent chat, and
coordination/reliability difficulties. It also discusses synchronous result
collection as a limitation. Those observations concern that system and workload;
they do not establish that subagents improve every agent task.
[Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system).

**Lina inference:** retain a no-delegation control. Favor independent subtasks
when demonstrating parallel children; dependent shared edits should be ordered or
isolated under explicit Environment rules. Parent synthesis uses the normal
parent model loop. Returning a result is not proof that its claims are correct.

## Engineering requirements versus experiment variables

These are proposed baseline invariants, not competing quality strategies:

- Keep parent request, child identity, launch attempt and result identity correlated.
- Enforce effective access and configured depth/concurrency/resource limits.
- Distinguish accepted, running, waiting and terminal child states.
- Preserve successful siblings when one child fails; retain unresolved effects.
- Treat cancellation as a request until settlement is observed.
- Route results to their original parent operation; do not send child answers as
  user replies or promote them to instructions or persistent Memory automatically.
- Keep per-agent traces and accounting distinct; aggregate them without double
  counting, and preserve raw observations.

Meaningful comparison variables include:

| Variable | Compare | Necessary control |
| --- | --- | --- |
| Delegation decision | Parent model, fixed workflow, trusted rule | Same task, capabilities and model configuration; record why each delegation occurred |
| Task division | One worker, multiple independent workers, sequential dependency chain | Same overall objective and available evidence |
| Context handoff | Task only, selected evidence, permitted parent fork | Same source access and trust labels; measure preparation and repeated discovery cost |
| Worker specialization | General-purpose versus configured specialist | Record prompt/tool differences; avoid attributing those differences solely to topology |
| Result representation | Bounded summary, structured findings with artifact references, selected transcript | Same underlying evidence and explicit output budget |
| Parent scheduling | Await result, continue independent work then join, explicitly detached work | Same required results; include coordination and completion latency |
| Model allocation | Parent/child same model versus configured mix | Report each model, parameters and cumulative usage separately |
| Coordination policy | Independent workers versus bounded feedback or review | Record messages, rounds and extra cost; do not call all extra output an improvement |

For runtime experiments, measure task success with independent grading, evidence
coverage, failures/duplication, end-to-end latency, provider-reported usage and
cost, Context growth and delegation overhead. Report unavailable usage rather
than inventing it. Keep tools, scenario, environment, source access, prompts,
limits and seeds explicit; repeated runs are needed for model variance.

Studio fixtures can establish routing and lifecycle behavior. They cannot measure
model quality, speedup, cost savings, durability or sandbox guarantees. Define
the paths now, then run controlled experiments when executable harnesses exist.
