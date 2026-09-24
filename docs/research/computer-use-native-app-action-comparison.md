# Native computer-use implementation comparison

**Date:** 2026-09-22<br>
**Question:** How do Hermes, OpenClaw, Anthropic-style computer use, OpenAI computer use,
OSWorld, and Cua handle native desktop actions and verification? Does another agent
implementation provide a proven shortcut for Calendar events or Clocks alarms?

This is a source review for the Anesu Cua implementation. It distinguishes the
mechanism used to deliver an input from the evidence used to claim that a task
completed. It does not treat a model's final narration or a driver acknowledgement as
independent proof.

## Executive finding

No reviewed implementation provides a general, trustworthy way to perform an arbitrary
native application's semantic action when the application, desktop session, or driver
does not expose that action and a verifier cannot observe the resulting state.

The implementations fall into two broad groups:

1. Screenshot and coordinate computer use. Anthropic's public computer-use contract and
   OpenAI's computer tool let the model request screenshots, clicks, typing, keys,
   scrolling, and related desktop input. The host executes those requests and returns
   a new screenshot. This is flexible, but the host must supply the environment and a
   separate task-specific verifier if completion must be established reliably.
2. Cua-backed structured computer use. Hermes and current OpenClaw use Cua for native
   desktop control. They add session ownership, background delivery, accessibility
   observations, scoped approvals or capabilities, stale-reference handling, and
   structured refusals. They still cannot invent an unsupported native semantic action.

Therefore Calendar and Clocks are not blocked because Anesu chose an unusually strict
standard. They are blocked because the current Cua/host path has not yet provided both
the required native action and independently verifiable application state.

## Hermes

The local Hermes checkout reviewed was:

- `/home/enoch/aworkspace/agents/hermes-agent/tools/computer_use/tool.py`
- `/home/enoch/aworkspace/agents/hermes-agent/tools/computer_use/cua_backend.py`
- `/home/enoch/aworkspace/agents/hermes-agent/skills/autonomous-ai-agents/computer-use/SKILL.md`
- `/home/enoch/aworkspace/agents/hermes-agent/website/docs/user-guide/features/computer-use.md`

Observed implementation facts:

- Hermes' production `computer_use` backend is Cua-backed. It keeps a backend and call
  lock per Hermes session, and tears down cached backends at session release and process
  exit.
- Its workflow is capture first, act on a fresh element or coordinate, then capture or
  otherwise inspect the result. Element references are treated as stale after a fresh
  capture.
- The skill describes a background-first escalation ladder: accessibility element,
  fresh verification, pixel input, and only then foreground input when the driver
  returns a signal requiring it. It explicitly says not to repeat an uncertain action
  automatically.
- Hermes hard-blocks dangerous key combinations and dangerous shell-like text, and
  separates approval for visible foreground changes from ordinary background input.
- Hermes itself does not expose a generic `create_calendar_event` or
  `set_alarm` semantic operation in the reviewed computer-use surface. Such tasks would
  still depend on the target app's discoverable controls, an input route that works on
  that app, and a verifier that can read the committed result.

This is consistent with Hermes' official documentation, which describes Cua as the
desktop mechanism and recommends a sandboxed environment, domain restrictions, human
confirmation for consequential actions, and post-action inspection. The local skill is
more explicit than a simple screenshot loop about stopping after a verified-lost input
instead of endlessly climbing or replaying the ladder.

## OpenClaw

The local OpenClaw checkout reviewed was:

- `/home/enoch/aworkspace/agents/openclaw/extensions/cua-computer/src/commands.ts`
- `/home/enoch/aworkspace/agents/openclaw/extensions/cua-computer/src/execution-state.ts`
- `/home/enoch/aworkspace/agents/openclaw/extensions/cua-computer/src/action-targets.ts`
- `/home/enoch/aworkspace/agents/openclaw/extensions/cua-computer/src/driver-result.ts`
- `/home/enoch/aworkspace/agents/openclaw/docs/nodes/computer-use.md`

Observed implementation facts:

