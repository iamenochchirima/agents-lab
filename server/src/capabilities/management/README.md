# Managed capabilities

This application layer owns local administrative records, encrypted credential
references and publication of the common capability catalog. Platform loops do
not install packages or receive management credentials.

`ManagedRepository` holds one exclusive writer lock. An edit checks the expected
revision, validates the candidate and writes an immutable generation before
atomically switching its current pointer. Published ancestry excludes abandoned
write generations. Seed configuration is imported once; subsequent changes come
from persisted records. Historical generations retain source metadata for runs
that already admitted it. They do not restore revoked external authority.

`CapabilityManagement` builds source implementations, composes profiles and
publishes the host/catalog together after validation. Skills stay package scoped;
stdio executes in the process host, without giving the agent shell or native
filesystem access. Connections bind credentials to the workspace, connection,
resource and purpose.

Use the [credential guide](../../../../docs/guides/connection-credentials.md) for
key configuration and rotation, and the [import guide](../../../../docs/guides/capability-package-imports.md)
for portable skills and the Lab bundle format. This is local workspace
administration, not a hosted multi-tenant account service.
