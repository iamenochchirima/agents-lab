# Platforms

Platforms are the durable-execution runtimes Agent Harness Lab integrates and compares
through explicit variants: Temporal, Restate, LangGraph, Mastra, Vercel Workflow / AI
SDK, Inngest, Trigger.dev, DBOS, Hatchet, and AWS Step Functions. A platform page will
describe its setup, what each variant owns, required infrastructure, limitations, and
how its native evidence maps to the Lab's run record. Backend platforms declare backend
deployment profiles rather than Computer Native environments.

OpenAI Agents SDK is an agent SDK, not a platform. Its first home is a Temporal variant.
We will add a more detailed orchestration taxonomy only when it makes an implemented
comparison clearer.

Platform implementation notes remain close to their code in `server/src/platforms/`.
The first usable notes are the [Temporal local-development guide](../server/src/platforms/temporal/docs/local-development.md)
and [Temporal architecture notes](../server/src/platforms/temporal/docs/architecture.md).

Computer Native is not a platform implementation. It is an extraction-ready standalone
project under `computer-native/`, with its Lab-side integration documented under
`server/src/integrations/computer-native/`.
