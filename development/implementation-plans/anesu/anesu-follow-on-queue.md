# Anesu implementation queue

This page is a status map, not a completion claim. A completed slice means that the
bounded scope in its plan was implemented and tested. It does not mean that the area is
complete for a mature or production-ready Anesu product.

The full production-readiness definition is in
[Anesu production-readiness gaps](active/anesu-production-readiness-gaps.md).

## Current implementation foundation

### Sessions and approvals

Status: **Completed first-iteration slice.**

Plan: [Anesu sessions and approvals](completed/anesu-sessions-and-approvals.md)

This completed harness-wide slice adds multiple durable conversations with TUI `/new` and
`/resume`, understandable scoped approvals, inspectable/revocable exact process permissions,
and fixes browser ownership so an open browser remains available across turns in its own
conversation. Tests cover cancellation continuity, cleanup, restart without browser
reattachment, and approval routing. A manual TUI check confirmed real-model output and
`/new`/`/resume`; full Anesu validation passed. Browser sessions have a configured maximum
lifetime and are not restored after process exit. This work builds on existing session
persistence and domain-specific approval checks; it does not replace them with a universal
policy engine. Browser use is next in the implementation queue.

### Browser use

Status: **Active, implementation in progress.**

Plan: [Anesu browser use](active/anesu-browser-use.md)

The implementation focus is general browser use from ordinary chat prompts on
user-chosen public sites. The conversation model chooses from typed Cua browser tools;
the plan records the live-proven path and remaining origin, search, and file-transfer
gaps. The earlier combined [Jev/Cua plan](archived/anesu-jev-cua-native-computer-use.md)
and [remaining-acceptance plan](archived/anesu-computer-use-remaining-acceptance.md)
are archived records, not work to complete alongside this browser slice. Native app,
cursor, and visual-fallback work are not part of the browser slice.

### Model-directed desktop use

Status: **Active plan, queued after sessions/approvals and browser use.**

Plan: [Anesu model-directed desktop use](active/anesu-model-directed-desktop-use.md)

The existing desktop `computer` call runs a hidden native action-selection loop. This
plan makes current Cua observations and supported desktop actions available through the
normal conversation model/tool loop, so the model chooses whether and how to continue.
It reuses the shared session and approval work, keeps browser actions in the browser-use
plan, and avoids app-specific scripts or a second automation backend.

### Natural computer-use routing and surface switching

Status: **Completed first natural-routing slice.**

Plan: [anesu-natural-computer-use.md](completed/anesu-natural-computer-use.md)

This slice turns the completed browser/native dual-path primitives into a natural
conversation. It adds intent admission, automatic browser-versus-desktop resolution,
capability-aware `auto` selection between Jev and traditional vision, one bounded
pre-approval fallback, and TUI visibility for the selected surface and strategy. It
does not add a second computer-use executor or remove the existing approval,
verification, cancellation, recovery, and no-retry boundaries.

The natural prompt, surface-routing, automatic strategy, browser executable, and
structured approval path are now connected through the existing guarded executors. The
core hardening plan remains the source of shared lifecycle and production-foundation
work; the production-readiness register remains open.

### Goal-oriented computer-use execution

Status: **Completed first goal-oriented execution slice.**

Plan: [Anesu goal-oriented computer-use execution](completed/anesu-goal-oriented-computer-use.md)

