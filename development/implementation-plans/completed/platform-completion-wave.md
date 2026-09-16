# Platform Lab completion wave

**Created:** `2026-09-16T22:54:39+02:00`
**Last updated:** `2026-09-16T23:26:41+02:00`
**Status:** Completed
**Owner:** Agent Harness Lab — Platform Lab implementation

## Start here

Read these before changing code:

- [`repository rules`](../../../AGENTS.md)
- [`documentation guide`](../../../docs/contributing/documentation.md)
- [`implementation-plan template`](../TEMPLATE.md)
- [`Platform Lab ownership`](../../../apps/web/src/features/platforms/README.md)
- [`server ownership`](../../../server/README.md)
- [`runner interface`](../../../server/src/control-plane/ports/runner.ts)
- [`context plan`](context-management.md)
- [`tool-loop plan`](tool-enabled-turn-loop.md)
- [`browser-chat plan`](browser-chat-surface.md)
- [`Restate local development`](../../../server/src/platforms/restate/docs/local-development.md)

The three linked plans remain the detailed source of truth for their own contracts and
checklists. This parent plan coordinates their completion and records the integrated
gates. It does not replace their platform or capability-specific decisions.

The repository's referenced release-process document is not present in this checkout.
Before archival, record that fact and mark release-process items as not applicable only
where the missing canonical document makes a decision impossible; do not invent release
requirements.

## Purpose

Finish the first real Platform Lab conversation and tool flow as one coherent,
browser-verifiable implementation. The completed wave will make server-owned context,
Temporal multi-turn continuity, Restate durable tool execution, real model selection,
platform status, and normalized evidence agree without adding fake platform behaviour or
requiring Docker.

## Definition of done

From the browser, a contributor can open a registered platform Chat surface, choose a
real OpenRouter model, send a prompt, inspect the resulting assistant output and
platform/tool events, and understand the server-owned context usage. Temporal supports a
continued conversation with the same session and bounded compaction. Restate supports
the real calculator tool loop with durable model/tool steps. Duplicate sends, failures,
cancellation, restart, unavailable dependencies, and stale projections are represented
honestly. The required native local validation profile passes and the three child plans
are archived with exact validation records.

```text
browser chat → Platform server → selected native platform
             → real model or deterministic fixture → context/tool/evidence projection
             → inspectable browser state and lab records
```

## Ownership and coordination

This is Platform Lab work only. It does not include Computer Native, Studio, Component
Lab, Trigger.dev infrastructure work, AWS Step Functions validation, or a new platform
adapter.

| Workstream | Authoritative plan | Owned area |
| --- | --- | --- |
| Context hardening and acceptance | [`context-management.md`](context-management.md) | `server/src/capabilities/context/`, session/run integration, context tests and docs |
| Restate tool-loop closure | [`tool-enabled-turn-loop.md`](tool-enabled-turn-loop.md) | Restate tool evidence, browser tool presentation, Restate tests and docs |
| Browser conversation completion | [`browser-chat-surface.md`](browser-chat-surface.md) | `apps/web/src/features/platforms/`, browser/component tests and platform UI docs |
| Final integration | This plan | cross-workstream validation, plan records, archival and focused handoff |

The primary agent owns integration and shared files. Independent work may be delegated
only in isolated worktrees with disjoint write sets. The browser-chat and Restate
tool-loop plans overlap in the same web files, so their final integration and commits
must be sequential.

## Scope

- [x] Complete the required server-side context hardening: explicit client turn
      idempotency and independently enforced session/transcript limits are implemented
      and tested at the server contract seam.
- [x] Complete the browser Chat acceptance flow for Temporal and the registered
      platforms with the real API/worker smoke plus deterministic browser fixtures.
- [x] Complete browser presentation and tests for the Restate calculator lifecycle,
      context usage, model rounds, failures, cancellation, and route availability.
- [x] Run the integrated native local validation profile without Docker and inspect the
      resulting evidence and safe redaction behaviour.
- [x] Update the affected Platform Lab, platform, and local-development documentation;
      record unavailable optional profiles and known limitations.
- [x] Commit coherent code sections separately, update all three child plans, and archive
      them only after the parent completion gate passes.

## Explicitly out of scope

- Docker as a required development, acceptance, or completion dependency. The
  Testcontainers Restate replay check may remain an optional compatibility check.
- Long-term memory, embeddings, retrieval, or `MEMORY.md`-style learning.
- MCP, OAuth, social connectors, plugins, skills, arbitrary shell/filesystem tools, or
  browser automation.
- Native multi-turn context/session adapters for every platform. Temporal is the current
  session adapter; Restate's next session adapter gets a separate follow-on plan.
