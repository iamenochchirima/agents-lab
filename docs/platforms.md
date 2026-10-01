# Platforms

Platforms are the durable-execution runtimes Agent Harness Lab integrates and compares
through explicit variants: Temporal, Restate, LangGraph, Mastra, Vercel Workflow / AI
SDK, Inngest, Trigger.dev, DBOS, Hatchet, and AWS Step Functions. A platform page will
describe its setup, what each variant owns, required infrastructure, limitations, and
how its native evidence maps to the Lab's run record. Backend platforms declare backend
deployment profiles rather than Lina environments.

OpenAI Agents SDK is an agent SDK, not a platform. Its first home is a Temporal variant.
We will add a more detailed orchestration taxonomy only when it makes an implemented
comparison clearer.

Platform implementation notes remain close to their code in `server/src/platforms/`.
The first usable notes are the [Temporal local-development guide](../server/src/platforms/temporal/docs/local-development.md)
and [Temporal architecture notes](../server/src/platforms/temporal/docs/architecture.md).

The current comparable acceptance workload is documented in the
[Platform Agent Conformance scenario](../lab/scenarios/platform-agent-conformance/README.md)
and governed by the [completed conformance plan](../development/implementation-plans/platforms/completed/platform-agent-conformance.md).
It covers one prompt, one bounded calculator tool turn, and one two-turn context
continuation across the Temporal, Restate, LangGraph, and Mastra baselines. The
workload compares observed lifecycle and evidence; it does not claim equivalent
durability or production hosting. The native local paths for these four baselines do
not require Docker.

The platform capability phase adds a server-owned profile containing pure tools, a
read-only connection, skills, and an approval-gated write fixture. Chat and Compare show
the selected profile, tool/connection activity, approvals, context usage, and honest
failure or unknown states. The deterministic four-platform capability matrix uses local
HTTP fixtures; real providers and hosted secret stores remain separate acceptance work.

Lina is not a platform implementation. It is an extraction-ready standalone
project under `lina/`, with its Lab-side integration documented under
`server/src/integrations/lina/`.
