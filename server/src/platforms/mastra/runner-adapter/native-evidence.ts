const MAX_NATIVE_STRING_LENGTH = 256;
const MAX_NATIVE_COUNT = 100_000;

export const MASTRA_NATIVE_EVIDENCE_SCHEMA = "mastra.native.v2" as const;

export type MastraNativeVariant = "baseline" | "workflow";

/**
 * Validates the bounded native projection before it crosses the runner seam.
 * The common evidence store performs credential-key redaction; this validator
 * ensures the Mastra adapter still emits the versioned shape that readers can
 * safely interpret after a restart.
 */
export function validateMastraNativeEvidence(
  value: Readonly<Record<string, unknown>>,
  variant: MastraNativeVariant,
): void {
  if (value.evidenceSchema !== MASTRA_NATIVE_EVIDENCE_SCHEMA || value.schemaVersion !== 2) {
    throw new Error("Mastra native evidence must use mastra.native.v2.");
  }

  requireSafeString(value.mastraVersion, "mastraVersion");
  requireSafeString(value.storage, "storage");
  requireSafeString(value.modelProvider, "modelProvider", true);
  requireSafeString(value.model, "model", true);

  if (variant === "baseline") {
    if (value.operation !== "agent.generate" && value.operation !== "agent.stream") {
      throw new Error("Mastra baseline native evidence has an unsupported operation.");
    }
    if (typeof value.processScoped !== "boolean") {
      throw new Error("Mastra baseline native evidence must declare processScoped.");
    }
  } else {
    requireSafeString(value.workflowId, "workflowId");
    if (value.storage !== "libsql-file" || value.localSingleProcess !== true) {
      throw new Error("Mastra workflow native evidence must declare local LibSQL storage.");
    }
  }

  for (const key of ["eventCount", "modelStepCount", "modelRequestCount", "toolCallCount", "toolAttemptCount", "attemptCount"]) {
    const count = value[key];
    if (count !== undefined && (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > MAX_NATIVE_COUNT)) {
      throw new Error(`Mastra native evidence has an invalid ${key}.`);
    }
  }

  for (const key of ["nativeStatus", "submissionOutcome", "reconciliationStatus"]) {
    requireSafeString(value[key], key, true);
  }
}

function requireSafeString(value: unknown, name: string, optional = false): void {
  if (value === undefined && optional) return;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_NATIVE_STRING_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Mastra native evidence has an invalid ${name}.`);
  }
}
