# Implementation plans

**Last updated:** 2026-09-20T12:42:28+02:00

Implementation plans are execution contracts for substantial work. Each plan records
scope, ownership, tests, validation, limitations, and the completion gate. Plans are
organized by the product they change.

```text
implementation-plans/
├── platforms/       # Temporal, Restate, LangGraph, Mastra, and other platforms
├── anesu/           # Computer Native agent
├── studio/          # Studio and component experiments
├── README.md
└── TEMPLATE.md
```

## Plan lifecycle

1. Create a dated plan in the product's `active/` directory.
2. Keep its checklist honest while work is in progress.
3. Record validation results and known limitations before completion.
4. Commit coherent implementation sections separately.
5. Add the completion timestamp and commit hashes.
6. Move the plan to that product's `completed/` directory.

Timestamps use ISO 8601 with a timezone. Start a new plan from
[the reusable template](TEMPLATE.md), then put it in the correct product directory.

## Product indexes

- [Platforms](platforms/README.md)
- [Anesu](anesu/README.md)
- [Studio](studio/README.md)

The product indexes are the authoritative lists of active and completed plans. Do not
add a plan directly to a shared `active/` or `completed/` directory.