- OpenClaw's current Windows/Linux native fulfiller uses the pinned Cua Driver SDK
  directly. It does not spawn an independent Cua MCP process or silently switch to a
  second provider when an action is refused.
- It creates one configured runtime and trusted lifecycle session per provider
  execution. Completion, cancellation, disconnect, provider switching, Stop, and host
  shutdown close that execution and its session.
- Model-facing inputs cannot select a native session or widen the authorization ceiling.
  Frames and observations are tied to execution/session generations; stale frames and
  stale observations are rejected.
- The fulfiller deliberately refuses unsupported actions such as held desktop input and
  modifier-held desktop gestures. Its docs describe structured errors including stale
  frames, stale observations, unsupported actions, unavailable driver, and unsupported
  display.
- OpenClaw's browser/native result projection keeps opaque window and browser references
  and carries bounded evidence such as value readback, window change, and accessibility
  observations. It does not turn a successful dispatch response into task completion.

OpenClaw therefore reinforces the Anesu direction. It is a useful reference for
execution ownership, capability ceilings, lifecycle cleanup, and stale-state handling,
but it does not demonstrate a general native Calendar or alarm action that Cua lacks.

## Anthropic-style computer use

Anthropic's official computer-use documentation describes a client toolset containing
screenshots, mouse actions, typing, key presses, scrolling, waiting, and zoom. The
application owns the environment and executes each requested action. Anthropic's
reference environment uses a virtual X11 display, a lightweight window manager, and
pre-installed applications. The documented loop returns tool results, commonly a fresh
screenshot, and continues until the model stops requesting tools.

The documentation also advises isolated environments, allowlists, confirmation for
consequential actions, prompt-injection precautions, and a bounded loop. It recommends
checking the screen after short groups of actions, but the generic computer tool itself
does not supply a Calendar-specific or Clocks-specific committed-state verifier.

This approach can often navigate those applications visually. That is evidence that a
model may be able to perform a sequence of clicks and keys in a suitable environment;
it is not evidence that the sequence is reproducible, exact, or independently verified
for Anesu's contract.

## OpenAI computer use

OpenAI's official computer-use guide describes two host-owned approaches:

- code execution, where the model writes code using a UI library such as PyAutoGUI or
  Playwright; and
- a computer tool, where the model returns structured mouse and keyboard actions that
  the host translates into browser or desktop input.

The guide says to provide a current screenshot when state is unknown, return another
screenshot after a short group of actions, preserve environment state across the loop,
and verify the result in the application. Its safety guidance calls for isolation,
allowlisting, treating screen content as untrusted, confirming consequential actions,
and bounding and verifying the run.

This is a valid general computer-use pattern, but the code-execution option is not a
reason to reintroduce Playwright into Anesu. It would put arbitrary selectors, scripts,
browser lifecycle, and verification back outside the Cua authorization model. The
structured computer-tool option still leaves native semantic action discovery and
postcondition verification to the host application.

## OSWorld and Cua validation

OSWorld's public benchmark uses real web and desktop applications, reproducible initial
state setup, and custom execution-based evaluation scripts. That is the important part
for Calendar and Clocks: the benchmark does not define success as the model saying it
finished; it evaluates the resulting environment state.

Cua's own validation documentation makes the same distinction. Protocol tests establish
that the driver made a deterministic decision. Real graphical end-to-end tests must
launch a real process and inspect application-owned or desktop-owned state. Cua lists
fixture state, accessibility state, pixel state, focus/z-order, cursor state, and leaked
input journals as independent oracles. A successful driver response without an observed
effect is not a passing E2E result.

That validation rule explains the current Anesu gates:

- Calendar needs a supported, snapshot-bound native action or another exact input path,
  followed by a fresh Calendar-owned event/list state proving the event was committed.
- Clocks needs a live, exactly bound Clocks window and a supported action path, followed
  by a fresh alarm-list state proving the alarm is enabled at the requested time.
- A hard-coded accelerator, an array-order window choice, a stale accessibility action,
  or a tool acknowledgement cannot substitute for either proof.

## Decision for Anesu

