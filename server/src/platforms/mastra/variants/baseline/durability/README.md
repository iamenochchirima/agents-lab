# Durable baseline execution

Opt-in sustained execution wraps the regular agent with the pinned native
`createDurableAgent`. Mastra owns orchestration, suspension, nested workflow state,
and recovery. The Lab adapter owns admission, evidence, deadlines, local ownership,
and the external dispatch safety journal.

`recovery-snapshots.ts` installs public `pruneSnapshot` policies recursively. Core
1.66.0 otherwise removes `messageListState` from a completed mapping output while
an LLM step runs. Native restart reuses that output and fails deserialization.
Complete running snapshots are retained; original suspended/terminal pruning stays
in force. Extra private storage is bounded by admitted rounds/tool calls. Remove
this workaround only after the killed-worker test passes without it against a
validated SDK version. Dependencies and SDK source files are unchanged.

See [platform semantics](../../../docs/semantics.md) for recovery boundaries.
