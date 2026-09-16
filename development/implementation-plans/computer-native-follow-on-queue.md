# Computer Native implementation queue

This page is a status map, not a completion claim. A completed slice means that the
bounded scope in its plan was implemented and tested. It does not mean that the area is
complete for a mature or production-ready Computer Native product.

The full production-readiness definition is in
[Computer Native production-readiness gaps](active/computer-native-production-readiness-gaps.md).

## Current implementation slice

### Core hardening and production foundation

Status: **Active. Not implemented end to end.**

Plan: [computer-native-core-hardening.md](active/computer-native-core-hardening.md)

The following work is still required in this slice:

- [ ] Shared runtime state transitions for turns, attempts, approvals, tools, and final
      outcomes.
- [ ] Restart recovery, duplicate-event handling, cancellation, retry limits, and
      outcome-unknown states.
- [ ] Structured approval review instead of a bare `y`/`yes` prompt, including exact
      action identity, scope, limits, expiry, and stale-approval rejection.
- [ ] TUI lifecycle states for waiting, retrying, cancelling, interrupted, partial,
      ambiguous, failed, and completed work.
- [ ] Provider retry, disconnect, malformed-response, usage, and no-silent-fallback
      behaviour.
- [ ] Directory creation, directory copy, directory move, and directory rename.
- [ ] Honest multi-file transaction and partial-recovery semantics.
- [ ] Shared resource limits, redaction, identity rechecks, and failure-injection tests.

Until these are complete and validated, Computer Native remains in a development/preview
state even though several bounded capabilities already work.

## Completed slices and exact remaining gaps

| Area | Implemented in the completed slice | Still not done |
| --- | --- | --- |
| Workspace and filesystem | Read, write, patch, regular-file copy/move, delete, restore, bounded directory handling, quarantine, approval, and recovery evidence. | Directory copy/move, rename, directory creation, proven multi-file rollback semantics, race handling, large-input streaming, cross-platform guarantees, and OS-level isolation. |
| Shell and process execution | Approved local foreground argv execution, cwd policy, environment redaction, timeout, output limit, cancellation, and process evidence. | Interactive stdin/PTY, background jobs, durable job recovery, shell grammar, process-tree enforcement, remote/container execution, OS/network isolation, and stronger privilege controls. |
| Browser interaction | Managed local Chromium/Playwright sessions, bounded snapshots, navigation/actions, approval, dialogs, artifacts, cancellation, and local-fixture recovery. | Personal Chrome/CDP, remote browser providers, extensions, arbitrary JavaScript, cookie/storage access, auth/OAuth/CAPTCHA flows, request interception, durable browser profiles, and stronger isolation. |
| Memory foundation | Markdown user/durable stores, dated notes, bounded lexical retrieval, approval-gated mutation, provenance, retention, deletion, restart handling, and evidence. | Supported production persistence, session search, hybrid/semantic retrieval, compaction flush, consolidation/promotion, conflict handling, broad deletion, import/export, privacy controls, migration, index reconciliation, and real-model acceptance. |
| Initial TUI and approvals | Standalone terminal chat, real model output, activity messages, basic approval handling, slash commands, and Ctrl+C cancellation foundation. | Full structured approval review, richer lifecycle states, better scrolling/history/composer behaviour, resize/accessibility handling, and mature full-screen interaction. |
| Model connection | Real OpenRouter path, stored development configuration, deterministic test provider, and basic model selection. | Provider registry, capability validation, bounded retries/backoff, fallback policy, partial-stream handling, usage/cost evidence, credential rotation, and broader provider acceptance. |

The "still not done" column is the authoritative gap list for these completed slices. It
must not be removed merely because a first implementation exists.

## Not started after core hardening

These are separate future implementation areas. They are not partially available just
because their directories or README files exist.

### Skills

Status: **Not started.**

Still required: discovery, manifests, versioning, instruction loading, trust policy,
capability grants, isolation, dependencies, resource limits, lifecycle, rollback, and
skill-use evidence.

### Plugins

Status: **Not started.**

Still required: plugin manifests, compatibility, dependency boundaries, permissions,
secret access, process lifecycle, failure isolation, update/disable/rollback behaviour,
and plugin-specific evidence.

### External integrations

Status: **Not started.**

Still required: connector contracts, credentials and OAuth, request limits, retries,
idempotency, pagination, inbound webhook validation, queues, dead-letter handling,
replay, and external-operation evidence.

### Durable jobs, scheduling, and delegated work

Status: **Not started.**

Still required: durable jobs, leases, heartbeats, deadlines, scheduler persistence,
missed-run rules, deduplication, budgets, child-agent permissions, restart recovery,
cancellation, and operator controls.

### Production security and operations

Status: **Not complete.**

Still required: threat model, OS/container isolation decision and implementation where
needed, network egress policy, authentication and authorization, structured telemetry,
alerts, backup, restore, migration, rollback, dependency scanning, SBOM, release
provenance, and incident runbooks.

### Main Agent Harness Lab UI integration

Status: **Separate integration work.**

Still required: a versioned runner API, shared event streaming, session ownership,
reconnect behaviour, non-terminal approvals, artifact views, and configuration wiring.
This must consume the standalone runtime. It must not create a second agent loop.

## Implementation order

1. Complete [core hardening and production foundation](active/computer-native-core-hardening.md).
2. Implement Skills only after the core plan passes its completion gate.
3. Implement Plugins with the same trust and permission model.
4. Implement External Integrations with idempotency and recovery contracts.
5. Implement durable jobs, scheduling, and delegated work.
6. Complete production security and operations for the named deployment profile.
7. Integrate the main Agent Harness Lab UI.

Each future area needs its own active plan before implementation starts. That plan must
state exactly what it implements, what it does not implement, its security and approval
model, persistence and recovery semantics, tests, documentation, and completion gate.
