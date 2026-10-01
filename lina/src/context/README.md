# Context Management

Context Management owns the exact input sent to a model. It selects and labels the
configured system instruction, workspace resources, skill summaries, bounded memory,
transcript history, the current prompt, and tool definitions. It does not call a
provider, execute a tool, or make an approval decision.

## Public seam

`ContextManager.prepare` returns two related values:

- `request`, the in-memory model request with the selected message bodies.
- `snapshot`, bounded evidence for the request. It contains source identities, hashes,
  recomputable source and compaction revision digests, byte counts, selection
  decisions, budget accounting, and compaction metadata. It does not contain raw
  workspace or memory bodies.

The runtime publishes the snapshot through `TurnStore.writeContextSnapshot` before it
starts a provider attempt. Retries reuse the same prepared request. Tool rounds use
`prepareRound` projects runtime-owned tool messages without rereading workspace resources
or memory records. It may omit only complete older tool exchanges when the request byte
bound requires it; the canonical turn records are unchanged. `requestForRound` remains a
compatibility helper for callers that only need the projected request. The runtime's
combined cancellation signal is checked at context preparation boundaries, so a
cancelled turn is terminalized before provider transport.

Known provider credentials and credential-shaped values are redacted at the Context
Management boundary across the configured instruction, workspace resources, skill
catalog, memory, transcript history, and current prompt before those values enter the
provider request. Canonical transcript persistence applies its own redaction boundary;
the context boundary remains necessary for callers that provide in-memory history.

## Source order and trust

The current order is deterministic:

1. configured system instruction
2. `SOUL.md`, `IDENTITY.md`, `USER.md`, and `AGENTS.md` at the workspace root
3. compact summaries from `skills/**/SKILL.md`
4. bounded user and workspace memory records
5. bounded transcript history
6. the current user prompt
7. registered tool definitions

Selection order and admission order are separate decisions. When the serialized request
is still above `maxRequestBytes` after bounded history compaction, the context manager
omits complete optional source groups in this fixed order: memory, the skill catalog,
`AGENTS.md`, `USER.md`, `IDENTITY.md`, then `SOUL.md`. Each omission remains in the
snapshot with `reason: "request-budget"`; it is never an unexplained disappearance from
the request. The system instruction, current prompt, registered tool definitions, and
already-selected transcript groups are not removed by this preflight step. If those
required parts alone cannot fit, preparation fails before provider transport. A request
that fits only after this lossy admission step reports `pressure: "compaction_due"`,
so the durable context event and `/context` view make the omission visible even though
the final serialized request is under the byte limit.

Workspace resources and memory are labelled data. Skill text is labelled procedure.
Neither can change approval, filesystem, process, browser, memory, or isolation policy.
The runtime-owned process policy still enforces its configured output limit even when
workspace instructions ask a model to ignore it; the same authority boundary is enforced
by the tool and approval modules for other side effects.
Tool definitions come from the runtime and do not grant authority by appearing in the
request.

Workspace reads go through `WorkspaceSecurityPolicy`, so absolute paths, traversal,
symlink targets, invalid UTF-8, and oversized files do not enter context. Missing or
invalid optional resources are recorded as omitted with a bounded reason. The runtime
passes its cancellation signal into each resource read; bounded descriptor reads check
between chunks so an in-flight read can stop before context publication.

## Limits and compaction

The assembler records UTF-8 request bytes separately from a conservative input-token
estimate and the output bytes reserved by the runtime. The estimate uses a documented
UTF-8-bytes-to-four basis by default. A provider-specific counter can be injected only
when its basis and quality are explicit. It is not an exact provider tokenizer count by
default, and the current provider window is represented as unknown rather than a
made-up percentage.

Source content has bounded limits. If the request exceeds its byte limit and enough
transcript exists, the current deterministic compactor replaces complete older
transcript-turn groups with a bounded system-labelled record containing short escaped
role, turn, and content snippets. The record is explicitly untrusted transcript data,
and the two newest turn groups plus the current prompt remain intact. The snapshot
records removed and retained message and group IDs, plus the serialized request bytes
observed before and after compaction. The deterministic summary is bounded, but its
labels can add overhead; the after value is an observation, not an assumption that
compaction always makes the request smaller. A malformed custom compactor
selection fails closed. The compactor is an explicit interface, so a later semantic
summarizer can replace this deterministic strategy without changing the runtime seam.
If the result still exceeds the request limit, the
runtime records the normal `ModelRequestRejected` outcome and does not invoke the
provider. If a provider explicitly reports a context-window rejection before emitting
output, the runtime performs at most one request-local recovery: it omits optional
source groups without rereading them, publishes a new context revision, and sends that
different request once. A second provider rejection remains a typed
`provider-context` failure; the same request is never retried unchanged.

The history message bound is applied to complete persisted transcript turns rather than
to arbitrary individual messages. The newest turn is retained even when it exceeds the
nominal message bound, because sending only half of that exchange would create a
misleading conversation. Model-based semantic summaries and model-specific token-counter
implementations remain planned follow-on work. Runtime tool-round compaction now keeps
the latest complete exchange and records omitted group IDs; it is deterministic
truncation, not a semantic summary.

Compaction is request-local and bounded by the context manager's compaction deadline
(5 seconds by default, or the explicit compactionTimeoutMs option). A custom async
compactor receives the turn cancellation signal and must treat it as advisory input,
not as permission to publish state. Cancellation or deadline expiry returns before the
runtime publishes a context snapshot; the default synchronous compactor remains
deterministic and cannot perform external side effects.

Each recovery revision links to its predecessor. The active revision remains in
`context.json`; earlier revisions are archived under `context-revisions/` so the
published request history can be checked without retaining raw request bodies. Snapshot
digests use canonical serialization, so an atomic writer's key ordering cannot make a
valid persisted revision fail validation. If an acknowledgement is lost after the
predecessor archive or active snapshot is written, retrying the same revision is safe;
the retry also repairs missing companion `compaction.json` evidence.

Context evidence follows the owning session/turn evidence lifetime. It is retained with
the turn so `/context`, restart recovery, and audit can inspect the exact prepared
request; the context module does not run an independent timer or silently delete a
snapshot that another turn record may reference. The first slice has no session-evidence
deletion command, so removal is not performed automatically. A future retention feature
must operate at the session-evidence boundary, preserve the integrity of surviving
revision links, and record what was removed before it is enabled.

## Inspection

After a turn, `/context` shows the latest snapshot ID and revision, pressure, request
and input bytes, estimated tokens, compaction status, and each source's selected,
truncated, or omitted status. Durable `ContextPrepared`, `ContextCompacted`,
`ContextRoundCompacted`, and `ContextPressure` events carry the same bounded facts. It
does not print raw instruction, memory, or workspace content by default.
