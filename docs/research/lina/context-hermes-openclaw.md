# Context in Hermes and OpenClaw: source study for Lina

Reviewed 2026-10-07. This is research and proposed direction, not an agreed implementation.

## Evidence and scope

| System | Source revision | Evidence |
| --- | --- | --- |
| Hermes | `ddc0e65958b326a89f6c440c76c812d31ac27e2a` | Official source downloaded at the revision used by the existing Context Lab study |
| OpenClaw | `e40ed06f23cb8bd939c9a6ff537eba7136074686` | Official source downloaded at the revision used by the Studio explorer |
| Current documentation | Accessed 2026-10-07 | Official websites; versionless documentation is labeled separately below |

This pass reuses [Hermes context lifecycle](../context-lifecycles/hermes.md) and
[OpenClaw turn execution](turn-execution-openclaw.md) to locate ownership, then
checks the source behind the claims most relevant to Lina. No upstream tests,
model calls, or performance experiments were run. A mechanism present in source
is evidence of an implementation, not evidence that it produces better answers.

The central finding is that context has several representations. Stored history,
working history, model-ready messages, tool schemas, and provider payloads have
different owners. A useful Lina block should expose those boundaries rather than
call all of them memory.

## What Hermes assembles

Hermes builds a system prompt with three ordered tiers. Stable instructions come
first, workspace context follows, and more changeable material comes last. The
last tier includes skill metadata, memory/profile snapshots, plugin sections and
runtime information. The assembled prompt is cached; ordinary model rounds do
not continuously reread every source. Compaction can refresh the snapshot.
[Prompt tiers and rebuild](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/agent/system_prompt.py#L734-L832).

Project discovery uses explicit precedence, including Hermes-specific files,
AGENTS chains, Claude files and Cursor rules. This is a product choice, not a
universal instruction-file standard. Source caps and provenance matter because
truncated instructions are different model input from the originals.
[Project discovery](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/agent/prompt_builder.py#L1594).

For each model request, `build_api_messages` creates structural copies, removes
persistence-only fields, and replays the historical `api_content` sidecar. That
sidecar preserves the bytes of earlier augmentation. The current turn can
include memory prefetch and plugin context. Ephemeral system additions enter at
request time rather than rewriting the cached prompt.
[Request copy and replay](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/agent/turn_context.py#L1220-L1333).

A context-engine `select_context` hook operates on the request view. The default
engine passes it through. Selection is distinct from durable compaction; failure
handling is also a policy, with invalid replacement or exceptions retaining the
default request rather than requiring the entire turn to fail.
[Selection boundary](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/agent/conversation_loop.py#L1281).

Tools contribute both schemas in the request and observations in history. Hermes
persists assistant calls before execution and persists the results afterward.
Large results can spill to files with bounded text entering the transcript.
Neither this ordering nor persistence alone proves exactly-once tool execution.
[Tool feedback lifecycle](../context-lifecycles/hermes.md#5-tool-feedback-becomes-the-next-context),
[persistence source](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/agent/session_persistence.py#L435).

## Hermes pressure, pruning and compaction

Hermes estimates pressure at several boundaries, including assembled requests
and after tool results. It accounts for provider/model constraints and output
reservation. The nominal configured threshold is not necessarily the effective
trigger; the implementation adjusts it with window-dependent floors and caps.
Lina should record the effective input budget instead of presenting a raw ratio
as a universal rule.
[Preflight](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/agent/turn_preflight.py#L60),
[configuration](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/agent/agent_init.py#L1543).

Batch compaction can prune oversized/duplicate observations, partition protected
head and recent tail, and summarize the middle. Its structured summary retains
active goals, constraints, unresolved input, completed work and important state.
The host owns admission and durable commit. In the default in-place mode it
archives original rows and installs replacement active rows in the same session.
[Compaction host](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/agent/conversation_compression.py#L4072),
[algorithm and failure branches](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/agent/context_compressor.py).

Other mechanisms have different semantics. Deterministic proactive pruning and
micro-compaction are optional and default off in the studied configuration.
Proactive pruning rewrites active history after successful commit. Request-only
cleanup instead changes what is sent without automatically installing a new
active transcript. Cancellation, failed summaries, ineffective reductions and
provider overflow have separate outcomes.
[Pruning source](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/agent/context_compressor.py#L3446),
[pressure and recovery audit](../context-lifecycles/hermes.md#6-pressure-and-overflow-recovery).

Provider-native context management is another ownership mode. Hermes's Responses
projection and app-server compaction paths differ from its local summary rewrite.
A provider checkpoint is not automatically a portable textual summary.
[Provider ownership audit](../context-lifecycles/hermes.md#9-provider-projection-and-native-context-ownership).

## What OpenClaw assembles

The pinned system-prompt builder assembles policy-filtered tooling guidance,
skill metadata, workspace files, memory guidance and runtime information. It
caches a stable prefix keyed by its inputs, keeping changeable context separately
where the route permits. This is local prompt construction; provider cache hits
must still be measured from actual provider usage.
[Prompt builder](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/src/agents/system-prompt.ts#L620-L693).

Pinned history preparation sanitizes session messages, validates replay turns,
applies channel-specific history limits and repairs tool-use/result pairing.
After truncation, it repairs pairing again because a dropped assistant message
may have owned a retained tool result. This is a real contract requirement, not
an optional optimization for answer quality.
[History preparation](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/src/agents/embedded-agent-runner/run/attempt-history-prepare.ts#L72-L174).

The turn limiter preserves leading summary/prelude messages and selects recent
user turns with their following messages. It permits a 50% cushion before
batch eviction so the prefix remains stable between cuts. A sliding window
therefore need not mean shifting one message on every request.
[Batch history limiter](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/src/agents/embedded-agent-runner/history.ts#L18-L79).

OpenClaw provides a context-engine assembly contract. The caller computes a
message budget after reserving capacity and estimating rendered system/pending
prompt overhead, then passes messages, available tools and runtime facts. It
repairs pairing after assembly too. The engine can add system text. Assembly
failure falls back to pipeline messages in this path.
[Engine admission](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/src/agents/embedded-agent-runner/run/attempt-history-prepare.ts#L176-L249).

The built-in `legacy` engine passes assembly through, delegates compaction to the
runtime and leaves persistence to SessionManager. Engine interfaces describe
separate assembly, compaction and child preparation hooks. Merely labeling a
component a context engine does not imply it owns all storage or all budget
checks.
[Legacy engine](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/src/context-engine/legacy.ts),
[engine contract](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/src/context-engine/types.ts#L465-L525).

## OpenClaw reduction and current documentation

Pinned tool-result handling maintains projected replacements separately from
canonical source messages. Soft pruning can retain the head and tail of large
results. A replayed projection keeps the same bytes between requests; a TTL
gates new edits, rather than erasing an existing replacement after one round.
[Projection and pruning](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/src/agents/embedded-agent-runner/tool-result-truncation.ts#L148-L215).

Pinned preflight distinguishes tool-result-only reduction from compaction. It
also carries measured prompt facts into recovery, including reserve and tool
schema pressure. A diagnostic estimate and a command to discard history are
separate operations.
[Prompt preflight](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/src/agents/embedded-agent-runner/run/attempt-prompt-preflight.ts#L42-L122),
[request-pressure inputs](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/src/agents/embedded-agent-runner/run/attempt-prompt-preflight.ts#L141-L256).

Current documentation, accessed separately, describes provider-dependent pruning.
Direct eligible Anthropic API-key requests use server-side clearing. Other
eligible routes use client projections, persisted through hidden transcript
markers so restart can restore the model-visible view. Original observations
remain available. These documentation details should be checked against the
exact selected source revision before copying their configuration into a run.
[Current pruning documentation](https://docs.openclaw.ai/concepts/session-pruning).

Current compaction documentation describes retaining recent history and pairing
complete tool-call/result blocks. It also distinguishes summary failure from
cancellation and documents a timeout fallback that loses older unsummarized
facts while retaining transcript evidence. This is a trade-off to study, not a
recommended Lina default.
[Current compaction documentation](https://docs.openclaw.ai/concepts/compaction).

Current context documentation explicitly separates memory on disk from input in
the model window, and lists tool schemas as an additional cost beyond tool names
in prompt text. Model usage, tool schemas, attachments and summaries should be
visible contributors in Lina's context inspection.
[Current context documentation](https://docs.openclaw.ai/concepts/context).

## Child context: an important correction

Hermes children have fresh conversations and explicit task/context. The pinned
constructor sets `skip_context_files=True` and `skip_memory=True`. However, the
imported child-prompt builder separately loads workspace project files with the
same discovery rules and excludes SOUL identity. It would be incorrect to infer
that the child receives no repository instructions from the constructor flags.
[Child construction](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/tools/delegate_tool.py#L237-L282),
[actual child prompt](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/tools/delegate_tool_progress.py#L178-L208).

This agrees with current Hermes delegation documentation. The previous local
lifecycle study's child section is incomplete if read as excluding all project
files. Built-in memory suppression and absence of automatic parent conversation
inheritance remain separate facts.
[Current delegation documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation).

OpenClaw supports explicit `isolated` and `fork` child context modes at the pinned
revision. Ordinary spawns resolve to isolated unless a thread-bound policy says
otherwise. Forking currently requires the same target agent and an available
parent transcript. Context-engine child preparation can return a rollback
handle if the later launch fails. A transcript fork is a distinct mechanism from
passing a task brief.
[Child context preparation](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/src/agents/subagents/spawn/subagent-spawn-context.ts#L39-L112),
[child lifecycle and mode resolution](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/src/agents/subagents/spawn/subagent-spawn-context.ts#L115-L244).

## Proposed Lina nodes and boundary

The following nodes are design recommendations inferred from the mechanisms
above. They need Lina-specific contracts, not copied upstream names or defaults.

| Proposed node | Responsibility |
| --- | --- |
| Load context sources | Read admitted task, active history, instructions and source references for this agent instance |
| Assemble instructions | Resolve precedence, caps and refresh policy; retain provenance |
| Select history and evidence | Choose complete exchanges, summaries and observations; consume permitted memory results |
| Prepare model context | Combine selected messages with authorized tool catalog and media references |
| Check context budget | Estimate complete request pressure, reserve output/headroom and select a reduction path |
| Prune observations | Produce explicit bounded replacements without pretending originals vanished |
| Compact history | Summarize an eligible region, preserving current task and complete recent exchanges |
| Commit context update | Install durable compaction or projection metadata only when that policy requires it |
| Validate model context | Check roles, pairing, capabilities and final budget; return ready context or a typed failure |

Turn Execution calls this pipeline before each model round. Tool outcomes then
join working history and the next round prepares context again. Input owns
admission and provenance; Memory owns retrieval/storage algorithms; Tools owns
authorization and schema definitions; Model Interface owns provider encoding.
Context consumes those products and decides what the model receives.

## Experiments worth recording

| Variable | Plausible alternatives | Evidence to inspect |
| --- | --- | --- |
| History selection | Full eligible history, batch recent turns, task-relevant retrieval | Task success, missed earlier facts, input tokens |
| Observation reduction | Verbatim, head/tail trim, structured extraction, artifact reference | Lost evidence, rereads, total tool/model cost |
| Summary representation | Free text, structured checkpoint, incremental summary | Pending-task/identifier retention and continuation accuracy |
| Trigger | Fixed fraction, complete-request budget, provider overflow recovery | Overflow frequency, compaction count, waiting time |
| Instruction refresh | Snapshot per session, per turn, explicit refresh boundary | Stale rules, prefix changes, reproducibility |
| Tool catalog | Full authorized schemas, selected/deferred schemas | Wrong/missing tool choices, discovery calls, schema tokens |
| Cache layout | Stable prefix with dynamic suffix, frequently rewritten prefix | Actual cache-read/write tokens and latency |
| Child context | Task brief, selected parent history, transcript fork | Child success, parent/child total cost, information leakage |

These alternatives are hypotheses. A smaller prompt or fewer summary calls alone
does not demonstrate improvement. Hold task, model/settings, tool behavior and
budgets fixed; record preprocessing and summarizer calls in total cost. Save the
selected source IDs, replacement mappings, summary provenance, policy versions,
estimated pressure and actual provider usage for every model round. Cache
experiments require controlled warm/cold conditions and provider capability
metadata. Pure Studio simulation can inspect paths and data contracts; it cannot
establish model quality or latency gains.
