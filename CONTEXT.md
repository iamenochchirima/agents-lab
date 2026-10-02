# Agent Harness Lab context

This context defines the project's working language. It describes the things the laboratory compares and records. It does not describe implementation details.

## Core concepts

**Platform**:
A durable-execution runtime used to build or operate an agent, such as Temporal,
Restate, LangGraph, Mastra, Vercel Workflow / AI SDK, Inngest, Trigger.dev, DBOS,
Hatchet, or AWS Step Functions. OpenAI Agents SDK is an agent SDK used by a platform
variant, not a platform itself.
_Avoid_: using "platform" when the subject is the complete runnable agent.

**External integration**:
A Lab-side boundary for starting and observing an independently owned runnable system.
No external harness integration is currently implemented. A future adapter must use a
versioned contract and keep the external runtime outside this repository.

**Reusable capability**:
A portable definition used by more than one platform variant, such as a skill, MCP or
OAuth connection, plugin manifest, tool schema, policy, or artifact type. Capabilities
do not own an agent loop or a platform's durability model.

**Environment**:
The execution context in which a harness operates, such as a local process,
container, or remote machine. Record its boundaries and lifecycle separately from
backend deployment profiles.
_Avoid_: using "environment" for backend deployment architecture or browser tooling.

**Backend deployment profile**:
The service topology used by a backend-oriented platform implementation, including its
agent service or worker, persistence, durable runtime where applicable, networking,
secrets, and observability.
_Avoid_: calling a backend deployment profile a computer environment.

**Harness**:
A runnable implementation of an agent's surrounding engineering system. A harness may use one platform or several platforms.
_Avoid_: using "framework" as the name of the thing being compared.

**Harness configuration**:
A concrete assembly of a harness variant, agent definition, environment variant, infrastructure requirements, model configuration, and selected context, memory, tool, and observability strategies. A run pairs this configuration with a scenario and an experiment.
_Avoid_: treating a platform name as enough information to identify the runnable harness.

**Studio**:
A single laboratory workspace for composing a complete neutral agent harness,
exposing its harness components for focused experiments, and inspecting the runs
that result. Studio is not a platform and is distinct from the existing Platform
Lab.

**Harness component**:
A replaceable responsibility within a harness, such as context management, memory,
planning, or tool use, that can be the subject of an experiment. A harness component
is not a platform and is not merely a user-interface element.

**Computer use**:
A harness component that observes and acts on an interactive computer interface,
such as a browser or desktop, then verifies the resulting state. It includes the
observation source, target grounding, action representation, state verification, and
interaction recovery policy.
_Avoid_: treating computer use as generic API tool calling or as the computer
environment itself. The environment owns the machine and its capabilities; computer
use owns the observe-and-act interaction policy.

**Component experiment**:
An experiment that varies one harness component or strategy while holding the
scenario and surrounding harness configuration fixed.

**Memory**:
A harness subsystem that decides what information is persisted, how it is scoped and
revised, and what can be retrieved for a later turn. Retrieved Memory is not
automatically model-visible; Context decides how a retrieved record is represented,
ordered, budgeted, and passed to the model.

**Memory record**:
A scoped, provenance-bearing representation that may be retrieved for a future turn.
It has its own lifetime, revision, and lifecycle state and is distinct from the raw
conversation transcript, a Context message, or a tool result.

**Memory policy**:
The explicit read, write, update, retention, and consolidation rules applied to Memory
records in one harness configuration. A Memory policy is the changed variable in a
Memory component experiment; it is not a model provider or a Context strategy.

**Agent definition**:
A named, platform-specific construction of one agent system, including its identity, instructions, roles, topology, and platform-owned orchestration choices.
_Avoid_: using an agent definition as the scenario workload.

**Agent topology**:
The structural arrangement of agents in an agent definition, such as one agent, a supervisor with subagents, or a peer group.
_Avoid_: using "agent type" when the intended meaning is a scenario such as research or coding.

**Variant**:
A named alternative within a harness or environment that changes a deliberate architectural choice. Qualify the term as harness variant or environment variant when the subject is not already clear.
_Avoid_: calling an incidental configuration change a variant or comparing unlike kinds of variants as peers.

**Harness variant**:
A deliberately different harness implementation built with one platform or a composition of platforms.

**Environment variant**:
A deliberately different implementation of an environment that changes capabilities, restrictions, isolation, persistence, or another environment-level choice.

**Composition**:
A harness that combines multiple platforms or architectural layers, such as LangGraph with Temporal.
_Avoid_: treating a composition as a direct competitor to one of its individual platforms.

**Scenario**:
A defined workload that an agent must complete, such as researching a topic or performing a transaction.
_Avoid_: mixing failure conditions into the scenario definition.

**Experiment**:
A defined test of a scenario and harness, including its hypothesis, controls, variables, and failure conditions.
_Avoid_: calling an unrecorded demo an experiment.

**Run**:
One concrete execution of a harness, scenario, and experiment with its configuration, events, artifacts, result, and metrics.

**Execution mode**:
The way a run is hosted, such as embedded, isolated, or containerized. It is an experimental variable when hosting overhead can affect the result.

**Infrastructure**:
The deployable services and operational resources required by a harness configuration or experiment, such as a Temporal server, Restate runtime, database, telemetry collector, or hosted provider service.
_Avoid_: treating infrastructure as if it were owned exclusively by one platform when several harness configurations can use it.

## Evidence

**Run record**:
The durable collection of files produced by a run. It must remain understandable after the process that produced it has stopped.

**Common event**:
A normalized event that uses the laboratory event model so runs from different harnesses can be compared.

**Framework-specific telemetry**:
Additional information emitted by a harness that is useful for understanding its implementation, even when it has no common equivalent.
_Avoid_: discarding useful details merely to make records look identical.
