# Plugins

Owns optional code extensions and their lifecycle. A plugin may contribute a channel
adapter, tool, model provider adapter, hook, or other explicitly defined extension
point.

Plugins are distinct from skills. A skill is agent-facing instructions or reusable
procedural knowledge that can enter context; a plugin is trusted executable integration
code. Plugin discovery, compatibility checks, permissions, configuration, activation,
and failure isolation belong here.

A plugin may contribute an integration connector, but connector account lifecycle and
provider-specific API semantics remain owned by integrations.

No plugin API exists yet. Define one only after the first concrete extension boundary
is implemented and its lifecycle requirements are known.
