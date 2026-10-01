# Lina natural computer-use routing and surface switching

**Created:** 2026-09-20T16:00:00+02:00<br>
**Last updated:** 2026-09-20T17:35:00+02:00<br>
**Status:** Complete<br>
**Owner:** Lina standalone product

## Start here

Read these before changing code:

- [Repository rules](../../../../AGENTS.md)
- [Lina rules](../../../../lina/AGENTS.md)
- [Lina computer environments](../../../../lina/src/computer/README.md)
- [Lina computer-use dual paths](../completed/lina-computer-use-dual-paths.md)
- [Lina browser interaction](../completed/lina-browser-interaction.md)
- [Lina core hardening](lina-core-hardening.md)
- [Production-readiness gaps](lina-production-readiness-gaps.md)
- [Hermes code map](../../../../docs/research/harness-code-maps/hermes.md)
- [OpenClaw code map](../../../../docs/research/harness-code-maps/openclaw.md)

Hermes and OpenClaw are reference points for boundaries and failure handling, not
dependencies or compatibility targets. In particular:

- Hermes separates turn admission, context preparation, bounded model/tool rounds,
  interruption, recovery, and finalization. This plan keeps surface resolution and
  strategy selection inside the turn lifecycle instead of adding a second loop.
- OpenClaw separates prepared-turn ownership, executor selection, policy checks, and
  execution. This plan applies the same separation to browser versus native desktop
  surfaces and Jev versus traditional vision strategies.
- The completed Lina computer-use slice already owns the shared approval, action
  journal, stale-observation checks, CUA dispatch, fresh observation, verification,
  cancellation, recovery, and compare-mode boundaries. This plan consumes those
  contracts rather than replacing them.

## Purpose

Make computer use feel like a normal conversation while preserving the existing
first-iteration safety guarantees. A user should be able to type a request such as:

```text
Open the local demo page and reveal the safe result.
```

or:

```text
Open Chrome and click the pricing link.
```

without naming an internal tool, a fixture, a provider, a strategy, or an observation
format. Lina should determine whether the request belongs to a managed browser or a
visible desktop environment, choose an available decision strategy, show one exact
approval request, perform at most the approved action, and verify the result.

The plan does not make computer use autonomous by removing approval. It makes the
request path natural while keeping the side-effect boundary explicit and inspectable.

## User-facing goal

From a normal configured `pnpm run chat` session:

1. The user types a natural request involving a website, browser, window, application,
   screen, mouse, keyboard, or visible target.
2. Lina identifies the intended surface or asks one concise clarification when the
   request is genuinely ambiguous.
3. Lina starts or attaches to the permitted environment without requiring the user
   to name `computer`, Jev, traditional vision, CUA, Playwright, or a fixture.
4. Lina observes the selected surface and chooses the best permitted strategy:
   accessibility-backed Jev, traditional vision, or the configured comparison mode.
5. The TUI shows the surface, strategy, target, operation, scope, and verification
   expectation in one approval panel.
6. Approval dispatches exactly one action against the fresh observation.
7. Lina captures a fresh observation, verifies the requested outcome where a verifier
   exists, and reports success, abstention, failure, or outcome-unknown honestly.

The current test-only wording, such as `Use the computer tool only` and `In the
disposable native fixture`, must not be required for the normal path after this plan.

## Existing baseline this plan builds on

The completed dual-path slice already provides:

- a managed browser computer path using bounded Playwright observations and actions;
- an Ubuntu/X11 CUA environment with visible cursor support, foreground-window capture,
  accessibility candidates, coordinate and semantic actions, and stale-target checks;
- Jev/TypeSafe semantic selection without sending screenshots to Jev;
- traditional vision selection from a bounded screenshot and allow-listed action schema;
- explicit `typesafe`, `traditional`, and `compare` strategies;
- one-observation/one-action/re-observation sequencing;
- shared structured approval, cancellation, action journaling, recovery, and verification;
- bounded provider retries before approval and no input replay after an uncertain effect;
- stored development configuration and the disposable Xvfb/X11 fixture path.

