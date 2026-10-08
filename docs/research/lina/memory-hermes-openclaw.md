# Memory in Hermes and OpenClaw

Reviewed 2026-10-08. This study informs Lina's Memory design. It does not implement a memory backend or report measured recall quality.

## Evidence and version boundary

The official GitHub HEADs were resolved through the GitHub API and selected files downloaded from immutable raw URLs. Source pins are Hermes `38880bd2f1e90dbc9a1aeec03af62539ee64719a` and OpenClaw `a07a06ec94d2eda4ba1a7cab869395d5222092bf`. Relevant implementation modules and repository documentation were inspected. Live official documentation was browsed separately on this date. Both projects change quickly; claims below refer to these pins unless explicitly marked as live documentation. No upstream tests, agent sessions, embedding requests, crash tests or benchmarks were executed.

The important finding is that neither agent has one undifferentiated memory store. Hermes combines small curated prompt memory with searchable conversation history and an optional external provider. OpenClaw's current default Memory Core distinguishes curated, episodic and prospective memory, provenance, background promotion and several recall paths. Optional plugins add further designs. [Hermes initialization][h-init], [OpenClaw architecture][o-architecture]

## Hermes

### Built-in curated memory

The built-in `MemoryStore` persists agent notes in `MEMORY.md` and a user profile in `USER.md`, under the active Hermes home's `memories` directory. Default budgets are 2,200 and 1,375 characters. This is a bounded collection of entries separated by `§`, not an unbounded vector database. Configuration can enable the two targets independently. [Store, lines 141–218][h-store], [directory resolution, lines 38–60][h-tool], [initialization, lines 1296–1333][h-init]

Loading captures a frozen system-prompt snapshot. Successful writes update disk and the live tool view but do not mutate that snapshot. This explicitly favors stable prompt prefixes. External edits that exceed the configured budget remain loaded with a warning; the cap is enforced on writes rather than silently truncating the user's file. Threat-pattern matches become blocked placeholders in the injected snapshot while raw entries remain available for inspection and removal. [Store, lines 187–218][h-store]

The `memory` tool supports add, whole-entry replace, remove and a batch of operations. A replacement locator is not a span patch: matching `old_text` identifies the entire entry to replace. Exact-entry matching has priority, ambiguous substring matches fail, and normalization tolerates typography differences. Exact duplicate additions return success without another entry. A batch validates a private working copy and applies all operations or none, including budget and content checks. The model can consolidate several old entries and add a new one in one bounded mutation. [Matching, lines 66–118; mutation methods, lines 334–512][h-store], [tool operations, lines 105–159][h-tool]

The write path takes an exclusive sidecar file lock, rereads disk under that lock, validates the current contents and writes through `atomic_write_text`. It refuses an existing unreadable file rather than assuming empty memory. External drift that would lose unrepresentable freeform content triggers a backup and refusal. These are real safeguards against concurrent edits and data loss, but atomic replacement is not a transaction encompassing an external provider mirror. If both supported lock modules are absent, the inspected lock helper yields without locking. [Store, lines 44–63, 220–330][h-store]

Ordinary curated writes may pass through configurable write approval. Staged replacements/removals pin the complete reviewed entry and reject a changed entry later. Unattended background-review destructive operations are staged rather than applied automatically. The ordinary approval gate has a documented fail-open import path; this should not be presented as universal fail-closed memory authorization. [Tool, lines 64–102, 171–210][h-tool]

There is no automatic built-in semantic deduplication or temporal contradiction solver in the inspected store. Exact duplicates and target matching are mechanical; deciding that a fact is stale, merging differently phrased facts and choosing what to remove remain agent decisions expressed through tool calls. A per-turn consolidation failure cap prevents repeated overflow or failed matches from consuming the whole reply. [Store, lines 146–185, 334–512][h-store]

### History is a separate retrieval source

