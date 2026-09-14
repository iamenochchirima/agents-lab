# Platforms

Platforms are the runtimes Agent Harness Lab integrates and compares through
explicit variants. A platform page will describe its setup, what each variant
owns, supported environments, required infrastructure, limitations, and how its
native evidence maps to the Lab's run record. Backend platforms declare backend
deployment profiles rather than Computer Native environments.

Platform implementation notes remain close to their code in `platforms/`. They
will enter this curated documentation area once an implementation is usable.

Computer Native is not a platform implementation. It is an extraction-ready standalone
project under `computer-native/`, with its Lab-side integration documented under
`integrations/computer-native/`.
