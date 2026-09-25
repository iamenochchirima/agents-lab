# Context module

This package defines how task instructions, conversation turns, retrieved Memory
candidates, and tool results become model-visible messages. The input material
types belong here so Context does not import Memory or Tool Use implementation
types. The kernel will adapt their results into `ContextMaterial`.

`ContextAssembler.assemble` receives a per-turn token budget and cancellation
signal. It returns the exact ordered messages and source IDs retained or omitted.
The module owns selection, ordering, and any compaction decisions. It does not own
durable Memory records or call the model. This v0 interface is request-scoped and
does not promise session persistence; if an implementation persists summaries, it
must declare that state and recovery behavior separately. Cancellation must be
checked before expensive assembly work. A partially produced result is not usable.

Use `parseContextConfig` before construction. Defaults are exported. Unknown
settings, non-integers, and values outside the documented bounds are rejected.

| Setting | Default | Accepted range |
| --- | ---: | ---: |
| `maxMessages` | 200 | 1–100,000 |
| `maxSourceBytes` | 2,000,000 | 1–100,000,000 |
| `minAvailableInputTokens` | 1 | 0–1,000,000 |

```sh
pnpm --filter @agent-harness-lab/module-context typecheck
pnpm --filter @agent-harness-lab/module-context test
```

This package currently defines the interface and config contract; it does not yet
include a budget-selection or compaction implementation.
