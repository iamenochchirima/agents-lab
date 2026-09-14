# Context

Owns construction of the exact bounded input sent to a model. It resolves the precedence
and budget of system instructions, `SOUL.md`, `AGENTS.md`, profile instructions, skills,
memory retrieval, session history, workspace context, and exposed tool descriptions.

Context construction is observable and reproducible: it must explain what was selected,
what was omitted or compacted, and why. It does not call a provider or execute a turn.
