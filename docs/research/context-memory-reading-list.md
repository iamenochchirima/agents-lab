# Context and memory reading list

**Reviewed:** 2026-09-17
**Purpose:** A study index for context engineering, agent memory, retrieval, persistence, and long-horizon evaluation.

## How to read the labels

- **Official:** Documentation or source from the organization that maintains the product or project. Good for understanding a mechanism, not for proving that it is best.
- **Peer-reviewed:** Published in a conference or journal. Still judge the task, model, training setup, grader, and baselines.
- **Preprint:** Useful current research that has not necessarily completed peer review. Treat reported scores as claims to reproduce.
- **Local note:** A research or code-reading note already in this repository.

## Start with the local notes

1. [Evaluating context engineering for long-horizon agents](context-engineering-2026.md) — experiment contract, context inputs and outputs, strategy families, metrics, controls, and a first scenario.
2. [Context and memory engineering across agent ecosystems](context-engineering-ecosystem-2026.md) — comparison of OpenAI, Google, Microsoft, AWS, Meta/Llama Stack, Mistral, open-source runtimes, and 2026 research.
3. [Context management reference review](context-management-reference.md) — implementation reading of Hermes, OpenClaw, and Waku, with boundaries and invariants.
4. [Hermes code map](harness-code-maps/hermes.md) — phase-oriented turn context, request assembly, compaction, persistence, tools, and trajectory records.
5. [OpenClaw code map](harness-code-maps/openclaw.md) — prepared turns, runtime selection, sessions, compaction, permissions, and execution ownership.
6. [Waku code map](harness-code-maps/waku.md) — recent history windows, conditional memory retrieval, consolidation, SQLite state, and tracing.

## Broader context-engineering references

These are the sources to study before narrowing the first context experiment. They cover the model-visible input itself, not just long-term memory.

