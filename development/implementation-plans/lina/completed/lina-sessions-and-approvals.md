# Lina sessions and approvals

**Created:** 2026-09-23
**Last updated:** 2026-09-24
**Status:** Complete

## Goal

Make Lina's durable conversations and approval choices usable across the standalone
harness. From `pnpm run chat`, a user can create a conversation, resume another one,
and understand exactly what an approval permits. A decision can be limited to one
prepared action, the current task, the current conversation, or a narrowly matched local
permission when that tool can define a safe stable match. The user can inspect and revoke
saved permissions.

The running conversation owns its live resources. In particular, opening a browser must
leave it available for the next prompt in that conversation; ending a model turn must not
silently close it. Switching conversations must not reuse another conversation's browser.

This plan covers Lina as a standalone agent. It does not integrate Lina into the Lab UI
or implement general browser-use capabilities; those remain in the separate browser-use
plan.

## Outcome and scope

When this slice is complete, a user can:

1. Start Lina normally and use `/new` to create a separate durable conversation.
2. Use `/resume` to see recent conversations and choose one, or `/resume <session-id>`
   to open an exact conversation. No fuzzy match silently selects among ambiguous
   sessions.
3. Continue a resumed conversation with its own transcript and context. In one running
   TUI process, only one conversation is in the foreground at a time; an active turn
   cannot be abandoned by switching sessions.
4. Review an approval panel that names the operation, target, effect, important limits,
   and grant duration. The least expansive affirmative option is visibly selected by
   default; Up/Down changes selection, Enter confirms, and Esc/Ctrl+C cancels.
5. Choose only the scopes genuinely supported by the requesting tool: once, this task,
   this conversation, or a saved local permission for a
   stable matching action. Deny remains available. An unavailable scope is not shown.
6. Use `/permissions` to inspect saved process permissions for this conversation or the
   local profile and revoke them. A revoked permission cannot authorize a later process.
7. Open a browser, receive the turn result, and continue using that same conversation's
   live browser in a later prompt. Explicit close, conversation switching under the
   chosen lifecycle rule, the configured browser-session lifetime, and application exit
   clean it up. Resuming the transcript after a process restart does not claim to restore
   a live browser unless Cua explicitly supports and verifies reattachment.

The durable conversation is the unit of history and conversation-scoped approval. A TUI
process is the unit of foreground runtime and live browser ownership. These are related
but not interchangeable lifetimes.

## Boundaries and non-goals

- One foreground agent loop per TUI process. No concurrent live sessions, background
  agents, session forking/merging, remote session service, cloud sync, or Lab UI wiring.
- No new database or session index unless a measured need is found. Start from the
  existing per-session storage and list real sessions from that data.
- No global “approve everything” switch, no policy bypass, and no scope that overrides a
  tool's hard-deny or risk policy.
- No permanent permission for arbitrary arguments, page content, computer coordinates,
  file payloads, or other unstable targets. Long-lived permission is offered only when a
  domain can describe and revalidate a narrow, understandable matcher.
- No silent restoration of pending approvals or in-flight side effects after a crash.
- No promise that an interactive browser or desktop resource survives application exit.
- Do not redo the approval arrow-key selection widget if the current structured prompt
  already provides it. The work is correct choice semantics, accurate scope labels,
  storage, routing, and end-to-end integration.

## Baseline observed in Lina

The existing persistence foundation is useful and should be extended rather than
replaced:

- `SessionStore.open(stateDir, sessionId?)` creates a new durable session when no ID is
  supplied and opens an exact existing ID when given one. Per-session metadata,
  transcript,
  turns, locks, and recovery records already exist in `lina/src/persistence/session-store.ts`.
- The CLI accepts an explicit session ID, opens one `ChatApplication`, and starts one
  `TerminalUi`. The TUI has no `/new`, `/resume`, session picker, or session list yet.
- The approval prompt already has a structured panel and raw-terminal navigation. The
  current worktree's tests exercise keyboard selection and default highlighting. Preserve
  that interaction rather than replacing it.
