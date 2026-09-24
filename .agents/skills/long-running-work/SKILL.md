---
name: long-running-work
description: Plan and carry out substantial, multi-phase work that needs sustained autonomous execution. Use when an agent must retain the objective, work through many requirements, verify progress, and avoid declaring completion prematurely. Do not use for small, self-contained changes.
---

# Long-running work

Use a single local plan as the task's working memory. The plan keeps the work
oriented after context compaction and makes completion auditable. It combines
the useful parts of a specification, milestone plan, and progress log without
creating three files that can drift apart.

## Decide whether to use a plan

Use this skill when the request has several dependent phases, significant risk,
multiple acceptance criteria, or is likely to require more than one focused
work session. Do not create a plan for a narrow change that can be implemented
and verified directly.

Before planning, inspect the request and the relevant repository. Preserve the
user's stated scope. Do not add work merely because it seems useful.

## Create local working state

For a repository task, keep the plan under:

```text
.long-running-work/active/<task-slug>.md
```

Keep this directory local by adding `.long-running-work/` to `.git/info/exclude`
when that file exists and does not already ignore it. Do not edit the project's
`.gitignore` or documentation merely to store agent state. If the task is not in
a Git repository, use the same directory but tell the user that it is not
automatically ignored.

Use one active plan per task. Do not create separate progress, findings, and
state files unless the user asks for them.

## Plan format

Write a focused plan with these sections:

```markdown
# <task title>

## Goal and scope
<The requested outcome, boundaries, and what is explicitly out of scope.>

## Constraints and relevant context
- <Repository rules, compatibility requirements, or user decisions.>

## Definition of done
- [ ] <Observable end-to-end outcome required for completion>

## Baseline
- Existing behavior: <What works or fails before changes>
- Validation commands: <Commands for the affected area>
- Git state: <Current branch, commit, and unrelated working-tree changes>

## Milestones
### 1. <milestone name>
Acceptance criteria:
- [ ] <Observable condition for this milestone>

Validation:
- [ ] `<command>` passes

Implementation checklist:
- [ ] <One coherent implementation or investigation item>

## Current position
Milestone: <number and name>
Current item: <unchecked item>
Status: <investigating | implementing | verifying | blocked>
Last verified checkpoint: <commit, command result, or none>

## Evidence ledger
- <Completed item>: <test, command, inspection, or artifact that proves it>

## Decisions and findings
<Only facts that change later work.>

## Blockers
None.

## Completion audit
- [ ] Re-read the original request and acceptance criteria.
- [ ] Audit the repository against the definition of done, including unplanned gaps.
- [ ] Confirm every applicable milestone and checklist item has verification evidence.
- [ ] Run the complete relevant test, type-check, lint, build, and end-to-end validation.
- [ ] Resolve or report every remaining gap.
```

The goal and scope come from the user's request. The definition of done is the
stopping condition. The baseline prevents the agent from confusing a pre-existing
failure with a regression. Each milestone needs its own acceptance criteria and
validation commands, not only a list of files to edit. The implementation
checklist describes the work needed to satisfy those conditions.

Make checklist items concrete and small enough to verify. Capture dependencies
in their order. Include investigation as a checklist item when important facts
are unknown. Keep the evidence ledger next to the checklist so a later session
can tell why an item was marked complete. Do not turn the plan into a speculative
design document.

Do not create `AGENTS.md`, `SPEC.md`, `PLAN.md`, or `PROGRESS.md` merely because
this skill is active. Those are project-owned documents. Use the hidden local
plan by default, and follow an existing repository convention or an explicit
user request when the work is meant to be shared with a team.

## Execute the plan

Repeat until the completion audit passes or a genuine blocker requires the
user:

1. Re-read the objective, current position, and checklist.
2. Find the next actionable unchecked item whose prerequisites are satisfied.
3. Inspect the relevant code, configuration, tests, or external state.
4. Make the smallest coherent change that advances that item.
5. Run the item's narrowest useful verification.
6. If verification fails, investigate the failure, fix it, and run the verification
   again. Stay in this loop until it passes or a genuine blocker requires the user.
7. After it passes, record the specific evidence in the plan and mark the item
   `[x]`. Never check an item based only on an implementation that looks plausible.
8. Update the current position, decisions, blockers, and checkpoint when they change.
9. Re-read the plan and continue with the next actionable unchecked item.

In shorthand:

```text
READ PLAN → NEXT ACTIONABLE ITEM → IMPLEMENT → VERIFY
     ↑                                      │
     └──────────── INVESTIGATE / FIX ← FAIL┘
                         │ PASS
                         ↓
                  RECORD EVIDENCE
                         ↓
                        [x]
                         ↓
                 UPDATE CURRENT STATE
                         ↓
                      CONTINUE
```

Do not mark an item complete because implementation looks plausible. Mark it
complete only after the acceptance condition is verified. Evidence can be a
test name and result, a command, a screenshot, a review observation, or another
specific check appropriate to the item.

When a milestone's implementation checklist is complete, run every validation
command for that milestone and check its acceptance criteria only after those
commands pass. Then update the current position and continue to the next
milestone. A completed milestone is not a stopping condition.

## Commit discipline

Checklist items are progress and verification units, not commit boundaries. Do
not create a commit after every checkbox by default.

Create a checkpoint commit when a coherent implementation unit is complete and
verified. A good checkpoint usually:

- represents one understandable change;
- includes the relevant tests with the implementation;
- passes the applicable validation;
- can be reviewed or reverted independently; and
- leaves the repository in a reasonable state.

Before committing:

1. Re-check the working tree against the baseline. Treat unrelated existing
   changes as user-owned.
2. Inspect the complete diff and staged diff.
3. Confirm the unit's relevant validation passes.
4. Stage only files belonging to that unit.
5. Create the commit only when the repository convention and user scope allow it.
6. Record the commit ID and what it proves in the plan's checkpoint/evidence
   ledger.

Do not push, force-push, rewrite history, rebase, or amend unrelated commits as
part of this workflow. A checkpoint commit improves recovery, but it is not
proof that the overall task is complete. If commits are not authorized or do
not fit the repository workflow, record a verified working-tree checkpoint
instead and continue.

## Finish honestly

Before declaring success, perform the completion audit. Reconcile the finished
work with the original request, not only with the plan. Add and complete any
missing applicable work discovered during that audit.

If progress depends on a user choice, missing credential, external approval, or
unavailable system, record the exact blocker and ask for the smallest decision
or action needed. Do not claim the objective is complete in that case.
