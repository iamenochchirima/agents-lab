# Anesu real-provider acceptance

This is a short manual check for the standalone Anesu provider path. It uses
the local development environment already loaded by the CLI; it does not require pasting
an API key into the shell or into a prompt.

## One-time local setup

From `anesu/`, copy `.env.example` to `.env` and set:

```dotenv
ANESU_PROVIDER=openrouter
OPENROUTER_MODEL=<namespace>/<model>:free
OPENROUTER_API_KEY=<local-key>
```

`.env` is ignored by git. Never put the key in a plan, fixture, transcript, prompt, or
commit.

## Acceptance flow

Run the normal command:

```bash
cd /home/enoch/aworkspace/agents/agents-lab/anesu
pnpm run chat
```

Then type these prompts in the TUI:

1. `/models` — the active line must identify `openrouter/<configured-model>`, and the
   provider list must show the declared capabilities. It must not show deterministic as
   the active provider or claim an automatic fallback.
2. `Reply with exactly ACCEPTANCE_OK and nothing else.` — the response must come from
   the configured real model, and the activity should finish as `completed`.
3. `List the files in the current workspace, without changing anything.` — the response
   should use the bounded read-only workspace path and must not request approval for a
   mutation.
4. `/status` — confirm the provider/model, session, workspace, tool list, and evidence
   directory are visible.

Inspect the evidence path shown by `/status` if a run needs investigation. The model
attempt record should identify the provider and model and may include provider request
identity, latency, usage, and effective request/output limits. It must not contain the
API key.

## Failure and rotation checks

- Remove or invalidate the local key, restart `pnpm run chat`, and confirm startup or the
  turn reports a configuration/provider-auth failure rather than deterministic output.
- To rotate a key, edit only the ignored `.env`, close the current session, and start
  `pnpm run chat` again. Provider credentials are loaded at process start; an existing
  session is not hot-switched to a different credential.
- If the provider is unavailable, record the provider/model and typed error shown. Do
  not treat a deterministic response as evidence that the real-provider path worked.

This playground is an acceptance procedure, not an automated test and not evidence that
all providers or all model families are production-ready.
