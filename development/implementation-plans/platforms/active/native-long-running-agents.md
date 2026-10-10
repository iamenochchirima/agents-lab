# Native long-running agents across the five priority platforms

Status: implementing; execution authorized and goal started 2026-10-10.
Validation: native restart/review/deadline checks passed; larger free-model and final browser acceptance are in progress.
Prepared: 2026-10-10. Baseline commit: `116b670`.

## Goal and expected outcome

Open Temporal, Restate, LangGraph, Mastra or Vercel Workflows, select a model and give the agent a substantial task. It uses the shared tools and skills, completes several dependent operations, waits for exact-action approvals in chat, and continues from retained progress after a supported interruption. Closing the browser does not stop execution. Returning to the conversation shows observed activity and the same pending action or result.

Each platform owns its execution through its native runtime. Common code owns capability discovery, credentials, review records, context policy, admission, evidence and presentation. It must not become a second agent scheduler or a universal model/tool loop.

Success means useful sustained execution with measured recovery boundaries, not identical durability guarantees or a fixed duration. Tasks should be able to span minutes or longer waits without needing artificial work to fill an hour. This is a substantial implementation phase spanning all five adapters, shared continuation and chat, rather than another catalog change.

Research: [native long-running agents](../../../../docs/research/native-long-running-agents.md). Foundation: [completed connected tools and inline approvals](../completed/connected-tool-execution-and-inline-approvals.md).

## Scope and constraints

- Five priority baselines only. Trigger.dev, Inngest, DBOS, Hatchet and AWS remain deferred.
- General agents on backend platforms, with shared extensible MCP/HTTP/managed-stdio capabilities and packaged skills. No business-agent role template, profile selection in chat, provider-specific tool handling, or native filesystem permission.
- Preserve existing run manifests, native references, call receipts, exact approvals and evidence. Historical results retain their implementation/version identity.
- Run and conversation are different: one task remains one Lab run and admitted turn, while its native runtime can execute many steps or restart internally. A follow-up user message remains a new turn. Do not invent a parallel task database merely to rename existing runs.
- Free models for automated acceptance, fresh price observations, bounded calls/output and no paid fallback. Scripted recovery checks and model-driven task results are separate evidence.
- Keep the current local deployment profiles. Hosted deployment, multi-replica operation, arbitrary code deployment during replay, scheduling recurring jobs, subagents and production hardening are outside this phase.
- Do not add every experimental MCP asynchronous-task protocol. Existing synchronous tools work inside native execution steps; unsupported transports/features remain explicit.
- Existing unrelated Lina migration and prototype changes are user-owned. Stage task files explicitly; never stage the entire working tree.
- Save this temporary checklist in `development/implementation-plans/`, not curated Docs. Stable research and resulting user/architecture documentation belong in their existing homes.

## Investigated baseline

These are inspected implementation facts, not new live acceptance results.

| Area | Already implemented | Gap this phase addresses |
| --- | --- | --- |
| Shared capabilities | Immutable run catalog, generated inventories, shared skill loading, late credential resolution, connection authority checks, durable call receipts and exact-action reviews. | Preserve these across longer waits, native reconstruction and growing context; avoid re-resolving an old run against today's catalog. |
| Control plane | `RunService` retains native references, inspects runs, settles terminal context turns and validates review continuation. | Review decision is stored before native delivery, but delivery can fail afterward. Add recoverable delivery and unattended terminal reconciliation. |
| Chat | Historical inline action cards, activity events, refresh reattachment and cancellation plumbing. | Durable progress while away, distinguish approval waiting from execution/recovery/connection failure, and keep cancellation unconfirmed until observed. |
| Temporal | Workflow loop, Activity effects, validated review signal and `condition` wait, heartbeat/lost-outcome handling. | Map task budgets separately from Activity timeouts; publish progress and retain safe restart evidence without duplicating completed calls. |
| Restate | Journaled model/tool operations, revision-specific durable review promises, persistent session object. | Task-level limits/deadlines, progress and extended restart/decision-delivery observation. |
| LangGraph | Graph model/tool nodes, SQLite checkpointer, dedicated approval interrupt and original-call resume. | Local service owns in-process `asyncio` execution. Startup currently marks incomplete active runs unknown; safe checkpoint recovery is not autonomous today. |
| Mastra | Regular SDK Agent, native tool schemas, persisted approval snapshots and original-call approve/decline. | Approval persistence does not establish recovery of arbitrary active model/tool work. Adopt the SDK's durable agent only after a pinned-API compatibility check. |
| Vercel Workflows | Separate durable model/tool steps, native review hooks, local World active-run recovery and native cancellation. | Within-run context compaction, task budget/progress mapping and interrupted-step evidence. Do not rebuild its existing loop. |

