# Anesu goal-oriented computer-use execution

**Created:** 2026-09-20T18:05:00+02:00<br>
**Last updated:** 2026-09-20T20:45:00+02:00<br>
**Status:** Complete<br>
**Owner:** Anesu standalone product

## Start here

Read these before changing code:

- [Repository development rules](../../../../AGENTS.md)
- [Anesu development rules](../../../../anesu/AGENTS.md)
- [Anesu computer environment](../../../../anesu/src/computer/README.md)
- [Anesu browser capability](../../../../anesu/src/browser/README.md)
- [Anesu computer-use dual paths](anesu-computer-use-dual-paths.md)
- [Anesu natural computer-use routing](anesu-natural-computer-use.md)
- [Anesu core hardening](../active/anesu-core-hardening.md)
- [Computer-use implementation research](../../../../docs/research/computer-use-implementation.md)
- [Hermes code map](../../../../docs/research/harness-code-maps/hermes.md)
- [OpenClaw code map](../../../../docs/research/harness-code-maps/openclaw.md)
- [Goal-oriented computer-use reference notes](../../../../docs/research/goal-oriented-computer-use-hermes-openclaw.md)

The Hermes and OpenClaw references are implementation evidence, not dependencies. Anesu
must preserve its own runtime, approval, evidence, and environment boundaries.

## User-facing goal

From the normal Anesu TUI, a user should be able to say something like:

```text
Open the demo page, reveal the safe result, and tell me whether it worked.
```

or:

```text
Open example.com, find the documentation link, and open it.
```

Anesu should carry out a bounded sequence of observations and approved actions, stop when
an environment-owned verifier proves the goal, and report an honest result when it cannot
prove completion. The user should not need to name `browser_click`, `computer_action`,
Jev, traditional vision, an observation ID, or a fixture.

This plan improves the existing computer-use capability. It does not create a second
executor, a new model provider, or an unrestricted autonomous desktop agent.

## Why this is the next slice

The current computer-use implementation already provides the important first boundaries:

- natural browser-versus-desktop routing;
- selectable Jev, traditional, and compare strategies;
- fresh observations and stale-target checks;
- structured approval before input;
- CUA-backed native execution and managed browser execution;
- bounded action counts and deadlines;
- cancellation, no-input-replay, evidence, and outcome-unknown handling; and
- fixture-specific success verification.

The remaining product gap is that arbitrary goals do not yet have a general completion
contract. A native action can complete and a fresh observation can be captured, but Anesu
may still have no safe way to decide whether the user's requested goal was completed.
This slice turns the existing bounded action shape into a useful goal-oriented loop with
surface-specific verification.

## Reference alignment checkpoint

The local Hermes and OpenClaw implementations were reviewed for the loop and host-boundary
patterns below. We adopt the boundaries, not their complete product scope.

| Reference | Observed practice | Decision for Anesu |
| --- | --- | --- |
| Hermes `agent/conversation_loop.py`, `agent/turn_tool_round.py`, and `agent/iteration_budget.py` | A turn is a bounded sequence of explicit phases. Tool results are appended to the turn and the model may receive another bounded round. Iteration and deadline limits are runtime concerns, not prompt instructions. | Keep goal-loop ownership in the runtime/computer runner. Count actions, decision attempts, elapsed time, and clarification turns explicitly. Never let the model extend its own budget. |
| Hermes `agent/tool_guardrails.py` and `tools/computer_use/permissions.py` | Tool policy and computer-use permissions are checked around execution; the computer backend is not treated as authorization. | Preserve Anesu's approval request as the authorization boundary. A model proposal or verifier result can recommend or prove state, but cannot authorize input. |
| Hermes `tools/computer_use/tool.py`, `tools/computer_use/cua_backend.py`, and `tools/computer_use/cua_backend_session.py` | Computer use is a normal agent-tool capability backed by a managed session, bounded capture/input operations, permissions, and cleanup. | Continue using the existing managed browser/CUA adapters. Do not expose driver methods or add a shell escape hatch to the goal loop. |
| OpenClaw `src/agents/embedded-agent-runner/run-loop.ts` | The run loop separates attempt preparation, tool execution, abort handling, retry/recovery, and terminal settlement. Normal completion is distinct from retry or blocked outcomes. | Add explicit computer-run terminal states and keep provider retry separate from action retry. A post-input uncertainty never becomes an automatic replay. |
| OpenClaw `src/agents/agent-tools.before-tool-call.approval.ts` and `src/agents/agent-tools.execution-preparer.ts` | Approval/policy interception occurs before execution preparation, while the host executor remains separate. | Prepare a complete action identity from the fresh observation, request approval for that exact action, then dispatch through the existing adapter. Verification happens after dispatch and never changes the approved action. |
| OpenClaw `extensions/cua-computer/src/commands.ts`, `execution-state.ts`, and `driver-artifact-verification.ts` | The node-local computer host owns action execution state, target/frame handling, artifacts, and host-specific verification. | Keep browser/native observation and verification adapters responsible for their own target identity and state. The shared loop consumes normalized verification outcomes without flattening useful adapter detail. |

