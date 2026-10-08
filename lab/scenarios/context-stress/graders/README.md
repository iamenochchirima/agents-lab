# Context Stress graders

No answer grader is defined for the `old-important-fact` fixture. Context selection
evidence records included and omitted sources; it does not grade whether a response
recovers the stated preference.

Keep scenario correctness separate from generic harness metrics such as latency, cost, and recovery rate.

The separate `x05-compaction-v1` fixture has an exact constrained JSON answer check
and independent budget, summary-provenance and mapped-request assertions in
`server/src/evals/compaction-contracts.ts`. This does not add an answer grader for
`old-important-fact`. See [native compaction acceptance](../../../experiments/agent-compaction-scripted/README.md).