Important paths:

- `server/src/control-plane/application/run-service.ts`, `application/evidence-store.ts`, `ports/runner.ts`, `domain/types.ts`, `domain/manifest.ts`.
- `server/src/capabilities/extensions/host.ts`, `integrations/connections.ts`, `reviews/store.ts`, `context/` and skill activation implementations.
- `server/src/platforms/temporal/variants/baseline/workflow.ts` and its runner adapter.
- `server/src/platforms/restate/variants/baseline/workflow.ts` and its runner adapter.
- `server/src/platforms/langgraph/service/{app,store}.py`, `variants/baseline/graph.py`.
- `server/src/platforms/mastra/variants/baseline/agent.ts`, `runner-adapter/mastra-runner.ts`.
- `server/src/platforms/vercel-workflows/variants/baseline/execution/{workflow,model-step,capability-steps}.ts`, `service/platform-service.ts`.
- `apps/web/src/features/platforms/{PlatformChatPage,chatState,InvocationReviewPanel,RunStatusPanel}.tsx` or corresponding `.ts` files.

Current common tool bounds are 32 model rounds and 64 calls maximum; ordinary defaults are much smaller. Mastra has a whole-execution timer; shared native execution configuration defaults to 30 seconds and caps at five minutes. These existing values have different meanings and must not all be raised together.

## Research-informed architecture decisions

### Native ownership and compatibility

| Platform | Planned execution owner | Recovery contract to demonstrate |
| --- | --- | --- |
| Temporal | Existing Workflow + Activities + signals/conditions and native timers. | Replay retains completed Activity results; a lost dispatched outcome remains uncertain. Do not put provider I/O in Workflow code. |
| Restate | Existing workflow/service and session object, `ctx.run`, durable promises and native timeout/timer mechanisms. | Journaled completed results are reused; interrupted unrecorded side effects still need host receipts/provider guarantees. |
| LangGraph | Existing graph/checkpointer, with a platform-local single-owner recovery worker in its FastAPI service. | Reconstruct the admitted request and resume safe saved graph state. This is Lab-local scheduling around LangGraph, not a claimed native distributed orchestration service. |
| Mastra | Preferred native SDK `createDurableAgent` wrapping the baseline Agent, persisted through the existing LibSQL profile. | Recover stored native run state with the same call identities. SDK recovery may repeat work; the host must refuse unresolved-effect replay. |
| Vercel Workflows | Existing `use workflow` loop, `use step` effects, hooks and native timers/local World recovery. | Retained completed steps and original review hook survive service replacement; uncertain external effects remain independently recorded. |

