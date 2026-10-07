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
