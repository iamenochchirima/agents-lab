import { mkdtemp, readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DeterministicModelProvider } from "../../../anesu/dist/src/models/deterministic.js";
import { SessionStore } from "../../../anesu/dist/src/persistence/session-store.js";
import { runTurn } from "../../../anesu/dist/src/runtime/turn.js";
import { loadConfig } from "../../../anesu/dist/src/config/config.js";
import { ToolRegistry } from "../../../anesu/dist/src/tools/registry.js";
import { LocalProcessRunner } from "../../../anesu/dist/src/process/local-runner.js";
import { ProcessSecurityPolicy } from "../../../anesu/dist/src/security/process-policy.js";
import { Workspace } from "../../../anesu/dist/src/workspace/workspace.js";

const stateDir = await mkdtemp(path.join(os.tmpdir(), "anesu-playground-"));
const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "anesu-workspace-"));
await mkdir(path.join(workspaceRoot, "notes"));
await writeFile(path.join(workspaceRoot, "notes", "hello.txt"), "hello from the workspace\n", "utf8");
const makeConfig = (overrides = {}) => loadConfig({ stateDir, ...overrides }, {});
const workspace = await Workspace.open(workspaceRoot, { maxFileBytes: 4_096, maxDirectoryEntries: 20 });
const processConfig = makeConfig({ workspaceRoot, processMode: "approval", processDurationMs: 500, processOutputBytes: 256, processTerminationGraceMs: 100 });
const processPolicy = new ProcessSecurityPolicy({
  workspace: workspace.policy,
  limits: {
    timeoutMs: processConfig.processDurationMs,
    terminationGraceMs: processConfig.processTerminationGraceMs,
    maxOutputBytes: processConfig.processOutputBytes,
    maxArgumentCount: processConfig.processArgumentCount,
    maxArgumentBytes: processConfig.processArgumentBytes,
  },
});
const processTools = new ToolRegistry(workspace, 8_192, { policy: processPolicy, runner: new LocalProcessRunner((prepared) => processPolicy.verify(prepared)) });
const tools = new ToolRegistry(workspace, 8_192);

async function run(label, provider, overrides = {}, signal, selectedTools, approveMutation, approveProcess) {
  const session = await SessionStore.open(stateDir);
  const result = await runTurn({
    session,
    provider,
    tools: selectedTools,
    config: makeConfig(overrides),
    userPrompt: label,
    signal,
    approveMutation,
    approveProcess,
  });
  console.log(`${label}: ${result.status} (${result.error?.code ?? "none"})`);
  return result;
}

