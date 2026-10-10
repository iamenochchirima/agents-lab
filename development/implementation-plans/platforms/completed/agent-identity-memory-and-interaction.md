# Agent identity, memory and live interaction

Status: completed and verified locally, 2026-10-10.
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

- [x] Audit current instruction construction, context sources, Studio storage
  mechanics and installed native APIs; record concrete choices in this document.
- [x] Define versioned identity/preferences/memory records, workspace namespace,
  provenance, limits, revision conflicts and operation idempotency.
- [x] Implement persistence and management API with empty defaults and migration
  behavior for existing sessions; preserve recorded system instructions.
- [x] Add bounded identity Markdown import/export as content, without executable
  imports or access to arbitrary server paths.
- [x] Add a small identity editor reachable from platform chat settings; shared
  changes are visible across platforms and apply to new chats.

Acceptance: edit identity, restart the backend, open a new chat and inspect the
recorded identity revision. An old chat retains its original revision.
Validation: one persistence/revision test group and server build.
Commit: `feat: add shared agent identity and durable memory records`.

### 2. Memory tools and model-visible recall

- [x] Register generic memory operations through the current tool catalog with
  schema validation, workspace binding, receipts and no provider-name branches.
- [x] Implement bounded recall and preference injection with exact source IDs,
  versions, token accounting and compaction protection.
- [x] Make explicit save, correction and forget requests effective across new
  chats; exclude forgotten records from all future retrieval and stale caches.
- [x] Add Memory management with search, edit, delete and enable/disable. Show
  saved-memory notifications in chat and explain the scope of forgetting.
- [x] Give experiments isolated memory namespaces and an explicit memory policy;
  personal local memories must never contaminate fixture comparisons.

Acceptance: a preference saved in one platform is usable in a fresh chat on another;
a correction wins over its prior revision; a forgotten fixture fact is absent from
fresh context. An unrelated memory namespace stays inaccessible.
Validation: one focused lifecycle/context test group; inspect actual model requests.
Commit: `feat: integrate shared memory recall and management`.

### 3. Durable task input and clarification delivery

- [x] Add input API/storage, duplicate handling, target validation, lifecycle
  events, observer delivery and recorded consumption acknowledgements.
- [x] Implement matched clarification requests/replies and steering sequences;
  keep one native execution owner and the original admitted run/deadline.
- [x] Define terminal, timed-out, stopped and uncertain-effect behavior. Do not
  silently convert a late input into a different task.
- [x] Keep task input independent of external approvals and capability grants.

Acceptance: the same retried input ID produces one stored input; a conflicting
payload is rejected; delivery survives a control-plane restart.
Validation: focused input lifecycle tests using controllable adapter delivery.
Commit: `feat: persist clarification and steering inputs`.

### 4. Five native integrations

- [x] Temporal and Restate consume inputs and wait for clarification natively.
- [x] LangGraph resumes exact persisted questions and processes steering safely.
- [x] Mastra uses the installed durable execution APIs and preserves suspension.
- [x] Vercel resumes via native hooks, preserving its local/hosted limits.
- [x] Each integration retains identity, recall and input receipts in run evidence;
  native replay never repeats a completed memory write.
- [x] Supersede affected pending proposals before dispatch; preserve confirmed
  effects and report instructions that arrived after dispatch.

Acceptance: each platform performs ask → wait → answer → continue and consumes one
steering message before its next eligible action. Retained wait state survives an
owned worker replacement on each supported local integration.
Validation: one focused native path per platform. Do not multiply the whole
existing conformance suite unless a regression requires it.
Commits: one coherent Temporal/Restate unit, one LangGraph/Mastra unit and one
Vercel unit after their respective checks.

### 5. Chat interaction and real-model acceptance

- [x] Allow instructions during active tasks. Display accepted versus consumed
  status and preserve ordinary follow-up behavior after task completion.
- [x] Render questions inline with a reply control; retain focus, drafts, ordering
  and history through reload. Keep approvals inside assistant messages.
- [x] Add one reusable fictional scenario combining preference recall, ambiguity,
  steering, an approved connected write and a denied/superseded action.
- [x] Run it on all five main baselines with an exact currently verified free
  model, zero-price routing and no paid fallback. Record model omissions and
  provider failures separately from runtime failures.
- [x] Inspect actual requests for identity and recalled-memory content. Grade
  state, receipts and input acknowledgements rather than exact response wording.
- [x] Independently read final connected state; retain prompts, config, timestamps,
  namespace, revisions, native IDs, trajectories and original failed assessments.
