# Terminal UI reference comparison

Reviewed: 2026-09-15

This note compares the user-facing terminal interfaces of Hermes and OpenClaw with
Computer Native's current `readline` loop. The comparison is design input only. It does
not recommend importing either project's UI or runtime.

## Sources

- [Hermes TUI guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/tui.md)
- [Hermes TUI implementation notes](https://github.com/NousResearch/hermes-agent/blob/main/ui-tui/README.md)
- [OpenClaw TUI guide](https://github.com/openclaw/openclaw/blob/main/docs/web/tui.md)
- [OpenClaw TUI command reference](https://github.com/openclaw/openclaw/blob/main/docs/cli/tui.md)
- Local source maps: `docs/research/harness-code-maps/hermes.md` and
  `docs/research/harness-code-maps/openclaw.md`

## Comparison

| Surface | Computer Native now | Hermes | OpenClaw |
| --- | --- | --- | --- |
| Startup | A few plain lines with session/model | Banner, runtime details, tools/skills panels, first frame before full load | Connection/session startup state and model/session context |
| Conversation | `readline` input and direct output | Scrollable transcript with distinct user/assistant rows and live streaming row | Scrollable chat log with user, assistant, system, and tool entries |
| Input | Single line, terminal-default editing | Multiline composer, history, completion, editor handoff, queueing | Custom editor, history, slash completion, session and model controls |
| Busy state | No durable UI state; text is printed while waiting | Live spinner/status indicator, elapsed time, reasoning/tool activity | Connected/idle/busy status, streaming updates, tool cards, reconnect notices |
| Commands | `exit` and `quit` only | Categorized slash commands, command completion, overlays and pickers | Slash commands, session/model/agent pickers, settings and overlays |
| Tool visibility | Not implemented | Separate activity lane with tool progress and prompt flows | Tool execution cards and event-driven activity display |
| Interruptions | Ctrl-C can cancel a turn | Interrupt, redirect, queued input, modal prompt cancellation | Explicit abort/reset/reconnect behavior and status notices |
| Persistence view | Session ID is printed | History/session switching and transcript inspection | History loading, session picker, reconnect and event-gap handling |
| Terminal behavior | Scrollback-oriented plain output | Alternate screen, differential redraw, mouse selection, responsive layout | Responsive TUI with streaming updates, wrapping, and overlays |

## What is worth adopting

The useful shared pattern is a stateful presentation layer around a structured runtime:

1. Keep a transcript model separate from the renderer. A streamed assistant message is
   one visible row that updates until completion; it should not be printed as unrelated
   chunks.
2. Keep a live activity/status area separate from the transcript. Waiting, model
   streaming, tool execution, cancellation, and failure should be visible without
   pretending that an unimplemented tool ran.
3. Give the composer its own interface: multiline editing, input history, slash-command
   completion, and clear interrupt/exit rules.
4. Use overlays or panels for structured choices later, such as model/session selection
   or approval. Do not encode those flows as opaque prose in the model response.
5. Make the top and bottom status surfaces factual: provider/model, session, workspace,
   active state, elapsed time, and recorded evidence location. Values must come from the
   application/runtime.
6. Make the terminal responsive and recoverable: handle resize, long-line wrapping,
   cancellation, clean exit, and a non-TTY fallback.

## What should not be copied into the current slice

- Remote Gateway connections, multi-session dispatch, subagents, memory, browser
  integrations, approvals, and provider dashboards.
- Hermes's large slash-command catalogue or OpenClaw's Gateway/session model.
- Fake tool cards, fake token/cost data, or a status indicator that claims capabilities
  the Computer Native runtime does not yet provide.

## Computer Native recommendation

The next UI implementation should create a small terminal application module with this
layout:

```text
┌ session · provider/model · workspace ┐
│                                      │
│ transcript viewport                  │
│   You                                │
│   Agent (streaming)                  │
│   activity: waiting/tool/error       │
│                                      │
├ state · elapsed · evidence ──────────┤
│ You › multiline composer             │
└ /help · Ctrl+C cancel · Ctrl+D exit ┘
```

The first implementation should support a real transcript viewport, streaming text,
provider/model/session status, elapsed waiting state, input history, multiline input,
slash-command completion for the commands that actually exist, and cancellation. The
runtime should emit typed turn/activity events; the TUI should render them and own no
model, tool, security, or persistence logic.

This is a larger interface for the existing standalone agent, not a separate product
layer. It should be tested through a pseudo-terminal for rendering and interaction, with
the deterministic provider used for repeatable turn behavior.