The first conclusion from this review was too strict: an unavailable semantic action
should not by itself prohibit low-risk native interaction. The research supports a
bounded fallback design, provided it does not dissolve Cua's identity, permission, and
no-replay boundaries:

1. Keep native and browser Cua lifecycles explicit and separate.
2. Keep Jev as a bounded chooser of current structured candidates or code-issued visual
   region IDs. It must not emit a raw coordinate, shortcut, selector, driver call, or
   success claim.
3. Start with current structured accessibility/value actions. After fresh evidence shows
   them unavailable or ineffective, replan through focused key/text, background pixel,
   and separately approved foreground pixel routes.
4. Bind every pixel route to one current Cua window screenshot and one finite region
   candidate. Re-observe after every action. Do not retry an input whose effect is
   uncertain.
5. Prefer an accessible application-owned postcondition. For eligible low-risk visual
   tasks, allow a separately calibrated visual postcondition and label it as such rather
   than treating it as deterministic proof.
6. Test Calendar and Clocks as part of a representative application, toolkit, desktop
   session, delivery-route, and verification matrix. Do not add either app's own
   coordinate, shortcut, shell/DBus, or launch workaround.

The practical next step is a Cua/host acceptance lane that proves the target process,
window binding, current observation, selected route, fresh postcondition, and recovery
behavior. A cell that lacks those facts remains an explicit unavailable or uncertain
result. It does not invalidate the rest of the generic fallback system.

## Primary sources