- [x] Drive the browser directly for save/edit/forget, clarification reply,
  steering, approval/denial and reload continuity. Do not ask the user to perform
  checks available to the agent.
- [x] Update stable usage/architecture/platform notes, run doc generation and
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

- [x] The same shared identity and explicit memory capabilities reach all five
  platforms, with inspectable versioned model context.
- [x] Preferences survive new chats, corrections replace old recall, and forgetting
  prevents subsequent retrieval in a fresh conversation.
- [x] Running agents can ask questions and receive instructions inside chat using
  native platform execution; accepted inputs survive supported restarts.
- [x] Changed action proposals require fresh review; memory/identity never bypass
  permissions or introduce native filesystem access.
- [x] Focused deterministic, native and free-model observations have retained
  evidence; limitations and original failures remain visible.
- [x] Implementation is committed in the coherent chunks above. Only task-owned
  files are staged; no credentials, personal memories or local runtime state enter Git.

## Current position and open decisions

Implementation complete. Shared identity, memory and live input are integrated in
all five main native baselines. Each passed the actual free-model scenario; owned
replacement and browser evidence are retained below. Semantic embeddings,
automatic memory extraction, persona self-rewriting, background consolidation,
multi-user auth and hosted durability remain explicitly outside this phase.
The original Restate transport exceptions remain unexplained; later success is
not a diagnosis. No failure or original assessment was discarded.

## Evidence ledger and completion audit

- Baseline inspection: common manifest instruction, immutable context sessions,
  experimental Studio memory, chat active-run submission guard and package versions.
- [x] Record each implementation commit and the check it passed here.
- [x] Re-read the requested behavior and inspect all five integrations against it.
- [x] Reconcile every unchecked item and distinguish implementation from evidence.
- [x] Inspect complete staged diffs and preserved unrelated changes.
- [x] Document remaining limits before reporting completion.


### Implementation checkpoints

- `46af333`, `3f761c9`: explicit versioned identity/memory storage and tools, four lifecycle tests. Empty startup defaults; semver source identity and schema-copy startup compatibility corrected.
- `273d981`: shared settings dialog; web typecheck passed. Direct browser on isolated 5174 saved identity revision 2 and saved/updated/forgot a fictional preference.
- `ace76d9`, `a0a62bf`: ordered input storage and native Temporal/Restate boundaries, five focused lifecycle/replay checks and existing 38 relevant checks passed.
- `65ae633`: real-model scenario/driver and three grader checks. Execution evidence pending, code is not itself a passing observation.
- `6b18bb9`, `a1768b1`: local HTTP management, immutable identity, per-turn untrusted recall, isolated namespaces, dispatch gate and consumed-input history. Combined 42 focused checks passed; build passed. A reused session cannot cross into a different experiment namespace.
- `958e28d`: actual owned Temporal/Restate process replacement kept the original native execution/question/deadline and consumed exactly one retried answer. Summary `lab/runs/.sustained-proof/runs/.identity-memory-proof/native-clarification-079f8339-bb9e-47b1-803d-ee399077874d/summary.json`. Initial missing synthetic model-window failures retained separately. Restate discovery metadata must refresh when a shared handler is added; owned launcher now does this without replacing the journal.
- Browser Temporal run `78e995fb-db45-48fd-8a97-ece42ae409d8`: inline question and answer, unsent draft survived refresh; native execution completed after Reply. This uses a scripted model and does not measure model choice.

Persistence defaults: local single API owner, 12 KiB/12-record recall, 4 KiB preferences; existing identity sessions remain frozen. Clarification available in normal bounded native chat; no VM/filesystem added. Mastra installed SDK final-output retry behavior needs a transport boundary workaround, retained in platform documentation. All unrelated Lina work remains unstaged.

- `2db84c3`: LangGraph/Mastra/Vercel native integration. Installed SDK checks passed: 53 LangGraph tests, focused Mastra durable/recovery/transport checks, Vercel World service/recovery checks. Compatibility behavior and local/hosted limits documented per platform.
- `93bdf3b`: inline questions/instructions, persisted drafts and shared settings reach normal platform Chat; web typecheck/doc generation passed.

