# Anesu computer-use remaining acceptance

**Created:** 2026-09-23
**Last updated:** 2026-09-23
**Status:** Archived on 2026-09-23. Browser work is now tracked in
[Anesu browser use](../active/anesu-browser-use.md); native, cursor, and
visual-fallback work is deferred, not completed.
**Owner:** Anesu standalone product

## Goal and scope

Close the remaining user-visible computer-use gaps without rebuilding the working
task-execution paths. A user should be able to ask Anesu in ordinary language to use
native apps and to browse a user-requested website or search through the managed
browser. Anesu must act through the exact Cua-owned window or browser target, verify
the requested result from fresh state, and report failure plainly when the app, site,
or Cua cannot provide the required evidence.

This plan covers:

- Calculator, Calendar event, and Clocks alarm acceptance, including Cua launch and
  window identity failures.
- Generic browser task admission for a user-requested URL or configured search engine.
  The current action loop already uses general Cua browser actions; the remaining gap
  is that task admission and the immutable origin manifest are restricted to a small
  checked-in set of origins.
- A synthetic Cua cursor that is off by default. An explicit viewing option may enable
  it only in the disposable visible Xephyr profile after it is proven not to broaden
  input or observation permission.
- A capability check for Cua's documented visual-region route. If the pinned released
  Cua package lacks the typed region and capture-bound click contract, Anesu keeps that
  route unavailable and records the upstream dependency. No screenshot-to-coordinate
  substitute is added.
- Existing-profile browser attachment only when Cua can supply and validate one exact
  browser process and window. Otherwise Anesu refuses attachment. Chrome is the required
  Linux probe; Edge is tested only if installed and supported.
- A concise acceptance record, support matrix, regression run, and documentation
  handoff.

The already-working isolated Chrome read, local form, upload, and mixed
browser-to-native flows are regression checks, not work to redesign here. Browser
downloads, OCR, another vision backend, Playwright, app-specific launch shortcuts,
shell/D-Bus workarounds, and general Wayland support are out of scope.

## Constraints and relevant context

- Keep the current task grant, exact Cua session/process/window binding, fresh-state
  verification, and no-replay-after-uncertainty rules.
- Never widen the native manifest to desktop-wide discovery or pointer input to make an
  application pass. Never adopt a different PID because a launched process exited.
- Use only the configured real model, TypeSafe Jev, and pinned Cua runtime for live
  acceptance. Fakes prove individual failure branches; they do not count as app support.
- Cua browser manifests admit exact canonical origins, not wildcard domains. Any
  per-task origin capability must be bound before the browser session starts, limited
  to the user's explicit target (or configured search provider), and rejected if a
  redirect leaves that origin. The installed `@trycua/cua-driver@0.28.2` declarations
  expose `createTrustedSession` with `TrustedSessionOptions.capabilityManifestPath`;
  Anesu's native adapter already uses that boundary, while `CuaBrowserAdapter` still
  calls the unbound driver's `startSession` with the application-lifetime manifest.
  Browser work must test and adopt the installed trusted-session API rather than infer
  support from the separate Cua source checkout.
- Run state-changing acceptance only in the launcher's disposable X11/DBus profile.
  Remove only the event, alarm, and files created by that acceptance run.
