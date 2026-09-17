# Evaluating context engineering for long-horizon agents

**Status:** Research note for experiment design
**Reviewed:** 2026-09-16
**Evidence boundary:** 2026 arXiv preprints plus first-party documentation from Anthropic, OpenAI, and Google. Preprints and product guidance are labelled below; neither should be treated as independent proof of a generally superior strategy.

## Short answer

Evaluate context management as a controlled state-management problem, not as a contest between prompt templates:

```text
canonical agent state
  -> context strategy
  -> exact model-visible context
  -> model/tool/environment closed loop
  -> task result, progress, and telemetry
```

The canonical state should remain inspectable and, where possible, lossless. The strategy may select, order, summarize, compress, retrieve, edit, or externalize that state. The laboratory should then measure two different things:

1. **Context quality:** what evidence reached the model, what was omitted or transformed, and whether provenance and revisions survived.
2. **Agent behaviour:** whether the agent completed the task, how much work it needed, and whether context operations caused loops, repeated exploration, blocked actions, stale answers, or unsafe actions.

This separation matters because a compact context can look good while forcing the agent to reacquire information, and a lossless archive can still fail if retrieval never finds the relevant item.

OpenAI’s agent SDK documentation makes a related distinction between local run context and context actually visible to the model: local state is not automatically sent to the model; it must enter through instructions, input, tools, or retrieval. The lab should record these as separate planes rather than calling both “memory.” ([OpenAI Agents SDK: Context](https://openai.github.io/openai-agents-python/context/))

## What the recent work changes

The strongest 2026 direction is to treat context as an environment with operations and state, rather than a string that is periodically truncated.

- **Programmatic, recoverable context.** *Scroll* models an append-only event log, a typed persistent namespace, and a bounded working view. The agent can locate, materialize, compute over, and explicitly expose selected state; evicted material remains addressable rather than being destroyed. Its ablations compare lossy ingestion summaries, ordinary tool calls without a persistent programmatic environment, and keyword search without an eviction index. This is a preprint, and its benchmark scores are author-reported claims. ([Scroll, arXiv preprint](https://arxiv.org/abs/2608.21690))
- **Agentic compaction.** *ACM* gives the agent context-editing tools and external memory, allowing it to decide when to compress and when to search. It reports that post-training changes both performance and context-management behaviour; notably, the paper reports that a strong model may rarely invoke management tools without training. This makes “same strategy” comparisons invalid unless the model’s training and tool-use policy are held constant. It is a preprint. ([ACM, arXiv preprint](https://arxiv.org/abs/2607.23809))
- **Compression can change execution, not only recall.** *TRACE* evaluates a compression boundary by restoring the same environment state and comparing a raw-context continuation with a compressed-context continuation. It detects blocked actions and repeated canonicalized tool calls, then measures the extra short-horizon interaction burden caused by compression. This is a useful minimum test for a context manager. It is a preprint. ([TRACE, arXiv preprint](https://arxiv.org/abs/2608.06503))
- **Learned compression is a different experimental factor.** *CompactionRL*, *AdaCoM*, and *MEMENTO* explore learned or trained compaction, including jointly training an agent and its summaries, a learned external manager, and summaries combined with a residual KV state. These systems should not be compared directly with inference-only context managers without reporting the training data, training objective, model changes, and train/test compaction conditions. All three are preprints. ([CompactionRL](https://arxiv.org/abs/2607.05378), [AdaCoM](https://arxiv.org/abs/2605.30785), [MEMENTO](https://arxiv.org/abs/2604.09852))
- **Long-horizon evaluation must vary pressure and interference.** *LOCA-bench* varies context growth while keeping task semantics fixed; *MINTEval* tests multiple targets under updates and interference rather than only one “needle”; and *MemGym* separates memory performance from reasoning, retrieval, and tool-use performance with memory-isolated paired evaluations. These are preprints. ([LOCA-bench](https://arxiv.org/abs/2602.07962), [MINTEval](https://arxiv.org/abs/2605.18565), [MemGym](https://arxiv.org/abs/2605.20833))
- **Reliability is not pass@1.** A 2026 reliability framework proposes repeated-episode pass^k, reliability decay curves, variance amplification, partial-credit degradation, and loop or “meltdown” onset. These are more informative than one terminal success number when a context strategy makes long trajectories brittle. It is a preprint. ([Beyond pass@1, arXiv preprint](https://arxiv.org/abs/2603.29231))

## Experiment contract

Every run should make the following inputs explicit.

| Input | Minimum contents |
| --- | --- |
| Scenario | Goal, horizon, hidden state, required facts and constraints, session boundaries, terminal verifier, and partial-credit rubric. |
| Canonical source universe | Stable event IDs and order; role/type; timestamp; provenance; raw payload or pointer; token/byte size; revision or dependency links; relevance and criticality labels where known. Include system/developer instructions, user turns, assistant turns, tool calls/results, retrieved documents, memory records, and derived state. |
| Environment and tools | Deterministic replayable environment; versioned tool schemas; structured, verbose, malformed, delayed, and failing result fixtures; tool permissions; optional untrusted or adversarial content. |
| Strategy | Name and version; trigger; budget; retention, ranking, summarization, retrieval, paging, editing, and external-storage policies; whether the agent or a fixed manager decides; failure behaviour. |
| Model and serving | Exact model snapshot; system prompt; tokenizer/counting method; context limit; output reserve; decoding parameters; reasoning settings; API/SDK version; cache state; native compaction settings. |
| Run controls | Seed; concurrency; turn/step/time/cost/rate limits; retry policy; failure-injection plan; run ID; and whether the strategy can access future information. |

Useful pressure axes include total context size, source position, distractor density, multi-hop dependency length, conflicting or revised facts, tool fan-out, tool-result size, memory age, session restart, and multimodal payload size. LOCA-bench is a useful pattern: vary context pressure while holding the underlying task semantics constant. MINTEval adds the important case where the correct answer changes after intervening updates.

## Required outputs

Do not record only the final answer. A run should emit:

- **Prepared context:** the exact provider request or normalized content blocks, in order, including system instructions, history, retrieved memory, tool definitions, tool results, summaries, placeholders, and opaque provider compaction items. Include exact or estimated token counts by source.
- **Context decisions:** every retained, dropped, summarized, evicted, retrieved, rewritten, or reintroduced item; decision reason or score; trigger; budget; compression ratio; source IDs and provenance; memory writes, reads, updates, and failures.
- **Closed-loop trajectory:** model outputs, tool calls and arguments, tool results, environment observations and state deltas, retries, timeouts, blocked/repeated calls, restarts, cancellations, and the final response.
- **Evaluation record:** terminal outcome, partial-credit outcome, required-fact coverage, grounding/provenance checks, safety checks, and all costs.

For the lab’s run-record convention, these are naturally represented by a configuration record, event stream, trajectory, metrics, result, and inspectable context artifacts under the run ID. The canonical source universe must remain available so that a transformed context can be audited against its input.

Current builder APIs are informative but not authoritative. Anthropic documents server-side tool-result and thinking-block clearing, server-side and client-side compaction, tool search, and programmatic tool calling. It presents tool search, programmatic calling, prompt caching, and context editing as composable mechanisms with different effects. ([Anthropic: Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing), [tool-context management](https://platform.claude.com/docs/en/agents-and-tools/tool-use/manage-tool-context), [programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling))

OpenAI exposes a compact-conversation API that returns a compacted response containing an opaque compaction item, while Google documents cached-token usage and prefix-placement guidance. ([OpenAI: Compact responses](https://developers.openai.com/api/reference/java/resources/beta/subresources/responses/methods/compact), [Codex agent-loop engineering note](https://openai.com/index/unrolling-the-codex-agent-loop/), [Google: Context caching](https://ai.google.dev/gemini-api/docs/caching)) Record these as provider-specific implementations; do not silently normalize them into equivalent “summarization.”

## Strategy matrix

Start with a small, interpretable set:

1. **Full history / explicit overflow:** retain everything until the budget is exhausted, then fail or apply a documented overflow rule. This is the reference for fidelity while it fits.
2. **Sliding or source-aware retention:** retain recent turns, recent tool results, or a fixed policy such as “drop completed tool payloads first.” Vary the rule independently from the budget.
3. **Lossy compaction:** summarize or rewrite selected history at a fixed boundary, then continue. Test fixed-trigger and agent-triggered compaction separately.
4. **Recoverable external context:** keep raw events in an addressable store and expose only selected projections or retrieved spans. Vary retrieval, indexing, paging, and query budgets independently from storage fidelity.
5. **Agent-controlled context actions:** expose search, save, update, summarize, discard, or restore operations as tools. Compare a frozen policy, a prompted agent, and a trained manager; do not treat the latter as the same harness.
6. **Tool-context controls:** vary tool-definition selection, programmatic tool calls, tool-result clearing, and prompt caching as separate factors. Tool definitions and tool results have different failure modes; prompt caching reduces serving cost but does not itself reduce model-visible tokens in Google’s documentation.
7. **Learned representation compression:** keep separate from inference-only strategies because the model, training objective, and internal state may change. Report whether the compressed representation is human-auditable, recoverable, and available across model versions.

## Metrics

Report distributions and Pareto trade-offs, not a single composite score.

| Dimension | Metrics to collect |
| --- | --- |
| Task utility | Exact success; partial credit; required-fact and constraint coverage; answer correctness; final-state correctness; grounded citation/provenance correctness. |
| Context fidelity | Recall/precision of relevant source IDs; retention of the latest valid revision; conflict resolution; multi-target aggregation; dependency preservation; provenance loss; retrieval miss rate. Surface similarity of summaries is not sufficient. |
| Execution burden | Total, peak, and cumulative input tokens; output/reasoning tokens; context-manager tokens; tool and retrieval calls; reacquisition calls; step count; latency; storage and network bytes; billed cost; cached-token counts. |
| Compression regression | At each boundary, paired post-minus-pre blocked/repeated action burden, following TRACE. Record the first regression step, recovery steps, and whether the final task still succeeded. |
| Reliability | pass@1 and pass^k over repeated runs; reliability decay against horizon; variance amplification; graceful degradation under pressure; loop/repetition rate; meltdown or instability onset. |
| Memory economics | Construction/write cost, retrieval/read cost, generation cost, memory footprint, update and deduplication cost, stale-record rate, and recovery cost. The 2026 characterization of agent memory specifically recommends phase-aware profiling of construction, retrieval, and generation. ([Agent Memory, arXiv preprint](https://arxiv.org/abs/2606.06448)) |
| Safety and integrity | Prompt-injection survival; unauthorized reads/writes; stale or cross-session leakage; incorrect revision use; destructive-action confirmation; failure-injection response; and auditability of every external-memory operation. |

## Controls and procedure

Use a factorial design only where it answers a question. For a context-strategy comparison, freeze the model, prompt, agent policy, tools, environment replay, grader, decoding, output reserve, and resource limits. If tool selection or tool-result handling is the variable, keep the tool registry and schemas identical except for that factor. If training changes the model, make it a separate experiment family.

Run each comparison at three levels:

1. **Context-only probe:** at a fixed boundary, compare the exact prepared contexts against the canonical source universe. This catches dropped facts, wrong revisions, lost provenance, and budget violations without confounding them with model behaviour.
2. **Paired continuation:** restore the same environment state and run the same closed-loop continuation with raw versus transformed context. Freeze decoding where possible and use the same tool observations. This is the TRACE-style test for compression-induced execution instability.
3. **Full trajectory:** run from the initial state through completion under several horizons, pressure levels, and session boundaries. This captures compounding effects that a single boundary cannot reveal.

Start with at least three seeded repeats per condition and report per-task distributions and uncertainty; use more repeats when the result is close or the trajectory is highly stochastic. Include deterministic failures before and after compaction, external-store write failures, retrieval misses, stale results, duplicate or out-of-order tool events, lost acknowledgements, and restart/resume. Do not count a successful final answer as evidence that intermediate recovery was correct.

Measure cumulative context-manager work, not just the final request: compaction calls, summary tokens, retrieval calls, tool-definition tokens, tool-result tokens, and cache reads/writes. Control cache warmness explicitly. For native provider compaction, retain the opaque artifact and provider metadata even when its internal contents cannot be inspected.

Prefer executable or rule-based graders for state, facts, tool arguments, and safety. If an LLM judge is necessary, calibrate it against labelled examples, keep the judge fixed, and report disagreement. Blind strategy names in subjective grading. Analyze failures by mechanism—omission, stale revision, retrieval miss, malformed tool call, repeated exploration, blocked action, or unsafe action—rather than only by strategy label.

## First implementable laboratory slice

Build one deterministic scenario before adding a broad benchmark suite:

- a multi-turn task with an important early fact;
- a large structured tool result containing one relevant region;
- a later correction to an earlier fact;
- a two-hop dependency requiring both items;
- distractor events and one untrusted tool field;
- a rule-based final-state grader and a partial-credit grader.

Compare full history, sliding retention, fixed lossy compaction, and recoverable external retrieval. Test four context-pressure levels, two or three session boundaries, and a short paired continuation after each compaction boundary. The first UI only needs controls for scenario, strategy, pressure/budget, seed, and run/compare. The result view should foreground: source coverage and revisions, context size and manager cost, boundary regressions, tool/retrieval burden, safety findings, and terminal/partial outcome. Detailed event inspection can be progressive disclosure.

Initial hypotheses—not conclusions—should be:

- unmanaged history degrades as pressure rises;
- lossy compaction can preserve terminal success while increasing reacquisition or repeated actions;
- recoverable context improves the opportunity to recover evidence but shifts cost and failure risk into retrieval/query policy;
- tool-definition, tool-result, caching, and compaction mechanisms are orthogonal enough to require separate factors;
- learned compaction may win on a matched model/training distribution while transferring poorly to a frozen or different agent.

## Limitations and interpretation rules

- The 2026 research cited here is primarily arXiv preprint work. Treat reported benchmark scores as claims to reproduce, not as settled rankings.
- First-party docs describe real mechanisms and constraints, but vendor examples and internal evaluations are not neutral comparative evidence. Beta and preview features can change; record API version and date.
- A lossless external store does not guarantee lossless model access. Retrieval, query construction, indexing, and permissions remain part of the measured system.
- Benchmark context growth may be synthetic or task-specific. Pair controllable diagnostics with realistic long-horizon tasks only after the failure mechanisms are visible.
- Learned summaries, residual KV state, model fine-tuning, and provider-native opaque compaction can make direct cross-strategy comparisons impossible. Preserve the distinction between a harness change and a model change.
- Terminal success can hide extra calls, wasted tokens, unsafe intermediate actions, and silent state corruption. Report these separately.
- External memory and tool outputs may contain secrets, personal data, prompt injection, or stale instructions. Access control, retention, provenance, and cross-session isolation are experimental variables, not implementation details.

## Primary sources

### 2026 research (arXiv preprints)

- [Scroll: Context as an Environment](https://arxiv.org/abs/2608.21690) — programmatic, recoverable context environment.
- [ACM: Agentic Context Management for Long Horizon Tasks](https://arxiv.org/abs/2607.23809) — agent-controlled context editing and post-training.
- [TRACE: Reliable Context Compression](https://arxiv.org/abs/2608.06503) — paired boundary-local execution-instability evaluation.
- [CompactionRL](https://arxiv.org/abs/2607.05378) — reinforcement learning with context compaction.
- [AdaCoM](https://arxiv.org/abs/2605.30785) — learned agent-compatible context management.
- [MEMENTO](https://arxiv.org/abs/2604.09852) — learned dense context state with residual KV information.
- [LOCA-bench](https://arxiv.org/abs/2602.07962) — controllable and extreme context growth.
- [MINTEval](https://arxiv.org/abs/2605.18565) — multi-target memory under interference and updates.
- [MemGym](https://arxiv.org/abs/2605.20833) — long-horizon memory environments and memory-isolated evaluation.
- [Agent Memory](https://arxiv.org/abs/2606.06448) — workload characterization and phase-aware system profiling.
- [Beyond pass@1](https://arxiv.org/abs/2603.29231) — repeated-run reliability and long-horizon degradation metrics.

### First-party builder documentation

- [Anthropic: Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing), [tool-context management](https://platform.claude.com/docs/en/agents-and-tools/tool-use/manage-tool-context), and [programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling) — current product mechanisms; vendor guidance, not independent benchmark evidence.
- [OpenAI: Compact responses API](https://developers.openai.com/api/reference/java/resources/beta/subresources/responses/methods/compact), [Codex agent-loop engineering note](https://openai.com/index/unrolling-the-codex-agent-loop/), and [Agents SDK context](https://openai.github.io/openai-agents-python/context/) — compaction, cache-sensitive loop design, and local-versus-model-visible context.
- [Google: Context caching](https://ai.google.dev/gemini-api/docs/caching) — current caching controls and cached-token observability; product documentation, not a context-quality result.
