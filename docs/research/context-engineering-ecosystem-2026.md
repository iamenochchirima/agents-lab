# Context and memory engineering across agent ecosystems

**Status:** Research note for experiment design
**Reviewed:** 2026-09-17
**Scope:** OpenAI, Google, Microsoft, AWS, Meta/Llama Stack, open-source runtimes, and 2026 peer-reviewed or openly published research.

This note widens the earlier context-engineering review. Vendor documentation tells us what current systems expose. It does not prove that a vendor's design is the best one. Research papers and benchmarks give us comparison methods, but many 2026 results are still new and need reproduction.

## Bottom line

The current ecosystem does not converge on one "memory system." It converges on a separation of concerns:

```text
durable session / event history
  -> memory formation and retrieval
  -> context policy and working view
  -> model and tool interaction
  -> new events, state changes, and memory writes
```

The important research question is therefore not "which prompt format wins?" It is:

> Given the same task, model, tools, environment, and active token budget, which combination of state storage, memory policy, context assembly, and recovery behaviour gives the best task quality, reliability, cost, and auditability?

Context and memory should be built in the same experimental environment because they interact. They should remain separate modules because they answer different questions:

- Context decides what the model receives on this step.
- Memory decides what information persists, how it is represented, and how it can be recalled later.
- Session state records the run and makes recovery, replay, and comparison possible.

## Context engineering is broader than memory

For this project, **context engineering** means constructing the model-visible working input for a decision. It includes the information's representation, ordering, serialization, provenance, permissions, and lifecycle—not only the decision to retrieve an old conversation or write a memory.

The context surface can include:

- instructions, policies, and output schemas;
- the current user request and task state;
- conversation, reasoning summaries, tool calls, and tool results;
- retrieved documents, database rows, code, citations, and external facts;
- tool definitions, capabilities, permissions, and deferred tool references;
- files, images, audio, video, screenshots, and generated artifacts;
- runtime state held in a session, checkpoint, sandbox, or provider-managed conversation;
- model-serving state such as prompt-cache or KV-cache reuse; and
- trust, scope, freshness, and provenance metadata that determines how the material may be used.

This wider definition matters because two runs can use the same memory store and still receive materially different contexts. A tool schema can crowd out useful history; a file can be represented as raw text, a citation, or a searchable resource; an image can be downsampled or omitted; and a cache can reduce latency without changing what the model sees. The lab should treat these as context variables and record them explicitly.

### Representation and serialization are experimental variables

Provider APIs increasingly expose typed items rather than one undifferentiated prompt. OpenAI's current Responses shape includes messages, reasoning, compaction items, function calls, function outputs, files, images, and other item types. The open-source [Open Responses specification](https://github.com/openresponses/openresponses) similarly treats typed items and semantic streaming events as the unit of an agentic exchange. The [A2A Protocol 1.0 specification](https://github.com/a2aproject/A2A/blob/main/docs/specification.md) extends the interoperability view to tasks, messages, parts, artifacts, file references, and multimodal exchange between agents. This supports a useful lab distinction between:

1. the canonical event or state object;
2. the selected context items;
3. the provider-specific serialized request; and
4. the tokenized or multimodal model input actually consumed.

