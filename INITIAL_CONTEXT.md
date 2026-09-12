# Agent Harness Lab — Initial Project Context

> This is initial working context, not the project README. The README will be designed and written properly later.

## Project Overview

Agent Harness Lab is an open-source experimental engineering project for building, breaking, benchmarking, and comparing different architectures for AI agent harnesses.

The goal is **not to create another universal AI agent framework**.

The goal is to create a neutral laboratory where different approaches to building agents can be implemented under comparable conditions, subjected to the same workloads and failures, instrumented using a common telemetry model, and evaluated empirically.

The project should help answer a larger engineering question:

> **What actually makes a production-grade AI agent harness good, and which architectural choices work best under which conditions?**

Rather than relying on framework marketing, intuition, toy demos, or anecdotal experience, we want to build real implementations, run controlled experiments, deliberately break them, measure their behaviour, and publish reproducible results.

This is both a learning/research project and an open-source engineering project.

## What We Mean by an Agent Harness

The LLM itself is only one component of an agent.

For this project, the **agent harness** means the engineering system surrounding the model that allows it to perform useful, reliable, long-running work.

This may include:

* model interaction
* agent execution loops
* instructions
* context construction and context engineering
* tool discovery and tool execution
* state management
* short-term and long-term memory
* durable execution
* retries and recovery
* idempotency
* filesystem/workspace access
* skills
* subagents
* scheduling
* events
* human-in-the-loop interactions
* permissions
* sandboxing
* lifecycle management
* observability
* tracing
* evaluation
* failure handling
* artifact management
* concurrency
* external integrations

Different architectures solve these problems in very different ways.

Agent Harness Lab exists to explore those differences.

## Core Philosophy

The project should be **architecture-first, not framework-first**.

We are not primarily asking:

> Is Temporal better than LangGraph?

That comparison can be misleading because they operate at different abstraction layers.

Instead we identify architectural paradigms and use real technologies as implementations of those paradigms.

Initial paradigms include:

### 1. Minimal / DIY Agent Harness

Build the smallest useful agent runtime ourselves.

Conceptually:

LLM → reasoning/execution loop → tools → state → persistence

This acts as the control implementation.

It allows us to understand how much complexity frameworks actually remove and how much infrastructure is genuinely necessary.

### 2. Lightweight Agent SDK

Representative implementation:

OpenAI Agents SDK.

This represents code-first agent primitives without adopting a large orchestration architecture.

We investigate what a lightweight SDK provides compared with owning the complete execution loop ourselves.

### 3. Graph / State-Machine Agent Architecture

Representative implementation:

LangGraph.

The agent is modelled through explicit nodes, transitions and state.

This allows us to investigate whether explicit graph-based orchestration improves control, debugging, composition and reliability.

### 4. Durable Workflow Architecture

Representative implementation:

Temporal.

Here, agent execution is treated as a durable workflow.

This architecture is especially interesting for:

* long-running agents
* timers
* retries
* crash recovery
* human approvals
* external events
* resumability
* reliable side effects

A major research question is:

> Should long-running agents fundamentally be modelled as durable workflows?

### 5. Durable Application Runtime

Representative implementation:

Restate.

Restate provides durable execution, state and communication using a model different from traditional workflow orchestration.

This allows direct investigation into the trade-offs between workflow engines and durable application runtimes for agent systems.

### 6. Computer / Filesystem-Native Harness

This architecture treats the computer itself as an important part of the agent abstraction.

The agent may primarily operate through:

* filesystem
* shell
* programs
* persistent workspaces
* files as memory
* files as plans
* files as artifacts
* files as communication
* dynamically loaded skills

This is inspired by modern computer-native/coding-agent harnesses such as Hermes-style systems.

One major research question is:

> How much agent infrastructure can be represented naturally through the filesystem and ordinary computer primitives?

## Future Harnesses

The architecture must make it easy to add implementations later.

Possible future subjects include:

* Mastra
* PydanticAI
* AutoGen
* Google ADK
* Strands Agents
* CrewAI
* Vercel AI SDK
* other emerging agent runtimes

However, Agent Harness Lab must **not become a collection of framework demos**.

New implementations should exist because they represent an interesting architecture or allow us to investigate an important engineering question.

## Three Core Concepts

The project should separate three concepts:

### Harness

**How is the agent built?**

Examples:

* standalone
* temporal
* restate
* langgraph
* filesystem

### Scenario

**What must the agent accomplish?**

Examples:

* research task
* coding task
* customer support
* transactional workflow
* long-running task
* computer/filesystem task
* multi-agent task
* human approval workflow

### Experiment

**What are we trying to learn or test?**

Examples:

* kill the worker halfway through execution
* inject HTTP 500 errors
* compare memory strategies
* compare context-compaction strategies
* increase concurrency
* duplicate an event
* delay a tool response
* compare models
* compare tool exposure strategies

