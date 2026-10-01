# Lina model-directed desktop use

**Created:** 2026-09-24
**Status:** Active, queued after sessions and browser use
**Owner:** Lina standalone product

## Goal

From `pnpm run chat`, a user can ask Lina in ordinary language to use an installed
desktop application. The conversation model observes current Cua state, chooses a
supported action, receives its result, and decides what to do next. The model must not
be trapped behind a second, hidden task planner inside the `computer` tool.

This is generic desktop use through the pinned Cua runtime, not a set of per-app
scripts. If the installed Cua contract or host cannot perform or verify an operation,
Lina reports the limitation instead of inventing a shortcut or claiming success.

The screenshots reviewed on 2026-09-23 show Hermes using desktop `computer_use`
actions on a visible Firefox window. They are evidence for its observe, act,
re-observe, and recovery flow. They do not show how its browser-specific tools work.
Browser actions remain in the [browser-use plan](lina-browser-use.md). Conversation
ownership, browser persistence, and shared approval scopes remain in the
[sessions-and-approvals plan](lina-sessions-and-approvals.md). This plan connects to
those plans without duplicating their work.

## Scope and design rules

- Use Cua for desktop observation and input. Do not reintroduce Playwright,
  app-specific shell or D-Bus workarounds, or another desktop automation backend.
- The model chooses task intent, target, action, and continuation from current tool
  results. Lina owns schemas, permission checks, current session/window identity,
  cancellation, resource limits, and truthful outcomes.
- Expose the smallest useful set of actual pinned Cua operations. Do not expose
  arbitrary driver calls, compile prompt phrases into action sequences, or add one
  bespoke path per application.
- Re-observe after an action before taking a dependent action. Reject stale targets
  and do not replay an action whose effect is uncertain.
- Reuse the shared approval and session implementation. Routine actions already
  covered by the current task grant must not trigger a prompt for every click.
- Cursor display is separate from input success and stays disabled by default. A Cua
  overlay warning alone is not proof that input failed.
- Do not send screenshots to a model unless the configured provider and SDK have a
  verified image-input contract. Screen content is untrusted and cannot widen the
  user's goal or permissions.

## Out of scope

- Browser search, cross-origin transitions, page controls, and file transfers. The
  browser-use plan owns those.
- Session commands and the shared approval UI/store. The sessions-and-approvals plan
  owns those.
- Universal support for every Linux application, toolkit, or display server.
- Per-app scripts, unrestricted desktop input, new vision backends, or exhaustive
  compatibility and failure testing.

## Definition of done

- [ ] In a real TUI run, the conversation model chooses native Cua operations from
      current observations, receives results, and controls whether to continue,
      clarify, or answer. No prompt regex or hidden native planner forces a sequence.
- [ ] A user can launch or focus an available app, observe it, and use supported
      Cua actions through ordinary prompts. At least two installed apps use the same
      generic path without app-specific implementation branches.
- [ ] The intended app remains available for the next prompt in the same conversation.
      Cua resources and window references do not leak between conversations.
- [ ] Actions use current Cua identities and evidence. Denial, cancellation, stale
      state, and uncertain dispatch fail safely without replay.
- [ ] Approval is scoped through the shared approval system. The TUI shows the app,
      operation, useful target description, and observed result or typed refusal.
      Cursor presentation, when enabled for a visible run, is verified separately.
- [ ] The standalone guide and implementation queue describe only the host,
      operations, and app capability cells proven in a real disposable desktop run.

## Baseline

- `COMPUTER_TOOL_DEFINITION` in `lina/src/computer/runner.ts` exposes one natural-
  language goal and describes it as a terminal workflow. The main model is told not
  to call computer or browser tools again after it returns.
- `NativeComputerRunner` in `lina/src/computer/native-runner.ts` currently observes,
  constructs candidate actions, and asks Jev or the traditional strategy to select
  inside its own loop. The normal conversation model does not choose each native
  operation from a Cua tool/result round trip.
- `CuaDriver` contains native operations and target-freshness checks. Their behavior
  must be probed against the pinned runtime and target Linux session before exposing
  them; declared tool support is not live evidence.
- Browser operations already use the normal model/tool loop. Browser persistence is
  assigned to the sessions-and-approvals plan; origin/search and other browser gaps
  are listed in the browser-use plan.
- Baseline branch/commit: `main`, `ae1ad06`. The worktree contains extensive
  in-progress changes. Preserve unrelated work and inspect exact diffs before edits.
