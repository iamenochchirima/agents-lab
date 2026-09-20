# Platform capabilities, tools, skills, and connections

**Created:** 2026-09-20T13:25:29+02:00
**Last updated:** 2026-09-20T13:25:29+02:00
**Status:** Active — queued after cross-platform acceptance
**Owner:** Primary platform implementation owner
**Platforms:** Temporal, Restate, LangGraph, Mastra
**Priority:** Next major platform capability phase after platform-cross-comparison-acceptance.md

This plan adds the capability layer that professional and personal agents need after the
four platform runners are comparable: tools, reusable skills, MCP connections, OAuth-backed
accounts, direct API connections, and trusted plugins. It keeps capability definitions
portable while leaving execution, durability, retries, and native telemetry inside each
platform adapter. It does not make Anesu, Studio, or a computer environment part of the
platform runtime.

## Start here

Read these before changing code:

- repository rules: ../../../../AGENTS.md
- documentation guide: ../../../../docs/contributing/documentation.md
- implementation-plan lifecycle: ../../../README.md
- platform plan index: ../README.md
- server ownership: ../../../../server/README.md
- server architecture: ../../../../server/src/control-plane/README.md
- platform ownership: ../../../../server/src/platforms/README.md
- runner interfaces: ../../../../server/src/control-plane/ports/README.md
- reusable capabilities: ../../../../server/src/capabilities/README.md
- tool contracts: ../../../../server/src/capabilities/tools/README.md
- integration contracts: ../../../../server/src/capabilities/integrations/README.md
- MCP boundary: ../../../../server/src/capabilities/integrations/mcp/README.md
- OAuth boundary: ../../../../server/src/capabilities/integrations/oauth/README.md
- direct API boundary: ../../../../server/src/capabilities/integrations/direct-api/README.md
- skill boundary: ../../../../server/src/capabilities/skills/README.md
- plugin boundary: ../../../../server/src/capabilities/plugins/README.md
- policy boundary: ../../../../server/src/capabilities/policies/README.md
- completed tool-enabled turn loop: ../completed/tool-enabled-turn-loop.md
- completed context and compaction: ../completed/context-management.md
- completed OpenRouter model selection: ../completed/openrouter-model-selection.md
- cross-platform acceptance plan: ./platform-cross-comparison-acceptance.md
- OpenClaw code map: ../../../../docs/research/harness-code-maps/openclaw.md
- Hermes code map: ../../../../docs/research/harness-code-maps/hermes.md
- Waku code map: ../../../../docs/research/harness-code-maps/waku.md
- write-tool and approval comparison: ../../../../docs/research/write-tool-approval-comparison.md

The OpenClaw, Hermes, and Waku material is design input only. Their names, folder
layouts, permissions, and provider integrations are not copied as product requirements.
The implementation must preserve the Lab's existing separation between harness, scenario,
experiment, run evidence, and telemetry.

## First-party source verification

Before implementation, recheck the installed package and protocol versions against primary
sources. Record access timestamps and distinguish documented guarantees from local
observations:

- [ ] Verify the current MCP specification, transport options, tool/listing semantics,
      cancellation, errors, and capability negotiation.
- [ ] Verify the selected OAuth provider contract, authorization-code flow, PKCE, state,
      redirect handling, refresh, revocation, scope semantics, and token expiry behaviour.
- [ ] Verify the direct API provider contract for the first real adapter, including rate
      limits, request IDs, idempotency support, pagination, and error classes.
- [ ] Verify the installed platform SDK contracts for native tool registration and
      lifecycle events in Temporal, Restate, LangGraph, and Mastra.
- [ ] Verify plugin and skill loading assumptions from the local reference code maps;
      filesystem discovery is not trust or authorization.
- [ ] Record package versions, runtime versions, protocol revisions, and unresolved
      questions in the implementation record before adding dependencies.

## Purpose

Turn the existing calculator-only capability boundary into a real, inspectable platform
capability system. A contributor should be able to select a bounded capability profile in
the browser, run the same task through the four priority platforms, observe native tool and
connection events, and inspect redacted evidence. The first phase proves the architecture
with local deterministic fixtures and one real provider-shaped boundary; it must not pretend
that a social account or external API is connected when credentials are absent.

## Definition of done