This plan is incomplete if it adds a second computer-use loop, bypasses the existing
approval path, or silently treats a provider response as a native action.

## Scope

### 1. Natural request admission and intent routing

Add a small, typed admission step before tool execution. It should classify only the
surface intent needed to select an execution boundary:

```text
surface: auto | browser | desktop
strategy: auto | typesafe | traditional | compare
goal: bounded user request
target hints: optional URL, application, window, label, role, or coordinates
```

The admission step must:

- preserve the original user goal for the model and evidence;
- recognize browser-oriented requests such as opening a URL, navigating, finding a
  page control, scrolling a page, or entering ordinary page text;
- recognize desktop-oriented requests such as inspecting the screen, selecting a
  visible window, clicking a desktop control, typing into an application, or pressing
  a key;
- use the already active surface when a short follow-up such as `click that` is
  unambiguous;
- avoid keyword-only claims that a request is executable when the required environment
  is unavailable;
- route ordinary questions and non-computer requests through the existing agent path;
- ask for one short clarification when browser and desktop interpretations materially
  differ; and
- record the admission decision and its reason without storing hidden chain-of-thought.

The classifier is a routing aid, not an authorization mechanism. The environment
capability check, action schema, approval, and executor remain authoritative.

### 2. Surface resolution and environment lifecycle

Implement a surface resolver that turns the admitted intent into one permitted,
inspectable environment:

- `browser` resolves to the existing managed browser session, opening the requested URL
  when the request contains one and no session is active;
- `desktop` resolves to the explicitly configured Ubuntu/X11/CUA environment and its
  visible foreground window or desktop scope;
- `auto` prefers the browser when the request is clearly page- or URL-oriented and
  prefers desktop when it names a desktop application, screen, window, or native input;
- an active browser or desktop surface may be reused only when its session identity,
  focus, display, and permission scope are still valid;
- a missing or ambiguous environment produces a useful unavailable/clarification result,
  not an invented target or a silent switch to the contributor's personal desktop;
- managed browser startup remains isolated and bounded; arbitrary application startup,
  privilege escalation, and package installation are outside this slice; and
- every resolution records the selected surface, environment identity, visibility,
  capability facts, and reason in the run evidence.

The initial user-facing scope is therefore:

- natural requests against the managed browser and its page;
- natural requests against an already available or explicitly launched isolated Ubuntu
  graphical environment; and
- the repository fixture as a deterministic acceptance environment.

It is not a claim that Lina can launch, understand, or verify every arbitrary desktop
application.

### 3. Seamless Jev/traditional strategy selection

Keep the strategies real and selectable, but hide their names from ordinary prompts.
The selection policy is:

| Requested strategy | Selection behaviour | Fallback |
| --- | --- | --- |
| `typesafe` | Use accessibility/element state and Jev only. | None; abstain if usable semantic state is absent. |
| `traditional` | Use the bounded vision request and allow-listed action schema. | None; abstain or fail safely on unsupported/ambiguous output. |
| `compare` | Obtain both proposals from the same fresh observation; execute only the configured primary strategy. | No second native input. |
| `auto` | Prefer Jev when the selected environment exposes trustworthy semantic candidates; otherwise use traditional vision when the environment and model support it. | At most one pre-approval switch after abstention or an eligible provider failure. |

The `auto` policy must obey these invariants:

- explicit user or profile selection wins over automatic selection;
- switching is allowed only before approval and before any native or browser input;
- a Jev abstention can make traditional vision eligible for the same fresh observation
  only when the traditional model and image capability are available;
- a traditional malformed response, low-confidence result, or target ambiguity may stop
  the run rather than trigger a chain of strategies;
- a provider transport failure may use the existing bounded retry/fallback policy, but
  a completed or possibly delivered input is never retried or handed to another
  strategy;
