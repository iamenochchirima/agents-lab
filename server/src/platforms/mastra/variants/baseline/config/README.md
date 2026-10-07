# Configuration

The baseline reads requested `capabilities.tools.maxCalls` and `maxRounds` first.
When capabilities are absent it uses the platform's `maxToolCalls` and
`maxToolRounds`, then defaults to eight calls and six model steps.

`maxRounds` counts SDK model steps, including the final text response. A normal
calculator interaction needs two steps. If the last allowed step still requests
tools, the run fails with `MASTRA_MODEL_ROUND_LIMIT_EXCEEDED`.

Both Mastra variants share one call counter for all enabled tools per execution.
Each wrapper invocation reserves a call before asynchronous dispatch. Invalid or
policy-denied calls consume that allowance too. A call over the limit emits
`ToolCallRequested` and `ToolCallRejected`, but never
`ToolExecutionStarted`. Actual dispatches therefore cannot exceed `maxCalls`.
The baseline reports `MASTRA_TOOL_CALL_LIMIT_EXCEEDED` even when the SDK converts
the rejected tool exception into model feedback. The workflow fails its native
model step under the same condition.

The execution timeout and model/provider selection remain platform configuration.
No live provider is needed for the scripted regression tests.

The agent's system instruction is exactly `manifest.context.systemInstruction`.
Both variants forward that value, including through persisted workflow inputs.
Prepared context retains developer instructions and compaction summaries; only
the session's original system message is omitted because the Agent sends it as
its instruction. The current user prompt is also omitted from historical context
and submitted once to `generate()`. Mastra adds no hidden variant instruction.
Older persisted workflow inputs use the common manifest default when the
instruction field is absent.

A scripted evaluator may opt into `MastraBaselineRunner.onToolObservation`.
This process-local callback receives the actual call and registry result, including
their correlation IDs. Ordinary runners capture no tool content. The evaluator
owns filtering its synthetic observations and writing safe evidence.