This slice extends the completed natural-routing and dual-strategy foundation into a
bounded multi-step goal loop. It adds browser and native environment-owned verification,
explicit clarification and terminal outcomes, step progress in the TUI, approval-visible
verification expectations, and focused failure/recovery coverage. It does not add a new
executor, OCR model, unrestricted desktop access, or a second runtime loop.

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
| Browser interaction | Cua-owned local Chromium/Edge preparation, bounded semantic snapshots, navigation/actions, approval, dialogs, upload policy, cancellation, and local contract recovery. | Personal Chrome/CDP, remote browser providers, extensions, arbitrary JavaScript, cookie/storage access, auth/OAuth/CAPTCHA flows, request interception, downloads through a trusted host route, durable browser profiles, and stronger isolation. |
| Memory foundation | Markdown user/durable stores, dated notes, bounded lexical retrieval, approval-gated mutation, provenance, retention, deletion, restart handling, and evidence. | Supported production persistence, session search, hybrid/semantic retrieval, compaction flush, consolidation/promotion, conflict handling, broad deletion, import/export, privacy controls, migration, index reconciliation, and real-model acceptance. |
| Initial TUI and approvals | Standalone terminal chat, real model output, structured approval panels, activity messages, slash commands, Ctrl+C cancellation, responsive panels, and concise process output. | Full-screen interaction, richer scrolling/history/composer behaviour, resize redraw, accessibility, and recovery-focused UX. |
| Model connection | Real OpenRouter path, stored development configuration, deterministic test provider, explicit model selection, capability metadata, bounded retries, partial-stream handling, usage evidence, and no silent fallback. | Broader malformed responses, fallback policy, cost evidence, credential rotation, and wider provider acceptance. |

The "still not done" column is the authoritative gap list for these completed slices. It
must not be removed merely because a first implementation exists.

## Future implementation areas after the current foundation

These are separate future implementation areas. The completed Skills foundation below
does not make the broader areas partially available.

### Context management

Status: **Completed first operational slice. Later maturity work remains.**

Plan: [anesu-context-management.md](completed/anesu-context-management.md)

This slice owns the exact bounded model context for standalone Anesu. It covers source
precedence, workspace resources, skill and memory selection, budgets, snapshots,
compaction, recovery, evidence, and `/context` inspection. It does not create plugins,
download resources, or replace security and approval policy.

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

### Computer use: traditional and TypeSafe/Jev paths

Status: **Initial standalone dual-path slice complete. Later hardening remains in the
production-readiness register.**

Plan: [Anesu computer-use dual paths](completed/anesu-computer-use-dual-paths.md)

This single plan begins with a deliberately browser-only visible validation stage, then
covers one real, explicitly selected graphical environment with two selectable decision
strategies. Traditional mode uses bounded visual observations and a vision-capable
model. TypeSafe mode uses local OCR/accessibility or element state and typed Jev choices;
Jev does not receive screenshots and does not execute input. Both share the host
executor, structured approval, stale-target checks, cancellation, verification, bounded
evidence, and a shadow-only comparison mode. The linked project's reported CoreML
segmentation is not treated as implemented because its current source uses local Vision
OCR and macOS Accessibility instead.

### Main Agent Harness Lab UI integration

Status: **Separate integration work.**

Still required: a versioned runner API, shared event streaming, session ownership,
reconnect behaviour, non-terminal approvals, artifact views, and configuration wiring.
This must consume the standalone runtime. It must not create a second agent loop.

## Implementation order

1. [Sessions and approvals](completed/anesu-sessions-and-approvals.md) is complete. It
   established the harness-wide conversation and approval lifecycle, including the
   browser auto-close fix. It did not implement general browser-use capabilities.
2. Implement [browser use](active/anesu-browser-use.md) as the next standalone
   Computer Native feature slice.
3. Implement [model-directed desktop use](active/anesu-model-directed-desktop-use.md)
   after the shared session/approval and browser-use foundations.
4. Continue [core hardening and production foundation](active/anesu-core-hardening.md)
   for shared reliability work required by this and later slices.
5. Extend the completed Skills foundation only through a new scoped active plan.
6. Implement Plugins with the same trust and permission model.
7. Implement External Integrations with idempotency and recovery contracts.
8. Implement durable jobs, scheduling, and delegated work.
9. Complete production security and operations for the named deployment profile.
10. Integrate the main Agent Harness Lab UI.

The completed dual-path, natural-routing, goal-oriented execution, and context-management
slices are foundations for this order, not unfinished steps in it. Their remaining
maturity work stays in the production-readiness register.

Each future area needs its own active plan before implementation starts. That plan must
state exactly what it implements, what it does not implement, its security and approval
model, persistence and recovery semantics, tests, documentation, and completion gate.
