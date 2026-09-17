# Anesu integration

Anesu is an extraction-ready compute-native agent harness currently developed
in the top-level `anesu/` directory. It will eventually move to its own
repository and must remain runnable without Agent Harness Lab. The Lab server does not
contain its agent loop, workspace implementation, tools, skills, memory, sandbox
policy, or internal persistence code.

This directory is reserved for the Lab-side integration only. Its future responsibilities
are limited to:

- resolving a Lab run into a versioned start request;
- starting or contacting an Anesu runner;
- receiving normalized events, artifacts, and completion data;
- retaining native diagnostics without attempting to reinterpret its internals.

Anesu is the only initial subject with **computer environments**. Its runner
may operate in a local workspace process, sandboxed container, or VM/remote computer.
Browser automation, when added, is a controlled tool capability inside one of those
computer environments, not an environment category.

## Boundary

```text
Agent Harness Lab                         Anesu repository
-----------------                         --------------------------
resolved run request  ----------------->  independent runner
normalized events     <-----------------  native event adapter
artifacts and result  <-----------------  independent runtime
```

The precise protocol is intentionally not implemented yet. It will be versioned and
documented before either side relies on it.