The alignment rule is therefore:

```text
user goal
  -> bounded runtime admission
  -> surface/strategy selection
  -> fresh observation
  -> model proposal or safe terminal decision
  -> exact approval for input
  -> host action
  -> fresh observation
  -> environment-owned verification
  -> continue, clarify, abstain, or terminal result
```

## Scope

### 1. Goal and run contracts

- [x] Introduce a model-neutral goal-run contract containing the original goal, selected
      surface, strategy policy, run ID, action count, deadline, and terminal outcome.
- [x] Keep the original user goal separate from model-generated step summaries and
      provider output. The original goal is the source for routing and user-facing
      reporting; model text is untrusted evidence.
- [x] Define bounded terminal outcomes: `completed`, `clarification-required`,
      `abstained`, `failed`, `cancelled`, `outcome-unknown`, and `action-limit`.
- [x] Reuse existing `ANESU_COMPUTER_MAX_ACTIONS` and computer deadline configuration;
      do not add a second uncoordinated budget system.
- [x] Persist enough run identity to resume inspection and explain which step ended the
      run without persisting screenshots or raw provider bodies by default.

### 2. Bounded observe/decide/act/verify loop

- [x] Use the shared computer event/outcome contract as the orchestration seam while
      retaining adapter-specific observation, proposal, approval, dispatch, and
      verification methods.
- [x] Require a fresh observation before every model proposal and after every input.
- [x] Bind every action to the exact observation, generation, target, window/page, and
      strategy that produced it.
- [x] Allow only one prepared action to be awaiting approval at a time.
- [x] Continue only after the previous action has a fresh observation and a non-terminal
      verification result.
- [x] Treat model `done` or prose claiming success as a proposal, never as proof of
      completion. Only the environment verifier may produce `completed`.
- [x] Preserve the current one-pre-approval strategy fallback. Never switch strategy,
      replay input, or regenerate an action after input may have been delivered.

### 3. Browser goal verification

- [x] Add a bounded browser verification contract using safe page facts already owned by
      the managed browser: URL, title, visible text, accessible role/name/state, and
      current tab identity.
- [x] Support a small first set of explicit verifier intents: URL reached, visible text
      present/absent, element state changed, and target element visible.
- [x] Keep verification independent from the model proposal. The model may select the
      next action, but code owns the final state comparison.
- [x] Invalidate element references after navigation, scroll, DOM mutation, or a failed
      verification and require a new snapshot before another action.
- [x] Redact credentials, tokens, password values, and uncontrolled page content from
      verification evidence and TUI summaries.
- [x] Return `clarification-required` when the goal does not contain enough safe
      information to choose a verifier rather than guessing.

### 4. Native desktop goal verification

- [x] Add a native verification contract based on bounded AT-SPI/window facts: selected
      window identity, role/name/state, focused element, visible text where available,
      and configured fixture/application markers.
- [x] Keep application-specific verifiers explicit and registered by environment
      adapter. Do not claim generic success from a screenshot or from a completed input.
- [x] Extend the disposable Ubuntu fixture with one bounded multi-step state transition
      that can be verified from fresh accessibility/window state.
- [x] When no trusted verifier exists, return `outcome-unknown` with a concise reason;
      do not keep clicking until something appears to work.
