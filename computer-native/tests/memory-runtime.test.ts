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

async function openRuntimeMemory(root: string, writeHooks?: Parameters<typeof MemoryStore.open>[0]["writeHooks"]) {
  const config = loadConfig({ stateDir: path.join(root, "state"), workspaceRoot: root, browserEnabled: false }, {});
  const session = await SessionStore.open(config.stateDir);
  const memory = await MemoryStore.open({ stateDir: config.stateDir, profileId: "default", workspaceId: "workspace-test", ...(writeHooks ? { writeHooks } : {}) });
  const workspace = await Workspace.open(root, { maxFileBytes: config.maxFileBytes, maxDirectoryEntries: config.maxDirectoryEntries, maxTreeEntries: config.maxTreeEntries, maxTreeBytes: config.maxTreeBytes, maxTreeDepth: config.maxTreeDepth });
  const tools = new ToolRegistry(workspace, config.maxToolOutputBytes, undefined, undefined, { store: memory, maxResults: config.memoryMaxResults });
  return { config, session, memory, tools };
}

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

test("canonical memory publication interruption reconciles the durable entry without replay", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-memory-canonical-runtime-"));
  try {
    let canonicalWrites = 0;
    const { config, session, memory, tools } = await openRuntimeMemory(root, {
      afterWrite: (operation, filePath) => {
        if (operation === "canonical-replace" && filePath.endsWith("MEMORY.md") && canonicalWrites++ === 0) {
          throw new RuntimeInterruptionError("stopped after canonical memory publication");
        }
      },
    });
    await assert.rejects(
      () => runTurn({
        session,
        provider: new DeterministicModelProvider("deterministic/memory-canonical-boundary", {
          toolCall: {
            name: "memory",
            argumentsJson: JSON.stringify({ operation: "add", scope: "workspace", content: "canonical memory was published" }),
            finalResponse: "The memory entry was stored.",
          },
        }),
        tools,
        memory,
        config,
        userPrompt: "Store this memory entry.",
        approveMemory: async () => ({ decision: "allow-once" }),
      }),
      /stopped after canonical memory publication/u,
    );
    await memory.close();

    const reopenedMemory = await MemoryStore.open({ stateDir: config.stateDir, profileId: "default", workspaceId: "workspace-test" });
    const restarted = await SessionStore.open(config.stateDir, session.metadata.sessionId);
    assert.equal((await restarted.recoverInterruptedTurns(undefined, undefined, (record) => reopenedMemory.reconcileAction(record)))[0]?.status, "interrupted");
    assert.equal((await reopenedMemory.search({ query: "canonical memory was published" })).length, 1);
    const turnId = (await session.readTranscript())[0]!.turnId;
    const actionFile = (await readdir(path.join(config.stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "memory-actions")))[0];
    assert.ok(actionFile);
    const history = (await readFile(path.join(config.stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "memory-actions", actionFile), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { status: string });
    assert.equal(history.at(-1)?.status, "committed");
    const events = (await readFile(path.join(config.stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { type: string; payload?: { recovered?: boolean } });
    assert.equal(events.filter((event) => event.type === "MemoryCommitted").length, 1);
    assert.equal(events.find((event) => event.type === "MemoryCommitted")?.payload?.recovered, true);
    assert.deepEqual(await (await SessionStore.open(config.stateDir, session.metadata.sessionId)).recoverInterruptedTurns(undefined, undefined, (record) => reopenedMemory.reconcileAction(record)), []);
    await reopenedMemory.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("memory removal interruption before canonical publication leaves the entry in place", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-memory-remove-boundary-"));
  try {
    const seeded = await MemoryStore.open({ stateDir: path.join(root, "state"), profileId: "default", workspaceId: "workspace-test" });
    const existing = await seeded.add({ scope: "workspace", content: "keep this memory", provenance: { source: "user", sourceId: "seed", trust: "user" } });
    await seeded.close();
    let canonicalWrites = 0;
    const { config, session, memory, tools } = await openRuntimeMemory(root, {
      beforeWrite: (operation, filePath) => {
        if (operation === "canonical-replace" && filePath.endsWith("MEMORY.md") && canonicalWrites++ === 0) {
          throw new RuntimeInterruptionError("stopped before canonical memory removal");
        }
      },
    });
    await assert.rejects(
      () => runTurn({
        session,
        provider: new DeterministicModelProvider("deterministic/memory-remove-boundary", {
          toolCall: {
            name: "memory_forget",
            argumentsJson: JSON.stringify({ recordId: existing.id, expectedContentHash: existing.contentHash }),
            finalResponse: "The memory entry was kept.",
          },
        }),
        tools,
        memory,
        config,
        userPrompt: "Remove this memory entry only after its canonical file is ready.",
        approveMemory: async () => ({ decision: "allow-once" }),
      }),
      /stopped before canonical memory removal/u,
    );
    await memory.close();

    const reopenedMemory = await MemoryStore.open({ stateDir: config.stateDir, profileId: "default", workspaceId: "workspace-test" });
    const restarted = await SessionStore.open(config.stateDir, session.metadata.sessionId);
    assert.equal((await restarted.recoverInterruptedTurns(undefined, undefined, (record) => reopenedMemory.reconcileAction(record)))[0]?.status, "interrupted");
    assert.ok(await reopenedMemory.get(existing.id));
    const turnId = (await session.readTranscript())[0]!.turnId;
    const actionFile = (await readdir(path.join(config.stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "memory-actions")))[0];
    assert.ok(actionFile);
    const history = (await readFile(path.join(config.stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "memory-actions", actionFile), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { status: string; decision?: string });
    assert.equal(history.at(-1)?.status, "denied");
    assert.equal(history.at(-1)?.decision, "unavailable");
    const events = await readFile(path.join(config.stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "events.jsonl"), "utf8");
    assert.match(events, /MemoryFailed/u);
    assert.deepEqual(await (await SessionStore.open(config.stateDir, session.metadata.sessionId)).recoverInterruptedTurns(undefined, undefined, (record) => reopenedMemory.reconcileAction(record)), []);
    await reopenedMemory.close();
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

test("memory recovery fails closed without deletion evidence", async () => {
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
    assert.match(reconciled.reason ?? "", /No durable deletion evidence/u);
    await memory.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("memory removal acknowledgement loss reconciles the deletion without replay", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-memory-remove-ack-recovery-"));
  try {
    const config = loadConfig({ stateDir: path.join(root, "state"), workspaceRoot: root, browserEnabled: false }, {});
    let actionWrites = 0;
    const session = await SessionStore.open(config.stateDir, undefined, {
      writeHooks: {
        beforeWrite: (operation, filePath) => {
          if (operation === "append-json-line" && filePath.includes(`${path.sep}memory-actions${path.sep}`) && actionWrites++ === 2) {
            throw new RuntimeInterruptionError("stopped before memory removal evidence");
          }
        },
      },
    });
    const memory = await MemoryStore.open({ stateDir: config.stateDir, profileId: "default", workspaceId: "workspace-test" });
    const existing = await memory.add({ scope: "workspace", content: "remove this durable note", provenance: { source: "user", sourceId: "seed", trust: "user" } });
    const workspace = await Workspace.open(root, { maxFileBytes: config.maxFileBytes, maxDirectoryEntries: config.maxDirectoryEntries, maxTreeEntries: config.maxTreeEntries, maxTreeBytes: config.maxTreeBytes, maxTreeDepth: config.maxTreeDepth });
    const tools = new ToolRegistry(workspace, config.maxToolOutputBytes, undefined, undefined, { store: memory, maxResults: config.memoryMaxResults });
    await assert.rejects(
      () => runTurn({
        session,
        provider: new DeterministicModelProvider("deterministic/memory-remove-ack-interruption", {
          toolCall: {
            name: "memory_forget",
            argumentsJson: JSON.stringify({ recordId: existing.id, expectedContentHash: existing.contentHash }),
            finalResponse: "The memory entry was removed.",
          },
        }),
        tools,
        memory,
        config,
        userPrompt: "Remove this memory entry.",
        approveMemory: async () => ({ decision: "allow-once" }),
      }),
      /stopped before memory removal evidence/u,
    );
    assert.equal(await memory.get(existing.id), undefined);

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
    assert.equal(events.filter((event) => event.type === "MemoryForgotten").length, 1);
    assert.equal(events.at(-1)?.type, "TurnInterrupted");
    assert.deepEqual(await (await SessionStore.open(config.stateDir, session.metadata.sessionId)).recoverInterruptedTurns(undefined, undefined, (record) => memory.reconcileAction(record)), []);
    assert.equal(await memory.get(existing.id), undefined);
    await memory.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("memory batch acknowledgement loss reconciles every approved member without replay", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-memory-batch-ack-recovery-"));
  try {
    const config = loadConfig({ stateDir: path.join(root, "state"), workspaceRoot: root, browserEnabled: false }, {});
    let actionWrites = 0;
    const session = await SessionStore.open(config.stateDir, undefined, {
      writeHooks: {
        beforeWrite: (operation, filePath) => {
          if (operation === "append-json-line" && filePath.includes(`${path.sep}memory-actions${path.sep}`) && actionWrites++ === 2) {
            throw new RuntimeInterruptionError("stopped before memory batch evidence");
          }
        },
      },
    });
    const memory = await MemoryStore.open({ stateDir: config.stateDir, profileId: "default", workspaceId: "workspace-test" });
    const removed = await memory.add({ scope: "workspace", content: "batch legacy note", provenance: { source: "user", sourceId: "seed-remove", trust: "user" } });
    const replaced = await memory.add({ scope: "workspace", content: "batch old note", provenance: { source: "user", sourceId: "seed-replace", trust: "user" } });
    const workspace = await Workspace.open(root, { maxFileBytes: config.maxFileBytes, maxDirectoryEntries: config.maxDirectoryEntries, maxTreeEntries: config.maxTreeEntries, maxTreeBytes: config.maxTreeBytes, maxTreeDepth: config.maxTreeDepth });
    const tools = new ToolRegistry(workspace, config.maxToolOutputBytes, undefined, undefined, { store: memory, maxResults: config.memoryMaxResults });
    await assert.rejects(
      () => runTurn({
        session,
        provider: new DeterministicModelProvider("deterministic/memory-batch-ack-interruption", {
          toolCall: {
            name: "memory",
            argumentsJson: JSON.stringify({ operation: "batch", items: [
              { operation: "add", scope: "workspace", content: "batch first durable note" },
              { operation: "replace", scope: "workspace", recordId: replaced.id, expectedContentHash: replaced.contentHash, content: "batch current note" },
              { operation: "remove", scope: "workspace", recordId: removed.id, expectedContentHash: removed.contentHash },
            ] }),
            finalResponse: "The memory batch was applied.",
          },
        }),
        tools,
        memory,
        config,
        userPrompt: "Store these two memory entries.",
        approveMemory: async () => ({ decision: "allow-once" }),
      }),
      /stopped before memory batch evidence/u,
    );
    assert.equal((await memory.search({ query: "first" })).length, 1);
    assert.equal((await memory.search({ query: "current" })).length, 1);
    assert.equal((await memory.search({ query: "legacy" })).length, 0);

    const restarted = await SessionStore.open(config.stateDir, session.metadata.sessionId);
    assert.equal((await restarted.recoverInterruptedTurns(undefined, undefined, (record) => memory.reconcileAction(record)))[0]?.status, "interrupted");
    const turnId = (await session.readTranscript())[0]!.turnId;
    const actionDirectory = path.join(config.stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "memory-actions");
    const actionFile = (await readdir(actionDirectory))[0];
    assert.ok(actionFile);
    const history = (await readFile(path.join(actionDirectory, actionFile), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { status: string; batch?: unknown[] });
    assert.equal(history.at(-1)?.status, "committed");
    assert.equal(history.at(-1)?.batch?.length, 3);
    const events = (await readFile(path.join(config.stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { type: string });
    assert.equal(events.filter((event) => event.type === "MemoryCommitted").length, 1);
    assert.equal(events.at(-1)?.type, "TurnInterrupted");
    assert.deepEqual(await (await SessionStore.open(config.stateDir, session.metadata.sessionId)).recoverInterruptedTurns(undefined, undefined, (record) => memory.reconcileAction(record)), []);
    assert.equal((await memory.search({ query: "first" })).length, 1);
    assert.equal((await memory.search({ query: "current" })).length, 1);
    assert.equal((await memory.search({ query: "legacy" })).length, 0);
    await memory.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("memory batch runtime records one terminal action event for mixed members", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-memory-batch-runtime-"));
  try {
    const config = loadConfig({ stateDir: path.join(root, "state"), workspaceRoot: root, browserEnabled: false }, {});
    const session = await SessionStore.open(config.stateDir);
    const memory = await MemoryStore.open({ stateDir: config.stateDir, profileId: "default", workspaceId: "workspace-test" });
    const removed = await memory.add({ scope: "workspace", content: "normal batch legacy", provenance: { source: "user", sourceId: "seed-remove", trust: "user" } });
    const replaced = await memory.add({ scope: "workspace", content: "normal batch old", provenance: { source: "user", sourceId: "seed-replace", trust: "user" } });
    const workspace = await Workspace.open(root, { maxFileBytes: config.maxFileBytes, maxDirectoryEntries: config.maxDirectoryEntries, maxTreeEntries: config.maxTreeEntries, maxTreeBytes: config.maxTreeBytes, maxTreeDepth: config.maxTreeDepth });
    const tools = new ToolRegistry(workspace, config.maxToolOutputBytes, undefined, undefined, { store: memory, maxResults: config.memoryMaxResults });
    const result = await runTurn({
      session,
      provider: new DeterministicModelProvider("deterministic/memory-batch-runtime", {
        toolCall: {
          name: "memory",
          argumentsJson: JSON.stringify({ operation: "batch", items: [
            { operation: "add", scope: "workspace", content: "normal batch first" },
            { operation: "replace", scope: "workspace", recordId: replaced.id, expectedContentHash: replaced.contentHash, content: "normal batch current" },
            { operation: "remove", scope: "workspace", recordId: removed.id, expectedContentHash: removed.contentHash },
          ] }),
          finalResponse: "The memory batch was applied.",
        },
      }),
      tools,
      memory,
      config,
      userPrompt: "Apply this memory batch.",
      approveMemory: async () => ({ decision: "allow-once" }),
    });
    assert.equal(result.status, "completed");
    const events = (await readFile(path.join(session.sessionDirectory, "turns", result.turnId, "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { type: string });
    assert.equal(events.filter((event) => event.type === "MemoryCommitted").length, 1);
    assert.equal(events.filter((event) => event.type === "MemoryForgotten").length, 0);
    assert.equal((await memory.search({ query: "current" })).length, 1);
    assert.equal((await memory.search({ query: "legacy" })).length, 0);
    await memory.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
