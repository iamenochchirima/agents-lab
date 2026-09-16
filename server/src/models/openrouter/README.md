# OpenRouter provider boundary

This module owns the Lab server's searchable OpenRouter model catalog. It calls
`GET /api/v1/models` with the server-side `OPENROUTER_API_KEY`, filters the result
to text-capable models, normalizes only safe metadata, and caches bounded results
in memory for a short period.

Platform model completions remain inside each platform directory because their
request, retry, cancellation, and recovery semantics belong to that platform.
The catalog is for selection; it is not a completion proxy.

The browser receives model IDs, names, modalities, context length, tool support,
and compact pricing metadata. It never receives credentials or upstream response
bodies. At run admission, the server resolves the selected model ID again and freezes
the returned context length in the manifest, so browser-supplied metadata cannot change
the budget used for context preparation. The selected model ID is retained in the
existing run manifest so a run can be inspected and compared later.