- Focused checks: `pnpm --dir lina test`, `pnpm --dir lina run typecheck`,
  `pnpm --dir lina run build`, and a short live TUI task in the configured
  disposable Cua desktop.

## Milestones

### 1. Confirm the real Cua and model boundary

- [ ] Record the pinned Cua inventory and probe the needed native observe, app
      launch/focus, and input operations in the target Linux session.
- [ ] Trace what the configured conversation model receives, including whether
      provider and SDK support image input. Treat unsupported capability as
      unavailable; do not simulate it.
- [ ] Identify which current `NativeComputerRunner` checks protect safety and which
      only serve its internal candidate-selection loop.

Validation: retain concise command/probe evidence. A mocked driver does not prove a
host capability.

### 2. Put native Cua choices in the normal agent loop

- [ ] Add the smallest typed model-facing interface that maps to real pinned Cua
      operations. The model receives current bounded state and chooses what to do.
- [ ] Return each result or typed refusal to the same model so it can observe again,
      continue, clarify, or answer. Do not synthesize tool calls from prompt patterns.
- [ ] Route the interaction through the existing tool registry and `runTurn`. Remove
      the internal Jev/traditional selection loop from the default path only after
      end-to-end acceptance passes. Keep Jev only if it has a distinct, verified role
      that complements rather than replaces the conversation model.
- [ ] Preserve current identity, permission, cancellation, bounds, and no-replay
      checks. Remove only obsolete code after checking its callers.

Validation:

- [ ] A focused `runTurn`/registry test proves model-selected action, result
      round-trip, model-controlled continuation, and no synthetic action when the
      model chooses not to act.
- [ ] Focused driver tests prove stale targets, denial/cancellation, and uncertain
      dispatch cannot produce an unauthorized or duplicate input.

### 3. Reuse session, approval, and TUI behavior

- [ ] Use the shared session-owned Cua lifecycle and approval scopes from
      `lina-sessions-and-approvals.md`. If native ownership is missing there, add
      only the required lifecycle item to that plan instead of creating a second
      session manager.
- [ ] Show concise activity for app/window, Cua operation, target, and observed
      outcome. Keep internal identifiers and technical diagnostics out of the main
      line unless the user opens details.
- [ ] Test a follow-up prompt in the same conversation and verify another
      conversation cannot reuse its live Cua session or stale references.
- [ ] In a visible disposable X11 run, verify cursor movement separately from action
      delivery if cursor display is enabled. Keep the default disabled.

### 4. Prove ordinary desktop use and hand off

- [ ] Run `pnpm run chat` with the real configured provider in the disposable Cua
      desktop. Demonstrate one observation/read task and one user-approved change,
      using at least two installed applications through the same generic path.
- [ ] Record the model, Cua version, display/session, app, operations, and observed
      result. Report unsupported or uncertain cells plainly; do not infer universal
      Ubuntu support from a small sample.
- [ ] Run focused tests, typecheck, build, and the Lina regression suite. Update the
      computer-use guide and implementation index to match the evidence.

Keep test scope proportional. The purpose is to prove the real model/Cua round trip,
the safety boundaries, and a usable TUI path, not to enumerate every app and failure
combination before there is a product need.

## Decisions and evidence

- The 2026-09-23 Hermes screenshots show visible-browser interaction through desktop
  CUA. They do not establish browser DOM tooling or prove that every action worked.
- The source-level review found that Hermes exposes a general computer-use tool and
  re-observes UI state, while OpenClaw keeps action identity and driver evidence in
  the computer host. Lina should adopt those responsibility boundaries, not copy
  broad or ambiguous approval labels.
- The browser plan already provides Lina's model-directed tool/result pattern. The
  implementation target here is to make the native Cua path follow that pattern.
- Existing Jev and traditional paths are user work. Trace them and their callers;
  do not remove either merely to simplify the new default route.

## Current position

- Milestone: 1, confirm the real Cua and model boundary.
- Current item: probe the pinned native Cua tool inventory and check session
  ownership against the active sessions-and-approvals plan before changing the executor.
- Status: queued after sessions and approvals, then browser use.
- Last verified checkpoint: code and plan structure inspected at `ae1ad06`; no
  implementation changes made for this plan.

## Blockers

None known. Reconfirm the two plan dependencies when implementation starts.

## Completion audit

- [ ] Confirm the normal model controlled native task decisions.
- [ ] Confirm live operations against the pinned Cua runtime and disposable host.
- [ ] Run focused tests, typecheck, build, regression suite, and live TUI acceptance.
- [ ] Reconcile docs and remaining production-readiness gaps with proven behavior.