- Replacing framework-native execution with a common fake runtime.
- Computer Native, Studio, Component Lab, Trigger.dev local infrastructure, or AWS
  Step Functions emulator/hosted validation.

## Phase gates

### Phase 0 — reconcile scope and ownership

- [x] Inspect the current dirty worktree before each change and identify files owned by
      this wave.
- [x] Confirm the three child plans still describe the current implementation and link
      to valid files.
- [x] Keep user and other-agent changes unstaged and avoid overlapping edits.

Exit gate: the parent and child plans agree on scope, ownership, and Docker policy.

### Phase 1 — finish context contract and server behaviour

- [x] Implement and test explicit client idempotency for repeated turn requests; keyed
      retries replay one durable run and changed prompts conflict.
- [x] Implement and test independent session/transcript size limits with pre-write
      enforcement and `CONTEXT_LIMIT_EXCEEDED` API classification.
- [x] Re-run context, run-service, evidence, and Temporal integration tests.
- [x] Perform the available browser context acceptance checks: live growth/percentage,
      deterministic compaction and overflow tests, restart/reload coverage, and safe
      session/run records. Live provider-specific small-window compaction is explicitly
      deferred because the configured model is not a deterministic small-window profile.
- [x] Update the context plan's implementation, validation, limitations, and commit
      sections.

Exit gate: a Temporal session has one canonical transcript, an authoritative server
projection, bounded compaction, stable restart behaviour, and no duplicate admitted turn.

### Phase 2 — finish browser conversation and tool presentation

- [x] Complete the missing Chat state/configuration/evidence behaviour without adding
      noisy explanatory UI or browser-native dialogs.
- [x] Add focused pure state and browser acceptance coverage for send, polling,
      completion, failure, cancellation, duplicate prevention, New Chat, model locking,
      availability, and API errors.
- [x] Add browser checks for Temporal two-turn continuity and all 11 registered platform
      Chat routes with honest ready/unavailable behaviour.
- [x] Verify the Restate calculator lifecycle and context panel through the native local
      profile and browser acceptance fixtures after completion, cancellation, failure,
      and refresh/reopen.
- [x] Keep the controlled Run and Compare surfaces intact.
- [x] Update the browser-chat and tool-loop plans with exact validation observations and
      limitations.

Exit gate: browser state is derived from server state, has no duplicate-key or polling
loop errors, and clearly distinguishes model output, platform status, and tool activity.

### Phase 3 — native integration and evidence audit

- [x] Run the native pinned Restate server profile with persistent local state.
- [x] Run the full server test suite, native Restate tests, Temporal tests, web typecheck,
      web build, and `git diff --check`.
- [x] Inspect a Temporal multi-turn session/compaction evidence path and a Restate tool
      run under `lab/sessions/` and `lab/runs/`.
- [x] Verify `config.json`, `events.jsonl`, `trajectory.json`, `metrics.json`,
      `result.json`, and relevant native evidence are ordered, stable, and credential-free.
- [x] Confirm Docker-only checks are labelled optional and are not used to claim or block
      the required local result.

Exit gate: the required Docker-free profile passes and the evidence supports every claim
made by the UI and documentation.

### Phase 4 — commits, documentation, and archival

- [x] Commit context server changes and tests as focused sections: `022f7eb`, `610f34f`,
      and `38425c7`.
- [x] Commit browser Chat changes and tests as focused sections: `5e136c8`, `98189fe`,
      and route coverage `4ec5760`.
- [x] Commit Restate browser/tool presentation and related tests in the existing Restate
      sections plus `5e136c8`/`98189fe` for shared Chat presentation.
- [x] Record documentation and plan records in focused documentation changes; the parent
      and child records are archived together after validation.
- [x] Record exact commit hashes, validation commands, manual observations, and known
      limitations in each child plan.
- [x] Archive the three child plans, then archive this parent plan only after all links
      and completion records resolve.

Exit gate: no required child-plan checkbox remains open, all completion records are
honest, and the next Restate session-adapter work is clearly separated into a new plan.

## Failure, retry, and recovery rules

- Model calls retain their platform-specific at-least-once and ambiguous-outcome rules.
  No external provider request is retried merely because its acknowledgement was lost.
- Canonical transcript appends, context revisions, evidence projections, and duplicate
  run submissions must be idempotent at their documented seams.
- A native worker/server restart must resume or reconcile from durable state rather than
  create a second logical turn or fabricate a successful result.
- A missing optional platform dependency is shown as unavailable; it is never replaced
  with fake success.
- A stale evidence projection remains stale until the server can reconcile it.
- Cancellation is terminal only after the selected platform confirms the cancellation
  boundary; interrupted external requests retain their existing unknown-outcome meaning.
- Docker absence is not a failure of the required local profile.

