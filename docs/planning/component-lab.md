# Component Lab

**Status:** Draft

## Purpose

The Component Lab is an additive workspace for studying the individual parts of
an AI agent harness.

The existing Platform area compares complete platform or harness implementations.
The Component Lab compares different implementations of one harness responsibility,
such as context management, memory, planning, or tool calling.

This proposal does not replace or change the current platform implementation plan.
It adds a separate way to build, run, inspect, and compare focused experiments while
reusing the Lab's existing scenarios, models, evidence, metrics, and run inspection
patterns where that is useful.

## Core idea

A component experiment keeps the surrounding conditions fixed and changes one
strategy at a time.

```text
component strategy
+ test case
+ fixed surrounding behaviour
+ model and configuration
= component experiment run
```

For example, a context experiment could run the same task with a full-history
strategy, a sliding-window strategy, and a relevance-ranked strategy. The task,
model, source messages, tool results, and token limit should remain the same so the
comparison measures the context strategy rather than several changes at once.

The Component Lab should support both documented strategies and cases invented by
the project maintainer. A case can be a reusable fixture, a task prompt, a synthetic
conversation, a memory collection, a tool trace, or a controlled failure sequence.

## Proposed workspace

The product could expose a top-level **Component Lab** tab. It would contain one
workspace for each harness area:

1. Input and perception
2. Context management
3. Planning and reasoning
4. Memory
5. Tool use
6. Control and orchestration
7. Execution environment
8. Output and actions
9. Safety and guardrails
10. Model interface
11. Observability

Each workspace should make the same basic actions available:

- read a short explanation of the component;
- choose an implementation strategy;
- configure its parameters;
- choose or create a test case;
- run the case;
- inspect component-specific evidence and metrics;
- compare two or more strategies under the same conditions;
- record observations and limitations.

## Component areas

### Input and perception

Possible strategies include raw-input handling, canonical input normalization, and
intent or task parsing. Inputs may eventually include user text, files, images, API
payloads, and external events.

### Context management

This area controls what reaches the model for a turn:

- system instructions and task context;
- conversation history;
- retrieved memory;
- tool results;
- prioritization and ranking;
- sliding windows;
- summaries and hierarchical compaction;
- token budget allocation.

Useful cases include long conversations, conflicting instructions, large tool
outputs, old but important facts, irrelevant history, and strict token budgets.

The experiment should show both the final answer and the selected, removed, or
summarized context that produced it.

### Planning and reasoning

Possible strategies include ReAct-style interleaving, plan-then-execute, graph
planning, task decomposition, reflection, self-critique, and replanning after a
failure or new information.

The Lab should keep planning separate from control flow. A plan can propose work;
the control strategy decides how that work is executed and resumed.

### Memory

Memory should be studied as several related functions rather than one large feature:

- working memory for the active turn;
- episodic memory for previous sessions;
- semantic memory for facts and preferences;
- procedural memory for reusable solutions and tool patterns;
- memory writing policy;
- memory retrieval and ranking;
- consolidation, deduplication, decay, and forgetting.

Memory cases should test repeated tasks, retrieval misses, stale facts, conflicting
memories, cross-session behaviour, and isolation between agents or runs.

### Tool use

Possible strategies include static or dynamic tool registries, tool selection,
argument construction, schema validation, sequential or parallel calls, result
normalization, retries, timeout handling, and error recovery.

Tool cases should distinguish read-only tools from side-effecting tools and record
which tool was selected, why it was selected, what arguments were sent, and what
result or failure came back.

### Control and orchestration

This area controls the overall observe, plan, act, and observe cycle. It can include
simple loops, state machines, graphs, durable workflows, multi-agent routing,
termination rules, stuck detection, cancellation, and human approval.

The same planning strategy should be testable under more than one control strategy
where that comparison is meaningful.

### Execution environment

This area covers filesystem, network, process, container, VM, and remote-computer
execution. It also includes permissions, capability grants, timeouts, rate limits,
resource limits, and cost limits.

