# context

The Lab's TypeScript `ContextService` owns context assembly, budget decisions, and
compaction before a LangGraph run is dispatched. The runner passes the resulting
`snapshotId` with the session and turn identity. The Python service reads that exact
snapshot and emits its ID, budget, pressure, quality, and compaction state without
recomputing the context. A direct Python request without a snapshot is supported only
as an explicit compatibility path and is marked as estimated.