From a platform Chat page, a contributor can choose a saved capability profile containing a
pure tool, a read-only MCP or direct-API capability, and a skill. The server validates the
profile, resolves only the selected capabilities, and submits the same bounded workload to
Temporal, Restate, LangGraph, or Mastra. The platform owns its execution boundary and
native retry/recovery semantics. The UI shows actual tool/connection activity, context
impact, approval or unavailable state, and the final result. The run contains redacted
capability configuration and native evidence inspectable after completion.

Flow:

    Chat capability profile
      -> validated run manifest and capability grants
      -> platform-local tool/skill/connection binding
      -> real local fixture or configured direct/MCP/OAuth boundary
      -> normalized lifecycle events + native evidence + inspectable result

The completed phase must be able to:

- [ ] register, validate, and display capability definitions without importing platform
      SDK types into server/src/capabilities;
- [ ] run a pure tool and a read-only connected capability through all four priority
      platform profiles with platform-specific durability preserved;
- [ ] load a versioned skill as context input without granting it authority over tools,
      permissions, secrets, or policy;
- [ ] exercise MCP, direct API, and OAuth connection seams against no-Docker local
      fixtures, with unavailable external credentials shown honestly;
- [ ] require explicit policy approval for the first write-capable capability and preserve
      the decision in normalized and native evidence;
- [ ] keep secrets, authorization headers, raw provider responses, and unsafe skill content
      out of run evidence and browser responses;
- [ ] show capability profile, tool activity, connection status, context usage, and
      failure/recovery state in Chat and Compare without adding a noisy dashboard;
- [ ] document exact local commands, real external prerequisites, observed results,
      known limitations, and the rollback switch.

## Scope

- [ ] Define versioned provider-neutral contracts for capability manifests, grants,
      policies, skills, plugins, connections, and safe execution results.
- [ ] Implement a deny-by-default registry and capability resolver that produces an
      immutable per-run grant set.
- [ ] Implement versioned skill loading, matching, size limits, provenance, and context
      insertion as untrusted instructions.
- [ ] Extend the tool boundary beyond the calculator with one deterministic read-only
      fixture and one approval-gated write fixture.
- [ ] Implement MCP discovery and invocation through a controlled local transport boundary.
- [ ] Implement a direct API connector boundary with request IDs, bounded retries, and
      idempotency handling for the first provider-shaped fixture.
- [ ] Implement OAuth connection lifecycle contracts with PKCE/state validation, safe
      token-storage abstraction, refresh serialization, revocation, and a local OAuth
      fixture. No real provider credential is committed.
- [ ] Define a trusted local plugin manifest contract without introducing a marketplace or
      arbitrary unreviewed code execution.
- [ ] Bind shared capabilities into Temporal, Restate, LangGraph, and Mastra without
      moving their runtime or retry semantics into the common capability module.
- [ ] Expose a compact capability selection/configuration flow in Chat and Compare.
- [ ] Persist redacted capability metadata and native connection/tool evidence with each
      run, then update docs and the development playground.

## Explicitly out of scope

- Anesu computer-native tools, workspaces, sandboxes, browser automation, or VM/remote
  computer execution. Those remain in anesu/ and its Lab integration boundary.
- Studio, component experiments, benchmark leaderboards, or a new Studio capability UI.
- A public plugin marketplace, arbitrary third-party plugin installation, or unsigned code
  execution.
- Supporting every social network or provider in this phase. Provider-specific adapters
  are follow-up plans after the generic connection seam and first fixture are proven.
- Secret values in repository files, browser local storage, run evidence, or model context.
- Docker as a required local dependency. A Docker profile may be documented separately if
  a provider requires it, but deterministic acceptance must use local processes.
- Replacing a platform's native workflow/activity/node/step semantics with a common loop.
- Claiming exactly-once external effects, durable execution for a direct in-process runner,
  or successful OAuth/MCP connectivity when the dependency is unavailable.

## Architecture and ownership

Boundary map:

    apps/web/src/features/platforms/
      compact capability picker, connection status, tool activity, approval, details

    server/src/capabilities/
      provider-neutral definitions, validation, policy, skills, tool contracts,
      connection contracts, plugin manifests, redaction rules

    server/src/platforms/<platform>/
      native registration, execution boundary, retries, cancellation, persistence,
      native events, and translation of shared grants into platform-native calls

    server/src/control-plane/
      request admission, immutable manifest, runner dispatch, normalized lifecycle,
      evidence ownership, and API projection

    lab/runs/<run-id>/
      config.json, events.jsonl, trajectory.json, metrics.json, result.json,
      capabilities.json, native/<platform>.json, logs/, and artifacts/

    server/.local/connections/ or configured secret store
      connection metadata and encrypted local credential material, never run evidence

