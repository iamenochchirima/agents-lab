# Harness coverage feature

This feature is the human-readable implementation map for the laboratory. It answers
what each platform variant has planned, implemented, and verified across the complete
agent harness surface. It also keeps layered platform compositions visible without
misrepresenting them as separate competitors.

`capabilityCatalog.ts` owns the shared questions every harness variant must address.
`coverageCatalog.ts` owns the current platform-specific assessments and combinations.
`coverageModel.ts` derives status and validates references. React components only
render and filter that model.

An omitted capability assessment means **not assessed**. Adding a capability to the
shared catalog therefore exposes the new gap for every variant automatically. A
capability is only **verified** when every checklist gate is complete and evidence is
linked. The interface is intentionally read-only so substantive status changes remain
visible in normal code review. Nested sections start collapsed so a reader can open one
level of detail at a time instead of scanning the complete matrix at once.

Suspension and resumption has its own capability. This keeps deliberate waiting and
continuation separate from crash recovery, human approval policy, and general run
lifecycle state.
