# Skills

Skills are versioned, allowlisted context packages. A skill contributes bounded text to
the model context and carries provenance and a digest; it cannot grant tools, widen
permissions, read secrets, or execute code.

The server resolves profile-selected skills before a context session is admitted. The
validated projection is stored with the session so every platform sees the same skill
message and compaction preserves it as an instruction source. Run evidence redacts the
skill body while retaining its ID, version, digest, and source classification.

Filesystem discovery is not authorization. Use `SkillLoader` with an explicit allowlist,
semantic versions, size limits, and digest validation. Built-in local profiles use the
`SkillCatalog`; external skill roots are a later configured integration.
