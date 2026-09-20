# Observability

Owns server logs, traces, and metrics without changing experiment semantics.

Each retained run may contain `logs/operations.jsonl`. It is a bounded,
newline-delimited stream of safe lifecycle evidence: operation name, request
ID, platform and variant, normalized status, native status when exposed by the
adapter, outcome classification, retry count, timing, and safe error code. It never stores
prompts, model output, credentials, or arbitrary native request payloads.

The stream is diagnostic and at-least-once. A failed log write is ignored by
the HTTP boundary and cannot turn an accepted platform execution into a failed
run. Run events, results, trajectories, metrics, and native references remain
the authoritative evidence records. The file is capped at 8 MiB per run and
each record is capped at 32 KiB; exceeding those bounds is an observability
failure, not a run-state transition.
