# DBOS baseline

The baseline is one DBOS workflow named `AgentLabDbosBaseline`. It validates the
prompt, performs one model step, and returns a JSON-safe result. The workflow ID is
derived from the Lab run ID, so repeated admission can return the existing workflow
instead of starting a second one.

The variant currently includes deterministic fake models (`fake-success`,
`fake-retry`, `fake-provider-failure`, `fake-ambiguous`, and `fake-delay`) and an
explicit OpenRouter adapter. Provider credentials remain in the service environment
and never enter workflow input or native evidence.