1. [Open Responses specification](https://github.com/openresponses/openresponses) — typed context items, tool calls and outputs, semantic streaming events, provider-neutral extensions, and compliance tests. **Official open-source specification.**
2. [A2A Protocol 1.0](https://github.com/a2aproject/A2A/blob/main/docs/specification.md) — tasks, messages, parts, artifacts, file references, modalities, and agent capability discovery. **Official open specification.**
3. [OpenAI Model Spec](https://github.com/openai/model_spec) — instruction authority, roles, tool results, and trusted versus untrusted content. **Official specification.**
4. [OpenAI latest model guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.5) — current guidance for Responses state, structured outputs, prompt caching, tool-heavy workflows, phases, and replay. **Official.**
5. [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) — schema-constrained model output versus function calling and JSON mode. **Official.**
6. [OpenAI File Search](https://developers.openai.com/api/docs/guides/tools-file-search) — semantic and keyword retrieval, result limits, citations, and inspecting retrieved results. **Official.**
7. [OpenAI Retrieval](https://developers.openai.com/api/docs/guides/retrieval) — vector-store ingestion, chunking, embeddings, attributes, expiration, and search. **Official.**
8. [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) — stable prefixes, cache keys, breakpoints, cached-token accounting, and invalidation. **Official.**
9. [Gemini long context](https://ai.google.dev/gemini-api/docs/long-context) — multimodal long inputs, multiple-needle limits, query placement, latency, and caching. **Official.**
10. [Gemini File Search](https://ai.google.dev/gemini-api/docs/file-search) — file ingestion, semantic retrieval, multimodal embeddings, page/media citations, and limitations. **Official.**
11. [Gemini URL context](https://ai.google.dev/gemini-api/docs/url-context) — URL-backed context with retrieval metadata and source-specific analysis. **Official.**
12. [Gemini document understanding](https://ai.google.dev/gemini-api/docs/document-processing) — PDF text, page rendering, visual interpretation, resolution controls, and document limits. **Official.**
13. [Gemini video understanding](https://ai.google.dev/gemini-api/docs/video-understanding) — file-backed video context, timestamp grounding, frame selection, audio, transcripts, and token accounting. **Official.**
14. [Anthropic context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows) — what counts toward the window, tool results, images, documents, thinking, token counting, and context rot. **Official.**
15. [Anthropic context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) — tool-result clearing, thinking-block handling, thresholds, invalidation, and applied-edit telemetry. **Official.**
16. [Anthropic tool context management](https://platform.claude.com/docs/en/agents-and-tools/tool-use/manage-tool-context) — tool search, programmatic calls, prompt caching, and context editing as separate controls. **Official.**
17. [Anthropic search-result blocks](https://platform.claude.com/docs/en/build-with-claude/search-results) — structured retrieved evidence, source identifiers, citations, and cache controls. **Official.**
18. [Model Context Protocol specification](https://modelcontextprotocol.io/specification/2025-06-18) — resources, prompts, tools, sampling, roots, elicitation, pagination, and consent boundaries. **Official open specification.**
19. [MCP 2026 specification update](https://blog.modelcontextprotocol.io/posts/2026-07-28/) — stateless per-request operation, cacheable list results, extensions, and security hardening. **Official project update.**
20. [MCP authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) — resource indicators, token audience binding, PKCE, token passthrough prohibitions, and confused-deputy defenses. **Official.**
21. [Hugging Face chat templates](https://huggingface.co/docs/transformers/main/en/chat_templating) — conversion from structured messages to model-specific token sequences and tool-use templates. **Official open-source docs.**
22. [Hugging Face multimodal chat templates](https://huggingface.co/docs/transformers/main/chat_templating_multimodal) — mixed text/image/audio/video content, processor behavior, and multimodal serialization. **Official open-source docs.**
23. [Hugging Face KV-cache strategies](https://huggingface.co/docs/transformers/main/en/kv_cache) — dynamic, static, quantized, offloaded, and sliding-window serving caches. **Official open-source docs.**
24. [vLLM Automatic Prefix Caching](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/) — serving-level KV-cache reuse for shared prefixes and its limits. **Official open-source docs.**
25. [AWS Knowledge Bases retrieval](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-how-retrieval.html) — explicit retrieval, reranking, citations, structured-data queries, and iterative agentic retrieval. **Official.**
26. [Azure AI Search agentic retrieval](https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-overview) — query decomposition, parallel retrieval, semantic reranking, grounding data, and activity logs. **Official, preview.**
27. [Microsoft Foundry Toolbox](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/toolbox-overview) — tool discovery, credentials, governance, skills, and tool-definition context. **Official, preview.**
28. [OpenAI prompt-injection defenses](https://openai.com/index/designing-agents-to-resist-prompt-injection/) — source-to-sink threat framing, sandboxing, confirmation gates, and data-flow controls. **Official security research.**
29. [Anthropic/NIST agentic security submission](https://www-cdn.anthropic.com/43ec7e770925deabc3f0bc1dbf0133769fd03812.pdf) — indirect prompt injection through web content, documents, and tool outputs. **Industry submission; use for threat framing, not product claims.**
30. [AWS prompt-attack detection](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-prompt-attack.html) — jailbreaks, direct injection, indirect attacks, and input tagging. **Official.**
31. [ContextBench: context retrieval in coding agents](https://arxiv.org/abs/2602.05892) — trajectory-level context recall, precision, and efficiency. **2026 preprint with public benchmark code.**
32. [ContextBench: context modification](https://proceedings.iclr.cc/paper_files/paper/2026/hash/20f94ae24649f4f97a8296b4c1f29358-Abstract-Conference.html) — how context transformations change target behavior. **ICLR 2026.**
33. [AgencyBench](https://github.com/GAIR-NLP/AgencyBench) — long-horizon, tool-heavy agent tasks with sandboxed evaluation and explicit deliverables. **2026 benchmark repository.**

## Provider and platform documentation

### OpenAI

1. [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state) — manual history, Conversations API, `previous_response_id`, storage, context-window limits, and compaction links. **Official.**
2. [Compaction](https://developers.openai.com/api/docs/guides/compaction) — server-side and explicit compaction controls. **Official.**
3. [Compact conversation API](https://developers.openai.com/api/reference/java/resources/beta/subresources/responses/methods/compact) — compact endpoint and opaque compaction items. **Official.**
4. [Agents SDK context](https://openai.github.io/openai-agents-python/context/) — local runtime context versus context visible to the model. **Official.**
5. [Agents SDK sessions](https://openai.github.io/openai-agents-python/sessions/) — session-backed conversation history, persistence, and resumption. **Official.**
6. [Agents SDK tracing](https://openai.github.io/openai-agents-python/tracing/) — traces and spans for model calls, tools, handoffs, guardrails, and custom events. **Official.**
7. [Agents SDK sandbox memory](https://openai.github.io/openai-agents-python/sandbox/memory/) — lessons stored in sandbox files, separate from conversational session memory. **Official, beta.**
8. [Agents API announcement](https://openai.com/index/introducing-the-agents-api/) — current direction around durable sessions, automatic compaction, tool search, and programmatic tool calls. **Official product announcement.**
9. [Tool search](https://developers.openai.com/api/docs/guides/tools-tool-search) — loading relevant tool definitions on demand. **Official.**
10. [Programmatic tool calling](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling) — running and filtering tool calls in code before returning results to the model. **Official.**
11. [Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/) — context assembly, tool-result accumulation, and continuation in a long-running agent loop. **Official engineering note.**
12. [Inside OpenAI's in-house data agent](https://openai.com/index/inside-our-in-house-data-agent/) — code-enriched context, organizational context, and continuous memory in a production-oriented case study. **Official case study.**
13. [Computer environments in the Responses API](https://openai.com/index/equip-responses-api-computer-environment/) — persistent containers, skills, shell tools, and context compaction. **Official product announcement.**
14. [Responses API create reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create) — typed input items, context-management configuration, tool outputs, files, images, and encrypted reasoning content. **Official API reference.**

### Anthropic

1. [Managed agents](https://www.anthropic.com/engineering/managed-agents) — durable append-only session logs, harness context policy, and separated sandbox execution. **Official engineering note.**
2. [Harness design for long-running applications](https://www.anthropic.com/engineering/harness-design-long-running-apps) — structured artifacts, evaluator loops, and one-component-at-a-time ablations. **Official engineering note.**
3. [Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction) — server-side compaction, triggers, compaction blocks, and continuation controls. **Official.**
4. [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) — clearing tool results and thinking blocks, plus compaction. **Official.**
5. [Managing tool context](https://platform.claude.com/docs/en/agents-and-tools/tool-use/manage-tool-context) — tool search, programmatic calls, caching, and tool-result clearing. **Official.**
6. [Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling) — keeping intermediate data outside the model conversation where possible. **Official.**
7. [Context engineering tools cookbook](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools) — measuring context trajectories, tool counts, latency, compaction, and tool-result handling. **Official cookbook.**
8. [Managed agent memory](https://platform.claude.com/docs/en/managed-agents/memory) — workspace-scoped memory with versioned changes and audit history. **Official.**

### Google and Vertex AI

1. [Gemini Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview) — stored interaction steps, `previous_interaction_id`, stateless mode, background execution, and observable execution. **Official.**
2. [Gemini context caching](https://ai.google.dev/gemini-api/docs/caching) — implicit caching, prefix placement, cache thresholds, and cached-token metrics. **Official.**
3. [Gemini long context](https://ai.google.dev/gemini-api/docs/long-context) — long-input handling, caching guidance, and latency considerations. **Official.**
4. [Gemini agents overview](https://ai.google.dev/gemini-api/docs/agents) — managed agents, context management, tools, files, and web or code environments. **Official, preview.**
5. [Agent Engine sessions](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/sessions/manage-sessions-api) — session creation, user scoping, and expiry. **Official, preview.**
6. [Agent Engine Memory Bank retrieval](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/fetch-memories) — scope-based and similarity-based memory retrieval. **Official, preview.**
7. [Agent Engine overview](https://cloud.google.com/vertex-ai/generative-ai/docs/reasoning-engine/overview?authuser=3) — sessions, context management, example stores, evaluation, and observability. **Official.**
8. [ADK persistent code execution](https://google.github.io/adk-docs/tools/google-cloud/code-exec-agent-engine/) — stateful sandboxes where variables, modules, and files persist across tool calls. **Official.**
9. [Memory Bank public preview](https://cloud.google.com/blog/products/ai-machine-learning/vertex-ai-memory-bank-in-public-preview) — background memory generation from Agent Engine sessions. **Official product post.**

### Microsoft

1. [Foundry Agent Service runtime components](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/runtime-components) — agents, conversations, responses, and attached memory stores. **Official.**
2. [Foundry hosted-agent memory quickstart](https://learn.microsoft.com/en-us/azure/foundry/agents/quickstarts/quickstart-memory-hosted-agent) — semantic memory creation, retrieval before a turn, and delayed memory updates. **Official, preview.**
3. [Foundry durable state store](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/agent-state-store) — checkpoints, application history, artifacts, preferences, optimistic concurrency, and restart survival. **Official, preview.**
4. [Agent Framework conversations and memory](https://learn.microsoft.com/en-us/agent-framework/agents/conversations/) — sessions, context providers, persistence, and memory. **Official.**
5. [Agent Framework storage](https://learn.microsoft.com/en-us/agent-framework/agents/conversations/storage) — local session state, service-managed history, and custom storage. **Official.**
6. [Agent Framework self-hosting](https://learn.microsoft.com/en-us/agent-framework/hosting/self-hosting/) — what session state must contain for resume and why history and session storage may be separated. **Official.**
7. [Azure AI Search agentic retrieval](https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-overview) — query decomposition, parallel retrieval, semantic reranking, grounding data, and activity logs. **Official, preview.**

### AWS

1. [Bedrock session context](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-session-state.html) — prompt-session attributes, session attributes, conversation history, files, and action context. **Official.**
2. [Bedrock agent memory](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-memory.html) — cross-session summaries, memory identifiers, retention, and asynchronous summarization. **Official, Agents Classic.**
3. [Bedrock session management APIs](https://docs.aws.amazon.com/bedrock/latest/userguide/sessions.html) — checkpoints and resumption for multi-step workflows and open-source frameworks. **Official, preview.**
4. [Bedrock AgentCore memory](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory.html) — the boundary between ephemeral session state and durable agent memory. **Official.**

### Meta, Mistral, Cohere, and Hugging Face

1. [Llama Stack](https://github.com/llamastack/llama-stack) — composable inference, agents, tools, MCP, files, vector stores, and evaluation with pluggable providers. **Official open source.**
2. [SIRA, Superintelligent Retrieval Agent](https://ai.meta.com/research/publications/superintelligent-retrieval-agent-the-next-frontier-of-agentic-retrieval/) — corpus-aware query expansion and retrieval preparation. **Meta AI research.**
3. [Mistral Agents and Conversations](https://docs.mistral.ai/studio/agents/agents-api) — agents, persistent conversations, tool executions, and optional cloud storage. **Official.**
4. [Cohere short-term memory for agents](https://docs.cohere.com/page/agent-short-term-memory) — preserving useful intermediate agent steps without replaying every reasoning detail. **Official cookbook.**
5. [Hugging Face smolagents memory tutorial](https://huggingface.co/docs/smolagents/en/tutorials/memory) — inspectable, replayable, mutable per-step agent memory. **Official open-source docs.**
6. [Hugging Face AgentMemory reference](https://huggingface.co/docs/smolagents/reference/agents) — full and succinct memory views, reset, replay, and step execution. **Official open-source docs.**
7. [Haystack Agent](https://docs.haystack.deepset.ai/docs/agent) — runtime state, dynamic tool selection, messages, and state schemas. **Official open-source docs.**

## Open-source harness implementations

These are especially useful for understanding where context and memory boundaries appear in real code.

### Hermes

- [Repository](https://github.com/NousResearch/hermes-agent)
- [Architecture](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a/website/docs/developer-guide/architecture.md)
- [Agent loop](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a/website/docs/developer-guide/agent-loop.md)
- [Prompt assembly](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a/website/docs/developer-guide/prompt-assembly.md)
- [Context compression and caching](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a/website/docs/developer-guide/context-compression-and-caching.md)
- [Tools runtime](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a/website/docs/developer-guide/tools-runtime.md)
- [Session storage](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a/website/docs/developer-guide/session-storage.md)
- [Trajectory format](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a/website/docs/developer-guide/trajectory-format.md)

### OpenClaw

- [Repository](https://github.com/openclaw/openclaw)
- [Agent runtime architecture](https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/docs/agent-runtime-architecture.md)
- [Workspace and bootstrap](https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/docs/gateway/config-agents/workspace-and-bootstrap.md)
- [Core ownership](https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/docs/plugins/sdk-agent-harness/core-ownership.md)
- [Sessions, compaction, and streaming](https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/docs/gateway/config-agents/heartbeat-compaction-and-streaming.md)
- [Tool policy](https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/docs/gateway/config-tools/tool-policy.md)
- [Sandboxing](https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/docs/gateway/sandboxing.md)

### Waku

- [Repository](https://github.com/ShenSeanChen/waku-agent)
- [Architecture](https://github.com/ShenSeanChen/waku-agent/blob/4a615acd9dff66015c74b96a9a11e92963fbeb35/docs/architecture.md)
- [Memory backends playbook](https://github.com/ShenSeanChen/waku-agent/blob/4a615acd9dff66015c74b96a9a11e92963fbeb35/docs/memory-backends-playbook.md)
- [Memory-native examples](https://github.com/ShenSeanChen/waku-agent/blob/4a615acd9dff66015c74b96a9a11e92963fbeb35/examples/memory-native/README.md)
- [Tiny memory agent](https://github.com/ShenSeanChen/waku-agent/blob/4a615acd9dff66015c74b96a9a11e92963fbeb35/examples/tiny_memory_agent.py)

### Other runtime references

- [LangGraph memory](https://docs.langchain.com/oss/python/langgraph/add-memory) — thread-scoped short-term state and cross-thread long-term stores.
- [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence) — checkpoints, resume, time travel, fault tolerance, and pending writes.
- [LangGraph context concepts](https://docs.langchain.com/oss/python/concepts/context) — static runtime context, dynamic run state, and cross-conversation context.
- [LangGraph time travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel) — replay and branching from checkpoints.
- [LangGraph Deep Agents memory](https://docs.langchain.com/oss/python/deepagents/memory) — filesystem-backed agent-scoped, user-scoped, and background memory.
- [LlamaIndex memory and workflow context](https://github.com/run-llama/llama_index/blob/main/docs/src/content/docs/framework/module_guides/deploying/agents/memory.mdx) — separate workflow resume state from chat and long-term memory.
- [Letta memory blocks](https://docs.letta.com/tutorials/attaching-detaching-blocks/) — persistent editable blocks that can be attached or detached at runtime.
- [Letta passages](https://docs.letta.com/api/python/resources/agents/subresources/passages) — archival memory creation, listing, deletion, and search.
- [Letta shared memory](https://docs.letta.com/guides/agents/multi-agent-parallel-execution/) — shared archival memory for parallel agents.

## 2026 peer-reviewed research

1. [AMemGym: Interactive Memory Benchmarking for Assistants in Long-Horizon Conversations](https://proceedings.iclr.cc/paper_files/paper/2026/hash/0856bc553d3e3b9827e5140d0ad3bf8d-Abstract-Conference.html) — interactive, on-policy memory evaluation with evolving user state. **ICLR 2026.**
2. [LightMem: Lightweight Memory Management for Long-Term Conversation](https://proceedings.iclr.cc/paper_files/paper/2026/hash/a05b72653ec5b473732129829ae04195-Abstract-Conference.html) — short-, middle-, and long-term memory with online and offline consolidation. **ICLR 2026.**
3. [Memory-R1](https://aclanthology.org/2026.acl-long.583/) — trained memory manager with `ADD`, `UPDATE`, `DELETE`, and `NOOP` operations. **ACL 2026.**
4. [Grounding Agent Memory in Contextual Intent](https://aclanthology.org/2026.findings-acl.584.pdf) — memory retrieval under evolving intent and long-horizon trajectories. **Findings of ACL 2026.**
5. [Agentic Memory: Learning Unified Long-Term and Short-Term Memory](https://aclanthology.org/2026.acl-long.981.pdf) — jointly trained long-term memory and short-term context management. **ACL 2026.**
6. [H-Mem](https://aclanthology.org/2026.eacl-long.363.pdf) — hierarchical memory organized by time and semantics with formation and hybrid retrieval pipelines. **EACL 2026.**
7. [From Storage to Experience: A Survey on the Evolution of LLM Agent Memory Mechanisms](https://aclanthology.org/2026.findings-acl.2069.pdf) — survey of memory mechanisms and benchmark families. **Findings of ACL 2026.**
8. [A memory fabric for conversational AI agents](https://doi.org/10.1007/s44163-026-00992-z) — review of shared and persistent multi-user memory systems. **Discover Artificial Intelligence, 2026.**
9. [AgentClinic](https://doi.org/10.1038/s41746-026-02674-7) — experiential memory from solved cases for multimodal clinical agents. **npj Digital Medicine, 2026.**
10. [ContextBench: Context Modification](https://proceedings.iclr.cc/paper_files/paper/2026/hash/20f94ae24649f4f97a8296b4c1f29358-Abstract-Conference.html) — benchmark for measuring how context modifications elicit or suppress target behaviours. **ICLR 2026.**
11. [MCP-AgentBench](https://doi.org/10.1609/aaai.v40i37.40347) — outcome-oriented evaluation of agents using many MCP servers and tools. **AAAI 2026.**

## 2026 preprints and emerging work

1. [Scroll: Context as an Environment](https://arxiv.org/abs/2608.21690) — append-only events, persistent namespaces, explicit working views, and recoverable eviction.
2. [TRACE: Reliable Context Compression](https://arxiv.org/abs/2608.06503) — paired continuation after compression, with blocked and repeated-action detection.
3. [ACM: Agentic Context Management for Long Horizon Tasks](https://arxiv.org/abs/2607.23809) — agent-controlled compression, offloading, and retrieval.
4. [CompactionRL](https://arxiv.org/abs/2607.05378) — reinforcement learning for context compaction.
5. [AdaCoM](https://arxiv.org/abs/2605.30785) — learned agent-compatible context management.
6. [MEMENTO](https://arxiv.org/abs/2604.09852) — learned summaries combined with residual KV state.
7. [LOCA-bench](https://arxiv.org/abs/2602.07962) — controllable context growth while task semantics stay fixed.
8. [MINTEval](https://arxiv.org/abs/2605.18565) — multiple memory targets, updates, and interference.
9. [MemGym](https://arxiv.org/abs/2605.20833) — memory-isolated evaluation in long-horizon environments.
10. [MemoryArena](https://arxiv.org/abs/2602.16313) — interdependent multi-session agentic tasks where earlier experience affects later subtasks.
11. [Agent Memory](https://arxiv.org/abs/2606.06448) — phase-aware profiling of memory construction, retrieval, and generation costs.
12. [Beyond pass@1](https://arxiv.org/abs/2603.29231) — repeated-episode reliability, pass^k, degradation, and loop onset.
13. [Contextual Agentic Memory is a Memo, Not True Memory](https://arxiv.org/abs/2604.27707) — critique of treating retrieval as memory.
14. [Memory for Autonomous LLM Agents](https://arxiv.org/abs/2603.07670) — survey of compression, retrieval, reflection, hierarchical context, and learned policies.
15. [Dynamic Long Context Reasoning over Compressed Memory](https://aclanthology.org/2026.acl-long.365.pdf) — compressed long-context reasoning, retrieval, and offloading. **ACL 2026 paper PDF.**

## Newer memory benchmarks to watch

1. [LongMemEval](https://arxiv.org/abs/2410.10813) — information extraction, multi-session reasoning, temporal reasoning, knowledge updates, and abstention. **2024 paper, ICLR 2025 context.**
2. [LongMemEval-V2](https://arxiv.org/abs/2605.12493) — whether agents acquire environment-specific experience, including workflows and recurring failure modes. **2026 preprint.**
3. [LoCoMo dataset and code](https://github.com/snap-research/locomo) — long-term conversational memory across multi-session dialogues. **ACL 2024 resource.**
4. [LoCoMo-Plus](https://arxiv.org/abs/2602.10715) — cognitive memory under semantic disconnect and latent constraints. **2026 preprint.**
5. [LOCOMO-CONV](https://arxiv.org/abs/2609.03467) — implicit, counterfactual, and composed memory use inside ongoing conversation. **2026 preprint.**
6. [MemoryAgentBench / MemAE paper](https://openreview.net/pdf?id=ZgQ0t3zYTQ) — accurate retrieval, test-time learning, long-range understanding, and conflict resolution. **OpenReview paper.**
7. [ContextBench benchmark repository](https://github.com/lasr-eliciting-contexts/ContextBench) — code and tasks for the ICLR context-modification paper.
8. [ContextBench for coding-agent context retrieval](https://contextbench.github.io/) — process-level context retrieval metrics and benchmark material. This is separate from the ICLR context-modification paper above.

## Additional methods worth studying

1. [ACON](https://arxiv.org/abs/2510.00615) — gradient-free compression of interaction history and environment observations.
2. [BEAM](https://arxiv.org/abs/2510.27246) — long coherent conversations and very long-context memory evaluation.
3. [ACE: Agentic Context Engineering](https://openreview.net/pdf?id=7JbSwX6bNL) — context compression and updating through a gradient-free workflow. **OpenReview, review status should be checked.**
4. [Lost in the Middle](https://arxiv.org/abs/2307.03172) — position sensitivity and distractor placement in long contexts.
5. [RULER](https://arxiv.org/abs/2404.06654) — controllable long-context tasks across lengths and difficulty levels.
6. [LongBench](https://arxiv.org/abs/2308.14508) — long-context evaluation across multiple task categories.
7. [ARES](https://arxiv.org/abs/2311.09476) — context relevance, answer faithfulness, and answer relevance.
8. [Prompt compression study](https://arxiv.org/abs/2407.08892) — extractive and abstractive compression trade-offs.
9. [MemGPT](https://arxiv.org/abs/2310.08560) — the earlier "LLM operating system" framing for tiered memory and virtual context.

## Suggested reading order

1. Read the three local notes first.
2. Read Open Responses, A2A, the OpenAI Model Spec, and the Hugging Face chat-template pages to understand context representation and serialization.
3. Read OpenAI, Anthropic, Google, AWS, and Azure retrieval/tool-context documentation to compare provider choices without treating any one implementation as canonical.
4. Read LangGraph persistence and LlamaIndex's context-versus-memory distinction, then Letta for always-visible editable memory.
5. Read Waku, Hermes, OpenClaw, and smolagents for inspectable implementation patterns.
6. Read ContextBench, TRAJECT-Bench, MCP-AgentBench, LongMemEval, LoCoMo, AMemGym, MemoryAgentBench, and LongMemEval-V2 to compare process and end-task evaluation designs.
7. Read the security sources alongside the retrieval and tool sources; context provenance and scope are part of the mechanism, not a late UI layer.
8. Read Scroll and TRACE for recoverable context and compression-induced execution failures.
9. Read Memory-R1, LightMem, and Agentic Memory after the inference-only baselines are clear. These change the memory policy or training setup, so they should be studied as a separate experiment family.
