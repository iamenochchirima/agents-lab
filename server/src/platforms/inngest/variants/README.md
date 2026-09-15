# Inngest variants

Variants record event, step, wait, retry, cancellation, and idempotency choices
explicitly. The baseline is intentionally a single prompt function; future agent
capabilities should be added as new variant-owned behavior rather than silently
changing the comparison semantics.
