# Anesu browser use

**Created:** 2026-09-23
**Last updated:** 2026-09-25
**Status:** Active, implementation in progress
**Owner:** Anesu standalone product

## Goal and scope

Make the existing Cua and Jev browser path usable for ordinary web tasks from
Anesu chat. A user runs `pnpm run chat` and asks Anesu to search, visit a public
website, follow results and links across sites, read pages, fill forms, or use
page controls. The user does not need to name a tool, manage origins or browser
sessions, or write a special prompt. Anesu reports what it observed, including
when an action's effect cannot be verified.

This is general browser use, not a scripted example or a site-specific feature.
The implementation builds on the existing isolated Chrome, Cua browser
adapter, task grant, and current semantic page references. It does not replace
them with Playwright, desktop clicks on a browser window, screenshots sent to
Jev, or another browser stack. Browser decisions belong to the normal
conversation model; native Jev behavior is outside this plan.

The fixed checked-in website list must not decide which public site a user may
start with. Anesu validates public HTTPS destinations and gives each Cua session
an exact task-owned manifest. The pinned manifest is immutable: when the model
supplies a validated destination on a new public HTTPS origin, Anesu can end the
old session and start a new one whose exact manifest includes only origins
encountered in that approved task. It discards old tab references during the
handoff. Live TUI runs prove one model-selected cross-origin navigation and one
redirect handoff. In a separate link-following task, Cua marked the click
ambiguous while refusing the out-of-origin page read. The model recovered from
a fresh exact bind, opened the validated destination in a new exact-origin
session, and answered from fresh page evidence. The turn completed, while the
durable click record remained ambiguous; later evidence did not rewrite the
earlier action as verified. This proves that recovery path, not every
cross-origin site or interaction. Existing checks against private, local, and
metadata destinations remain unless the user is using an explicitly configured
local development profile.

Native application control, visible cursor work, and visual fallback are
separate work. Personal browser-profile attachment is not required for this
isolated-browser path and must not be claimed as supported here. Common browser
file upload and download behavior belongs in this plan, subject to explicit
file and destination boundaries.

## Agent decision boundary

The browser path must be an agent loop, not a workflow inferred from prompt
phrases. The Anesu conversation model receives the user's goal, available
browser tools, and each tool result. It decides whether to use a tool, which
operation and arguments to send, whether to inspect again, and when to answer or
ask the user. A tool result or refusal returns to that model so it can continue
or change course.

Anesu's runtime owns the tool schemas and execution boundary. It validates
arguments, active Cua session/tab and fresh references, destination policy,
approval requirements, resource limits, cancellation, and uncertain side
effects. It records what happened and returns useful evidence. It does not
derive a required action sequence or declare a user goal complete from regexes
over the prompt.

Implementation rules:

- Expose the existing typed Cua browser capabilities through the normal model
  tool loop. Keep the interface generic and capability-based. Do not expose raw
  driver calls, arbitrary scripts, or a second browser backend.
- Do not force or synthesize a browser/computer tool call because prompt text
  matches a verb pattern. Let the model choose from the tools actually
  available. A deterministic route is acceptable only for a distinct,
  tested product category, and it must not override a contrary model decision.
- Treat permitted actions as a ceiling, not a required checklist. Do not make a
  task's success depend on executing every action it was allowed to use.
- Keep ordinary same-origin reading, observed-link following, and scrolling
  inside the user-approved task without a prompt for every click. Bind each
  action to current Cua state. Require a fresh approval for text entry, key
  presses, buttons or other controls, uploads, and dialogs; show the actual
  observed target and origin rather than guessing risk from prompt keywords.
  A new public HTTPS destination uses a fresh exact-origin Cua session; do not
  widen an existing manifest or infer a destination from an ambiguous refusal.
  Live link-click and redirect continuation are recorded in the acceptance
  evidence below; an ambiguous click remains ambiguous even when later fresh
  destination evidence lets the model complete the user's task.
- Return typed failures and current observations to the model when safe to
  continue. Never convert a refusal into success or replay an action whose
  effect is uncertain.
- Use deterministic postcondition checks when the task requires a precise
  external fact, especially after consequential mutations. Ordinary reading
  tasks may be answered from fresh page evidence without a bespoke verifier for
  every wording. The agent must not claim facts absent from its observation.
- Prefer direct model-selected calls to the typed Cua browser tools. Keep Jev
  in the browser path only if the trace shows a useful, supported control
  choice that the normal model cannot perform well, and make that role explicit
  rather than running a hidden second planner. The normal agent model owns task
  intent and continuation.

