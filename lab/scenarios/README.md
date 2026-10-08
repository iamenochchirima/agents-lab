# Scenarios

A scenario defines the work an agent must accomplish. It should be reusable across harnesses and should not contain a harness-specific failure plan.

Each scenario has space for fixtures, scenario-specific graders, and tests. Its documentation should define inputs, expected outputs, allowed tools, and known ambiguity.

Capability tasks include a [workspace report](workspace-capabilities/README.md)
and a [controlled service update](service-capabilities/README.md). Both require
agents to inspect evidence, save an actual result, verify it and apply a correction.

The [connected support adjustment](business-agent/README.md) adds a business
workflow with customer/order/policy reads, exact-action review and independent
verification. Optional document tasks now use an external provider rather than
native runtime filesystem management.
