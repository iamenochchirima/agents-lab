# Tools

Owns filesystem, shell, program, MCP, and browser tool implementations. Browser
automation is a tool capability, never a computer environment. Tool policy,
authorization, approval, and resource limits remain in security.

An integration may provide tools, such as `publish_post` or `list_accounts`. Tools
remain the model-facing action surface; provider authentication and API semantics belong
to integrations.
# Tools

The tool registry owns the model-facing definitions, argument validation, dispatch, and
model-visible results for Computer Native tools. Tool implementations do not resolve
paths directly: filesystem access goes through the workspace and security modules.

The current slice exposes five read-only tools and thirteen approval-gated mutation tools:

- `list_directory`
- `read_file`
- `stat` — returns bounded metadata without following symbolic-link targets
- `search_files` — searches literal UTF-8 text, bounded relative path-name patterns, or
  both. Name patterns support only `*` and `?`; traversal, absolute paths, and bracket
  expressions are rejected. Hidden, generated, sensitive, symbolic-link, oversized, and
  binary files are skipped
- `list_quarantine` — lists bounded metadata and restore tokens for recoverable deleted
  files without returning their contents or permanently removing anything
- `write_file` — previews a complete one-file replacement or creation and writes only
  after `allow-once`
- `mkdir` — previews creation of one directory, requires an existing parent, and treats
  an existing directory as an idempotent result
- `delete_directory` — previews deletion of one existing empty directory, requires
  approval, rejects the workspace root and non-empty directories, and never removes
  children recursively
- `delete_directory_tree` — preflights a bounded directory tree, rejects symlinks and
  special files, and moves the tree into quarantine with a restore token after approval
- `delete` — previews quarantine of one regular file and returns a restore token after
  approval; it does not permanently remove the file
- `restore` — previews restoration from a delete token without overwriting an existing
  path, and requires approval
- `restore_directory` — restores a quarantined directory tree only when its manifest
  still matches and the original path is absent
- `purge_quarantine` — permanently removes one exact file or directory quarantine token;
  it is irreversible, approval-gated, and never accepts a path or wildcard
- `copy` — previews a regular-file or bounded directory-tree copy to an absent
  destination, rejects links and special files in trees, and rechecks the source hash or
  manifest before creating it
- `move` — previews a same-filesystem regular-file or directory-tree move to an absent
  destination and rechecks the source hash or manifest without replacing a destination
- `rename` — previews a same-parent regular-file or directory rename to an absent
  destination and rechecks the source hash or manifest before committing it
- `apply_patch` — prepares one bounded add/update patch, shows the exact diff to the
  approval channel, and writes only after `allow-once`.
- `apply_patch_set` — prepares 2–16 bounded single-file patches, shows the affected paths
  and aggregate diff, and commits members through a durable journal after one approval.
  It does not claim all-or-nothing filesystem atomicity; partial outcomes require
  reconciliation.
- `run_command` — prepares one exact executable and argument vector for a real local
  foreground process. It requires approval, starts with a sanitized environment and
  workspace-relative cwd, uses `shell: false`, ignores stdin, and bounds timeout,
  output, and argument sizes. It is omitted entirely when process mode is `deny`.

Tool calls are not authorization. The workspace security policy decides whether the
requested path is allowed, and the runtime approval callback decides whether the
prepared mutation may commit. Missing approval fails closed; a tool response never
claims a change happened before the atomic commit succeeds. Mutation results include
typed failure categories where applicable: `mutation-invalid`, `approval-denied`,
`approval-unavailable`, `mutation-stale`, and `mutation-failed`. Restart conflicts are
recorded as `reconciliation-required`. Approval requests also carry an operation-specific
risk classification such as `patch-file`, `quarantine-file`, `delete-directory`,
`delete-directory-tree`, `restore-directory`, `purge-quarantine`, `copy-file`,
`copy-directory`, `move-file`, `move-directory`, `rename-file`, or
`rename-directory`.
