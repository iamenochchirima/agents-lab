# Agent identity, memory and live interaction

Status: proposed implementation, not implemented.
Baseline: `a8ca04d`. Prepared 2026-10-10.

## Goal and scope

Make the five main platform agents consistent and useful across conversations,
and let a user collaborate with an agent during a running task. Temporal,
Restate, LangGraph, Mastra and Vercel Workflows retain ownership of native
execution. Tools, skills, identity and memory have shared semantics.

The user opens a platform and chats. There is no profile selection, business-role
template, administration token or native agent filesystem. This is one substantial
implementation phase with independently reviewable commits, not five unrelated
demonstrations. This temporary plan stays outside curated Docs.

## Observed baseline

- `server/src/control-plane/domain/manifest.ts` supplies a common baseline system
  instruction for tool use, skills, approvals, verification and task completion.
- `server/src/capabilities/context/` retains session history, active skills and
  compaction records. Session system instructions are immutable today. This is
  conversation continuity, not a platform-agent long-term memory service.
- `server/src/studio/memory/` has experimental memory contracts and persistence.
  Its comparison/trial/scenario namespaces belong to Studio. Inspect reusable
  mechanics, but do not import Studio ownership into platform chat.
- Connected memory MCP tools may exist in the catalog; their presence alone does
  not establish automatic recall or a shared identity lifecycle.
- `PlatformChatPage.tsx` blocks submission while `hasActiveRun` is true. Exact
  tool approvals already appear in chat; general clarification and steering are
  missing from that path.
- Native long-running acceptance exists across all five platforms. Preserve its
  deadlines, conservative handling of uncertain effects and recorded failures.
- Unrelated Lina migration, prototypes and research changes are present. Never
  stage them as part of this phase.

## Research and design decisions

### Identity is instruction; memory is data