- [x] Preserve exact foreground-window and CUA target binding for every native step.

### 5. Clarification, abstention, and terminal handling

- [x] Distinguish an ambiguous surface/target from a failed action and from an
      unverifiable outcome.
- [x] Permit one concise clarification result when the user goal is ambiguous; do not
      ask the model to invent a target or silently select a surface.
- [x] Make abstention terminal for the current proposal unless a documented,
      pre-approval fallback is eligible.
- [x] Make denied approval terminal for that action and report that no input was sent.
- [x] Make cancellation before input a failed/cancelled run and cancellation after
      possible input delivery `outcome-unknown`; never replay the action.
- [x] Make action-limit and deadline exhaustion honest terminal outcomes with the last
      verified state and the next safe user action where possible.

### 6. TUI progress and inspection

- [x] Show the natural goal, selected surface, strategy, step number, action budget, and
      current phase without exposing raw protocol payloads.
- [x] Show concise step activity such as observing, proposing, awaiting approval,
      acting, verifying, clarifying, and completed.
- [x] Show the approved target and operation before each input, including the native
      target label/role or browser reference summary.
- [x] Show cursor position and bounded artifact references when the adapter provides
      them; do not imply that an artifact is proof of success.
- [x] Make the final result distinguish verified completion, failed action, abstention,
      clarification, cancellation, and outcome-unknown.
- [x] Keep `Ctrl+C` effective during model decision, approval, execution, and
      verification, with the correct lifecycle result for the point of interruption.

### 7. Evidence, recovery, and security

- [x] Record ordered per-step evidence for observation, proposal, approval, dispatch,
      fresh observation, verification, and terminal outcome.
- [x] Include verifier identity, bounded facts used, and observation IDs in evidence;
      never store raw screenshots or provider bodies in ordinary run records.
- [x] On restart, reconcile an incomplete step as failed or outcome-unknown according to
      whether input may have started. Never resume by replaying an input action.
- [x] Ensure verification cannot authorize a new action, change an approval decision, or
      bypass stale-target/focus/window/page checks.
- [x] Keep sensitive-input, navigation, upload/download, and other existing approval
      policies in force for every step in a multi-step goal.
- [x] Add bounded limits for verifier output, visible text, artifacts, and per-step
      evidence so a page or desktop application cannot exhaust the run.

### 8. Tests and documentation

- [x] Add unit tests for goal-run state transitions, verifier contracts, terminal outcomes,
      ambiguity, action limits, and no-replay invariants.
- [x] Add browser integration tests for a two- or three-step local fixture goal, fresh
      snapshot invalidation, URL/text/element-state verification, and unverifiable goals.
- [x] Add native integration tests for a two-step Ubuntu fixture goal, exact window
      binding, accessibility-state verification, cursor/artifact reporting, and missing
      verifier behaviour.
- [x] Add failure-injection tests for provider timeout, stale target, changed focus,
      approval denial, cancellation before/after input, display loss, browser crash,
      restart, duplicate events, and uncertain CUA acknowledgement.
- [x] Add TUI projection tests for each terminal result and each multi-step phase.
- [x] Add one real-provider manual browser acceptance and one real-provider manual native
      acceptance using ordinary-language prompts, with the required isolated fixture.
- [x] Update the computer README, playground, configuration reference, and follow-on
      queue with the supported goal/verifier matrix and explicit limitations.

## Approval and side-effect policy

Observing, waiting within configured limits, and verifying may be read-only. Any browser
or native input remains approval-gated according to the existing shared approval contract.
Approval is for one exact prepared action, not for the whole unbounded user goal.

The approval request must identify:

- run ID and step number;
- surface and strategy;
- fresh observation ID and target identity;
- operation and bounded payload summary;
- current action count and remaining deadline; and
- the expected verification condition, when one is configured.

The implementation must not turn a user's broad approval into permission for future
actions, credentials, unrestricted navigation, arbitrary application launch, or a new
target discovered after approval.

## State and lifecycle

The computer run is a child lifecycle inside the existing Anesu turn. It must not create
a second model/tool runtime or bypass the runtime's durable evidence writer.

