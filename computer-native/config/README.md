# Configuration

Computer Native configuration belongs here: model settings, workspace policy, tool
policy, and security controls. Do not put Lab experiment configuration in this
directory.

The first terminal slice reads `COMPUTER_NATIVE_*` settings and the optional
`OPENROUTER_API_KEY` from the process environment. The deterministic local provider is
the default. OpenRouter must be selected explicitly and requires both a model and key.
