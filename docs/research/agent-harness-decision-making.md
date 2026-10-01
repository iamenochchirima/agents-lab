# Agent harness decision-making

**Research date:** 2026-09-23<br>
**Scope:** How to keep Lina model-directed while placing safety and reliability checks in the runtime and tool boundary. This note compares first-party agent guidance with the local Hermes and OpenClaw computer-use paths. It records design guidance, not a claim that these projects provide identical guarantees.

## Finding

The user's distinction is real. A predefined sequence of model and tool steps is a workflow. An agent gets a goal, sees the tools and current evidence, chooses what to do next, receives the result, and can change course. The harness still owns tool availability, authorization, resource limits, lifecycle, and evidence. It should not quietly become a second task planner made of prompt regexes.

Anthropic explicitly distinguishes predefined workflows from agents whose models dynamically direct their process and tool use. It recommends simple designs and well-documented interfaces for model capabilities. OpenAI's Agents SDK describes the loop as model call, model-selected tool execution, tool results appended to context, then another model call until final output. Its guardrails wrap input/output or tool execution instead of prescribing task steps. [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents), [OpenAI: Running agents](https://openai.github.io/openai-agents-python/running_agents/), [OpenAI: Guardrails](https://openai.github.io/openai-agents-python/guardrails/).

## What the reference implementations show

- **Hermes:** one generic `computer_use` tool exposes observed UI and input operations. It classifies action evidence as confirmed, unverifiable, or likely no-op. Unverifiable effects call for fresh observation; escalation advice does not authorize replay. It does not encode a separate scripted workflow for every user goal. See the [computer-use tool](https://github.com/NousResearch/hermes-agent/blob/main/tools/computer_use/tool.py) and [tool schema](https://github.com/NousResearch/hermes-agent/blob/main/tools/computer_use/schema.py).
- **OpenClaw:** the model-facing computer action follows provider-advertised capabilities. Host code owns execution identity, target freshness, permission policy, and structured refusal/effect evidence. Its guidance says action evidence alone does not establish the user's goal, and the agent should observe again before another mutation. See [computer-use guidance](https://docs.openclaw.ai/nodes/computer-use) and the local `src/agents/tools/computer-tool-guidance.ts` and `extensions/cua-computer/src/` sources.
- **Lina:** its current Jev path already lets the model choose a current Cua candidate, and its runtime can validate the choice against a task grant. That is the right basic seam. The current task compiler and runner then add extra deterministic interpretation: prompt regexes choose the surface and action classes, `allowedActions` are also treated as required progress, and a regex fast path can finish before Jev sees an interaction request. Those rules are not required by Hermes or OpenClaw, and the last one is already contradicted by the link-follow regression.

## Design rule for Lina

Keep the division plain:

| The agent decides from the goal and current observation | The runtime enforces regardless of the agent's choice |
| --- | --- |
| Which available tool or Cua action to use | Which tools/capabilities this run actually has |
| What observed target and task-relevant value to pass | Schema and argument validation |
| Whether to inspect, act, re-observe, continue, clarify, or answer | Session, origin, workspace, and target identity boundaries |
| Whether available evidence answers an informational request | Approval for consequential actions, cancellation, deadlines, budgets, and no-replay after uncertainty |

`allowedActions` is an authorization ceiling, not a checklist. Task progress belongs to the model's interaction with fresh results. Code-owned postcondition checks are appropriate where a precise external fact must be proved, especially for consequential mutations. Do not require every ordinary read or navigation goal to match a hardcoded verifier vocabulary before the agent can try the available tools.

Errors should be returned as useful, typed tool results when it is safe to continue. The model can then choose an alternative, ask the user, or stop. A refusal must not be converted into success, and an uncertain side effect must not be replayed automatically.

## Review gates to prevent deterministic-workflow creep

Before changing an agent capability:

1. Read the actual reference agent loop and tool/host boundary. Record what the model chooses and what the host enforces, with source locations. Do this before designing Lina-specific abstractions.
2. For every deterministic branch, state the concrete invariant it protects. Keep it if it validates a real boundary such as identity, capability, freshness, approval, resource use, or persistence. Challenge it if it infers user intent, chooses the task sequence, requires actions merely because they are permitted, or declares completion from prompt wording.
3. Make tools discoverable and legible: describe their real capability, arguments, observation inputs, side effects, and refusal results. Let the model use the tools iteratively. Do not synthesize a tool call merely because a regex thinks the user intended one.
4. Test the harness loop and its boundaries, not a deterministic script for every phrasing. Use model-recording tests to prove tool results return to the model, safety tests for denied/stale/out-of-scope actions, and a small set of ordinary live prompts to prove the full path.
5. Keep each implementation slice tied to one user-visible capability. Do not broaden the plan or test matrix without a demonstrated failure, a reference implementation requirement, or a clear product need.

The practical success test is visible in the run trace: user goal reaches the model; the model selects an available tool; the runtime validates and executes that call; the observation/error returns to the model; and the model either chooses another step or gives an answer grounded in the returned evidence. A code path that skips the model and decides the requested action from wording needs a specific, documented reason.

## Sources

- Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents), accessed 2026-09-23.
- Anthropic, [Trustworthy agents in practice](https://www.anthropic.com/research/trustworthy-agents), accessed 2026-09-23.
- OpenAI, [Agents SDK: Running agents](https://openai.github.io/openai-agents-python/running_agents/), [Tools](https://openai.github.io/openai-agents-python/tools/), and [Guardrails](https://openai.github.io/openai-agents-python/guardrails/), accessed 2026-09-23.
- Hermes, [computer-use tool source](https://github.com/NousResearch/hermes-agent/blob/main/tools/computer_use/tool.py) and [schema](https://github.com/NousResearch/hermes-agent/blob/main/tools/computer_use/schema.py), accessed 2026-09-23; local checkout inspected at `/home/enoch/aworkspace/agents/hermes-agent`.
- OpenClaw, [computer-use documentation](https://docs.openclaw.ai/nodes/computer-use), accessed 2026-09-23; local checkout inspected at `/home/enoch/aworkspace/agents/openclaw`.
- Lina, current working tree: `src/computer/runner.ts`, `src/computer/task.ts`, `src/computer/verification.ts`, and `src/runtime/turn.ts`.
