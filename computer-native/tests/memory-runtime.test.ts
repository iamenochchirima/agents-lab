import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config/config.js";
import type { MemoryActionRecord } from "../src/memory/contracts.js";
import { MemoryStore } from "../src/memory/store.js";
import { DeterministicModelProvider } from "../src/models/deterministic.js";
import { SessionStore } from "../src/persistence/session-store.js";
import { runTurn } from "../src/runtime/turn.js";
import { RuntimeInterruptionError } from "../src/runtime/errors.js";
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

test("diagnostic interruption after memory commit does not repeat the write", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-memory-interruption-"));
  try {
    const config = loadConfig({ stateDir: path.join(root, "state"), workspaceRoot: root, browserEnabled: false }, {});
    const session = await SessionStore.open(config.stateDir);
    const memory = await MemoryStore.open({ stateDir: config.stateDir, profileId: "default", workspaceId: "workspace-test" });
    const workspace = await Workspace.open(root, { maxFileBytes: config.maxFileBytes, maxDirectoryEntries: config.maxDirectoryEntries, maxTreeEntries: config.maxTreeEntries, maxTreeBytes: config.maxTreeBytes, maxTreeDepth: config.maxTreeDepth });
    const tools = new ToolRegistry(workspace, config.maxToolOutputBytes, undefined, undefined, { store: memory, maxResults: config.memoryMaxResults });
    await assert.rejects(
      () => runTurn({
        session,
        provider: new DeterministicModelProvider("deterministic/memory-interruption", {
          toolCall: {
            name: "memory",
            argumentsJson: JSON.stringify({ operation: "add", scope: "workspace", content: "persist exactly once" }),
            finalResponse: "The memory entry was stored.",
          },
        }),
        tools,
        memory,
        config,
        userPrompt: "Store this memory entry.",
        approveMemory: async () => ({ decision: "allow-once" }),
        diagnostics: {
          onCheckpoint: (checkpoint) => {
            if (checkpoint.type === "after-tool-execution" && checkpoint.toolName === "memory") {
              throw new RuntimeInterruptionError("stopped after memory commit");
            }
          },
        },
      }),
      /stopped after memory commit/u,
    );
    assert.equal((await memory.search({ query: "persist exactly once" })).length, 1);

    const restarted = await SessionStore.open(config.stateDir, session.metadata.sessionId);
    assert.equal((await restarted.recoverInterruptedTurns())[0]?.status, "interrupted");
    const turnId = (await session.readTranscript())[0]!.turnId;
    const events = (await readFile(path.join(config.stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { type: string });
    assert.equal(events.filter((event) => event.type === "MemoryCommitted").length, 1);
    assert.equal(events.at(-1)?.type, "TurnInterrupted");
    assert.deepEqual(await (await SessionStore.open(config.stateDir, session.metadata.sessionId)).recoverInterruptedTurns(), []);
    assert.equal((await memory.search({ query: "persist exactly once" })).length, 1);
    await memory.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("memory commit acknowledgement loss reconciles the durable entry without replay", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-memory-ack-recovery-"));
  try {
    const config = loadConfig({ stateDir: path.join(root, "state"), workspaceRoot: root, browserEnabled: false }, {});
    let actionWrites = 0;
    const session = await SessionStore.open(config.stateDir, undefined, {
      writeHooks: {
        beforeWrite: (operation, filePath) => {
          if (operation === "append-json-line" && filePath.includes(`${path.sep}memory-actions${path.sep}`) && actionWrites++ === 2) {
            throw new RuntimeInterruptionError("stopped before memory commit evidence");
          }
        },
      },
    });
    const memory = await MemoryStore.open({ stateDir: config.stateDir, profileId: "default", workspaceId: "workspace-test" });
    const workspace = await Workspace.open(root, { maxFileBytes: config.maxFileBytes, maxDirectoryEntries: config.maxDirectoryEntries, maxTreeEntries: config.maxTreeEntries, maxTreeBytes: config.maxTreeBytes, maxTreeDepth: config.maxTreeDepth });
    const tools = new ToolRegistry(workspace, config.maxToolOutputBytes, undefined, undefined, { store: memory, maxResults: config.memoryMaxResults });
    await assert.rejects(
      () => runTurn({
        session,
        provider: new DeterministicModelProvider("deterministic/memory-ack-interruption", {
          toolCall: {
            name: "memory",
            argumentsJson: JSON.stringify({ operation: "add", scope: "workspace", content: "reconcile this durable memory" }),
            finalResponse: "The memory entry was stored.",
          },
        }),
        tools,
        memory,
        config,
        userPrompt: "Store this memory entry.",
        approveMemory: async () => ({ decision: "allow-once" }),
      }),
      /stopped before memory commit evidence/u,
    );
    assert.equal((await memory.search({ query: "reconcile this durable memory" })).length, 1);

    const restarted = await SessionStore.open(config.stateDir, session.metadata.sessionId);
    assert.equal((await restarted.recoverInterruptedTurns(undefined, undefined, (record) => memory.reconcileAction(record)))[0]?.status, "interrupted");
    const turnId = (await session.readTranscript())[0]!.turnId;
    const actionDirectory = path.join(config.stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "memory-actions");
    const actionFile = (await readdir(actionDirectory))[0];
    assert.ok(actionFile);
    const history = (await readFile(path.join(actionDirectory, actionFile), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { status: string; recordId?: string });
    assert.equal(history.at(-1)?.status, "committed");
    assert.ok(history.at(-1)?.recordId);
    const events = (await readFile(path.join(config.stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { type: string });
    assert.equal(events.filter((event) => event.type === "MemoryCommitted").length, 1);
    assert.equal(events.at(-1)?.type, "TurnInterrupted");
    assert.deepEqual(await (await SessionStore.open(config.stateDir, session.metadata.sessionId)).recoverInterruptedTurns(undefined, undefined, (record) => memory.reconcileAction(record)), []);
    assert.equal((await memory.search({ query: "reconcile this durable memory" })).length, 1);
    await memory.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("memory replace acknowledgement loss reconciles the durable entry without replay", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-memory-replace-ack-recovery-"));
  try {
    const config = loadConfig({ stateDir: path.join(root, "state"), workspaceRoot: root, browserEnabled: false }, {});
    let actionWrites = 0;
    const session = await SessionStore.open(config.stateDir, undefined, {
      writeHooks: {
        beforeWrite: (operation, filePath) => {
          if (operation === "append-json-line" && filePath.includes(`${path.sep}memory-actions${path.sep}`) && actionWrites++ === 2) {
            throw new RuntimeInterruptionError("stopped before memory replace evidence");
          }
        },
      },
    });
    const memory = await MemoryStore.open({ stateDir: config.stateDir, profileId: "default", workspaceId: "workspace-test" });
    const existing = await memory.add({ scope: "workspace", content: "legacy durable note", provenance: { source: "user", sourceId: "seed", trust: "user" } });
    const workspace = await Workspace.open(root, { maxFileBytes: config.maxFileBytes, maxDirectoryEntries: config.maxDirectoryEntries, maxTreeEntries: config.maxTreeEntries, maxTreeBytes: config.maxTreeBytes, maxTreeDepth: config.maxTreeDepth });
    const tools = new ToolRegistry(workspace, config.maxToolOutputBytes, undefined, undefined, { store: memory, maxResults: config.memoryMaxResults });
    await assert.rejects(
      () => runTurn({
        session,
        provider: new DeterministicModelProvider("deterministic/memory-replace-ack-interruption", {
          toolCall: {
            name: "memory",
            argumentsJson: JSON.stringify({ operation: "replace", scope: "workspace", recordId: existing.id, expectedContentHash: existing.contentHash, content: "current durable note" }),
            finalResponse: "The memory entry was replaced.",
          },
        }),
        tools,
        memory,
        config,
        userPrompt: "Replace this memory entry.",
        approveMemory: async () => ({ decision: "allow-once" }),
      }),
      /stopped before memory replace evidence/u,
    );
    assert.equal((await memory.search({ query: "current durable note" })).length, 1);

    const restarted = await SessionStore.open(config.stateDir, session.metadata.sessionId);
    assert.equal((await restarted.recoverInterruptedTurns(undefined, undefined, (record) => memory.reconcileAction(record)))[0]?.status, "interrupted");
    const turnId = (await session.readTranscript())[0]!.turnId;
    const actionDirectory = path.join(config.stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "memory-actions");
    const actionFile = (await readdir(actionDirectory))[0];
    assert.ok(actionFile);
    const history = (await readFile(path.join(actionDirectory, actionFile), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { status: string; recordId?: string });
    assert.equal(history.at(-1)?.status, "committed");
    assert.equal(history.at(-1)?.recordId, existing.id);
    const events = (await readFile(path.join(config.stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { type: string });
    assert.equal(events.filter((event) => event.type === "MemoryCommitted").length, 1);
    assert.equal(events.at(-1)?.type, "TurnInterrupted");
    assert.deepEqual(await (await SessionStore.open(config.stateDir, session.metadata.sessionId)).recoverInterruptedTurns(undefined, undefined, (record) => memory.reconcileAction(record)), []);
    assert.equal((await memory.search({ query: "legacy" })).length, 0);
    assert.equal((await memory.search({ query: "current" })).length, 1);
    await memory.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("memory recovery fails closed for unsupported mutation evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-memory-unsupported-recovery-"));
  try {
    const memory = await MemoryStore.open({ stateDir: path.join(root, "state"), profileId: "default", workspaceId: "workspace-test" });
    const base: MemoryActionRecord = {
      schemaVersion: 1,
      operationId: "memory_remove_recovery",
      sessionId: "session-recovery",
      turnId: "turn-recovery",
      callId: "memory-remove-call",
      operation: "remove",
      recordId: "memory-record",
      scope: "workspace",
      sourcePath: memory.sourcePath("workspace"),
      beforeContentHash: "before-hash",
      inputHash: "input-hash",
      status: "approved",
      decision: "allow-once",
      recordedAt: new Date().toISOString(),
    };
    const reconciled = await memory.reconcileAction(base);
    assert.equal(reconciled.status, "failed");
    assert.match(reconciled.reason ?? "", /cannot yet be reconciled automatically/u);
    await memory.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
