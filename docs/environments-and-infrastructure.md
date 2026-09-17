# Environments and infrastructure

Anesu environments define the computer in which that external harness may
act: a local workspace process, sandboxed container, or VM/remote computer. Browser
automation is a tool capability within one of those environments.

Backend deployment profiles define how durability-platform implementations are hosted:
their application service or worker, persistence, durable runtime where applicable,
networking, secrets, and observability. Infrastructure names the individual services a
profile needs, such as a database, workflow service, or queue.

Computer-environment, deployment-profile, and infrastructure choices are recorded in a
run because they can change reliability, permissions, latency, cost, and recovery
behaviour.
