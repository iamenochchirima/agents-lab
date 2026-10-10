# Shared identity and explicit memory

This store belongs to the backend capability layer. Platform execution and Studio
trial state do not own it. It exposes no filesystem tools and adds no dependency.

`AgentStateStore(root)` stores one schema-versioned JSON snapshot. Mutations hold a
cross-process lock and atomically publish both state and operation receipts with
file and directory synchronization. A failed acknowledgement can be retried using
the same operation ID and payload. Conflicting reuse fails. Live writers are never
evicted because a time limit expired. Dead process locks are recovered; a lock
without an owner file requires operator inspection rather than unsafe eviction.
This is local filesystem durability, not a distributed storage guarantee.

Identity is operator instruction. Its history is retained by revision for old
sessions. Markdown import accepts the exact exported name, purpose, style,
initiative and behavior sections as text; it never resolves paths or executes
imports. Runtime permission checks remain outside editable identity.

Memory is factual data, with an explicit namespace, provenance and revision.
`workspace-local` is the default local scope. Experiments supply separate namespaces.
A caller must supply revision zero for saves and the exact current revision for
updates and forgetting. Automatic extraction and consolidation are absent.

Recall ranks lexical matches deterministically and includes explicit preferences
first. Its projection records every included source and revision, omitted count,
UTF-8 byte count and digest. It never shortens a record into a different fact.
The surrounding context service remains responsible for token accounting.
Admission freezes that recall text and its metadata on the turn. Context snapshots
retain the namespace, enablement, each included record's revision, omitted count,
byte count and digest even when no memory message is included. Retries reuse this
evidence rather than consulting updated memory. Older turns and snapshots omit
the optional metadata; absence means unavailable evidence, not zero omissions.

`createAgentMemoryTools(store, resolveBinding)` returns hosted catalog contributions.
The resolver reads namespace and enablement from the recorded run; model arguments
cannot select scope. Write operation IDs derive from run and tool-call identity.
Descriptions restrict memory writes to explicit user requests. The normal runtime
must enforce capability grants and retain call receipts. These writes need no
second approval; connected external mutations still follow their ordinary policy.

Forgetting removes content from active retrieval and leaves a tombstone preventing
reuse of its identity. Prior mutation receipts and transcripts retain historical
content as run evidence. This does not promise erasure of historical evidence.
A fresh explicit save can use a new identity.

Limits are explicit: 512 active records per namespace, 4096 overall, 8192 forget
tombstones, 16384 operation receipts, 256 identity revisions and a 64 MiB snapshot.
The store rejects changes at its limits instead of silently pruning idempotency or
history. Archiving requires retaining old run projections and scope isolation.
