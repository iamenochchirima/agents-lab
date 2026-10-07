# Lina tool outcomes and loop limits

Extend the existing Input → Turn Execution design simulation with known tool
outcomes and a visible logical-round budget. No real model or tool runs.

- [x] Add limit and tool-outcome decision nodes with inspectable branch edges.
- [x] Preserve saved positions, notes and custom architecture components.
- [x] Add correctable tool error followed by a successful replacement call.
- [x] Add terminal tool and non-retryable model failure cases.
- [x] Add explicit continuation until the configured round limit stops execution.
- [x] Configure maximum rounds in the Run modal and retain it on Reset.
- [x] Count logical rounds separately from provider attempts.
- [x] Use identical progression in automatic and manual playback.
- [x] Distinguish completed, failed and exhausted turn outcomes.
- [x] Verify routes, limit enforcement, retry accounting and architecture refresh.
- [x] Update usage documentation and record remaining boundaries.

The simulator compiles deterministic responses through a round-limit policy and
stores state after each graph visit. Playback reveals those visits and counters;
it never sends a request. A provider retry stays in its original round. The
correction case needs three rounds, so a smaller budget can exhaust before an
answer. Failed/exhausted playback ends after settlement and owner release without
claiming successful output or draining queued work.

Validation: 31 focused tests, TypeScript compilation, production build, and live
browser checks for both playback modes. Waiting/resumption, active cancellation,
uncertain effects, partial/parallel tool batches and durable recovery remain
separate follow-ups.
