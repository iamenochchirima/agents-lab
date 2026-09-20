# Plugins

Plugins are trusted extension manifests, not arbitrary code supplied by a model or a
filesystem scan. The current boundary validates IDs, versions, declared capabilities,
permissions, and resource limits. It does not execute plugin code or provide a marketplace.

Loaders must validate a plugin before it can be selected and must keep declared capability
grants separate from policy approval. A plugin cannot self-authorize a capability, access a
secret, or silently add network, filesystem, subprocess, or unbounded resource access.
