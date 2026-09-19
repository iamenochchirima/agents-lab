# Browser chat surface

**Created:** `2026-09-16T08:00:00+02:00`
**Last updated:** `2026-09-16T23:26:41+02:00`
**Status:** Completed
**Owner:** Agent Harness Lab

## Purpose

Provide a simple browser-first conversation surface for each registered platform.
The existing run form remains the controlled experiment surface; Chat is the place
to have ordinary turns with a selected platform, model, variant, and server profile,
while still exposing the evidence needed to understand what happened.

## Design boundary

Chat must use the real `POST /api/runs` and run inspection flow. It must not call
providers directly from the browser, estimate tokens in the browser, or fabricate
tool execution. The server remains responsible for model calls, platform execution,
context projections, and evidence.

Conversation continuity is platform-specific:

- Temporal/baseline reuses its server-owned `sessionId` and canonical context store.
- Other platforms can be opened and run from Chat, but are explicitly single-turn
  until their native context/session adapter is implemented. The UI must not imply
  that their previous browser messages were sent to the model.
- Tool activity is rendered from normalized/native run events when a platform emits
  it. An empty tool timeline means no tool was executed, not that a tool was hidden.

## User-visible finished flow

1. Open `/platforms/<platform>/chat` from any platform workspace.
2. Choose the model in the shared searchable picker and choose the platform's
   variant, server profile, infrastructure, and experiment where applicable.
3. Send a prompt and see the user message immediately, followed by live run status,
   assistant output, context budget, and event/tool activity.
4. Continue the same Temporal conversation without losing the session ID.
5. Start a new conversation without changing platform configuration.
6. Open the controlled Run surface when a reproducible scenario configuration or
   comparison is needed.

## Implementation checklist

### Browser route and shell

- [x] Add a nested Chat route under each platform workspace.
- [x] Add one obvious Chat entry point from the platform workspace without adding a
      second global navigation system.
- [x] Keep the page visually quiet: message stream, composer, compact configuration,
      and progressive-disclosure run details.
- [x] Support desktop, tablet, and narrow mobile layouts.
- [x] Preserve platform identity in the URL and reset only platform-incompatible
      state when switching platforms; the browser route and stale-run checks cover
      this boundary.

### Conversation state

- [x] Render user and assistant messages with pending, completed, failed, and
      cancelled states.
- [x] Keep the active conversation in browser state for immediate rendering, while
      treating server run/context responses as authoritative for each turn.
- [x] Preserve Temporal `sessionId` across turns and expose a New conversation action.
- [x] Prevent duplicate sends, accidental concurrent turns, and sending while the
      selected platform is unavailable.
- [x] Restore a run from the URL when the page is refreshed, without claiming that
      a non-Temporal platform has durable chat history.
- [x] Treat a missing URL run as stale, clear it once, and stop polling instead of
      retrying a permanent `404` forever.
- [x] Keep a terminal run in the URL for refresh/review without reactivating its
      polling loop after the run has settled.
- [x] Restore the run's recorded model when resuming a chat and lock model changes
      for an established Temporal session; New chat starts a different model session.

### Configuration and real execution

- [x] Reuse the shared model picker and searchable model catalog.
- [x] Reuse the platform's existing server/profile, variant, infrastructure, and
      experiment catalogs without duplicating them in Chat.
- [x] Submit only through the existing run API and poll the existing inspection/event
      endpoints.
- [x] Show unavailable platform services as unavailable with the server's factual
      message; do not replace them with fake success.
- [x] Keep the current controlled Run surface intact for scenario and comparison work;
      Chat links to it and the route smoke test confirms the original Run form remains
      the controlled surface.

### Observability in the conversation

- [x] Show the assistant result and concise error state in the message stream.
- [x] Show a compact context budget meter when the server provides one.
- [x] Show tool calls/results, model attempts, retries, and platform lifecycle events
      through an expandable run-details section.
- [x] Link or expose safe run evidence without exposing credentials or raw provider
      headers; Chat links only the allowlisted evidence files.
- [x] Make the distinction between model output, platform status, and tool activity
      visible without filling the primary conversation with telemetry noise; the
      message stream stays concise and run details are progressive disclosure.

### Server contract review

- [x] Verify Chat requires no new provider path or browser credential.
- [x] Use selected-platform health for browser readiness while preserving aggregate
      `/health` as a whole-lab diagnostic that may return `503` when optional services
      are down.
- [x] Verify Temporal continuation is idempotent at the existing session-store seam.
- [x] Record the non-Temporal single-turn limitation in platform docs and surface it
      in the UI only where necessary.
