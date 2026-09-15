# Hatchet platform

The Hatchet baseline is a real full-stack Hatchet task: the Lab runner submits a
standalone task, a separate TypeScript worker executes it, and the runner reads
Hatchet's persisted task/run state back into comparable Lab evidence.

This is platform-local code. Hatchet SDK types and dependencies stay here rather
than entering the shared server package.

Start with:

- [architecture](docs/architecture.md)
- [execution semantics](docs/semantics.md)
- [local development](docs/local-development.md)
- [local dependency stack](deployment/README.md)
- [baseline variant](variants/baseline/README.md)