`session_search` searches persisted conversations rather than the two curated files. The current implementation discovers sessions, deduplicates by conversation lineage, hydrates result windows, recognizes compaction summaries and exposes browse/scroll shapes. Its source includes explicit content caps and `content_truncated` metadata. The live Persistent Memory page's broad claim that search never truncates should therefore not be repeated as a property of this newer source pin. [Session search, lines 1–49, 103–127, 237–252, 276–315][h-search], [live Persistent Memory guide][h-memory-live]

That distinction matters for Lina. A transcript is evidence of what was said. A curated entry is a selected statement intended to steer later turns. Searching the first does not prove that the second was saved, and an agent saying it remembered something is not a memory receipt. [Memory tool, lines 1–5, 84–102][h-tool]

### Optional external provider lifecycle

The host can initialize one selected external memory provider beside built-in memory. An unavailable provider leaves built-in memory available and emits an operator warning. Providers expose prompt content, prefetch, provider tools, turn synchronization, session-end extraction, session switch, pre-compression hooks and built-in-write notifications. These hooks describe extension contracts; each provider chooses its actual backend, extraction and retention behavior. [Initialization, lines 1334–1376][h-init], [provider interface][h-provider], [manager, lines 492–572, 590–675, 722–920][h-manager]

The manager bounds external prefetch, keeps sync work in background workers and tracks outstanding work for a bounded drain. Session-boundary extraction is also asynchronous. Consequently, a completed reply does not imply every external memory sync has completed durably. Exceptions are isolated and logged. A required versioned pre-compression checkpoint is an explicit stronger case: a compatible provider must succeed or the caller receives an error so it can keep the uncompressed transcript. [Manager, lines 502–557, 590–675, 733–769, 798–834, 929–964][h-manager]

External egress uses one recursive secret scrub for turns, tool transcripts, recall queries, compression/session-end evidence, mirrors, provider tool arguments and delegation results. Recalled context is sanitized and wrapped with data-only handling instructions. This is useful containment, not proof that arbitrary secrets or poisoned facts are detectable. The live provider guide explicitly notes that arbitrary passwords and opaque unrecognizable tokens can escape pattern-based detection. [Manager, lines 173–229, 372–390, 706–720, 915–920][h-manager], [live provider guide][h-providers-live]

Built-in writes are mirrored only when the tool result represents an applied success; staged proposals are not mirrored. Replace/remove notifications include the previous complete entry, not merely a substring locator. Mirror failures are logged independently. Lina should keep local commit status separate from provider-sync status and deletion propagation status. [Manager, lines 845–913][h-manager]

Built-in scope is profile/home scope. The provider initialization contract includes `agent_context` values such as primary, subagent, cron and flush and tells providers to skip writes for non-primary contexts. This contract does not establish identical enforcement in every third-party plugin. Child result notifications can return through the parent's manager with a child session ID. The inspected evidence does not justify assuming every child automatically receives full parent memory or shared write authority. [Tool, lines 38–40][h-tool], [initialization, lines 1258–1270][h-init], [provider, lines 103–110][h-provider], [manager, lines 915–920][h-manager]

## OpenClaw

### Memory Core versus alternatives

The current default Memory Core plugin registers `memory_search`, `memory_get`, deterministic recall and a memory-flush plan. Its source registers a standing-intent tool and lifecycle hooks too. Workspace files hold human-readable knowledge; SQLite provides the search index and machine-owned provenance/coordination records. Honcho and LanceDB are alternate selected engines. `memory-wiki` is an additional structured knowledge layer beside the selected engine, not an automatic replacement for Memory Core. [Plugin registration, lines 205–340][o-index], [pinned engine and wiki documentation, lines 190–222][o-overview]

The pinned architecture distinguishes instructions owned by humans; small curated `MEMORY.md`/`USER.md`; episodic daily notes and transcripts; prospective standing intents; and review-only dreaming reports. These tiers have different injection and promotion rules. This is a much richer architecture than summarizing OpenClaw as daily Markdown files plus embeddings. [Architecture, lines 48–77][o-architecture]