These concepts must remain independent wherever practical.

Conceptually:

Harness × Scenario × Experiment = Run

For example:

Temporal × Transactional Agent × Worker Crash

Restate × Transactional Agent × Worker Crash

LangGraph × Transactional Agent × Worker Crash

## Benchmark Scenarios

The laboratory should eventually contain a collection of canonical workloads.

Initial scenarios should include areas such as:

### Research Agent

Search multiple sources, gather information, reason over it, and produce an artifact.

Tests:

* tool use
* context management
* long trajectories
* artifact generation

### Coding Agent

Given a repository:

* inspect the codebase
* identify a problem
* modify files
* run tests
* diagnose failures
* iterate
* produce a final result

Tests computer interaction, planning, filesystem use, long context and recovery.

### Transactional Agent

Example:

discover item → request approval → perform transaction → update external system → send confirmation

This is particularly important for testing:

* side effects
* idempotency
* crash recovery
* duplicate execution
* exactly-once-like behaviour

### Customer-Support Agent

Handle multi-turn conversations while using external systems and retaining appropriate state.

### Long-Running Agent

Begin work, suspend for a significant period, receive an event and continue.

### Human-in-the-Loop Agent

The agent reaches a protected action, suspends, waits for human approval and resumes correctly.

### Event-Driven Agent

External events alter an existing agent execution.

### Multi-Agent Scenario

Multiple agents or subagents collaborate, delegate or work in parallel.

### Computer / Filesystem Scenario

The agent receives a workspace containing files, code, documents and other resources and must accomplish a goal through computer interaction.

### Context Stress Test

The agent operates across increasingly long trajectories and context sizes.

## Chaos Engineering

Failure testing is a first-class feature of Agent Harness Lab.

We should intentionally create hostile execution conditions.

Examples include:

* kill the agent process
* kill the worker
* restart the runtime
* restart the machine/container
* timeout a tool
* inject HTTP 500 responses
* inject HTTP 429 responses
* delay external services
* duplicate webhook delivery
* duplicate messages
* crash before a tool call
* crash during a tool call
* crash immediately after a side effect
* crash before persistence
* crash after persistence
* temporarily disconnect databases
* interrupt model requests
* corrupt or overload context
* cancel workflows
* deliver events out of order

The question is not merely whether an agent succeeds when everything works.

The more important question is:

> **What does the agent do when the environment stops cooperating?**

Failures should be deterministic or reproducible wherever possible.

## Metrics

We should avoid reducing everything to a single benchmark score.

Different architectures have different strengths.

Measurements should include several dimensions.

### Task Quality

* task completion rate
* correctness
* tool-selection accuracy
* artifact quality

### Reliability

* successful execution rate
* recovery rate
* unrecoverable failure rate
* duplicate side effects
* lost state
* incorrect continuation

### Performance

* total execution time
* time to first action
* model latency
* tool latency
* orchestration overhead
* p50 / p95 / p99 where meaningful

### Cost

* tokens
* model calls
* cost per successful task
* infrastructure requirements
* storage
* compute

### Context

* context size
* context growth
* compaction frequency
* token efficiency
* information loss
* retrieval accuracy

### Durability

* crash recovery
* restart recovery
* event recovery
* timer reliability
* long-running execution success

### Developer Experience

Some measurements will necessarily be qualitative.

Track:

* implementation LOC
* amount of framework-specific code
* configuration complexity
* required infrastructure
* deployment complexity
* debugging difficulty
* local-development experience
* conceptual complexity

### Observability

Evaluate whether engineers can determine:

* what happened
* why it happened
* what the model saw
* which tools executed
* what state changed
* where execution failed
* how execution recovered

## Standardized Execution Records

Every experiment should produce standardized records independent of the harness implementation.

A run should eventually resemble:

```text
runs/<run-id>/
  config.json
  events.jsonl
  trajectory.json
  metrics.json
  result.json
  logs/
  artifacts/
```

The exact format can evolve, but the principle is important:

**Experiment evidence must survive beyond the runtime that produced it.**

Runs should eventually be inspectable, comparable and ideally reproducible.

## Common Event Model

Different harnesses should emit events into a common telemetry model wherever possible.

Potential events include:

* AgentStarted
* ModelRequested
* ModelCompleted
* ToolRequested
* ToolStarted
* ToolCompleted
* ToolFailed
* StateUpdated
* MemoryRead
* MemoryWritten
* ContextBuilt
* CheckpointCreated
* AgentSuspended
* AgentResumed
* HumanInputRequested
* HumanInputReceived
* SubagentStarted
* SubagentCompleted
* FailureInjected
* AgentCompleted
* AgentFailed

Framework-specific telemetry may exist in addition to this.

We should not destroy useful implementation-specific information simply to make everything identical.

## Reproducibility

The project should prioritize reproducible experiments.

A benchmark result without enough information to understand how it was produced has limited value.