- compare mode remains shadow-only for the non-primary strategy; and
- the TUI and evidence identify the selected strategy and whether a pre-approval
  fallback was considered or used.

This gives the user seamless operation without making the safety boundary seamless or
hidden.

### 4. Shared action loop and verification

Connect admission and resolution to the existing bounded loop:

```text
natural request
  -> intent admission
  -> surface and environment resolution
  -> fresh observation
  -> strategy selection
  -> one bounded proposal
  -> exact approval
  -> one dispatch
  -> fresh observation
  -> surface-specific verification
  -> result and evidence
```

The implementation must keep browser and native adapters separate where their target
identity differs, while sharing the lifecycle and result contract. It must:

- invalidate the proposal after focus, window, page, display, or observation changes;
- preserve the exact target and operation shown during approval;
- use the existing CUA cursor/input path for native actions and the existing managed
  browser path for page actions;
- distinguish verified success, safe abstention, ordinary failure, and
  `outcome-unknown` after a possible side effect;
- never snap an uncertain coordinate to a nearby target or silently reinterpret a page
  action as a desktop action; and
- keep the action limit, deadline, cancellation, and recovery semantics from the
  completed computer-use slice.

### 5. Natural TUI experience

Update the TUI only as needed to make the routing understandable:

- show a short activity line such as `Browser · Jev` or `Desktop · traditional
  vision` after resolution;
- show why Lina selected or switched strategy in bounded user-facing language;
- render one approval panel with surface, environment, target, action, strategy,
  scope, and expected verification;
- preserve keyboard approval, denial, and `Ctrl+C` cancellation;
- make unavailable environments and abstentions actionable rather than generic model
  failures;
- allow `/computer` or an equivalent inspection command to show the current surface,
  strategy policy, environment readiness, and recent run status; and
- avoid exposing internal terms such as observation IDs, provider payloads, or fixture
  names unless the user requests diagnostics.

The TUI must not imply that a click succeeded before a fresh observation or a declared
verifier establishes the outcome.

### 6. Configuration and development defaults

Retain stored development configuration and add one small policy layer rather than
duplicating provider settings:

```text
LINA_COMPUTER_SURFACE=auto
LINA_COMPUTER_STRATEGY=auto
LINA_COMPUTER_TYPESAFE_MODEL=jev-latest
LINA_COMPUTER_TRADITIONAL_MODEL=<configured vision model>
LINA_COMPUTER_TRADITIONAL_VISION=true
```

The exact variable names may follow existing configuration conventions. The plan
requires that:

- `auto` is the default only when the required capabilities are discoverable;
- explicit `typesafe`, `traditional`, `compare`, `browser`, and `desktop` settings are
  validated at startup;
- model credentials remain in ignored local configuration and are never written to
  plans, evidence, or ordinary logs;
- the disposable fixture remains available through one `pnpm` command; and
- configuration inspection reports effective non-secret values, not raw environment
  contents.

## Security and reliability requirements

The following are part of this slice, not optional polish:

- No model-selected string may become an arbitrary shell command, URL with hidden
  credentials, desktop application launch, coordinate adjustment, or input operation
  without an Lina-owned parser and allow-list.
- Surface resolution must not attach to the contributor's personal desktop unless an
  explicit configured host profile authorizes it.
- Browser and native observations must remain bounded, and screenshots/provider bodies
  must not enter ordinary transcript or run-journal records.
- Sensitive browser inputs, password fields, file pickers, hidden controls, and
  credential-like text remain blocked or require their existing dedicated policy.
- Approval identity includes the surface, environment, strategy, observation identity,
  target, operation, scope, limits, and expiry. Any drift invalidates approval.
- A strategy may fall back before approval, never after input could have been delivered.
- Cancellation before input is a failed run; cancellation after input may have started
  is `outcome-unknown`; neither path replays input.
- Provider errors, host errors, stale observations, malformed responses, abstentions,
  and verification failures remain distinguishable in evidence and TUI output.