Ownership rules:

- server/src/capabilities defines meaning and validates grants; it never calls a platform
  SDK, model provider, MCP server, OAuth provider, or direct API.
- The server request and manifest own selected capability IDs, versions, policy
  profile, and safe connection references. They do not own tokens or external execution.
- Each platform adapter owns native registration, execution, retry, cancellation, native
  event ordering, and platform-specific recovery.
- RunEvidenceStore remains the sole writer for normalized run records. A capability
  executor may emit intents, but it must not write a second normalized result.
- The capability evidence writer owns capabilities.json and redacted native summaries;
  the connection secret store owns credential material.
- The browser reads API projections only. It never receives tokens, raw authorization
  headers, unbounded skill text, or raw provider response bodies.
- Platform SDK types remain inside server/src/platforms/<platform>. Common contracts use
  JSON-safe types and explicit lifecycle semantics.

### Platform binding matrix

| Platform | Native binding | Native durability owner | Common code may provide |
| --- | --- | --- | --- |
| Temporal | activity/tool adapter called from the workflow | Temporal history and activity retry | grant validation, safe tool definition, normalized intent |
| Restate | named handler/service invocation | Restate journal/state/retry | grant validation, safe tool definition, normalized intent |
| LangGraph | graph node/tool call with checkpointed state | LangGraph thread/checkpoint store | grant validation, tool schema, context/skill projection |
| Mastra | registered Agent tool or workflow step | Mastra/local store according to variant | grant validation, tool schema, context/skill projection |

If a platform cannot express a capability with its real native boundary, record it as
unavailable instead of silently executing it in the server process.

### Files allowed to change

