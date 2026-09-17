# Write-tool and approval comparison

Reviewed: 2026-09-15

This note narrows the reference set for the next Anesu implementation
slice: safe workspace mutations and approval. Hermes and OpenClaw are the
primary references. Waku remains useful for its small tool registry and visible
model/tool loop, but it is not the design authority for mutation safety.

## What the primary references contribute

### OpenClaw: tool boundaries and approval timing

OpenClaw documents `apply_patch` as a structured editing subtool of `exec`.
Its documented defaults include workspace-only operation, and its tool-policy
documentation makes an important distinction: disabling one file-writing tool
does not make a general shell tool read-only. The policy must account for the
whole mutation surface.

OpenClaw's permission-request flow places approval after the model has selected
the tool but before the tool executes. The approval request has a bounded title
and description, supports allow-once or deny decisions, and fails closed for
unknown or malformed decisions. This gives us a useful boundary: the model may
propose a mutation, but the runtime owns the final decision and the side effect.

Sources:

- [OpenClaw exec, `apply_patch`, and tool policy](https://github.com/openclaw/openclaw/blob/main/docs/tools/exec.md)
- [OpenClaw plugin permission requests](https://github.com/openclaw/openclaw/blob/main/docs/plugins/plugin-permission-requests.md)
- [Local OpenClaw code map](harness-code-maps/openclaw.md)

### Hermes: staged writes and reviewable pending changes

Hermes's `write_approval.py` provides the stronger reference for the mutation
record itself. It separates the write-approval decision from the write tool,
stages writes that need approval, retains the exact payload needed for replay,
and can produce a unified diff for file edits. It also distinguishes the
foreground approval path from writes that must remain pending until they can be
reviewed.

The useful design lesson is not to hide a write behind a generic success
response. A pending mutation should remain inspectable, tied to the exact
requested content, and explicit about whether it was approved, rejected, or
applied.

Source:

- [Hermes write-approval gate and pending store](https://github.com/NousResearch/hermes-agent/blob/main/tools/write_approval.py)
- [Local Hermes code map](harness-code-maps/hermes.md)

### Waku: secondary reference for registration and looping

Waku is a useful small-scale reference for registering tools, validating input,
and emitting visible loop events. Its reviewed workspace and memory tools do
not provide the same general approval boundary as the OpenClaw and Hermes
patterns above, so we should not use Waku as the mutation-safety model.

Source:

- [Local Waku code map](harness-code-maps/waku.md)

## Decision for Anesu

The next slice should use specialized workspace mutation tools, with approval
implemented as a runtime boundary rather than as a prompt instruction or a
second model-facing tool.

1. Make `apply_patch` the primary mutation tool. It should accept a structured
   unified patch, constrain paths to the configured workspace, and produce a
   deterministic diff before any write occurs.
2. Add `write_file` only when the implementation has a concrete need for
   explicit whole-file creation or replacement. Do not make arbitrary shell
   execution the fallback for file edits.
3. Pause before the side effect and show the user the affected paths, operation
   type, and diff summary. The first slice should support allow-once and deny;
   persistent allow rules can wait until the approval lifecycle is proven.
4. Store a pending mutation with the exact patch or content, a content/version
   check, and a stable identifier. The lifecycle should be explicit:
   `proposed`, `approved`, `rejected`, `applied`, `failed`, or `expired`.
5. Apply approved changes atomically where the platform permits it. If the
   expected file version has changed, refuse the stale mutation and require a
   fresh proposal rather than overwriting newer user work.
6. Keep the initial boundary narrow: no shell execution, deletion, browser
   control, memory/skill writes, or multi-agent delegation in this slice.

## Validation expected for the slice

Tests should cover valid and invalid patches, path escapes, approval denial,
approval timeout or unavailable approval, stale-content rejection, atomic
failure behaviour, restart with a pending mutation, duplicate approval, and
the TUI's rendered diff and final result. The implementation should preserve
the model's original tool call and the runtime's approval and mutation events
in the execution record.