- Recovery must reconcile an incomplete routing/action record without replaying native or
  browser input.
- Browser and desktop sessions must be cleaned up according to their existing lifecycle
  policy, including isolated display and temporary profile cleanup.

## Test plan

### Unit and contract tests

- natural request admission for browser, desktop, follow-up, ordinary-chat, and
  genuinely ambiguous prompts;
- explicit surface/strategy precedence over `auto`;
- capability matrix resolution for browser, Jev, traditional, compare, unavailable
  display, missing accessibility tree, and non-vision model cases;
- Jev abstention followed by one eligible pre-approval traditional selection;
- provider failure retry/fallback before approval and no fallback after dispatch;
- exact preservation of target, operation, scope, observation identity, and strategy
  through approval and evidence;
- browser/native action schema rejection for unsupported operations, sensitive fields,
  stale targets, changed focus, changed windows, and changed pages;
- verification outcomes: success, safe abstention, ordinary failure, and
  outcome-unknown;
- configuration validation, redaction, bounded deadlines, action limits, and cleanup;
- TUI projections for surface, strategy, fallback reason, approval, denial,
  cancellation, and unavailable-environment errors.

### Integration tests

- natural browser prompt -> managed browser -> structured action -> approval -> fresh
  browser verification;
- natural desktop prompt -> isolated Ubuntu/X11 fixture -> Jev semantic action ->
  approval -> CUA dispatch -> fresh verification;
- the same desktop prompt through traditional vision;
- `auto` with Jev available, `auto` with Jev unavailable and traditional available,
  and `auto` with neither strategy available;
- compare mode with agreement, disagreement, Jev abstention, and missing frame,
  proving that only one primary action can be dispatched;
- browser/desktop ambiguity requiring one clarification rather than an arbitrary
  surface choice;
- cancellation, approval denial, stale target, focus loss, provider timeout, display
  loss, restart, uncertain CUA acknowledgement, and duplicate event injection;
- persistent run evidence contains routing and strategy decisions but no secrets,
  raw screenshots, or raw provider bodies; and
- documented `pnpm` commands continue to work from a clean development checkout.

### Manual acceptance checks

Use the existing disposable Xvfb + GNOME + Chrome fixture and stored development
configuration. The acceptance prompts should not mention internal tools or fixture
implementation details:

1. `Open the demo page and reveal the safe result.`
2. `Click the visible Reveal safe result button.`
3. Repeat with `LINA_COMPUTER_STRATEGY=traditional` and inspect the same approval,
   dispatch, and verification path.
4. Repeat with `LINA_COMPUTER_STRATEGY=compare` and confirm both proposals are shown
   but only one input is sent.
5. Deny the approval and confirm no input occurs.
6. Press `Ctrl+C` at approval and confirm no success claim is emitted.
7. Ask for a nonexistent target and confirm safe abstention or a concise clarification.

The traditional acceptance may use a temporary known-good vision model when the stored
free route is capacity-limited. That provider limitation must be recorded as evidence,
not hidden by changing the plan's completion claim.

For this first implementation slice, the required live checks were the natural native
and browser routes. The traditional and compare paths were verified through the
provider-boundary, fake-environment, no-input-replay, and compare-mode integration
tests listed above; a live rerun of those two model policies remains optional when a
vision provider is available and healthy.

## Explicitly deferred

This slice does not include:

- arbitrary application installation, privilege escalation, or unrestricted process
  launching from a prompt;
- a new local OCR or screen-segmentation model;
- remote desktops, personal Chrome/CDP profiles, extensions, OAuth/CAPTCHA automation,
  or unrestricted browser JavaScript;
- background jobs, scheduling, multi-agent computer control, or external integrations;
- a second CUA CLI/MCP runtime alongside the in-process TypeScript adapter;
- removal of Jev or traditional vision; that decision requires comparable evidence after
  both paths have been used through the same natural interface; or
