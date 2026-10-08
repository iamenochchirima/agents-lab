# Context assembly in Pi and Waku

## Scope and evidence

Inspected on 2026-10-07. This note follows the revisions already used by the
Studio explorers, rather than silently substituting moving upstream defaults:

- Pi `a276dabe57911253350bffb93cb7d7aff6a73261`.
- Waku `24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01`.

Pi source was read from the isolated bare repository fetched for the earlier
turn study. Waku files were downloaded from official GitHub raw URLs at the
specified revision. Both pinned repositories were also opened online. This is
static source inspection. No model calls, benchmark runs, or upstream tests were
executed. Existing explorer notes helped locate owners; the findings below were
checked against the implementation itself.

Pi's normal coding-agent session is the subject here. Its experimental durable
runtime is a separate implementation. Waku's full-agent path is the subject
here, with its quick-reply graph path called out separately.

## The useful distinction

Context assembly produces the material for a particular model request.
The source conversation, persisted records, retrieved memories, executable
tools, and final provider request are different representations.

Pi makes that separation especially visible through a provenance-preserving
session projection. Waku makes it visible through a durable completed-exchange
history and a separate, richer, live tool transcript inside each turn.
Sources: [Pi session projection](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/session-manager.ts#L542-L583),
[Waku session records](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/runtime/session.py#L93-L142),
[Waku live loop](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/loop/agent.py#L59-L160).

## Pi

### Instructions and tools

`buildSystemPromptSections` builds ordered sections for the default coding
instructions, tool descriptions and guidelines, documentation pointers, appended
instructions, project-context files, skills, working directory, and custom
sections. Project instructions retain their file paths in rendered tags. A
forced system prompt can replace the whole structured prompt. These are
configuration and extension choices, not a single universal instruction policy.
Source: [system-prompt construction](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/system-prompt.ts#L120-L193).

The prompt's short tool descriptions are distinct from actual tool declarations
and executable implementations. The loop records declaration changes as system
messages so that replay yields the runtime tool set. The session also supports
request projections that hide selected declarations while retaining recorded
prompt/tool state. This distinction matters for experiments that compare
exposing every tool with exposing a selected subset.
Sources: [declaration reconciliation](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/agent/src/agent-loop.ts#L324-L374),
[session request preparation](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/agent-session.ts#L748-L814).

### History and model projection

The session manager stores an entry tree with parent IDs and an active leaf.
The active branch determines model history. Projection interprets the latest
compaction boundary and context edits. A context edit can omit an entry or
replace its content in model context without deleting the original record.
Projected entries retain their source entries, so omitted or summarized history
can still be explained from the session record.
Source: [branch selection and projection](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/session-manager.ts#L469-L583).

Before an assistant request, the session prepares canonical projected context.
The lower-level loop then applies `transformContext`, converts agent messages
through `convertToLlm`, normalizes the resulting context, and invokes the
selected provider stream. Custom message types therefore need an explicit
conversion into model-compatible messages. Summary messages and recorded bash
executions have their own conversions. Display visibility and model visibility
should not be assumed to be the same property.
Sources: [request pipeline](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/agent/src/agent-loop.ts#L381-L413),
[message conversion](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/messages.ts).

### Budgeting and compaction

The inspected default compaction settings enable compaction, reserve 16,384
tokens, and retain approximately 20,000 recent tokens. These numbers describe
this revision; they are not recommended Lina defaults. The trigger compares
estimated context size with the model context window minus the reserve.
Estimation uses recent provider usage when suitable and estimates trailing
messages; projection changes can invalidate that previous usage anchor.
Source: [settings and token estimation](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/compaction/compaction.ts#L120-L269).

The cut-point algorithm walks backward through history and uses valid message
boundaries. It avoids starting retained history at a tool result, keeping the
preceding assistant tool call where needed. A split turn receives special
handling. This is more precise than simply keeping the last N messages.
Source: [retention boundaries](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/compaction/compaction.ts#L431-L503).

Summary generation is a separate model request. Successful compaction records
a summary and retained-entry boundary, then rebuilds the projected history.
The summary prompt tracks the goal, constraints, progress, decisions, next
steps, and critical context. Extension hooks can alter or cancel compaction.
The session also has bounded context-overflow recovery, separate from ordinary
provider retry. Failure or cancellation must not be represented as successful
compaction.
Sources: [summary preparation and generation](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/compaction/compaction.ts),
[session compaction lifecycle](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/agent-session.ts),
[pinned compaction documentation](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/docs/compaction.md).

### Caching, persistence, and children

The Anthropic adapter resolves cache retention and adds provider cache controls
at instruction, message, and tool boundaries. One-off summarization calls
explicitly use `cacheRetention: "none"`. Cache reads/writes are usage categories,
not evidence that old messages were removed from the logical request.
Sources: [Anthropic cache handling](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/ai/src/api/anthropic-messages.ts#L69-L93),
[request conversion and boundaries](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/ai/src/api/anthropic-messages.ts#L1130-L1189),
[summary cache policy](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/compaction/compaction.ts#L612-L643).

The session's JSONL entry tree preserves history and context decisions. It is
not equivalent to a crash-safe tool-execution scheduler. Context projection
should remain a derived view over inspectable records.
Source: [session manager persistence](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/session-manager.ts).

The official subagent extension starts a new Pi process with `--no-session`,
an explicit task, optional agent model/tool selections, and appended specialist
instructions. It does not automatically copy the parent's full message list.
Its chain mode explicitly inserts the previous child's output into the next
task. Children can still load project resources through their working directory.
Fresh conversation history therefore does not imply an empty environment.
Source: [subagent invocation and chain](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/examples/extensions/subagent/index.ts#L300-L346).

## Waku

### Per-turn assembly and retrieval

`Session.build_system` reloads SOUL.md, adds the local clock/timezone and model
identity, then optionally adds relevant memory and matching skills. Memory
retrieval runs through a small-model gate. The gate chooses whether retrieval
is needed and supplies a query. Gate parsing/call failure chooses retrieval
with the original message; that fallback does not establish that a later store
failure will be recovered.
Sources: [system assembly](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/runtime/session.py#L64-L91),
[retrieval gate](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/memory/retrieval_gate.py).

Retrieved material combines fact search at configured top-k with up to three
matching episodes. An optional slot-selection gate filters facts before
injection. Skill matching is independent of the retrieval verdict; matched
skill bodies enter the system prompt. This gives distinct experimental controls
for retrieval admission, search, fact selection, and final context placement.
Source: [memory and skills assembly](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/memory/__init__.py#L106-L128).

### Completed history versus live tool transcript

At turn start, `_run_full_turn` takes the last `history_turns * 2` rows of
completed user/assistant exchanges and appends the new user message. The default
is twelve exchanges. `history_turns = 0` is not a zero-history policy here:
Python's `[-0:]` returns all rows. The window bounds exchange count, not tokens.
Sources: [turn construction](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/app.py#L118-L142),
[configuration](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/config.py#L156-L170).

Inside that turn, `run_loop` preserves assistant response blocks, including tool
calls, and appends correlated `tool_result` blocks for subsequent model rounds.
It sends the current live messages and registered tool schemas on each call.
The system prompt is built once for this full turn, rather than rerunning
memory retrieval after every tool result.
Source: [live transcript assembly](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/loop/agent.py#L59-L160).

After completion, `Session.add_exchange` records the user text and final reply,
with a textual `[tools used: ...]` record containing tool arguments and output.
The next user turn receives this completed-exchange form, not the previous
turn's full provider-native tool-block sequence. It is a serialization choice,
not generic model-generated history compaction. It may still contain large
outputs. SQLite chat rows support later session reload and memory consolidation.
Sources: [exchange recording and reload](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/runtime/session.py#L93-L142),
[chat persistence](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/memory/__init__.py#L130-L149).

### Provider conversion, budgets, and children

Waku uses Anthropic-shaped requests internally. Its OpenAI-compatible adapter
converts the system string, assistant tool-use blocks, tool-result IDs, and
schemas into OpenAI-style messages and function tools. Provider conversion is a
separate responsibility from selecting useful context.
Source: [OpenAI projection](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/loop/models.py#L348-L393).

The examined full loop has an output-token limit and iteration limit, but no
general request token-admission budget, history summary compactor, or compact-
and-retry overflow path. No explicit prompt-cache marking was found in the
examined loop and compatibility adapter. Provider-side automatic caching remains
possible; absence of explicit controls is not evidence of zero cache hits.
Sources: [loop](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/loop/agent.py),
[adapter](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/loop/models.py).

Waku's graph quick-reply route uses a different prompt and small model without
the full memory/skills/tool context. Its full-agent graph node reuses the normal
full-turn builder. Comparing these paths changes more than context selection.
Source: [graph integration](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/app.py#L144-L185).

Experimental `delegate_task` launches external Pi with the task, working
directory, mapped model, and project extensions/skills. It uses `--no-session`;
Waku's assembled SOUL/memory/history is not automatically forwarded. Necessary
parent knowledge must be included in the task or available project resources.
Source: [delegated invocation](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/experimental.py#L186-L258).

## Recommended Lina responsibilities

These are recommendations inferred from the implementations, not claims that
Pi and Waku share one standardized graph. Keep the Context block between
Prepare round and Call model, revisited for each model round.

| Suggested node | Concrete responsibility |
| --- | --- |
| Load context sources | Resolve the current agent/session history, instruction versions, task, pending controls, and available results |
| Select history | Produce an ordered projection and record retained/omitted source IDs |
| Gather supporting context | Request permitted memory material and select applicable skills/project resources |
| Assemble context | Combine instructions, task, selected history, supporting material, and tool declarations with explicit provenance |
| Check context budget | Estimate the whole request against the selected model limit and output reserve |
| Compact context | Optional branch that summarizes older material, preserves recent tool exchanges, and returns to budget checking |
| Finalize model context | Emit an immutable provider-neutral request snapshot and a manifest of decisions |

Provider serialization belongs at the Model Interface boundary. Durable memory
writes and search implementation belong in Memory. Context decides what memory
material enters this request. Tool execution stays in Tools/Turn Execution.
The main agent and children can use the same Context pipeline with distinct
agent/session identities and source permissions.

Budget checks must include instructions, schemas, attachments, and recent tool
results, not just chat text. Unsupported or still-over-budget requests need an
explicit failure path. A compaction loop needs a bound and must retain its
failed/cancelled outcome. Do not copy Pi's numerical defaults without choosing
Lina's target models and measuring actual request sizes.

## Experiment candidates

| Variable | Controlled comparison | Useful evidence |
| --- | --- | --- |
| History policy | Full history, last-N exchanges, token-bounded recent history | Recall, task completion, request size, latency |
| Compaction | Drop older history versus summary plus recent history | Constraint retention, factual loss, summary cost, recovery rate |
| Tool-result representation | Full results, bounded excerpts with artifact references, structured summaries | Ability to use details, repeat tool calls, token cost |
| Retrieval admission | Always, never, rule-gated, model-gated | Retrieval latency/cost, useful recall, irrelevant-memory influence |
| Supporting selection | Inject all retrieved items versus relevance filtering | Answer quality, excluded useful evidence, selector overhead |
| Instruction/skill loading | All bodies versus discovery and selected loading | Rule adherence, skill selection accuracy, request size |
| Child context | Task only, selected parent material, full-history transfer | Child success, parent cost, unrelated-context influence |
| Cache arrangement | Stable instruction/tool prefix versus changing order | Reported cache usage, request cost, latency |

Freeze model, task fixtures, tools, output allowance, history sources, memory
contents, and environment across each comparison. Record context manifests,
source IDs, estimates versus actual usage, selected model window, summary inputs
and outputs, retrieval decisions, and cache categories. Include tool-heavy long
turns, cancellation during summary generation, irrelevant retrieved facts,
oversized attachments, and lost constraints as cases. Results would establish
behavior on those cases, not a universal winning context strategy.
