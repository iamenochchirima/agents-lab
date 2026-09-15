# Security

Owns permissions, secret boundaries, tool policy, resource limits, and sandbox-facing
security decisions. Do not treat environment isolation as sufficient authorization.

For external integrations, this includes credential access, OAuth-token boundaries,
account authorization, and approval policy for consequential actions such as a public
post or payment. An integration must never read another profile's credentials merely
because both are installed in the same process.

The current workspace policy resolves relative paths against a configured workspace root,
rejects traversal and symlink escapes, and applies file and directory limits before a
read-only tool can access the filesystem. A workspace root is an authorization boundary,
not an automatic process sandbox.