### Reads, retrieval and context handoff

Eligible curated files enter bootstrap context within file budgets and refresh during long-lived sessions. Explicit search/read tools can retrieve additional evidence. Trigger-based injection selects a bounded number of strongly matched curated entries. Episodic content remains searchable but does not get promoted to automatic injection simply because its retrieval score is high. Active Memory can run a separate recall agent for harder recall, with modes controlling when that extra model turn runs. [Architecture, recall sections][o-architecture], [plugin registration, lines 216–240][o-index]

Hybrid retrieval combines vector and lexical candidates, preserves exact path/identifier priority, applies recency and importance signals, uses project ranking, and optionally configured diversity reranking. The inspected implementation keeps component scores as diagnostics and performs threshold/cap selection with lexical fallback rules. The pinned search documentation says temporal decay and MMR are enabled by default in the hybrid path, but FTS-only/vector-only fallback paths do not run the hybrid MMR pass. This is not one universally applied reranker. [Hybrid implementation, lines 65–327][o-hybrid], [pinned search documentation][o-search]

`memory_get` returns bounded file/range evidence, including distinct missing/read-error outcomes and optional corpus metadata. Its optional wiki/all path uses parallel requests under a shared deadline. Search snippets, expanded evidence and the final Context budget are separate decisions. Lina should retain identifiers, source ranges and trust metadata through all three. [Read implementation, lines 12–74][o-read], [hybrid result type, lines 19–34][o-hybrid]

Project annotations affect ranking and automatic injection rather than physically splitting files. Current architecture derives project identity from normalized repository remotes or an absolute root fallback; children derive their own active project set. A ranking boost is not an access-control barrier. Session recall eligibility has separate visibility and cross-agent controls, and the search documentation makes session indexing opt-in. Lina must specify which scopes are authorization boundaries and which only influence ranking. [Architecture, project-scoped memory section][o-architecture], [search documentation, session memory section][o-search]

### Writing, extraction and promotion

Ordinary work and pre-compaction flush feed episodic notes; session ingestion can supply transcript-derived candidates. The configured flush is a private maintenance execution with the source conversation's sandbox and memory audience. Its date-path planning, model override and thresholds belong to Memory Core/host contracts. It verifies actual successful persistence instead of treating a silent model reply as proof of saving, bounds failures and preserves the main conversation separately. [Flush plan, lines 63–107][o-flush], [host execution, lines 832–895, 1073–1269, 1311–1368][o-flush-host]

Background dreaming separates staging/reflection from promotion. Deterministic eligibility gates run before the consolidation model. The concrete candidate predicate requires trusted `owner`/`agent` origin and requires interactive source sessions for session-derived content. Untrusted/system content is structurally excluded. Thus a subagent's artifact is not automatically a promotable owner memory. [Candidate filter, lines 4–24][o-candidates], [architecture, provenance and dreaming sections][o-architecture]

The consolidation model must return structured operations for candidates: added, merged or superseded, with exact prior entries. Deterministic validation checks operation coverage, allowed lineage, retained entries and output bounds. A rejected or failed rewrite falls back to append behavior. Contradiction handling uses explicit supersession lineage, not arbitrary last-writer-wins text. The architecture also documents preimage retention and optimistic content-hash checks before replacement. The inspected consolidation module verifies the structured plan; this study did not execute atomic publication or races. [Consolidation, lines 21–32, 88–119, 235–383, 395–485][o-consolidation], [architecture, write safety section][o-architecture]

Provenance is machine-maintained metadata, distinct from prose citations. Origin recording includes session ID/key, origin class and observation time; merging/supersession reserves inherited origins. Network-tainted assistant content and recall feedback loops require source-aware classification. The architecture explicitly acknowledges that undeclared external content, such as some local reads, can evade turn taint classification. Provenance is only as complete as source classification and write-path coverage. [Origin implementation, lines 120–255][o-origins], [architecture, provenance and trust-boundary sections][o-architecture]

