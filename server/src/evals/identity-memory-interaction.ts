import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { argumentDigest } from "../capabilities/reviews/store.js";
import { assertFreeModelCatalog, assertFreeModelRequest, FREE_PROVIDER_ROUTING, SUSTAINED_FREE_MODEL } from "../models/openrouter/free-model-policy.js";
import type { RunView } from "../control-plane/application/run-service.js";
import type { InvocationReviewView } from "../capabilities/reviews/contracts.js";
import type { TaskInteractionSnapshot } from "../capabilities/interaction/contracts.js";
import { installedRuntimeVersions } from "./runtime-versions.js";

const platformsAllowed = ["temporal", "restate", "langgraph", "mastra", "vercel-workflows"];
const active = (run: RunView) => ["created", "queued", "running", "suspended"].includes(run.status);
export const IDENTITY_INTERACTION_GRADER_REVISION = 1;
export interface IdentityInteractionEvidence {
  seed: RunView; task: RunView; seedReceipts: any[]; taskReceipts: any[];
  seedManifest: any; taskManifest: any; interaction: TaskInteractionSnapshot;
  before: any; after: any; namespace: string; marker: string; preferenceValue: string;
  memoryNamespace: string; identity: { name: string; revision: number };
  originalReview?: InvocationReviewView; finalReview?: InvocationReviewView;
  firstReviewHeldMs?: number; steeringInputId?: string; answerInputId?: string;
}
/** Require source receipts, model request content, retained input acknowledgements
 * and independently read provider state. Successful narrative output is insufficient.
 */