| Workstream | Owned files/directories | Must not change without a recorded contract decision |
| --- | --- | --- |
| Capability contracts | server/src/capabilities/**, focused server capability tests | Anesu, Studio, platform SDK implementation |
| Platform bindings | server/src/platforms/{temporal,restate,langgraph,mastra}/**, platform tests | unrelated platform implementations |
| Connection fixtures | server/tests/fixtures/capabilities/**, local fixture scripts | production secrets or user account data |
| Server/API/evidence | server/src/control-plane/**, smallest required shared tests | unrelated runner semantics |
| Platform UI | apps/web/src/features/platforms/**, browser tests | Anesu/Studio UI |
| Docs/playground | platform docs, docs/architecture/, development/playground/, plan files | unsupported published claims |

If a shared file is required, first add a contract test showing why the existing seam is
insufficient. Do not use this plan as a reason to refactor unrelated server code.

## Capability contract

The first contract must be versioned, JSON-safe, bounded, and independent of any SDK.
The exact TypeScript names may change during the contract checkpoint, but it must represent:

    CapabilityManifest
      schemaVersion, id, version, kind, displayName, description, risk,
      optional inputSchema, requiredScopes, and source reference

    CapabilityGrant
      capabilityId, version, enabled, optional connectionRef,
      allowedOperations, approval mode, timeout, input limit, output limit

The implementation must retain these properties:

- [ ] capability identity and version are immutable for a run;
- [ ] grants are explicit and deny-by-default;
- [ ] risk and approval are policy inputs, not model decisions;
- [ ] connection references are opaque and never contain credentials;
- [ ] schemas and text have bounded size and deterministic validation;
- [ ] platform adapters receive a resolved grant set, not an unrestricted registry;
- [ ] a skill can affect context content but cannot create a grant or bypass policy;
- [ ] plugin manifests can declare capabilities but cannot self-authorize them.

## Skills, plugins, and connections

### Skills

- Load only versioned, allowlisted skill packages from configured roots.
- Parse metadata separately from body text; reject malformed, oversized, or duplicate IDs.
- Record source, version, digest, match reason, and selected order in safe run metadata.
- Insert skill instructions through the existing context snapshot seam with explicit
  precedence; skills are not system policy and cannot override security rules.
- Test prompt-injection-like skill content, conflicting instructions, duplicate matches,
  empty skill sets, and compaction preserving provenance.

### Plugins

- Define a manifest and lifecycle contract first; do not execute arbitrary plugin code in
  the server process as part of this plan.
- Support only trusted local built-ins or explicitly configured modules in the first phase.
- Validate declared capabilities, versions, permissions, and resource limits before load.
- Reject plugins that request undeclared capabilities or expose unbounded network,
  filesystem, subprocess, or secret access.
- Keep plugin loading separate from skill loading: skills are context; plugins are code.

### MCP connections

- Support one local deterministic fixture over the selected transport after the source
  checkpoint confirms the installed client API.
- Discover tools into bounded manifests, require explicit selection, and revalidate input
  at invocation time.
- Preserve MCP server identity, tool name/version, request ID, duration, and bounded error
  summary without storing raw authorization material or unbounded payloads.
- Apply endpoint allowlists, connection timeouts, output limits, cancellation, and stale
  discovery handling.
- Treat remote MCP as unavailable unless configured; do not infer trust from discovery.

### OAuth and direct APIs

- Model an account as connection metadata plus secret material behind a SecretStore
  interface. The UI/API handles connection IDs and scopes, never tokens.
- Use authorization-code plus PKCE and an unguessable state value for the first OAuth flow.
- Make callback replay, state mismatch, expired authorization, refresh races, revocation,
  and missing scopes explicit outcomes.
- Use provider request IDs and idempotency keys where supported. A timeout after dispatch
  is unknown, not an automatic retry of a write.
- Add a local OAuth/direct-API fixture for deterministic tests; document the manual path
  for a real provider without requiring a real account in CI.

## State, persistence, and evidence

Each run must retain:

    lab/runs/<run-id>/
      config.json          immutable selected capability IDs, versions, grants, safe refs
      capabilities.json    redacted resolution, policy decisions, connection summaries
      events.jsonl         normalized ordered lifecycle events
      trajectory.json      bounded model/tool/connection turn trajectory
      metrics.json         usage, durations, retries, tool counts, unknown outcomes
      result.json          one terminal result only when terminal state is known
      native/<platform>.json
                           platform-specific calls, retries, IDs, and status

Connection metadata and credentials are separate:

    <configured-connection-root>/<connection-ref>/
      metadata.json        provider, scopes, expiry, safe fingerprint
      secret.enc           encrypted local secret material; never copied into a run

- [ ] Manifest is written before dispatch and is immutable.
- [ ] Capability resolution is written before the first model/tool request.
- [ ] Approval decisions, connection refreshes, tool calls, and external request IDs are
      append-only lifecycle evidence with bounded payloads.
- [ ] Writes use atomic replacement or the existing evidence-store contract.
- [ ] A capability result is linked to the model turn and tool call without duplicating
      result.json.
- [ ] Raw secrets, headers, provider bodies, full skill bodies, and unsafe arguments are
      redacted before persistence and API projection.
- [ ] Restart/reconciliation reloads manifest and evidence, then asks the platform adapter
      for native status; it never assumes a missing result means success.
- [ ] Retention and local connection cleanup guidance is documented separately from run
      evidence retention.

## Failure, retry, recovery, and side effects

- [ ] Registry listing and local skill parsing may retry only before a run is admitted.
- [ ] Read-only tool/API requests may retry only under a documented bounded policy and
      only when the provider contract makes the retry safe.
- [ ] Model requests, external writes, OAuth callbacks, and plugin side effects have
      explicit duplicate/unknown-outcome semantics; none are called exactly once by
      assertion.
- [ ] Each external call has a stable per-attempt ID and, where supported, an idempotency
      key derived from run, turn, capability, and logical operation, not raw prompt text.
- [ ] Cancellation propagates through model, tool, MCP, direct API, OAuth refresh, and
      platform-native boundaries; a late result is recorded as late/unknown and cannot
      overwrite a newer terminal result.
- [ ] A platform restart follows its native recovery model: Temporal history, Restate
      journal, LangGraph checkpoint/thread, or Mastra store/process state.
- [ ] A server restart reloads the immutable grant set and reconciles in-flight calls; it
      does not silently create another external side effect.
- [ ] Duplicate and out-of-order events deduplicate by platform/run/attempt identity, not
      by a global event name.
- [ ] Missing credentials, revoked scopes, unavailable MCP servers, invalid plugin
      manifests, and policy denials become honest unavailable/failed states.
- [ ] Approval expiry and stale grants fail closed.

## Security and configuration

- [ ] Capability selection is allowlisted and validated server-side; browser controls are
      not authorization.
- [ ] Secret sources are environment variables, the configured secret store, or the local
      OAuth fixture. Tokens never enter prompts, logs, run files, URL query strings, or
      browser storage.
- [ ] OAuth uses PKCE, state, exact redirect validation, scope validation, refresh locking,
      and revocation handling.
- [ ] Remote MCP endpoints use explicit configuration and policy; no model-provided URL
      can trigger an arbitrary network request.
- [ ] Tool and plugin execution has timeouts, input/output limits, cancellation, and
      resource boundaries. A skill is never executable code by default.
- [ ] Write/external operations require configured approval and an explicit user-visible
      operation summary.
- [ ] Effective capability configuration and redaction policy are recorded in config.json
      without secrets.
- [ ] Missing OpenRouter key, connection credentials, or local fixtures produce actionable
      unavailable states and no fabricated assistant/tool result.

## Implementation order

This is one major capability phase with coherent vertical sections. Do not split it into
unrelated twenty-minute UI slices.

### Phase 0 — contract and source checkpoint

- [ ] Recheck first-party MCP, OAuth, direct API, plugin, skill, and installed platform
      SDK documentation; update this plan with versions and source timestamps.
- [ ] Freeze capability manifest, grant, policy, connection reference, and lifecycle
      event shapes with contract tests.
- [ ] Decide the first local MCP transport and OAuth fixture without making Docker required.
- [ ] Record redaction, retention, approval, retry, and unknown-outcome decisions.
- [ ] Commit the stable contract checkpoint before parallel implementation begins.

### Phase 1 — shared registry, policy, and skill resolution

- [ ] Implement versioned registries for tools, skills, connections, and trusted plugin
      manifests behind explicit allowlists.
- [ ] Implement grant resolution, risk policy, approval requirements, limits, and safe
      configuration projection.
- [ ] Integrate selected skills into the existing context snapshot and compaction flow
      while preserving canonical transcript semantics.
- [ ] Add deterministic fixtures for matching, ordering, conflicts, oversized content,
      policy denial, and redaction.

### Phase 2 — real capability execution boundaries

- [ ] Extend the tool registry with a deterministic read-only fixture and an
      approval-gated write fixture using existing lifecycle contracts.
- [ ] Implement local MCP discovery/invocation and map its native events.
- [ ] Implement direct API request/response and idempotency boundaries against a local
      provider-shaped fixture.
- [ ] Implement OAuth start/callback/refresh/revoke against a local fixture and SecretStore;
      verify callback and refresh races.
- [ ] Implement trusted local plugin manifest validation without arbitrary plugin execution.
- [ ] Add isolated tests before platform adapter wiring.

### Phase 3 — platform-native binding across the four priority platforms

- [ ] Bind the same resolved profile to Temporal activities and preserve activity retry,
      cancellation, and native request identity.
- [ ] Bind it to Restate named handlers/invocations and preserve journal/idempotency
      semantics.
- [ ] Bind it to LangGraph nodes/tools and preserve checkpoint/thread state and event order.
- [ ] Bind it to Mastra Agent tools/workflow steps and preserve active-variant native
      storage, suspend/resume, and event projection.
- [ ] Run the same prompt, tool, connection, approval, cancellation, restart, and
      unavailable matrix through all four platforms.
- [ ] Keep native differences visible in native/<platform>.json and platform docs.

### Phase 4 — server, evidence, and browser experience

- [ ] Add capability profile and grant fields to immutable run requests with bounded
      validation and backward-compatible defaults.
- [ ] Add capabilities.json and safe capability projections to run inspection.
- [ ] Add compact Chat configuration for capability profile selection and a focused dialog
      for connections/approvals; do not create a verbose capabilities dashboard.
- [ ] Show selected skill/tool/connection names, actual activity, approval state, context
      usage, unavailable state, and run/evidence details.
- [ ] Extend Compare to submit the same profile with independent per-platform grants and
      run/session identities.
- [ ] Add deterministic browser tests for success, denial, missing connection, partial
      comparison, duplicate polling, and no console/React-key errors.
- [ ] Add optional live browser acceptance with OpenRouter and a configured test account;
      record skipped external providers honestly.

### Phase 5 — operations, documentation, and archive

- [ ] Add structured logs and metrics for resolution, tool attempts, refreshes, approvals,
      retries, durations, and unknown outcomes without prompts or secrets.
- [ ] Add cleanup and credential-rotation guidance and a rollback switch that disables
      connected/write capabilities while preserving pure local tools.
- [ ] Update platform architecture, semantics, local-development, Chat/Compare, and
      capability documentation.
- [ ] Add a development playground walkthrough separate from tests, scenarios, and
      experiments.
- [ ] Record validation results, manual acceptance, known limitations, release decisions,
      and commit hashes, then move this plan to completed/.

## Test coverage

### Unit and contract tests

- [ ] capability manifest/version/schema validation and bounded fields;
- [ ] grant resolution, deny-by-default policy, risk classes, approval, and limits;
- [ ] tool registration, argument validation, timeout, cancellation, result limits, and
      terminal event cardinality;
- [ ] skill parsing, matching, precedence, digest/provenance, size limits, compaction,
      and prompt-injection-like content;
- [ ] plugin manifest validation, undeclared capability rejection, and no-code default;
- [ ] MCP discovery, selection, invocation, cancellation, timeout, and bounded errors;
- [ ] direct API request IDs, safe retry, idempotency, rate-limit, and unknown outcomes;
- [ ] OAuth PKCE/state, callback replay, expiry, refresh serialization, revocation, and
      missing-scope errors;
- [ ] secret/redaction rules for configs, events, logs, native evidence, and API responses.

### Platform integration tests

- [ ] identical deterministic profile through Temporal, Restate, LangGraph, and Mastra;
- [ ] native tool registration and actual execution, not fake successful HTTP responses;
- [ ] tool failure, policy denial, approval, cancellation, timeout, and retry semantics;
- [ ] local MCP and direct-API fixtures with real protocol/request boundaries;
- [ ] local OAuth start/callback/refresh/revoke with a temporary fixture process;
- [ ] duplicate turn admission, duplicate external request, lost acknowledgement, and
      unknown-result behaviour;
- [ ] platform restart/recovery and evidence reconciliation for each platform;
- [ ] unavailable service, missing credential, revoked scope, malformed skill, and invalid
      plugin configuration;
- [ ] independent Compare runs do not share grants, sessions, connections, or evidence.

### Browser acceptance

- [ ] Chat selects a capability profile and shows actual selected names clearly;
- [ ] pure tool and read-only connection produce visible activity and final output;
- [ ] approval-gated write action uses an application dialog and records the decision;
- [ ] unavailable connection, denied policy, cancelled run, and unknown external outcome
      render honestly without fake success;
- [ ] context-window usage and skill/context contribution remain visible without exposing
      full private content;
- [ ] Compare sends the same profile to at least two platforms with independent rows,
      run IDs, sessions, grants, and evidence links;
- [ ] reopening/polling Chat or Compare does not duplicate events, messages, or React keys;
- [ ] desktop, tablet, and mobile layouts remain usable without overflow;
- [ ] browser console has no route, hydration, polling-loop, or fetch errors.

### Manual acceptance

- [ ] Start the documented local stack without Docker and verify readiness.
- [ ] Run deterministic tool profile on all four priority platforms.
- [ ] Start local MCP/direct-API/OAuth fixtures and inspect actual requests and evidence.
- [ ] Approve one write fixture, reject one, cancel one, and force one unavailable state.
- [ ] Restart the relevant server/platform process and inspect recovery or unknown status.
- [ ] Run a two-platform Compare with the same model, task, profile, and tool limits;
      verify independent context and evidence.
- [ ] Inspect config.json, capabilities.json, events.jsonl, trajectory.json, metrics.json,
      result.json, and native/ for redaction and cardinality.
- [ ] Configure a real provider only when credentials are available; record provider,
      scopes, versions, observed result, and limitations without committing secrets.

## Required validation commands

    pnpm --filter @agent-harness-lab/lab-server run typecheck
    pnpm --filter @agent-harness-lab/lab-server run test:mastra
    pnpm --filter @agent-harness-lab/lab-server run test:restate
    pnpm --filter @agent-harness-lab/lab-server run test:temporal
    pnpm --filter @agent-harness-lab/lab-server run test:langgraph
    pnpm --filter @agent-harness-lab/web run typecheck
    pnpm --filter @agent-harness-lab/web run build
    pnpm --filter @agent-harness-lab/web run generate:docs
    git diff --check

The live OpenRouter and real-provider checks are optional acceptance checks, not a reason
to skip deterministic protocol and platform tests. Document missing services, credentials,
or provider quotas rather than replacing them with fake success.

## Documentation and release impact

- Analytics: not applicable; this phase adds no product analytics.
- Structured logging: record capability ID/version, platform, operation ID, status, retry
  count, approval outcome, duration, and unknown/reconciliation status without prompts,
  tokens, headers, or raw provider bodies.
- Metrics: record tool/connection counts, durations, retries, context contribution, and
  provider usage only when the source reports it; do not invent cost or token values.
- Version identity: record capability schema, skill/plugin digest, protocol versions,
  platform SDK versions, runtime versions, model ID, and local fixture versions.
- Migration: additive manifest/evidence changes require old-run readers to remain usable;
  connection-secret migration must be explicit and never occur during a model turn.
- Rollout: local first; connected and write-capable profiles are feature-gated and disabled
  by default until acceptance passes.
- Rollback: disable connected/write profiles and plugin loading while leaving pure tools,
  existing Chat runs, and evidence inspection available.
- Security: fail closed on missing grants, scope mismatch, invalid state, stale approval,
  secret-store failure, and unsafe endpoint configuration.
- Known limitation: a local fixture proves protocol and lifecycle behaviour, not every
  external provider's correctness or availability.
- Release-process limitation: docs/internal/operations/release-process.md is absent in
  this checkout; record that again at completion if it remains absent.

## Parallel work and ownership

Parallel work may begin only after Phase 0 is committed. Use separate worktrees or
branches when agents work concurrently; do not let two agents edit the same shared
contract or index files.

| Workstream | Owned files | Depends on | Handoff |
| --- | --- | --- | --- |
| Contracts/policy | server/src/capabilities/**, contract tests | Phase 0 | versioned grants and policy API |
| Skills/plugins | skill/plugin modules and tests | contracts/policy | resolver and provenance behaviour |
| Connections | integration modules and local fixtures | contracts/policy | MCP/direct/OAuth boundary and failures |
| Platform bindings | one platform directory per agent plus tests | stable grants/connections | native registration/events/recovery |
| Server/evidence | smallest server/evidence changes | all contracts | API and record projections |
| Browser | platform feature files/browser tests | server API contract | Chat/Compare acceptance |
| Docs/playground | platform docs, plan, playground | observed implementation | runnable instructions and limitations |

The primary agent owns the contract checkpoint, cross-workstream integration, shared server
changes, final architecture decisions, and completion gate. Agents must return changed-file
lists, validation results, unresolved questions, and commit hashes.

## Commit discipline

Use focused commits rather than one large capability commit:

1. capability contracts, policy, redaction, and deterministic tests;
2. skills/plugins and context integration;
3. MCP/direct API/OAuth boundaries and local fixtures;
4. platform-native bindings and platform matrix tests;
5. server evidence/API and Chat/Compare UI;
6. documentation, playground, acceptance record, and plan archive.

Before every commit, inspect git status, stage only files owned by this plan, run the
narrow validation for that section, and preserve unrelated Anesu, Studio, lockfile,
playground, and research changes.

## Completion gate

Before moving this plan to completed/:

- [ ] The same bounded capability profile works through Temporal, Restate, LangGraph, and
      Mastra using their native execution boundaries.
- [ ] Skills, plugins, tools, MCP, direct APIs, and OAuth have honest supported,
      unavailable, denied, and unknown states.
- [ ] Pure/read capabilities work locally without Docker; write/external capabilities are
      approval-gated and have explicit idempotency/unknown-outcome rules.
- [ ] Secrets and unsafe payloads are absent from browser responses, logs, and run files.
- [ ] Context usage, tool activity, connection status, approval, cancellation, recovery,
      and native platform details are inspectable in Chat and Compare.
- [ ] Duplicate, retry, restart, cancellation, timeout, out-of-order, and ambiguous
      external outcomes are tested and documented.
- [ ] Documentation, playground, release decisions, validation results, and limitations
      match the implementation.
- [ ] Each coherent implementation section has a focused commit.
- [ ] No applicable checklist item remains unchecked.

## Completion record

Complete this section only when the plan is moved to completed/.

**Completed:** [YYYY-MM-DDTHH:MM:SS±HH:00]
**Commits:** [commit hashes]

### Validation

- [command] — [passed/failed and concise result]
- [manual acceptance] — [observed result]

### Known limitations

- [deliberate limitation or follow-up]

### Historical-scope note

This plan records the first shared platform-capability phase. Provider-specific social
connectors, hosted secret managers, plugin marketplaces, and computer-native execution
require later plans and must not be silently added here.