- Hermes exposes a separate tinted overlay cursor but disables it by default on Linux
  X11 because a stuck overlay can interfere with desktop input. Anesu will also default
  the overlay off. Any opt-in proof stays inside disposable Xephyr. OpenClaw exposes
  desktop snapshots and pointer actions; its docs do not describe a separate animated
  agent-cursor overlay. See [Hermes computer use](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/computer-use.md)
  and [OpenClaw computer use](https://docs.openclaw.ai/nodes/computer-use).
- The comprehensive [Jev/Cua plan](anesu-jev-cua-native-computer-use.md) is retained as
  the implementation and evidence record. This focused plan controls remaining scope;
  unchecked items in the older plan are not separate active work unless listed here.

## Definition of done

- [ ] A real-model TUI run calculates a simple expression in Calculator, creates the
      requested Calendar event, and creates an enabled Clocks alarm in the disposable
      profile. Each result is proved from a fresh app observation, not a tool
      acknowledgement or model narration.
- [ ] A real-model TUI browser request can use an explicit HTTP(S) URL whose exact
      origin is not hardcoded in the base manifest. The task receives only that exact
      canonical origin in its Cua authorization; redirects or new targets outside it
      stop before further input. The request is natural language and does not expose
      Cua tools, references, or manifest details to the user.
- [ ] A browser search request without a URL either uses the explicitly configured
      search-engine origin, scoped into that task's grant, or asks the user to choose a
      destination when no search engine is configured. The model cannot silently pick
      an unapproved origin.
- [ ] A generic read/interact lane uses current semantic Cua refs on a real page for
      at least navigation, reading, and one bounded click or text-entry action, then
      re-observes. Mutating or submitting external forms is not claimed as complete
      without a separately authorized task and fresh postcondition evidence.
- [ ] Each app is bound to the process and window returned or validated through a
      supported Cua contract. If Cua cannot establish identity, Anesu stops without
      adopting another process, sending input, or claiming success.
- [ ] The synthetic cursor is disabled in the default profile. An explicit Xephyr
      viewing mode visibly shows it during a safe window-bound action, with clean
      teardown and no change to the ordinary OS pointer or bounded manifest. If no safe
      released Cua host contract supports this, record the blocker and leave this plan
      active rather than counting cursor support as complete.
- [ ] The visual-region capability gate matches the actual pinned Cua inventory. Anesu
      either uses Cua's released typed-region and capture-bound click contract, or
      refuses visual fallback before input and records that Cua does not provide it.
- [ ] Existing-profile attachment runs only when Cua provides an exact, supported
      browser process/window selection. Otherwise a typed refusal occurs before
      attachment. Edge and other optional products are labelled unavailable when absent.
- [ ] Focused tests, the Anesu full suite, typecheck, and the required disposable live
      acceptance pass. Documentation lists only the app, platform, route, and browser
      profile combinations actually proven.

## Baseline

- Native app opening is live-proven for Notes/Text Editor and Calendar. Text entry in
  Text Editor has passed fresh accessibility verification. Calendar event creation has
  not passed. Clocks launch has failed when Cua returned a process that exited before a
  usable observation. Calculator interaction remains to be accepted.
- Isolated Chrome reading, local form submission, upload, browser interaction, and a
  mixed browser-to-native task have passed in disposable GNOME Shell/X11 sessions.
  These runs use the checked-in origin ceiling; they do not prove arbitrary
  user-requested origins or search-without-URL admission. Existing-profile attachment
  has authorization plumbing but no supported exact-target live proof. Edge is not
  installed in the recorded environment.
- The pinned SDK declaration includes `createTrustedSession` and a per-session
  `capabilityManifestPath`, but `CuaBrowserAdapter.startSession()` currently calls the
  runtime driver's ordinary `startSession()` and uses the application-lifetime origin
  ceiling. Per-task origin authorization is therefore a concrete unimplemented browser
  capability, not a Cua API that has already been adopted by Anesu.
- Cancellation before dispatch settles as cancelled; cancellation after dispatch stays
  outcome-unknown and is not replayed. Runner, `runTurn()`/`SessionStore`, and TUI
  regressions cover the relevant lifecycle boundaries.
- `@trycua/cua-driver` is pinned at 0.28.2. Its configured in-process runtime disables
  the Linux cursor renderer. Session cursor calls alone do not prove that an overlay
  exists. The currently pinned inventory lacks the documented visual-region and
  capture-bound-click operations.
- Cua 0.28.2 can return an unusable launch PID for applications handed off through
  D-Bus. A safe, released Cua identity contract is required; app-specific shell or D-Bus
  workarounds are not acceptable.
- The worktree contains broad existing user changes. Preserve them; do not clean, stage,
  or commit unrelated files as part of this plan.

Validation commands from the repository root:

```sh
pnpm --dir anesu run typecheck
pnpm --dir anesu test
pnpm --dir anesu run chat:cua-xephyr -- --window-manager gnome-shell
```

The live command requires a disposable X11/DBus profile and the user's normal local model
configuration. Do not run state-changing acceptance against the user's real Calendar,
Clocks, or browser profile.

## Milestones

### 1. Lock the capability and cursor policy

Acceptance criteria:

- [ ] Inspect the pinned Cua SDK and runtime inventory before changing cursor or visual
      behavior. Record the exact host and permission contract used.
- [ ] Default configuration does not create or display the synthetic cursor. The
      setting for explicit visibility follows existing Anesu configuration conventions.
- [ ] An opt-in cursor test runs only in Xephyr. It proves a visible Cua overlay during a
      safe window-bound action, clean teardown, and no desktop-wide permission. A
      targetless `move_cursor` is not used as proof.
- [ ] If the Cua host cannot render the cursor without changing the authorization
      boundary, leave the option unavailable and record the exact typed refusal or
      missing contract. Do not silently change host, manifest, or input route. This is a
      plan blocker until a safe supported opt-in route is proven.
- [ ] Probe for Cua's released visual-region result and capture-bound click. When absent,
      test that Anesu offers no visual candidate and does not generate pixel coordinates.
      If present in a released, pinned package, implement only that public contract and
      bind every candidate to its current capture and exact window.

Validation:

- [ ] Focused tests cover default-off behavior, opt-in eligibility, clean session close,
      and visual-route unavailable/available capability gates.
- [ ] Inspect one Xephyr action capture when opt-in is supported. A status flag or Cua
      acknowledgement alone does not pass.

### 2. Make native app identity and outcomes work

Acceptance criteria:

- [ ] Trace Calculator, Calendar, and Clocks launch through the pinned Cua release and
      identify whether each returned PID remains the owner of the usable window.
- [ ] Use a released, generic Cua identity/handoff capability for D-Bus-activated apps
      if one exists. Do not add per-app launch commands, guessed accelerators, global
      window scans, or shell/D-Bus recovery.
- [ ] If Cua cannot establish the exact launched window, Anesu returns a typed failure
      before input and records the missing capability. It never adopts a matching title
      or a different PID.
- [ ] Calculator completes one harmless calculation and verifies the displayed result
      from fresh state.
- [ ] Calendar creates one event with the exact test title, date, and time, then verifies
      the saved event from a fresh event/list view.
- [ ] Clocks creates the requested alarm, verifies its exact time and enabled state from
      the fresh alarm list, and does not mistake an unsaved form for success.
- [ ] Teardown removes only the event and alarm created by that test run, or proves the
      disposable application state was discarded.

Validation:

- [ ] Add focused regressions for exited launch PID, D-Bus handoff, ambiguous window,
      stale observation, and no-PID-adoption behavior.
- [ ] Add verifier tests for the exact Calculator result, Calendar event fields, and
      enabled Clocks alarm. Unknown evidence must remain unknown.
- [ ] Run the three real-model tasks through the actual TUI in a disposable Xephyr
      profile. Record each task grant, Cua process/window identity, final evidence, and
      cleanup result.

### 3. Admit natural browser tasks with exact per-task origins

Acceptance criteria:

- [ ] Bind each browser task through `createTrustedSession` using a generated Cua
      manifest whose browser origin list contains exactly the canonical origin in the
      user's URL. Keep the native Cua runtime and its manifest unchanged. If a contract
      test shows the installed 0.28.2 runtime does not enforce this per-session path,
      fail closed and record the exact Cua limitation; do not fall back to a wildcard or
      mutate the application-lifetime manifest.
- [ ] Generate the per-task manifest from the checked-in tool/profile/file ceilings,
      changing only the exact approved origin and the task-owned upload staging path.
      Do not accept YAML fragments or policy fields from the model. No wildcard,
      inferred sibling origin, or model-selected destination is allowed.
- [ ] For a search prompt with no explicit URL, use only the deployment-configured
      search engine. Bind its exact origin into the grant; external result links need
      a separately admitted origin before navigation or mutation.
- [ ] Add tests for an explicit origin missing from the base manifest, canonicalization,
      per-task manifest binding, redirect escape, subdomain mismatch, ports and schemes,
      search-engine fallback, missing search configuration, denial before preparation,
      inability to widen non-origin tools/resources, and isolation between concurrent or
      sequential task origins. Exercise the real `createTrustedSession` boundary with a
      recording/fake Cua driver as well as the adapter seam.
- [ ] Run one real TUI read-only task on a user-requested public HTTPS origin that is
      absent from the checked-in base manifest. Record the exact grant, final origin,
      fresh page evidence, and cleanup. Keep the existing example.com/local form lanes
      as regression cases.

Validation:

- [ ] The origin compiler, per-task Cua authorization, browser adapter, and TUI tests
      prove that a task receives exactly one intended origin and cannot inherit another
      task's origin.
- [ ] A live redirect or attempted cross-origin navigation is refused before further
      page interaction; no generic desktop input is available as an escape path.

### 4. Close browser profile and product edge cases

Acceptance criteria:

- [ ] Probe whether the released Cua host can provide one exact running Chrome PID and
      window for existing-profile attachment. Do not infer the target from a title or
      choose the first browser window.
- [ ] If exact supported selection exists, run one explicit, separately approved Chrome
      attachment against a purpose-created throwaway profile and verify origin/profile
      binding. Otherwise test refusal before CDP attachment and document the limitation.
- [ ] Test Edge only if Cua and the host report a supported installed Edge product. If it
      is absent, record `unavailable`; do not install it just to complete the matrix.
- [ ] Keep isolated Chrome read, form, upload, and mixed-task flows green. Downloads
      remain disabled and documented as unsupported in this slice.

Validation:

- [ ] Adapter and TUI tests prove that absent, ambiguous, stale, or unsupported profile
      identity causes no attachment and no browser input.
- [ ] Run the applicable real TUI browser lane only for a Cua-supported exact target.

### 5. Record support and hand off

Acceptance criteria:

- [ ] Create a compact Ubuntu/X11 support matrix for Text Editor, Calculator, Calendar,
      Clocks, isolated Chrome on a checked-in origin, isolated Chrome on a user-requested
      origin, configured-engine search, and existing-profile Chrome. Add Edge only if
      present. Record actual Cua version, launch/window result, action route, final
      evidence, and typed limitation. Optional apps are not turned into required work.
- [ ] Keep Cua's visual-region fallback labelled unavailable unless the released pinned
      runtime and tests prove it works. Keep cursor visibility labelled opt-in and
      platform-specific.
- [ ] Update computer-use README, CLI help/doctor, the local playground, and the
      production-readiness register to match the support matrix and default-off cursor
      policy.
- [ ] Run focused tests, `pnpm --dir anesu run typecheck`, and `pnpm --dir anesu test`.
      Record the exact commands, results, live prompts, and any unavailable capability.
- [ ] Move this focused plan to `completed/` only after its definition of done passes.

Validation:

- [ ] Review the recorded live evidence and docs against each definition-of-done item.
- [ ] Confirm no unsupported app, visual route, browser origin policy, browser profile,
      or cursor behavior is described as working.

## Current position

Milestone: 1, lock the capability and cursor policy
Current item: implement default-off behavior and establish whether Cua can render its
synthetic cursor in Xephyr through a window-bound action without changing the manifest.
Status: planned; no code changes are part of creating this plan.
Last verified checkpoint: prior computer-use validation is recorded in the superseded
comprehensive plan; rerun the focused checks before changing implementation.

## Evidence ledger

- Cancellation and durable terminal-state seams: recorded in the comprehensive plan's
  2026-09-23 progress notes and covered by native runner and `runTurn()`/`SessionStore`
  tests.
- Text Editor/Notes and Calendar app opening: live TUI evidence is recorded in the
  comprehensive plan. Calendar event creation and Clocks alarm creation explicitly
  remain unproven.
- Isolated Chrome read/form/upload/mixed flows: live acceptance evidence is recorded in
  the comprehensive plan. Existing-profile attachment remains unproven.
- Cursor default/opt-in behavior, D-Bus app identity, the Calculator task, Calendar and
  Clocks saved-state tasks, and the final support matrix: not yet accepted.

## Blockers and decision rules

- If Cua 0.28.2 or a newer released compatible version cannot return an exact usable
  window for a D-Bus-activated app, do not add an Anesu app-specific workaround. Record
  the reproducible Cua contract gap and keep that app's mutation capability unavailable.
- If Cua does not expose its documented typed visual-region and capture-bound click
  operations, do not build an alternate screenshot planner. The correct result is a
  tested refusal and an explicit upstream dependency.
- If the synthetic cursor requires desktop-wide input or weakens the bounded session,
  keep it off and leave cursor acceptance open. Do not waive the visible opt-in
  requirement or weaken authorization to finish the plan.
- If an existing browser profile cannot be selected by exact Cua process/window identity,
  refuse attachment. Do not broaden discovery to the whole display.

## Completion audit

- [ ] Re-read the requested remaining scope and this plan's definition of done.
- [ ] Confirm each supported native outcome has fresh application-owned evidence.
- [ ] Confirm default cursor-off and any Xephyr opt-in behavior from a real capture.
- [ ] Confirm unsupported Cua visual/profile capabilities refuse before side effects.
- [ ] Run the focused real-TUI tasks and the full relevant Anesu validation.
- [ ] Review the support matrix and user-facing documentation for unsupported claims.