export function identityInteractionCriteria(e: IdentityInteractionEvidence): Record<string, boolean> {
  const saved = e.seedReceipts.filter(receipt => complete(receipt, e.seedManifest, e.seed) && receipt.toolName === "memory_save")
    .map(receipt => parsed(receipt.result.content)).find(item => item?.namespace === e.memoryNamespace && item.kind === "preference" && item.content?.includes(e.preferenceValue));
  const observations = modelObservations(e.task);
  const modelMessages = observations.flatMap(item => item.providerRequest?.messages ?? []);
  const seedMessages = modelObservations(e.seed).flatMap(item => item.providerRequest?.messages ?? []);
  const answer = e.interaction.inputs.find(input => input.inputId === e.answerInputId);
  const steering = e.interaction.inputs.find(input => input.inputId === e.steeringInputId);
  const question = e.interaction.questions.find(item => item.questionId === answer?.questionId);
  const mutation = e.taskReceipts.find(receipt => receipt.toolCallId === e.finalReview?.call.toolCallId && complete(receipt, e.taskManifest, e.task) && receipt.toolName === "record_correct");
  const actual = e.after?.records?.cedar;
  const mutationSequence = e.task.events.find(event => event.kind === "ToolExecutionCompleted" && event.payload.toolCallId === mutation?.toolCallId)?.recordedSequence;
  const verified = e.taskReceipts.some(receipt => {
    if (!complete(receipt, e.taskManifest, e.task) || !["record_inspect", "collection_list"].includes(receipt.toolName)) return false;
    const event = e.task.events.find(event => event.kind === "ToolExecutionCompleted" && event.payload.toolCallId === receipt.toolCallId);
    if (!event || mutationSequence === undefined || event.recordedSequence <= mutationSequence || callFor(receipt, e.task)?.arguments?.namespace !== e.namespace) return false;
    const result = receipt.result.structuredContent ?? parsed(receipt.result.content)?.structuredContent ?? parsed(receipt.result.content);
    return receipt.toolName === "record_inspect" ? callFor(receipt, e.task)?.arguments?.key === "cedar" && argumentDigest(result) === argumentDigest(actual)
      : Array.isArray(result?.records) && result.records.length === Object.keys(e.after.records).length && new Set(result.records.map((item: any) => item.key)).size === result.records.length && result.records.every((item: any) => argumentDigest(item) === argumentDigest(e.after.records[item.key]));
  });
  const freeRequests = [...modelObservations(e.seed), ...observations];
  return {
    nativeCompletion: e.seed.status === "completed" && e.task.status === "completed",
    isolatedSharedScope: e.seedManifest.context.memoryNamespace === e.memoryNamespace && e.taskManifest.context.memoryNamespace === e.memoryNamespace && e.memoryNamespace !== "workspace-local" && e.seedManifest.context.sessionId !== e.taskManifest.context.sessionId && e.seedManifest.platform !== e.taskManifest.platform,
    explicitMemoryReceipt: !!saved,
    freshChatRecall: !!saved && e.taskManifest.context.memoryRecordIds?.includes(saved.id) && modelMessages.some((message: any) => message.role === "user" && typeof message.content === "string" && message.content.includes(saved.id) && message.content.includes(e.preferenceValue)),
    identityInActualRequests: e.seedManifest.context.identityRevision === e.identity.revision && e.taskManifest.context.identityRevision === e.identity.revision && [seedMessages, modelMessages].every(messages => messages.some((message: any) => message.role === "system" && typeof message.content === "string" && message.content.includes(e.identity.name) && message.content.includes(`revision ${e.identity.revision}`))),
    matchedClarificationConsumed: !!answer && answer.status === "consumed" && answer.kind === "clarification_reply" && question?.status === "answered" && question.answerInputId === answer.inputId && e.task.events.some(event => event.kind === "ToolExecutionCompleted" && event.payload.toolName === "ask_user" && event.payload.toolCallId === question.toolCallId),
    steeringConsumed: !!steering && steering.kind === "steering" && steering.status === "consumed" && !!steering.boundaryId && modelMessages.some((message: any) => message.role === "user" && typeof message.content === "string" && message.content.includes(steering.content)),
    originalReviewSuperseded: !!e.originalReview && e.originalReview.status === "cancelled" && e.originalReview.displayArguments.owner === "Morgan" && !e.taskReceipts.some(receipt => receipt.toolCallId === e.originalReview?.call.toolCallId && complete(receipt, e.taskManifest, e.task)) && (e.firstReviewHeldMs ?? 0) >= 5000,
    freshApprovalConfirmed: !!e.finalReview && e.finalReview.requestId !== e.originalReview?.requestId && e.finalReview.call.toolCallId !== e.originalReview?.call.toolCallId && e.finalReview.decision?.decision === "approved" && e.finalReview.displayArguments.owner === "Casey" && !!mutation && argumentDigest(mutation.result.structuredContent ?? parsed(mutation.result.content)?.structuredContent) === argumentDigest(actual),
    independentExactEffect: actual?.owner === "Casey" && actual.revision === e.before.records.cedar.revision + 1 && e.after.effectCount === e.before.effectCount + 1 && e.after.effects.length === e.before.effects.length + 1 && e.after.effects.at(-1)?.key === "cedar" && e.after.effects.at(-1)?.owner === "Casey" && Object.keys(e.before.records).every(key => key === "cedar" ? ["approvedDate", "dependency", "status"].every(field => e.before.records[key][field] === e.after.records[key][field]) : argumentDigest(e.before.records[key]) === argumentDigest(e.after.records[key])),
    verificationReceipt: verified,
    freeRoutingRetained: freeRequests.length > 0 && freeRequests.every(item => { try { assertFreeModelRequest(item.providerRequest, SUSTAINED_FREE_MODEL, "agent-capabilities-live"); return true; } catch { return false; } }),
    noUnknownEffects: !e.task.events.some(event => event.kind === "ToolExecutionUnknown"),
  };
}
function callFor(receipt: any, run: RunView): any {
  const event = run.events.find(event => event.kind === "ToolExecutionCompleted" && event.payload.toolCallId === receipt.toolCallId);
  const call = modelObservations(run).flatMap(item => item.providerRequest?.messages ?? []).flatMap((message: any) => message.tool_calls ?? []).find((call: any) => call.id === receipt.toolCallId && call.function?.name === receipt.toolName);
  const args = parsed(call?.function?.arguments);
  return event && args ? { toolCallId: receipt.toolCallId, name: receipt.toolName, arguments: args, round: Number(event.payload.round) } : null;
}
function complete(receipt: any, manifest: any, run: RunView): boolean {
  const call = receipt && callFor(receipt, run);
  return !!receipt && !!call && receipt.status === "complete" && receipt.result?.status === "completed" && receipt.catalogRevision === manifest.capabilities?.toolCatalog?.revision && receipt.fingerprint === argumentDigest({ revision: manifest.capabilities.toolCatalog.revision, turnId: manifest.context.turnId, call });
}
function parsed(content: unknown): any { try { return typeof content === "string" ? JSON.parse(content) : null; } catch { return null; } }
function modelObservations(run: RunView): any[] { return run.events.filter(event => event.kind === "EvalModelObserved").map(event => event.payload.observation); }

