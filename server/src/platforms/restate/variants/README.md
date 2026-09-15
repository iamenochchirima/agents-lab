# Restate harness variants

Each variant owns a concrete Restate composition and its lifecycle semantics. The
`baseline` variant is intentionally narrow: one keyed Workflow, one durable model
step, and no tools or side effects. Future Restate variants must get their own plan
when they add services, virtual objects, signals, or richer agent behaviour.
