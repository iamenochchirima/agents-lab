# Experiments

An experiment defines what we are trying to learn from one or more runs.

Keep the scenario workload separate from the failure plan or comparison variable. Record the hypothesis, controls, procedure, measurements, and limitations before running it.

The [agent harness baseline evaluation](agent-harness-baseline/README.md)
defines staged acceptance for platform development. It separates scripted harness
conformance, live-model behavior, and optional platform capabilities.

The [real capability acceptance experiment](agent-capabilities-live/README.md)
observes free-model decisions on shared workspace and MCP/API tasks, including
follow-up corrections and independent inspection of their saved effects.

The four-platform acceptance procedure is documented in
[`platform-comparison/`](platform-comparison/README.md). It remains an experiment
protocol, not a claim that the platforms are equivalent.
