# Workspace

Owns workspace ownership, files, and durable task-local documents. It is the seam
between agent logic and its permitted computer resources. The current implementation
provides bounded UTF-8 reads, stable directory listings, metadata inspection, literal
text search, one-file `apply_patch`/`write_file` preparation and commit, journaled
multi-file `apply_patch_set` preparation and commit, explicit one-directory creation,
recoverable regular-file deletion/restoration, and explicit empty-directory deletion
through the security policy. Directory-tree deletion is bounded, recoverable, and
separate from the empty-directory operation; quarantine entries can be restored or
permanently purged only by exact token after a second approval.

`stat` reports file type, size, timestamps, mode, and link count without following a
symbolic-link target. `searchFiles` returns bounded literal content matches, bounded
relative path-name matches, or both. Name patterns support only `*` and `?`; traversal,
absolute paths, bracket expressions, and oversized patterns are rejected. Both operations
are read-only and do not use the approval gate.

`apply_patch` and `write_file` prepare the exact before/after content and hashes in memory.
The runtime must supply an explicit approval decision before `commitPatch` can write. Commit rechecks
the expected hash, rejects symlinks and path escapes, writes a same-directory temporary
file, flushes it, and atomically renames it into place. A patch is never silently
rebased over a changed file. Explicit run outputs belong to the artifacts module, even
when a tool produced them inside the workspace.

`preparePatchSet` validates every member before commit, presents one bounded aggregate
preview, and `commitPatchSet` records member order, before/after hashes, staged temporary
paths, and recovery state. The transaction directory is workspace-local, mode-restricted,
hidden from normal tools, and never exposed as a user path. A member can commit before a
later member fails; that partial state is journaled and reconciled from hashes. The set
does not claim all-or-nothing filesystem atomicity and is never automatically replayed.
Successful or no-op reconciliation removes only an empty transaction directory; a
non-empty or conflicting directory is retained for manual inspection.

`prepareDirectory` and `commitDirectory` use the same authorization boundary and approval
seam. The first version creates only one directory whose parent already exists; it does
not create missing parents recursively. An existing directory is an idempotent no-op,
while an existing non-directory is rejected.

`prepareDelete` accepts one existing regular file, records a byte hash and metadata, and
prepares a workspace-local quarantine destination. `commitDelete` moves the file into
that quarantine only after approval; it does not permanently remove it. The returned
mutation token can be passed to `prepareRestore`, which refuses to overwrite an existing
path and restores the original bytes after a second approval. The reserved quarantine
directory is hidden from normal workspace listing and cannot be addressed by model paths.
`listQuarantine` provides bounded, read-only metadata and restore tokens for file and
directory-tree entries that remain in that area; it never returns quarantined contents
and never purges an entry.

`prepareDirectoryDeletion` and `commitDirectoryDeletion` are separate from file
quarantine. They accept only an existing empty directory, reject the workspace root,
recheck that the directory is still empty immediately before commit, and use non-recursive
directory removal. A directory that becomes non-empty is rejected as stale; no child is
removed automatically. `prepareDirectoryTreeDeletion` separately preflights a directory
tree with entry, aggregate-byte, and depth limits. It uses `lstat`, rejects symlinks and
special files, records a deterministic manifest hash, and moves the complete tree into
the same workspace-local quarantine after approval. `prepareDirectoryRestore` checks the
manifest again and restores only into an absent destination. `prepareQuarantinePurge`
accepts only an exact token and `commitQuarantinePurge` removes the payload without
following links; if cleanup becomes partial or ambiguous it reports
`reconciliation-required` and does not retry automatically.

`prepareCopy` and `prepareMove` support regular files and bounded directory trees. Both
require an existing parent and an absent destination, capture a source byte hash or tree
manifest, and recheck it before commit. File copy stages bytes and links the staged inode
into place without replacing a destination, including when the destination is on another
filesystem. Directory copy rejects symbolic links and special files, applies the shared
entry, byte, and depth limits, copies regular files without following links, and removes
its newly created destination if the source changes during the copy. Move preflights the
source and destination devices before approval and rejects cross-device transfers; file
move uses a no-replace destination link, while directory move uses same-filesystem
rename after manifest revalidation. `prepareRename` is the explicit same-parent form for
both files and directories. All three operations require approval through the tool
registry and carry source identity, kind, manifest, and byte evidence into the mutation
record. Restart reconciliation distinguishes source-only, destination-only, and
ambiguous states for both file hashes and directory manifests.

The process slice reuses this module's security policy only to authorize and describe a
workspace-relative process cwd. It does not turn the workspace into a host sandbox and
does not make process side effects part of workspace mutation semantics; those belong to
`src/process/`, `src/security/process-policy.ts`, and the turn execution records.
