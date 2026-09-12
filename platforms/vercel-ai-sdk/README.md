# Vercel AI SDK platform

This directory will contain the Agent Harness Lab implementation using the Vercel AI
SDK.

The Vercel AI SDK is a TypeScript-native platform. Its implementation should run
through the native Node.js and TypeScript toolchain so the laboratory evaluates the
actual SDK and runtime rather than a Python reimplementation.

Keep SDK-specific model access, tool loops, streaming, telemetry mapping,
dependencies, and tests inside this directory. The laboratory's common runner and
run-record contract should communicate with this implementation through an explicit
adapter boundary.

The initial implementation is documented under `variants/baseline/`. Exact package,
Node.js, and model versions must be recorded when the implementation is added.
