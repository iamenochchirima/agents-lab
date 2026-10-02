# Environments and infrastructure

An execution environment defines where a harness operates, such as a local process,
sandboxed container, or remote machine. Browser automation is a tool capability, not
an environment by itself.

Backend deployment profiles define how durability-platform implementations are hosted:
their application service or worker, persistence, durable runtime where applicable,
networking, secrets, and observability. Infrastructure names the individual services a
profile needs, such as a database, workflow service, or queue.

Environment, deployment-profile, and infrastructure choices belong in a run record
when they can change reliability, permissions, latency, cost, or recovery behaviour.
