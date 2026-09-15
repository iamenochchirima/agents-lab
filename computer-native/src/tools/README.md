# Tools

Owns filesystem, shell, program, MCP, and future browser tool implementations. Browser
automation is a tool capability, never a computer environment. Tool policy,
authorization, approval, and resource limits remain in security.

An integration may provide tools, such as `publish_post` or `list_accounts`. Tools
remain the model-facing action surface; provider authentication and API semantics belong
to integrations.
# Tools

The tool registry owns the model-facing definitions, argument validation, dispatch, and
model-visible results for Computer Native tools. Tool implementations do not resolve
paths directly: filesystem access goes through the workspace and security modules.

The current slice exposes only two read-only tools:

- `list_directory`
- `read_file`

Tool calls are not authorization. The workspace security policy decides whether the
requested path is allowed before an implementation reads it.
