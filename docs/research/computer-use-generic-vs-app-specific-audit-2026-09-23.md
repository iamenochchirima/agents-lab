# Computer-use source audit: generic controls versus app-specific workflows

**Date:** 2026-09-23<br>
**Scope:** local checked-out Hermes, OpenClaw, and Anesu source; native desktop path

## Finding

Hermes and OpenClaw use generic computer-control actions against a specifically
selected, currently observed application/window. They do not require a separate
hardcoded task implementation for every desktop app. Their generic actions do
not, however, provide a universal guarantee that an app-specific goal (such as
saving a calendar event) succeeded. Action delivery and goal verification are
separate concerns.

## What the checked-out code does

### Hermes

Hermes exposes one `computer_use` tool with generic capture, click, drag, scroll,
type, key, value-setting, wait, app/window discovery, and app-focus actions. Its
optional `app` field names or filters the application for capture; input actions
then use the exact sticky target established by capture or `focus_app`. A
requested app mismatch is refused rather than redirected to the current window.
There is no per-app task handler in this action table. See
`tools/computer_use/schema.py:13-60,188-201` and
`tools/computer_use/tool.py:359-408` in the Hermes checkout.

The code returns action-effect evidence and instructs the caller to observe
again when the effect is uncertain. That is not a universal app-level proof that
the user's larger goal completed. See `tools/computer_use/tool.py:411-426`.

### OpenClaw

OpenClaw defines one `computer.act` action contract with generic operations for
app/window discovery and launch, window observation, click/type/key/scroll,
accessibility values, and browser actions. The CUA adapter turns `list_apps`
results into execution-scoped app references; `launch_app` resolves one of
those references and uses its discovered launch path, bundle ID, or name. It
then issues exact window references and fresh observation/element references
for subsequent actions. There is no Calendar- or Clocks-specific workflow in
this computer action path. See
`src/plugins/computer-use-contract.ts:10-50,160-189`,
`extensions/cua-computer/src/window-actions.ts:257-339`, and
`extensions/cua-computer/src/frame.ts:131-176` in the OpenClaw checkout.

OpenClaw also classifies action risk in a generic policy boundary
(`extensions/cua-computer/src/node-invoke-policy.ts:13-64`). Its generic action
contract does not itself prove that an arbitrary app-specific mutation was
saved.

### Anesu now

Anesu deliberately has a smaller native surface:

- `native-runner.ts:82-99` resolves only Notes, Calendar, Clocks, Calculator,
  and Settings through a fixed catalog.
- `task.ts:406-417` rejects other native apps and requires a pre-resolved
  catalog entry.
- `task.ts:439-443` rejects a task before approval if no registered completion
  verifier can be derived.
- `verification.ts:481-524` has app-named completion logic for Notes, Calendar,
  Clocks, and Calculator; other mutations require another dedicated verifier.

So the current constraint is in Anesu's product policy and task compiler, not a
requirement imposed by CUA. It prevents natural-language requests for arbitrary
installed apps even where generic CUA discovery, exact window binding, and
bounded UI actions could support them.

## Why Anesu was narrowed, and what that means

The restriction was chosen to avoid open-ended app launch, broad desktop
observation, wrong-window input, and claiming success without an app-owned
postcondition. Those are legitimate risks. The implementation coupled those
safety goals to a fixed app allow-list and a mandatory deterministic verifier
for every admitted task. That coupling is substantially more restrictive than
the generic action architecture in Hermes and OpenClaw, and it blocks ordinary
observe/interact tasks before their safety can be evaluated against the actual
app/window and action.

The right comparison is therefore not “Hermes/OpenClaw have a special alarm
feature that Anesu lacks.” The checked-out computer-use paths show general UI
controls plus live app/window targeting. Calendar event creation, alarm setup,
and calculator use are useful end-to-end acceptance cases, but they should not
define the entire supported-app catalog. Anesu needs a generic, bounded native
task path whose app is resolved from current CUA discovery, whose actions are
limited by an explicit task grant and fresh references, and whose result is
reported according to evidence. Where no reliable app-level postcondition
exists, report that limitation or `outcome-unknown`; do not fabricate success.

This audit establishes the architecture visible in these checked-out source
paths. It does not establish that every application, toolkit, window manager,
or desktop session works, or that either reference project has a universal
deterministic verifier for arbitrary applications.