await run("success", new DeterministicModelProvider("deterministic/echo", { response: "success" }));
await run("list directory", new DeterministicModelProvider("deterministic/echo", {
  toolCall: { name: "list_directory", argumentsJson: JSON.stringify({ path: "notes" }), finalResponse: "I found the notes directory." },
}), { workspaceRoot }, undefined, tools);
await run("read file", new DeterministicModelProvider("deterministic/echo", {
  toolCall: { name: "read_file", argumentsJson: JSON.stringify({ path: "notes/hello.txt" }), finalResponse: "The file says hello from the workspace." },
}), { workspaceRoot }, undefined, tools);
await run("approved patch", new DeterministicModelProvider("deterministic/patch", {
  toolCall: { name: "apply_patch", argumentsJson: JSON.stringify({ patch: `*** Begin Patch
*** Update File: notes/hello.txt
@@
-hello from the workspace
+hello from the approved patch
*** End Patch
` }), finalResponse: "I applied the approved patch." },
}), { workspaceRoot }, undefined, tools, async () => ({ decision: "allow-once" }));
await writeFile(path.join(workspaceRoot, "notes", "second.txt"), "second old\n", "utf8");
await run("approved patch set", new DeterministicModelProvider("deterministic/patch-set", {
  toolCall: { name: "apply_patch_set", argumentsJson: JSON.stringify({ patches: [
    `*** Begin Patch
*** Update File: notes/hello.txt
@@
-hello from the approved patch
+hello from the batch patch
*** End Patch
`,
    `*** Begin Patch
*** Update File: notes/second.txt
@@
-second old
+second from the batch patch
*** End Patch
`,
  ] }), finalResponse: "I applied the approved patch set." },
}), { workspaceRoot }, undefined, tools, async () => ({ decision: "allow-once" }));
await run("reject escape", new DeterministicModelProvider("deterministic/echo", {
  toolCall: { name: "read_file", argumentsJson: JSON.stringify({ path: "../outside.txt" }), finalResponse: "The path was rejected." },
}), { workspaceRoot }, undefined, tools);
await run("failure", new DeterministicModelProvider("deterministic/echo", { behavior: "failure" }));
await run("approved process", new DeterministicModelProvider("deterministic/process", {
  toolCall: { name: "run_command", argumentsJson: JSON.stringify({ command: process.execPath, args: ["-e", "process.stdout.write('playground ok')"] }), finalResponse: "The harmless command completed." },
}), { workspaceRoot, processMode: "approval", processDurationMs: 500 }, undefined, processTools, undefined, async () => ({ decision: "allow-once" }));
await run("denied process", new DeterministicModelProvider("deterministic/process-denied", {
  toolCall: { name: "run_command", argumentsJson: JSON.stringify({ command: process.execPath, args: ["-e", "process.exit(0)"] }), finalResponse: "The command was denied." },
}), { workspaceRoot, processMode: "approval", processDurationMs: 500 }, undefined, processTools, undefined, async () => ({ decision: "deny", reason: "playground denial" }));
await run("non-zero process", new DeterministicModelProvider("deterministic/process-nonzero", {
  toolCall: { name: "run_command", argumentsJson: JSON.stringify({ command: process.execPath, args: ["-e", "process.exitCode = 7"] }), finalResponse: "The command returned a non-zero exit." },
}), { workspaceRoot, processMode: "approval", processDurationMs: 500 }, undefined, processTools, undefined, async () => ({ decision: "allow-once" }));
await run("timed out process", new DeterministicModelProvider("deterministic/process-timeout", {
  toolCall: { name: "run_command", argumentsJson: JSON.stringify({ command: process.execPath, args: ["-e", "setTimeout(() => {}, 5000)"], timeoutMs: 25 }), finalResponse: "The command timed out." },
}), { workspaceRoot, processMode: "approval", processDurationMs: 25 }, undefined, processTools, undefined, async () => ({ decision: "allow-once" }));

const interruptedSession = await SessionStore.open(stateDir);
const interruptedTurn = await interruptedSession.admitTurn("interrupted round", "deterministic", "deterministic/echo");
await interruptedTurn.appendEvent("TurnStarted", { provider: "deterministic", model: "deterministic/echo" });
await interruptedTurn.appendRound({
  schemaVersion: 1,
  sessionId: interruptedTurn.sessionId,
  turnId: interruptedTurn.turnId,
  round: 1,
  phase: "model_requested",
  recordedAt: new Date().toISOString(),
  payload: { provider: "deterministic", model: "deterministic/echo" },
});
await interruptedTurn.updateState("streaming");
const recoveredSession = await SessionStore.open(stateDir, interruptedSession.metadata.sessionId);
const recovered = await recoveredSession.recoverInterruptedTurns();
console.log(`interrupted round: ${recovered[0]?.status ?? "not recovered"}`);

console.log(`Inspect evidence at: ${stateDir}`);
const sessions = await readdir(path.join(stateDir, "sessions"));
for (const sessionId of sessions) {
  const transcript = await readFile(path.join(stateDir, "sessions", sessionId, "transcript.jsonl"), "utf8");
  console.log(`Session ${sessionId} transcript lines: ${transcript.trim().split("\n").length}`);
}
