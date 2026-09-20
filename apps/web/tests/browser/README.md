# Browser checks

These tests drive the built application surface in a real Chromium process through
Chrome DevTools Protocol. They are separate from the web TypeScript checks and do not
require a browser automation dependency.

With the local web app running at `http://127.0.0.1:5173`, run:

```bash
node --test apps/web/tests/browser/model-picker.browser.test.mjs
```

The test intercepts only `/api/models` and returns local catalog fixtures. It does not
call OpenRouter. It verifies the visible loading state, keyboard selection, empty and
error states, and that a slower response cannot overwrite a newer search result.

For an opt-in live acceptance check, start the local stack with the OpenRouter key
configured and run:

```bash
AGENTLAB_RUN_LIVE_PLATFORM_UI=1 \
  node --test apps/web/tests/browser/live-platform-runners.browser.test.mjs
```

This opens each configured non-AWS platform runner in Chromium, selects
`cohere/north-mini-code:free`, submits one real request, and checks the rendered
provider/model, terminal status, run ID, and output. It queries each platform's health
endpoint first; unavailable services are reported as diagnostics and are not claimed as
validated. The test makes real provider requests and is intentionally skipped without
the opt-in flag. Set `AGENTLAB_LIVE_PLATFORM_IDS=inngest` (comma-separated) to repeat
one platform after its local dependency becomes available.

To verify browser reconciliation across an actual Lab-server replacement, use the
deterministic Restate delay fixture. This replaces only the Lab server on port 4318;
it does not restart the user's native Restate process or call OpenRouter:

```bash
AGENTLAB_RUN_LIVE_RESTATE_SERVER_RESTART_UI=1 \
  AGENTLAB_LAB_SERVER_PID="$(lsof -tiTCP:4318 -sTCP:LISTEN | head -n1)" \
  node --test apps/web/tests/browser/live-platform-runners.browser.test.mjs
```

The check opens the real Restate Chat route, admits a delayed turn, replaces the Lab
server, and verifies that the same run finishes in the browser after the replacement.
It is intentionally opt-in because it stops and starts the configured local server.

For an opt-in live LangGraph Chat check, keep the local LangGraph service and Lab
server running with an OpenRouter key configured, then run:

```bash
AGENTLAB_RUN_LIVE_LANGGRAPH_CHAT_UI=1 \
  node --test apps/web/tests/browser/live-platform-runners.browser.test.mjs
```

This selects the configured free OpenRouter model, sends two turns through one
LangGraph session, and verifies the rendered context usage and native thread details.
It makes real model requests and is skipped unless explicitly enabled.

To verify browser recovery after replacing the local LangGraph process, run the Lab
server and LangGraph service as separate processes (do not use the aggregate launcher,
whose supervisor will stop the other children when one is replaced), then run:

```bash
AGENTLAB_RUN_LIVE_LANGGRAPH_SERVICE_RESTART_UI=1 \
  AGENTLAB_LANGGRAPH_SERVICE_PID="$(lsof -tiTCP:2024 -sTCP:LISTEN | head -n1)" \
  node --test apps/web/tests/browser/live-platform-runners.browser.test.mjs
```

The check admits a deterministic delayed run, opens the real LangGraph Chat route,
stops the validated native service, restarts it against the same SQLite path, and
expects `Run outcome needs recovery.` with no fabricated completed assistant message.
It is destructive and opt-in; cleanup stops only the replacement process it starts.

To verify browser reconciliation after replacing only the Lab server while the
LangGraph service remains active, run the server and LangGraph service separately and
provide the listener PID:

```bash
AGENTLAB_RUN_LIVE_LANGGRAPH_SERVER_RESTART_UI=1 \
  AGENTLAB_LAB_SERVER_PID="$(lsof -tiTCP:4318 -sTCP:LISTEN | head -n1)" \
  node --test apps/web/tests/browser/live-platform-runners.browser.test.mjs
```

This uses the deterministic `fake-slow-success` model, reopens the existing run after
the server replacement, and expects one completed assistant message. It is also
destructive and opt-in; use a repository-owned server PID and keep the LangGraph
service running during the check.