- Approval requests are owned by several real domains (workspace, process, memory,
  browser, and computer use). Those domains should retain their own eligibility, risk,
  action identity, and execution-time checks.
- The current computer task panel describes a bounded-task approval but disables its task
  choice. This makes the visible prompt inconsistent with the decision it later maps to.
- The runtime closes browser-turn resources from `lina/src/runtime/turn.ts`; browser
  tool instances also expose `closeTurn()` through `lina/src/tools/registry.ts`. This
  cleanup is currently tied to a model/tool turn, not the durable conversation, which
  explains why a successfully opened browser can disappear before the next prompt.
- The inspected `BrowserComputerRunner` also closes a browser it started in its `finally`
  path (`lina/src/computer/runner.ts`). Preserve the reported evidence and trace both
  paths against the actual browser route before editing; the fix must remove per-turn
  teardown only where it is wrong while retaining explicit and process-exit cleanup.
- User-reported browser-close evidence is in:
  `/home/enoch/Pictures/Screenshots/Screenshot from 2026-09-23 20-39-47.png`,
  `/home/enoch/Pictures/Screenshots/Screenshot from 2026-09-23 20-39-35.png`, and
  `/home/enoch/Pictures/Screenshots/Screenshot from 2026-09-23 20-38-18.png`.
- Do not change cleanup for process/native actions as a side effect of browser ownership:
  their operation-scoped resources should continue to be closed according to their own
  contracts.

The Lina worktree already contains unrelated and in-progress changes. Preserve them.
Before implementation, re-read the current files and tests; the baseline above is an
orientation, not permission to overwrite later changes or assume every current line still
matches.

## Evidence-based design comparison

The comparison is deliberately about concrete source behaviour, not copying a branded
interface wholesale.

| Harness | Observed implementation | What Lina should take from it | What not to infer |
| --- | --- | --- | --- |
| Hermes | TUI session commands create/switch/resume sessions and refuse session switching while busy. Its picker distinguishes live sessions from resumable history. Command approval can offer once/session/always/deny, but stored rules are tied to command patterns and session identity; some risk findings narrow the available choices. | A direct session picker, explicit conversation scope, busy-state protection, and scope choices hidden when the action cannot support them. | Hermes' approval code is focused on command execution; it is not a universal permission policy for every agent tool. |
| OpenClaw | `resume` opens a session picker or resolves a supplied query, reporting ambiguous/no-match cases. Exec approval combines tool policy with host approval and exact command/cwd-bound allow-list rules; saved rules are inspectable and revocable. | Session selection must not guess. Persistent permission should be narrow, bound to concrete identity, and manageable. Keep baseline policy separate from a user's per-operation approval. | OpenClaw does not prescribe one global once/session/always prompt for all tools; approval behaviour is domain-specific. |
| OpenCode | Permission decisions distinguish once, always, and reject. Its current permission service keeps accepted “always” patterns in process/session memory; the label does not mean a durable profile-wide permission. | Name duration precisely. Do not call a temporary session rule “permanent”; distinguish in-memory/conversation grants from saved local rules. | “Always” is not evidence that a choice should persist across process restarts. |
| Codex | The user's provided prompt shows the exact command, environment, reason, and three explicit choices: proceed once, allow a matching command prefix again, or reject and tell Codex what to do differently. Official Codex guidance separates sandbox capability from approval timing and recommends the narrowest permission that serves the task. | Show the exact operation and why it needs approval; make “remember this” describe its matcher; keep the capability boundary distinct from consent. | Codex permission profiles and sandbox modes should not be conflated with Lina's per-tool grants or copied as an entire policy system. |

Primary source links and review notes:

