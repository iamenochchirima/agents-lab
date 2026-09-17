# Anesu implementation queue

This page is a status map, not a completion claim. A completed slice means that the
bounded scope in its plan was implemented and tested. It does not mean that the area is
complete for a mature or production-ready Anesu product.

The full production-readiness definition is in
[Anesu production-readiness gaps](active/anesu-production-readiness-gaps.md).

## Current implementation slice

### Core hardening and production foundation

Status: **Active. First-iteration core path is working; production reinforcement remains.**

Plan: [anesu-core-hardening.md](active/anesu-core-hardening.md)

The first iteration now has real, connected paths for:

- shared runtime lifecycle evidence, bounded model retries, cancellation, and
  representative restart reconciliation;
- structured approval panels with exact action identity, scope, limits, expiry, and
  stale-operation checks;
- the standalone TUI, real-provider path, workspace file and directory management,
  approved local process execution, managed browser interaction, and durable memory;
- bounded resource policies, secret redaction, operation evidence, and honest partial or
  outcome-unknown results.

The remaining exhaustive crash, race, security, load, compatibility, and operations
checks are deliberately deferred. They are listed in the [production-readiness gap
register](active/anesu-production-readiness-gaps.md) and must be completed
before a named deployment profile is called production-ready. They do not block the
next first-iteration Anesu component when its core path and focused tests are
complete.

Anesu remains in development/preview while the production-readiness backlog is
open, even though the first-iteration paths above are usable and validated.

## Completed slices and exact remaining gaps

| Area | Implemented in the completed slice | Still not done |
| --- | --- | --- |
| Workspace and filesystem | Read, write, patch, regular-file and directory copy/move/rename, directory creation, delete/restore, quarantine, approval, bounded limits, and recovery evidence. | Proven cross-file rollback, broader race and special-file policy, cross-platform guarantees, and OS-level isolation. |
| Shell and process execution | Approved local foreground argv execution, cwd policy, environment redaction, timeout, output limit, cancellation, and process evidence. | Interactive stdin/PTY, background jobs, durable job recovery, shell grammar, process-tree enforcement, remote/container execution, OS/network isolation, and stronger privilege controls. |
| Browser interaction | Managed local Chromium/Playwright sessions, bounded snapshots, navigation/actions, approval, dialogs, artifacts, cancellation, and local-fixture recovery. | Personal Chrome/CDP, remote browser providers, extensions, arbitrary JavaScript, cookie/storage access, auth/OAuth/CAPTCHA flows, request interception, durable browser profiles, and stronger isolation. |
| Memory foundation | Markdown user/durable stores, dated notes, bounded lexical retrieval, approval-gated mutation, provenance, retention, deletion, restart handling, and evidence. | Supported production persistence, session search, hybrid/semantic retrieval, compaction flush, consolidation/promotion, conflict handling, broad deletion, import/export, privacy controls, migration, index reconciliation, and real-model acceptance. |
| Initial TUI and approvals | Standalone terminal chat, real model output, structured approval panels, activity messages, slash commands, Ctrl+C cancellation, responsive panels, and concise process output. | Full-screen interaction, richer scrolling/history/composer behaviour, resize redraw, accessibility, and recovery-focused UX. |
| Model connection | Real OpenRouter path, stored development configuration, deterministic test provider, explicit model selection, capability metadata, bounded retries, partial-stream handling, usage evidence, and no silent fallback. | Broader malformed responses, fallback policy, cost evidence, credential rotation, and wider provider acceptance. |

The "still not done" column is the authoritative gap list for these completed slices. It
must not be removed merely because a first implementation exists.

## Future implementation areas after the current foundation

These are separate future implementation areas. The completed Skills foundation below
does not make the broader areas partially available.

### Skills

Status: **Completed first foundation slice.**

Plan: [anesu-skills-foundation.md](completed/anesu-skills-foundation.md)

Delivered scope: discover trusted workspace `SKILL.md` packages, list them, and load one
by exact identity through bounded read-only model tools. Skill prose cannot grant
permissions or execute code. The broader marketplace, authoring, usage, lifecycle,
isolation, and external-source work remains future work.

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

1. Complete [core hardening and production foundation](active/anesu-core-hardening.md).
2. Extend the completed Skills foundation only through a new scoped active plan.
3. Implement Plugins with the same trust and permission model.
4. Implement External Integrations with idempotency and recovery contracts.
5. Implement durable jobs, scheduling, and delegated work.
6. Complete production security and operations for the named deployment profile.
7. Integrate the main Agent Harness Lab UI.

Each future area needs its own active plan before implementation starts. That plan must
state exactly what it implements, what it does not implement, its security and approval
model, persistence and recovery semantics, tests, documentation, and completion gate.
