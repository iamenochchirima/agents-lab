# DBOS local development

The baseline requires a real PostgreSQL database. It does not silently fall back to
an in-memory store.

## Install

```bash
npm install --prefix server/src/platforms/dbos
```

## Start PostgreSQL

The default profile expects PostgreSQL on `127.0.0.1:55432`:

```bash
docker run --name agentlab-dbos-postgres --rm \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=agentlab_dbos \
  -p 55432:5432 \
  postgres:16
```

The database URL can be changed with
`AGENTLAB_DBOS_SYSTEM_DATABASE_URL`. Credentials are configuration only and are
redacted from manifests and native evidence.

## Start the workflow host

DBOS uses port `9092` by default so it can run beside the Inngest service on `9091`:

```bash
npm --prefix server run dev:dbos
```

Check readiness:

```bash
node -e "fetch('http://127.0.0.1:9092/ready').then(async r => console.log(r.status, await r.text()))"
```

Start the Lab server separately with `npm --prefix server run dev`. It will report
DBOS as reachable only after both the workflow host and PostgreSQL are ready.

## Reset local state

Stop the service and remove the PostgreSQL database or its local volume. DBOS owns
its schema and migration lifecycle; do not delete `lab/runs/` to reset DBOS state.
