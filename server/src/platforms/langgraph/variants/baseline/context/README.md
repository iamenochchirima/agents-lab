# context

The Lab's TypeScript `ContextService` owns context assembly, budget decisions, and
compaction before a LangGraph run is dispatched. The runner passes the resulting
`snapshotId` with the session and turn identity. The Python service reads that exact
snapshot and emits its ID, budget, pressure, quality, and compaction state without
recomputing the context. A direct Python request without a snapshot is supported only
as an explicit compatibility path and is marked as estimated.

The native `context` node checks the growing transcript before each model round.
It uses the shared character-estimate budget convention, reserves 4,096 output
tokens plus a 1,024-token safety margin, and accounts for the admitted tool catalog.
At 20% remaining capacity it summarizes complete assistant/tool groups. It keeps
the latest group when possible, and retains the active user task and all system
or developer messages, including admitted skill instructions. Tool-call IDs and
result IDs must form a complete group before that group can be summarized.

The summary model call belongs to this native node. A synchronous checkpoint
persists its revised messages and compaction revision before the next inference.
The working compaction revision is separate from the immutable shared snapshot
revision, so a later admitted turn can still use the unchanged canonical snapshot.
An uncheckpointed summary intent after interruption requires reconciliation,
so recovery never regenerates a potentially completed provider call blindly.
This is request-local working context; it does not rewrite the canonical session
snapshot or transcript. Estimates are not tokenizer measurements. An unknown
context window disables the pressure check; an exhausted context with no complete
group, or a summary that leaves the budget exhausted, fails before further agent
inference. The Python policy exists at the language boundary and should remain
aligned with the shared TypeScript policy.


A successful admitted packaged `load_skill` result is also retained in native
`loaded_skill_contexts` state. Recognition binds the frozen source package/version,
standard loader execution identity (including managed profile aliases), selected
schema name, digest, and `trust: untrusted`/`authority: none` metadata. Arbitrary
source JSON claiming to be a skill is not sufficient. Before each model request,
missing retained skill bodies become protected user context, granting no authority.
A completed loader call/result group can therefore be compacted without removing
the procedure. The body and provenance survive native checkpoint reconstruction;
no skill is reloaded or summary regenerated merely to recover that checkpoint.
