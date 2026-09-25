# Tool Use module

This package defines tool listing, call validation, and dispatch contracts. Tool
definitions are model-facing descriptions; raw proposed arguments remain `unknown`
until validated. The caller can inspect the validation result, ask Safety to evaluate
the validated call, then dispatch that `ValidatedToolCall` through an injected
`ToolExecutor`. The executor is responsible for calling a tool through the selected
execution environment and returning a bounded receipt.

Tool Use does not authorize risk or grant environment access. The caller must run
the Safety decision before dispatch and must supply only the executor selected by
the assembly. This ordering is a caller invariant until the kernel owns composition.
Completed, failed, cancelled, timed-out, and unknown outcomes are distinct; an
unknown result after a side effect must not be retried automatically. The module
owns no durable state in this v0 contract.

Use `parseToolUseConfig` before construction. The parser rejects unsupported fields,
non-integer values, and limits outside the declared bounds.

| Setting | Default | Accepted range |
| --- | ---: | ---: |
| `maxCallsPerTurn` | 12 | 1–10,000 |
| `maxArgumentBytes` | 16,384 | 1–10,000,000 |
| `maxResultBytes` | 65,536 | 1–100,000,000 |
| `timeoutMs` | 30,000 | 1–3,600,000 |

```sh
pnpm --filter @agent-harness-lab/module-tool-use typecheck
pnpm --filter @agent-harness-lab/module-tool-use test
```

This package defines interfaces and config only. It does not include a registry,
tool implementation, authorization policy, or execution environment.
