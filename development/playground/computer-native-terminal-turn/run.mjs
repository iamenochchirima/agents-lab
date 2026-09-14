import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DeterministicModelProvider } from "../../../computer-native/dist/src/models/deterministic.js";
import { SessionStore } from "../../../computer-native/dist/src/persistence/session-store.js";
import { runTurn } from "../../../computer-native/dist/src/runtime/turn.js";
import { loadConfig } from "../../../computer-native/dist/src/config/config.js";

const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-playground-"));
const makeConfig = (overrides = {}) => loadConfig({ stateDir, ...overrides }, {});

async function run(label, provider, overrides = {}, signal) {
  const session = await SessionStore.open(stateDir);
  const result = await runTurn({
    session,
    provider,
    config: makeConfig(overrides),
    userPrompt: label,
    signal,
  });
  console.log(`${label}: ${result.status} (${result.error?.code ?? "none"})`);
  return result;
}

await run("success", new DeterministicModelProvider("deterministic/echo", { response: "success" }));
await run("failure", new DeterministicModelProvider("deterministic/echo", { behavior: "failure" }));
await run("timeout", new DeterministicModelProvider("deterministic/echo", { behavior: "timeout" }), { timeoutMs: 25 });

const cancellation = new AbortController();
setTimeout(() => cancellation.abort("cancelled"), 10);
await run(
  "cancelled",
  new DeterministicModelProvider("deterministic/echo", { delayMs: 50, response: "slow response" }),
  { timeoutMs: 1000 },
  cancellation.signal,
);

console.log(`Inspect evidence at: ${stateDir}`);
const sessions = await readdir(path.join(stateDir, "sessions"));
for (const sessionId of sessions) {
  const transcript = await readFile(path.join(stateDir, "sessions", sessionId, "transcript.jsonl"), "utf8");
  console.log(`Session ${sessionId} transcript lines: ${transcript.trim().split("\n").length}`);
}
