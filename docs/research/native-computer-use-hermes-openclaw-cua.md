# Native desktop computer use in Hermes, OpenClaw, and Cua

**Date:** 2026-09-22<br>
**Scope:** first-party local source and documentation only

## Finding

Hermes and OpenClaw do not solve native desktop work with a universal
application-semantic API. They expose a bounded loop that observes a real
surface, targets a current window or element, performs one typed action, and
observes again. Application-specific success belongs to an application-owned
postcondition. Cua's own validation rules make this explicit: a successful
driver response is not enough, and a missing behavior row is not evidence that
the action is impossible. [C1]

## Hermes

Hermes exposes one `computer_use` tool. Its documented workflow is capture with
the app scope, prefer an accessibility element index, perform one action, then
re-capture after a state change. The tool supports clicks, double and right
clicks, drag, scroll, text, keys, waits, app discovery, and non-raising app
focus. [H1]

The target is deliberately tied to the observation. Hermes' backend resolves an
app to a specific window, stores the PID and window ID, and refuses to fall
back silently to the frontmost window when the requested app does not match.
Element actions carry a snapshot token when the driver supports it. [H2]

Hermes treats the driver result as an action fact, not task completion. Its
background-first ladder is:

1. use an accessibility element in the background;
2. if the result is `unverifiable`, take a fresh capture before any retry;
3. use a pixel target only when the returned signal recommends it;
4. use foreground delivery only after a structured refusal or verified
   no-op, with separate approval.

If a Qt editor demonstrably swallows synthetic input, Hermes stops retrying the
input ladder and uses the app's file or DBus/CLI interface instead. It also
refuses to replay a mutation after an MCP timeout because the action may have
landed. Reads may be retried or fetched over the CLI transport; mutations become
outcome-unknown until fresh state resolves them. [H1] [H3]

## OpenClaw

OpenClaw exposes one `computer.act` command and lets the connected provider
advertise only the action, target, observation, and delivery families it can
actually execute. It supports app and window discovery, exact window state,
launch, focus, element input, `set_value`, and `invoke_menu` when the provider
declares those operations. A provider failure does not silently fall back to a
different provider. [O1]

The CUA adapter launches only from an app reference returned by `list_apps`.
It then passes the discovered launch path, bundle ID, or name to Cua. Native
window actions require an opaque `windowRef`; element actions additionally
require the current `observationId` and element reference. `set_value` and
`invoke_menu` are typed semantic operations, not arbitrary model-generated
scripts or keyboard shortcuts. [O2]

OpenClaw keeps only the newest native observation. A driver-generation change
clears app, window, observation, browser, and dialog references. Browser
navigation or a newer browser snapshot clears page-element authority. Stale
references return a structured stale-observation error, so the caller must
observe again. [O3]

Each provider execution is serialized through a queue and closes its recording
resources, resource handles, and Cua runtime on completion, cancellation,
provider switching, disconnect, or shutdown. [O4]

## Cua's native action and verification contract

Cua separates action delivery from task verification. `ActionResult.effect`
describes the driver's own evidence. `confirmed` requires readback or a window
change, `partial` reports partial delivery, `unverifiable` means the actuator
was reached without trusted proof, and `refused` means no delivery occurred.
The caller must use `verify_state` for a bounded postcondition. Only
`satisfied` completes that verification; `unknown` never becomes success. [C2]

Native targeting is exact. A PID may be promoted to a window only when it owns
one eligible top-level window. Multiple windows return
`ambiguous_window_target` instead of choosing an array entry. Window snapshots
return accessibility elements and snapshot-bound tokens. A stale token requires
a fresh snapshot of the same exact window. [C2] [C3]

Cua's validation suite uses real compiled fixture applications and independent
oracles. Depending on the behavior, it checks fixture state, accessibility
state, pixels, focus and z-order, cursor state, leaked-input journals, or an
exact structured refusal. A driver `ok` response without an observed effect is
not a passing E2E result. [C1]

For Linux specifically, AT-SPI may expose semantic actions such as invoking a
button or editing an accessible field, while capture, window discovery, and
input delivery remain separate capabilities. If no safe target-addressed route
exists, Cua's documented outcome is a structured refusal, not hidden focus
change. [C4]

## Calendar events and alarms