### Forgetting, concurrency and recovery

Forget is a workflow rather than deleting one vector. The CLI resolves selected sessions, previews tracked lineage, removes attributable artifacts and tombstones sessions against re-ingestion. The database kernel commits tombstones separately before dependent purge. A later cleanup failure can leave partial deletion, which is reported and retried. Original transcripts, freeform edits, old untracked entries and external copies are outside universal erasure coverage. Mixed-lineage entries may require deleting the entire merged entry. [Forget kernel, lines 1–101][o-forget], [pinned provenance and deletion guide][o-deletion]

Workspace mutation coordination has in-process FIFO ordering, atomic owner comparisons, owner/process-start evidence, conditional cleanup and explicit acquisition failure. Nested operations serialize sibling mutations instead of racing under one reentrant scope. Search-index generation has local and cross-process read/write leases so publication does not replace a generation under readers. These mechanisms protect plugin writers and index readers; external editors are not magically covered by a shared lock. [Workspace lock implementation][o-lock], [index generation implementation][o-generation], [deletion guide, preview and cleanup section][o-deletion]

Standing intents are prospective memory with explicit lifecycle, trigger, expiry and fire budgets. They are useful for understanding the overall system, but Lina should not hide scheduler execution or notification delivery inside a generic fact-store node. Memory can retain an intention; automation owns scheduling and execution. [Architecture, standing intents section][o-architecture], [plugin registration, lines 260–340][o-index]

## Implications for Lina

These are proposed design decisions, not claims that both projects share one common implementation.

1. Keep curated facts/preferences, episodic evidence, searchable history and procedural knowledge distinguishable. Keep task execution checkpoints and pending approvals in State. Keep model-visible packing in Context.
2. Separate read and write flows. Read should resolve authorized scope, select/query a source, retrieve, rank, expand evidence and return a budgetable context contribution. Write should capture source evidence, classify origin and retention eligibility, extract candidates, resolve duplicates/corrections, review mutation, commit and publish/sync indexes.
3. Specify trusted automatic injection independently from explicit search. A high score is not permission, and a retrieved quotation is not a new authoritative instruction.
4. Distinguish immediate local writes from asynchronous extraction, index visibility and external replication. Contracts need accepted/applied/index-pending/mirror-failed states, not one boolean called saved.
5. Make deletion include lineage selection, tombstone, corpus/index cleanup and downstream propagation. Report residual copies and partial cleanup. Avoid promising global erasure.
6. Bound maintenance and allow recall degradation without silently claiming complete knowledge. Missing store, disabled memory, empty results, stale index and provider failure are different branches.
7. Give children explicit read scope and write/contribution policy. Parent-reviewed contribution is a reasonable Lina baseline; automatic shared write authority is not established by these sources.

Visible candidate nodes include Resolve memory scope, Prepare recall query, Retrieve candidates, Rank/select evidence, Read selected evidence, Capture memory evidence, Classify memory eligibility, Extract candidates, Resolve changes, Review memory mutation, Commit memory changes, Publish memory index, Consolidate memory and Forget memory. This is a research-informed decomposition for review, not a requirement for fourteen boxes. Some steps can remain internal when they have no independently inspectable decision or experiment.

Meaningful experiments include frozen versus refreshed curated injection, explicit versus automatic recall, lexical/vector/hybrid retrieval, selective expanded evidence, relevance/recency/diversity ranking, extraction timing, bounded versus broader curated memory, and model-assisted consolidation within deterministic guards. Scope enforcement, honest receipts, secret handling, source lineage, stale-write protection and deletion consistency are correctness requirements before comparisons, not optional quality experiments.

## Source references