These rules follow the model-directed loop described by
[Anthropic](https://www.anthropic.com/engineering/building-effective-agents)
and the tool/result loop in the
[OpenAI Agents SDK](https://openai.github.io/openai-agents-python/running_agents/).
For computer use, compare the generic tool and evidence handling in
[Hermes](https://github.com/NousResearch/hermes-agent/blob/main/tools/computer_use/tool.py)
with [OpenClaw's Cua computer-use contract](https://docs.openclaw.ai/nodes/computer-use).
Those implementations inform the division of responsibility; they do not prove
that a specific Cua permission transition works in Anesu.
The source-level comparison and review checklist are recorded in the
[agent-harness decision-making research note](../../../../docs/research/agent-harness-decision-making.md).

### Questions before each checklist item

Before starting an unchecked item, answer these questions. Keep the answers
brief; record them in the plan when they change the design or expose a risk.

1. What user-visible result or observed failure does this item address, and is
   it the smallest useful next step?
2. What do the relevant Hermes/OpenClaw source and pinned Cua contract actually
   show? Which parts are evidence, and which are still assumptions?
3. Who owns the decision? The conversation model chooses intent, target, and
   next action from current tool results. The runtime enforces tool schemas,
   Cua identity and freshness, destination policy, approval, resource limits,
   cancellation, persistence, and honest outcome reporting.
4. Is this the simplest implementation that delivers the result? Am I adding
   another planner, a new abstraction used only once, or branches for particular
   prompts, sites, applications, or action sequences? What can be removed or
   reused instead? Keep extra machinery only when a concrete failure, security
   boundary, or reference implementation requires it.
5. Which existing code must change or go, and which shared Cua safety or native
   desktop behavior must remain? Have the callers of any proposed removal been
   checked?
6. What focused test proves the model-selected tool call runs, its result
   returns to the model, and the model controls continuation? What short real
   `pnpm run chat` task proves the user-visible path?
7. What happens on refusal, stale state, cancellation, or an uncertain side
   effect? If Cua or the provider does not support the operation, will I record
   the limitation instead of inventing a heuristic or alternate backend?
8. What is the narrowest useful validation for this item? Am I adding a broad
   test matrix before a real failure or product need calls for it?

If an item has no clear user outcome, duplicates a decision the model can make,
or needs unsupported Cua behavior, stop and revise or defer that item before
coding. Do not mark it complete until its acceptance evidence passes. Tests
should prove tool/result behavior and real boundaries, not one fixed action
sequence for ordinary prompts.

## Current path changes and removals

The first trace must confirm each seam before editing it. The current code
inspection identifies this browser-specific work:

| Current path | Change for browser use | Keep |
| --- | --- | --- |
| `runtime/turn.ts` can require the `computer` tool via `requiredComputerTool` and synthesize `computerIntentFallback` from wording classified as explicit computer use. | Remove the forced/synthetic route for browser requests. Let the conversation model choose an exposed browser tool. Separate browser handling from native admission before changing shared turn behavior. | Normal tool-call execution, tool-result round trips, deadlines, cancellation, and native computer routing in this slice. |
| `computer/routing.ts` uses `routeComputerRequest()` to infer a surface from goal text; `computer/router.ts` compiles that route and has a special `mixedTaskParts()` browser-to-app path. | Stop using those prompt classifiers to choose browser actions or force a browser workflow. Keep native and mixed-surface behavior unchanged unless the trace proves a shared seam must move; cross-surface orchestration is not a reason to expand this browser slice. | Native desktop routing and any verified callers outside browser use. |
| `computer/task.ts` has `compileComputerTask()` reject browser goals without a URL or a code-derived verifier. `actionClasses()` infers permitted actions from wording; remote submission is limited to local acceptance origins and downloads are rejected. | Remove the URL and generic-verifier requirements for ordinary search/read/navigation. Replace goal-derived action checklists with operation schemas and per-call validation. Replace the local-only mutation gate with approval of the actual consequential operation and target; support transfers only through bounded Cua operations and safe local paths. | Task/run identity, expiry, action/resource ceilings, origin and private-network checks, approval records, and exact postcondition checks where a side effect needs proof. |
| `computer/runner.ts` runs a second browser decision loop, calls Jev or the traditional selector for each candidate, derives some operation values from the original prompt, and `browserTaskActionsCompleted()` treats every permitted action as required progress. | Move browser operation choice and continuation to the normal conversation model. Remove the nested browser planner, prompt-derived operation values, and allowed-actions progress check after the replacement path passes integration tests. Rewrite or delete tests that preserve those old rules. | The Cua browser adapter, current-state/reference validation, typed tool results, action evidence, risk-matched approval, bounded execution, cancellation, and no-replay handling. |
| `computer/verification.ts` derives browser completion conditions from prompt wording. | Do not require a bespoke verifier for ordinary informational reads. Use fresh page evidence for answers, and retain explicit postcondition checks for consequential actions or exact facts that must be proved. | Verification code that enforces those concrete postconditions. |

Jev is not to remain as an invisible second browser planner. During the trace,
decide whether its bounded control-choice capability is useful after the normal
model loop is in place. If the conversation model can call the typed Cua tools
directly from the returned observation, remove Jev from the browser decision
path; do not keep two selectors for the same step. Do not remove Jev support
used by native work as part of this browser plan.

This is a browser-path refactor, not a rewrite of Anesu's safety layer. Do not
remove Cua identity checks, destination validation, approval for consequential
operations, output/resource bounds, run records, or failure handling to make
the model loop simpler. Do not delete shared code until its remaining native or
other callers have been checked.

## What will be implemented

1. **Model-directed browser use.** The normal conversation model can choose
   browser tools from the real tool inventory for an ordinary request. Search
   works without the user supplying a URL, using a documented default provider
   that can be changed. The model sees results and decides whether to follow a
   link, inspect more, answer, or clarify. Page content is untrusted and cannot
   expand the user's task or the runtime's permission envelope.
2. **Task-scoped browser access.** Anesu canonicalizes each public HTTP(S)
   destination, validates its DNS destination using the existing browser
   policy, and gives Cua an exact per-session manifest. This is an internal
   security mechanism, not a website allow-list UX rule. The runtime's tool,
   profile, file, and desktop limits stay intact. Because the pinned Cua
   manifest is immutable, an explicit model-selected URL on a new public HTTPS
   origin gets a fresh trusted session containing only origins already admitted
   in this task plus that validated origin. Link/redirect recovery remains
   conditional on Cua exposing a destination Anesu can validate; no guessed or
   wildcard origin is admitted.
3. **Ordinary browsing.** Through Cua's isolated Chrome and typed browser
   tools, Anesu opens pages, reads semantic content, follows links and search
   results, and uses supported controls such as buttons, text fields, and
   forms. Each result returns to the model loop. The model chooses the next
   operation from current Cua state. It cannot invent a stale reference or
   bypass destination validation. Anesu refreshes observations after state
   changes and rejects stale references before dispatch.
4. **Cross-origin continuation.** When the model has an exact destination from
   the user or current page state, Anesu validates it and can continue the same
   approved public-web task through a fresh Cua session with an exact manifest.
   Old page references become stale. If a Cua refusal hides the destination, or
   a redirect cannot be re-established through that supported session boundary,
   return the refusal rather than guessing. Do not widen the manifest to all
   sites, silently switch automation backends, or claim a failed navigation
   succeeded.
5. **Approvals and results.** An initial task grant covers same-origin reading,
   observed-link clicks, and bounded scrolling. Typing, key presses, buttons and
   other controls, dialogs, and file transfers require fresh approval for the
   exact operation, observed target, and origin. No action-level prompt can be
   upgraded to blanket task approval. Approved file transfers use bounded
   paths and sizes. Fresh page evidence supports completion claims; an action
   acknowledgement or model narration alone does not. Cancellation and
   uncertain effects keep the existing no-replay behavior.
6. **TUI and documentation.** The TUI shows the current site, action, approval,
   outcome, and actionable error without leaking raw Cua references. The
   browser guide explains the normal `pnpm run chat` path, supported actions,
   approval boundaries, and known limits.

## Why this path is plausible, and what remains to prove

The Cua browser adapter owns the browser target, tabs, semantic snapshots, and
typed operations. Browser tools now run directly in the normal conversation
model/tool loop: the model sees each result and chooses whether to inspect,
act, or answer. The browser-only nested selector path is no longer the
production decision-maker. The pinned `@trycua/cua-driver` is `0.28.2`, and
its task-bound `createTrustedSession` contract accepts one immutable capability
manifest.

Live TUI evidence (2026-09-23): with the configured free OpenRouter model,
Anesu opened `https://example.org`, read the fresh Cua snapshot, and returned
the observed heading “Example Domain.” A separate run opened
`https://httpbin.org/links/3/0`; the model selected an observed same-origin
numbered link, received the next snapshot, and reported
`https://httpbin.org/links/3/1`. Both went through the real TUI, normal model
loop, isolated Chrome, and Cua. A different `httpbin.org` path that led to
another origin was refused by the immutable manifest. An earlier
`wikipedia.org` → `www.wikipedia.org` redirect failed the same way.

The pinned Cua API exposes no in-session origin-manifest mutation. Anesu can
replace the session once it has an exact, URL-policy-validated destination and
preserve only origins encountered within the approved task. After a scope
refusal, it now asks Cua to re-bind the exact prepared window and returns a
validated public HTTPS address for the model to consider; it never navigates or
replays input automatically. A live TUI run has verified one model-directed
`www.ubuntu.com` → `ubuntu.com` redirect continuation. Do not add wildcard origins, drop the browser resource boundary,
switch to desktop input, or describe a refusal as success. URL-less search is
implemented through the model-callable `browser_search`; live result use remains
unproven. No estimate guarantees an upstream Cua or provider change.

## Baseline

- Verified behavior: model/tool round-trip and next-turn continuation are
  covered through the real TUI harness. Real TUI runs with the free OpenRouter
  model prove open/read on `example.org` and model-selected same-origin link
  following on `httpbin.org/links/3/0`. A real TUI task also filled the
  observed Customer name field on `httpbin.org/forms/post`, captured a fresh
  Cua snapshot afterward, and reported the exact entered value without
  submitting the form.
- Known gaps: one live Bing search reached an official Python tutorial and
  returned page evidence; DuckDuckGo previously returned no semantic results and
  Google returned a CAPTCHA. Other providers and queries may still be blocked.
  The example.org → IANA cross-origin link reached fresh destination content
  after Cua returned an ambiguous click; the turn completed from the fresh
  destination evidence while the action record stayed ambiguous. Live multi-tab
  selection and downloads remain open. Downloads are implemented by Cua 0.28.2,
  but the public TypeScript `callTool` path strips the private MCP-host approval
  evidence that Cua requires. Text entry, keys, controls, and uploads keep their
  exact action approval. The task action budget is 8 by default, configurable
  within the existing 1–32 bound.
- A real same-origin follow-up previously failed after 10 minutes 36 seconds
  idle because Cua's trusted session expired before Anesu's 30-minute limit.
  The adapter now aligns Cua's TTLs with Anesu's 30-minute session. A later real
  TUI follow-up after 11m02.754s reused the same session and returned fresh
  `example.org` page evidence, closing that acceptance item.
- Git state: branch `main`, baseline `ae1ad06`; the worktree contains
  concurrent Anesu changes. Preserve them and only touch files required by
  this plan.
- Validation after implementation: `pnpm --dir anesu test`,
  `pnpm --dir anesu run typecheck`, and `pnpm --dir anesu run build`, followed
  by the focused TUI acceptances below. A green adapter test alone is not live
  browser acceptance.

## Definition of done

- [x] A real TUI request is handled by the normal model/tool loop. The model
      chooses a browser operation, receives fresh Cua state, and decides
      whether to continue, clarify, or answer. No prompt regex synthesizes the
      tool call or declares completion.
- [x] A real TUI search opens a result chosen from the current results page,
      continues to its public site, and answers from fresh content without
      asking the user to configure a search engine or approve each origin. One
      live Bing run opened the observed Python tutorial result and read the
      “5.1.3. List Comprehensions” section. This proves one provider/query path.
- [x] A real TUI task fills a current text field with the value intended by the
      user, verifies it from a fresh semantic snapshot, and does not submit the
      form unless submission was requested and approved.
- [x] Generic form controls beyond text entry are covered by the separate
      [browser form-controls plan](anesu-browser-form-controls.md): a checkbox,
      custom dropdown, and native date input passed a natural-language fill-only
      TUI run with fresh-state confirmation; the slice is committed as
      `9435485`. Native `<select>` activation and
      date-picker navigation remain unavailable on the current Ubuntu/Cua
      route; radio controls and multiple date fields were not live-tested. The
      text-field acceptance above is not the evidence for those controls.
- [x] On a user-named public site, a real TUI request follows a link and uses
      a supported page control through current Cua references, then reports
      the observed result or an explicit unknown outcome.
- [x] A real cross-origin link, redirect, and follow-up finish with an honest
      terminal status through Cua permission transitions, without stale refs or
      repeated origin prompts. Unrelated origins are never granted
      preemptively. One redirect and one model-selected cross-origin navigation
      are live-proven. In the IANA link run, the turn completed from a fresh
      destination read while the click remained durably `ambiguous`; later
      evidence did not rewrite the click as verified.
- [x] Two unrelated public sites work in separate tasks without permission,
      tab, or session identity leaking between them. Same-origin follow-ups reuse
      the active isolated session; a separate task for another origin receives a
      fresh Cua session bound to that origin.
- [x] A browser explicitly left open for a follow-up remains usable after the
      former 10-minute Cua idle limit. A real TUI session remained open for
      11m02.754s; the next user turn reused it, took a fresh snapshot of
      `example.org`, and answered `Example Domain`. The adapter configures Cua's
      idle TTL to match Anesu's 30-minute managed session.
- [x] Same-origin reading, observed-link navigation, and bounded scrolling stay
      within the approved task grant. Text entry, buttons and other controls,
      dialogs, and file transfers show the exact operation, target, and origin
      for fresh approval. Cross-origin navigation uses a new exact-manifest
      session for a validated public HTTPS destination; live link and redirect
      continuation have the bounded evidence recorded above.
- [x] A real TUI task assigns an approved local file to a current file input,
      then inspects a fresh snapshot to verify the selected filename without
      submitting the form.
- [ ] Download a file into an approved local destination. Cua 0.28.2 provides
      `browser_download`, but it requires private approval evidence injected by
      a trusted MCP host. Anesu's public TypeScript SDK call strips that field;
      do not synthesize it. Use a supported trusted-host route and map the
      resulting file into Anesu's managed artifact store before enabling it.
- [x] A contributor can reproduce the supported behavior with `pnpm run chat`
      and ordinary prompts. Documentation says what was live-proven and what
      remains unsupported.
- [x] Recording-provider coverage proves a model-selected browser call is
      executed, its result returns to the model, and the next model decision
      controls continuation. No synthetic call is created when the model does
      not choose the browser tool.
- [x] The production browser path no longer contains a second goal-planning
      loop or an allowed-actions-as-required-progress check. Any retired
      browser-only helpers and tests are removed or rewritten; native callers
      and the Cua safety boundary remain intact.

## Implementation order and early checkpoints

### 1. Put browser decisions in the normal agent loop — complete

- [x] Trace one browser request through the TUI, `runTurn`, tool registry,
      Cua adapter, and following model request. Record which layer currently
      chooses the route, operation, arguments, and completion.
- [x] Use the change/removal map above to identify browser-only versus shared
      code and its remaining native callers before deleting or moving anything.
- [x] Compare the exact model/tool/result loop with the cited Hermes and
      OpenClaw source before changing the boundary. Reuse the existing Cua
      adapter; do not add a second browser runtime or task-planning framework.
- [x] Expose existing typed Cua browser operations through the normal model
      tool loop. Return each operation's observation or typed refusal to the
      same model so it can choose the next step.
- [x] Remove prompt-regex forcing and synthetic browser/computer tool calls.
      Keep deterministic routing only where it protects a specific, tested
      product boundary and cannot override the model's choice.
- [x] Retire the browser runner's nested Jev/traditional action-selection loop
      in favor of model-selected typed browser tool calls. Remove Jev from the
      browser decision path if direct tool calls cover the same choice. Keep it
      only if the trace demonstrates a distinct useful role that complements
      rather than suppresses the conversation model. Leave native Jev behavior
      alone.
- [x] Separate permission from progress. Remove any condition that requires
      all allowed actions to occur. Ordinary read/search tasks must not require
      a supplied URL or a bespoke verifier when fresh page evidence is enough.
- [x] Add focused `runTurn`/registry tests for model-selected tool use,
      tool-result round-tripping, follow-up model choice, and no synthetic call
      when the model declines or chooses another available tool. Retire or
      rewrite browser tests that assert the old forced route, fixed action
      sequence, or prompt-derived completion rule; retain tests for genuine
      Cua and approval boundaries.

**Checkpoint passed:** One ordinary browser request has been proven through the complete
model → Cua tool → observation → model loop before adding more task rules. The
model must choose from what it actually observed. A direct adapter test or a
runner completing a fixed goal does not pass this checkpoint.

### 2. Prove the Cua permission contract

- [x] Exercise the pinned SDK's trusted browser session with a task-owned
      manifest for an origin absent from the runtime's base manifest. Confirm
      that the same session refuses a different origin and cannot gain desktop
      tools or a personal profile.
- [x] Confirm the trusted session's bounded lifecycle calls `startSession`,
      `endSession`, and `close`, and inspect actual refusal codes rather than
      relying only on declarations.
- [x] Confirm the prepared Chrome lifecycle under this per-task manifest in the
      real TUI: an unlisted public origin opened and produced a fresh semantic
      observation. The requested heading itself was not verified.
- [x] Prove navigation between origins can preserve the same user task through
      live link/redirect acceptance. On 2026-09-24, the real TUI handled both
      the `www.ubuntu.com` → `ubuntu.com` redirect and an observed IANA link
      from example.org. For the link, it rebound the exact browser window,
      opened the validated destination in a new origin-scoped Cua session, and
      answered from a fresh destination snapshot; the original click remained
      durably ambiguous and was not replayed.

**Checkpoint passed:** A fresh immutable session is the supported mechanism
for a validated public HTTPS destination. The live link run proves continuation
from an observed destination, not that the ambiguous click itself succeeded.
Do not build around an unavailable destination signal or permission mechanism.

### 3. Make arbitrary public sites work through the agent loop

- [x] Replace startup-wide origin admission in the Cua adapter with a
      task-scoped manifest for the exact public destination. Preserve the
      existing URL policy, task approval, Cua browser ownership, and cleanup.
- [x] Route a normal open-and-read request through the model-selected browser
      tool to the isolated browser and return the requested fact from a fresh
semantic observation. A live page observation without the requested fact
is not acceptance.
- [x] Run this through the normal agent loop against one user-named public
      site outside the old list before expanding action coverage.

**Acceptance evidence:** On 2026-09-23, `pnpm run chat` opened
`https://example.org`; the normal model selected browser tools and answered
“Example Domain” from fresh Cua state. This passes the open/read checkpoint.
A later live Bing search also completed one Python documentation task from fresh
page evidence. Search-provider reliability and broader cross-origin site
coverage remain open questions.

### 4. General interaction and origin changes

- [x] Let the agent choose links and supported controls from current typed Cua
      references. Re-observe after actions and reject stale refs in the host.
- [x] Implement model-selected public HTTPS URL handoff without mutating the
      immutable Cua manifest: validate the destination, consume one bounded
      navigation action, close the old task session, and start a new Cua
      session whose exact origin list is the set already admitted in this task
      plus the destination. Clear prior refs and revalidate the resulting URL
      before input. Browser-tool tests cover the handoff and HTTP refusal; a
      pinned Cua SDK contract test confirms multiple listed origins are
      accepted while an unlisted origin remains denied.
- [x] Prove in the live TUI that a cross-origin redirect can continue through
      the supported handoff. On 2026-09-24, `www.ubuntu.com` redirected to
      `ubuntu.com`; Cua refused the first snapshot, Anesu bound the newly
      identified active tab, and the model explicitly opened the validated URL
      in a fresh exact-origin session before reading a new snapshot. This proves
      this redirect path only; do not infer other destinations or widen manifests.
- [x] Preserve the live browser across same-origin conversation turns, and on a
      separate task for another origin replace the previous isolated session
      with a fresh session bound to the newly approved task scope. Never mutate
      or widen the old Cua manifest. Real TUI acceptance covered
      `example.org` → same-origin follow-up → separate `example.com` task. A
      regression also verifies that opening a later task without a preceding
      `browser_start` cannot inherit origins from the previous task.
- [x] Preserve an ambiguous cross-origin click record while allowing a later
      fresh destination read to complete the user turn. On 2026-09-24, the real
      TUI followed example.org's IANA link, rebound the exact Cua window, opened
      the validated URL in a new exact-origin session, and answered from fresh
      page evidence. The task completed; its click record remained `ambiguous`.
- [x] Verify the managed browser after the former Cua idle expiry. On
      2026-09-24, the same private TUI/Cua session was followed up after
      11m02.754s; it reused the managed browser, observed `Example Domain` from
      a fresh snapshot, and did not start or navigate another browser session.
- [x] Pass the existing normal tool-loop regression for selecting an inactive
      tab using its opaque Cua ID. The contract does not imply a
      bring-to-front operation.
- [ ] Prove multi-tab selection in a real TUI session. A 2026-09-24 attempt
      followed a link on `the-internet.herokuapp.com/windows`; Cua reported one
      tab and the task exhausted its model rounds, so that attempt did not prove
      multi-tab support or a Cua limitation. It did expose that listing tabs
      refreshes Cua's exact binding and invalidates old element refs. Anesu now
      clears those refs and requires a fresh snapshot before further action;
      live multiple-tab acceptance remains open. A follow-up run on the
      deterministic local `/tabs` page reproduced the same one-tab result after
      a `target="_blank"` link. Anesu's Linux default is Cua `dom_event`; Cua
      0.28.2 documents this as synthetic dispatch that can be ignored when a
      page requires trusted user activation. Its trusted route refuses
      standalone Linux Chromium rather than activating the window. A third run
      explicitly selected `trusted`; Cua returned `browser_action_refused`
      before dispatch and a fresh tab list still contained only the original
      tab. The pinned TypeScript package has no browser tab-creation or
      activation tool, and source inspection of the newer local Cua checkout
      found no registered operation for one. The exact popup-block reason from
      the synthetic route was not returned, so that explanation is likely, not
      directly observed proof. Do not replay the click or add
      page-script/Playwright/desktop-focus fallbacks. This capability remains
      unsupported on the current standalone Ubuntu/Cua route; existing returned
      opaque tab IDs remain usable through the tested typed tool loop. Revisit
      when Cua provides a supported route or the plan explicitly adopts a
      separately approved native-browser interaction.
- [x] Add model-callable search without requiring a user-supplied URL. Bing is
      the default; `ANESU_BROWSER_SEARCH_PROVIDER` accepts `bing`, `duckduckgo`,
      or `google`. The tool opens the real results page through task-scoped Cua
      and returns a fresh semantic snapshot to the conversation model.
- [x] Wait briefly after search navigation before its first snapshot. Inspection of
      the pinned Cua implementation confirmed `browser_navigate` acknowledges
      `Page.navigate` dispatch without waiting for page readiness. The 1.5-second
      settle is bounded; if results remain sparse or the provider blocks automation,
      the model decides what to inspect next or reports the limitation.
- [x] Give search guidance one bounded wait-and-snapshot recovery, then tell the
      model to stop on another empty/challenged result rather than repeat queries
      or guess URLs. This is advisory tool guidance, not a guarantee of model
      compliance or provider availability.
- [x] Recover usefully from Cua's live-origin out-of-manifest page refusal: the
      pinned Cua 0.28.2 wraps this exact scope failure as `authorization_host_failed`
      while deriving protected-observation scope, so recognize that code only with
      its exact out-of-manifest message (or the direct typed scope refusal). Re-bind the
      same exact browser window, validate its observed live URL, and return a
      model-readable handoff result only for public HTTPS destinations. Do not
      automatically navigate, repeat a click, or expose sensitive query/fragment
      data. Browser-tool tests cover fresh scoped continuation and redaction.
- [x] Give `browser_*` tool calls the configured browser-action deadline instead
      of the shorter generic tool deadline. Real TUI traces showed repeated
      10-second browser timeouts; the focused `runTurn()` regression proves a
      browser call can complete beyond a shorter general-tool limit. Other tool
      budgets and the default model/tool-round count are unchanged.
- [x] Prove in the live TUI that natural-language search opens results, the model
      inspects current page content, and it chooses whether to follow a result.
      On 2026-09-24, Bing returned 11.8 KB and 174 refs; the free model opened
      `docs.python.org/3/tutorial/datastructures.html`, clicked its observed
      “5.1.3. List Comprehensions” link, and answered from a fresh snapshot.
- [x] Return fresh page evidence from `browser_open`, not just navigation
      acknowledgement. Direct and search navigation now wait up to 1.5 seconds
      and snapshot the exact active tab. The live Bing run returned fresh
      Python-docs content after opening the result.
- [x] Support ordinary form entry through the same generic tool loop, with
      fresh snapshot verification and a separate exact-action approval for the
      typed value. Do not add site-specific handlers to make acceptance prompts
      pass.
- [x] Continue the user's original form task after an ambiguous Cua action:
      take a fresh snapshot, do not replay the uncertain action, use only
      supplied values for currently observed fields, ask for missing required
      values, and do not submit unless requested. This is generic tool guidance,
      not a site-specific workflow. A focused full-loop regression covers the
      continuation and missing-value behavior; a real TUI run on a disposable
      local form typed the supplied value after an `unverifiable` click, took a
      fresh snapshot after typing, and did not submit. A read-only follow-up
      confirmed the exact field value. Live evidence is limited to that form and
      configured model; it does not claim all websites behave identically.
- [x] Restore the recent role-labelled transcript at chat startup and resume.
      Keep the current user request, tool activity, and assistant response in
      chronological terminal scrollback. The TUI remains line-oriented, so the
      request can scroll out of the viewport; it is not a pinned pane. A focused
      TUI regression passed, and a real two-turn browser task showed the request
      before each turn's events and the answer after them.
- [x] Preserve Cua's exact active-tab identity across binding refreshes. A fresh
      bind can mint a new opaque tab ID; `browser_tabs` reports Cua's proven
      active tab, and recovery does not assume the old ID survives or select the
      first tab. Focused Cua adapter and browser-tool tests cover rebinding.
- [x] Keep references to “the current browser” on Anesu's managed isolated
      session instead of interpreting them as personal-profile attachment.
      Personal attachment now requires explicit “my/personal/already-open”
      wording. `computer-task.test.ts` and the full TUI continuation regression
      cover the distinction; a real next-turn prompt reused the active browser.
- [ ] Prove selecting among multiple active browser tabs through the generic
      tool loop in live TUI. The one-tab redirect acceptance does not cover tab
      choice.
- [x] Connect approved upload through the Cua file-input tool with workspace
      path, identity, and size checks. A live task approved one exact file and
      verified its selected name from a fresh snapshot without form submission.
- [ ] Implement download through Cua with explicit approval and destination
      checks. Cua 0.28.2 has `browser_download`, but its required destructive
      approval is injected only by a trusted MCP host. The public TypeScript
      `callTool` path strips that private evidence. Keep downloads unavailable
      until Anesu can use a supported trusted-host path and transfer the result
      into its managed artifact store; never set the private approval field.
- [x] Show the action and observed outcome in the TUI. Keep separate consent
      for consequential submissions and other higher-risk operations. Exact
      action prompts identify the current site and semantic target; the TUI does
      not label those approvals as a task-wide grant.
- [x] Run ordinary-language TUI tasks that search and follow a result, read
      one public site, interact within a site, and follow a link to a second
      public origin. The 2026-09-24 live runs cover a successful Bing result,
      fresh public-page reads, same-origin form entry without submission,
      approved upload with fresh filename evidence, and cross-origin IANA
      continuation with the original click retained as ambiguous. These are
      observed cases, not a claim that all providers or websites behave alike.

### 5. Focused verification and handoff

- [x] Finish the focused safety verification: retain coverage for result
      round-tripping, exact-origin isolation, private-address refusal, stale
      references, operation/target-matched approval, file boundaries,
      cancellation, and session cleanup. The supported transition now has
      browser-tool coverage for replacement, scope accumulation, budget use,
      and HTTP refusal plus a pinned Cua contract test for exact multiple-origin
      manifests. Keep real link/redirect acceptance separate; a mock is not live
      proof.
- [x] Keep model decisions replaceable in tests. Assert policy outcomes and
      effects, not one hardcoded action sequence for each ordinary phrasing.
- [x] Preserve valid JSON when a semantic snapshot exceeds the configured tool
      output budget. Structurally bound page content, headings, and references,
      mark the snapshot incomplete, and retain current reference evidence where
      the budget permits; never truncate the serialized JSON string.
- [x] Run focused browser tests, typecheck/build, and the Anesu regression
      suite after the approval changes. Re-run a short real TUI browser task
      with the configured provider; a fake driver is not evidence that public
      browser use works.
- [x] Update the browser guide and record the exact live-supported operations,
      Cua limitations, provider failures, and reproduction commands.

## Test budget and deferred hardening

The first priority is a working model-driven end-to-end path, followed by
focused tests for the permission, identity, approval, and lifecycle rules
above. Do not generate
an exhaustive matrix of websites, browsers, page widgets, timing variations,
or injected failures before the basic public-site path works. Keep those
additional reliability cases in the production-readiness backlog if they
expose a real remaining risk. Do not weaken or skip a test that catches an
observed regression merely to move faster.

## Current position

Milestones 1–4 are complete for the currently verified scope: the normal
conversation model chooses typed browser tools, receives their Cua results,
and controls continuation; search, form entry, exact-origin handoff, and
same-origin persistence have live evidence. Live TUI
runs prove public-site reading, same-origin link following, form entry without
submission, and a local-file assignment followed by a fresh snapshot that shows
the selected filename. Same-origin follow-ups keep their browser session; a
separate task for a different origin closes the old scoped session and starts a
new Cua session for that origin. This was live-verified on
`example.org` → same-origin follow-up → `example.com`.

The reported form-task drift after an ambiguous action is now addressed by
generic uncertain-action guidance, not a site-specific sequence. The focused
tool-loop regression passes, and the 2026-09-24 real-TUI local-form run
continued from a fresh snapshot, entered the user-provided value, re-observed
it, and left the form unsubmitted. The TUI transcript visibility follow-up is
also implemented. On 2026-09-24, two read-only browser turns on Python
documentation showed each request before the browser events and each answer
after them in terminal scrollback. A click returned `unverifiable`; the model
took a fresh snapshot and continued without replay. Focused continuation,
browser-tool, and TUI tests passed 46/46. The line-oriented TUI does not pin the
active request in the viewport.

A live upload attempt initially selected the generic `computer` tool because
its description and the system instruction incorrectly advertised browser
work. The computer tool and system instruction now distinguish native desktop
work from websites; a real TUI retry selected the browser tools and completed
the approved upload. The first upload result also showed why dispatch must not
be narrated as verification: the model now receives an explicit pending page
verification state and the live run took a fresh snapshot before reporting the
selected filename. Earlier URL-less search attempts exposed provider limits:
DuckDuckGo returned 60–83 content bytes with no semantic refs, and Google
returned a CAPTCHA. The model once guessed Ubuntu URLs after the empty result;
the tool guidance now tells it to report empty or challenged results instead.
That guidance is advisory. A later live Bing run succeeded for one query, so
search now has a positive real-TUI acceptance case, while provider availability
remains variable.

Local Cua source inspection confirmed that `browser_navigate` returns after
`Page.navigate` dispatch without waiting for page readiness. Search and direct
`browser_open` now wait up to 1.5 seconds before returning a fresh semantic
snapshot. A live redirect TUI run
completed the explicit exact-bind handoff and read a fresh Ubuntu snapshot. Cua
surfaced the scope failure as `authorization_host_failed` with its exact
out-of-manifest message; its active tab ID changed on bind, so the adapter now
preserves Cua's fresh active identity instead of matching a stale ID. A browser
task action budget of three also interrupted the search attempt; the shared
default is now eight and remains configurable within the existing 1–32 limit.
Focused browser-tool and Cua-adapter tests previously passed 59/59. After the
active-tab and default-budget changes, the full Anesu suite passed 735/735.
The latest focused browser-tool and task-continuation suites pass 43/43,
including durable ambiguous-action evidence and invalidation of stale element
refs after tab listing. The existing inactive-tab tool-loop regression passes
1/1. A real delayed follow-up after 11m02.754s reused the same session and read
fresh page evidence. A separate real cross-origin link run completed from a
fresh IANA read while retaining the click as ambiguous. Multi-tab live
acceptance and downloads remain open. The pinned download-approval contract
remains upstream; Anesu does not mutate manifests or add a second browser
backend.

On 2026-09-24, a real Bing search for official Python list-comprehension
documentation returned 11.8 KB and 174 semantic refs. The model opened the
Python tutorial, clicked its observed “5.1.3. List Comprehensions” link, read a
fresh snapshot, and answered with the official source. A follow-up user turn
asked about “the current browser”; the model first tried a numeric tab ID, then
recovered through `browser_tabs` and read the same managed browser. This exposed
an intent-parser bug: “current browser” was treated as a request for the user's
personal profile. The parser now requires explicit personal or already-open
profile wording, with a task-compiler regression and full TUI continuation test.

An earlier full-suite run after transcript restoration found two TUI test
fixtures without the new `readTranscript()` method. The fixtures were updated;
their focused suites passed 23/23. Final validation on 2026-09-24 then passed
`pnpm --dir anesu test` (751/751), `pnpm --dir anesu run typecheck`,
`pnpm --dir anesu run build`, and `git diff --check`. The verified documentation
checkpoint is `f2fa3a0`; the fixture checkpoint is `13272b8`.

A separate live example.org → IANA link action caused Cua to return an
ambiguous click result while the origin-protected snapshot failed. Fresh exact
binding then exposed IANA, and the model opened a new exact-origin session and
read the page. The turn completed from that fresh destination evidence; its
durable click record remained ambiguous. Do not describe the click itself as
verified.

Approval tests continue to verify task admission separately from exact-action
approval: a task grant covers observed links but not button clicks or text entry.
The TUI projects semantic targets instead of opaque element/document/session
IDs. Browser regressions cover tool-result round-tripping, origin isolation,
private-address refusal, stale refs, exact operation approval, file boundaries,
cancellation, session cleanup, and the new same-origin reuse/different-origin
session replacement rule. Before the current origin-handoff change, validation
passed: focused browser/computer tests (84/84), typecheck, build, the full Anesu
suite (725/725), and `git diff --check`. Real TUI acceptance verified public-site reading, same-site
continuation, new-site task replacement, and approved upload with a fresh
snapshot; the form was not submitted.

The worktree contains substantial pre-existing changes. Preserve them and
stage only files that belong to this browser work.
