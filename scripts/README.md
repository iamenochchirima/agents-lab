# Scripts

Small, named scripts for setup, validation, experiment support, and maintenance belong here.

Scripts should state their inputs, side effects, required tools, and safe cleanup behaviour.

## Local stack

Run the currently available local services from the repository root:

```bash
./scripts/run_local_stack.sh
```

The launcher currently starts only the React/Vite frontend. Services can be
selected explicitly, which leaves the command ready to grow as local APIs,
workers, or infrastructure are added:

```bash
./scripts/run_local_stack.sh frontend
./scripts/run_local_stack.sh --help
```

The launcher checks for the frontend's installed Vite and Tailwind packages before
starting. Run the install command it prints after changing frontend dependencies.

The frontend defaults to `127.0.0.1:5173`. Override the bind address or port
without editing the script:

```bash
AGENTLAB_WEB_HOST=0.0.0.0 AGENTLAB_WEB_PORT=5174 ./scripts/run_local_stack.sh
```
