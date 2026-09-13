# Agent Harness Lab context

This context defines the project's working language. It describes the things the laboratory compares and records. It does not describe implementation details.

## Core concepts

**Platform**:
A technology or runtime used to build or operate an agent, such as LangGraph, Temporal, Restate, Mastra, or the Vercel AI SDK.
_Avoid_: using "platform" when the subject is the complete runnable agent.

**Environment**:
The capabilities, resources, and restrictions available to a harness while it runs, such as files, processes, shell access, network access, permissions, and isolation.
_Avoid_: using "environment" for the specific workspace data supplied to one run.

**Harness**:
A runnable implementation of an agent's surrounding engineering system. A harness may use one platform or several platforms.
_Avoid_: using "framework" as the name of the thing being compared.

**Harness configuration**:
A concrete assembly of a harness variant, agent definition, environment variant, infrastructure requirements, model configuration, and selected context, memory, tool, and observability strategies. A run pairs this configuration with a scenario and an experiment.
_Avoid_: treating a platform name as enough information to identify the runnable harness.

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
