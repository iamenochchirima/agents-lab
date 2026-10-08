# Existing Lina reply and delivery audit

Reviewed 2026-10-08 against the working design, including uncommitted prior blocks. Output is still an empty reserved region. The preceding Environment slice records 140 nodes and 643 connections. This is a contract and fixture audit, not a live runtime inspection.

## Current ownership and gaps

Paths refer to [the Lina feature](../../../apps/web/src/features/lina/README.md).

| Existing file/owner | Preserve | Extend |
| --- | --- | --- |
| `contracts/shared.ts` | Output identity, category, saved flag, original channel/account/chat/topic/reply destination | Typed content, producer-specific nullable input identity, audience, provenance, finality, revision, ordered parts and artifact/prompt references |
| `contracts/inputExecution.ts`, `lina-input-delivery` | Retry saved output without agent rerun; unknown acknowledgement differs from failure; provider status is not human input | Keep Reply delivery handoff and connect to Output; send correlated observations to its receipt node |
| `contracts/turnExecution.ts` | Saved answer/failure output is separate from execution release | Declare owed reply or intentional quiet outcome, transfer required custody before release |
| `contracts/stateRecords.ts` | Delivery obligation and attempt/receipt references | Prepared parts, claim fencing, revisions, deadlines, custody and per-attempt evidence |
| `stateFixtures.ts` | Unknown delivery restores original saved answer and waits for reconciliation | Extend recovery through Output without replacing answer identity |
| `contracts/safetyPermissions.ts` | Prompt wait registered before delivery; four choices and scoped responders | Preserve exact choices, expiry and correlation; native fallback cannot remove a decision |
| `subagentHarness.ts` | Child results return internally to parent orchestration | External announcements need separately admitted publication intent |
| Model contracts/fixtures | Deltas, draft calls and authoritative terminal outcomes differ | Only admitted visible deltas enter previews; drafts cannot become validated finals |
| Environment contracts/fixtures | Retained artifact identity/custody survives workspace lifecycle | Upload from authorized retained bytes; owed output participates in cleanup/retention decisions |
| Tools/connection contracts | Tool authorization, credential references and readiness | Tool messages share Output evidence; no second credential store or uncharted send bypass |

The delivery handoff has no successors into an Output block. Its saved flag cannot establish durable storage. Current receipt fixtures do not establish platform delivery.

## Integration requirements

1. Bind incoming provider status by account, destination and provider message identity. Preserve it as transport evidence, not a new request.
2. Preserve original destination authority across retry. Account/thread changes require explicit authorization.
3. State supplies storage and owner fencing; Output supplies delivery semantics and scheduling. Use exact request/return correlations.
4. Execution can release after required custody transfer. Do not lock the agent loop until a person reads the answer. Unknown sends retain independent Output ownership.
5. Safety owns authorization; Input owns prompt answers. Displaying a prompt does not approve a tool. Stop invalidates its wait even if a message remains visible.
6. Child stdout/results remain internal. Publication is a separate parent or notification decision.
7. Keep raw model events, canonical answers and channel rendering separate. Reasoning, tool arguments and credentials are not automatically public.
8. An expiring URL or a sandbox path cannot replace retained artifact bytes. Preserve access policy and immutable identity.
9. Retry eligible remaining parts only. Identical text alone does not establish duplicate intent.
10. Preserve Auto, Next, follow/manual-follow and Stop with deterministic adapters. No real sends are needed for design verification.

## Contract changes

Use discriminated JSON Schema variants for finals, errors/refusals, previews/progress, interactive prompts, notices, tool sends and internal results. Canonical output carries provenance/audience; recipient plans carry immutable route authority and prepared parts; attempts carry claim/part/revision identities; raw observations remain append-only.

Extend State delivery statuses for preparation, queueing, in-flight, acceptance, failure, unknown, suppression and cancellation. Provider delivered/read observations remain independent. Sensitive non-durable policy must state its recovery limitation. A provider acceptance can settle the default send obligation without inventing a read receipt.

No runtime files changed. The [consolidated proposal](output-research.md) defines node boundaries and verification cases.
