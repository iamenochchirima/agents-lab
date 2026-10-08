/** Optional acceptance is scoped to an exact native variant/deployment. Missing
 * observations are incomplete, not a failed claim or an inferred success. */
export const EXTENSION_VERSION = "agent-extensions-v1";
export const EXTENSION_CHECKS = {
  X01: ["beforePersistenceProcessRestart", "afterPersistenceProcessRestart", "sameNativeIdentity", "retainedState", "modelAttemptsCounted", "effectsCounted"],
  X02: ["externalEffectCommitted", "acknowledgementLost", "providerIdempotencyDeclared", "sameKeyRecovery", "independentSingleEffect", "recoveredReceipt"],
  X03: ["logicalDuplicateSubmitted", "outOfOrderSubmitted", "orderingPolicyDeclared", "independentTransitionsCorrect"],
  X04: ["noEffectBeforeApproval", "exactArgumentsRetained", "nativeWaitingRecovery", "hostWaitingRecovery", "sameNativeIdentity", "expiryNoEffect", "renewalNoRedispatch", "approvedSingleEffect", "deniedNoEffect", "cancelledNoEffect", "denialFeedback"],
  X05: ["recordedBudgetBoundary", "modelBackedSummary", "summarySourceProvenance", "actualPostCompactionRequest", "constraintsInRequest", "constraintsInAnswer"],
} as const;
export type ExtensionId = keyof typeof EXTENSION_CHECKS;
export type ExtensionPlatform = "mastra" | "langgraph" | "temporal" | "restate";
export interface ExtensionObservation {
  readonly check: string;
  readonly observed: boolean;
  /** Run IDs and retained artifact paths; source evidence must remain inspectable. */
  readonly sources: readonly string[];
}
export interface ExtensionInput {
  readonly caseId: ExtensionId;
  readonly platform: ExtensionPlatform;
  readonly variant: "baseline";
  readonly deployment: string;
  readonly claimed: boolean;
  readonly reason: string;
  readonly observations: readonly ExtensionObservation[];
}
export interface ExtensionReport extends ExtensionInput {
  readonly schemaVersion: 1;
  readonly suiteVersion: typeof EXTENSION_VERSION;
  readonly verdict: "pass" | "fail" | "incomplete" | "not-applicable";
  readonly missingChecks: readonly string[];
}

/** Expected values are owned by this versioned contract, never caller-supplied.
 * This grades retained observations; it does not execute or authenticate a run. */
export function gradeExtension(input: ExtensionInput): ExtensionReport {
  if (!Object.hasOwn(EXTENSION_CHECKS, input.caseId) || !["mastra", "langgraph", "temporal", "restate"].includes(input.platform) ||
      input.variant !== "baseline" || typeof input.claimed !== "boolean" || !input.deployment?.trim() || !input.reason?.trim() || !Array.isArray(input.observations)) {
    throw new Error("Extension requires a supported case, exact variant/deployment and applicability reason.");
  }
  const required: readonly string[] = EXTENSION_CHECKS[input.caseId];
  const seen = new Set<string>();
  for (const observation of input.observations) {
    if (!required.includes(observation.check) || seen.has(observation.check) || typeof observation.observed !== "boolean" ||
        !Array.isArray(observation.sources) || observation.sources.length === 0 || observation.sources.some((value: unknown) => typeof value !== "string" || !value.trim())) {
      throw new Error("Extension observation must be unique, supported and tied to retained evidence.");
    }
    seen.add(observation.check);
  }
  if (!input.claimed && input.observations.length > 0) throw new Error("Unclaimed extensions must not discard observed acceptance evidence.");
  const missingChecks = required.filter(check => !seen.has(check));
  const verdict = !input.claimed ? "not-applicable" : input.observations.some(value => !value.observed) ? "fail" : missingChecks.length ? "incomplete" : "pass";
  return { ...input, schemaVersion: 1, suiteVersion: EXTENSION_VERSION, verdict, missingChecks };
}

/** The baseline workload is request/turn driven. Native infrastructure may process
 * events internally; no general event ordering/deduplication agent API is claimed. */
export function baselineExtensions(platform: ExtensionPlatform, deployment: string): ExtensionReport[] {
  return (Object.keys(EXTENSION_CHECKS) as ExtensionId[]).map(caseId => gradeExtension({ caseId, platform, variant: "baseline", deployment,
    claimed: caseId !== "X03", observations: [], reason: caseId === "X03"
      ? "No event-driven logical-input API is claimed by this baseline; telemetry deduplication is B11, not X03."
      : "Capability exists, but this exact deployment needs versioned native acceptance observations; framework branding and component tests do not pass it." }));
}
