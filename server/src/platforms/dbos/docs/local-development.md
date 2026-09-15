# DBOS local development

The baseline requires a real PostgreSQL database. It does not silently fall back to
an in-memory store.

## Install

```bash
npm install --prefix server/src/platforms/dbos
```

## Start PostgreSQL

The default profile expects PostgreSQL on `127.0.0.1:55432`. Docker is one
development option:

```bash
docker run --name agentlab-dbos-postgres --rm \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=agentlab_dbos \
  -p 55432:5432 \
  postgres:16
```

Docker is not a DBOS requirement. If PostgreSQL is installed directly on the
machine, create the database and point the service at it instead:

```bash
createdb agentlab_dbos
AGENTLAB_DBOS_SYSTEM_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/agentlab_dbos \
  npm --prefix server run dev:dbos
```

The same `AGENTLAB_DBOS_SYSTEM_DATABASE_URL` setting can point to an existing
remote PostgreSQL instance. DBOS still requires a real PostgreSQL system
database; SQLite or an in-memory substitute would change the durability model
and is intentionally not supported by this baseline.

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
