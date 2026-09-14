# Mastra platform

This directory will contain the Agent Harness Lab implementation using Mastra.

Mastra is a TypeScript-native platform. Its implementation should run through the
native Node.js and TypeScript toolchain so the laboratory evaluates the actual
platform rather than a Python reimplementation.

Keep Mastra-specific agents, workflows, storage configuration, telemetry mapping,
dependencies, and tests inside this directory. The laboratory's common runner and
run-record contract should communicate with this implementation through an explicit
adapter boundary.

The initial implementation is documented under `variants/baseline/`. Exact package,
Node.js, and model versions must be recorded when the implementation is added.
