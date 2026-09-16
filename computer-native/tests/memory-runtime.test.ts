import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config/config.js";
import { MemoryStore } from "../src/memory/store.js";
import { DeterministicModelProvider } from "../src/models/deterministic.js";
import { SessionStore } from "../src/persistence/session-store.js";
import { runTurn } from "../src/runtime/turn.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { Workspace } from "../src/workspace/workspace.js";

test("runtime dispatches a real memory tool call through approval and persists its lifecycle evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-memory-runtime-"));
  try {
    const config = loadConfig({ stateDir: path.join(root, "state"), workspaceRoot: root, browserEnabled: false }, {});
    const session = await SessionStore.open(config.stateDir);
    const memory = await MemoryStore.open({ stateDir: config.stateDir, profileId: "default", workspaceId: "workspace-test" });
    const workspace = await Workspace.open(root, { maxFileBytes: config.maxFileBytes, maxDirectoryEntries: config.maxDirectoryEntries, maxTreeEntries: config.maxTreeEntries, maxTreeBytes: config.maxTreeBytes, maxTreeDepth: config.maxTreeDepth });
    const tools = new ToolRegistry(workspace, config.maxToolOutputBytes, undefined, undefined, { store: memory, maxResults: config.memoryMaxResults });
    const provider = new DeterministicModelProvider("deterministic/echo", {
      toolCall: {
        name: "memory",
        argumentsJson: JSON.stringify({ operation: "add", scope: "workspace", content: "This repository uses pnpm." }),
        finalResponse: "Stored the repository preference.",
      },
    });
    const result = await runTurn({
      session,
      provider,
      tools,
      memory,
      config,
      userPrompt: "Remember that this repository uses pnpm.",
      approveMemory: async () => ({ decision: "allow-once" }),
    });
    assert.equal(result.status, "completed");
    assert.equal((await memory.search({ query: "pnpm" })).length, 1);
    const searchResult = await runTurn({
      session,
      provider: new DeterministicModelProvider("deterministic/echo", {
        toolCall: {
          name: "memory_search",
          argumentsJson: JSON.stringify({ query: "pnpm" }),
          finalResponse: "Found the repository preference.",
        },
      }),
      tools,
      memory,
      config,
      userPrompt: "Search durable memory for the repository preference.",
    });
    assert.equal(searchResult.status, "completed");
    const turn = await session.readTranscript();
    assert.equal(turn.filter((message) => message.role === "assistant").length, 2);
    const turnDirectory = path.join(session.sessionDirectory, "turns", result.turnId);
    const events = await readFile(path.join(turnDirectory, "events.jsonl"), "utf8");
    assert.match(events, /MemoryBootstrapLoaded/u);
    const actionEvidenceDirectory = path.join(turnDirectory, "memory-actions");
    const [actionEvidenceName] = await readdir(actionEvidenceDirectory);
    assert.ok(actionEvidenceName?.endsWith(".jsonl"));
    const actionHistory = await readFile(path.join(actionEvidenceDirectory, actionEvidenceName), "utf8");
    assert.equal(actionHistory.trim().split("\n").length, 3);
    assert.match(actionHistory, /"approvalTimeoutMs":120000/u);
    assert.doesNotMatch(actionHistory, /This repository uses pnpm/u);
    const searchEvents = await readFile(path.join(session.sessionDirectory, "turns", searchResult.turnId, "events.jsonl"), "utf8");
    assert.match(searchEvents, /MemorySearched/u);
    const searchEvidenceDirectory = path.join(session.sessionDirectory, "turns", searchResult.turnId, "memory-searches");
    const [searchEvidenceName] = await readdir(searchEvidenceDirectory);
    assert.ok(searchEvidenceName);
    const searchEvidence = await readFile(path.join(searchEvidenceDirectory, searchEvidenceName), "utf8");
    assert.match(searchEvidence, /queryHash/u);
    assert.doesNotMatch(searchEvidence, /pnpm/u);
    await memory.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("denied memory approval records a terminal lifecycle outcome without writing memory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-memory-denial-"));
  try {
    const config = loadConfig({ stateDir: path.join(root, "state"), workspaceRoot: root, browserEnabled: false }, {});
    const session = await SessionStore.open(config.stateDir);
    const memory = await MemoryStore.open({ stateDir: config.stateDir, profileId: "default", workspaceId: "workspace-test" });
    const workspace = await Workspace.open(root, { maxFileBytes: config.maxFileBytes, maxDirectoryEntries: config.maxDirectoryEntries, maxTreeEntries: config.maxTreeEntries, maxTreeBytes: config.maxTreeBytes, maxTreeDepth: config.maxTreeDepth });
    const tools = new ToolRegistry(workspace, config.maxToolOutputBytes, undefined, undefined, { store: memory, maxResults: config.memoryMaxResults });
    const result = await runTurn({
      session,
      provider: new DeterministicModelProvider("deterministic/deny-memory", {
        toolCall: {
          name: "memory",
          argumentsJson: JSON.stringify({ operation: "add", scope: "workspace", content: "must not be stored" }),
          finalResponse: "The memory write was denied.",
        },
      }),
      tools,
      memory,
      config,
      userPrompt: "Remember this only if approved.",
      approveMemory: async () => ({ decision: "deny", reason: "not now" }),
    });
    assert.equal(result.status, "completed");
    assert.equal((await memory.search({ query: "must not be stored" })).length, 0);
    const events = await readFile(path.join(session.sessionDirectory, "turns", result.turnId, "events.jsonl"), "utf8");
    assert.match(events, /MemoryPrepared/u);
    assert.match(events, /MemoryApprovalDecided/u);
    assert.match(events, /MemoryFailed/u);
    assert.match(events, /"status":"denied"/u);
    await memory.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
