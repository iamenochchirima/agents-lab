# Agent Harness Lab

This repository is a pnpm workspace for the Agent Harness Lab. It keeps the
standalone harness, Lab server, web app, and platform packages under one lockfile so
shared dependencies are stored once and workspace packages can be linked directly.

## Start here

```bash
pnpm install
pnpm run chat
```

`pnpm run chat` forwards to the Anesu terminal. To use the configured real
model, copy `anesu/.env.example` to `anesu/.env` once and set the
provider, model, and API key there. The file is ignored by git. For the web app and
Lab services, see the package README files and `scripts/run_local_stack.sh`.
