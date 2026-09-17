# Context

Owns construction of the exact bounded input sent to a model. It resolves the precedence
and budget of system instructions, `SOUL.md`, `AGENTS.md`, profile instructions, skills,
memory retrieval, session history, workspace context, and exposed tool descriptions.

Context construction is observable and reproducible: it must explain what was selected,
what was omitted or compacted, and why. It does not call a provider or execute a turn.

The first terminal slice uses only the declared initial instruction and the current user
prompt. It does not load files, skills, memory, profile instructions, or tool schemas.
