# Goal-oriented computer use: local Hermes and OpenClaw notes

**Date:** 2026-09-20<br>
**Scope:** local source inspection for the Anesu goal-oriented computer-use plan

This note records implementation facts observed in the local Hermes and OpenClaw
checkouts. It is design input, not a claim that either project provides a complete or
universally safe computer-use implementation.

## Hermes

### The agent loop is explicitly bounded

Hermes separates turn orchestration from tool-round execution. The local source map
identifies `agent/conversation_loop.py::_run_conversation_turn` as the owner of API-call
budgets, response classification, recovery, tool rounds, and terminal exits. The loop
delegates a tool round to `agent/turn_tool_round.py::run_tool_round` rather than placing
tool execution in the CLI. `agent/iteration_budget.py::IterationBudget` provides a
thread-safe iteration counter.

Observed source paths:

- `/home/enoch/aworkspace/agents/hermes-agent/agent/conversation_loop.py`
- `/home/enoch/aworkspace/agents/hermes-agent/agent/turn_tool_round.py`
- `/home/enoch/aworkspace/agents/hermes-agent/agent/iteration_budget.py`
- `docs/research/harness-code-maps/hermes.md`

Implication for Anesu: a computer-use goal should be a bounded child loop of the
existing runtime. Step count, deadline, cancellation, and terminal settlement belong to
code, not to instructions asking the model to behave.

### Computer use is a managed tool and host session

Hermes exposes computer use through the normal tool path. The implementation is split
across `tools/computer_use/tool.py`, the CUA backend/session modules, and the CLI
subcommand. Permission/readiness checks are kept in `tools/computer_use/permissions.py`
and are distinct from the action backend.

Observed source paths:

- `/home/enoch/aworkspace/agents/hermes-agent/tools/computer_use/tool.py`
- `/home/enoch/aworkspace/agents/hermes-agent/tools/computer_use/cua_backend.py`
- `/home/enoch/aworkspace/agents/hermes-agent/tools/computer_use/cua_backend_session.py`
- `/home/enoch/aworkspace/agents/hermes-agent/tools/computer_use/permissions.py`
- `/home/enoch/aworkspace/agents/hermes-agent/hermes_cli/subcommands/computer_use.py`

Implication for Anesu: retain the existing managed browser and CUA adapters. Do not let
the goal loop call driver methods directly or use a shell command as an alternate input
path.

### Guardrails are not model decisions

Hermes has a separate `agent/tool_guardrails.py` seam and computer-use permission
handling. The model can request an action, but readiness, permissions, and host policy
remain code-owned decisions.

Implication for Anesu: Jev confidence, vision coordinates, and a model's statement that
the task is complete can inform a decision, but they cannot authorize input or establish
success by themselves.

## OpenClaw

### Run orchestration separates retry, abort, and terminal settlement

The local embedded runner in `src/agents/embedded-agent-runner/run-loop.ts` prepares an
attempt, dispatches it, normalizes the result, and distinguishes completion from retry
and recovery outcomes. The run loop also carries abort and context-recovery state across
attempts. Tool execution is not folded into the terminal UI.

Observed source paths:

- `/home/enoch/aworkspace/agents/openclaw/src/agents/embedded-agent-runner/run-loop.ts`
- `/home/enoch/aworkspace/agents/openclaw/src/agents/agent-tools.execution-preparer.ts`
- `docs/research/harness-code-maps/openclaw.md`

Implication for Anesu: action retry and model/provider retry must stay separate. A
provider may be retried before input, while an input whose delivery is uncertain must
become `outcome-unknown` or require reconciliation, never an automatic second click.

### Approval is an execution boundary

OpenClaw's `src/agents/agent-tools.before-tool-call.approval.ts` resolves approval before
the tool action is executed. The execution-preparer and validation modules remain
separate from the approval adapter.

Observed source paths:

- `/home/enoch/aworkspace/agents/openclaw/src/agents/agent-tools.before-tool-call.approval.ts`
- `/home/enoch/aworkspace/agents/openclaw/src/agents/agent-tools.execution-preparer.ts`
- `/home/enoch/aworkspace/agents/openclaw/src/agents/agent-tools.execution-validation.ts`

Implication for Anesu: approval must bind to one complete action identity produced from
one fresh observation. A later observation cannot silently mutate the approved target or
payload.

### The computer host owns frames, execution state, and artifacts

OpenClaw's `extensions/cua-computer` keeps computer commands, execution state, action
targets, browser/window actions, and driver artifacts in the host extension. The node
command boundary is separate from the agent loop.

Observed source paths:

- `/home/enoch/aworkspace/agents/openclaw/extensions/cua-computer/src/commands.ts`
- `/home/enoch/aworkspace/agents/openclaw/extensions/cua-computer/src/execution-state.ts`
- `/home/enoch/aworkspace/agents/openclaw/extensions/cua-computer/src/action-targets.ts`
- `/home/enoch/aworkspace/agents/openclaw/extensions/cua-computer/src/driver-artifacts.ts`
- `/home/enoch/aworkspace/agents/openclaw/extensions/cua-computer/src/driver-artifact-verification.ts`
- `/home/enoch/aworkspace/agents/openclaw/docs/nodes/computer-use.md`

Implication for Anesu: browser and native adapters should own their observation identity,
target freshness, artifacts, and verification facts. The shared goal loop should consume
a normalized result while preserving adapter-specific evidence.

## Decisions for Anesu

1. Add one bounded goal loop on top of the existing browser/native runners; do not add a
   second agent runtime.
2. Keep approval per side-effecting action, not per entire multi-step goal.
3. Use environment-owned browser and native verifiers. Model `done` is never proof.
4. Keep provider retries before input separate from action execution and never replay an
   uncertain input.
5. Keep TUI progress and durable evidence as projections of typed runtime events rather
   than implementing a second state machine in the CLI.
6. Start with a small verifier matrix and deterministic fixtures. Do not add a generic
   screenshot-success classifier, new OCR stack, or arbitrary desktop automation in this
   slice.

## Limits of this review

This review establishes loop, approval, host-boundary, and evidence patterns. It does not
claim Hermes or OpenClaw has identical semantics to Anesu, and it does not establish
that either project provides a general application-agnostic goal verifier. Those limits
are why the Anesu plan requires explicit browser/native verifier contracts and honest
`outcome-unknown` results.