- `21319ec`, `1231242`: native phase/order handling, all-five owned clarification recovery driver, SDK fixture projection correction. Vercel native recovery passed in `native-clarification-56155a10-ac51-45a9-a8bb-293486e8ba28`; LangGraph/Mastra original native lifecycle passed under `assessment-native-v2.json` in `native-clarification-b7371533-5515-4fe2-8e85-8765229372a8` (original failed presentation assessments retained).
- `b6243bb`: allowlisted Restate transport error diagnostics; four adapter tests passed. One actual free diagnostic run `6be53531-aec5-446e-8637-d35364ce93f6` completed READY with one acknowledged provider request. Earlier transport exceptions remain unclassified; success does not establish their cause.
- `816bac8`, `0a5d6dd`: Temporal/Restate deterministic fixtures retain a bounded original user directive after steering, without trusting assistant/tool content. 17 Temporal/provider checks and 15 Restate model checks passed. Browser failure `7d84eebe-acff-4d60-b2ad-25c295b86ef5` was a fixture failure, not failed native cancellation; original evidence retained.
- `ee79ac5`: actual LangGraph automatic memory-write rejection corrected to match resolved catalog approval policy. Twenty focused host/review tests passed; tool grants and schema checks remain in force.
- `279bd8d`: live driver answers an exact fictional memory-consent question once, retaining evidence; no tool permission is granted. Four grader/consent checks passed.
- `0d8e367`: active steering remains available when the admitted model is absent from the refreshed picker catalog; web typecheck passed.
- Browser denial `6191a35d-9374-401d-8847-3b046c915104` completed with denied inline card retained after refresh and independent fixture effect count zero. Prior expired denial attempt is preserved. Browser approval `457daf6e-c0bd-47cf-b9ab-633b58766af1` retained its acknowledged card after refresh and independent state confirmed one Morgan mutation.
- Post-fix owned Temporal/LangGraph worker replacements passed `native-clarification-aba98d85-4720-4c52-9e07-46630d5c3788` without changing native IDs, question or deadline.
- Original real-model report `identity-interaction-22eacbdc-f3ac-4c2b-a2fd-a4abb64e6962` is retained: Temporal passed all 13 criteria. Restate had an unacknowledged transport failure; LangGraph target was not admitted after its predecessor failed. Mastra target was not admitted after LangGraph seed runtime rejection and an unanswered seed consent question. Vercel target was not admitted because catalog fetch failed. These are not five target-runtime failures. A bounded follow-up on the four impacted targets is in progress after the demonstrated LangGraph and driver corrections; no paid fallback.

### Final acceptance and requirement audit

- `4f9cc10`: per-turn/context recall evidence includes exact record revisions,
  omitted count, bytes and digest. Existing context test proves a correction is
  used in the next fresh context, forgetting/disabled recall excludes it, and
  historical projections remain unchanged. Server build and focused check passed.
- `1c4e47d`: confirmed memory mutation notices in chat; six focused UI state
  checks and web typecheck passed. Direct browser displayed Memory saved on actual
  free-model seed `19122c7c-40ea-4eb4-887b-7e207d6bd919`.
- Actual free follow-up report `identity-interaction-c875efbd-76ac-42fb-bb90-1cef3d2e710a`
  passed all 13 unchanged grader criteria for Restate, LangGraph, Mastra and
  Vercel Workflows. Exact task runs: `3d30b130-8e81-4980-97a5-e9a0a497a9cd`,
  `2d27b240-d670-4675-b9f8-4b03e06844e0`,
  `57cef889-4b75-41e4-99b0-86fd4db3530a`,
  `d08c92c1-514d-4754-99e0-c5efcb143146`. Temporal passed original run
  `830f8a2b-f719-40e0-81b2-d58dbef7c9dd`. Original reports remain intact.
- Browser redirect `893bc67d-b75e-4990-85aa-26fdd99ee48c` retained its unsent
  instruction across refresh, cancelled its original question, consumed exactly
  one instruction and completed. Refresh retained both inline cards. Browser
  summary/screenshots live in `lab/runs/.identity-memory-proof/browser/`.
- Audit re-read milestones 1–5 against store/API, context admission and snapshots,
  shared tool catalog, dispatch gate, consumed-input history, all five native
  implementations and direct browser observations. Identity revision freezes
  existing chats; memory corrections affect fresh recall, tombstones exclude
  forgotten records, and experiment scopes remain isolated. No permissions or
  filesystem access are granted by identity/memory/replies.
- Scope limits: local JSON persistence has one API owner; facts use lexical recall;
  supported owned process replacements establish local resumption only. Native
  Mastra transport buffering is bounded and documented. Inputs cannot undo an
  already dispatched provider action; absolute deadlines still apply during waits.
- Stable guide, architecture and platform notes match delivered behavior. Final
  build/typecheck/doc generation and task-owned diff checks passed. Normal API and
  all five main platform health endpoints returned 200/reachable after loading
  current code. Coherent commits stage only this phase; unrelated Lina changes,
  provider credentials, personal memories and generated local evidence stay out
  of Git. The checklist is moved to completed outside curated Docs.
