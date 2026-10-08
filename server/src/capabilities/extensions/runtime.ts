import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ConnectionRuntime } from "../integrations/runtime.js";
import type { ToolCall, ToolExecutionContext, ToolExecutionResult, ToolRiskClass } from "../tools/contracts.js";
import type { InvocationReviewView } from "../reviews/contracts.js";
import { createFixtureTools } from "../tools/fixtures.js";
import { ToolRegistry } from "../tools/registry.js";
import type { ToolCatalogSnapshot } from "./contracts.js";
import { assertToolCatalogSnapshot, legacyToolImplementations, type ToolConfiguration } from "./projection.js";
import { validateToolArguments } from "./schema.js";

export function capabilityHostKeyPath(): string {
  return process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE ?? join(capabilityWorkspaceRoot(), "lab/runs/.capability-host.key");
}

export function capabilityWorkspaceRoot(): string {
  let root = process.cwd();
  while (!existsSync(join(root, "pnpm-workspace.yaml"))) {
    const parent = dirname(root);
    if (parent === root) throw new Error("Configure AGENTLAB_CAPABILITY_HOST_KEY_FILE outside the Lab workspace.");
    root = parent;
  }
  return root;
}

/** Native workers execute through one registry regardless of the source package.
 * Hosted tools carry data and stable identities rather than executable closures.
 */
export function createRuntimeToolRegistry(
  configuration: ToolConfiguration,
  snapshot?: ToolCatalogSnapshot,
  connectionRuntime?: ConnectionRuntime,
): ToolRegistry {
  const registry = new ToolRegistry(configuration);
  const fixtureTools = connectionRuntime ? Object.values(createFixtureTools(connectionRuntime)) : [];
  const legacy = legacyToolImplementations().map(tool => {
    if (!connectionRuntime || !tool.definition.name.startsWith("fixture_")) return tool;
    return fixtureTools.find(value => value.definition.name === tool.definition.name)!;
  });
  if (!snapshot) {
    for (const tool of legacy) registry.register(tool);
    return registry;
  }
  assertToolCatalogSnapshot(snapshot);
  for (const descriptor of snapshot.tools) {
    const definition = { ...descriptor.definition, failurePolicy: descriptor.failurePolicy };
    const execution = descriptor.execution;
    const builtin = execution.kind === "builtin"
      ? legacy.find(value => value.definition.name === execution.id)
      : undefined;
    const executeResult = execution.kind === "hosted"
      ? (input: Readonly<Record<string, unknown>>, context: ToolExecutionContext) =>
        invokeCapabilityHost(snapshot.revision, definition.name, definition.riskClass, input, context)
      : undefined;
    registry.register({
      ...(builtin ?? { execute: async () => { throw new Error("Hosted tools use the result adapter."); } }),
      definition,
      validateArguments: value => {
        const validated = validateToolArguments(definition.inputSchema, value);
        return builtin ? builtin.validateArguments(validated) : validated;
      },
      ...(executeResult ? { executeResult } : {}),
    });
  }
  for (const name of configuration.enabledNames) {
    if (!registry.resolve(name)) throw new Error(`Selected tool has no catalog descriptor: ${name}`);
  }
  return registry;
}

/** Native execution suspends on this proposal before starting a tool deadline.
 * The host retains the arguments and rechecks the exact decision at dispatch.
 */
export async function prepareToolInvocation(snapshot: ToolCatalogSnapshot, call: ToolCall, context: ToolExecutionContext): Promise<InvocationReviewView | null> {
  const descriptor = snapshot.tools.find(tool => tool.definition.name === call.name);
  if (descriptor?.definition.approvalMode !== "invocation") return null;
  const key = (await readFile(capabilityHostKeyPath(), "utf8")).trim();
  const endpoint = new URL("/internal/capabilities/prepare", process.env.AGENTLAB_CAPABILITY_HOST_URL ?? `http://127.0.0.1:${process.env.AGENTLAB_API_PORT ?? "4318"}`);
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ runId: context.runId, turnId: context.turnId, catalogRevision: snapshot.revision, call }),
    signal: AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Invocation proposal rejected with HTTP ${response.status}.`); }
  const value = JSON.parse(await boundedResponseText(response, 256 * 1024)) as InvocationReviewView | null;
  if (value !== null && (value.schemaVersion !== 1 || value.runId !== context.runId || value.call?.toolCallId !== call.toolCallId || !Number.isSafeInteger(value.revision))) throw new Error("Invalid invocation proposal result.");
  return value;
}

async function invokeCapabilityHost(
  revision: string,
  name: string,
  risk: ToolRiskClass,
  input: Readonly<Record<string, unknown>>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const key = (await readFile(capabilityHostKeyPath(), "utf8")).trim();
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Capability host credential is unavailable.");
  const endpoint = new URL("/internal/capabilities/execute", process.env.AGENTLAB_CAPABILITY_HOST_URL ?? `http://127.0.0.1:${process.env.AGENTLAB_API_PORT ?? "4318"}`);
  if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("Capability host requires HTTP(S).");
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        runId: context.runId,
        turnId: context.turnId,
        catalogRevision: revision,
        call: { toolCallId: context.toolCallId, name, arguments: input, round: context.toolRound ?? 1 },
      }),
      signal: context.signal,
    });
  } catch {
    const error = new Error("The capability host operation may have been dispatched; inspect its recorded receipt before retrying.");
    error.name = sideEffecting(risk) ? "CAPABILITY_OUTCOME_UNKNOWN" : context.signal.aborted ? "AbortError" : "CAPABILITY_HOST_UNAVAILABLE";
    throw error;
  }
  if (!response.ok) {
    await response.body?.cancel();
    const error = new Error(`Capability host rejected the call with HTTP ${response.status}.`);
    // Server failures cannot establish whether an admitted operation took effect.
    if (response.status >= 500 && sideEffecting(risk)) error.name = "CAPABILITY_OUTCOME_UNKNOWN";
    throw error;
  }
  try {
    const text = await boundedResponseText(response, 16 * 1024 * 1024);
    const result: unknown = JSON.parse(text);
    if (!isToolResult(result)) throw new Error("Capability host returned an invalid result.");
    return result;
  } catch {
    const error = new Error("The capability result acknowledgement is unavailable or invalid.");
    error.name = sideEffecting(risk) ? "CAPABILITY_OUTCOME_UNKNOWN" : "CAPABILITY_INVALID_RESULT";
    throw error;
  }
}

function sideEffecting(risk: ToolRiskClass): boolean { return risk === "write" || risk === "external"; }
function isToolResult(value: unknown): value is ToolExecutionResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<ToolExecutionResult>;
  return typeof result.content === "string" && ["completed", "failed", "cancelled", "timed_out", "unknown"].includes(String(result.status));
}

async function boundedResponseText(response: Response, maximum: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximum) {
        await reader.cancel();
        throw new Error("Capability host result exceeds the transport limit.");
      }
      chunks.push(part.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { reader.releaseLock(); }
}
