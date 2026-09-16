# Durable memory

This module owns the Computer Native durable-memory boundary. It deliberately
keeps the canonical data inspectable and the retrieval index disposable:

- `memory/USER.md` stores user-scoped entries.
- `memory/MEMORY.md` stores workspace-scoped entries.
- `memory/daily/YYYY-MM-DD.md` stores dated daily entries.
- `memory/index.sqlite` is a rebuildable local lookup index; it is never the
  source of truth.

`MemoryStore` validates content before a write, takes a memory lock, reloads the
canonical Markdown, writes the affected files through same-directory atomic
replacement, and rebuilds the index. Replacement and removal require the
current SHA-256 content hash. This prevents a stale model read from silently
overwriting a newer entry. Search and exact reads are bounded and filtered to
the active profile and workspace identity.

The model-facing tools are intentionally split into read and write paths:
`memory_search` and `memory_get` are read-only; `memory` and `memory_forget`
create an exact approval request before any durable mutation. Memory is
advisory context, not a policy or permission source, and bootstrap context is
bounded accordingly.

The `memory` tool also accepts one bounded same-scope consolidation batch of up to
eight add, replace, or remove operations. The batch is validated and approved as one
exact proposal, and its durable action record retains a hash-only member manifest for
restart reconciliation. Before publication, a bounded batch journal records the expected
before/after hash for each changed canonical file. Recovery classifies all-before as not
applied, all-after as committed, and mixed or unexpected hashes as partial/ambiguous; it
never replays a member and does not claim a cross-file transaction or rollback. Mixed
batches emit one terminal action event so the normalized lifecycle does not close one
operation identity multiple times.

Search evidence stores a query digest, scopes, result references, and truncation status
without persisting the query text. Memory lifecycle evidence is append-only JSONL so
proposal, approval timeout, and terminal outcomes remain inspectable after a restart.
Removal also keeps hash-only deletion evidence under the managed memory directory: a
prepared marker and a committed marker bind the record ID, source call, pre/post content
hashes, and pre/post canonical-file hashes. Recovery uses this evidence rather than
assuming that a missing record proves a deletion.

Deletion and batch-publication evidence is maintained under the same memory lock. On
open, only an unterminated final JSONL line is treated as a crash-truncated append and
repaired; other malformed or invalid records fail closed. Explicit maintenance
deduplicates stable operation identities and expires completed evidence after the
configured retention window. Prepared deletion evidence and entries needed for active
records are retained, and an entry bound is enforced without dropping evidence silently.
The CLI invokes maintenance after interrupted-turn recovery; callers of `MemoryStore`
can invoke `maintainEvidence` directly when they own a different lifecycle.

The implementation uses Node's built-in `node:sqlite` module so this extracted
package does not add a native database dependency. The schema is ordinary
SQLite tables rather than FTS5 because FTS5 is not available in every Node
runtime supported by the development environment; ranking remains bounded and
deterministic in TypeScript, and the index can always be rebuilt from Markdown.
