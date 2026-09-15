import type { PlatformDescriptor } from "./platformTypes";

const noComputerEnvironment: readonly string[] = [];

function plannedPlatform(
  id: string,
  name: string,
  role: string,
  description: string,
  language: string,
  runtime: string,
  executionModel: string,
  durabilityModel: string,
  implementationDocumentId: string,
): PlatformDescriptor {
  return {
    id,
    name,
    role,
    description,
    kind: "backend",
    language,
    runtime,
    executionModel,
    durabilityModel,
    status: "planned",
    computerEnvironmentIds: noComputerEnvironment,
    backendProfiles: [],
    infrastructure: [],
    implementationDocumentId,
    variants: [{ id: "baseline", name: `${name} baseline`, description: `The first comparable ${name} implementation.`, status: "planned" }],
  };
}

export const platformCatalog: readonly PlatformDescriptor[] = [
  {
    id: "computer-native",
    name: "Computer Native",
    role: "Independent computer-native agent product",
    description: "An independently developed computer-native harness studied through the Lab integration boundary.",
    kind: "computer-native",
    language: "TypeScript",
    runtime: "Independent local or remote runner",
    executionModel: "Computer-native model and tool loop",
    durabilityModel: "Owned by the external harness",
    status: "planned",
    computerEnvironmentIds: ["local-workspace", "sandboxed-container", "remote-vm"],
    backendProfiles: [],
    infrastructure: [],
    implementationDocumentId: "server/src/integrations/computer-native/README.md",
    variants: [{ id: "baseline", name: "Computer Native baseline", description: "The external harness's first Lab-compatible release.", status: "planned" }],
  },
  {
    ...plannedPlatform("temporal", "Temporal", "Durable workflow execution", "An agent runtime hosted in workflows and activities with durable history and recovery.", "TypeScript", "Node.js worker + Temporal", "Workflow-coordinated agent loop", "Workflow history, retries, timers, and signals", "server/src/platforms/temporal/README.md"),
    backendProfiles: [{ id: "local-temporal-stack", name: "Local Temporal stack", description: "A Lab server, Temporal server, database, and worker for local development.", status: "planned" }],
    infrastructure: [
      { id: "temporal-server", name: "Temporal server", description: "Stores workflow history and coordinates tasks, timers, signals, and retries.", requirement: "required", status: "planned" },
      { id: "temporal-worker", name: "Temporal worker", description: "Runs the workflow and activity code for the selected agent variant.", requirement: "required", status: "planned" },
    ],
    variants: [
      { id: "baseline", name: "Temporal baseline", description: "A single workflow-hosted agent with explicit activity boundaries.", status: "planned" },
      { id: "openai-agents-sdk", name: "OpenAI Agents SDK", description: "A Temporal-hosted agent that uses OpenAI Agents SDK primitives.", status: "planned" },
    ],
  },
  {
    ...plannedPlatform("restate", "Restate", "Durable application runtime", "A service-oriented agent runtime using durable handlers, state, and communication.", "TypeScript", "Node.js service + Restate", "Durable service handler loop", "Durable invocations, state, and messages", "server/src/platforms/restate/README.md"),
    backendProfiles: [{ id: "local-restate-stack", name: "Local Restate stack", description: "A Lab server, Restate runtime, and agent service for local development.", status: "planned" }],
    infrastructure: [{ id: "restate-server", name: "Restate runtime", description: "Coordinates durable invocations, state, and communication for the service.", requirement: "required", status: "planned" }],
  },
  {
    ...plannedPlatform("langgraph", "LangGraph", "Durable graph execution", "An explicit graph of nodes, transitions, and checkpointed state for agent work.", "Python", "Python application service", "Graph-driven state transitions", "Graph checkpointing and persistence", "server/src/platforms/langgraph/README.md"),
    backendProfiles: [{ id: "local-langgraph-service", name: "Local LangGraph service", description: "A Python service with SQLite-backed graph checkpoints.", status: "ready" }],
    infrastructure: [{ id: "langgraph-service", name: "LangGraph service", description: "Runs the baseline graph and owns its checkpoint state.", requirement: "required", status: "ready" }],
  },
  {
    ...plannedPlatform("mastra", "Mastra", "Durable agent and workflow execution", "An agent and workflow runtime with state snapshots and durable execution options.", "TypeScript", "Node.js application service", "Agent and workflow primitives", "Workflow snapshots and configured durable execution", "server/src/platforms/mastra/README.md"),
    backendProfiles: [{ id: "local-lab-server", name: "Local Lab server", description: "Runs the direct Mastra agent in the Lab server process.", status: "ready" }],
  },
  {
    ...plannedPlatform("vercel-workflows", "Vercel Workflow / AI SDK", "Durable workflow execution", "Vercel workflow execution together with AI SDK agent primitives.", "TypeScript", "Node.js or Vercel runtime", "Workflow-hosted agent loop", "Workflow-managed state, waits, and recovery", "server/src/platforms/vercel-workflows/README.md"),
    status: "ready",
    backendProfiles: [{ id: "local-vercel-workflows", name: "Local Vercel Workflows", description: "The Workflow SDK local service and filesystem-backed workflow state.", status: "ready" }],
    infrastructure: [{ id: "vercel-workflows-service", name: "Vercel Workflows service", description: "Admits workflow runs and projects native workflow state to the Lab server.", requirement: "required", status: "ready" }],
    variants: [{ id: "baseline", name: "Vercel Workflows baseline", description: "A single Workflow SDK execution with a model step.", status: "ready" }],
  },
  {
    ...plannedPlatform("inngest", "Inngest", "Event-driven durable functions", "Event-driven functions and workflows for background and agent work.", "TypeScript", "Node.js service + Inngest", "Event-driven function execution", "Durable steps, events, waits, and retries", "server/src/platforms/inngest/README.md"),
    backendProfiles: [{ id: "local-inngest-stack", name: "Local Inngest stack", description: "A Lab server, Inngest function service, and local Dev Server.", status: "ready" }],
    infrastructure: [{ id: "inngest-dev-server", name: "Inngest Dev Server", description: "Schedules events, runs functions, and provides local durable step behavior.", requirement: "required", status: "ready" }],
  },
  {
    ...plannedPlatform("trigger-dev", "Trigger.dev", "Durable background workflows", "Background jobs and workflow execution for long-running agent work.", "TypeScript", "Node.js service + Trigger.dev", "Task and workflow execution", "Durable task runs, waits, and retries", "server/src/platforms/trigger-dev/README.md"),
    backendProfiles: [{ id: "local-trigger-stack", name: "Local Trigger stack", description: "A Lab server, Trigger API, and local task worker.", status: "ready" }],
    infrastructure: [{ id: "trigger-server", name: "Trigger server", description: "Admits task runs and stores task history for local execution.", requirement: "required", status: "ready" }],
  },
  {
    ...plannedPlatform("dbos", "DBOS", "Database-backed durable execution", "Database-backed durable workflows and application operations.", "TypeScript", "Node.js service + DBOS", "Database-backed workflow execution", "Database-persisted workflow state and recovery", "server/src/platforms/dbos/README.md"),
    backendProfiles: [{ id: "local-dbos-stack", name: "Local DBOS stack", description: "A Lab server, DBOS workflow host, and PostgreSQL database.", status: "ready" }],
    infrastructure: [{ id: "dbos-postgres", name: "DBOS PostgreSQL", description: "Stores DBOS workflow state, steps, and recovery metadata.", requirement: "required", status: "ready" }],
  },
  {
    ...plannedPlatform("hatchet", "Hatchet", "Durable task orchestration", "Task orchestration and background workflow execution for agent work.", "TypeScript", "Node.js service + Hatchet", "Task-driven workflow execution", "Durable task state, retries, and scheduling", "server/src/platforms/hatchet/README.md"),
    status: "ready",
    backendProfiles: [{ id: "local-hatchet-stack", name: "Local Hatchet stack", description: "A local Hatchet server and separate TypeScript worker.", status: "ready" }],
    infrastructure: [{ id: "hatchet-server", name: "Hatchet server", description: "Admits tasks, tracks durable state, and coordinates the worker.", requirement: "required", status: "ready" }],
    variants: [{ id: "baseline", name: "Hatchet baseline", description: "A single Hatchet task executed by a registered worker.", status: "ready" }],
  },
  {
    ...plannedPlatform("aws-step-functions", "AWS Step Functions", "Managed durable state machines", "AWS-managed state machines for durable, event-driven agent workflows.", "TypeScript", "AWS Step Functions + workers", "Managed state-machine execution", "Managed state, retries, waits, and events", "server/src/platforms/aws-step-functions/README.md"),
    status: "ready",
    backendProfiles: [{ id: "local-step-functions", name: "Local Step Functions", description: "Step Functions Local with a platform service and Activity worker.", status: "ready" }],
    infrastructure: [{ id: "step-functions-local", name: "Step Functions Local", description: "Emulates the Step Functions API for local state-machine runs.", requirement: "required", status: "ready" }],
    variants: [{ id: "baseline", name: "AWS Step Functions baseline", description: "A Standard state machine with an Activity-backed model step.", status: "ready" }],
  },
];

export function getPlatform(platformId: string | undefined): PlatformDescriptor | undefined {
  return platformCatalog.find((platform) => platform.id === platformId);
}
