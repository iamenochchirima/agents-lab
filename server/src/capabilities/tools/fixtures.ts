import type { ToolImplementation } from "./contracts.js";

const values = new Map<string, string>([
  ["alpha", "local fixture alpha"],
  ["project", "Agent Harness Lab"],
]);

export const fixtureLookupTool: ToolImplementation = {
  definition: {
    schemaVersion: 1,
    name: "fixture_lookup",
    description: "Read one value from the bounded local provider fixture.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["key"],
      properties: { key: { type: "string", minLength: 1, maxLength: 64 } },
    },
    riskClass: "read",
    executionKind: "in_process",
    limits: { maxArgumentBytes: 512, maxResultBytes: 4_096, timeoutMs: 2_000 },
  },
  validateArguments(value) {
    if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.key !== "string" || value.key.length < 1 || value.key.length > 64) {
      throw new Error("Fixture lookup arguments must contain only a key of 1 to 64 characters.");
    }
    return { key: value.key };
  },
  async execute(argumentsValue) {
    const key = String(argumentsValue.key);
    return JSON.stringify({ key, value: values.get(key) ?? null });
  },
};

export const fixtureWriteTool: ToolImplementation = {
  definition: {
    schemaVersion: 1,
    name: "fixture_write",
    description: "Write one value to the bounded local provider fixture after approval.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["key", "value"],
      properties: { key: { type: "string" }, value: { type: "string" } },
    },
    riskClass: "write",
    executionKind: "in_process",
    limits: { maxArgumentBytes: 1_024, maxResultBytes: 2_048, timeoutMs: 2_000 },
  },
  validateArguments(value) {
    if (!isRecord(value) || Object.keys(value).length !== 2 || typeof value.key !== "string" || typeof value.value !== "string" || value.key.length < 1 || value.key.length > 64 || value.value.length > 512) {
      throw new Error("Fixture write arguments must contain only bounded key and value strings.");
    }
    return { key: value.key, value: value.value };
  },
  async execute(argumentsValue) {
    const key = String(argumentsValue.key);
    values.set(key, String(argumentsValue.value));
    return JSON.stringify({ key, written: true });
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