[h-init]: https://github.com/NousResearch/hermes-agent/blob/38880bd2f1e90dbc9a1aeec03af62539ee64719a/agent/agent_init.py#L1258-L1376
[h-store]: https://github.com/NousResearch/hermes-agent/blob/38880bd2f1e90dbc9a1aeec03af62539ee64719a/tools/memory_tool_store.py#L141-L512
[h-tool]: https://github.com/NousResearch/hermes-agent/blob/38880bd2f1e90dbc9a1aeec03af62539ee64719a/tools/memory_tool.py#L38-L210
[h-manager]: https://github.com/NousResearch/hermes-agent/blob/38880bd2f1e90dbc9a1aeec03af62539ee64719a/agent/memory_manager.py#L173-L970
[h-provider]: https://github.com/NousResearch/hermes-agent/blob/38880bd2f1e90dbc9a1aeec03af62539ee64719a/agent/memory_provider.py#L93-L200
[h-search]: https://github.com/NousResearch/hermes-agent/blob/38880bd2f1e90dbc9a1aeec03af62539ee64719a/tools/session_search_tool.py#L1-L315
[h-memory-live]: https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/
[h-providers-live]: https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers/
[o-architecture]: https://github.com/openclaw/openclaw/blob/a07a06ec94d2eda4ba1a7cab869395d5222092bf/docs/concepts/memory-architecture.md
[o-overview]: https://github.com/openclaw/openclaw/blob/a07a06ec94d2eda4ba1a7cab869395d5222092bf/docs/concepts/memory.md#L190-L222
[o-index]: https://github.com/openclaw/openclaw/blob/a07a06ec94d2eda4ba1a7cab869395d5222092bf/extensions/memory-core/index.ts#L205-L340
[o-hybrid]: https://github.com/openclaw/openclaw/blob/a07a06ec94d2eda4ba1a7cab869395d5222092bf/extensions/memory-core/src/memory/hybrid.ts#L65-L327
[o-search]: https://github.com/openclaw/openclaw/blob/a07a06ec94d2eda4ba1a7cab869395d5222092bf/docs/concepts/memory-search.md
[o-read]: https://github.com/openclaw/openclaw/blob/a07a06ec94d2eda4ba1a7cab869395d5222092bf/extensions/memory-core/src/memory-read-tool.ts#L12-L74
[o-flush]: https://github.com/openclaw/openclaw/blob/a07a06ec94d2eda4ba1a7cab869395d5222092bf/extensions/memory-core/src/flush-plan.ts#L63-L107
[o-flush-host]: https://github.com/openclaw/openclaw/blob/a07a06ec94d2eda4ba1a7cab869395d5222092bf/src/auto-reply/reply/agent-runner-memory.ts#L832-L1368
[o-candidates]: https://github.com/openclaw/openclaw/blob/a07a06ec94d2eda4ba1a7cab869395d5222092bf/extensions/memory-core/src/dreaming-consolidation-candidates.ts#L4-L24
[o-consolidation]: https://github.com/openclaw/openclaw/blob/a07a06ec94d2eda4ba1a7cab869395d5222092bf/extensions/memory-core/src/dreaming-consolidation.ts#L21-L485
[o-origins]: https://github.com/openclaw/openclaw/blob/a07a06ec94d2eda4ba1a7cab869395d5222092bf/extensions/memory-core/src/memory-entry-origins.ts#L120-L255
[o-forget]: https://github.com/openclaw/openclaw/blob/a07a06ec94d2eda4ba1a7cab869395d5222092bf/extensions/memory-core/src/memory-forget-kernel.ts#L1-L101
[o-deletion]: https://github.com/openclaw/openclaw/blob/a07a06ec94d2eda4ba1a7cab869395d5222092bf/docs/concepts/memory-provenance.md
[o-lock]: https://github.com/openclaw/openclaw/blob/a07a06ec94d2eda4ba1a7cab869395d5222092bf/extensions/memory-core/src/memory-workspace-lock.ts
[o-generation]: https://github.com/openclaw/openclaw/blob/a07a06ec94d2eda4ba1a7cab869395d5222092bf/extensions/memory-core/src/memory/manager-index-generation-lease.ts
