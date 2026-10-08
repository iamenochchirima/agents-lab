# Memory in Pi and Waku

Reviewed 2026-10-08. This report inspects official source and documentation, without running upstream models, memory services or durability experiments. Repository HEADs were verified remotely before inspection. Pi is pinned to `6fb2e7815167e6b19006fc526d1a5d0f5f998787`; Waku is pinned to `763d3e79f34a2deca805e815b3b230188579e16b`. These are newer than the revisions in the previous State study. Pi source was cloned to a temporary checkout; Waku tracked source was read from the local checkout at the verified HEAD. An unrelated untracked local text file was not inspected or changed.

## What each agent actually provides

| Area | Pi coding agent | Waku agent |
| --- | --- | --- |
| Conversation persistence | Branch-aware JSONL sessions | SQLite completed exchanges |
| Shortened model history | Compaction and branch summaries | Configured recent-turn window |
| Persistent instructions | Global and ancestor instruction files; skills | SOUL.md and selected SKILL.md bodies |
| Built-in cross-turn knowledge | No dedicated semantic/episodic store found in inspected core | Fact and episode stores with retrieval and consolidation |
| Cross-session extension storage | Explicitly delegated to external storage | Configurable fact/episode backends and Waku Memory MCP integration |
| Correction and forgetting | Extension or ordinary file tools; no general core memory CRUD | Agent and dashboard fact CRUD; episode deletion |

