# Adding a harness

A new harness should represent an architectural question or provide a meaningful implementation of an existing paradigm.

Before adding code:

1. Define the platform and harness roles.
2. Decide whether the addition is a new harness, a variant, or a composition.
3. Record capabilities, dependencies, execution modes, and known limitations.
4. Explain how common events map to framework-specific events.
5. Add contract tests before comparing results.
6. Add documentation and a reproducible example.

Keep the platform implementation inside platforms and do not make scenarios depend on its internal types.
