# Adding a harness

A new harness should represent an architectural question or provide a meaningful implementation of an existing paradigm.

Before adding code:

1. Define the platform and harness roles.
2. Decide whether the addition is a harness variant under one platform or under a composition.
3. Define its platform-specific agent definitions and agent topologies.
4. Declare a backend deployment profile and required infrastructure. Only Computer
   Native uses a computer environment.
5. Record model, context, memory, tool, observability, execution, and durability choices.
6. Record capabilities, dependencies, execution modes, and known limitations.
7. Explain how common events map to platform-specific events.
8. Add contract tests before comparing results.
9. Add documentation and a reproducible example.

Keep backend platform integrations, harness variants, and platform-specific agent
definitions inside `server/src/platforms/`. An independently owned harness such as Anesu
belongs in its own extraction-ready top-level project and integrates through
`server/src/integrations/`. Do not make scenarios depend on internal types.