These layers must not be collapsed. The same logical state can produce different model inputs under different roles, content-part orderings, chat templates, tool encodings, or provider adapters. OpenAI's [Model Spec](https://github.com/openai/model_spec) is useful for studying the authority and trust relationship between system, developer, user, assistant, and tool content. [Hugging Face's chat-template documentation](https://huggingface.co/docs/transformers/main/en/chat_templating) makes the serialization issue concrete for local models: structured messages are rendered into model-specific control tokens, and the template must match the model's training format. For multimodal models, the [processor and multimodal template](https://huggingface.co/docs/transformers/main/chat_templating_multimodal) also determines how images, audio, and video become model inputs.

### Retrieval and grounding are context assembly, not automatically memory

Retrieval should be studied as a pipeline:

```text
query or task state
  -> query construction / decomposition
  -> candidate generation
  -> filtering and reranking
  -> evidence selection and packing
  -> citations, provenance, and answer grounding
```

Current systems expose several distinct forms. OpenAI File Search combines semantic and keyword search over vector stores and can return the search results for inspection. Google's File Search imports, chunks, embeds, and indexes files, supports multimodal embeddings for images, and returns file or media citations. Azure AI Search's agentic retrieval decomposes a request into parallel subqueries and returns grounding data plus an activity log. Meta's SIRA treats query expansion and corpus statistics as part of retrieval preparation. ([OpenAI File Search](https://developers.openai.com/api/docs/guides/tools-file-search), [OpenAI Retrieval](https://developers.openai.com/api/docs/guides/retrieval), [Gemini File Search](https://ai.google.dev/gemini-api/docs/file-search), [Azure agentic retrieval](https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-overview), [Meta SIRA](https://ai.meta.com/research/publications/superintelligent-retrieval-agent-the-next-frontier-of-agentic-retrieval/))

AWS Knowledge Bases adds another useful comparison: retrieval can be kept as an explicit stage with reranking, citations, structured-data query generation, and iterative agentic retrieval instead of being hidden inside a single model call. Anthropic's structured search-result blocks make source identifiers, titles, content, citations, and cache controls explicit in the model input. ([AWS Knowledge Bases retrieval](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-how-retrieval.html), [Anthropic search-result blocks](https://platform.claude.com/docs/en/build-with-claude/search-results))

The relevant comparison is therefore not only dense versus lexical retrieval. The lab should be able to vary query formulation, corpus/index preparation, candidate count, reranking, scope filters, evidence packing, citation policy, and abstention when evidence is insufficient. Retrieval quality needs both intermediate metrics—candidate recall, precision, rank, source coverage, freshness, and grounding—and end-task metrics.

Long context is not a substitute for retrieval. Google's current long-context guidance explicitly notes that single-needle tests do not predict multi-needle accuracy, that unnecessary input should be avoided, that longer inputs increase time to first token, and that query placement can affect performance. That makes context size, position, density, and number of relevant items first-class factors in the lab. ([Gemini long context](https://ai.google.dev/gemini-api/docs/long-context))

### Tool definitions and tool results are context

Tool use has at least two context problems:

- **tool discovery:** deciding which capabilities and schemas are visible to the model;
- **tool-result handling:** deciding which returned data is retained, summarized, filtered, externalized, or returned by reference.

Anthropic's current tool-context guidance separates tool search, programmatic tool calling, prompt caching, and context editing because each targets a different source of context pressure. OpenAI exposes tool search and programmatic tool calling for the same broad reason. The [Model Context Protocol](https://modelcontextprotocol.io/specification/2025-06-18) adds a protocol-level view: tools, resources, and prompts are distinct server capabilities; tool lists are paginated; tool schemas and annotations are part of the interface; and user consent and authorization are part of safe tool use. The MCP project's 2026 update also emphasizes cacheable list results and security hardening. ([Anthropic tool context](https://platform.claude.com/docs/en/agents-and-tools/tool-use/manage-tool-context), [OpenAI tool search](https://developers.openai.com/api/docs/guides/tools-tool-search), [OpenAI programmatic tool calling](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling), [MCP 2026 update](https://blog.modelcontextprotocol.io/posts/2026-07-28/))

Microsoft Foundry's Toolbox documentation is another practical reference for separating discovery, credentials, governance, and tool-definition context. The lab can therefore test all schemas always visible, a small static set plus search, capability summaries with on-demand expansion, code-mediated tool calls, raw results in history, structured result extraction, and references to externally stored results. The experiment must record both what the model could see and what the tool runtime actually returned. ([Microsoft Foundry Toolbox](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/toolbox-overview))

### Caching and model state change the cost and continuity of context

Prompt caching changes the cost and latency of context, while compaction, response chaining, and provider-managed state can change how context is reconstructed. They should not be treated as interchangeable with summarization.

- OpenAI reports prompt-cache diagnostics and supports compaction and state continuation through its Responses APIs. Its latest model guidance also calls out preserving assistant phases and replaying the right items when state is managed by the application.
- Google supports implicit caching in newer Gemini models and exposes cached-token usage; explicit cached content has its own lifetime and storage semantics.
- Anthropic documents prefix caches, cache invalidation, tool-result clearing, thinking-block handling, and server-side compaction as separate controls.
- Self-hosted serving adds another layer: [vLLM's Automatic Prefix Caching](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/) reuses KV cache for shared prefixes, but only where the prefix matches. [Hugging Face's cache strategies](https://huggingface.co/docs/transformers/main/en/kv_cache) show additional dynamic, static, quantized, offloaded, and sliding-window options. This is serving state, not semantic memory.

The lab should record cache keys or prefix identity where available, cache hits and misses, invalidation causes, prompt tokens versus cached tokens, time to first token, and whether a restart or provider boundary destroys the state. A strategy that has the same quality but half the cost is a meaningful result; a cache hit that silently exposes the wrong tenant's prefix is a safety failure.

### Multimodal and artifact context need their own controls

Text-only token counts are insufficient for modern agents. Context can contain images, audio, video, PDFs, screenshots, code artifacts, and files that remain in a sandbox rather than being copied into the prompt. Google's long-context and File Search documentation now treats multimodal inputs, persistent media identifiers, page-level citations, and cached files as normal parts of the context pipeline. OpenAI's current agent direction includes persistent computer environments and compaction, while Google ADK documents persistent code-execution state. ([Gemini long context](https://ai.google.dev/gemini-api/docs/long-context), [Gemini File Search](https://ai.google.dev/gemini-api/docs/file-search), [OpenAI computer environments](https://openai.com/index/equip-responses-api-computer-environment/), [ADK persistent code execution](https://google.github.io/adk-docs/tools/google-cloud/code-exec-agent-engine/))

Multimodal experiments should record the asset identifier, preprocessing or sampling policy, resolution or frame count, extracted text/transcript, references or citations, and the distinction between the asset being available to a tool versus being directly visible to the model. Artifact context should record whether the model receives content, a summary, a path, a handle, or a tool capable of reading it.

### Context integrity includes trust, scope, and provenance

Context can be wrong even when retrieval is technically successful. The system may mix tenants, surface stale facts, treat tool output as instructions, or let an untrusted document override a policy. The [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) explicitly addresses token audience binding, token passthrough, PKCE, and confused-deputy risks. Anthropic's submission to NIST highlights indirect prompt injection through web pages, documents, and tool outputs as a distinct agentic security problem. ([Anthropic/NIST submission](https://www-cdn.anthropic.com/43ec7e770925deabc3f0bc1dbf0133769fd03812.pdf))

Every context item in the lab should be able to carry source, owner, scope, timestamp, freshness, trust level, and transformation lineage. [OpenAI's prompt-injection research](https://openai.com/index/designing-agents-to-resist-prompt-injection/), [Microsoft Prompt Shields](https://learn.microsoft.com/en-us/azure/foundry/guardrails/how-to-create-guardrails), and [AWS prompt-attack detection](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-prompt-attack.html) give the lab different provider perspectives on direct and indirect attacks. Security experiments should include prompt injection in retrieved text, malicious tool fields, stale or conflicting memories, cross-user retrieval attempts, and cache/session reuse after a scope change. The output should show not only what was selected but why it was considered admissible.

### Context evaluation must measure the path, not only the answer

End-task success is necessary but insufficient. The 2026 [ContextBench coding-agent benchmark](https://arxiv.org/abs/2602.05892) measures context recall, precision, and efficiency along agent trajectories instead of inspecting only final issue resolution. The 2026 [ContextBench context-modification benchmark](https://proceedings.iclr.cc/paper_files/paper/2026/hash/20f94ae24649f4f97a8296b4c1f29358-Abstract-Conference.html) studies how modifications to context elicit or suppress behaviours. [AgencyBench](https://github.com/GAIR-NLP/AgencyBench) adds long-horizon, tool-heavy tasks with sandboxed evaluation.

The lab's context evidence should therefore include:

- selection quality: recall, precision, rank, coverage, freshness, and abstention;
- transformation quality: compression loss, summary fidelity, ordering, serialization validity, and source lineage;
- model use: whether the needed item was cited, used in a tool argument, reflected in the answer, or ignored;
- execution effects: extra retrieval/tool calls, blocked or repeated actions after compaction, recovery quality, and scope violations;
- systems effects: input/output tokens, cached tokens, memory/storage work, latency, throughput, and failures; and
- task effects: answer correctness, calibrated refusal, groundedness, and reproducibility across repeated runs.

This keeps the lab from rewarding a context strategy that merely puts more material into the window or produces a plausible answer once.

## What the wider ecosystem is doing

### OpenAI

OpenAI exposes several distinct state paths. The Responses and Conversations APIs can persist messages, tool calls, tool outputs, and other items with a durable conversation identifier. Developers can also chain responses with `previous_response_id`, or construct the full input themselves. The API documentation explicitly treats context-window management and compaction as separate concerns. ([Conversation state](https://developers.openai.com/api/docs/guides/conversation-state), [compaction](https://developers.openai.com/api/docs/guides/compaction))

The OpenAI Agents SDK makes another distinction that matters for the lab: local application context is available to tools and callbacks but is not automatically sent to the model. Model-visible context must enter through the model input, instructions, tools, or retrieval. Its session layer stores conversation history, while its sandbox memory feature stores lessons in files for later runs. ([SDK context](https://openai.github.io/openai-agents-python/context/), [SDK sessions](https://openai.github.io/openai-agents-python/sessions/), [sandbox memory](https://openai.github.io/openai-agents-python/sandbox/memory/))

OpenAI's current agent direction also combines automatic compaction, tool search, and programmatic tool calling. Tool search reduces the tool definitions loaded up front. Programmatic tool calling lets code run several calls and return only the useful result to the model. These reduce context pressure in different ways and must be measured as separate factors. ([Agents API announcement](https://openai.com/index/introducing-the-agents-api/), [tool search](https://developers.openai.com/api/docs/guides/tools-tool-search), [programmatic tool calling](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling))

### Google

Google's current Interactions API treats an interaction as a stored turn containing execution steps, including model output and tool calls/results. A later request can continue from `previous_interaction_id`, or the caller can opt into stateless operation. The API also exposes observable execution steps and background execution. Google separately reports cached-token usage and recommends stable prefixes for cache reuse. ([Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview), [context caching](https://ai.google.dev/gemini-api/docs/caching))

Google Cloud's Agent Engine separates sessions from long-term Memory Bank. Sessions store user interactions. Memory Bank can generate memories from sessions and retrieve them by scope or similarity. The retrieval scope is exact, which makes user, tenant, and task isolation testable rather than incidental. ([Agent Engine sessions](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/sessions/manage-sessions-api), [Memory Bank retrieval](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/fetch-memories))

Google's Agent Development Kit also documents persistent code-execution sandboxes. Variables, imported modules, and files can survive across tool calls in one workflow session. That is a useful reminder that working state does not always belong in the conversation transcript. ([ADK persistent code execution](https://google.github.io/adk-docs/tools/google-cloud/code-exec-agent-engine/))

### Microsoft

Microsoft Foundry Agent Service models an agent runtime around agents, conversations, and responses. Its preview memory store injects persistent memories as additional context and updates memories after responses, with delayed writes controlled by an update delay. Its durable state store is explicitly for checkpoints, application-managed history, intermediate artifacts, and preferences that must survive container restarts. ([Foundry runtime components](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/runtime-components), [Foundry memory](https://learn.microsoft.com/en-us/azure/foundry/agents/quickstarts/quickstart-memory-hosted-agent), [durable state store](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/agent-state-store))

Microsoft's open Agent Framework documents sessions, context providers, storage, compaction, and chat-history memory as different pieces. Its hosting guidance recommends separating append-heavy history from lightweight session state, rather than rewriting one large session object on every turn. ([Agent Framework conversations and memory](https://learn.microsoft.com/en-us/agent-framework/agents/conversations/), [storage](https://learn.microsoft.com/en-us/agent-framework/agents/conversations/storage), [self-hosting state](https://learn.microsoft.com/en-us/agent-framework/hosting/self-hosting/))

Microsoft's Azure AI Search agentic retrieval is another distinct layer. It can use conversation history to generate parallel subqueries, semantically rerank results, and return both grounding data and an activity log. This belongs in retrieval and context assembly experiments, not in the memory store itself. ([Agentic retrieval overview](https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-overview))

### AWS

Amazon Bedrock distinguishes per-turn prompt session attributes, session attributes that persist within a session, and conversation history. Its session-state object can also carry files and action invocation context. Bedrock's older Agents Classic memory feature summarizes completed sessions asynchronously and retains those summaries for a configured period. ([Session context](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-session-state.html), [Agents memory](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-memory.html))

AWS's newer AgentCore documentation makes the durability boundary explicit: session state is ephemeral, while AgentCore Memory is intended for durable context. Bedrock session-management APIs also support checkpoints for open-source workflows such as LangGraph and LlamaIndex, including resumption after interruption. ([AgentCore developer guide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory.html), [session management](https://docs.aws.amazon.com/bedrock/latest/userguide/sessions.html))

This gives the lab two AWS-inspired cases to test separately: a session-scoped working state and a durable memory service. They should not be represented as one storage strategy.

### Meta and Llama Stack

Llama Stack takes a more infrastructure-oriented approach. Its open-source server defines composable APIs for inference, agents, tools, MCP, files, vector stores, and evaluation, with pluggable providers. The same application can run against different models and infrastructure. That makes it useful as a portability reference, but its abstraction does not decide which memory policy is correct. ([Llama Stack repository](https://github.com/llamastack/llama-stack))

Meta's current retrieval research is relevant even when it is not labelled memory. SIRA treats retrieval as a corpus-aware operation: it enriches documents offline, expands queries with missing evidence vocabulary, and uses corpus statistics to filter terms before retrieval. This suggests that retrieval quality depends on both query construction and index preparation, not only on the final vector similarity call. The paper is published by Meta AI but is still an author-reported research result. ([SIRA](https://ai.meta.com/research/publications/superintelligent-retrieval-agent-the-next-frontier-of-agentic-retrieval/))

### Open-source runtimes and frameworks

LangGraph makes the split very explicit. Short-term memory is thread-scoped graph state stored by a checkpointer. Long-term memory is stored separately and can be shared across threads. Checkpoints support resume, human approval, replay, and branching, while the store supports cross-session memory and semantic search. ([LangGraph memory](https://docs.langchain.com/oss/python/langgraph/add-memory), [persistence](https://docs.langchain.com/oss/python/langgraph/persistence), [context concepts](https://docs.langchain.com/oss/python/concepts/context))

LlamaIndex distinguishes workflow `Context`, which carries runtime state needed to resume a workflow, from `Memory`, which contains chat messages and optional long-term memory blocks. In a human-in-the-loop workflow, both may be needed. ([LlamaIndex memory and workflow context](https://github.com/run-llama/llama_index/blob/main/docs/src/content/docs/framework/module_guides/deploying/agents/memory.mdx))

Letta takes the opposite end of the design space from a purely retrieval-first system. Persistent, editable memory blocks are injected into the context while attached. Blocks can be attached, detached, shared across agents, and changed at runtime. Letta also exposes archival memory as a searchable store. This is a good case for testing always-visible memory versus query-on-demand memory. ([Letta memory blocks](https://docs.letta.com/tutorials/attaching-detaching-blocks/), [Letta passages](https://docs.letta.com/api/python/resources/agents/subresources/passages))

Hugging Face smolagents keeps the implementation small and inspectable. Its `AgentMemory` contains the system prompt and per-step task, planning, action, observation, and error records. It supports full and succinct views, replay, and step-by-step execution. This is useful for a baseline where the trajectory itself is the working memory. ([smolagents memory](https://huggingface.co/docs/smolagents/en/tutorials/memory), [AgentMemory reference](https://huggingface.co/docs/smolagents/reference/agents))

Mistral's Agents and Conversations APIs provide another provider-side comparison. Agents hold model, instructions, tools, and completion settings. Conversations persist entries such as messages and tool executions and can continue by conversation ID, while callers can opt out of cloud storage. ([Mistral Agents and Conversations](https://docs.mistral.ai/studio/agents/agents-api))

## What the independent 2026 research adds

The most useful recent research is not a vendor leaderboard. It is the growing set of tests that isolate memory, context pressure, and long-horizon reliability.

- **MemoryAgentBench and AMemGym** test memory under incremental, interactive changes rather than a static block of history. AMemGym uses state-dependent questions and evolving user profiles. MemoryAgentBench evaluates abilities such as updating and overwriting facts. ([AMemGym, ICLR 2026](https://proceedings.iclr.cc/paper_files/paper/2026/hash/0856bc553d3e3b9827e5140d0ad3bf8d-Abstract-Conference.html), [MemoryAgentBench, ICLR 2026 overview](https://graphastra.com/en/papers/f7a25873-5616-417f-964a-04b9fc03d3ce))
- **Memory-R1** treats memory management as a policy with `ADD`, `UPDATE`, `DELETE`, and `NOOP` operations, rather than only a retrieval query. It is an ACL 2026 paper, but its gains are tied to a trained memory manager and should not be compared directly with an inference-only baseline. ([Memory-R1, ACL 2026](https://aclanthology.org/2026.acl-long.583/))
- **LightMem** separates short-term, middle-term, and long-term memory, with online filtering and consolidation plus offline sleep-time updates. It reports accuracy, token, and runtime trade-offs on its chosen benchmarks. Those numbers are evidence about that method and benchmark, not a general ranking. ([LightMem, ICLR 2026](https://proceedings.iclr.cc/paper_files/paper/2026/hash/a05b72653ec5b473732129829ae04195-Abstract-Conference.html))
- **Scroll, TRACE, and related context-management work** treat context as an addressable environment or test the execution immediately after a compression boundary. Their useful contribution is methodological: retain a recoverable source of truth, compare the exact transformed context, and measure whether compression causes blocked or repeated actions. These papers are preprints and need reproduction. ([Scroll](https://arxiv.org/abs/2608.21690), [TRACE](https://arxiv.org/abs/2608.06503), [ACM](https://arxiv.org/abs/2607.23809))
- **LOCA-bench, MINTEval, MemoryArena, and MemGym** move beyond one retrieved "needle." They vary context growth, updates, interference, multi-session dependencies, or memory-isolated comparisons. This is closer to the lab's intended use than a single long-context question. ([LOCA-bench](https://arxiv.org/abs/2602.07962), [MINTEval](https://arxiv.org/abs/2605.18565), [MemoryArena](https://arxiv.org/abs/2602.16313), [MemGym](https://arxiv.org/abs/2605.20833))
- **Repeated-run reliability work** argues for pass^k, reliability decay, variance amplification, partial credit, and loop onset. A context strategy that succeeds once but becomes unstable over repeated long runs is not production-ready. ([Beyond pass@1](https://arxiv.org/abs/2603.29231))

## Design implications for the lab

The lab should implement one agent runtime with replaceable policies, not a collection of disconnected context demos. The minimum boundary is:

```text
Scenario
  -> canonical event/state store
  -> memory writer and memory retriever
  -> context assembler
  -> model/tool loop
  -> append events, update state, write memory
```

The store is the control. Strategies operate on the same canonical source universe. A strategy may summarize, rank, retrieve, page, evict, externalize, or expose state through tools, but the original events remain available for audit and replay.

Memory and context should be introduced in one vertical slice, with separate toggles and metrics:

| Layer | Research variable | Evidence to record |
| --- | --- | --- |
| Session state | in-memory, append-only, checkpointed, or provider-managed | event order, versions, restart/resume result |
| Memory writing | none, every turn, milestone, background, or agent-controlled | writes, updates, deletes, deduplication, write cost |
| Memory retrieval | none, recency, lexical, semantic, hybrid, scoped | query, candidates, scores, misses, stale hits |
| Context assembly | full, sliding, summarized, ranked, paged, programmatic | exact model-visible items, source IDs, token budget |
| Tool context | all tools, selected tools, searched tools, programmatic results | definitions sent, result bytes, calls, cache hits |
| Recovery | restart, lost acknowledgement, failed write, stale memory, duplicate event | recovery path, duplicate side effects, final state |

Do not call all of these "memory." A retrieved document, an editable user profile, a checkpoint, a tool result, and a lossy summary may all reach the model, but they have different lifetimes, ownership, failure modes, and evidence requirements.

## First research program

Start with one scenario family and add strategies in pairs so the results remain interpretable.

1. **Reference:** full event history while it fits, then an explicit overflow error.
2. **Lossy context:** fixed sliding window and fixed-trigger summary.
3. **Recoverable context:** append-only history plus lexical or semantic retrieval into a bounded working view.
4. **Memory lifecycle:** no long-term memory, write-after-turn, milestone write, and background consolidation.
5. **Agent-controlled operations:** expose search, save, update, discard, and restore as tools. Keep this separate from a trained memory manager.
6. **Provider mechanisms:** compare native compaction, prompt caching, tool search, and programmatic tool calls only after the local reference strategies work.

Once that baseline is stable, widen the matrix by context dimension rather than by vendor feature:

- **representation:** raw messages, typed events, structured state, references, and artifacts;
- **selection:** full history, recency, relevance, hybrid ranking, summaries, paging, and model-requested retrieval;
- **retrieval:** lexical, dense, hybrid, reranked, query-decomposed, corpus-aware, and citation-producing;
- **tool context:** all schemas, filtered schemas, search-loaded schemas, programmatic calls, and structured or externalized results;
- **runtime state:** stateless replay, provider-managed sessions, checkpoints, sandbox files, and in-process state;
- **serving:** uncached input, provider prompt cache, local prefix/KV cache, and cache invalidation after context edits;
- **modality:** text, structured documents, images, audio, video, screenshots, and generated artifacts; and
- **integrity:** trusted versus untrusted sources, scope filters, freshness, conflict resolution, provenance, and injection handling.

These dimensions should not all be crossed at once. Use a staged factorial or pairwise design after the first vertical slice, and preserve a full-context oracle plus a no-retrieval/no-memory control. This lets the lab distinguish loss caused by representation, retrieval, memory formation, context packing, provider serialization, or model capability.

Hold constant the model snapshot, prompt, tools, environment, grader, output reserve, decoding, seed policy, and resource limits. Run each condition at fixed pressure levels and across session boundaries. Use the same task for context-only inspection, paired continuation after a transformation, and full trajectory execution.

The first scenario should contain:

- an important early fact;
- a later correction to that fact;
- a two-hop dependency;
- a large structured tool result with one relevant region;
- distractor events;
- one untrusted tool field;
- a session restart;
- a final-state grader and partial-credit grader.

The run should produce the exact prepared model input, every memory/context decision, the complete trajectory, and metrics for task quality, source coverage, revision correctness, retrieval misses, manager cost, latency, token usage, loops, recovery, and safety. The result view can stay small. The evidence cannot.

## Source quality and interpretation

- First-party documentation is strong evidence for the existence and shape of a mechanism. It is not neutral evidence that the mechanism improves agent quality.
- ICLR, ACL, AAAI, and similar proceedings provide stronger evidence than an unreviewed preprint, but every result still depends on its task, model, prompts, grader, and training setup.
- Vendor previews and beta APIs may change. Record provider, model, API/SDK version, feature flags, date, storage mode, and retention settings in every run.
- Large context windows and caching address serving cost and capacity. They do not prove that the model will use old information correctly.
- Durable storage does not guarantee useful memory. A write can be wrong, retrieval can miss, a stale fact can outrank a new one, and a model may never issue the query.
- Learned memory managers and model-level compression are separate experiment families because they change the policy or the model, not only the surrounding harness.

## Recommended next step

Keep the current UI out of this decision for now. Build the backend contracts for a canonical event log, a memory interface, a context-assembly interface, and run evidence first. Then expose only the small set of variables needed for the first scenario. The interface should reveal the experiment's changed variable and the evidence it produced, not every mechanism the ecosystem contains.