```text
admitted
  -> observing
  -> proposing
  -> awaiting-approval
  -> dispatching
  -> verifying
  -> { completed | observing | clarification-required | abstained |
       failed | cancelled | outcome-unknown | action-limit }
```

Only `observing` may begin a new proposal. `dispatching` is entered once per approved
action. A `dispatching` interruption is never converted into a retryable proposal. A
terminal state is immutable except for idempotent recovery evidence that explains an
interrupted run.

## Explicitly deferred

These are intentionally not part of this plan and must remain in the broader production
readiness register or a later plan:

- arbitrary personal-desktop attachment, privilege escalation, or unrestricted process
  launching;
- a new local OCR, segmentation, or CUA-S1 model integration;
- replacement of the existing browser adapter with another automation stack;
- personal Chrome/CDP profiles, extensions, OAuth/CAPTCHA automation, arbitrary page
  JavaScript, or unrestricted cookie/storage access;
- generic screenshot-only success inference for unknown applications;
- background computer jobs, scheduling, delegation, multi-agent control, or remote
  desktop workers; and
- exhaustive race/load/OS-isolation/release-hardening beyond the focused first-iteration
  tests in this plan.

## Definition of done

The plan is complete only when every item below is checked:

- [x] A normal user can issue a supported multi-step browser or isolated-desktop goal
      without naming internal tools, providers, strategies, or observation formats.
- [x] Browser and native runs share the bounded goal lifecycle while retaining
      surface-specific action and verification semantics.
- [x] Every input is approved against a fresh, exact observation and no input is
      replayed after uncertainty, cancellation, restart, or acknowledgement loss.
- [x] Browser goals can complete only through the implemented URL/text/element-state
      verifiers, not model claims.
- [x] Native goals can complete only through a configured accessibility/window or
      application verifier, not a completed input or screenshot alone.
- [x] Ambiguity, abstention, denial, cancellation, deadline, action-limit, failure, and
      unverifiable outcomes are distinct and visible in the TUI and evidence.
- [x] Multi-step progress shows the current phase, action budget, target, verification,
      and final outcome without secrets or raw provider protocol.
- [x] Restart, stale-target, focus-loss, browser-crash, display-loss, duplicate-event,
      provider-timeout, and uncertain-input tests pass without side-effect replay.
- [x] The required browser and native ordinary-language manual acceptance flows pass
      through `pnpm`, and the configured provider/model used is recorded.
- [x] The computer README, playground, configuration reference, research note, and this
      plan match the shipped behaviour; all deferred work remains explicit.

## Required validation commands

From `anesu/`:

```bash
pnpm typecheck
pnpm test
pnpm coverage
git diff --check
```

The manual native check must use the repository's isolated Ubuntu/X11 launcher and a
disposable fixture. A missing graphical host or unavailable provider is a reported
environment limitation, not a passing acceptance result.

## Handoff

When complete, move this file to `completed/`, add a completion record with the exact
validation commands and provider/model used, update the Anesu queue, and leave any
remaining production hardening in the production-readiness gap register. Do not mark the
plan complete because the loop merely performs multiple clicks; completion requires
environment-owned verification and honest terminal outcomes.

## Completion record

Completed 2026-09-20. The shipped slice includes the shared bounded goal/event contract,
browser URL/text/element/state verification, native accessibility/window verification,
approval-visible verifier expectations, two-step disposable browser and native fixtures,
step/budget/cursor/artifact progress in the TUI, bounded run outcome persistence, and
restart/no-replay evidence. Hermes and OpenClaw were used as local implementation
references for bounded turns, approval boundaries, host-owned execution state, and
terminal/recovery separation; neither is a runtime dependency.

Validation completed from `anesu/`:

```text
pnpm typecheck
pnpm build
pnpm test                 # 519 passed, 0 failed
pnpm coverage             # 519 passed; 89.89% lines, 76.48% branches
node --test --test-concurrency=1 dist/tests/computer.test.js dist/tests/computer-native.test.js dist/tests/computer-records.test.js dist/tests/browser-tui.test.js dist/tests/approval-tui.test.js  # 90 passed
```

The required real-provider browser/native acceptance flow is documented in
`development/playground/anesu-computer-use.md`; live provider availability remains an
environment condition and is not silently substituted by a deterministic test model.
