# Agent kernel

The kernel owns how a selected set of modules will be checked, connected, and
run. In this foundation slice it only defines a declarative assembly shape. It
does not load packages, execute turns, persist runs, or manage recovery; those
behaviors belong to later focused plans.

The kernel depends on the shared protocol, not on module-private source paths.
Role contracts stay in their module packages.
```
{ schemaVersion: 1, id, version, modules: { memory: { package, implementation, configuration } } }
```