These are source observations, not measurements of which implementation remembers better. Pi's extension documentation explicitly assigns data outside one session to external storage. Waku's facade explicitly separates facts, dated episodes and procedural skills. [Pi storage choices](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/coding-agent/docs/extensions.md#L219-L235), [Waku facade](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/memory/__init__.py#L1-L108)

## Pi

### Sessions and compaction preserve conversation context

Pi's session manager owns the entry tree and its active branch. Reconstructing model context selects that branch and applies compaction. This keeps conversation history available without requiring every old message in each request. It does not create a cross-session fact index. [SDK session ownership](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/coding-agent/docs/sdk.md#L36-L50)

Automatic compaction reserves space for the response and retains a recent span, then appends a summary entry. Defaults documented at this revision are 16,384 reserved tokens and approximately 20,000 retained recent tokens. Old raw entries remain stored. Branch navigation can summarize the work on the branch being left. These summaries are tied to the session projection, rather than independently reusable memories with fact ownership, correction or expiry. [Compaction lifecycle](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/coding-agent/docs/compaction.md#L16-L83), [Branch summarization](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/coding-agent/docs/compaction.md#L169-L184)

### Instruction files have a different lifecycle

The loader chooses the first existing supported file per directory: `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, then `CLAUDE.MD`. It loads a global agent-directory file followed by ancestor files, ordered from root toward the current working directory. It deduplicates paths and avoids a nested worktree applying a shadowed main-worktree copy twice. `MEMORY.md` is not an automatically discovered candidate in this function. [Discovery and scope](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/coding-agent/src/core/resource-loader.ts#L184-L269)

The system prompt wraps these contents as project instructions with their source paths. They are persistent guidance supplied by files, not evidence that core automatically learns durable facts. A memory extension could read its own file and inject it, but that would be the extension's lifecycle and trust policy. [Prompt rendering](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/coding-agent/src/core/system-prompt.ts#L79-L85)

### Extensions supply the missing knowledge layer

Pi supplies hooks before agent start and during context assembly, model-callable tools and session events. Extensions can therefore implement retrieval before a request, explicit memory tools or post-turn extraction. A custom session entry stays out of model context; a custom message participates in it. Branch-sensitive state must rebuild from the active branch, rather than every entry including abandoned branches. The documentation's external-storage recommendation is the clearest boundary for knowledge shared between sessions. No specific third-party memory extension is treated as core behavior here. [Extension integration and lifecycle](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/coding-agent/docs/extensions.md#L52-L117), [Session entry types](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/coding-agent/src/core/session-manager.ts#L123-L160)

The official subprocess subagent example uses `--no-session` and an explicit working directory. It does not establish a general child memory namespace or shared long-term store. Files or an installed extension can still be reachable under that process's operating-system permissions. Independent transcripts therefore do not imply independent access permissions. [Subagent process construction](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/coding-agent/examples/extensions/subagent/index.ts#L278-L349)

## Waku

### Four forms of retained information

Waku keeps completed chat exchanges in `chat_log`, facts in `facts`, and dated summaries in `episodes`. SQLite FTS5 indexes facts and episodes with update/delete triggers. Skills are files rather than rows. The tables share `state.db`, but each has a different use. Facts carry subject, content, source and creation time; episodes carry summary and happened-at date. The inspected tables do not supply a universal validity interval, revision history or conflict-resolution structure. [Schema](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/db.py#L26-L84)

The full turn sends only the last configured number of chat turns. The default is 12 turns; fact retrieval defaults to top four and consolidation to every six exchanges. These are settings, not evidence of optimal budgets. [Context window assembly](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/app.py#L207-L247), [Defaults](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/config.py#L194-L227)

`SOUL.md` supplies editable persona instructions. Skills match keyword overlap in names/descriptions, with at most two selected by default; selected bodies enter the prompt. A file change causes a rescan on the next match. This is one concrete procedural-memory implementation, but Lina already owns skills under its capability/instruction lifecycle and should avoid duplicating that ownership merely because Waku calls them memory. [Soul and prompt assembly](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/runtime/session.py#L54-L111), [Skill matching](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/memory/procedural/loader.py#L47-L93)

### Retrieval has distinct decisions

A small model first decides whether the user message needs memory and proposes a search query. If the gate fails or produces no JSON, it retrieves using the original message. This policy chooses recall over avoiding irrelevant context; it is a trade-off, not an established performance advantage. [Gate](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/memory/retrieval_gate.py#L20-L67)

Local facts use sanitized Unicode keyword queries and FTS ranking. Episodes use relevance first and date to order equally ranked matches; an empty query asks for recent episodes. This is a concrete lexical baseline without mandatory embeddings. Fact search returns prompt strings, while `search_with_ids` returns identifiers for correction. [Fact search and CRUD](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/memory/semantic/store.py#L25-L174), [Episode search](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/memory/episodic/store.py#L20-L65)

An optional Jev gate filters retrieved facts by whether they change the answer. A second optional decision filters proposed writes by future usefulness. Both are disabled unless configured and preserve all candidates on failure. This separates write selection from read selection; its source comments' small-case measurements do not establish broad efficacy. [Optional selection gates](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/memory/slot_gate.py#L1-L114)

Research has an additional pre-model read path through Waku Memory MCP. It searches for relevant entries and earlier reports, deduplicates returned IDs, loads at most three reports and injects their digests. Retrieval is therefore both harness-triggered and available through model-callable memory tools. The research path searches scope `all`, which must not be copied as a multi-user access policy. [Read-first lifecycle and bounded report context](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/memory/brain.py#L191-L270)

### Writing, correction and consolidation

Explicit `save_note` inserts a fact directly. With Waku Memory connected it first commits an unsynced local row, sends it remotely, then marks it synced. The response distinguishes local saving from remote success. That is a useful distinction for Lina's contracts. [Explicit save](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/tools/notes.py#L29-L58)

Automatic consolidation runs after the completed exchange is saved. It reads unconsolidated chats across the database and asks a small model for facts and an episode. Parse/model failure leaves the batch eligible for retry. It filters transient operating state, statements about what memory contains, recalled content that only repeats existing information, and report duplication. Report batches keep at most two personal facts. Kept facts are then written and chat rows marked consolidated. This is more than summarization, but the filters are heuristics and the prompt's user-only extraction rule still depends on model compliance. [Consolidation selection and lifecycle](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/memory/consolidation.py#L148-L264)

The agent's `manage_memory` tool searches for IDs before updating or deleting facts. Episodes may be deleted, but this tool refuses to update them. Its fact mutation path coerces IDs to integers even though the backend protocol permits opaque strings, an interface mismatch worth checking before adapting it. Local deletion does not establish deletion from a previously synchronized remote copy. [Management tool](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/tools/memory_admin.py#L25-L81)

### Storage and recovery limits

The facade can select SQLite, Supabase, Mem0, Zep or LangMem facts, and SQLite or Notion episodes. The fact protocol includes add, search, list, search with IDs, update, delete and a readiness/settle operation. Hosted memory may not become searchable immediately after write acknowledgment. `settle` is intended for bulk writers/evaluation; the live turn does not invoke it. Adapter interchangeability therefore does not mean identical write visibility. [Backend assembly](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/memory/__init__.py#L58-L98), [Store contract](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/memory/semantic/base.py#L73-L164)

Local fact writes commit individually before the consolidation cursor commits. A crash can leave kept facts with unconsolidated source chats, allowing extraction to repeat. Remote delivery uses stored unsynced rows, but the bridge's `memory.remember` request contains body, kind and scope without a visible operation idempotency key. A success followed by lost acknowledgment can be retried. These inspected paths do not prove exactly-once memory writes or batch atomicity. [Local commit ordering](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/memory/semantic/store.py#L77-L108), [Remote request](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/tools/waku_memory.py#L53-L75)

`MEMORY.md` and per-fact Markdown files are generated exports. SQLite is their source of truth. They provide human inspection and importing, rather than a second authoritative file store. Export code removes numbered fact files no longer present locally; that is not proof of remote purge. [Export lifecycle](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/memory/__init__.py#L192-L254)

The local fact retrieval SQL has no namespace predicate, and automatic consolidation has no session predicate. `scope` records the intended remote destination. Mem0/Zep adapters configure a user identity, but these paths do not establish per-agent or per-subagent capabilities. A multi-user Lina deployment needs enforced authorization independently of memory labels. No generic automatic expiry, tombstone protocol or cross-store conflict resolver was found in the inspected local memory paths.

## Implications for Lina

These are design inferences from the mechanisms above, not features already implemented in Lina:

- Keep session history and compaction in State/Context. Give Memory responsibility for reusable knowledge and its lifecycle.
- Resolve read/write authorization and namespace before retrieval or mutation. Return structured IDs, provenance, dates and versions, rather than only prompt strings.
- Separate the decision to retrieve, query preparation, candidate search and selection for Context. Waku demonstrates these are independently variable mechanisms.
- Support explicit writes and automatic extraction as distinct producers. A selected memory becoming context must not automatically become a new fact on the next consolidation.
- Distinguish proposal filtering, correction/conflict handling and committing a mutation. A backend insert does not decide whether a claim is true or permitted.
- Make correction/deletion address source facts, derived summaries, indexes, exports and remote replicas. Retain enough dependency information to know what must be invalidated.
- Record write acknowledgment separately from search visibility. Use stable mutation IDs and a consolidation cursor/checkpoint through State, without repeating already committed mutations after restart.
- Define child access independently of the parent transcript. Read-only inherited access, child-local scratch memory and reviewed parent writes are policy choices that require explicit contracts.

Candidate experiments include lexical versus semantic/hybrid retrieval, retrieval gating versus mandatory search, query rewriting, read selection budgets, explicit versus automatic writes, and consolidation scheduling. Scope enforcement, provenance, honest backend errors, mutation identity and correct deletion are baseline requirements rather than experiments about whether to omit them. The sources do not establish that a small-model retrieval gate or semantic store is universally superior.
