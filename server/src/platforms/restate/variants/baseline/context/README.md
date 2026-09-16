# Context boundary

The common server admits and settles the session turn. The Restate baseline
prepares that turn's canonical filesystem-backed context snapshot inside one
named durable `ctx.run` action before requesting the model. It records the
snapshot ID, revision, budget, pressure, token-count quality, and whether
compaction occurred in normalized `ContextPrepared` evidence.

The snapshot's system instruction and transcript messages become the initial
Restate model messages. The workflow then owns the durable model/tool loop for
that invocation. A provider-reported token count remains request evidence; it
does not replace the persisted snapshot or session projection.

The preparation action is safe to replay because the context service derives a
stable snapshot ID from the session revision and compaction revision, and the
store rejects conflicting content for an existing snapshot. Provider-overflow
recovery and a platform-native context store are not part of this baseline yet.
