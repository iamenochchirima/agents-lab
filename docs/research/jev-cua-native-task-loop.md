# Jev + Cua native task loop: verified research

**Date:** 2026-09-20<br>
**Scope:** Confirmed capabilities and implementation implications for Anesu's
Ubuntu/X11 native computer-use path

This note separates facts verified from the local Cua checkout and current Anesu
source from design decisions that still belong to Anesu. It is not a claim that
Jev is a general autonomous desktop planner.

## Confirmed Cua capabilities

The local Cua Driver source describes a Linux/X11 surface with:

- `launch_app`, `list_apps`, `list_windows`, and `get_window_state`;
- AT-SPI accessibility trees and screenshots in window state;
- semantic element actions using fresh element tokens/snapshots;
- click, type, key, scroll, drag, and cursor operations;
- explicit background and foreground delivery modes;
- action effects such as confirmed, partial, unverifiable, suspected-noop, and
  refused;
- structured state verification and session recording; and
- a session-owned synthetic agent cursor that does not move the user's real
  pointer by default.

Relevant local sources:

- `/home/enoch/aworkspace/agents/cua/libs/cua-driver/rust/Skills/cua-driver/LINUX.md`
- `/home/enoch/aworkspace/agents/cua/libs/cua-driver/rust/Skills/cua-driver/SKILL.md`
- `/home/enoch/aworkspace/agents/cua/libs/cua-driver/typescript/README.md`
- `/home/enoch/aworkspace/agents/cua/libs/cua-driver/typescript/src/native/cua_driver_sdk.ts`

The Cua SDK's typed TypeScript surface exposes `callTool`, app/window discovery,
observation, input, cursor, session, and `verifyState`. The current Anesu
`CuaDriverClient` seam does not yet expose `callTool`, `launch_app`, or app/window
launch lifecycle operations even though its pinned Cua package has the generic
tool boundary and Cua's Linux backend supports them.

### Installed runtime check

The installed Anesu dependency is `@trycua/cua-driver` `0.28.2`. On 2026-09-20,
`CuaDriver.create().listToolsJson()` returned 59 tools and included:

- `launch_app`, `list_apps`, `list_windows`, and `get_window_state`;
- `click`, `type_text`, `press_key`, `hotkey`, `scroll`, and `invoke_menu`;
- `set_value`, `verify_state`, and `health_report`;
- `set_agent_cursor_enabled` and `get_agent_cursor_state`; and
- `start_session` and `end_session`.

The same inventory did not include `parse_visual_regions`, a capture-bound
`click.capture_id`, OCR, or a standalone screenshot tool. The pinned runtime therefore
supports the planned AT-SPI-backed Jev path, but it does not support a visual-region or
OCR fallback. The local Cua Jev recipe documents an optional `cua.visual_regions_v1`
route in which Cua validates visual regions and Jev receives typed JSON metadata; this
does not require raw screenshot bytes or an image-input TypeSafe request. Anesu must
enable that route only when the released runtime advertises both required capabilities.
The implementation must repeat this bounded capability check at startup so a future
dependency change fails before task approval.

The runtime's `launch_app` schema describes Linux launch as open-world,
state-changing, and not idempotent. Its preferred `launch_path` is the exact value
returned by `list_apps`. Anesu must round-trip that host-discovered value unchanged,
bind it into approval, and never retry an uncertain launch blindly.

### Contract corrections established by the audit

The installed TypeScript interface does not expose typed `launchApp` or `setValue`
methods. Anesu must use `callTool` for `launch_app`, `set_value`, and the runtime's
element-targeted `type_text` fields, after validating their live schemas. Typed methods
remain preferable where the generated contract is complete.

Native startup must use one application-lifetime
`CuaDriver.createConfigured(...)` owner with an immutable, bounded authorization
ceiling. Tool inventory alone is insufficient: `health_report` must also prove the
Linux desktop session, AT-SPI, and capture support before a task is admitted. A named
Cua session scopes each task, and actions through the shared driver are serialized.

TypeSafe SDK and model availability also require a startup contract check. The moving
`jev-latest` alias is not durable evidence of the model used, so run evidence must
record the model identity returned by the service. The existing `0.5` confidence value
is uncalibrated and cannot be described as a safety threshold.

## Confirmed Jev/Cua interaction model

The official Cua Jev guide describes Jev as a bounded chooser. The application
provides a goal, bounded observation, and candidate action IDs. Jev returns a
choice, including an abstain/reobserve option. Application code resolves that ID
to a real action, executes it through Cua Driver, captures fresh state, and owns
the completion check.

The chooser must not receive arbitrary driver tool names and arguments, raw
screenshot bytes, or unrestricted environment data. It must not invent a
coordinate or an element token. Optional visual-region support is also bound to
an exact capture identity; stale or malformed references fail closed.

The official guide explicitly positions Jev + Cua as a bounded chooser rather
than a complete planner. The natural-language task planner, candidate builder,
approval policy, action executor, re-observation loop, and independent verifier
remain host responsibilities.

## What the current Anesu code actually does

Current native Jev integration:

- builds candidates only for clickable accessibility elements;
- asks Jev to select one candidate or `none`;
- executes only a semantic click;
- binds the action to the current Cua observation/token; and
- re-observes after the action.

Current native task limitations:

- no Jev candidates for typing, key presses, scrolling, or dragging;
- no native app launch operation in the Anesu adapter;
- no task-scoped approval grant; approval is currently allow-once;
- generic native goals often derive no completion verifier and therefore stop
  with `clarification-required` after a successful action;
- the Cua session is currently created and closed around a computer tool call,
  rather than being owned by a multi-step native task; and
- the native verifier does not yet prove app-specific outcomes such as a saved
  note, calendar event, or enabled alarm.

These are implementation gaps, not evidence that Cua or Jev cannot support the
workflow.

## External references

- Cua, [Jev use guide](https://cua.ai/docs/how-to-guides/driver/jev-use)
- Cua, [Linux/X11 and platform support](https://cua.ai/docs/reference/cua-driver/platform-support)
- Cua, [what computer use means](https://cua.ai/docs/concepts/what-is-computer-use)
- Cua, [permission policy model](https://cua.ai/docs/concepts/how-permission-policies-work)
- Local comparison note: `docs/research/goal-oriented-computer-use-hermes-openclaw.md`
- Independent evidence audit:
  `docs/research/jev-cua-native-task-loop-audit.md`

## Design consequence

The next implementation should build one host-owned native task loop around the
existing Jev/Cua seam. It should not ask Jev to plan unrestricted desktop work
or directly call Cua. It should add the missing lifecycle, bounded action
vocabulary, task approval, app/window handling, and independent verification in
that order. The first general acceptance tasks should use natural prompts and
real Ubuntu/X11 applications; fixtures remain internal test infrastructure, not
the user-facing interaction model.
