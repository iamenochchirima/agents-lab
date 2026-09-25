# Input module

This package defines the input-normalization seam for Studio. It accepts raw text
and attachment references with host-supplied provenance, then describes the
normalized task data expected by later modules. It does not open files, fetch URLs,
or decide whether a source is safe to trust.

`InputNormalizer.normalize` is synchronous and should be bounded by
`maxTextBytes` and `maxAttachments`. The contract preserves the source trust label;
normalization does not upgrade untrusted content. Invalid data and configured size
limits should be reported as `InputNormalizationError`. No external side effects or
module-owned state are expected. Because normalization is synchronous, cancellation
is not part of this first interface; an implementation doing asynchronous ingestion
must define cancellation explicitly before adopting that behavior.

Configuration defaults are exported as `DEFAULT_INPUT_CONFIG`. Use
`parseInputConfig` before constructing an implementation; unknown settings and
values outside the documented integer bounds are rejected.

| Setting | Default | Accepted range |
| --- | ---: | ---: |
| `maxTextBytes` | 64,000 | 1–10,000,000 |
| `maxAttachments` | 16 | 0–1,000 |

```ts
import { parseInputConfig } from "@agent-harness-lab/module-input";

const config = parseInputConfig({ maxAttachments: 4 });
```

```sh
pnpm --filter @agent-harness-lab/module-input typecheck
pnpm --filter @agent-harness-lab/module-input test
```

This package currently defines the interface and config contract. It does not
include a file, image, event, or API ingestion implementation.
