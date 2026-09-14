# Adding an environment

Add a computer environment only when Computer Native needs a distinct computer in which
to operate. The initial categories are local workspace process, sandboxed container,
and VM/remote computer. Do not add browser automation as an environment; it is a tool
capability.

Document the available interfaces, workspace and resource rules, permissions, network
policy, isolation, lifecycle, cleanup, required infrastructure, and failure behaviour.
Explain how the environment is selected and constrained for a run. Do not create a
Computer Native environment module unless a real adapter difference justifies it.
Backend platform deployments belong in a backend deployment profile, not this directory.

Keep scenario data, platform execution logic, and environment setup separate. Add a contract test when the environment exposes a shared interface.
