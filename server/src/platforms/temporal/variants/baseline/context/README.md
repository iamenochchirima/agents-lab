# Context preparation

The Temporal baseline calls the common context service from an Activity. The workflow
stores only the session/turn identity and the resulting snapshot reference; it does
not put the transcript into workflow history.

`activities.ts::prepareContext` reloads the session, performs the preflight budget
check, invokes the selected model adapter only when a summary is needed, persists the
snapshot, and returns safe budget/compaction metadata. `activities.ts::requestModel`
then reloads that immutable snapshot and maps common messages to the provider request.

The server owns canonical session files under `AGENTLAB_CONTEXT_ROOT`. Temporal owns
workflow replay and cancellation. A provider-reported context overflow is classified
by the model adapter and gives the workflow one changed-input recovery pass keyed by a
new compaction revision. It is separate from pre-dispatch model retries.

Tool-call continuation messages stay as bounded workflow state for the current turn;
they are appended to the immutable snapshot only for the next Activity request. The
pure calculator execution itself runs in its own Temporal Activity and is never run in
the Workflow function.

Read the common contract in
[`server/src/capabilities/context`](../../../../../capabilities/context/README.md)
and the reference review in
[`docs/research/context-management-reference.md`](../../../../../../../docs/research/context-management-reference.md).
