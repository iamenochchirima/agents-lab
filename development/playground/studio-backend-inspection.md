# Inspecting a Studio comparison through the backend

This walkthrough inspects the current deterministic Studio backend. It is a
development playground, not a scenario or benchmark. It does not require a model
provider credential.

## Start the existing Lab server

From the repository root:

```bash
pnpm --dir server run build
AGENTLAB_STUDIO_RUN_ROOT="$PWD/lab/studio-runs" pnpm --dir server run start
```

The default local API address is `http://127.0.0.1:4318`. Keep the server process
running in one terminal and use another terminal for the requests below.

## Inspect the catalog

```bash
curl -sS http://127.0.0.1:4318/api/studio/catalog
curl -sS http://127.0.0.1:4318/api/studio/health
```

Only Context Management and Memory are currently executable. The other component areas
are returned as planned and must not be presented as runnable by a client.

## Submit a Memory comparison

```bash
curl -sS -X POST http://127.0.0.1:4318/api/studio/comparisons \
  -H 'content-type: application/json' \
  -H 'x-idempotency-key: playground-memory-1' \
  --data-raw '{
    "system": {"id":"neutral-agent","version":"1"},
    "environment": {"id":"deterministic-replay","version":"1"},
    "experiment": {
      "id":"compare-memory-retrieval",
      "version":"1",
      "scenario":{"id":"memory-previous-preference","version":"1"},
      "subject":{
        "component":"memory",
        "strategies":[
          {"id":"no-memory","version":"1","parameters":{}},
          {"id":"semantic-keyed-facts","version":"1","parameters":{}}
        ]
      }
    },
    "seed":"playground-seed-1"
  }'
```

Copy the `manifest.comparisonId` from the response into `COMPARISON_ID` below.

```bash
export COMPARISON_ID='studio-...'
curl -sS "http://127.0.0.1:4318/api/studio/comparisons/$COMPARISON_ID"
curl -sS "http://127.0.0.1:4318/api/studio/comparisons/$COMPARISON_ID/events?after=0&limit=500"
```

The comparison projection should show two strategy slots with the same
`fixedControlFingerprint` and different Memory strategy identities. The semantic policy
should retrieve `memory-fact-language`; the no-memory control should not.

## Inspect durable evidence

Find the trial IDs in the comparison projection, then request the allowlisted files:

```bash
export TRIAL_ID='studio-...-trial-2'
curl -sS "http://127.0.0.1:4318/api/studio/comparisons/$COMPARISON_ID/evidence/trials/$TRIAL_ID/config.json"
curl -sS "http://127.0.0.1:4318/api/studio/comparisons/$COMPARISON_ID/evidence/trials/$TRIAL_ID/context.json"
curl -sS "http://127.0.0.1:4318/api/studio/comparisons/$COMPARISON_ID/evidence/trials/$TRIAL_ID/memory.json"
curl -sS "http://127.0.0.1:4318/api/studio/comparisons/$COMPARISON_ID/evidence/trials/$TRIAL_ID/memory/records.json"
curl -sS "http://127.0.0.1:4318/api/studio/comparisons/$COMPARISON_ID/evidence/trials/$TRIAL_ID/memory/events.jsonl"
curl -sS "http://127.0.0.1:4318/api/studio/comparisons/$COMPARISON_ID/evidence/trials/$TRIAL_ID/memory/decisions.jsonl"
```

The Memory journal records the policy ID and version, namespace, previous revision,
record IDs, operation IDs, decision reasons, and timestamp. The Context projection
shows only the Memory records that reached the model-bound Context. These are separate
observations.

## Check idempotency and unsafe paths

Repeat the original POST with the same `x-idempotency-key`. It must return the same
comparison ID and must not create another trial or Memory operation. Change the seed
while keeping the same key. The server must return a conflict.

An evidence path such as `../config.json` or an unlisted file must not be readable:

```bash
curl -i "http://127.0.0.1:4318/api/studio/comparisons/$COMPARISON_ID/evidence/../config.json"
curl -i "http://127.0.0.1:4318/api/studio/comparisons/$COMPARISON_ID/evidence/trials/$TRIAL_ID/memory/secret.txt"
```

Cancellation is exposed at the comparison boundary:

```bash
curl -sS -X POST "http://127.0.0.1:4318/api/studio/comparisons/$COMPARISON_ID/cancel" \
  -H 'content-type: application/json' \
  --data '{"reason":"stop polling this comparison"}'
```

The deterministic replay request normally reaches a terminal state before a second
request can interrupt it. The endpoint is still idempotent for terminal comparisons;
live cancellation boundaries are exercised with the blocking adapters in
`server/tests/studio/comparison-service.test.ts`. Those tests also cover a restart
after a journal append, acknowledgement loss after snapshot publication, cancellation
before retrieval, and cancellation with an applied Memory write.

The same test files are the failure-injection procedure for this local slice:

```bash
node --test server/dist/tests/studio/comparison-service.test.js \
  server/dist/tests/studio/memory/repository.test.js
```

For a restart check, stop after the Memory comparison has produced its evidence, start
the server with the same `AGENTLAB_STUDIO_RUN_ROOT`, and repeat the GET requests. The
comparison ID and journal-backed Memory revision should remain stable. The repository
is local evidence storage, not a hosted multi-tenant Memory service.

## Interpret the result

This replay run proves that the selected deterministic policies produced the recorded
retrieval, Context, Memory, and lifecycle evidence for this fixture. It does not prove
that semantic-keyed facts are generally better than no Memory, nor that the replay
adapter measures a real model's quality.
