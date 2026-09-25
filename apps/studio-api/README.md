# Studio API

This is Studio's independent HTTP host. It does not import `server/`, start an
agent module, or construct the Platform Lab control plane. The first endpoint is
`GET /health`, which returns the JSON contract from
`@agent-harness-lab/studio-http-contract`.

Run it in one terminal:

```sh
pnpm --filter @agent-harness-lab/studio-api dev
```

Run the web app in another terminal:

```sh
pnpm --filter @agent-harness-lab/web dev
```

Open `/studio`. The browser calls `http://127.0.0.1:4320/health`. The API allows
only the configured `STUDIO_API_WEB_ORIGIN` (default
`http://localhost:5173`). Set `STUDIO_API_HOST`, `STUDIO_API_PORT`, and
`STUDIO_API_WEB_ORIGIN` when running the host elsewhere. Set
`VITE_AGENTLAB_STUDIO_API_URL` in the web process to change its API base URL.

The API declares Fastify and `@fastify/cors` directly so its process does not rely
on transitive dependencies from `server/`. These are the HTTP packages already
used by the Lab service; no new web framework is introduced.

The health response proves only that the browser can reach the host. It does not
mean module loading, assembly, or run endpoints are implemented.
