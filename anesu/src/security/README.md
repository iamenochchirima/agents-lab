# Security

Owns permissions, secret boundaries, tool policy, resource limits, and sandbox-facing
security decisions. Do not treat environment isolation as sufficient authorization.

For external integrations, this includes credential access, OAuth-token boundaries,
account authorization, and approval policy for consequential actions such as a public
post or payment. An integration must never read another profile's credentials merely
because both are installed in the same process.

The current workspace policy resolves relative paths against a configured workspace root,
rejects traversal and symlink escapes, and applies file and directory limits before a
tool can access the filesystem. Directory-tree mutations also enforce aggregate entry,
byte, and depth limits before approval. Mutation targets additionally require an existing,
regular-file parent path, reject symbolic-link targets and parents, distinguish new
paths from existing files, and reserve the workspace-local quarantine and transaction
directories used by recoverable deletion and journaled patch sets. These internal
directories are hidden from normal listings and cannot be addressed by model paths. A
workspace root is an authorization boundary, not an automatic
process sandbox. The process policy authorizes only the explicit `run_command` shape:
an executable plus an argument vector, an approved workspace-relative working
directory, an allowlisted environment, and bounded timeout/output/argument limits. It
rejects shell grammar because the runner uses `shell: false`; an approved process can
still access host resources available to that executable, so the approval warning is
deliberately explicit. Executable and working-directory identity are rechecked after
approval, and unconfirmed termination is recorded as ambiguous rather than successful.

Evidence redaction is applied at the persistence boundary as well as in the TUI. Known
provider-key shapes such as `sk-...` and bearer credentials are removed from bounded
model-round payloads and workspace mutation previews before they are written. The
workspace file itself is not rewritten: redaction protects evidence, not user data.
