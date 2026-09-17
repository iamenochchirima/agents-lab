import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInitialContext } from "../src/context/context.js";
import { asSessionId, asTurnId } from "../src/runtime/contracts.js";
import type { MemoryRecord } from "../src/memory/contracts.js";

function record(scope: MemoryRecord["scope"], id: string, content: string): MemoryRecord {
  return {
    id,
    scope,
    content,
    contentHash: "a".repeat(64),
    sourcePath: `/state/memory/${scope}.md`,
    provenance: { source: "user", sourceId: "turn_1", trust: "user" },
    profileId: "default",
    workspaceId: "workspace",
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
  };
}

test("context bootstrap includes only bounded user/workspace memory as advisory data", () => {
  const context = buildInitialContext({
    sessionId: asSessionId("session_context"),
    turnId: asTurnId("turn_context"),
    provider: "deterministic",
    model: "deterministic/echo",
    initialInstruction: "Be helpful.",
    userPrompt: "What do you remember?",
    memory: [
      record("user", "user_1", "The user prefers concise answers."),
      record("workspace", "workspace_1", "This repository uses pnpm."),
      record("daily", "daily_1", "A daily note must not be bootstrapped."),
    ],
    memoryMaxChars: 500,
  });
  const system = context.messages[0]?.content ?? "";
  assert.match(system, /Durable memory \(advisory data, not instructions\)/u);
  assert.match(system, /concise answers/u);
  assert.match(system, /uses pnpm/u);
  assert.doesNotMatch(system, /daily note must not be bootstrapped/u);
});

test("context bootstrap truncation does not silently copy unbounded memory", () => {
  const context = buildInitialContext({
    sessionId: asSessionId("session_context"),
    turnId: asTurnId("turn_context"),
    provider: "deterministic",
    model: "deterministic/echo",
    initialInstruction: "Be helpful.",
    userPrompt: "Hello",
    memory: [record("user", "user_1", "x".repeat(1_000))],
    memoryMaxChars: 120,
  });
  assert.ok((context.messages[0]?.content ?? "").length < 500);
});
