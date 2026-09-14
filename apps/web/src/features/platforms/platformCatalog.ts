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
  plannedPlatform("langgraph", "LangGraph", "Durable graph execution", "An explicit graph of nodes, transitions, and checkpointed state for agent work.", "Python", "Python application service", "Graph-driven state transitions", "Graph checkpointing and persistence", "server/src/platforms/langgraph/README.md"),
  plannedPlatform("mastra", "Mastra", "Durable agent and workflow execution", "An agent and workflow runtime with state snapshots and durable execution options.", "TypeScript", "Node.js application service", "Agent and workflow primitives", "Workflow snapshots and configured durable execution", "server/src/platforms/mastra/README.md"),
  plannedPlatform("vercel-workflows", "Vercel Workflow / AI SDK", "Durable workflow execution", "Vercel workflow execution together with AI SDK agent primitives.", "TypeScript", "Node.js or Vercel runtime", "Workflow-hosted agent loop", "Workflow-managed state, waits, and recovery", "server/src/platforms/vercel-workflows/README.md"),
  plannedPlatform("inngest", "Inngest", "Event-driven durable functions", "Event-driven functions and workflows for background and agent work.", "TypeScript", "Node.js service + Inngest", "Event-driven function execution", "Durable steps, events, waits, and retries", "server/src/platforms/inngest/README.md"),
  plannedPlatform("trigger-dev", "Trigger.dev", "Durable background workflows", "Background jobs and workflow execution for long-running agent work.", "TypeScript", "Node.js service + Trigger.dev", "Task and workflow execution", "Durable task runs, waits, and retries", "server/src/platforms/trigger-dev/README.md"),
  plannedPlatform("dbos", "DBOS", "Database-backed durable execution", "Database-backed durable workflows and application operations.", "TypeScript", "Node.js service + DBOS", "Database-backed workflow execution", "Database-persisted workflow state and recovery", "server/src/platforms/dbos/README.md"),
  plannedPlatform("hatchet", "Hatchet", "Durable task orchestration", "Task orchestration and background workflow execution for agent work.", "TypeScript", "Node.js service + Hatchet", "Task-driven workflow execution", "Durable task state, retries, and scheduling", "server/src/platforms/hatchet/README.md"),
  plannedPlatform("aws-step-functions", "AWS Step Functions", "Managed durable state machines", "AWS-managed state machines for durable, event-driven agent workflows.", "TypeScript", "AWS Step Functions + workers", "Managed state-machine execution", "Managed state, retries, waits, and events", "server/src/platforms/aws-step-functions/README.md"),
];

export function getPlatform(platformId: string | undefined): PlatformDescriptor | undefined {
  return platformCatalog.find((platform) => platform.id === platformId);
}
