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
exact proposal, but canonical files are still published individually; this does not
claim a cross-file transaction.

Search evidence stores a query digest, scopes, result references, and truncation status
without persisting the query text. Memory lifecycle evidence is append-only JSONL so
proposal, approval timeout, and terminal outcomes remain inspectable after a restart.

The implementation uses Node's built-in `node:sqlite` module so this extracted
package does not add a native database dependency. The schema is ordinary
SQLite tables rather than FTS5 because FTS5 is not available in every Node
runtime supported by the development environment; ranking remains bounded and
deterministic in TypeScript, and the index can always be rebuilt from Markdown.
