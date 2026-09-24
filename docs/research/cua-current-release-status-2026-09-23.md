# Cua native-computer release status — 2026-09-23

**Scope:** Published `@trycua/cua-driver`, Linux visual-region/click support, and Linux app-launch identity. This is a release/source audit, not a claim that Cua supports every Linux application. Sources below are first-party Cua GitHub and npm metadata, checked for the 2026-09-23 cutoff.

## Findings

### Published package

The npm registry's `latest` dist-tag is **0.28.2**, published 2026-09-15 at 22:00 UTC. No higher `@trycua/cua-driver` package version appears in the registry metadata. GitHub labels the matching release “Pre-release” because this is a multi-product repository; the release notes say plain Cua Driver SemVer releases are stable and the label only protects the repository-wide “Latest” pointer. The 0.28.3 artifact dated 2026-09-19 is explicitly an opt-in nightly, not a published npm package. ([npm registry metadata](https://registry.npmjs.org/%40trycua%2Fcua-driver), [0.28.2 release](https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.28.2), [0.28.3 nightly](https://github.com/trycua/cua/releases/tag/nightly-cua-driver-rs-v0.28.3-nightly.20260919.35421378483))

### Linux visuals: released versus merged source

In the published 0.28.2 Linux tool reference, `get_window_state` returns an accessibility tree and screenshot. `click` accepts pixel `x,y` or a semantic element; semantic element actions can be tied to a `snapshot_id`. The released click schema has no screenshot `capture_id`, and the Linux tool list has no `parse_visual_regions`. Thus 0.28.2 offers pixel input, but not Cua-managed screenshot-to-region grounding or one-shot screenshot-bound pixel admission. ([0.28.2 Linux tool reference](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.2/docs/content/docs/reference/cua-driver/mcp-tools-linux.mdx))

Cua merged [PR #3943](https://github.com/trycua/cua/pull/3943) to `main` on 2026-09-22 at 20:59 UTC (merge commit [`681bc448`](https://github.com/trycua/cua/commit/681bc44807d1be81a4357f8e158f1c74a81d5a5b)). That source adds Linux `parse_visual_regions` and an optional `capture_id` on pixel clicks, binding a click to the exact registered screenshot. The PR describes perception as an opt-in `cua-perception` extension, states that a Cua Driver feature release is still required, and says the extension has a separate candidate-only release stream. The merged implementation is therefore real upstream work, but **not available in the published 0.28.2 npm package as of this cutoff**; it should not be represented as an installable released capability. ([merged Linux tool reference](https://github.com/trycua/cua/blob/681bc44807d1be81a4357f8e158f1c74a81d5a5b/docs/content/docs/reference/cua-driver/mcp-tools-linux.mdx), [extension lifecycle and boundaries](https://github.com/trycua/cua/blob/681bc44807d1be81a4357f8e158f1c74a81d5a5b/libs/cua-driver/docs/perception-extension.md))

### Linux launch PID and window handoff

The released `launch_app` path starts the supplied XDG `Exec=` command as a child and returns that child's PID. It then polls for windows **filtered to that same PID** for up to three seconds. Linux window discovery obtains the application PID from AT-SPI and applies the requested PID filter. The code does not show a D-Bus activation/owner lookup that transfers identity from an exiting launcher to a different process that owns the app window. ([0.28.2 Linux launch implementation](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.2/libs/cua-driver/rust/crates/platform-linux/src/tools/impl_.rs), [0.28.2 Linux AT-SPI window discovery](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.2/libs/cua-driver/rust/crates/platform-linux/src/atspi/native.rs))

The merged perception PR changes capture, click, and perception paths; it does not add launch-PID handoff. A caller may separately request unfiltered window enumeration, but that is broader discovery, not a launch-scoped D-Bus identity transfer. Accordingly, neither the 0.28.2 release nor the merged visual feature establishes reliable support for a DBus-activated GNOME app whose launcher exits before its window can be bound.

## Implication for GNOME Calendar and Clocks

**No released Cua capability verified here is an end-to-end unblock for Calendar or Clocks.** The 0.28.2 package lacks visual-region parsing and capture-bound clicks. The merged perception source could help ground controls after the exact app window is available, once both the Driver feature and optional extension are actually released and installed. It does not solve launch/window identity handoff. Its documented contract parses screenshot regions; the cited materials do not define Calendar/Clocks postconditions proving an event was saved or an alarm enabled. The inspected first-party release materials do not certify either GNOME app as supported.

This conclusion is limited to the cited release and source contracts; it is not proof that every D-Bus-launched application fails or that no downstream caller can discover a window through broader enumeration.