- [x] Add a follow-on item for each platform's native context/session adapter rather
      than adding a shared prompt-concatenation workaround. Deferred by design: only
      Temporal/baseline owns a canonical session in this wave.

## Testing checklist

### Automated

- [x] Component-level behaviour is covered by pure chat-state tests and browser
      acceptance tests for send, polling, completion, failure, cancellation,
      duplicate-send prevention, and New chat. A separate React component test
      harness is intentionally deferred because the browser test exercises the
      production route and DOM.
- [x] The browser tests cover Temporal session reuse, non-Temporal single-turn
      disclosure, unavailable services, missing model selection, API errors, and the
      no-native-dialog rule.
- [x] The live local Temporal/OpenRouter API and worker smoke completed two turns in
      one session; the browser fixture covers the same browser state transitions.
- [x] Browser smoke opens all 11 registered platform Chat routes and verifies each
      route keeps its platform identity; the live health check reports unavailable
      services honestly.
- [x] Server regression tests confirm the existing run API and context/evidence
      contracts remain unchanged.
- [x] Server regression test covers selected-platform health when aggregate health is
      degraded.
- [x] Browser/manual smoke coverage confirms direct `/platforms` navigation resolves
      without a hook-based redirect crash and a stale run URL is cleared.
- [x] Chat-state regression tests cover stable polling state and prevent a terminal
      URL run from reactivating the composer controls.
- [x] Chat-state regression tests cover recorded-model restoration and model-picker
      locking after Temporal session admission.

### Manual acceptance

- [x] Open Chat from Temporal and verify a real OpenRouter turn through the local
      server/worker; the browser acceptance fixture verifies the rendered result.
- [x] Send a real Temporal follow-up and verify the same session ID is retained
      (`session-manual-context-20260916`, runs `1f0caf4c…` and `becfc5a4…`).
- [x] Open Context details and observe the server-owned token, limit, remaining, and
      pressure values; the live projection reported a 256000-token window and 97%
      remaining.
- [x] Verify deterministic small-window/preflight and provider-overflow compaction in
      the Temporal integration tests; the browser fixture verifies the corresponding
      meter and compaction disclosure shape. A full provider-specific browser trigger
      remains follow-on work because the live model profile is not a small-window test
      profile.
- [x] Open every other registered Chat route; ready services use their selected health
      result and unavailable services remain unavailable rather than fabricated.
- [x] Verify failed, unavailable, and cancelled runs in browser acceptance without a
      successful placeholder answer.
- [x] Verify New chat clears active browser state while the previously persisted run
      remains in its evidence directory.

## Documentation and release record

- [x] Update platform UI documentation with the Chat route and its continuity rules.
- [x] Update local-development instructions so the normal browser path is the primary
      test path; retain API/curl instructions as a diagnostic fallback.
- [x] Add a short architecture note describing browser Chat versus controlled Runs.
- [x] Record analytics, structured logging, version/release identity, rollout, and
      rollback decisions. The repository's referenced release-process document is not
      present in this checkout; analytics, migration, rollout, and rollback are `not
      applicable` to this local UI/API slice and the absence is recorded here.
- [x] Record known limitations: Temporal/baseline is the only canonical session;
      non-Temporal Chat is single-turn, tool support is platform-emitted, and several
      registered platform services are unavailable in the current local profile.

## Commit slices

- [x] Commit Chat route/shell and shared conversation presentation in `5e136c8`.
- [x] Commit real run submission/polling and Temporal session continuity in `5e136c8`.
- [x] Commit tool/event/evidence disclosure and responsive polish in `5e136c8`.
- [x] Commit browser/chat-state tests in `98189fe`; add all-registered-route coverage in
      `4ec5760`.
- [x] Stage only owned files for each commit; unrelated worktree changes remain
      untouched.

## Validation record

**Implemented:** `2026-09-16T23:26:41+02:00`
**Validation:** `pnpm --filter @agent-harness-lab/web run typecheck` passed; `pnpm --filter @agent-harness-lab/web run build` passed with the existing large-chunk warning; `pnpm --filter @agent-harness-lab/web exec tsx --test tests/chatState.test.ts` passed 12/12; browser model-picker plus Chat acceptance passed 5/5; `git diff --check` passed. The browser suite covers completion, tool activity, context meter, evidence links, continuation, cancellation, API failure, unavailable state, and all registered Chat routes.
**Known limitations:** Platform-native context continuity remains Temporal/baseline only; tool events are shown when emitted by a platform. A full provider-specific browser compaction trigger is deferred because the live OpenRouter profile is not a small-window test profile. Model changes intentionally require New chat while Temporal session continuity is active. Several registered services are unavailable in the current local profile and are reported as such.