- exhaustive production hardening already listed in the production-readiness register.

These exclusions keep the slice focused on user-facing routing and safe strategy
selection. They are not claims that those capabilities are unimportant.

## Definition of done

All in-scope completion items are checked below. The required live acceptance was the
natural native and browser path; traditional and compare policy coverage is recorded
through the provider-boundary and integration tests described above.

- [x] A normal user can issue the supported browser and desktop requests without naming an
  internal tool, fixture, provider, strategy, or observation format.
- [x] `auto` selects the appropriate browser or desktop surface from explicit capability
  facts and either uses Jev or traditional vision according to the documented policy.
- [x] Jev and traditional strategies remain individually selectable and testable; compare
  mode retains shadow-only semantics.
- [x] A Jev abstention or eligible provider failure can switch once before approval, while
  no path retries or switches after input may have been delivered.
- [x] Browser and native actions share one approval, cancellation, evidence, and result
  contract without erasing their adapter-specific target semantics.
- [x] Fresh observation and surface-specific verification produce an honest terminal result.
- [x] The TUI makes the selected surface, strategy, approval, fallback, and outcome clear
  without exposing secrets or internal protocol noise.
- [x] Unit, integration, failure, recovery, and required native/browser acceptance tests
  pass using the repository's `pnpm` commands.
- [x] The README, computer-environment documentation, playground, configuration reference,
  and this plan match the shipped behaviour.
- [x] Deferred production-hardening work remains explicit in the gap register.

## Required validation commands

```bash
pnpm --filter @agent-harness-lab/lina typecheck
pnpm --filter @agent-harness-lab/lina test
pnpm --filter @agent-harness-lab/lina coverage
git diff --check
```

The real Ubuntu/X11/CUA acceptance requires the declared host prerequisites and
configured provider credentials. CI must use the deterministic fake environment for
repeatable coverage and report a missing graphical host as unavailable rather than
calling it a passing native acceptance.

## Handoff and completion record

Implementation is complete for this first slice. Move this file to `completed/` and
retain the following record:

- implementation commit hashes: not created in this working tree because unrelated
  user changes are present; the implementation remains reviewable as a focused diff;
- changed routing, lifecycle, TUI, configuration, and documentation files: `src/computer/routing.ts`,
  `src/computer/router.ts`, `src/computer/runner.ts`, `src/tools/registry.ts`,
  `src/runtime/turn.ts`, `src/runtime/application.ts`, `src/config/config.ts`,
  `src/cli/tui.ts`, `src/cli/doctor.ts`, browser executable/environment handling,
  the Lina computer README, configuration README, playground, and `.env.example`;
- validation: `pnpm --filter @agent-harness-lab/lina typecheck`, build, full test,
  coverage, and `git diff --check`; final full suite was 514 passing tests with
  89.87% line, 76.63% branch, and 86.13% function coverage;
- live native acceptance: `pnpm run chat:cua-xvfb -- --fixture --window-manager
  gnome-shell`, followed by `Click the visible Reveal safe result button.`; auto
  routed to desktop, Jev selected the observed semantic target, the structured
  approval was accepted, and fresh verification confirmed success after CUA reported
  an uncertain effect without retrying;
- live browser acceptance: the same isolated launcher with `Open https://example.com`;
  the managed browser opened the URL using the configured system Chrome executable;
- provider and host prerequisites: stored local TypeSafe/OpenRouter development
  credentials, Linux Xvfb, GNOME Shell, D-Bus, AT-SPI, Google Chrome, and an isolated
  X11 display; credentials were not written to this plan or evidence; and
- remaining limitations: traditional/compare live quality remains model-capacity
  dependent, arbitrary application launch and unrestricted personal-desktop access
  are excluded, and exhaustive production hardening remains in the production-readiness
  register.

The completion claim is limited to this first natural-routing slice. It does not claim
that the deferred production-readiness register or every arbitrary desktop application
is complete.
