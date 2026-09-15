import { mkdtemp, readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DeterministicModelProvider } from "../../../computer-native/dist/src/models/deterministic.js";
import { SessionStore } from "../../../computer-native/dist/src/persistence/session-store.js";
import { runTurn } from "../../../computer-native/dist/src/runtime/turn.js";
import { loadConfig } from "../../../computer-native/dist/src/config/config.js";
import { ToolRegistry } from "../../../computer-native/dist/src/tools/registry.js";
import { Workspace } from "../../../computer-native/dist/src/workspace/workspace.js";

const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-playground-"));
const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "computer-native-workspace-"));
await mkdir(path.join(workspaceRoot, "notes"));
await writeFile(path.join(workspaceRoot, "notes", "hello.txt"), "hello from the workspace\n", "utf8");
const makeConfig = (overrides = {}) => loadConfig({ stateDir, ...overrides }, {});
const workspace = await Workspace.open(workspaceRoot, { maxFileBytes: 4_096, maxDirectoryEntries: 20 });
const tools = new ToolRegistry(workspace, 8_192);

async function run(label, provider, overrides = {}, signal, selectedTools) {
  const session = await SessionStore.open(stateDir);
  const result = await runTurn({
    session,
    provider,
    tools: selectedTools,
    config: makeConfig(overrides),
    userPrompt: label,
    signal,
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
await run("reject escape", new DeterministicModelProvider("deterministic/echo", {
  toolCall: { name: "read_file", argumentsJson: JSON.stringify({ path: "../outside.txt" }), finalResponse: "The path was rejected." },
}), { workspaceRoot }, undefined, tools);
await run("failure", new DeterministicModelProvider("deterministic/echo", { behavior: "failure" }));

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
