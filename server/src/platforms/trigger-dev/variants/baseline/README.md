# Trigger.dev baseline

The baseline is one official Trigger task that accepts the common prompt payload,
executes a deterministic fake model, and returns structured task evidence. Its
platform-managed state is the Trigger run; its comparable state is emitted through
the Lab runner inspection.

The task is intentionally small so the first real Trigger integration can be
observed before adding tools, integrations, or an external model provider.
