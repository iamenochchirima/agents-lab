# Local Hatchet stack

This directory pins the optional full Hatchet server topology used when the
baseline is intentionally run remotely:
PostgreSQL, RabbitMQ, migrations, generated server configuration, the engine,
and the dashboard. The images are pinned to Hatchet `v0.106.5`; the TypeScript
worker uses the separate platform-local SDK pin in `../package.json`.

The ports are isolated from the other local services:

| Service               | Host address             |
| --------------------- | ------------------------ |
| Hatchet dashboard/API | `http://127.0.0.1:18080` |
| Hatchet worker gRPC   | `127.0.0.1:17077`        |
| PostgreSQL            | `127.0.0.1:55435`        |
| RabbitMQ management   | `http://127.0.0.1:15673` |

From the repository root:

```sh
docker compose -f server/src/platforms/hatchet/deployment/docker-compose.yml up -d
docker compose -f server/src/platforms/hatchet/deployment/docker-compose.yml ps
```

Create a local worker token after the dashboard and engine are ready:

```sh
docker compose -f server/src/platforms/hatchet/deployment/docker-compose.yml run --rm --no-deps \
  setup-config /hatchet/hatchet-admin token create --config /hatchet/config \
  --tenant-id 707d0855-80ab-4e1f-a156-f1c4546cbf52
```

Export the returned token only in the shell running the worker. It is never
written to Lab manifests or native evidence:

```sh
export HATCHET_CLIENT_TOKEN='paste-local-token-here'
export AGENTLAB_HATCHET_API_URL='http://127.0.0.1:18080'
export AGENTLAB_HATCHET_HOST_PORT='127.0.0.1:17077'
```

The admin credentials and authentication-disabled variants in the official
guide are for local development only. This repository keeps authentication
enabled so the worker boundary remains representative.

Sources:

- [Hatchet Docker Compose deployment](https://docs.hatchet.run/self-hosting/docker-compose)
- [Hatchet architecture and guarantees](https://docs.hatchet.run/v1/architecture-and-guarantees)
- [Hatchet `v0.106.5` release](https://github.com/hatchet-dev/hatchet/releases/tag/v0.106.5)
