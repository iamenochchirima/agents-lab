# Research for a shared platform agent baseline

**Research date:** 2026-10-07  
**Status:** Design input. No platform has been evaluated by this note.  
**Question:** Which expectations should guide the first working agent harness on each platform, before experiments explore platform-specific capabilities?

The useful target is a small, explicit Lab contract with executable evidence. There is no universal checklist that establishes a perfect agent. Tasks, permissions, execution models, and failure guarantees differ. Passing a baseline establishes only the behavior covered by its fixtures and graders.

## What the primary sources establish

| Source | Source-backed observation | Implication for this Lab |
| --- | --- | --- |
| [Anthropic, Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), 2026-01-09 | An agent evaluation measures model and harness together. Outcomes are environment state; traces record the interaction. The guide distinguishes capability from regression suites, recommends isolated trials, and prefers deterministic grading when appropriate. | Keep infrastructure checks separate from model-dependent scores. Inspect actual fixture state and retain traces. Avoid grading a single prescribed tool sequence when several valid solutions exist. |
| [Anthropic, Building effective agents](https://www.anthropic.com/engineering/building-effective-agents), 2024-12-19 | The article distinguishes predefined workflows from systems where the model directs process and tool use. It recommends simple implementations and clear tool interfaces. This is one architectural vocabulary, not a universal definition. | An agent baseline should exercise a model-directed action and observation loop. A scripted test driver verifies its mechanics but does not demonstrate autonomous reasoning. |
| [Yao et al., tau-bench](https://arxiv.org/abs/2406.12045), 2024-06-17 | The benchmark combines user interaction, API tools, and domain policies. It checks final database state and introduces pass^k to measure success across repeated trials. | Check task outcomes and constraints separately. Repeat live trials and publish consistency, rather than selecting the best run. Its domain tasks do not define a platform interoperability standard. |
| [Restate, Durable steps](https://docs.restate.dev/develop/ts/durable-steps), checked 2026-10-07 | Restate journals operation results for replay. Non-deterministic operations belong inside durable steps, whose failures may retry according to policy. | A durability extension must test replay and retry boundaries. Journaling does not by itself establish exactly-once effects in an external service. |

The right-hand column is our interpretation. The sources support the evaluation methods; they do not prescribe the Lab's proposed cases below.

## Proposed development approach

Use three distinct suites. Preserve each platform's native implementation and diagnostic evidence.

### 1. Scripted harness conformance

Replace the model boundary with known responses while exercising the real platform execution path. These cases diagnose orchestration and adapter defects without spending tokens or attributing a model decision to the harness.

| Case | Fixture and expected evidence |
| --- | --- |
| Final response | A text-only response ends the turn and produces one terminal result. |
| Tool round trip | A response requests a fixture tool. Correct arguments reach it; the next model request receives the correlated result. |
| Observation-driven continuation | A fixture tool returns an unexpected value. The next scripted response is accepted and the loop can continue before ending. |
| Invalid or denied action | Unknown tool, malformed arguments, and explicitly denied mutation do not execute. Evidence distinguishes rejection from an executed tool failure. |
| Tool failure | A fixture exception or timeout follows the documented error policy. It cannot become a fabricated successful result. |
| Context continuity and isolation | The next turn receives admitted prior context. Another session does not receive it. Record what context was supplied. |
| Bounded execution | Repeated tool requests stop at the configured budget with a truthful terminal reason. |
| Cancellation | Cancellation prevents new dispatch after the harness observes it. Evidence states whether an already running operation finished, cancelled, or remains unknown. |
| Evidence integrity | Every dispatched action and terminal result is attributable to a run. Recorded effects agree with the independent fixture ledger. |

These are proposed contract tests. They are not evidence that a live model chooses tools well, obeys policy, or completes a task.

### 2. Live agent capability and regression

Run small shared tasks with real model responses: answer without unnecessary tools; retrieve a fact through a tool; combine dependent observations; carry a user correction into the next turn; handle a recoverable tool error; and request a missing required input before mutation. Pair permission and uncertainty cases with cases where action is already authorized and input is sufficient, so the suite does not reward universal refusal or needless questions.

Grade fixture state and explicit task constraints first. Add a narrow rubric only where behavior cannot be checked programmatically, and calibrate model judgments with human review. Measure completion, policy violations, first-attempt success, repeated-trial consistency, latency, tokens, and cost separately. Choose trial counts before running, report raw denominators, and avoid confident rankings from a few trials.

### 3. Declared capability extensions

Add restart/resumption, lost side-effect acknowledgements, durable event handling, durable timers, checkpoints, persistent memory, parallel execution, or suspended human approval only when a variant declares that capability. The shared Lab submission-identity contract is checked in the core suite; recovery of effects after a crash is a separate claim. Test crashes before and after persistence and external effects. Inspect a fixture ledger to distinguish an attempted call, an actual effect, and a replayed result.

A variant without restart recovery can satisfy the basic loop contract while reporting the durability extension as unsupported. A variant claiming recovery must pass its extension. Do not count an unsupported extension as a success or erase it through aggregation.

## Experimental controls and limits

Keep scenario goals and graders independent of platform APIs. The platform adapter owns execution; the experiment owns controlled changes and failure schedules. Record model version and parameters, prompts, tools, budgets, environment, harness revision, seed where applicable, timestamps, failure injection, and grader version. Start every trial from a clean fixture and retain normalized records alongside native diagnostics.

Label failures as agent behavior, harness defect, environment failure, or grader defect when evidence supports that attribution. Ambiguous external outcomes remain unknown pending reconciliation. Deterministic fixture reproduction does not make live model sampling deterministic.

Start with a handful of working cases and a reference solution that passes each grader. Grow the suite from implementation risks and real failures. A shared baseline lets contributors answer whether each platform's basic agent path works; extensions then test which platform mechanisms help under particular conditions. Neither suite supports a universal winner or a claim of perfection.