OpenClaw separates persona and identity files from user information and factual
memory, then loads selected material into model context. These filenames are a
workspace convention, not a universal protocol. Adopt the separation, with backend
storage and optional Markdown import/export rather than agent file access.
[OpenClaw workspace](https://docs.openclaw.ai/concepts/agent-workspace),
[SOUL template](https://docs.openclaw.ai/reference/templates/SOUL).

LangGraph distinguishes thread-scoped state from cross-thread memory in explicit
namespaces. It also distinguishes memory content from the technique used to search
it. Start with bounded deterministic retrieval and explicit saves; embeddings and
background consolidation can follow evidence of a need.
[LangGraph memory](https://docs.langchain.com/oss/python/concepts/memory).

Proposed application-owned records:

| Record | Purpose | Update and scope |
| --- | --- | --- |
| Agent identity | Name, purpose, style, initiative and editable behavior | Operator-editable, versioned, shared workspace default |
| User preferences | Explicit durable preferences such as timezone or response style | Local user/workspace scope, editable and forgettable |
| Factual memory | Facts and decisions with sources and revisions | Namespaced, saved through bounded tools or UI |
| Conversation context | Current task, transcript, summaries, skill context | Existing session store and native checkpoints |
| Task input | Clarification replies and instructions sent while working | Append-only run input records with acknowledgements |

No record above grants tools or bypasses review. Keep runtime rules and permissions
outside editable identity. Memory and imported resource text remain data with
provenance; do not promote them into trusted instructions. Explicit preferences
can shape answers but cannot override runtime permission checks.

Default identity should describe a capable general assistant that uses available
tools, explains uncertainty, asks when information is needed and verifies actions.
Avoid fictional personal history, exaggerated self-description and tool lists
embedded in persona text. Capabilities continue to come from admitted catalog data.

### Persistence and context assembly

Use a focused server-owned store with revision checks, stable operation IDs and
atomic publication. Prefer existing persistence mechanics after inspection;
document any new dependency before introducing it. Do not couple this store to
one platform's checkpoint database or to Studio trial state.

Freeze identity revision at new-session admission, matching existing immutable
session instructions. Show that edits apply to new chats. Each turn records the
exact preference and recalled-memory revisions it used. Native replay reuses
recorded projections; new turns may retrieve newer records. Agent memory tools
can obtain fresh records explicitly within a task, with receipts retained.

Proposed context assembly: runtime instructions, identity, generated capability
information, bounded preference/memory data, session history/current task and
activated skills. Preserve actual supported message roles on each model API.
Protect current identity, live constraints and loaded skills during compaction;
summaries do not become new memory automatically. Count all projections against
the existing context budget.

Default recall is bounded lexical/filter retrieval with stable tie-breaking,
source metadata and a configurable byte/token ceiling. Pin explicit preferences
within their own small budget. Record exclusions/truncation honestly. Empty
memory is a valid state. Provide a visible Memory on/off control for chat.

Default writes are explicit user requests such as "remember this", not silent
extraction of everything said. Offer generic search/read/save/update/forget tools
through the existing capability adapter boundary. Reuse normal call receipts and
mutation validation; do not require a second approval for a clearly authorized
memory save. Ordinary external actions retain existing approval requirements.
Forgetting removes a record from future recall and prevents automatic resurrection.
It cannot erase text already delivered in a retained transcript or run evidence;
the UI must explain that distinction without claiming complete historical erasure.

### Live task input uses native execution

Persist input before delivery. Use a stable client input ID, target run, sequence,
kind, content digest and lifecycle: accepted, delivered, consumed or rejected.
An HTTP acknowledgement means stored, not necessarily read by the model. Retry
delivery of the same identity; never generate another reasoning turn just to resend.

| Platform | Native mechanism to verify against installed version |
| --- | --- |
| Temporal | Signals/Updates plus workflow-owned ordered input state and waits |
| Restate | Repeated durable Signals if supported by the installed SDK; otherwise workflow/shared-handler state and separately named durable promises |
| LangGraph | Persisted graph state, `interrupt` and `Command(resume=...)` |
| Mastra | Durable-agent/workflow suspension, resume data and retained native state |
| Vercel Workflows | Hooks and workflow-owned waits/steps |

These are proposed integration points, not claims of implemented SDK parity.
Temporal documents running-workflow messaging; LangGraph documents interrupt
resumption. Audit exact installed SDK support before finalizing each adapter.
[Temporal messaging](https://docs.temporal.io/encyclopedia/workflow-message-passing),
[LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts).

Restate's current documentation distinguishes repeatable Signals from single-use
awakeables and workflow promises. Verify compatibility with pinned SDK 1.17.0
before selecting Signals. Vercel hooks receive external input, but publication
must follow actual hook registration; an early callback needs retained retry.
Mastra distinguishes message history, working memory and recall, which should
not become three competing sources of the shared Lab memory.
[Restate external events](https://docs.restate.dev/develop/ts/external-events),
[Vercel hooks](https://workflow-sdk.dev/docs/foundations/hooks),
[Mastra memory](https://mastra.ai/docs/memory/overview).

Adapter-specific ordering matters: LangGraph replays the interrupted node, so
move effects before interruption into separately persisted steps. Mastra's
documented tool suspension requires an immediate return. Restate human waits must
not lock an exclusive object handler that also needs to accept the reply.
Validate matched question IDs, duplicate replies and stale responses in the same
focused input lifecycle group, rather than creating a broad fault matrix.
[Mastra human input](https://mastra.ai/docs/agents/human-in-the-loop).

Clarification is a dedicated generic capability with a native suspension contract,
not a blocking HTTP request held open indefinitely. Its result is the matched user
reply. It grants no permissions. Questions and answers appear in chat and survive
reload. Review decisions remain separate from clarification replies.

Steering messages are consumed at safe boundaries before the next model/tool
decision. An already dispatched action cannot be undone. Surface that limitation
and any pending delivery. New constraints invalidate affected pending proposals;
new arguments require a new approval identity. Serialize dispatch and input
consumption so an input accepted before the next dispatch gate is considered there.
Terminal-run input is rejected with a clear route to sending a normal new turn.
Existing absolute task deadlines still apply while awaiting human input.

## Implementation milestones and commit checkpoints

### 1. Shared identity and persistence contracts

- [ ] Audit current instruction construction, context sources, Studio storage
  mechanics and installed native APIs; record concrete choices in this document.
- [ ] Define versioned identity/preferences/memory records, workspace namespace,
  provenance, limits, revision conflicts and operation idempotency.
- [ ] Implement persistence and management API with empty defaults and migration
  behavior for existing sessions; preserve recorded system instructions.
- [ ] Add bounded identity Markdown import/export as content, without executable
  imports or access to arbitrary server paths.
- [ ] Add a small identity editor reachable from platform chat settings; shared
  changes are visible across platforms and apply to new chats.

Acceptance: edit identity, restart the backend, open a new chat and inspect the
recorded identity revision. An old chat retains its original revision.
Validation: one persistence/revision test group and server build.
Commit: `feat: add shared agent identity and durable memory records`.

### 2. Memory tools and model-visible recall

- [ ] Register generic memory operations through the current tool catalog with
  schema validation, workspace binding, receipts and no provider-name branches.
- [ ] Implement bounded recall and preference injection with exact source IDs,
  versions, token accounting and compaction protection.
- [ ] Make explicit save, correction and forget requests effective across new
  chats; exclude forgotten records from all future retrieval and stale caches.
- [ ] Add Memory management with search, edit, delete and enable/disable. Show
  saved-memory notifications in chat and explain the scope of forgetting.
- [ ] Give experiments isolated memory namespaces and an explicit memory policy;
  personal local memories must never contaminate fixture comparisons.

Acceptance: a preference saved in one platform is usable in a fresh chat on another;
a correction wins over its prior revision; a forgotten fixture fact is absent from
fresh context. An unrelated memory namespace stays inaccessible.
Validation: one focused lifecycle/context test group; inspect actual model requests.
Commit: `feat: integrate shared memory recall and management`.

### 3. Durable task input and clarification delivery

- [ ] Add input API/storage, duplicate handling, target validation, lifecycle
  events, observer delivery and recorded consumption acknowledgements.
- [ ] Implement matched clarification requests/replies and steering sequences;
  keep one native execution owner and the original admitted run/deadline.
- [ ] Define terminal, timed-out, stopped and uncertain-effect behavior. Do not
  silently convert a late input into a different task.
- [ ] Keep task input independent of external approvals and capability grants.

Acceptance: the same retried input ID produces one stored input; a conflicting
payload is rejected; delivery survives a control-plane restart.
Validation: focused input lifecycle tests using controllable adapter delivery.
Commit: `feat: persist clarification and steering inputs`.

### 4. Five native integrations

- [ ] Temporal and Restate consume inputs and wait for clarification natively.
- [ ] LangGraph resumes exact persisted questions and processes steering safely.
- [ ] Mastra uses the installed durable execution APIs and preserves suspension.
- [ ] Vercel resumes via native hooks, preserving its local/hosted limits.
- [ ] Each integration retains identity, recall and input receipts in run evidence;
  native replay never repeats a completed memory write.
- [ ] Supersede affected pending proposals before dispatch; preserve confirmed
  effects and report instructions that arrived after dispatch.

Acceptance: each platform performs ask → wait → answer → continue and consumes one
steering message before its next eligible action. Retained wait state survives an
owned worker replacement on each supported local integration.
Validation: one focused native path per platform. Do not multiply the whole
existing conformance suite unless a regression requires it.
Commits: one coherent Temporal/Restate unit, one LangGraph/Mastra unit and one
Vercel unit after their respective checks.

### 5. Chat interaction and real-model acceptance

- [ ] Allow instructions during active tasks. Display accepted versus consumed
  status and preserve ordinary follow-up behavior after task completion.
- [ ] Render questions inline with a reply control; retain focus, drafts, ordering
  and history through reload. Keep approvals inside assistant messages.
- [ ] Add one reusable fictional scenario combining preference recall, ambiguity,
  steering, an approved connected write and a denied/superseded action.
- [ ] Run it on all five main baselines with an exact currently verified free
  model, zero-price routing and no paid fallback. Record model omissions and
  provider failures separately from runtime failures.
- [ ] Inspect actual requests for identity and recalled-memory content. Grade
  state, receipts and input acknowledgements rather than exact response wording.
- [ ] Independently read final connected state; retain prompts, config, timestamps,
  namespace, revisions, native IDs, trajectories and original failed assessments.
- [ ] Drive the browser directly for save/edit/forget, clarification reply,
  steering, approval/denial and reload continuity. Do not ask the user to perform
  checks available to the agent.
- [ ] Update stable usage/architecture/platform notes, run doc generation and
  move this checklist to completed only after its acceptance audit passes.

Commits: `feat: add inline task collaboration and memory controls`, then
`test: verify identity memory and interaction across native platforms`, including
the stable documentation matching the delivered behavior.

## Focused validation budget

Prefer meaningful checks over coverage targets. Share pure-contract tests; verify
native suspension and consumption with native integration checks. Avoid snapshots
of large UI trees, repeated free-model trials to obtain a nicer score, benchmarks,
large fault-injection matrices and hosted deployment work in this phase.

Existing commands, run from the repository root:

```sh
pnpm --dir server run build
node --test server/dist/tests/context/context-service.test.js server/dist/tests/context/round-context.test.js
pnpm --dir apps/web run typecheck
pnpm --dir apps/web run generate:docs
git diff --check
```

Add named focused commands for new tests when files exist. The current web tree
has unrelated migration changes: report pre-existing failures without modifying
those files or presenting them as failures of this implementation.

## Definition of done

- [ ] The same shared identity and explicit memory capabilities reach all five
  platforms, with inspectable versioned model context.
- [ ] Preferences survive new chats, corrections replace old recall, and forgetting
  prevents subsequent retrieval in a fresh conversation.
- [ ] Running agents can ask questions and receive instructions inside chat using
  native platform execution; accepted inputs survive supported restarts.
- [ ] Changed action proposals require fresh review; memory/identity never bypass
  permissions or introduce native filesystem access.
- [ ] Focused deterministic, native and free-model observations have retained
  evidence; limitations and original failures remain visible.
- [ ] Implementation is committed in the coherent chunks above. Only task-owned
  files are staged; no credentials, personal memories or local runtime state enter Git.

## Current position and open decisions

Planning only. No runtime changes or implementation goal created by this plan.
First implementation item: finalize namespace/storage and installed SDK contracts.
Confirm bounded retrieval limits during that audit. Semantic embeddings, automatic
memory extraction, persona self-rewriting, background dreaming/consolidation,
multi-user auth and hosted durability are deferred. No credential or user choice
currently blocks planning; native API limitations must be recorded rather than
hidden behind simulated behavior.

## Evidence ledger and completion audit

- Baseline inspection: common manifest instruction, immutable context sessions,
  experimental Studio memory, chat active-run submission guard and package versions.
- [ ] Record each implementation commit and the check it passed here.
- [ ] Re-read the requested behavior and inspect all five integrations against it.
- [ ] Reconcile every unchecked item and distinguish implementation from evidence.
- [ ] Inspect complete staged diffs and preserved unrelated changes.
- [ ] Document remaining limits before reporting completion.
