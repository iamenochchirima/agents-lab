# Platforms

The platform workspace is the main place to prepare one concrete agent run. Each
platform uses `platformCatalog.ts` rather than page-local data.

`PlatformWorkspaceLayout.tsx` owns the platform rail and resolves the selected platform
once. `PlatformRunnerPage.tsx` owns the task surface and compact run controls. It
receives the selected platform through outlet context. `CompareRunModal.tsx` owns the
in-context multi-platform selection and starts one generic run per selected baseline.
Each result is polled through the same run API as a single-platform run.

`platformCatalog.ts` is the source of truth for which baselines are ready to appear in
the run and compare flows. `platformApi.ts` is the only browser module that knows the
server endpoints. It checks the selected platform through the platform-specific health
endpoint rather than requiring every optional platform service to be available.
`RunStatusPanel.tsx` renders the server-derived lifecycle and evidence summary. The
browser never connects to a platform service or reads the local run directory.
Platform-native execution references are displayed through the generic
`executionReference` field rather than a platform-specific response shape. The shared
details disclosure may show safe platform-native identity when it is useful for
inspection, such as a LangGraph thread and graph or a Restate workflow and invocation.
The selected scenario, server profile, infrastructure, and experiment IDs are retained
in the run manifest so the UI configuration is inspectable and reproducible.

Run responses include a projection state. A stale projection is rendered as a
small status notice and retains the last server-readable run state; the browser
does not manufacture a terminal answer while the platform or evidence store is
unavailable.

`PlatformChatPage.tsx` is the browser-first conversation surface at
`/platforms/<platform>/chat`. It uses the same run API as the controlled run form,
keeps messages visible while a turn is polled, and exposes run activity and context
details through progressive disclosure. The current Temporal, Restate, LangGraph, and
Mastra baseline adapters reuse the server-owned session ID across turns and restore the
model recorded by the active run. Once a session exists, the model picker is fixed for
the conversation; use New chat before switching models. Chat does not concatenate
browser history into prompts as a substitute for the platform adapter's real context
handling.

## Compare

Compare creates one ordinary run per selected platform. The browser sends the same task,
model, scenario, experiment, and deny-by-default calculator capability to every member,
but gives each member a new session ID, client-turn ID, Lab run ID, native execution
identity, and evidence directory. An opaque `comparisonId` correlates the members; it
is not a session or evidence identity.

Connectivity is checked per platform before dispatch. An unavailable member renders an
unavailable row and is not presented as a completed run. A failed, cancelled, or
reconciliation-required member remains visible beside successful peers. Closing and
reopening Compare clears the previous rows, and stale requests are ignored after the
modal generation changes. Native details remain in each run's progressive disclosure.

The browser never fabricates output, token counts, health, or terminal success. When
token information is unavailable, the context projection says that its quality is
unknown rather than displaying a false percentage.

## Chat approvals

Chat retains each run separately and attaches server-owned action reviews to that
run's assistant message. Tool events order the cards by their original call ID;
results appear after the corresponding review, before the final assistant reply.
The model's Markdown cannot create actionable controls.

The conversation controller reads exact reviews through `/api/runs/:runId/actions`.
It uses one polling timer for the conversation and stops requests when the user
changes platform or starts a new chat. Completed runs receive a final review read.
A reopened session loads its retained turns through
`/api/sessions/:sessionId/runs?limit=100`; Load earlier turns requests the bounded
history cursor. History is authoritative on the server, rather than a second copy
of approval records embedded in chat messages or browser storage.

Approve and Deny submit a stable decision ID bound to the recorded request,
revision and argument digest. During submission, all conflicting buttons are
blocked. If a response fails, the controller refetches persisted reviews. If the
outcome remains unconfirmed, Retry retained decision submits the same identity.
An approved suspended action offers Continue reviewed action. Expired reviews
require Request fresh review; the returned revision supplies a new card identity.
Terminal runs disable decisions, and uncertain effects link to evidence without
an automatic mutation retry. Approval records establish permission; tool events
and receipts establish observed results.

Older tool-grant policy appears as broader tool access in the assistant turn,
before admission. Its decision remains in the admitted run manifest. These grants
allow tool access and do not approve exact arguments. The Mastra workflow pause
also has a separate inline workflow control. The configuration sidebar provides
inspection and model selection without approval controls.

While a run waits, Chat displays Waiting for approval, allows Stop, and keeps the
composer draft editable. Send remains disabled until the active run finishes.
Cards use bounded server-redacted arguments and native keyboard buttons. Refresh
and polling update state without moving focus or forcing the scroll position.

Focused checks are `chatState.test.ts`, `connectedToolState.test.ts` and
`inlineApprovals.test.ts`. The existing browser fixture in
`tests/browser/platform-chat.browser.test.mjs` covers inline grants, workflow
continuation, exact approval and denial, refresh, and retained history. Fixture
results do not establish provider effects or native recovery guarantees.

Exact review cards optionally show the admitted tool's display name, short
plain-text description and configured risk. Details holds source ID/version,
review revision, call ID, and the evidence link. The control
plane resolves these fields only from the run's retained catalog and matching
source digest. It never reads live discovery or connection settings to decorate
an existing request. Explicit top-level schema titles label arguments; fields
without titles retain their recorded names. Older snapshots keep the generic
name/argument fallback. Presentation fields do not participate in a decision's
authorization identity and do not establish whether an effect succeeded.

## Failure explanations

`RunFailureDetails.tsx` displays actionable guidance with a bounded phase, code
and category chain under Failure details. `failureExplanation.ts` derives the
chain from known adapter error codes. HTTP 429 explains provider capacity; action
review preparation failure explains the pre-dispatch boundary; unresolved model
or tool acknowledgement asks for evidence inspection before another request.
Review preparation does not identify whether the host connection or policy
failed, because the recorded code does not distinguish them.

The chain preserves the distinction between native execution status and the
agent result. A native workflow can complete with a failed model request. Tool
response validity and confirmed effects remain separate in action cards. The
failure explanation does not establish a rollback or authorize another action.

This is derived inspection, not a reconstructed exception stack. It excludes
arbitrary error messages, nested causes, response bodies, task prompts and
connection settings. Unknown codes receive a generic explanation rather than an
invented cause. Only known native status values appear in this summary; the raw
native record remains available in retained evidence. `failureExplanation.test.tsx`
checks the recorded boundaries, native completion with agent failure, and
redaction using synthetic secrets and private paths.

Chat uses a bounded grid column and permits message text to wrap within the bubble. This keeps long tool names, identifiers and review arguments inside the conversation on narrow screens. The connected-tool readiness guide distinguishes browser observations from native execution evidence.
