import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { gradeExtension, type ExtensionPlatform } from "./extension-contracts.js";

/** Optional sink for a real process-replacement fixture. No source path means no
 * observation; unavailable attempt counters remain unknown rather than invented. */
export async function retainRestartEvidence(path: string | undefined, input: {
  platform: ExtensionPlatform; deployment: string; runId: string; before: unknown; after: unknown;
  beforeModelOutcomePersistence: boolean; afterToolPersistence: boolean; sameNativeIdentity: boolean;
  retainedState: boolean; providerCallsBefore: number; providerCallsAfter: number;
  normalizedModelRequests: number; nativeModelActivityAttempts: number | null; providerModelDispatches: readonly unknown[];
}) {
  if (!path) return;
  const sources = [path.includes("/lab/runs/") ? path.split("/lab/runs/")[1]! : basename(path)];
  const recordedAt = new Date().toISOString();
  const report = gradeExtension({ caseId: "X01", platform: input.platform, variant: "baseline", deployment: input.deployment, claimed: true,
    reason: "A process is killed after a completed tool result is durable and before the next dispatched model outcome is persisted. This establishes two different persistence boundaries at one controlled crash; unknown model outcomes may stop safely.",
    observations: [
      { check: "beforePersistenceProcessRestart", observed: input.beforeModelOutcomePersistence, sources },
      { check: "afterPersistenceProcessRestart", observed: input.afterToolPersistence, sources },
      { check: "sameNativeIdentity", observed: input.sameNativeIdentity, sources },
      { check: "retainedState", observed: input.retainedState, sources },
      { check: "effectsCounted", observed: input.providerCallsAfter === input.providerCallsBefore, sources },
      ...(input.providerModelDispatches.length > 0 ? [{ check: "modelAttemptsCounted", observed: true, sources }] : []),
    ] });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ schemaVersion: 1, recordedAt, report, evidence: input,
    limits: { providerModelDispatchCount: input.providerModelDispatches.length, providerModelDispatchCountReason: "Opt-in synthetic provider invocation ledger; native Activity attempts and normalized model requests remain separate.",
      toolEffects: "MCP lookup is read-only; provider call count checks duplicate dispatch, not an external write guarantee.", restart: "Controlled SIGKILL of native worker/service; durable backend remains running." } }, null, 2) + "\n", { flag: "wx" });
  const directory = join(dirname(path), basename(path, ".json"));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "extensions.json"), JSON.stringify({ schemaVersion: 1, mode: "scripted-native",
    metadata: { revision: process.env.AGENTLAB_EVAL_REVISION ?? null, dirty: true, startedAt: input.providerModelDispatches[0] && typeof input.providerModelDispatches[0] === "object" ? (input.providerModelDispatches[0] as { observedAt?: string }).observedAt ?? recordedAt : recordedAt,
      completedAt: recordedAt, model: { provider: "fake", model: "fake-mcp-tool-call-delay" }, controls: { caseId: "X01", crash: "SIGKILL", boundaries: ["completed-tool-result", "inflight-model-outcome"], tool: "mcp_fixture_lookup", providerModelDispatches: input.providerModelDispatches.length, providerToolCalls: input.providerCallsAfter } }, reports: [report] }, null, 2) + "\n", { flag: "wx" });
}
