# Local development

The local baseline uses the official `@workflow/world-local` World. It stores
Workflow runs, events, steps, and related state as JSON under the configured data
directory and uses an in-memory queue that delivers through the local service.

From this directory:

```sh
npm install
npm run dev
```

Install and run the focused platform suite from this directory as well:

```sh
npm install
npm test
```

The shared `server` package does not install the Workflow SDK. The service uses `sdk.ts`
to resolve the SDK explicitly from this platform's source or compiled platform
directory, so the root server build can run it without a shared dependency. The service
integration tests use the same local package when it is present and skip cleanly only
when the platform package itself is absent.

Readiness is available at `GET http://127.0.0.1:9094/ready`.

The service exposes the platform-local routes used by the runner:

- `POST /runs/admit` — validate, reserve, and start one native Workflow run.
- `GET /runs/:workflowRunId` — inspect native status and normalized output.
- `POST /runs/:workflowRunId?cancel=1` — request cancellation.
- `POST /.well-known/workflow/v1/flow` — generated Workflow SDK flow handler.

Configuration is environment-only:

```sh
AGENTLAB_VERCEL_WORKFLOWS_PORT=9094
AGENTLAB_VERCEL_WORKFLOWS_DATA_DIR=.local/workflow-data
OPENROUTER_API_KEY=...
AGENTLAB_OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

The fake provider is the default and does not make network calls. OpenRouter is
optional and is called only from the `executeModelStep` step. Its response content
is returned as the run output, but credentials and request headers are not stored in
the Lab manifest or native reference.

`npm run build:workflow` shows the standalone compilation independently. It writes
ignored generated files under `.workflow-build/` and the Workflow manifest under
`variants/baseline/execution/.well-known/`.