Official mechanisms: [Temporal message passing](https://docs.temporal.io/encyclopedia/workflow-message-passing), [Restate TypeScript documentation](https://docs.restate.dev/develop/ts/overview), [LangGraph durable execution](https://docs.langchain.com/oss/python/langgraph/durable-execution), [Mastra durable agents](https://mastra.ai/docs/harness/durable-agents), [Vercel hooks](https://workflow-sdk.dev/docs/api-reference/workflow/create-hook).

Mastra's installed `@mastra/core@1.66.0` exposes durable-agent generation, recovery and resume APIs. Its types do not include the snapshot predicate shown in current documentation. A focused executable probe is a gate, not a license to copy incompatible examples or silently upgrade dependencies. Keep the existing workflow variant separately identified; wrapping the entire agent in one workflow model step is insufficient for per-step recovery. If the native API cannot retain exact tool identity through recovery, record the concrete failure and revise this decision before claiming durable baseline support.

Do not wrap LangGraph/Mastra in Temporal or Restate just to achieve parity. That would change the composition being measured. Preserve original records when a baseline implementation changes and record the new implementation/runtime mode for subsequent runs.

### Execution policy and bounded work

Add a small admitted execution policy, using existing manifest/platform configuration boundaries. Backward-compatible defaults must preserve old runs. Record limits and actual counters, not just a label such as "long-running".

- Separate per-model timeout, per-tool timeout, task deadline, review expiry and observer request timeout. A stalled browser request is not task cancellation.
- Initial development policy proposal: at most 24 model rounds, 48 dispatched tools and one hour elapsed task time. Approval waits count toward this absolute deadline; review expiry is independently configured and renewable only within the deadline. Values are opt-in until validated, not a blanket replacement for current short-run defaults.
- Use native deadline/timer mechanisms. Persist an absolute deadline at admission; restart must not reset it. Platforms must retain counters and stop before the next dispatch when exhausted.
- Show the safe remaining budget in expandable run details. No extra profile selector or mandatory setup screen; normal platform chat remains the entry point.
- Keep provider retries explicit and bounded. A free-model 429 is retained as availability failure unless a supported retry policy and server-provided delay justify a native delayed retry. Never retry uncertain mutations with a fresh call ID.
- Do not build Temporal Continue-As-New merely because tasks wait a long time. The bounded first policy limits history growth. Record native history pressure; if measured workloads approach the native limit, add a separate verified rollover slice preserving counters/review identity. [Temporal guidance](https://docs.temporal.io/develop/typescript/workflows/continue-as-new)

### Persisted progress, context and capability identity

Native checkpoints own executable state. Common evidence is an inspectable projection, never the authority for regenerating model choices or reconstructing a universal loop.

Retain run/turn identity, native execution/checkpoint identity, ordered model/tool events, counters, latest safe progress, active wait reason, absolute deadline, catalog/skill digests and context revision. Summaries describe observable work and pending actions; do not fabricate percentages or display hidden reasoning.

Prepare budgeted context before every model step, not just initial admission. Compact complete assistant/tool groups through the existing shared policy, with summaries produced and recorded inside native model/step boundaries. Preserve tool-call/result pairing, active skill metadata and immutable instructions. Canonical transcript and prior snapshots remain inspectable. Skill bodies and credentials remain out of public evidence.

Existing runs retain their admitted catalog. Newly connected tools appear on subsequent admissions; do not silently introduce changed schemas into an active native run. Credentials are resolved late through existing authority checks. Token refresh under unchanged authority can continue; revoked/replaced authority stops dispatch honestly instead of widening access or silently reauthorizing an old action.

### Durable decision delivery and unattended projection

Reuse the authoritative review store. Add a durable delivery record tied to run/request/revision/decision/call identity: pending delivery, confirmed native acceptance, or stopped/unconfirmed with safe diagnostic information. Acknowledgement means accepted delivery, not successful mutation.

Write delivery intent before native resume. A bounded startup/background delivery reconciler retries the SAME retained decision through each adapter's idempotent native delivery path. It does not choose tools, regenerate calls or schedule agent reasoning. Each adapter must recognize already-consumed delivery or inspect its native state before declaring success. Preserve revocation, expiry and cancellation checks.

Add bounded unattended inspection/settlement of retained active runs so native completion eventually releases the conversation turn even with no browser polling. Persist/index active identities using the existing evidence boundary; avoid full-history scans on every request. Common observation may update projections, but it cannot replace native execution. Unknown-effect runs stay unresolved and block new mutations until their explicit recovery path is used.

### Cancellation and external effects

Stop requests must prevent subsequent model/tool dispatch and invalidate pending reviews. Report cancellation requested until native state confirms it. Already dispatched external effects are not rolled back by cancellation.

A complete host receipt can return the previous result for the same invocation. A pending receipt means unknown effect, not permission to send again. A provider-specific idempotency/reconciliation adapter can resolve uncertainty where already supported; no generic exactly-once claim is made. MCP cancellation is optional and can be ignored by a server. [MCP cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation)

MCP progress is also optional. Project notifications only if the adapter actually receives them, retaining their call identity; progress is not completion or a checkpoint. This phase must work when tools emit no progress. Experimental async MCP Tasks support is a later adapter milestone. [MCP progress](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress)

## Implementation checklist and commit checkpoints

Order is intentional. Shared contracts precede adapter integration; native recovery precedes any expanded durability claim. Independent adapters can be implemented in parallel, with architecture and integration owned by the primary agent.

### 1. Execution policy, progress and continuation contract

- [x] Inventory actual timeout/counter semantics across the five baselines and record a native mapping table.
- [x] Add the versioned admitted policy and safe progress/wait projection; retain old manifest behavior.
- [x] Persist absolute deadlines and counter interpretation without changing default interactive behavior.
- [x] Define safe recovery eligibility from native checkpoint and host receipt state, including unsafe pending model/tool outcomes.
- [x] Prove the pinned Mastra durable-agent API can persist/recover original calls; record compatibility gaps before migration.

Acceptance: each adapter has an explicit implementation mapping; unsupported recovery is visible, and old runs remain readable.
Validation: one focused contract test covering invalid bounds, backward compatibility and restart-stable deadline; one Mastra compatibility probe. Server typecheck.
Commit: `feat(platforms): define native long-running execution policy`.

### 2. Reliable review delivery and background reconciliation

- [x] Persist decision-delivery intent and attempt/acceptance state without another approval database.
- [x] Reconcile pending delivery on startup and bounded background passes using the original decision identity.
- [x] Reject delivery to cancelled, terminal or stale-revision actions; recheck connection authority before effect dispatch without blocking denial feedback.
- [x] Track active runs and settle terminal sessions without depending on an open browser.
- [x] Expose pending/unconfirmed delivery and native uncertainty safely through existing run/action views.

Acceptance: API loss between decision persistence and native delivery does not lose approval or create another action; native completion settles the original turn while the browser is absent.
Validation: one restart/duplicate-delivery integration case, one cancellation/stale-delivery regression using existing review fixtures. Server typecheck.
Commit: `feat(control-plane): recover native decision delivery and run observation`.

### 3. Temporal and Restate sustained execution

- [x] Apply task deadlines and counters through existing Workflow/Activity and journaled handler boundaries.
- [x] Emit durable progress and native wait identities at completed model/tool boundaries.
- [x] Preserve model/tool identities, review revision and active skills across worker/service replacement.
- [x] Verify native timers/deadlines and idempotent review delivery; preserve existing unknown-outcome behavior.
- [x] Update stale platform semantics documents to match current loops and actual guarantees.

Acceptance: both complete the same multi-step task after a wait and process replacement; completed effects are not repeated.
Validation: extend one existing native acceptance path per platform with a retained review wait and restart; verify effect count independently. Reuse existing heartbeat/unknown receipt checks.
Commits: `feat(temporal): retain sustained task progress and deadlines`; `feat(restate): retain sustained task progress and deadlines`.

### 4. LangGraph safe active-run recovery

- [x] Retain admitted requests, graph/checkpoint identity, deadline and counters for platform-local recovery.
- [x] Implement single-owner local scheduling of recoverable graph runs at service startup, including persisted cancellation.
- [x] Resume saved safe graph state rather than replaying the user prompt or regenerating completed calls.
- [x] Keep effects outside replayed approval nodes. Resolve complete host receipts under the same call identity.
- [x] Leave unresolved dispatched model/tool outcomes in reconciliation-required state; never recover every incomplete run blindly.
- [x] Report recovery eligibility/reason in existing diagnostics and document the local single-process limitation.

Acceptance: a safe interruption resumes from the last graph checkpoint; an uncertain external effect stops visibly; original review interruption remains deliverable.
Validation: targeted Python service/checkpointer restart case plus one unresolved-receipt case. Existing native review tests remain the baseline.
Commit: `feat(langgraph): recover safe retained graph executions`.

### 5. Mastra native durable baseline

- [x] Wrap the existing Agent/tools/model with the verified durable SDK API and existing storage.
- [x] Register capabilities before native recovery; retain durable run IDs and implementation identity.
- [x] Recover eligible runs on startup through SDK methods under one local owner; recheck host receipt and authority before effects.
- [x] Map native durable events, abort/resume and counters to existing evidence/review contracts.
- [x] Preserve exact-action review UX and imported skills; keep the separate workflow composition honestly documented.

Acceptance: native SDK state survives an interruption between steps; original approval resumes its original tool call; an unknown effect is not redispatched.
Validation: one durable-run restart scenario extended to same-call approval, plus pending-effect recovery refusal. No dependency upgrade unless the compatibility gate establishes necessity and documents it.
Commit: `feat(mastra): persist and recover native durable agent runs`.

### 6. Vercel and cross-platform within-run context

- [x] Add budget checks and native compaction steps to the existing Vercel workflow as context grows.
- [x] Verify the other four check context between model rounds; fill concrete gaps using their native effect boundaries.
- [x] Preserve paired tool groups, skill provenance, summary revision and counters after compaction/restart.
- [x] Apply Vercel task deadlines/progress through existing steps/hooks/World recovery; retain model/dispatch retry controls.
- [x] Correct stale retry documentation; retain local World versus hosted deployment distinctions.

Acceptance: a task that crosses a deliberately small context threshold completes with intact call pairing and retained summary state; replay does not create a second summary or mutation effect.
Validation: one controlled compaction/restart case using small context bounds and existing fixtures, plus server typecheck. No large-token spending to reach a threshold.
Commit: `feat(platforms): retain context through sustained native execution`.

### 7. Chat continuity and useful task acceptance

- [ ] Display observed task progress, wait reason, review delivery and restart recovery inside the existing conversation.
- [ ] Keep approvals inline and preserve historical card identity, keyboard focus and scroll position.
- [ ] Reattach after navigation/refresh and temporary API outage without creating a new run or active turn.
- [ ] Show Stop requested versus confirmed cancellation and retained known/unknown effects.
- [ ] Run the same real-model task on all five baselines, retaining original failures and separate corrective attempts.
- [ ] Publish a compact coverage matrix with native mechanism, recovery observation, model task result and limitations.
- [ ] Update stable platform/context/recovery guides and relevant README files; move this plan to completed only when acceptance is established.

Acceptance: a user can leave, return, approve and continue one task; final claims match tool receipts and independently checked state.
Validation: one direct browser path covering leave/return, inline approval and continued task, plus narrow rendering regressions for changed status/cancellation behavior. One free-model task per platform, no model sweep.
Commits: `feat(chat): show durable task progress and continuation`; `docs(platforms): record sustained task acceptance and recovery limits`.

## Minimal acceptance workload and prompts

Create a reusable scenario/experiment using disposable connected records and a standard imported skill. Tools remain ordinary discovered adapters; the scenario controls data, not runtime tool names or model behavior. Independent source A supplies records; source B supplies constraints or reference information. Linear, Memos or another real connector can be an optional example after the generic disposable acceptance path works.

1. Real-model prompt: "Use the connected tools and the available review skill to inspect the six records in the supplied test collection. Check their details against the reference collection. Identify the discrepancies, prepare a concise report, and propose the requested corrections. Ask through tool approvals before changing anything. After each approved change, read the saved record and report what actually changed. Leave everything outside this test collection unchanged."
2. Keep the task suspended beyond the previous short execution window, close/reopen the browser, and replace the owned native worker/service using its retained storage. Approve an exact pending action in chat, then let the original task continue.
3. Deny one proposed change. Verify it was not applied and the task can continue with an accurate report. No model instruction should force a specific tool choice to make acceptance pass.
4. A separate scripted native case interrupts execution at a safe checkpoint between completed steps and verifies no completed mutation is duplicated. This measures runtime recovery independently of free-model decisions.
5. Reuse a controlled post-dispatch lost-acknowledgement case and one cancellation case. They must preserve known effects, prevent later dispatch and report unresolved certainty. Reuse equivalent existing tests instead of adding duplicates per checkbox.
6. A small-context synthetic case forces compaction inside a run. Real-model acceptance need not spend thousands of tokens solely to trigger it.

Use natural multi-step work, not a fixed workflow that decides every action for the model. A fixture delay/restart controls the environment only. Do not inject fabricated UI progress. A 60–120 second retained approval wait plus process restart tests the relevant boundary without an hour-long idle test. This does not prove days-long retention; record the actual elapsed time and restart conditions.

Personal-account writes require an explicitly agreed disposable target and the exact chat action approval. Until then, use connected disposable fixture data. Existing test accounts are not blanket mutation permission.

## Validation and evidence discipline

- Do not run a broad model/model-provider grid, load tests or exhaustive crash permutations. Reuse existing focused native-review, receipt and context tests; add only behavior changed by this phase.
- Use narrow commands first: `pnpm --dir server run typecheck`, relevant `tsx --test` files, and `.venv/bin/python -m pytest` from `server/src/platforms/langgraph` for changed Python service behavior.
- Before final integration acceptance: `pnpm --dir server run build`, `pnpm --dir apps/web run typecheck`, and the affected native/service checks. Run the broader relevant suite only when integration failures or scope justify it.
- Docs-only planning validation is link/path inspection and `pnpm --dir apps/web run generate:docs`; no model calls or service disruption are needed to create this plan.
- Store each actual run's manifest, model/pricing observation, catalogs/skill digests, events, trajectory, metrics, results, native references and effect observations under the existing run/evidence conventions.
- Record interruption timestamp, affected owned process, storage retained, checkpoint/call identity before and after, native recovery behavior, observer outage and elapsed wait.
- Distinguish native engine status from agent outcome and effect certainty. Do not turn an engine's successful termination into a successful task verdict.
- Retain original failures, rate limits and model omissions. Corrective follow-ups have their own scope and verdict; they do not overwrite the initial trial.
- Commit each coherent verified chunk with its tests/docs. Inspect the staged diff and record commit IDs here during execution. Do not create a commit for every checkbox and do not bundle all five adapters into one giant commit.

## Definition of done

- [ ] All five baselines execute the multi-step scenario using native execution and the shared capabilities without frontend profile selection.
- [ ] Completed work and active review identity persist through the tested native replacement; unsafe outcomes are visibly unresolved.
- [ ] A retained decision survives API delivery interruption and duplicate delivery without a second external mutation.
- [ ] Browser absence does not own execution or prevent eventual context-turn settlement.
- [ ] Context growth is bounded inside the run, preserving tool pairing and skill provenance.
- [ ] Deadlines/counters remain stable across restart and Stop prevents later dispatch while preserving prior effects.
- [ ] Actual native and free-model observations are inspectable; model failures remain failures rather than being hidden by scripted success.
- [ ] Documentation describes each platform's measured recovery limits, installed API compatibility and local infrastructure requirements.
- [ ] Focused commits are recorded, unrelated changes preserved and temporary credentials/artifacts excluded.

## Current position and open questions

Current position: native implementation milestones 1–6 are complete. The five-platform real-model task and direct browser acceptance remain in progress. The plan remains active until those observations are recorded.

Native checks are recorded below. Free-model trials use isolated connected records, reference data and an imported skill with retained wait/restart controls.

Measured limits: LangGraph recovery is locally single-owned and refuses uncertain dispatch. Mastra active recovery conservatively refuses external-dispatch barriers; exact suspended review resumes remain supported after prior reads. Its pinned SDK requires the documented public snapshot-pruning compatibility workaround. Vercel results establish local World behavior, not hosted deployment guarantees. One hung adapter inspection can stall the common non-overlapping observation pass; broader supervision remains deferred.

## Execution evidence ledger

- Shared policy admission: focused contract check passed; server typecheck passed. Sustained requests retain an absolute deadline and model timeout; legacy manifests have no new execution policy. Native enforcement is being integrated independently.

- Retained continuation: 26 focused existing/new checks passed, including replacement control-plane delivery with the same call/decision, cancelled delivery refusal and unattended conversation settlement. Server typecheck passed. Native adapter restart acceptance remains separate work.

### Implemented native mapping

| Platform | Deadline and progress | Recovery owner |
| --- | --- | --- |
| Temporal | Absolute Workflow deadline, bounded Activities and review conditions, retained round/effect counters. | Native replay of completed Activities and original review signal. |
| Restate | Journaled rounds, durable review timeout and bounded I/O inside `ctx.run`. | Native journal and original durable promise. |
| LangGraph | Persisted deadline/counters and waiting deadline watcher. | Local single owner of eligible SQLite graph checkpoints. |
| Mastra | DurableAgent storage/counters and native cancellation on waiting deadline. | SDK recovery with a local ownership lock and conservative dispatch barrier. |
| Vercel Workflows | Native bounded steps, deadline/hook race and retained compaction/progress. | Local World durable steps and hooks. |

### Verified implementation commits

- `e024426`: admitted versioned execution policy; focused contract and server typecheck.
- `ac7a109`: retained review delivery and unattended settlement; 26 focused checks.
- `c990aa7`: Temporal native deadlines/progress and common within-round context projection.
- `f5eccb5`: Restate native deadlines/progress/compaction. Temporal/Restate native acceptance: 12 checks passed, including wait, owned process replacement, denial/cancel, and zero-effect deadline expiry. Proof: `lab/runs/.review-proof/native-review-e42f7c09-06ab-42dc-803d-fb4dee04049b/summary.json`; separate 60-second wait proof: `native-review-4614bb0f-6983-40e6-8d4e-a7487bdb1dba`.
- `5ff8187`, `9339023`, `5514481`: LangGraph safe checkpoint recovery, inspectable eligibility and suspended/restarted deadline checks. Targeted native, Python and adapter checks passed; unknown effects refuse recovery.
- `4a54e66`, `c08cab8`: Mastra DurableAgent and native waiting deadlines; 48 suite checks, five additional owner/recovery checks and seven sustained native review checks passed. Proof: `lab/runs/.review-proof/native-review-61599ffa-5947-4a1b-8219-396194c9a448/summary.json`. Failed probes retained separately.
- `f13a343`, `0eec01f`: complete-tool-group compaction and Vercel native retained steps/deadlines. Controlled compaction/restart retains one summary and two mutation effects.
- `24d31b6`, `b42fb53`: sustained-task chat option/progress and supported-mode admission. Focused frontend/control-plane checks passed.
- `81d33a2`, `004ebbe`: six-record connected scenario, disposable source/reference fixtures, imported skill and owned-restart evidence contract. Seven focused checks passed.
- Direct browser: Temporal sustained free-model run `def4816a-10c8-4f5b-b24c-060bddd6fee6` selected the calculator and observed 42 from 17 + 25; two model rounds, one completed tool and the admitted deadline. This is a UI smoke observation, not the larger task verdict.
