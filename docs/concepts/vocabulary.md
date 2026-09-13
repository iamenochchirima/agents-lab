# Project vocabulary

The canonical terms are defined in the root CONTEXT.md.

Use platform for a technology or runtime. Use harness variant for a runnable agent
implementation built with one platform or a composition. Use harness configuration for
the concrete assembly selected for a run. An agent definition describes the identity,
instructions, roles, topology, and platform-owned orchestration inside that variant.

Use environment for the capabilities and restrictions surrounding the running agent.
Use infrastructure for deployable services and operational resources. Use scenario for
the workload and experiment for the test protocol. Use run for one execution and run
record for its durable evidence.

Do not use these terms interchangeably. A filesystem-native environment can be paired
with a standalone, graph, SDK, workflow, or durable-runtime platform. Research and
coding are scenarios, not agent topologies. A single-agent or supervisor-and-subagents
topology may be tested against either workload.