- [Hermes session commands](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6/ui-tui/src/app/slash/commands/session.ts), [session picker](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6/ui-tui/src/components/activeSessionSwitcher.tsx), and [command approval implementation](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6/tools/approval.py), reviewed at commit `b6b53c69a6`.
- [OpenClaw resume flow](https://github.com/openclaw/openclaw/blob/912685f4422/src/cli/resume-cli.runtime.ts), [session picker](https://github.com/openclaw/openclaw/blob/912685f4422/src/tui/tui-session-picker.ts), and [exec approvals](https://github.com/openclaw/openclaw/blob/912685f4422/docs/tools/exec-approvals.md), reviewed at commit `912685f4422`.
- [OpenCode permission documentation](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/permissions.mdx) and [permission service](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/permission/index.ts), reviewed on the upstream `dev` branch on 2026-09-23. No local OpenCode source checkout was available; the upstream branch is not commit-pinned, so recheck before relying on line-level details during implementation.
- [Codex sandbox and approval guidance](https://learn.chatgpt.com/docs/sandboxing) and [OpenAI human-review guidance](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals), official OpenAI documentation. The visible Codex prompt example above is from the user's screenshot.

The resulting Lina design is a shared decision experience and grant lifecycle, not a
central policy engine: each tool domain says which scopes it can safely offer and how it
matches/revalidates an approved action. Shared code stores and presents that decision;
domain code still enforces its risk policy immediately before the side effect.

## Implementation decisions

### Session behaviour

- Keep the current storage model and exact `--session`/`--session-id` startup behaviour.
- Add a bounded session-listing/read API that reads actual valid session metadata and
  transcript summaries. Show a stable ID, last activity, and a redacted/length-limited
  last-message preview when available. Do not fabricate sessions from incomplete records.
- `/resume` with no argument opens a recent-session picker; `/resume <id>` opens that exact
  session ID. Prefix matching is deliberately unsupported: a prefix miss explains that the
  ID must be exact and points the user to `/resume`; no fuzzy selection is attempted.
- `/new` opens a new session without deleting or mutating the old transcript. The TUI
  routes subsequent turns, context, tools, and evidence to the selected session.
- Do not switch while a model turn, tool call, pending approval, or side effect is active.
  Explain that the user should wait or cancel the active operation first. Do not detach a
  running operation and silently attach the UI to another store.
- One process may hold a session lock. If another process owns the selected session,
  report the existing lock/recovery state and leave its records untouched.
- Resumption restores conversation data using existing recovery rules. It must not revive
  a pending approval, mark an uncertain external effect as successful, or reuse a live
  browser handle from another session.

### Approval scopes and permission records

Use a shared vocabulary, but have each existing approval-producing domain declare which
choices are valid for its request:

1. **Approve once** — approve the exact action currently shown. This is the default
   affirmative choice.
2. **Approve this task** — approve only the request currently being carried out, which
   may involve several steps. It ends when that task finishes; it does not approve later
   prompts. Show this choice only when the tool can keep the task's actions within its
   approval.
3. **Approve for this conversation** — save a grant keyed to the durable session ID and a
   domain-owned matcher. It remains scoped to that conversation when resumed and cannot
   authorize another session.
4. **Always allow [specific rule]** — save a local profile rule under the Lina state
   directory only when the domain supplies a stable, reviewable matcher. The UI replaces
   `[specific rule]` with what it covers, such as a command and its working directory.
   The rule is inspectable and revocable. It does not mean “allow all tools” or “allow all
   future actions.”
5. **Deny** — reject this proposed operation; allow the model/user-facing flow to explain
   or choose another route where appropriate.

Domains may omit task, conversation, or saved-rule choices when they cannot implement
and enforce them safely. Do not offer long-lived rules for unstable browser content,
arbitrary computer targets, arbitrary file payloads, or other broad identities. In
particular, permission must bind the concrete operation/target constraints, not a natural
language description that can drift.

Current eligibility is deliberately domain-owned:

| Approval owner | One action | Current task | Conversation | Local saved rule | Matching evidence |
| --- | --- | --- | --- | --- | --- |
| Workspace mutation | Yes | No | No | No | One prepared mutation and its before/after state. |
| Local process | Yes | No | Yes | Yes | Fresh prepared executable identity, exact argv digest, cwd identity, sanitized environment, and limits. |
| Browser interaction | Yes | Yes, when the active task grant binds the action | No | No | Exact browser session/tab/document/action hash; task actions must also match the current task grant. |
| Native computer action/task | Yes | Yes, for the compiled task | No | No | Current Cua session/window/observation and candidate identity, plus the task grant where used. |
| Memory mutation | Yes | No | No | No | One prepared memory operation; no stable cross-request matcher is currently exposed. |
| Existing browser-profile attachment | Yes | No | No | No | One explicit Cua authorization request; profile access is not inherited from an action/task grant. |

The process local rule is the only current profile-wide saved matcher. It stores an opaque
digest and a bounded description, not raw arguments. A saved decision cannot skip process
preparation or the runner's final executable and working-directory identity check. Existing
process policy restrictions and resource limits still apply before and after matching.
Revocation is prospective: it prevents a later authorization but cannot undo a process
already dispatched.

The shared approval contract should stay small: a request presents its exact prepared
identity, effect, risk/constraints, and eligible scopes; a response returns one selected
scope or deny/cancel. The domain's existing checker revalidates the exact identity and
grant immediately before execution. Do not introduce a universal policy language or
rewrite every tool behind a generic executor.

Store conversation grants with/under the owning session and profile grants in a separate
versioned local permission store under the state directory, using existing atomic-write
and permission practices where applicable. On corrupt/unreadable permission state, fail
closed for that grant and explain how to inspect/revoke or repair it. Never persist
secrets as grant keys; use bounded identifiers or digests with a safe display description.
Revocation prevents future authorization but cannot undo an already dispatched effect.

The approval panel must show what the choice covers before confirmation. Use concise
labels: “Approve once,” “Approve this task,” “Approve for this conversation,” and a
specific “Always allow …” label when a saved rule is available. Show only choices the
requesting tool can enforce. Keep the current visible arrow-key selection and Enter/Esc
interaction. Fix the computer task panel so it offers “Approve this task” when supported,
instead of describing task approval while hiding the choice. Cancellation, denial, and a
lost TTY are not approval and must dispatch no side effect.

### Browser ownership and cleanup

- Move browser lifetime ownership from the individual model/tool turn to the selected
  conversation runtime (or the smallest existing application-level owner that can key it
  by session ID). Inspect current registry construction and Cua lifecycle before choosing
  the exact seam.
- A browser opened in one turn remains available to later turns in the same live
  conversation. Later prompts use the existing Cua browser route; they do not start a
  duplicate browser merely because a new model turn began.
- Explicit browser close and application shutdown close the correct session. Ctrl+C during
  an active turn cancels according to current lifecycle rules; normal idle Ctrl+C exits and
  cleans up. No browser resource may be borrowed across conversation IDs.
- For `/new` or `/resume`, close the outgoing conversation's app-owned browser resources.
  Do not park or reactivate browser handles between conversations. Tell the user that any
  live browser from the previous conversation was closed; never silently attach the wrong
  tab.
- Use the existing configured maximum browser-session lifetime for bounded cleanup. The
  timeout is measured from session start (not reset on activity) and must not close the
  browser at the end of every turn.
- After process restart, resume history but report that live browser state is not
  restored unless the pinned Cua contract and acceptance test prove exact safe
  reattachment.

## Work plan

### 1. Map existing session and approval owners

- [x] Re-read current session, CLI/TUI, approval prompt, tool registry, runtime, and
  browser lifecycle code at implementation time; record which domain owns request
  eligibility, grant matching, persistence, and final side-effect check.
- [x] Inventory every approval-producing path in the current Lina build (workspace
  mutation, process execution, memory mutation, browser operations, native/computer
  actions and tasks, and any Cua profile authorization). Do not assume all accept the
  same scope.
- [x] For each path, record the exact action identity and whether one-time, bounded-task,
  conversation, and local saved permission can be safely offered. Mark unsupported scopes
  instead of manufacturing a broad matcher.
- [x] Trace browser objects from `runTurn` through `ToolRegistry` and Cua manager to
  determine the smallest owner that can persist them across turns and close them on exit.

Gate: the implementation boundaries and affected call sites are known before changing
the shared approval contract. Existing unrelated dirty work is preserved.

### 2. Add multiple durable conversations to the TUI

- [x] Add bounded listing and summary retrieval over actual `SessionStore` records without
  weakening validation, path checks, locks, or recovery semantics.
- [x] Add `/new`, `/resume`, exact-ID resolution, and a recent-session picker to the
  standalone TUI. Keep explicit startup session flags backward-compatible.
- [x] Rebind the foreground application/runtime to the selected session without leaking
  transcript, context, tool evidence, approval grants, or browser identity between IDs.
- [x] Prevent switching during active generation, tool execution, or approval. Use the
  existing cancellation/recovery path; never abandon an in-flight side effect.
- [x] Make exact-ID misses, corrupt-session, and lock-held outcomes readable and
  non-destructive. Prefix matching is unsupported and must never select a session; an
  exact-ID miss points users to the picker.
- [x] Verify that a recovery-required error while opening a destination is readable and
  leaves the current conversation active.

Gate: a real TUI run can create two conversations, resume either, continue its own
transcript/context, and cannot access the other one's session-scoped permission or live
resources.

### 3. Implement shared approval choices and manageable grants

- [x] Introduce only the minimal shared scope/decision shape needed by the inventoried
  approval paths. Keep policy/matcher logic in each domain.
- [x] Wire the panel's eligible choices to each approval request and correct the computer
  task label/option mismatch. Preserve the visible default highlight and arrow navigation.
- [x] Implement one-action and current-task scopes with exact identity checks; task approval
  covers only the current request and ends when it finishes.
- [x] Add durable conversation-scoped grants keyed by session ID for paths with stable
  matchers. Verify they survive resume but never authorize another conversation.
- [x] Add the separate local profile permission store only for explicitly eligible,
  stable matchers. Revalidate on use; deny if the operation no longer matches exactly.
- [x] Add `/permissions` list/revoke commands for saved grants, with safe descriptions,
  scope, matcher, creation/last-use information where already available, and clear
  confirmation before revocation if needed. Do not expose grant secrets or raw tokens.
- [x] Ensure higher-priority hard-deny/risk rules override saved grants. Ensure changed
  arguments, targets, constraints, tool identity, or expired task grant cause a fresh
  prompt or refusal rather than inherited permission.
- [x] Keep denial, cancellation, TTY loss, storage failure, and process restart fail-closed.
  Never replay an uncertain state-changing action because a grant was saved.

Gate: each offered duration means exactly what the UI says, and a saved grant authorizes
only the domain's explicitly defined matching operations.

### 4. Keep the browser alive for the conversation, not the turn

- [x] Remove unconditional end-of-turn closure for a successfully active browser and give
  the live Cua browser a conversation-scoped owner.
- [x] Keep browser session/tab identity in the per-conversation `ToolRegistry`; clear
  turn-local references and task grants after each turn without closing the browser.
- [x] Let a follow-up task with no URL bind to the fresh current tab origin. Its new task
  grant is exact-origin scoped and does not inherit a wider origin grant.
- [x] Preserve explicit `browser_close`, configured maximum-lifetime cleanup, and
  application-exit cleanup. Close failures remain distinct from successful cleanup.
- [x] Enforce browser session identity at the manager boundary. Reject cross-session tabs;
  switching closes the outgoing application and its owned browser rather than carrying it
  into the destination conversation.
- [x] Verify active-turn cancellation clears turn-local browser task state without
  accidentally closing a conversation browser the user may continue using.
- [x] On process restart, restore transcript only; do not imply browser reattachment unless
  the exact Cua runtime supports it and the implementation verifies it.

Gate: after “open this site” completes, the browser is still open for another user prompt
in the same conversation; it remains usable after an in-flight read-only wait is cancelled;
explicit close, configured maximum lifetime, and application exit clean it up; another
conversation cannot control it. The configured lifetime is measured from browser-session
start, not reset as a sliding idle timeout.

### 5. Documentation and handoff

- [x] Update the standalone Lina README/help with `/new`, `/resume`, `/permissions`,
  approval scopes, the local permission store, and browser lifetime/restart behaviour.
- [x] Document scope eligibility and the action-domain ownership table so future tools do
  not accidentally inherit unrelated permissions.
- [x] Update the follow-on queue and this plan with implemented work, commands run,
  unsupported scopes, and remaining production hardening. Do not mark unrelated
  browser-use work complete.
- [x] Run and record a manual TUI acceptance using a build of the current chat CLI, a real
  free model, and ordinary prompts. Keep the manual check isolated from user state.

Gate: a contributor can run the TUI, resume the right conversation, understand and revoke
permissions, and predict browser cleanup without reading implementation internals.

## Focused verification plan

Keep the tests tied to the actual lifecycle and trust boundaries; do not grow this into an
exhaustive test matrix before the end-to-end path exists.

- Session-store tests: listing valid sessions, malformed/incomplete session handling,
  bounded summaries, exact/ambiguous/not-found selection, lock conflicts, and no mutation
  of unrelated session records.
- Full-TUI integration with a real `SessionStore` and recording provider: create two
  conversations, write different turns, resume each through picker and exact ID, and
  verify transcript and context remain separate. Exercise busy-turn switching and a held
  session lock.
- Approval-prompt tests: visible default selection, Up/Down and Enter, Esc/Ctrl+C,
  eligible-choice filtering, truthful task label, and readable target/scope details.
- Approval integration tests: one-time and current-task grants; conversation grant
  survives resume but not a different session; one eligible local matcher survives app
  restart; unrelated/modified target is rejected; revocation blocks the next attempt;
  hard-deny still wins; deny/cancel/storage failure cause no dispatch.
- Exercise at least one real path from each approval owner identified in milestone 1.
  Use fakes at the external driver boundary, but run routing through public registration
  and TUI/runtime interfaces so tests prove the decision reaches (or does not reach) the
  side effect.
- [x] Browser lifecycle integration: open through the normal TUI/tool route, finish the
  turn, issue a second browser instruction, cancel an in-flight browser wait with Ctrl+C,
  and verify a later prompt still reads the same owned tab; application exit closes it.
- [x] Restart case: restore conversation history but do not claim a live browser was restored.
- Run focused tests first, then Lina typecheck/build/full suite. Do one manual check using
  only `pnpm run chat` and ordinary prompts; record Cua/desktop prerequisites and the
  observed result.

## Completion criteria

- [x] The standalone TUI can create, list, select, and resume multiple durable sessions
  without cross-session transcript/context/grant leakage.
- [x] Session switching is blocked or safely cancelled while an operation is active;
  existing session lock conflicts leave the current conversation intact.
- [x] A recovery-required destination remains readable and cannot displace the current
  conversation.
- [x] Approval screens show the exact action and true grant lifetime, visibly select the
  narrow default, and offer only scopes the owning domain can enforce.
- [x] Conversation and saved local process grants have exact matching, safe persistence, list and
  revoke behaviour. No global allow-all exists.
- [x] All current approval-producing domains have been inventoried and tested through at
  least one real routed path, including deny/cancel and mismatch behaviour.
- [x] Browser remains open between turns and after a cancelled read-only wait in one live
  conversation, is never reused across another conversation, and is closed on application
  exit.
- [x] Focused integration tests, typecheck, isolated build, and full Lina suite pass.
- [x] Manual TUI acceptance and known limitations are recorded.
- [x] User and contributor documentation reflects observed behaviour; no claim is made
  that live browser state resumes after a process restart without verified Cua support.

## Current position

Milestone: 5, validation and handoff.
Plan status: complete.
Implementation status: `/new`, `/resume`, recent-session selection, the scoped approval
panel, exact process conversation/local grants, and `/permissions` list/revoke are
implemented. Session transcripts and model context remain separate. The TUI reports
exact-ID misses, corrupt session metadata, and lock-held resumes without replacing the
active conversation. A real TUI/runtime browser test proves one Cua browser is reused by a
follow-up turn, remains usable after cancelling an in-flight read-only wait, closes on
application exit, and is not reattached after restart even though the transcript resumes.
The browser manager expires sessions at the configured maximum lifetime, not on a sliding
inactivity timer.
Research: Hermes, OpenClaw, OpenCode upstream, and official Codex/OpenAI sources reviewed
as listed above.
No work remains in this slice. Browser-use features beyond conversation-owned session
lifecycle stay in the separate browser-use plan.

## Progress evidence

- `SessionStore.listRecentSessions()` validates metadata through a no-follow regular-file
  read, lists only real session directories, bounds the result count, and returns a
  truncated preview from the last transcript record when available.
- TUI tests cover `/new`, picker selection, routing a later prompt to the selected app,
  failed target opening without losing the current app, cleanup of switched apps, and
  exact-ID/corrupt/locked/recovery-required resume failures while preserving the active
  real conversation. The recovery test verifies its failed destination lock is released
  and its malformed turn record remains unchanged.
  The browser TUI/runtime test completes a browser task, sends another browser prompt,
  observes the same live page/session, cancels an in-flight browser wait through Ctrl+C,
  then verifies a later prompt can still read that same tab before application exit closes
  the session. A fresh TUI/application reopens the conversation transcript but fails closed
  rather than reattaching the prior browser. Its model-facing refusal is that browser work
  needs an explicit HTTP(S) URL or a current active page; the old live page is not silently
  attached. The browser TUI suite passed 5/5 from an isolated build. Browser manager
  tests reject cross-session tabs; browser tool tests expose explicit `browser_close`;
  browser-session tests cover configured-lifetime expiry and cleanup failures.
- The task approval now defaults to a task-only choice; it cannot be mistaken for one
  action and silently become a task-wide grant.
- `pnpm --dir lina run typecheck`: passed. Focused session, approval, process, browser,
  and native suites from an isolated build: 187/187 passed.
- The final isolated Lina build and full suite passed 723/723. The focused browser TUI
  suite passed 5/5, and the process-approval TUI suite passed 4/4. Existing `lina/dist`
  was not cleaned or overwritten.
- Approval-path evidence: one-action and deny remain available across domains; browser and
  computer can also grant the current task. Exact process requests additionally support
  conversation and local-profile grants. Tests prove local persistence across app restart,
  exact-argument mismatch denial, revocation, and fail-closed corrupt storage. No
  global allow-all permission exists.
- Approval routing is covered at each owner boundary: workspace changes through model
  `runTurn`, process scopes through the TUI/runtime, memory through `runTurn` allow and
  deny, browser and computer through their Cua/runtime paths, and existing-profile consent
  through the TUI callback plus Cua authorization-host and adapter checks. These are the
  existing focused suites; no second policy engine or broad approval matrix was added.
- Browser lifetime decision: retain the configured maximum lifetime (currently 1,800,000
  ms by default) instead of introducing another idle-timeout mechanism. It is measured
  from session start, not inactivity; docs now describe that limit accurately.
- Manual TUI check used a build of the current CLI in `/tmp` with OpenRouter's free
  `cohere/north-mini-code:free` model and an isolated state/workspace. The model returned `READY`; `/new`,
  `/resume`, exact-ID resume, and transcript recall all worked. I did not run `pnpm run
  chat` because its script rebuilds the existing `lina/dist`; the same current CLI entry
  point was run from the isolated build. This smoke check did not make a live Cua browser
  action; the browser lifecycle path was checked with the Cua adapter boundary tests.
- `git diff --check`: passed after the documentation and plan updates.
