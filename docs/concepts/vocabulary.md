# Project vocabulary

The canonical terms are defined in the root CONTEXT.md.

Use platform for a technology or runtime. Use harness variant for a runnable agent
implementation built with one platform or a composition. Use harness configuration for
the concrete assembly selected for a run. An agent definition describes the identity,
instructions, roles, topology, and platform-owned orchestration inside that variant.

Use computer environment for the local workspace process, sandboxed container, or VM
used by Anesu. Use backend deployment profile for the service topology of
Temporal, Restate, LangGraph, and SDK-based implementations. Use infrastructure for
deployable services and operational resources. Use scenario for the workload and
experiment for the test protocol. Use run for one execution and run record for its
durable evidence.

Do not use these terms interchangeably. Browser automation is a tool capability, not a
computer environment. Anesu is an external integration, not a project-owned
platform implementation. Research and coding are scenarios, not agent topologies. A
single-agent or supervisor-and-subagents topology may be tested against either workload.
