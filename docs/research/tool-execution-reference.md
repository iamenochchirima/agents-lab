# Tool execution reference

**Research date:** 2026-09-16
**Scope:** The local tool/action loop, policy gates, persistence, cancellation, and observability in Hermes, OpenClaw, and Waku. This note records what the checked-out code does. It is reference material for the implementation plan, not a claim that the projects have identical guarantees.

The repositories inspected were:

- `/home/enoch/aworkspace/agents/hermes-agent`
- `/home/enoch/aworkspace/agents/openclaw`
- `/home/enoch/aworkspace/agents/waku-agent`

## Findings

### Hermes

Hermes separates a tool round from the larger conversation loop. It validates names and arguments, normalizes call IDs, appends the assistant tool-call message, persists that message, executes tools, persists tool progress, and only then continues with another model request. The persist-before-execute rule is documented in the module docstring and implemented at `agent/turn_tool_round.py:1-5,52-55,116-144` and `agent/tool_executor.py:173-196`.

Its validation path does more than reject malformed input. It repairs some mismatched names, keeps one tool result for every emitted call, handles mixed valid/invalid batches, retries malformed JSON arguments, and stops after repeated invalid calls. See `agent/turn_tool_validation.py:23-35,69-77,86-138,140-161`.

Hermes carries a stable identity object through dispatch, middleware, result emission, and cancellation. It also has explicit limits for concurrent workers, per-batch timeouts, and approval-wait locking. See `agent/tool_executor.py:91-114,147-196,217-224,248-296`.

The useful lesson for the Lab is ordering. A tool call must become durable evidence before a mutating implementation can run, and a tool result must become canonical before it is sent back to the model. If persistence fails, Hermes ends the turn instead of continuing from process-only state.

### OpenClaw

OpenClaw makes context and tool schemas visible operationally. Its context documentation counts the system prompt, history, tool calls, tool results, attachments, and tool schemas against the model window. It exposes per-run inspection and separates compacted prompt state from the retained transcript. See `docs/concepts/context.md:10-18,20-37,98-107,122-149,163-190`.

Its tool policy is an ordered chain. The before-tool-call policy receives the tool name, parameters, call ID, run/session identity, abort signal, workspace/sandbox information, and trace context. It can allow, rewrite, warn, defer, or veto a call. Ordering is part of the implementation contract. See `src/agents/agent-tools.before-tool-call.policy.ts:1-7,103-118,124-168,170-237`.

OpenClaw also distinguishes tool availability from external exposure. Its direct `/tools/invoke` endpoint applies authentication and tool policy, has a default deny list for high-risk operations such as shell, process creation, file mutation, session spawning, and gateway control, and returns sanitized errors. See `docs/gateway/tools-invoke-http-api.md:9-13,33-42,63-89,91-108,134-147`.

The runtime protects the model-facing conversation from unsafe or oversized tool output. Tool-result handling caps output, classifies errors, redacts sensitive values, and preserves structured error information. See `src/agents/embedded-agent-tool-results.ts:24-70,188-220`.

OpenClaw tracks tool-call identity after policy rewrites and detects repeated calls with unchanged arguments. It also gives runs stable abort reasons for direct cancellation and gateway restart cancellation. See `src/agents/tool-loop-call-reconciliation.ts:6-55` and `src/agents/run-termination.ts:15-37,88-107,136-161`.

The useful lesson for the Lab is that a registry alone is not a security model. The execution path needs a policy decision, an identity, an abort signal, output limits, redaction, and a stable distinction between unavailable, denied, failed, cancelled, and unknown outcomes.

### Waku

Waku keeps the basic loop easy to see. `waku/loop/agent.py:1-15,41-58` describes and implements the cycle: call the model with messages and schemas, inspect tool uses, execute them, append tool results, and repeat until the model returns text or `max_iterations` is reached. `waku/loop/agent.py:63-114` shows the complete flow.

Its registry gives each tool a name, description, input schema, and callable. The registry produces provider-facing schemas and converts tool exceptions into model-visible error text instead of crashing the loop. See `waku/tools/registry.py:1-5,15-58`.

Waku keeps observers outside the loop. The same event callback can feed the dashboard and the tracer without making either part of tool execution. Its application assembly injects the model client, database connection, tool registry, session, and tracer, which makes offline scripted clients possible. See `waku/loop/agent.py:28-31` and `waku/app.py:18-48,63-112`.

Its deterministic tests verify both positive and negative behaviour: the correct tool fires with the expected arguments, side effects are idempotent, history records tool use, a no-tool turn ends promptly, and a runaway loop stops at the configured iteration limit. See `evals/deterministic/test_tool_trigger.py:1-16,25-98`.

The useful lesson for the Lab is testability. The model client, registry, observer, and persistence should be replaceable at their seams so the same production path can be driven by deterministic fixtures and by the browser.

## Common implementation pattern

The three projects converge on this sequence:

```text
build context + tool schemas
  -> model request
  -> validate and authorize each tool call
  -> execute within an explicit resource/deadline boundary
  -> record and redact the result
  -> append the result to model input
  -> continue until final text or a hard stop
```

They differ in emphasis:

| Project | Strongest reference for the Lab |
| --- | --- |
| Hermes | Persistence ordering, malformed-call recovery, bounded concurrent execution, cancellation and tool-result lifecycle |
| OpenClaw | Policy composition, context/tool cost inspection, output redaction, high-risk exposure rules, run identity and abort semantics |
| Waku | Small loop shape, injected dependencies, observer-based UI/tracing, deterministic tool-call tests |

## Consequences for the Lab plan

1. The first tool must be deterministic and non-mutating. A calculator is enough to prove the complete model-call/tool-call/model-call path without introducing shell or external-account risk.
2. The shared layer should own provider-neutral tool definitions, call identity, validation results, policy decisions, and normalized lifecycle events. Platform directories should own how those steps become durable work.
3. Restate should execute each model request and tool call as a named durable step. The workflow must not perform network calls or other side effects outside a durable step.
4. OpenRouter requests with tool calls must preserve the provider's assistant tool-call message and the matching tool result message. A text-only adapter is insufficient.
5. The Lab must report at-least-once semantics around an external model request when the response is ambiguous. It must not call that exactly once.
6. The UI should show tool activity and context usage from server evidence. It must not infer success from a submitted request or manufacture a tool result.
7. Shell, filesystem mutation, browser automation, MCP, OAuth, plugins, social connectors, subagents, and human approvals need separate plans with their own isolation and side-effect tests.

