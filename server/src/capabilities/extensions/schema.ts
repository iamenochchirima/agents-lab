import { Ajv2020 } from "ajv/dist/2020.js";
import { Ajv } from "ajv";
import type { ValidateFunction } from "ajv";

const modern = new Ajv2020({ strict: false, allErrors: false, validateFormats: false });
const legacy = new Ajv({ strict: false, allErrors: false, validateFormats: false });
const validators = new Map<string, ValidateFunction>();
/** Compile the declared JSON Schema without mutation, coercion or network references.
 * Format annotations are descriptive; resource-specific validators own extra invariants.
 */
export function compileToolSchema(schema: Readonly<Record<string, unknown>>): ValidateFunction {
  const key = JSON.stringify(schema); if (new TextEncoder().encode(key).length > 32768) throw new Error("Tool schema exceeds 32 KiB.");
  const existing = validators.get(key);
  if (existing) return existing;
  const validator = (typeof schema.$schema === "string" && schema.$schema.includes("draft-07") ? legacy : modern).compile(schema);
  validators.set(key, validator); return validator;
}
export function validateToolArguments(schema: Readonly<Record<string, unknown>>, value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool arguments must be an object.");
  const validator = compileToolSchema(schema);
  if (!validator(value)) throw new Error(`Invalid tool arguments: ${validator.errors?.[0]?.instancePath || "/"} ${validator.errors?.[0]?.message ?? "schema mismatch"}`);
  return value as Readonly<Record<string, unknown>>;
}