Environment experiments must state what isolation exists. An approved workspace
process should not be described as an operating-system sandbox unless it actually is
one.

### Output and actions

This area handles response formatting and side-effecting actions. It can include
pre-action verification, confirmation, commit handling, response rendering, and
artifact creation.

The Lab should distinguish a proposed action from a committed action. This is where
irreversible effects and acknowledgement loss need to be measured carefully.

### Safety and guardrails

Guardrails may run at several points in a turn:

- input and external-content sanitization;
- prompt-injection checks;
- model-output checks;
- tool-result checks;
- anomaly and repetition detection;
- scope and budget checks;
- confirmation gates for high-risk actions.

The experiment record should show which check ran, what decision it made, and what
the harness did after a denial or uncertain result.

### Model interface

Possible strategies include model routing, prompt templates, provider adapters,
fallback models, retry and backoff policies, streaming, interruption handling, and
cost and latency instrumentation.

Model quality and harness behaviour should remain separate measurements. A model
change should not be presented as evidence that a harness strategy improved unless
the model was held constant or the change was the experiment variable.

### Observability

This area covers trace events, trajectory records, metrics, structured logs, and
diagnostic artifacts. It should capture enough information to understand what the
strategy did without recording secrets or pretending to capture hidden model
reasoning.

Session and state persistence are related but should remain visible as a separate
cross-cutting concern because persistence affects memory, recovery, orchestration,
and evidence.

## Strategy and case model

Each strategy should have a stable identity and a small documented interface. Its
description should include:

- strategy ID and version;
- configurable parameters;
- required inputs and produced outputs;
- supported cases and known limitations;
- emitted events and metrics;
- failure, retry, cancellation, and recovery behaviour.

Each test case should define:

- the starting input and surrounding fixture;
- the expected task or question;
- the controls held constant;
- the expected artifacts;
- the grading method;
- any injected failure or interruption;
- what the case does not prove.

## Evidence and comparison

A component run should retain the selected strategy, its configuration, the fixed
experiment envelope, the case, model settings, environment, timestamps, random seed
where relevant, events, metrics, artifacts, and result.

Component-specific evidence should be retained alongside normalized evidence. For
example, a context run should preserve the source and priority of retained messages,
while a memory run should preserve memory reads, writes, ranking decisions, and
consolidation results.

Comparisons should report observed results separately from interpretation. The Lab
should not claim that one strategy is universally better from a single case or a
small local run.

## Relationship to the existing Lab

The current Platform Lab remains responsible for complete platform runs. The
Component Lab would have its own catalog and focused experiment runner, while sharing
existing project capabilities where appropriate:

```text
Platform Lab  → complete platform or harness execution
Component Lab → focused strategy execution

Shared       → models, fixtures, scenarios, evidence, metrics, inspection, comparison
```

The Component Lab should not force component strategies into the existing platform
registry. A platform may host a component strategy, but platform identity and
component strategy identity remain separate fields in the experiment configuration.

## Suggested first slice

Start with Context management using deterministic inputs and a deterministic model
fixture. Implement a small number of strategies, such as full history, sliding
window, and relevance-ranked retention.

The first slice should make it possible to inspect:

- the original context sources;
- the context selected for the model;
- omitted or summarized content;
- token counts and budget use;
- the model result;
- the comparison across strategies.

After that, Memory and Tool use are natural next areas because both can reuse the
same focused case, evidence, and comparison patterns.

## Open questions for refinement

- Should the UI call these areas components, modules, or strategies?
- Should component runs use the existing run record directly or a related focused
  record that shares its evidence format?
- Which context sources must be represented in the first Context Lab slice?
- How should user-created cases be stored, versioned, and shared?
- Which metrics are common to every component, and which belong only to one area?
- How much of a complete harness must surround a component before its result is
  meaningful?
- Which strategies should be compared first, and which are only research notes until
  they have an executable implementation?
