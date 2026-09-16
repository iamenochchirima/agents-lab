# Configuration

Computer Native configuration belongs here: model settings, workspace policy, tool
policy, and security controls. Do not put Lab experiment configuration in this
directory.

The first terminal slice reads `COMPUTER_NATIVE_*` settings and the optional
`OPENROUTER_API_KEY` from the process environment. The deterministic local provider is
the default. OpenRouter must be selected explicitly and requires both a model and key.
Workspace mutations are bounded independently: `COMPUTER_NATIVE_MAX_FILE_BYTES` limits
one file, `COMPUTER_NATIVE_MAX_PATCH_SET_BYTES` limits the resulting bytes across one
multi-file patch set, and `COMPUTER_NATIVE_MAX_TREE_BYTES` limits one directory-tree
operation. The effective values are included in the standalone `doctor` output and in
the prepared mutation evidence where the operation uses them.