- [Hermes computer-use implementation](https://github.com/NousResearch/hermes-agent/blob/main/tools/computer_use/tool.py)
- [Hermes computer-use documentation](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/computer-use.md)
- [OpenClaw Cua computer-use documentation](https://github.com/openclaw/openclaw/blob/main/docs/nodes/computer-use.md)
- [OpenClaw Cua extension](https://github.com/openclaw/openclaw/tree/main/extensions/cua-computer)
- [OpenClaw direct Codex/Cua integration notes](https://github.com/openclaw/openclaw/blob/main/docs/plugins/codex-computer-use.md)
- [Anthropic computer-use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)
- [OpenAI computer-use guide](https://developers.openai.com/api/docs/guides/tools-computer-use)
- [OSWorld benchmark](https://osworld-v1.xlang.ai/)
- [Cua platform support](https://cua.ai/docs/reference/cua-driver/platform-support)
- [Cua validation model](https://cua.ai/docs/concepts/how-cua-driver-is-validated)

## Cua release-status addendum — 2026-09-22

**Published baseline.** The npm registry reports `@trycua/cua-driver` `latest` as
`0.28.2` (published 2026-09-15); the GitHub `cua-driver-rs-v0.28.2` release explains
that its GitHub “Pre-release” label is a monorepo convention and plain SemVer releases
are stable. The newer `0.28.3` artifact dated 2026-09-19 is explicitly a nightly
prerelease and is not an npm version. ([npm registry metadata](https://registry.npmjs.org/@trycua%2fcua-driver),
[0.28.2 release](https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.28.2),
[0.28.3 nightly](https://github.com/trycua/cua/releases/tag/nightly-cua-driver-rs-v0.28.3-nightly.20260919.35421378483))

1. **Safe Linux D-Bus process/window handoff identity: not present.** In the released
   Linux `launch_app`, Cua starts the launcher command itself and returns that child PID;
   it enumerates windows only for that same PID. The `xdg-open` path deliberately returns
   a null PID and no windows. This does not identify or securely bind a different process
   activated over D-Bus to the requested installed application. The current `main` launch
   implementation retains this same-PID behavior. ([tagged 0.28.2 Linux source](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.2/libs/cua-driver/rust/crates/platform-linux/src/tools/impl_.rs),
   [tagged Linux tool reference](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.2/docs/content/docs/reference/cua-driver/mcp-tools-linux.mdx),
   [current source at the 2026-09-22 main commit](https://github.com/trycua/cua/blob/681bc44807d1be81a4357f8e158f1c74a81d5a5b/libs/cua-driver/rust/crates/platform-linux/src/tools/impl_.rs))

2. **`cua.visual_regions_v1` plus capture-bound click: not in any npm-published
   `@trycua/cua-driver` version as of this date.** The latest npm version remains
   `0.28.2`; the 2026-09-19 `0.28.3` nightly tree also predates these visual files.
   Cua’s `main` gained the new work on 2026-09-22 at 20:59 UTC: a `parse_visual_regions`
   contract with schema `cua.visual_regions_v1`, plus Linux click admission bound to the
   exact screenshot `capture_id`. This is development-source evidence, not a released npm
   capability: the commit describes perception as an optional extension and says a Cua
   Driver feature release is still required. ([main commit](https://github.com/trycua/cua/commit/681bc44807d1be81a4357f8e158f1c74a81d5a5b),
   [visual contract](https://github.com/trycua/cua/blob/681bc44807d1be81a4357f8e158f1c74a81d5a5b/libs/cua-driver/rust/crates/cua-driver-contract/src/visual.rs),
   [capture-bound Linux click implementation](https://github.com/trycua/cua/blob/681bc44807d1be81a4357f8e158f1c74a81d5a5b/libs/cua-driver/rust/crates/platform-linux/src/tools/impl_.rs),
   [Linux tool reference](https://github.com/trycua/cua/blob/681bc44807d1be81a4357f8e158f1c74a81d5a5b/docs/content/docs/reference/cua-driver/mcp-tools-linux.mdx))

**Conclusion for Anesu:** neither requested capability is available from the currently
published `@trycua/cua-driver` package. The visual path has just appeared in Cua main and
must be rechecked after its feature release; the Linux D-Bus identity handoff remains
absent from the reviewed current source as well as the released tag.

### Release-source and bounded browser discovery check — 2026-09-22

**Visual availability.** The npm registry still reports `latest: 0.28.2` (published
2026-09-15), with no `0.28.3` package. Current `main` is
`681bc44807d1be81a4357f8e158f1c74a81d5a5b` (2026-09-22 20:59:27 UTC). Its
`cua.visual_regions_v1` source calls itself a transport-free contract; the corresponding
guide says the optional `cua-perception` extension is not release-verified and default
installs return `not_installed`. Main has Linux `capture_id` click admission, but the
published 0.28.2 Linux click API has no such input or visual-region contract. ([npm
package](https://www.npmjs.com/package/%40trycua/cua-driver), [main commit](https://github.com/trycua/cua/commit/681bc44807d1be81a4357f8e158f1c74a81d5a5b),
[visual contract](https://github.com/trycua/cua/blob/681bc44807d1be81a4357f8e158f1c74a81d5a5b/libs/cua-driver/rust/crates/cua-driver-contract/src/visual.rs),
[extension guide](https://github.com/trycua/cua/blob/681bc44807d1be81a4357f8e158f1c74a81d5a5b/docs/content/docs/how-to-guides/driver/parse-visual-regions.mdx),
[0.28.2 Linux source](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.2/libs/cua-driver/rust/crates/platform-linux/src/tools/impl_.rs))

**Bounded existing-profile discovery.** Attachment requires exact `pid`, `window_id`,
and session. Cua documents a browser-only manifest with explicit origins,
`existing_profile`, `desktop.display: false`, and `list_windows`. Yet Linux `list_apps`
has no filter and returns all running/installed apps, while `list_windows` can filter only
after a PID is known. Anesu's live 0.28.2 bounded probe refused unfiltered `list_windows`
with `desktop display observation is outside the capability manifest`. The least-privilege
route is therefore for a trusted host to supply the exact PID/window to the bounded grant;
Cua has no narrow Chrome-only discovery operation. Do not substitute global inventory or
enable full-display scope as if either were app-scoped discovery. ([bounded manifest
guide](https://cua.ai/docs/how-to-guides/driver/write-a-bounded-manifest),
[Linux tool reference](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.2/docs/content/docs/reference/cua-driver/mcp-tools-linux.mdx),
[profile attachment contract](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.2/docs/content/docs/reference/cua-driver/browser-profile-attachment.mdx))