Runs should capture important configuration such as:

* harness
* harness version
* scenario
* experiment
* model
* model parameters
* tool configuration
* context strategy
* memory strategy
* environment
* failure injection
* timestamps
* random seeds where applicable

Eventually we should aim for commands conceptually similar to:

```text
agentlab run --harness temporal --scenario transaction --experiment worker-crash
```

and:

```text
agentlab compare temporal restate langgraph --scenario transaction --experiment worker-crash
```

The exact CLI is not fixed yet.

## Layered Experiments

A crucial principle is that technologies are not always mutually exclusive.

For example:

* LangGraph + Temporal
* OpenAI Agents SDK + Restate
* Custom Agent Loop + Temporal
* Filesystem Agent + Restate

Therefore the architecture should eventually allow us to distinguish layers such as:

* agent reasoning/orchestration
* durable execution
* state
* memory
* tools
* computer environment
* model
* observability

This allows experiments to investigate combinations rather than falsely treating every technology as a direct competitor.

## Questions We Want to Answer

Agent Harness Lab should eventually provide empirical evidence for questions such as:

* Do most agents actually need an agent framework?
* When is a simple loop enough?
* When do agents require durable execution?
* Temporal or Restate for long-running agents?
* How much reliability does a workflow engine actually add?
* What is the operational cost of that reliability?
* Does explicit graph orchestration improve complex agents?
* Should agent state live in a database, workflow state, memory system or filesystem?
* Can the filesystem serve as effective long-term agent memory?
* Are subagents actually worth their token and coordination cost?
* When should tools be exposed dynamically?
* How many tools can an agent reliably reason over?
* Which context-management strategies survive long trajectories?
* What happens when an agent crashes immediately after performing an irreversible side effect?
* How should agents handle duplicate events?
* How should human approvals interact with durable execution?
* How do different harnesses behave with hundreds or thousands of sleeping agents?
* How much latency does orchestration infrastructure introduce?
* How much engineering complexity does each architecture introduce?
* How easy is each architecture to debug?
* Which approaches provide the best observability?
* Which architectures fail gracefully?
* Which assumptions about production AI agents are actually supported by evidence?

New experiments should generally begin with a question like these rather than beginning with a technology we want to showcase.

## Open-Source Philosophy

Agent Harness Lab should remain neutral.

There should be no predetermined winner.

Temporal may be best for one workload while a simple loop is better for another.

A result such as:

> "For this workload, a basic loop and SQLite were sufficient."

is just as valuable as:

> "Temporal dramatically improved recovery."

Results should include disadvantages, unexpected behaviour and failed experiments.

We should prefer evidence over advocacy.

Framework maintainers and community contributors should eventually be able to:

* add harness implementations
* add scenarios
* add experiments
* reproduce benchmarks
* challenge methodology
* submit improvements
* compare new architectures

## What This Project Is NOT

Agent Harness Lab is not:

* another generic agent framework
* a wrapper around every AI library
* a collection of hello-world examples
* an LLM leaderboard
* marketing for a particular framework
* a benchmark designed to produce one universal winner
* a production SaaS platform
* a collection of artificial prompts with meaningless latency comparisons

## Engineering Principles

While working on this repository:

1. Keep harness implementations isolated enough that framework-specific assumptions do not leak into the entire project.
2. Keep scenarios reusable across harnesses.
3. Keep experiments reusable across scenarios and harnesses where technically meaningful.
4. Maintain a common telemetry and metrics layer.
5. Preserve framework-specific telemetry when useful.
6. Prefer deterministic and reproducible experiments.
7. Make failure injection a first-class capability rather than an afterthought.
8. Record enough information to understand why a benchmark produced its result.
9. Avoid premature abstractions.
10. Do not optimize implementations merely to make one framework win.
11. Treat unexpected results as useful findings rather than problems to hide.
12. Distinguish model quality from harness quality.
13. Distinguish agent orchestration from durable execution.
14. Distinguish architectural paradigms from individual products/frameworks.
15. Prefer real engineering workloads over artificial toy benchmarks.
16. Keep the project approachable enough that external developers can implement additional harnesses.

## Long-Term Vision

The long-term goal is for Agent Harness Lab to become an open-source **experimental laboratory for agent engineering**.

A developer considering an architecture should eventually be able to explore questions such as:

> How does this architecture behave when the worker dies?

> How expensive is it?

> Can it resume a week later?

> What happens when an external API executes successfully but the acknowledgement is lost?

> How does it handle duplicate events?

> What does debugging a failed execution look like?

> How does its context strategy behave after hundreds of actions?

> How difficult was the implementation?

> Can I reproduce this result?

The project should provide evidence through executable experiments rather than simply answering those questions with opinions.

Ultimately, we are trying to understand the engineering principles required to make AI agents **reliable enough to perform real work**.

Everything we build should serve that objective.