The native computer-use documentation searched here contains no Hermes or
OpenClaw recipe for creating a desktop Calendar event or a GNOME Clocks alarm.
The generic tools expose controls and menus, not a promise that every installed
application has a safe semantic action or a verifier. `invoke_menu` could be
useful where the target application's current accessibility tree exposes a
unique menu path, but it does not by itself prove that an event or alarm was
created. The caller still needs fresh application state and an independent
postcondition. [O1] [O2] [C2]

Both projects provide separate domain integrations instead. Hermes' Google
Workspace skill creates Calendar events through an API, requires timezone-aware
timestamps, returns an event ID/link, and requires confirmation before mutation.
[H4] OpenClaw's `gog` skill likewise creates Google Calendar events through a
CLI/API path. Its Android node separately advertises `calendar.add`, while its
Apple Reminders guidance routes Calendar appointments to Apple Calendar and
one-time alerts to `cron`, not to native desktop computer use. [O5] [O6]

Therefore the evidence does not say Calendar events or alarms are impossible.
It says they are not covered by the generic native Cua contract merely because
the application can be clicked. A defensible native implementation needs all
of the following:

- a stable launch and exact window binding;
- current accessibility elements or a documented semantic menu/action route;
- explicit handling for each field and submission action;
- a fresh app-owned readback of the created event or enabled alarm;
- recovery that inspects that readback before retrying after timeout or lost
  acknowledgement.

If the product can use an official Calendar or alarm API instead, that is a
different integration with its own confirmation and readback contract. It
should not be presented as proof that generic native desktop automation can
perform the same task.

## Implication for the current question

Other local agents reinforce the current refusal boundary. They show how to
launch, target, act, verify, and recover safely. They do not provide evidence
that the installed Cua runtime can invoke GNOME Calendar's app-specific action
or keep GNOME Clocks alive and exactly bound on this host. The next evidence
needed for either task is an application-owned fixture or live proof matching
Cua's validation rules, not a successful shortcut or a model-generated success
message.

## Sources

- [C1] `/home/enoch/aworkspace/agents/cua/docs/content/docs/concepts/how-cua-driver-is-validated.mdx:7-91` and `/home/enoch/aworkspace/agents/cua/libs/cua-driver/docs/action-support.md:1-16`
- [C2] `/home/enoch/aworkspace/agents/cua/libs/cua-driver/docs/action-result-contract.md:1-104`
- [C3] `/home/enoch/aworkspace/agents/cua/libs/cua-driver/docs/native-window-sdk-migration.md:15-72`
- [C4] `/home/enoch/aworkspace/agents/cua/docs/content/docs/concepts/linux-desktops-and-computer-use.mdx:39-76`
- [H1] `/home/enoch/aworkspace/agents/hermes-agent/skills/autonomous-ai-agents/computer-use/SKILL.md:35-152` and `:197-285`
- [H2] `/home/enoch/aworkspace/agents/hermes-agent/tools/computer_use/cua_backend_capture.py:256-303`, `:357-376`, and `/home/enoch/aworkspace/agents/hermes-agent/tools/computer_use/cua_backend.py:303-376`
- [H3] `/home/enoch/aworkspace/agents/hermes-agent/tools/computer_use/cua_backend_session.py:170-186` and `:404-521`
- [H4] `/home/enoch/aworkspace/agents/hermes-agent/skills/productivity/google-workspace/SKILL.md:202-216`, `:292-320`
- [O1] `/home/enoch/aworkspace/agents/openclaw/docs/nodes/computer-use.md:11-52`, `:66-88`
- [O2] `/home/enoch/aworkspace/agents/openclaw/extensions/cua-computer/src/window-actions.ts:257-410` and `src/action-targets.ts:25-104`
- [O3] `/home/enoch/aworkspace/agents/openclaw/extensions/cua-computer/src/frame.ts:94-208`, `:255-320`
- [O4] `/home/enoch/aworkspace/agents/openclaw/extensions/cua-computer/src/commands.ts:482-601`
- [O5] `/home/enoch/aworkspace/agents/openclaw/skills/gog/SKILL.md:25-50`
- [O6] `/home/enoch/aworkspace/agents/openclaw/docs/platforms/android.md:421-430` and `/home/enoch/aworkspace/agents/openclaw/skills/apple-reminders/SKILL.md:39-47`
