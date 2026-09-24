# Anesu browser form controls

**Created:** 2026-09-24T18:40:20+02:00
**Last updated:** 2026-09-25
**Status:** Acceptance passed for the tested Cua 0.28.2 Ubuntu/X11 path; closeout pending
**Owner:** Anesu

## Start here

- [Repository rules](../../../../AGENTS.md)
- [Anesu development rules](../../../../anesu/AGENTS.md)
- [General browser-use plan](anesu-browser-use.md)
- [Cua browser gateway](../../../../anesu/src/browser/cua-browser-gateway.ts)
- [Cua browser adapter](../../../../anesu/src/browser/cua-adapter.ts)
- [Model-facing browser tools](../../../../anesu/src/browser/tools.ts)
- [Browser tool tests](../../../../anesu/tests/browser-tools.test.ts)
- [Cua "Drive a Web Page" guide](https://github.com/trycua/cua/blob/main/docs/content/docs/how-to-guides/driver/drive-a-web-page.mdx)
- [Cua semantic snapshot contract](https://github.com/trycua/cua/blob/main/docs/content/docs/reference/cua-driver/browser-semantic-snapshots.mdx)

Keep the normal conversation model in charge of choosing browser actions. Anesu
validates current Cua references, permissions, approvals, and outcomes. Cua owns
browser identity and input delivery. Do not add Playwright, page scripts, a
site-specific workflow, or a second hidden planner.

## Purpose

Make ordinary form completion work through Anesu chat for the form controls
that Cua can observe and operate through its origin-scoped typed browser API:
text/date fields, checkboxes, radio buttons, and custom dropdown options exposed
as current semantic refs. Classify native HTML `<select>` support against the
installed Cua snapshot/action contract; if Cua does not expose an actionable
option, report the limitation rather than adding native desktop calls.

This plan covers common control types, not every arbitrary website widget. If
the active Cua runtime has no honest way to observe or operate a control, Anesu
must report that limitation. It must not simulate success or route around Cua.

## Definition of done

From `pnpm run chat`, a natural request can fill a form containing a text field,
a checkbox or radio choice, a dropdown selection, and a date/calendar value.
The conversation model chooses actions from fresh Cua observations. A fresh
observation confirms each requested value or state, and Anesu does not submit
unless the user asked it to. If Cua cannot perform a control, Anesu stops with
an accurate explanation instead of repeating an ineffective action or leaving
the user's task.

```text
user's form request → model-selected Cua action → current form state
                    → fresh observation → verified values or clear limitation
```

## Scope

- [x] Verify the exact typed browser capabilities available to the Cua runtime
      Anesu actually starts. Keep browser tools in the origin-scoped manifest;
      native desktop operations are not a browser fallback.
- [x] Preserve bounded semantic control state from Cua, including checked,
      selected, expanded, disabled, and required when Cua returns it, so the
      model can see and verify these states.
- [x] Let the model choose current Cua actions for visible controls. A select
      option is operable only when Cua exposes it as a current actionable
      browser ref. Do not add native-window operations to this origin-scoped
      browser session.
- [x] Complete one real Anesu TUI form run covering the control types above,
      and document the exact controls that remain unavailable.

## Explicitly out of scope

- Playwright, direct DOM mutation, page JavaScript, CSS selectors, or a second
  browser automation backend.
- Prompt classifiers, site-specific handlers, prewritten action sequences, or
  an Anesu-owned form planner that duplicates the conversation model.
- Unrestricted screenshot-to-coordinate clicks, guessed keyboard sequences,
  or switching to the user's personal browser profile.
- Submitting a form without the user's request and required approval.
- Exhaustive browser, toolkit, and website test matrices. This slice uses one
  focused regression path and one end-to-end acceptance form.

## Finished behaviour

### User-visible behaviour

The model reads the form's current labels and control states, uses the user's
provided values, and chooses among currently available Cua actions. It
re-observes after an action before deciding what comes next. It tells the user
which requested fields were confirmed, which were not, and whether it left the
form unsubmitted.

### Ownership and boundaries

```text
conversation model  → interprets the request and chooses the next exposed action
Anesu browser layer → exposes bounded Cua state, validates fresh refs and approvals
Cua Driver          → binds the exact browser target and delivers the supported input
```

There is no new durable state. Existing browser action records retain their
current per-action evidence and ambiguity semantics.

## Failure and recovery

- A stale reference requires a fresh snapshot before another action.
- An uncertain click is never replayed. The model receives the new snapshot and
  may choose a different action only if current Cua evidence supports it.
- If an action is unavailable or the fresh state does not show the requested
  value, Anesu reports that result. It does not search elsewhere, reopen a page,
  or claim completion from a tool acknowledgement.
- Submission remains a separate user-directed, approved action.

## Permissions and data

- Keep current browser origin, isolated-profile, exact-reference, and action
  approval boundaries. A new control route does not grant new sites or access
  to the user's personal browser.
- Do not store screenshots or form values beyond the existing action evidence
  and conversation records. Do not add logging of provider prompts or secrets.
- Keep the Cua manifest origin-scoped and typed-browser-only. Cua's manifest
  validator rejects native-window observation or input tools in this session.

## Implementation checklist

### 1. Establish the real Cua control contract

- [x] Inspect the pinned `@trycua/cua-driver` schema, live Cua tool inventory,
      and local Cua source for the origin-scoped browser contract.
- [x] Reject native-window APIs as a browser-control route. Cua's manifest
      validator rejects `get_window_state`, `click`, `set_value`, `type_text`,
      and `press_key` in an origin-scoped manifest because they bypass the typed
      browser-origin adapter.
- [x] Probe the actual Cua semantic snapshot for a native `<select>` after it
      opens. Cua exposes option refs, but the live Ubuntu `dom_event` click did
      not change the selected value and trusted click is refused for standalone
      Chromium. Record native select as unavailable on this route; do not add a
      desktop, DOM, CDP, or guessed-key fallback. Custom dropdown options use
      normal observed semantic refs.
      The pinned semantic contract exposes the native select/option refs as
      click targets rather than editable refs. Anesu's `browser_press` delegates
      to Cua `browser_type` keystrokes, which requires a current editable ref;
      it is not a keyboard-selection route for a native select.

### 2. Make current form state usable by the model

- [x] Carry only the bounded Cua state fields needed to understand form
      controls through the Cua gateway and browser adapter. Preserve existing
      role, label, value, action, and ref-lifetime checks.
- [x] Return control roles and state clearly in the model-visible snapshot so
      the model can distinguish an unchecked checkbox, a selected option, and
      an expanded control when Cua provides that evidence.
- [x] Add concise generic tool guidance: after opening a dropdown, take a fresh
      snapshot and act on an exact current option ref; do not retry the same
      ambiguous click. For a native date field, prefer its current typed ref
      before opening the picker; do not encode a fixed menu or calendar
      sequence.

### 3. Complete and verify common controls

- [x] Keep text/date entry on Cua's typed browser route. Use exact observed refs
      for checkbox/radio toggles and custom dropdown options. Do not create a
      model-facing `browser_select` API without a corresponding Cua contract.
- [x] For a native `<select>`, use only current Cua refs. If an approved click
      leaves the selected state unchanged, stop and report that the current
      input route cannot operate it; no accessibility, shell, DOM, CDP, or
      guessed-key fallback is allowed.
- [x] Re-observe after each requested change. Confirm text/date values and
      checked/selected state from fresh Cua evidence where the driver exposes
      them. Never treat an action acknowledgement as verification.
- [x] Keep each mutating operation inside the current approval policy. Do not
      submit unless the user requested submission.

### 4. Focused regression and live acceptance

- [x] Add a focused model-loop regression for a dropdown that first opens with
      an uncertain click, then either selects an observed option or stops with
      the precise unsupported capability. Assert no repeated click, unrelated
      search, or submit.
- [x] Use one deterministic acceptance page containing text/date fields, a
      checkbox, a custom accessible dropdown, and a native `<select>` probe.
      This page is only a verification surface; ordinary user tasks remain
      unrestricted by site-specific rules.
- [x] Run one natural-language fill-only request through the real TUI and
      configured Cua runtime. Confirm the final control values from fresh state
      and confirm no submission occurred.

### 5. Document and hand off

- [x] Update the browser guide and general browser-use plan with the controls
      proven through typed Cua refs and any remaining native-select limitation.
      Do not claim broad form support from the text-field test.
- [x] Run focused affected tests first, then the full Anesu suite, typecheck,
      build, `git diff --check`, and the available real-TUI acceptance once.
      The focused browser tool, adapter, gateway, and continuation suites pass
      87/87; build, typecheck, diff check, and live acceptance passed. The full
      suite had one unrelated native-task assertion failure recorded below.
- [x] Record exact Cua runtime/package versions, the accepted form results, and
      any unavailable control route in the evidence ledger below.

## Completion gate and commits

- [x] The deterministic regression proves model-selected form interaction and
      no replay after ambiguity. It does not stand in for the real TUI run.
- [x] The real TUI run verifies each requested value/state from fresh Cua
      evidence and leaves the form unsubmitted.
- [x] Docs distinguish controls proven on this runtime from controls Cua does
      not support. Native-select support is not a completion prerequisite if the
      installed Cua typed contract does not expose it; the limitation must be
      recorded accurately.
- [ ] Stage and commit only this verified form-control slice after separating
      it from pre-existing browser changes; record the commit hash. Do not stage
      unrelated work.

No commit was created as part of this acceptance. The worktree contains
unrelated changes; any later commit should stage only the browser form slice.

## Evidence and decisions

- The 2026-09-24 live run used the normal conversation model, Anesu's real TUI,
  Cua `0.28.2`, isolated Chrome, and the disposable X11 acceptance page. One
  natural request set First name to `Amina`, checked the terms box, chose
  `Product` in the custom dropdown, and set Preferred date to `2026-10-12`.
  A later read-only turn took another Cua snapshot and confirmed all four
  values, left Industry at its initial `Choose an industry` value, and confirmed
  the form was not submitted.
- The current Cua snapshot labels native date parts `Day Day`, `Month Month`,
  and `Year Year`. For a valid ISO date, Anesu now converts the value into that
  exact observed ref order, sends it through Cua `keystrokes`, and shows the
  actual typed string in the exact-action approval. The D/M/Y test used
  `12/10/2026`; the fresh snapshot reported canonical `2026-10-12`.
- A first live attempt opened the native date picker before typing. The typed
  action then left the picker showing the current day, and the field could not
  be verified. A later direct-type run succeeded. The model may still propose
  opening the picker first; when that route is denied or refused, it can recover
  by typing directly from fresh evidence. Do not treat a highlighted calendar
  day as the input's stored value.
- The fixture's native `<select>` exposes option refs, but its `dom_event`
  click did not update selected state in the live route; trusted click is
  refused for standalone Linux Chromium. Cua semantic actions describe the
  select/options as click targets, while `browser_type` requires an editable
  current ref; Anesu's `browser_press` uses that same Cua typing operation, so
  it cannot provide arrow-key navigation for this control. Native `<select>`
  and native calendar month navigation remain unavailable through this route. A radio control,
  multiple date inputs in one form, and non-English date-part labels were not
  included in this acceptance.
- A focused regression proves ISO-date conversion from duplicated Cua labels,
  shows the transformed text and keystrokes in approval, and refuses to type if
  the date-part order is ambiguous. The focused browser tool, adapter, gateway,
  and continuation suites pass 87/87; `pnpm run build` passes.
- The full Anesu suite ran 756 tests: 755 passed and one failed in the already
  modified `tests/computer-task.test.ts`. That native-task assertion expects
  `select` in the allowed action list, while the current compiler omits it.
  This browser form change does not touch the native task compiler or that test;
  the focused browser suites and live form acceptance pass.
- Cua `semantic_v2` returns bounded state and current refs. The browser gateway
  and adapter preserve those fields for model-visible snapshots. A dispatched
  `dom_event` click or `browser_type` action can still be `unverifiable`; only a
  fresh snapshot can establish the control's current state.
- Cua's origin-scoped manifest rejects generic native desktop tools because
  they bypass the typed browser-origin adapter. No native or second-backend
  fallback was added for forms.
- The pinned source tag `cua-driver-rs-v0.28.2` confirms why there is no
  keyboard fallback: Cua's browser semantic action builder offers `click` for
  `combobox`/`option` refs, and adds `type` only for text/search roles, input or
  textarea nodes, or explicitly editable content. Its `browser_type` handler
  refuses a ref that is not focused and editable. Anesu's `browser_press`
  delegates to that same operation in `keystrokes` mode, so arrow-keying a
  native `<select>` is not a supported route in this API. See the pinned Cua
  [`semantic.rs`](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.2/libs/cua-driver/rust/crates/cua-driver-core/src/browser/semantic.rs)
  and [`tools.rs`](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.2/libs/cua-driver/rust/crates/cua-driver-core/src/browser/tools.rs).
- Anesu pins `@trycua/cua-driver` 0.28.2. The separately installed `cua-driver`
  CLI is 0.23.2 and is not the runtime used by Anesu.

Observed Cua contracts:

- [Drive a Web Page](https://github.com/trycua/cua/blob/main/docs/content/docs/how-to-guides/driver/drive-a-web-page.mdx)
- [Browser semantic snapshots](https://github.com/trycua/cua/blob/main/docs/content/docs/reference/cua-driver/browser-semantic-snapshots.mdx)
- [Cua Jev-use example](https://github.com/trycua/cua/tree/main/libs/cua-driver/examples/jev-use)

These references inform the integration. They do not prove the installed
Anesu/Cua runtime has every documented optional capability.

## Required validation commands

Focused checks, after identifying the files that actually change:

```bash
cd anesu
pnpm run build
node --test --test-concurrency=1 \
  dist/tests/cua-browser-adapter.test.js \
  dist/tests/cua-browser-gateway.test.js \
  dist/tests/browser-tools.test.js \
  dist/tests/browser-task-continuation.test.js
```

Integrated handoff:

```bash
cd anesu
pnpm test
pnpm run typecheck
pnpm run build
git diff --check
```

Run the real TUI form acceptance only after the focused regression passes and
the configured Cua host and model provider are available. A mocked adapter
test is not live acceptance.

## Current position

Milestone: supported common-control acceptance passed.
Current item: close out the plan without staging unrelated work.
Status: implementation verified; closeout pending.
Last verified checkpoint: combined real-TUI fill-only request and a separate
fresh read-only snapshot confirmed the requested text, checkbox, custom
dropdown, and date; no form submission occurred.

## Blockers

No functional blocker remains for the accepted control set. Native `<select>`
activation and date-picker navigation are unavailable on this route; radio
controls, multiple date controls in one snapshot, and localized date-part labels
remain unproven. The full suite has one unrelated failure described above.

## Completion record

The supported-control acceptance passed on 2026-09-24. Keep this plan active
only for a safe, focused commit; the implementation and live acceptance are
complete for the tested control set. The separate native-task suite failure is
recorded but is outside this plan. This plan does not claim all website widgets
or native `<select>` support.
