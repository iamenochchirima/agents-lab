import type { ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";
import type { SafetyConfig } from "./config.js";
import { parseSafetyConfig, SafetyConfigError } from "./config.js";
import type { SafetyCheckpoint, SafetyEvaluation, SafetyModule } from "./contract.js";

const IDENTITY: ModuleIdentity = Object.freeze({ id: "allowlist-safety", version: "0.2.0" });
const checkpointKinds = new Set(["tool-call", "environment-operation", "output-action", "memory-write"]);

/**
 * Creates a read-only Safety evaluator for explicitly listed, pure tool names.
 * It requires a matching tool capability and denies every other checkpoint.
 */
export function createAllowlistSafetyModule(config: unknown = {}): SafetyModule {
  const parsed: SafetyConfig = parseSafetyConfig(config);
  if (parsed.defaultDecision !== "deny") {
    throw new SafetyConfigError("The allowlist Safety implementation requires defaultDecision to remain deny.");
  }
  const allowedCapabilities = new Map(parsed.allowedToolCapabilities.map((capability) => [capability.id, capability]));
  const allowedEnvironmentCapabilities = new Map(parsed.allowedEnvironmentCapabilities.map((capability) => [capability.id, capability]));
  const allowedOutputActionKinds = new Set(parsed.allowedOutputActionKinds);
  const allowedMemoryWriteKinds = new Set(parsed.allowedMemoryWriteKinds);

  return Object.freeze({
    identity: IDENTITY,
    async evaluate(
      input: { readonly scope: RunScope; readonly checkpoint: SafetyCheckpoint },
      signal: AbortSignal,
    ): Promise<SafetyEvaluation> {
      assertNotAborted(signal);
      const checkpointId = isSafeIdentifier(input?.checkpoint?.checkpointId)
        ? input.checkpoint.checkpointId
        : "unknown-checkpoint";
      if (!isSafeIdentifier(input?.scope?.runId)) {
        return unavailable(checkpointId, "INVALID_RUN_SCOPE", "Safety could not identify the run that owns this checkpoint.");
      }
      if (!input?.checkpoint || !isSafeIdentifier(input.checkpoint.checkpointId)
        || !checkpointKinds.has(input.checkpoint.kind)) {
        return unavailable(checkpointId, "INVALID_CHECKPOINT", "Safety could not assess this checkpoint.");
      }

      let serialized: string;
      try {
        serialized = JSON.stringify(input.checkpoint);
      } catch {
        return unavailable(checkpointId, "INVALID_CHECKPOINT", "The checkpoint is not valid JSON data.");
      }
      if (typeof serialized !== "string") {
        return unavailable(checkpointId, "INVALID_CHECKPOINT", "The checkpoint is not valid JSON data.");
      }
      if (new TextEncoder().encode(serialized).byteLength > parsed.maxCheckpointBytes) {
        return unavailable(checkpointId, "CHECKPOINT_TOO_LARGE", "The checkpoint exceeds the configured Safety size limit.");
      }

      const runId = input.scope.runId;
      let decision: SafetyEvaluation;
      switch (input.checkpoint.kind) {
        case "tool-call":
          decision = evaluateToolCall(runId, input.checkpoint, allowedCapabilities);
          break;
        case "environment-operation":
          decision = evaluateEnvironmentOperation(runId, input.checkpoint, allowedEnvironmentCapabilities);
          break;
        case "output-action":
          decision = evaluateOutputAction(runId, input.checkpoint, allowedOutputActionKinds);
          break;
        case "memory-write":
          decision = evaluateMemoryWrite(runId, input.checkpoint, allowedMemoryWriteKinds);
          break;
      }
      assertNotAborted(signal);
      return decision;
    },
  });
}

function evaluateEnvironmentOperation(
  runId: string,
  checkpoint: SafetyCheckpoint,
  allowedCapabilities: ReadonlyMap<string, SafetyConfig["allowedEnvironmentCapabilities"][number]>,
): SafetyEvaluation {
  const action = checkpoint.action;
  if (!isRecord(action) || !isSafeIdentifier(action.callId) || !isSafeIdentifier(action.name)
    || !isSafeOperation(action.capabilityOperation) || !isRecord(action.arguments)) {
    return deny(runId, checkpoint, "INVALID_ENVIRONMENT_ACTION", "An environment-operation checkpoint must contain a validated action identity and arguments.");
  }
  const capability = checkpoint.capability;
  if (!capability || typeof capability.id !== "string" || typeof capability.version !== "string"
    || typeof capability.kind !== "string" || capability.kind === "pure" || !Array.isArray(capability.operations)
    || action.name !== `${capability.id}.${action.capabilityOperation}`
    || !capability.operations.includes(action.capabilityOperation)) {
    return deny(runId, checkpoint, "ENVIRONMENT_CAPABILITY_MISMATCH", "The proposed environment operation does not match its declared capability.");
  }
  const configured = allowedCapabilities.get(capability.id);
  if (!configured || configured.version !== capability.version || configured.kind !== capability.kind
    || !configured.operations.includes(action.capabilityOperation)) {
    return deny(runId, checkpoint, "ENVIRONMENT_OPERATION_NOT_ALLOWLISTED", "The proposed environment capability and operation are not explicitly configured.");
  }
  return evaluated(runId, checkpoint, "allow", "ALLOWLIST_MATCH", "The configured allowlist permits this environment capability and operation.");
}

function evaluateOutputAction(
  runId: string,
  checkpoint: SafetyCheckpoint,
  allowedKinds: ReadonlySet<string>,
): SafetyEvaluation {
  const action = checkpoint.action;
  if (!isRecord(action) || !isSafeIdentifier(action.actionId) || !isSafeOperation(action.kind)
    || !Object.prototype.hasOwnProperty.call(action, "payload") || !isJsonValue(action.payload)) {
    return deny(runId, checkpoint, "INVALID_OUTPUT_ACTION", "An output-action checkpoint must contain a valid action ID, kind, and JSON payload.");
  }
  if (!allowedKinds.has(action.kind)) {
    return deny(runId, checkpoint, "OUTPUT_ACTION_NOT_ALLOWLISTED", "The proposed output action kind is not explicitly configured.");
  }
  return evaluated(runId, checkpoint, "allow", "ALLOWLIST_MATCH", "The configured allowlist permits this output action kind.");
}

function evaluateMemoryWrite(
  runId: string,
  checkpoint: SafetyCheckpoint,
  allowedKinds: ReadonlySet<string>,
): SafetyEvaluation {
  const action = checkpoint.action;
  if (!isRecord(action) || !isSafeIdentifier(action.actionId) || !isSafeOperation(action.kind)
    || !isSafeIdentifier(action.sourceKind) || (action.trust !== "trusted" && action.trust !== "untrusted")
    || typeof action.contentBytes !== "number" || !Number.isSafeInteger(action.contentBytes) || action.contentBytes < 0) {
    return deny(runId, checkpoint, "INVALID_MEMORY_WRITE", "A Memory-write checkpoint must describe a bounded observation and its source trust.");
  }
  if (!allowedKinds.has(action.kind)) {
    return deny(runId, checkpoint, "MEMORY_WRITE_NOT_ALLOWLISTED", "The proposed Memory observation kind is not explicitly configured.");
  }
  return evaluated(runId, checkpoint, "allow", "ALLOWLIST_MATCH", "The configured allowlist permits this Memory observation kind.");
}

function evaluateToolCall(
  runId: string,
  checkpoint: SafetyCheckpoint,
  allowedCapabilities: ReadonlyMap<string, SafetyConfig["allowedToolCapabilities"][number]>,
): SafetyEvaluation {
  const action = checkpoint.action;
  if (!isRecord(action) || typeof action.name !== "string" || !isSafeIdentifier(action.name)
    || !isSafeIdentifier(action.callId) || !isSafeOperation(action.capabilityOperation)
    || !isRecord(action.arguments)) {
    return deny(runId, checkpoint, "INVALID_TOOL_CALL_ACTION", "A tool-call checkpoint must contain a validated call ID, name, capability operation, and argument object.");
  }

  const operation = action.capabilityOperation;
  const capability = checkpoint.capability;
  if (!capability) {
    return deny(runId, checkpoint, "TOOL_CAPABILITY_REQUIRED", "The tool call has no declared capability descriptor.");
  }
  if (typeof capability.id !== "string" || typeof capability.version !== "string"
    || capability.kind !== "pure" || !Array.isArray(capability.operations)
    || action.name !== `${capability.id}.${operation}` || !capability.operations.includes(operation)) {
    return deny(runId, checkpoint, "TOOL_CAPABILITY_MISMATCH", "The declared capability does not match the proposed tool operation.");
  }
  const configuredCapability = allowedCapabilities.get(capability.id);
  if (!configuredCapability || configuredCapability.version !== capability.version
    || !configuredCapability.operations.includes(operation)) {
    return deny(runId, checkpoint, "TOOL_NOT_ALLOWLISTED", "The proposed tool capability and operation are not in the configured allowlist.");
  }

  return evaluated(runId, checkpoint, "allow", "ALLOWLIST_MATCH", "The configured allowlist permits this tool name and its matching declared capability.");
}

function deny(
  runId: string,
  checkpoint: SafetyCheckpoint,
  reasonCode: string,
  explanation: string,
): SafetyEvaluation {
  return evaluated(runId, checkpoint, "deny", reasonCode, explanation);
}

function evaluated(
  runId: string,
  checkpoint: SafetyCheckpoint,
  decision: "allow" | "deny",
  reasonCode: string,
  explanation: string,
): SafetyEvaluation {
  return {
    status: "evaluated",
    decision: {
      checkpointId: checkpoint.checkpointId,
      decisionId: `safety:${runId.length}:${runId}:${checkpoint.checkpointId.length}:${checkpoint.checkpointId}`,
      decision,
      reasonCode,
      explanation,
    },
  };
}

function unavailable(checkpointId: string, code: string, message: string): SafetyEvaluation {
  return { status: "unavailable", checkpointId, code, message };
}

function assertNotAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("Safety evaluation was cancelled.");
  error.name = "AbortError";
  throw error;
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256
    && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function isSafeOperation(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]*$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is import("@agent-harness-lab/agent-protocol").JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen))
    : Object.values(value as Record<string, unknown>).every((entry) => isJsonValue(entry, seen));
  seen.delete(value);
  return valid;
}
