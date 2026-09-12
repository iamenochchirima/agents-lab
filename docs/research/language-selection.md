# Primary-language selection: evidence review

**Status:** Research note supporting [ADR 0002](../adr/0002-language-boundary.md).

**Date reviewed:** 2026-09-12

## Question and scope

This note compares Python and TypeScript as the primary implementation language for Agent Harness Lab. It focuses on the technologies already named in the project plan: the OpenAI Agents SDK, LangGraph, Temporal, Restate, and the React/Vite UI. Hermes is included as a representative open-source, computer-oriented agent system.

The question “what do most serious agents use?” cannot be answered defensibly from this source set. The official repositories document supported languages, APIs, runtimes, and project practices; they do not provide a representative census of serious agent systems. The observations below therefore describe demonstrated support and constraints, not market share.

## Short evidence summary

- Both Python and TypeScript have official implementations for the four main agent/orchestration families examined: OpenAI Agents SDK, LangGraph, Temporal, and Restate. The implementations are not necessarily feature-identical, so “supported” should not be read as “interchangeable.” ([OpenAI Python SDK](https://github.com/openai/openai-agents-python), [OpenAI JS/TS SDK](https://github.com/openai/openai-agents-js), [LangGraph](https://github.com/langchain-ai/langgraph), [LangGraph.js](https://github.com/langchain-ai/langgraphjs), [Temporal Python SDK](https://github.com/temporalio/sdk-python), [Temporal TypeScript SDK](https://github.com/temporalio/sdk-typescript), [Restate Python SDK](https://github.com/restatedev/sdk-python), [Restate TypeScript SDK](https://github.com/restatedev/sdk-typescript))
- Python has direct evidence in Hermes’s main agent code and packaging, while Hermes’s web application is a separate React/TypeScript package. ([Hermes Python project metadata](https://github.com/NousResearch/hermes-agent/blob/main/pyproject.toml), [Hermes agent package](https://github.com/NousResearch/hermes-agent/tree/main/agent), [Hermes web package](https://github.com/NousResearch/hermes-agent/blob/main/web/package.json))
- TypeScript is already a first-party fit for the planned UI: React documents TypeScript usage, and Vite advertises fully typed APIs. ([React: Using TypeScript](https://react.dev/learn/typescript), [Vite repository](https://github.com/vitejs/vite))
- The most consequential differences are likely to be platform-specific runtime constraints, library/API shape, testing facilities, and whether the project wants one language across control-plane and UI. The sources do not establish a universal winner.

## Support matrix

| System | Python evidence | TypeScript/JavaScript evidence | What this means for the lab |
|---|---|---|---|
| OpenAI Agents SDK | The official Python SDK requires Python 3.10 or newer and documents agents, tools, handoffs, guardrails, sessions, tracing, sandbox agents, and realtime/voice paths. ([repository](https://github.com/openai/openai-agents-python), [documentation index](https://github.com/openai/openai-agents-python/blob/main/docs/index.md)) | OpenAI maintains a separate official JavaScript/TypeScript SDK. Its repository documents Node.js 22+, Deno, Bun, experimental Cloudflare Workers support, and installation through `npm`. ([repository](https://github.com/openai/openai-agents-js)) | Either language can represent an OpenAI platform implementation, but runtime and package boundaries should be captured in the platform manifest. |
| LangGraph | The official Python repository installs with `pip install -U langgraph` and describes LangGraph as a low-level framework for long-running, stateful agents. ([repository](https://github.com/langchain-ai/langgraph)) | The official LangGraph.js repository installs with `npm install @langchain/langgraph @langchain/core` and points to an equivalent Python library. ([repository](https://github.com/langchain-ai/langgraphjs)) | Both languages are directly relevant to a graph-platform comparison. The project should test the actual platform versions rather than assume the ports behave identically. |
| Temporal | Temporal’s Python SDK supports workflow and activity authoring in Python, with `async def`, threaded activities, multiprocess activities, and a custom `asyncio` event loop. ([Python SDK README](https://github.com/temporalio/sdk-python)) | Temporal’s TypeScript SDK authors workflows and activities in TypeScript or JavaScript. Its worker-level features rely on Node-specific APIs including Node-API modules, `worker_threads`, `vm`, `AsyncLocalStorage`, and `async_hooks`; the repository lists official support for Node 20, 22, and 24 on the current branch. ([TypeScript SDK README](https://github.com/temporalio/sdk-typescript)) | TypeScript is not merely a browser choice for Temporal, but its worker runtime is specifically Node-oriented. Python exposes a different concurrency and determinism surface. |
| Restate | The official Python SDK requires Python 3.10 or newer and describes Restate as distributed durable async/await. ([Python SDK README](https://github.com/restatedev/sdk-python)) | The official TypeScript SDK targets Node.js/TypeScript, supports Node.js 22 or Bun or Deno, and models applications as durably executed, stateful RPC handlers. ([TypeScript SDK README](https://github.com/restatedev/sdk-typescript)) | Both languages can be used for a Restate platform implementation. Version compatibility is explicit in both SDK repositories and should be captured for reproducibility. |
| React/Vite UI | Python is not the planned browser/UI language. | React documents TypeScript components and `.tsx` files; Vite describes fully typed APIs. ([React TypeScript guide](https://react.dev/learn/typescript), [Vite repository](https://github.com/vitejs/vite)) | The UI can be a TypeScript application even if the run controller is Python. |

## Evidence by decision dimension

### 1. Ecosystem fit for the selected platforms

The selected platform set does not force a language choice. OpenAI, LangGraph, Temporal, and Restate each publish both Python and TypeScript/JavaScript paths in official repositories or documentation. ([OpenAI Python](https://github.com/openai/openai-agents-python), [OpenAI JS/TS](https://github.com/openai/openai-agents-js), [LangGraph Python](https://github.com/langchain-ai/langgraph), [LangGraph.js](https://github.com/langchain-ai/langgraphjs), [Temporal Python](https://github.com/temporalio/sdk-python), [Temporal TypeScript](https://github.com/temporalio/sdk-typescript), [Restate Python](https://github.com/restatedev/sdk-python), [Restate TypeScript](https://github.com/restatedev/sdk-typescript))

There are still meaningful differences in emphasis. The OpenAI Python documentation calls the SDK “Python-first” and describes using Python language features to orchestrate and chain agents. ([OpenAI Agents SDK documentation](https://github.com/openai/openai-agents-python/blob/main/docs/index.md)) The JS/TS SDK is a separate official monorepo with core, OpenAI, realtime, and extensions packages. ([OpenAI Agents JS/TS repository](https://github.com/openai/openai-agents-js)) LangGraph likewise maintains separate Python and JS repositories, while its application-structure documentation shows corresponding Python and JavaScript application layouts. ([LangGraph application structure](https://langchain-ai.github.io/langgraph/concepts/application_structure/))

Hermes provides direct evidence of a serious open-source harness using a split language model: its main project metadata is Python, its agent implementation is organized under a Python `agent/` package, and its web application has a React/TypeScript package with TypeScript build, lint, and test scripts. ([Hermes project metadata](https://github.com/NousResearch/hermes-agent/blob/main/pyproject.toml), [Hermes agent source](https://github.com/NousResearch/hermes-agent/tree/main/agent), [Hermes web package](https://github.com/NousResearch/hermes-agent/blob/main/web/package.json)) This demonstrates a pattern relevant to Agent Harness Lab, but one project is not enough to establish prevalence or superiority.

**Inference for this project:** the evidence supports treating Python and TypeScript as credible implementation choices, while treating the UI language as a separate constraint from the language used by the experiment runner and platform implementations.

### 2. Async and concurrency

Python’s standard `asyncio` library is explicitly designed for concurrent code using `async`/`await`; its documented high-level APIs cover coroutines, network I/O, subprocesses, queues, and synchronization. ([Python `asyncio` documentation](https://docs.python.org/3/library/asyncio.html)) Temporal’s Python SDK builds on those concepts but adds a custom workflow event loop, and distinguishes `async def`, threaded, and multiprocess activities. ([Temporal Python SDK README](https://github.com/temporalio/sdk-python))

Node.js performs non-blocking I/O through its event loop and uses a single JavaScript thread by default; Node’s official documentation also provides worker threads for JavaScript execution in parallel, especially for CPU-intensive work. ([Node.js event loop documentation](https://nodejs.org/learn/asynchronous-work/event-loop-timers-and-nexttick), [Node.js worker threads documentation](https://nodejs.org/api/worker_threads.html)) Temporal’s TypeScript worker implementation uses Node’s worker threads and virtual-machine facilities as part of its workflow execution model. ([Temporal TypeScript SDK README](https://github.com/temporalio/sdk-typescript))

The practical comparison is therefore not “which language has async.” Both do. The experimentable difference is how each runtime handles event loops, subprocesses, CPU-heavy work, cancellation, backpressure, worker isolation, and framework-specific determinism. These should be measured within the harnesses rather than inferred from syntax alone.

### 3. Durability integrations

Both languages have official Temporal SDKs. Temporal’s documentation lists Python and TypeScript among its official SDK development guides, alongside Go, Java, .NET, Ruby, PHP, and Rust. ([Temporal SDK documentation](https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/architecture/temporal-sdks.mdx))

Both languages also have official Restate SDKs. The Restate Python repository documents Python services and version compatibility with Restate Server, while the TypeScript repository documents Node/TypeScript services and its own compatibility table. ([Restate Python SDK](https://github.com/restatedev/sdk-python), [Restate TypeScript SDK](https://github.com/restatedev/sdk-typescript))

Temporal adds an especially relevant testing capability in its Python SDK: `WorkflowEnvironment` can run a time-skipping test server so long timers can be tested without waiting for real time, although the repository documents an ARM limitation for that environment. ([Temporal Python testing documentation in the SDK README](https://github.com/temporalio/sdk-python#testing)) The TypeScript SDK repository exposes a dedicated `@temporalio/testing` package in its package layout. ([Temporal TypeScript package layout](https://github.com/temporalio/sdk-typescript#repository-structure))

**Caveat:** “official SDK exists” does not establish equal maturity, feature parity, operational ergonomics, or identical failure semantics. Those are precisely the properties the lab should record and test.

### 4. Testing and contributor workflow

The official OpenAI Python repository lists `pytest`, Coverage.py, MyPy, Pyright, Ruff, and `uv` among the tools used to manage and test the SDK. ([OpenAI Python repository](https://github.com/openai/openai-agents-python)) The official OpenAI JS/TS repository uses a pnpm monorepo, TypeScript build checks, and Vitest-based tests according to its contributor guide. ([OpenAI JS/TS contributing guide](https://github.com/openai/openai-agents-js/blob/main/CONTRIBUTING.md))

Temporal’s Python SDK documents both real-server integration testing and a time-skipping workflow test environment. ([Temporal Python SDK testing section](https://github.com/temporalio/sdk-python#testing)) The TypeScript SDK has a separate testing package and internal test package in its repository structure. ([Temporal TypeScript SDK repository structure](https://github.com/temporalio/sdk-typescript#repository-structure)) Restate’s Python repository documents a `just verify` command for linting and testing, and its TypeScript repository includes a TypeScript monorepo configuration plus test directories and Vitest configuration. ([Restate Python SDK](https://github.com/restatedev/sdk-python), [Restate TypeScript SDK](https://github.com/restatedev/sdk-typescript))

Hermes also illustrates the operational cost of a deliberately split stack: its Python project has Python dependency metadata, while its web package has a separate Node package, TypeScript compiler, Vite, Vitest, and ESLint configuration. ([Hermes Python metadata](https://github.com/NousResearch/hermes-agent/blob/main/pyproject.toml), [Hermes web package](https://github.com/NousResearch/hermes-agent/blob/main/web/package.json))

**Inference for this project:** either choice can support serious testing, but a two-language repository makes cross-boundary contract tests, generated types, and reproducible toolchain versions important from the beginning.

### 5. API and schema boundaries

React documents TypeScript component props and the use of `.tsx` for JSX-containing TypeScript files. ([React TypeScript guide](https://react.dev/learn/typescript)) Vite provides typed APIs for the build-tool boundary. ([Vite repository](https://github.com/vitejs/vite))

If the experiment runner is also TypeScript, domain types can potentially be shared directly within a TypeScript workspace. If the runner is Python, the UI and runner should instead share an explicit wire contract such as JSON Schema or generated OpenAPI/TypeScript types. This is a project-design consequence, not evidence that one language is intrinsically better.

The lab should not make the UI’s TypeScript types the source of truth for run evidence. The standardized run records and event schemas should remain language-neutral so that Python and TypeScript platform implementations can produce comparable evidence.

### 6. Filesystem, subprocess, and sandbox work

Hermes’s official project description emphasizes terminal backends, persistent workspaces, skills, scheduled work, and isolated subagents, and its repository contains the Python agent implementation plus a separate TypeScript web application. ([Hermes README](https://github.com/NousResearch/hermes-agent), [Hermes agent source](https://github.com/NousResearch/hermes-agent/tree/main/agent), [Hermes web source](https://github.com/NousResearch/hermes-agent/tree/main/web)) Python’s `asyncio` documentation explicitly includes subprocess and OS-signal APIs. ([Python `asyncio` documentation](https://docs.python.org/3/library/asyncio.html)) Node exposes official filesystem, child-process, worker-thread, and virtual-machine APIs, and Temporal’s TypeScript worker uses several Node-specific capabilities. ([Node.js documentation](https://nodejs.org/api/), [Temporal TypeScript SDK README](https://github.com/temporalio/sdk-typescript))

The evidence supports either language for a filesystem or sandbox environment. It does not show that filesystem-heavy agents require Python or TypeScript. The decisive questions will be platform adapter availability, subprocess lifecycle behavior, isolation boundaries, and the ability to capture deterministic telemetry.

## Rust and Go: relevant but not primary contenders in this comparison

Go is relevant because Temporal lists an official Go SDK alongside its Python and TypeScript SDKs. ([Temporal official SDK list](https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/architecture/temporal-sdks.mdx)) This matters if a future experiment studies the effect of Temporal’s language/runtime choices or if a platform implementation is only practical in Go.

Rust is relevant mainly at infrastructure boundaries. Temporal’s SDK core repository says its core is used by the TypeScript and Python SDKs, among others, and separately describes the Rust SDK/client as prerelease. ([Temporal SDK Core](https://github.com/temporalio/sdk-core)) The Restate Python SDK repository also contains a Rust module as part of its development/build setup. ([Restate Python SDK](https://github.com/restatedev/sdk-python)) These facts do not, by themselves, support choosing Rust for the lab’s main agent and experiment code.

## Caveats and questions for later experiments

1. **Feature parity must be checked per platform and version.** Official language support is evidence of availability, not parity. Capture exact package and runtime versions in every run. ([OpenAI Python](https://github.com/openai/openai-agents-python), [OpenAI JS/TS](https://github.com/openai/openai-agents-js), [LangGraph Python](https://github.com/langchain-ai/langgraph), [LangGraph.js](https://github.com/langchain-ai/langgraphjs), [Temporal Python](https://github.com/temporalio/sdk-python), [Temporal TypeScript](https://github.com/temporalio/sdk-typescript), [Restate Python](https://github.com/restatedev/sdk-python), [Restate TypeScript](https://github.com/restatedev/sdk-typescript))
2. **Do not mix language overhead with harness overhead.** A Python worker, a Node worker, a container, or a durable runtime can each add different startup and orchestration costs. The run record should separate process/runtime startup, model latency, tool latency, and platform overhead.
3. **Compare concurrency semantics, not only throughput.** Relevant measurements include cancellation, duplicate work, queueing, subprocess behavior, worker crashes, CPU-bound tool isolation, and event-loop blockage. The Python and Node documentation describes different runtime mechanisms for these concerns. ([Python `asyncio`](https://docs.python.org/3/library/asyncio.html), [Node event loop](https://nodejs.org/learn/asynchronous-work/event-loop-timers-and-nexttick), [Node worker threads](https://nodejs.org/api/worker_threads.html))
4. **Test cross-language contracts early if the runner and UI differ.** The standardized event and run schemas should be validated independently by both sides; a shared TypeScript type alone would not validate Python output.
5. **Treat prevalence claims as an open research question.** The official repositories establish that both languages are used by substantial first-party projects and by at least one representative open-source harness in this source set, but they do not establish what “most serious agents” use.

## Evidence boundary

This note does not make the decision by itself. It records what the primary sources
demonstrate and which differences appear worth measuring. ADR 0002 records the initial
language boundary: Python for the laboratory core and default platform implementations,
TypeScript for the UI and TypeScript-native platforms. The boundary can be revisited
using first-vertical-slice evidence, platform implementation friction, contributor
experience, contract-testing cost, and benchmark evidence rather than a language
popularity claim.
