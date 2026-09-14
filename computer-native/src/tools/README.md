# Tools

Owns filesystem, shell, program, MCP, and future browser tool implementations. Browser
automation is a tool capability, never a computer environment. Tool policy,
authorization, approval, and resource limits remain in security.

An integration may provide tools, such as `publish_post` or `list_accounts`. Tools
remain the model-facing action surface; provider authentication and API semantics belong
to integrations.
