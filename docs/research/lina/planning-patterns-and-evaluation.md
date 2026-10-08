# Lina planning patterns and evaluation

Researched on 2026-10-08. This note compares published mechanisms and proposes
boundaries for Lina's Studio design. It does not claim benchmark results for Lina
or authorize implementation. Reference-agent source audits are separate notes.

## What planning can mean

These responsibilities should remain distinguishable:

| Responsibility | Meaning in Lina | Owner |
| --- | --- | --- |
| Model reasoning | The model decides how to approach a problem internally | Model Interface and Turn Execution |
| Explicit plan | Inspectable goals, steps, dependencies and progress | Planning |
| Task tracking | Record declared progress and observed execution evidence | Planning, persisted through State |
| Readiness and selection | Identify eligible work and select a next step | Planning policy; admission remains with execution owners |
| Tool scheduling | Execute admitted calls with dependencies, capacity and cancellation rules | Tools |
| Child scheduling | Start and control admitted child tasks | Subagents |
| Project task queue | Schedule independent user jobs across conversations | A separate service concern, not a step list |

A task list can assist a normal tool-calling loop without replacing that loop.
A plan-and-execute controller makes a stronger commitment: it directs execution
from an explicit plan. Those mechanisms can share records but should have different
control modes. A task marked completed by a model is a declaration. Evidence from
a successful tool or child operation can support it, and a scenario grader is still
needed to establish whether the user's objective was achieved.

## Established approaches

### ReAct and reactive task tracking

