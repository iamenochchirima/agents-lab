# Lina terminal design prototype

`lina-tui-prototype.html` is a standalone, disposable HTML design board. It has
five terminal-state cards and three structural layout variants. All activity,
permissions, usage and decisions are sample data; there are no API calls.

Run the existing frontend with `pnpm dev`, then open
`http://127.0.0.1:5173/prototypes/lina-tui-prototype.html`.
The file is outside `public/` and is not a production build entry, so it is not
copied into the deployed app. It also works as a standalone HTML file.

Each card opens a full-window layout. Bottom arrows switch the conversation-first,
live-inspector and session-workspace variants. Tool details expand, sample approval
buttons show a mock result, and selecting an agent updates its sample transcript.
The displayed keyboard hints describe the proposed TUI; this HTML does not
implement every terminal shortcut, scheduling or agent control.

Question: does this full-screen interaction and visual hierarchy fit Lina?
No variant has been selected. Do not promote this code into the real TUI.

Copy and control review:

- Screen titles name the task rather than describe the design's appeal.
- Approval scope is visible before selection. Allow once covers the shown change;
  session and saved permissions cover edits to the named file in this workspace.
  This is a sample scope for design review, not an implemented permission rule.
- Pending approval counts agree across screens. The Agents screen also includes a
  completed subagent; the activity screen shows the currently running subagent.
- The agent panel has one activity view. Separate operations and result tabs are
  omitted until their contents and navigation are designed.
- Guidance and stop controls are disabled for the main agent and completed
  subagents. The main conversation is the place to guide the main agent.

The Sessions card is accessible through Browse sessions on the opening screen.
Search filters the sample list by title or workspace. API validation opens the
existing activity preview; other entries show a sample summary. Session storage
and resumption are not implemented here.
