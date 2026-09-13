# Frontend library code

Contains narrow frontend modules for transport, formatting, schema parsing, and other shared behaviour with a clear owner.

`utils.ts` currently contains the `cn` helper required by the shadcn-compatible
primitives. Add other helpers only when they have a concrete shared interface.
