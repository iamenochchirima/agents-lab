import type { ToolImplementation } from "./contracts.js";

const calculatorOperations = ["add", "subtract", "multiply", "divide"] as const;
type CalculatorOperation = (typeof calculatorOperations)[number];

export const calculatorTool: ToolImplementation = {
  definition: {
    schemaVersion: 1,
    name: "calculator",
    description: "Perform one basic arithmetic operation on two finite numbers.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["operation", "left", "right"],
      properties: {
        operation: { type: "string", enum: [...calculatorOperations] },
        left: { type: "number" },
        right: { type: "number" },
      },
    },
    riskClass: "pure",
    executionKind: "in_process",
    limits: { maxArgumentBytes: 512, maxResultBytes: 256, timeoutMs: 1_000 },
  },

  validateArguments(value): Readonly<Record<string, unknown>> {
    if (!isRecord(value) || Object.keys(value).length !== 3) {
      throw new Error("Calculator arguments must contain only operation, left, and right.");
    }
    const operation = value.operation;
    const left = value.left;
    const right = value.right;
    if (!isCalculatorOperation(operation)) throw new Error("Calculator operation is not supported.");
    if (!isFiniteNumber(left) || !isFiniteNumber(right)) throw new Error("Calculator values must be finite numbers.");
    if (operation === "divide" && right === 0) throw new Error("Calculator cannot divide by zero.");
    return { operation, left, right };
  },

  async execute(argumentsValue): Promise<string> {
    const operation = argumentsValue.operation as CalculatorOperation;
    const left = argumentsValue.left as number;
    const right = argumentsValue.right as number;
    const value = operation === "add"
      ? left + right
      : operation === "subtract"
        ? left - right
        : operation === "multiply"
          ? left * right
          : left / right;
    if (!Number.isFinite(value)) throw new Error("Calculator result is not finite.");
    return JSON.stringify({ value });
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCalculatorOperation(value: unknown): value is CalculatorOperation {
  return typeof value === "string" && (calculatorOperations as readonly string[]).includes(value);
}
