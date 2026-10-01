import type { CapabilityDescriptor } from "@agent-harness-lab/agent-protocol";
import type { ToolRegistration } from "./contract.js";

/** The scoped fixture exposes one controlled computer action alongside observation. */
export const COMPUTER_FIXTURE_CAPABILITY: CapabilityDescriptor = Object.freeze({
  id: "computer",
  version: "1.0.0",
  kind: "computer",
  operations: Object.freeze(["observe", "click"]),
});

const DEFINITION = Object.freeze({
  name: "computer.click",
  version: "0.1.0",
  description: "Click one named element in the controlled computer fixture.",
  risk: "write" as const,
  capability: COMPUTER_FIXTURE_CAPABILITY,
  capabilityOperation: "click",
  inputSchema: Object.freeze({
    type: "object",
    properties: { target: { type: "string" } },
    required: ["target"],
    additionalProperties: false,
  }),
});

export function createComputerClickRegistration(): ToolRegistration {
  return Object.freeze({
    definition: DEFINITION,
    validateArguments(value: unknown) {
      if (!isPlainRecord(value) || Object.keys(value).length !== 1 || typeof value.target !== "string"
        || value.target.trim().length === 0 || value.target.length > 256) {
        throw new TypeError('Arguments must contain exactly one non-empty "target" string of at most 256 characters.');
      }
      return Object.freeze({ target: value.target });
    },
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