## Security and configuration

- OpenRouter credentials remain process-local and never enter browser state, manifests,
  tool arguments, context snapshots, logs, or evidence.
- Context snapshots and tool events remain bounded and redacted.
- Browser tests use safe deterministic fixtures unless a real OpenRouter acceptance
  specifically requires the local ignored environment file.
- Native Restate state uses a temporary or ignored persistent directory and is removed
  or retained only according to the documented local-development procedure.

## Required validation commands

```bash
pnpm --filter @agent-harness-lab/lab-server run typecheck
pnpm --filter @agent-harness-lab/lab-server run test
pnpm --filter @agent-harness-lab/lab-server run test:temporal
AGENTLAB_RUN_RESTATE_NATIVE_INTEGRATION=1 pnpm --filter @agent-harness-lab/lab-server run test:restate
pnpm --filter @agent-harness-lab/web run typecheck
pnpm --filter @agent-harness-lab/web run build
git diff --check
```

The native Restate command requires the pinned local Restate server and registered
service. It must be run without Docker for the required profile. The Docker-backed
Testcontainers check is optional and may remain skipped. Browser acceptance must use a
real local server and worker; deterministic fixtures are allowed for controlled failure
and tool protocol cases.

## Completion gate

- [x] All required phases and child-plan checklists are complete or have an explicit,
      evidence-backed deferral that does not misrepresent the finished behaviour.
- [x] Temporal multi-turn context, compaction, restart, and duplicate-turn semantics
      work through the server contract and the browser-tested projection; live provider
      small-window compaction is a documented follow-on.
- [x] Restate calculator tool execution, lifecycle evidence, cancellation, and restart
      behaviour work through the browser fixtures and native local profile.
- [x] Every registered platform Chat route opens, and every live unavailable service is
      reported as unavailable rather than fabricated as ready.
- [x] No Docker-dependent check is treated as required.
- [x] Documentation, validation records, known limitations, and commit hashes are
      complete and links resolve.
- [x] The three child plans and this parent plan are ready for archival after the final
      documentation commit.

## Current progress record

**Started:** `2026-09-16T22:54:39+02:00`

- Parent plan created from the current context-management, tool-enabled-turn-loop, and
  browser-chat-surface plans.
- Docker policy normalized: native Restate is required; Testcontainers replay is optional.
- Phase 0 ownership and link checks passed; the worktree remains intentionally dirty with
  unrelated user and other-agent changes that are not part of this wave.
- Phase 1 context hardening passed with server commits `022f7eb`, `610f34f`, and `38425c7`.
- Phase 2 browser/tool completion passed with `5e136c8`, `98189fe`, and `4ec5760`.
- Phase 3 passed: server 250-test suite, Temporal, native Restate, web build/typecheck,
  browser acceptance, and live two-turn Temporal/OpenRouter smoke all completed without
  Docker.

## Completion record

Complete only when the integrated Platform Lab wave is finished.

**Completed:** `2026-09-16T23:26:41+02:00`
**Commits:** `022f7eb`, `610f34f`, `38425c7`, `5e136c8`, `98189fe`, `4ec5760`

### Validation

- Full server suite — 250 tests: 248 passed, 2 skipped, 0 failed.
- Temporal integration — 1 passed; native Restate integration — 36 passed, 1 optional
  Docker compatibility test skipped.
- Web typecheck/build — passed; only the existing Vite large-chunk warning remains.
- Browser model-picker/Chat acceptance — 5 passed; all 11 registered platform Chat
  routes opened without route errors or native dialogs.
- Live Temporal/OpenRouter smoke — two completed turns in
  `session-manual-context-20260916`; the follow-up referred to the first response and
  the server projection reported a 256000-token window with 97% remaining.
- Evidence audit — session transcript, snapshots, context projections, normalized run
  evidence, and native platform evidence were present; credential-shaped fields were
  absent.

### Known limitations

- Only Temporal/baseline has canonical multi-turn context in this wave. Other platforms
  intentionally remain single-turn until their native session adapters are planned.
- Live provider-specific browser compaction is deferred because the configured OpenRouter
  model is not a deterministic small-window profile; deterministic preflight/overflow
  compaction is covered by server and Temporal integration tests.
- Docker-backed Restate replay compatibility is optional; native pinned Restate state and
  worker restart are the required local profile.
- The repository release-process file referenced by the working rules is absent, so
  analytics, rollout, migration, and rollback are recorded as `not applicable` for this
  local Platform Lab slice.

### Historical-scope note

This parent plan coordinates the first Platform Lab completion wave. It does not make
Temporal, Restate, or another framework the universal agent runtime, and it does not
claim that one platform's session or durability semantics apply to another.
