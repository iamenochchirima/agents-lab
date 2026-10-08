# Reusable agent capabilities

Portable capability definitions used by Lab platform variants: skills, connections,
plugins, tool contracts, policies, and artifact definitions. This is not a generic agent
runtime. A platform variant composes these capabilities with its own execution model.

The server-owned capability catalog also resolves the small built-in skill catalog. A
profile may select context-only skills, but the resulting skill projection is kept in the
context session and cannot authorize a tool or connection.

See the [capability package guide](../../../docs/guides/capability-packages.md),
[extensible capability architecture](../../../docs/architecture/extensible-capabilities.md),
and [tool compatibility matrix](../../../docs/guides/connected-tool-compatibility.md)
for adapter, authentication and retained-evidence contracts.