async function main() {
  const args = process.argv.slice(2).filter(item => item !== "--"); const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) { if (!["--api", "--platforms", "--model", "--out"].includes(args[i]) || !args[i + 1]) throw new Error("Usage: --api URL --platforms temporal,restate,langgraph,mastra,vercel-workflows --model exact-free-id --out parent-directory"); options.set(args[i], args[i + 1]); }
  const api = options.get("--api") ?? "http://127.0.0.1:4324";
  if (!loopback(api)) throw new Error("This fixture evaluator requires a local loopback API.");
  const platforms = (options.get("--platforms") ?? platformsAllowed.join(",")).split(",");
  if (!platforms.length || new Set(platforms).size !== platforms.length || platforms.some(platform => !platformsAllowed.includes(platform))) throw new Error("Choose distinct supported native platforms.");
  const model = options.get("--model") ?? SUSTAINED_FREE_MODEL;
  if (model !== SUSTAINED_FREE_MODEL) throw new Error("This protocol requires the exact approved Nemotron free model.");
  const fixture = process.env.AGENTLAB_IDENTITY_FIXTURE_URL ?? "http://127.0.0.1:19197";
  if (!loopback(fixture) || (await json(`${fixture}/health`)).mode !== "controlled-fictional-provider") throw new Error("The provider must declare the controlled fictional fixture contract.");
  const runRoot = resolve(process.env.AGENTLAB_RUN_ROOT ?? "lab/runs/.sustained-proof/runs");
  const directory = resolve(options.get("--out") ?? join(runRoot, ".identity-memory-proof"), `identity-interaction-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const catalogUrl = `${process.env.AGENTLAB_OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1"}/models`;
  const catalog = await json(catalogUrl); const catalogObservation = assertFreeModelCatalog(catalog, model);
  const identity = (await json(`${api}/api/agent-state`)).identity;
  const report: any = { schemaVersion: 1, graderRevision: IDENTITY_INTERACTION_GRADER_REVISION, mode: "real-model-identity-memory-interaction", sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), dirty: !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), startedAt: new Date().toISOString(), runtimeVersions: await installedRuntimeVersions(), catalogObservation, pricing: catalog.data.find((item: any) => item.id === model).pricing, catalogUrl, identity: { name: identity.name, revision: identity.revision }, controls: { model, maxOutputTokens: 2048, provider: FREE_PROVIDER_ROUTING, experimentId: "agent-capabilities-live", fixture, approvalObserver: "exact fictional Cedar/Casey only", firstReviewHoldMs: 5000 }, outcomes: [] };
  const save = () => writeFile(join(directory, "summary.json"), JSON.stringify(report, null, 2) + "\n"); await save();
  for (const platform of platforms) {
    const predecessor = platformsAllowed[(platformsAllowed.indexOf(platform) + platformsAllowed.length - 1) % platformsAllowed.length];
    const marker = randomUUID().replaceAll("-", ""); const namespace = `cap-identity-${platform}-${marker}`;
    const comparisonId = `identity-interaction-${platform}-${marker}`;
    const memoryNamespace = `experiment-${createHash("sha256").update(comparisonId).digest("hex").slice(0, 32)}`;
    const preferenceValue = `AX-${marker.slice(0, 12)}`;
    const preference = `For the fictional Cedar trial ${marker}, use concise checklists and prefix the status with ${preferenceValue}.`;
    const prompts = {
      seed: `Please remember this preference for future chats: ${preference} Save it as a preference titled Cedar reporting ${marker}. This is an explicit request to save memory. Do not change any connected records.`,
      task: `Inspect Cedar in disposable collection namespace ${namespace}. Use the saved reporting preference for fictional Cedar trial ${marker}. Before changing its owner, ask me who should own Cedar using the available clarification capability. After my answer, propose the owner correction, wait for its action decision, then verify the actual saved record. Keep approved dates, dependency and blocked status unchanged. Do not modify any other record or namespace.`,
      answer: "Set Cedar's owner to Morgan.",
      steering: "Change my instruction: use Casey instead of Morgan as Cedar's owner. Do not change any other record. Withdraw the earlier proposal and use a fresh approval for the corrected action.",
    };
    const outcome: any = { platform, predecessor, marker, namespace, memoryNamespace, comparisonId, prompts, verdict: "incomplete", startedAt: new Date().toISOString() }; report.outcomes.push(outcome); await save();
    let latest: RunView | null = null;
    try {
      outcome.before = await json(`${fixture}/collection-state/${namespace}`);
      const create = (owner: string, prompt: string) => json(`${api}/api/runs`, { platform: owner, variant: "baseline", comparisonId, sessionId: `cap-chat-${randomUUID()}`, clientTurnId: `identity-${randomUUID()}`, task: { kind: "prompt", prompt }, model: { provider: "openrouter", model }, selection: { scenarioId: "agent-identity-memory-interaction", experimentId: "agent-capabilities-live" }, memory: { enabled: true }, capabilities: { profileId: "connected-agent", tools: { enabledNames: [], maxRounds: 16, maxCalls: 32 } }, execution: { mode: "sustained", maxDurationMs: 600000, modelTimeoutMs: 120000 } });
      latest = await create(predecessor, prompts.seed); outcome.seedRunId = latest!.runId; await save();
      const seed = await wait(api, latest!, async run => { const actions = (await json(`${api}/api/runs/${run.runId}/actions`)).actions; if (actions.some((action: any) => action.status === "pending")) throw new Error("Memory-only task proposed an external action; no approval issued."); });
      await writeEvidence(directory, `${platform}-seed`, seed, runRoot);
      if (seed.status !== "completed") throw new Error(`Seed native execution ended ${seed.status}: ${seed.result?.error?.message ?? "no diagnostic"}`);
      latest = await create(platform, prompts.task); outcome.taskRunId = latest!.runId; await save();
      let original: InvocationReviewView | undefined; let approved: InvocationReviewView | undefined;
      const task = await wait(api, latest!, async run => {
        const interaction: TaskInteractionSnapshot = await json(`${api}/api/runs/${run.runId}/inputs`);
        for (const question of interaction.questions.filter(question => question.status === "pending" && !question.answerInputId)) {
          if (outcome.answerInputId) throw new Error("Unexpected second clarification; preserving the observation without scripted extra answers.");
          outcome.answerInputId = randomUUID(); outcome.question = question;
          outcome.answer = await json(`${api}/api/runs/${run.runId}/inputs`, { inputId: outcome.answerInputId, kind: "clarification_reply", questionId: question.questionId, content: prompts.answer }); await save();
        }
        const actions: InvocationReviewView[] = (await json(`${api}/api/runs/${run.runId}/actions`)).actions;
        for (const action of actions.filter(action => action.status === "pending")) {
          const args = action.displayArguments;
          if (action.call.name !== "record_correct" || args.namespace !== namespace || args.key !== "cedar" || !Number.isInteger(args.expectedRevision) || Object.keys(args).some(key => !["namespace", "key", "owner", "expectedRevision"].includes(key))) throw new Error("Unexpected action; no automatic approval issued.");
          if (!original && args.owner === "Morgan" && outcome.answerInputId) {
            original = action; outcome.originalReview = action; const heldAt = Date.now();
            while (Date.now() - heldAt < 5100) await pause(350);
            const state = await json(`${fixture}/collection-state/${namespace}`);
            if (argumentDigest(state) !== argumentDigest(outcome.before)) throw new Error("Fixture changed before review.");
            outcome.firstReviewHeldMs = Date.now() - heldAt; outcome.steeringInputId = randomUUID();
            outcome.steering = await json(`${api}/api/runs/${run.runId}/inputs`, { inputId: outcome.steeringInputId, kind: "steering", content: prompts.steering }); await save();
          } else if (original && action.requestId !== original.requestId && args.owner === "Casey" && !approved) {
            const prior = actions.find(value => value.requestId === original!.requestId);
            if (prior?.status !== "cancelled") throw new Error("Original proposal was not superseded; no new action approved.");
            const state = await json(`${fixture}/collection-state/${namespace}`);
            if (argumentDigest(state) !== argumentDigest(outcome.before)) throw new Error("Fixture changed before fresh approval.");
            outcome.approval = await json(`${api}/api/runs/${run.runId}/actions/${action.requestId}/decision`, { requestId: action.requestId, revision: action.revision, argumentDigest: action.argumentDigest, decisionId: randomUUID(), decision: "approved", reason: "Exact fictional Cedar/Casey action authorized by acceptance observer" }); approved = action; outcome.finalReview = action; await save();
          } else if (original?.requestId !== action.requestId && approved?.requestId !== action.requestId) throw new Error("Unexpected repeated action; no approval issued.");
        }
      });
      outcome.nativeStatus = task.status; outcome.output = task.result?.output; outcome.nativeError = task.result?.error;
      outcome.after = await json(`${fixture}/collection-state/${namespace}`); outcome.interaction = await json(`${api}/api/runs/${task.runId}/inputs`);
      const actions: InvocationReviewView[] = (await json(`${api}/api/runs/${task.runId}/actions`)).actions;
      outcome.originalReview = actions.find(action => action.requestId === original?.requestId); outcome.finalReview = actions.find(action => action.requestId === approved?.requestId);
      const seedEvidence = await evidence(seed, runRoot), taskEvidence = await evidence(task, runRoot);
      await writeFile(join(directory, `${platform}-task.json`), JSON.stringify({ run: task, ...taskEvidence }, null, 2) + "\n");
      outcome.criteria = identityInteractionCriteria({ seed, task, seedReceipts: seedEvidence.receipts, taskReceipts: taskEvidence.receipts, seedManifest: seedEvidence.manifest, taskManifest: taskEvidence.manifest, interaction: outcome.interaction, before: outcome.before, after: outcome.after, namespace, marker, preferenceValue, memoryNamespace, identity, originalReview: outcome.originalReview, finalReview: outcome.finalReview, firstReviewHeldMs: outcome.firstReviewHeldMs, steeringInputId: outcome.steeringInputId, answerInputId: outcome.answerInputId });
      outcome.verdict = Object.values(outcome.criteria).every(Boolean) ? "pass" : "fail";
    } catch (error) {
      outcome.verdict = "fail"; outcome.error = error instanceof Error ? error.message : String(error);
      if (latest) {
        try { latest = await json(`${api}/api/runs/${latest.runId}`); if (active(latest!)) outcome.cancelResponse = await json(`${api}/api/runs/${latest!.runId}/cancel`, { reason: "Acceptance stopped before further fixture approval" }); outcome.lastRun = await json(`${api}/api/runs/${latest!.runId}`); await writeEvidence(directory, `${platform}-failure`, outcome.lastRun, runRoot); } catch (failure) { outcome.cancellationError = String(failure); }
      }
      try { outcome.after = await json(`${fixture}/collection-state/${namespace}`); } catch (failure) { outcome.stateReadError = String(failure); }
    }
    outcome.completedAt = new Date().toISOString(); await save();
  }
  report.completedAt = new Date().toISOString(); await save(); console.info(`Retained identity/memory/interaction acceptance: ${join(directory, "summary.json")}`);
  if (report.outcomes.some((outcome: any) => outcome.verdict !== "pass")) process.exitCode = 1;
}
async function wait(api: string, initial: RunView, observe: (run: RunView) => Promise<void>): Promise<RunView> {
  let run = initial; const deadline = Date.now() + 660000;
  while (active(run)) { if (Date.now() >= deadline) throw new Error("Observation deadline reached; no further approval issued."); await observe(run); await pause(350); run = await json(`${api}/api/runs/${run.runId}`); }
  return run;
}
async function evidence(run: RunView, root: string) {
  const manifest = JSON.parse(await readFile(join(root, run.runId, "config.json"), "utf8"));
  const receiptRoot = join(root, run.runId, "artifacts/capability-calls");
  const filenames = await readdir(receiptRoot).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
  const receipts = await Promise.all(filenames.map(async name => JSON.parse(await readFile(join(receiptRoot, name), "utf8"))));
  return { manifest, receipts };
}
async function writeEvidence(directory: string, name: string, run: RunView, root: string) { await writeFile(join(directory, `${name}.json`), JSON.stringify({ run, ...await evidence(run, root) }, null, 2) + "\n"); }
function loopback(value: string) { const url = new URL(value); return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !url.username && !url.password; }
async function json(url: string, body?: unknown): Promise<any> {
  const response = await fetch(url, { ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
  const result = await response.json().catch(() => null); if (!response.ok) throw new Error(`HTTP ${response.status}: ${result?.error?.message ?? new URL(url).pathname}`); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
