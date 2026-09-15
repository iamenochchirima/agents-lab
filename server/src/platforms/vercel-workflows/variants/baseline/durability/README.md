# durability

Durability is delegated to `workflow` and the selected World. The baseline exercises
local JSON persistence, queue delivery, a durable sleep branch, cancellation, and
restart recovery setup. OpenRouter calls may be repeated by Workflow step retries;
the baseline does not claim exactly-once external provider calls.
