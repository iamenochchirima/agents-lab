# Adding an environment

Add an execution environment when a harness needs a distinct host or isolation
boundary. Describe its process, container, or remote-machine properties without
conflating them with backend service deployment. Do not add browser automation as an
environment; it is a tool capability.

Document the available interfaces, workspace and resource rules, permissions, network
policy, isolation, lifecycle, cleanup, required infrastructure, and failure behaviour.
Explain how the environment is selected and constrained for a run. Do not create an
environment module unless a real adapter difference justifies it.
Backend platform deployments belong in a backend deployment profile, not this directory.

Keep scenario data, platform execution logic, and environment setup separate. Add a contract test when the environment exposes a shared interface.
