# Observability module

Observability records ordered protocol events while preserving module-specific
detail. The package includes a run-scoped JSONL baseline that can be built and
checked without the Studio API or agent kernel.

## Construct a recorder

The host provides an existing real directory and the run scope. The recorder
creates one event file beneath it:

```ts
const observability = createJsonlObservability(config, {
  rootDirectory: "/var/tmp/agent-runs",
  scope: { runId },
});

const append = await observability.append({ event, moduleDetail }, signal);
const flush = await observability.flush({ runId }, signal);
```

The path is `run-${encodeURIComponent(runId)}/events.jsonl`. The root and run
directories must be real directories, not symbolic links. The implementation
uses no-follow file opens and requires a POSIX Node filesystem that supports
file and directory sync. The host should keep the run directory private to the
run and give each run exactly one active recorder writer. There is no
cross-process lock; concurrent writers for the same run are unsupported. The
checks reject pre-existing symlinks and hard links, but they do not defend
against a hostile process that can replace parent directories concurrently; the
host must supply a trusted root writable only by the host.

## Event and receipt behavior

Events must have a valid run ID, RFC 3339 timestamp, source identity, JSON
payload, and non-negative safe-integer sequence. Sequence numbers must increase
strictly, but need not be contiguous. The host supplies event IDs, sequences,
timestamps, and the run scope; the module does not generate or reorder them.

An identical event ID and sequence retry returns `duplicate`. Reusing an ID or
sequence with different content, an older sequence, an invalid event, or a
capacity limit returns `rejected`. Module detail keeps its owning module and
schema version instead of being flattened into normalized event fields.

The recorder buffers up to the configured event and byte limits. An `accepted`
receipt can therefore be `buffered` or `durable`. `durable` is returned only
after Node reports successful sync of the event file and its containing run
directory. This is the filesystem's sync acknowledgement; hardware and remote
filesystem guarantees remain outside the module. A flush returns:

- `durable` when no events remain pending.
- `partial` when cancellation occurs before storage begins and events remain
  buffered.
- `failed` for a run-scope or initialization failure that needs host attention.
- `unknown` when a write or sync may have reached storage without a reliable
  acknowledgement.

An unknown write remains pending. A later flush rereads the file, matches
complete records against pending IDs and sequences, truncates an incomplete
trailing line, and writes any missing events. Complete malformed lines and
blank lines fail closed rather than being discarded. `append` throws a typed
`ObservabilityError` if storage cannot be initialized; invalid event data is
reported as a rejected receipt. Cancellation is checked before I/O begins. An
in-progress filesystem call is allowed to finish and its outcome is reported
normally or as unknown.

The config bounds buffered events and bytes, each event and module detail,
tracked event identities, and total stored bytes. A run file is capped at 32 MiB
by default and 64 MiB at most. JSON payloads deeper than 64 levels or larger than
the configured limits are rejected before serialization. Use the same or larger
limits when reopening an existing run, or the recorder may refuse the file. This
baseline does not compact old runs, redact content, or coordinate multiple
writers.

## Independent checks

```sh
pnpm --filter @agent-harness-lab/agent-protocol build
pnpm --filter @agent-harness-lab/module-observability typecheck
pnpm --filter @agent-harness-lab/module-observability test
```

Build the shared protocol package first in a fresh checkout because its emitted
declarations are a package dependency. The tests exercise ordering, duplicates,
bounded input, restart recovery, path symlinks, storage failure, and an
acknowledgement lost after file sync.

## Studio kernel integration

For the reference assembly, the kernel creates event IDs, increasing sequence
numbers, timestamps, source identities, normalized payloads, and module detail
from the accumulated successful or partial turn evidence. It appends the ordered
events and attempts a terminal flush after the run has finished or failed. The
kernel uses a cleanup signal for that attempt so turn cancellation does not
silently skip evidence persistence.

The Studio API owns the trusted root and writes `config.json` before the turn and
`result.json` after its terminal path. A response exposes the recorder's append and
flush receipts without exposing the local path. Event writing is post-run rather
than streaming, so an abrupt process failure during active work can leave a
configuration without a terminal result. This integration does not provide run
resumption, cross-process writer coordination, retention, or redaction.
