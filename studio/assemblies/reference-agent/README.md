# Reference Studio assembly

`createReferenceAgent()` constructs the one fixed, versioned Studio reference
assembly. Its descriptor selects one implementation and configuration for all
twelve module areas. A static registry rejects unknown identities, duplicate or
missing areas, altered configurations, and unsupported descriptor versions before
the assembly is resolved.

| Area | Selected baseline | Responsibility in this assembly |
| --- | --- | --- |
| Input | `text-input-normalizer@0.1.0` | Converts submitted text and host provenance to a task. |
| Context | `deterministic-context-assembler@0.4.0` | Orders messages, applies the configured budget, and records included or omitted sources. |
| Planning | `single-step-response-planner@0.1.0` | Proposes one advisory response plan from the initial Context. |
| Memory | `in-memory-session@0.1.0` | Recalls and writes session-scoped episode records. |
| Tool Use | `strict-tool-use@0.2.0` | Validates `calculator.add` and `computer.click` calls. |
| Computer Use | `scoped-computer-use@0.2.0` | Observes the fixture page, performs a proposed action, and reports verification. |
| Control | `bounded-single-turn-control@0.2.0` | Runs the bounded model/action loop and owns termination. |
| Execution Environment | `controlled-reference-environment@0.2.0` | Provides in-process arithmetic and a controlled fixture page. |
| Output Actions | `text-output-actions@0.1.0` | Prepares a text response and sends it to the API-owned response sink. |
| Safety | `allowlist-safety@0.2.0` | Allows only configured calculator, computer, output, and Memory effects; denies by default. |
| Model Interface | `deterministic-reference-model@0.1.0` | Uses Replay for ordinary text and fixed scripts for the two named action scenarios. |
| Observability | `jsonl-observability-recorder@0.1.0` | Stores ordered protocol events and module-specific evidence. |

## Controlled runs

- Ordinary chat sends free text through the full selected assembly. The Replay
  behavior reports the model request shape; it does not answer semantically.
- The calculator scenario emits one fixed `calculator.add(19, 23)` call and checks
  the correlated `42` result.
- The computer scenario clicks the fixture page's `say-hello` button and checks
  that the controlled page changed.

All three paths report the same assembly ID, version, component selections, and
configuration. Scenario choice is a task/run condition, not a different module
assembly. These fixtures call no external LLM, browser, desktop, or network service.

## Boundaries and limits

The package constructors are compiled into the static registry. Studio does not
install packages from the browser or import arbitrary contributed code. A
contract-conforming test double can replace a selected module in a kernel/assembly
check without shipping a second implementation.

Memory and chat history live in the API process and are cleared on API restart,
New chat, or session eviction. The controlled Environment has no filesystem,
process, browser, or network access. Planning does not replan after an action.
Context estimates tokens using UTF-8 JSON-message bytes divided by four; this is
not a provider tokenizer. These runs test module interaction and evidence, not
model quality or production environment behavior.
