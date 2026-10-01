# Input module

Input converts one host-provided text request into provenance-preserving task
data. The first implementation is `text-input-normalizer` version `0.1.0`. It
is synchronous, deterministic, stateless, and has no external effects. It does
not authenticate the host's provenance claims or decide whether content is safe
to trust.

## Use

```ts
import { createTextInputNormalizer } from "@agent-harness-lab/module-input";

const normalizer = createTextInputNormalizer({ maxAttachments: 4 });
const normalized = normalizer.normalize(
  { text: "Summarize the supplied notes." },
  {
    sourceId: "request-123",
    kind: "user",
    trust: "untrusted",
    receivedAt: "2026-09-25T09:30:00Z",
  },
);
```

The task text is returned byte-for-byte as a JavaScript string; it is not
trimmed or rewritten. The text part ID is `input:<encoded-source-id>:text`.
Attachment part IDs are `input:<encoded-source-id>:attachment:<encoded-id>`.
The encoding is `encodeURIComponent`, so equal inputs always produce equal IDs.
Source metadata and attachment references are copied into frozen output objects.

The normalizer requires non-empty, well-formed Unicode text, rejects text made
only of whitespace, and counts its UTF-8 encoded bytes against `maxTextBytes`.
It checks the host source ID, kind, trust label, and `receivedAt`. Receipt times
must be valid RFC 3339 date-times with `Z` or a numeric offset. Calendar dates
and clock fields are checked, including known UTC leap-second dates through
2016. Source trust and timestamps are preserved exactly as supplied; the
normalizer does not upgrade trust or convert timestamps.

Attachments are optional references with a unique non-empty ID, name, media
type, and non-negative safe-integer byte length. The count is bounded by
`maxAttachments`; referenced bytes are not opened, fetched, or verified. Their
names and media types are metadata only, not paths or permissions. Unknown
fields in the raw request, source metadata, or attachment references are
rejected so that unrecorded input is not silently ignored.

## Configuration and failures

`createTextInputNormalizer(config?)` parses its argument with
`parseInputConfig`; omitted settings use `DEFAULT_INPUT_CONFIG`. Unknown
settings and values outside these integer ranges throw `InputConfigError` at
construction.

| Setting | Default | Accepted range |
| --- | ---: | ---: |
| `maxTextBytes` | 64,000 | 1–10,000,000 UTF-8 bytes |
| `maxAttachments` | 16 | 0–1,000 references |

`normalize` throws `InputNormalizationError` with one of these codes:

- `INVALID_RAW_INPUT`: missing or malformed text, attachment list, or
  attachment metadata.
- `INVALID_SOURCE_METADATA`: malformed or unsupported provenance fields,
  including an invalid RFC 3339 timestamp.
- `INPUT_TOO_LARGE`: the UTF-8 text byte limit or attachment-count limit is
  exceeded.

Calls have no state to restore or mutations to deduplicate. Repeating the same
valid inputs with the same config produces the same result, so callers may
retry a failed call after correcting its input without coordinating with Input.
The implementation owns no session or durable state.

## Independent checks

After installing workspace dependencies, run:

```sh
pnpm --filter @agent-harness-lab/module-input typecheck
pnpm --filter @agent-harness-lab/module-input test
```

The package only references `@agent-harness-lab/agent-protocol` types while
building. Its check commands resolve those types from the protocol source and
do not require a prior protocol build or Studio service.
