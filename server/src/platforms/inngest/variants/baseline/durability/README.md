# durability

The baseline's durability boundary is the Inngest event, `step.run`, `step.sleep`,
bounded function retries, stable event IDs, and cancellation events. See
[`../../../docs/semantics.md`](../../../docs/semantics.md) for the exact
replay and acknowledgement rules.
