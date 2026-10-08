import { createHash } from "node:crypto";
import type { HostedToolContribution } from "./contracts.js";
import type { ToolExecutionContext, ToolRiskClass } from "../tools/contracts.js";
import { validateToolArguments } from "./schema.js";

export interface PackageIdentity { readonly id: string; readonly version: string }
export const PACKAGE_LIMITS = { maxArgumentBytes: 64 * 1024, maxResultBytes: 256 * 1024, timeoutMs: 30_000 };
export function digest(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
export function toolName(packageId: string, operation: string): string {
  const name = `${packageId}_${operation}`.replace(/[^a-z0-9_-]/g, "_");
  return name.length <= 64 ? name : `${name.slice(0, 51)}_${digest(name).slice(0, 12)}`;
}
export function contribution(identity: PackageIdentity, operation: string, description: string, inputSchema: Readonly<Record<string, unknown>>, riskClass: ToolRiskClass, execute: (args: Readonly<Record<string, unknown>>, context: ToolExecutionContext) => Promise<string>, sourceDigest: string): HostedToolContribution {
  const definition = { schemaVersion: 1 as const, name: toolName(identity.id, operation), description, inputSchema, riskClass, executionKind: "in_process" as const, limits: PACKAGE_LIMITS };
  return {
    descriptor: { definition, source: { ...identity, digest: sourceDigest }, execution: { kind: "hosted", key: `${identity.id}:${operation}` }, failurePolicy: "feedback" },
    implementation: { definition, validateArguments: (value) => validateToolArguments(inputSchema, value), execute },
  };
}
export function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> { return { type: "object", properties, required, additionalProperties: false }; }
export const textSchema = { type: "string" };
export const relativePathSchema = { type: "string", minLength: 1, maxLength: 1024 };
export function integerSchema(minimum: number, maximum: number): Record<string, unknown> { return { type: "integer", minimum, maximum }; }
export function aborted(signal: AbortSignal): void { signal.throwIfAborted(); }