ReAct interleaves reasoning, actions and observations. Its reasoning can update a
plan as new observations arrive; an external dependency graph is not required.
The paper evaluates question answering, fact verification and interactive tasks.
It does not establish that one reactive loop is best for every workload.
[ReAct paper](https://arxiv.org/abs/2210.03629)

For Lina, an explicit checklist can accompany the existing reactive loop. The model
updates the plan through a registered tool, then continues choosing actions through
Turn Execution. Displaying a checklist must not silently turn it into a scheduler.
Modern batched tool calling also means Lina need not reproduce the original paper's
single-action prompt format to study a reactive approach.

### Plan-and-Solve

Plan-and-Solve first asks a model to decompose a problem and then solve it using
that plan. PS+ adds more detailed instructions. The paper studies zero-shot
reasoning on ten datasets with GPT-3, including mathematical reasoning. It is a
prompting method, not a durable task store or a production tool scheduler.
[Plan-and-Solve paper](https://arxiv.org/abs/2305.04091)

The useful Lina seam is whether to request decomposition before execution. It does
not justify adding a compulsory planner call to every input, or assuming that an
initial plan remains correct after tool observations.

### Plan-and-execute with replanning

LangChain's historical implementation separates a planner, an executor and a
replanner. The executor operates on a plan step. The replanner receives the progress
and decides to return an answer or produce further work.
[LangChain architecture description](https://www.langchain.com/blog/planning-agents)

The pinned tutorial stores input, an ordered list of plan strings, accumulated
past-step results and a response. Its executor takes the first step and runs an
agent. Its replanner returns either new steps or a response. A graph routes that
decision back to execution or to completion, with a recursion limit in the example.
This is an illustrative serial architecture, not evidence of dependency-aware
parallel scheduling or crash-safe side effects.
[Pinned tutorial source](https://raw.githubusercontent.com/langchain-ai/langgraph/23961cff61a42b52525f3b20b4094d8d2fba1744/docs/docs/tutorials/plan-and-execute/plan-and-execute.ipynb)

The old example directory now says it is archival. Treat the pinned tutorial as a
mechanism reference rather than a current setup guide.
[Archive notice](https://raw.githubusercontent.com/langchain-ai/langgraph/main/examples/plan-and-execute/plan-and-execute.ipynb)

### ReWOO and result bindings

ReWOO separates planning from external observations. A planner describes work with
references to outputs of earlier operations; workers execute it and a solver
combines observations. The authors report token-efficiency and accuracy gains on
HotpotQA and evaluate other NLP tasks. Those measurements concern their models,
prompts and benchmarks, not arbitrary agent jobs.
[ReWOO paper](https://arxiv.org/abs/2305.18323)

For Lina, result references should be explicit records, such as an input binding
to a prior step's artifact. Resolve them only after the producing result is
available and accepted. This enables selected context and avoids repeatedly
replaying every intermediate observation. Plans made without observations can
still require revision when results contradict assumptions.

### LLMCompiler and dependency graphs

LLMCompiler separates a function-call planner, task-fetching unit and executor.
Its published evaluation reports latency, cost and accuracy improvements over
its ReAct baseline. The headline maxima are benchmark-specific, not universal
speedups. A dependency graph provides more execution structure than a flat batch
of parallel calls.
[LLMCompiler paper](https://arxiv.org/abs/2312.04511)

The reference repository includes HotpotQA, Movie Recommendation and ParallelQA
configurations, a ReAct comparison option, and task streaming from planner to
executor. It records question, prediction and latency for evaluation. Prompts
are tied to configured models and may require adaptation.
[LLMCompiler repository](https://github.com/SqueezeAILab/LLMCompiler)

Lina should support dependencies and bindings in its records so a DAG execution
mode can be compared later. Streaming partially generated plans into execution is
a distinct experiment. It needs incremental validation and a clear commitment
boundary before any side effect. A whole-plan validation path is simpler for the
initial baseline.

### Lightweight stateful task lists

Current Deep Agents documentation makes task planning opt-in from v0.7, after
earlier versions included it by default. Adding TodoListMiddleware exposes
write_todos. Its tasks use pending, in_progress and completed, persisted in agent
state. The documentation describes progress tracking for complex work and UI
visibility, not an automatic dependency scheduler.
[Deep Agents planning documentation](https://docs.langchain.com/oss/python/deepagents/overview#task-planning)

The middleware supplies both a tool and prompts that guide its use. Its public
configuration includes the planning prompt and tool description.
[TodoListMiddleware documentation](https://docs.langchain.com/oss/python/langchain/middleware/built-in#to-do-list)

This supports a useful default for Lina: optional model-managed plans on the
existing loop. Rich records can describe blocked work, dependencies and evidence
without forcing every agent to use a separate planning model.

### Orchestrator-workers and evaluation

Anthropic distinguishes predefined workflows from agents that dynamically choose
their processes. Its orchestrator-workers pattern decomposes a task, delegates
workers and synthesizes results. Its evaluator-optimizer pattern uses feedback
and repeated revision where evaluation criteria are useful. The article warns
that additional complexity can increase latency, cost and compounding errors.
It is engineering guidance, not a controlled cross-framework benchmark.
[Anthropic patterns](https://www.anthropic.com/engineering/building-effective-agents)

LangGraph's current examples use structured model output to describe report
sections. Send creates worker invocations with individual state, then worker
outputs enter shared state for synthesis. A separate evaluator example loops
until a response is accepted. Planning, delegation and evaluation are composable
responsibilities, rather than synonyms.
[LangGraph workflows](https://docs.langchain.com/oss/python/langgraph/workflows-agents)

Lina already has a Subagents owner. Planning should describe assigned work and
acceptance criteria, while Subagents handles launch, control, joining and result
delivery. A separate evaluator may be useful for some tasks; it must not become
a compulsory second model invocation for routine progress updates.

## Recommended mechanism for Lina

This section is a proposed design derived from the sources, not a claim that all
reference agents implement these features identically.

Keep the initial default model-led and optional. Add explicit plans to the existing
loop, with enough information to support graph execution later. Give Planning
ownership of the plan record and its revision rules, not tool processes or child
lifecycle. Accept either a model proposal through Tools or a trusted configured
workflow proposal. Record who proposed a change.

Suggested records:

- Plan identity, goal, owner agent/session, revision, mode, lifecycle and success
  criteria. Lifecycle can include active, paused, completed, abandoned and failed.
- Stable step identity, description, dependencies, input bindings, acceptance
  criteria, required or optional status, execution target and progress declaration.
- Attempt identity separate from step identity, with admitted operation or child
  task references, timestamps, execution outcome and evidence references.
- Plan update identity, expected revision, author, reason and the changes. Keep
  prior attempts and artifacts when the plan changes.
- A readiness result and selected step or ready set. Also expose why remaining
  work is blocked, waiting or outside policy limits.
- Completion assessment containing unmet criteria and the evidence examined.
  Record model assessment separately from deterministic validation.

Do not force a single completed flag to mean all of model declaration, operation
success, verification and global goal satisfaction. A succeeded process may produce
the wrong artifact. A failed process may still provide evidence that helps replan.
An optional step can be deliberately skipped without pretending it succeeded.

Dependencies should specify required result conditions. A simple all-success
dependency is a sensible default; permit an explicit terminal-outcome dependency
for cleanup or recovery work. Never unblock a dependent step merely because its
predecessor stopped. Stable result bindings must identify accepted output from a
particular attempt, not just the most recently arriving message.

Keep revisions fenced. A late result should attach to its original attempt and
become visible for reconciliation, but should not complete replacement work. A
plan edit does not cancel a running tool or child by itself. Send an explicit
control request to its owner, then reconcile its actual outcome. Replanning after
uncertain side effects must use Tools' or Subagents' reconciliation paths.

Persist admitted updates through State. Load the current plan during Context
assembly and select relevant active steps, blockers and evidence for each model
invocation. A child gets its assigned task and selected supporting information;
the parent owns the overall plan unless authority to update it is explicitly
granted. Child-created local plans have separate owners and revisions.

LangGraph distinguishes thread checkpoints from cross-thread stores and notes
that in-memory checkpoints disappear on process restart. Lina should therefore
describe durable plan storage through its existing State boundary, rather than
call a browser fixture durable or put active plan state in long-term Memory.
[LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence)

## Defaults to verify rather than experiments to debate

These are correctness conditions for whichever approach is selected:

- Reject invalid references, duplicate IDs and dependency cycles before scheduling.
- Check ownership, revision and allowed transitions on updates.
- Admit side effects only through existing Tools and Subagents policy paths.
- Preserve operation certainty, attempt identity and recovery evidence.
- Handle duplicates, cancellation, late delivery and out-of-order progress.
- Keep blocked and failed work visible; never turn an exhausted budget into success.
- Apply per-agent and whole-tree budgets, plus a finite replanning limit.
- Restore the ledger without blindly relaunching operations of unknown outcome.

Parallel execution of eligible independent work remains the baseline capability.
Required dependencies and conflicting side effects constrain eligibility. Calling
dependent operations in parallel is not a meaningful performance experiment.

## Experiments worth retaining

| Variable | Compared approaches | What to measure | Main trade-off |
| --- | --- | --- | --- |
| Plan use | Reactive loop with no explicit plan; model-managed task list; explicit plan-and-execute | Goal success, omissions, cost, latency, progress accuracy | Additional planning may help complex tasks and waste effort on simple ones |
| Decomposition | Full plan first; short rolling horizon; hierarchical parent/child plans | Missing work, obsolete steps, replans, usable partial output | Up-front coverage against responsiveness to new evidence |
| Planner model | Same model; dedicated planner; smaller executor model | Quality at matched budget, planner tokens, executor tokens | Model specialization against coordination and routing cost |
| Replanning trigger | After each step; on failure/change; periodically | Repair quality, wasted work, calls and latency | Faster adaptation against planner overhead |
| Result representation | Full observations; typed artifact bindings; selected summaries | Context size, binding errors, grounded final answer | Less context against missing decisive information |
| Execution strategy | Model selects eligible work; validated DAG selects ready set | Critical-path latency, useful parallelism, stale work | Flexibility against predictable scheduling |
| Plan commitment | Validate whole plan; validate streamed increments | First useful result time, cancellation waste, malformed plan exposure | Startup latency against executing before the full plan exists |
| Verification | Deterministic checks; model assessment; separate evaluator where applicable | False completion, false rejection, evaluation cost | Confidence against extra latency and correlated model errors |

Hold model, prompt controls, tools, work budget, scenario and failure seed explicit.
Distinguish changing the execution strategy from increasing the number of workers
or tokens. Use matched limits or report the different resource allocations.

Include short direct requests as a control, independent multi-source research,
dependency-heavy edits, changing requirements, failed prerequisites and a child
that reports success with a deficient artifact. Recovery fixtures should cover
duplicate updates, stale revisions, late child results, restart after launch,
unknown tool effects, and interrupted replanning. Record plan revisions,
readiness decisions, selected work, attempt outcomes and completion assessments.

Studio can demonstrate these routes and verify record invariants with deterministic
fixtures. It cannot establish token savings, model planning quality or real latency
benefits until live runs produce graded evidence under those controls.
