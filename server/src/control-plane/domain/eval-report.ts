/** JSON-only observations keep graders and retained reports independent of platform SDKs. */
export type EvalJson = null | boolean | number | string | readonly EvalJson[] | { readonly [key: string]: EvalJson };

export interface EvalObservationReference {
  readonly runId: string;
  readonly file: "config.json" | "events.jsonl" | "context.json" | "result.json" | "artifacts/eval.json";
  /** JSON Pointer into a JSON file, or a caller-defined event pointer for JSONL. */
  readonly pointer?: string;
}

export interface EvalAssertion {
  readonly id: string;
  readonly passed: boolean;
  readonly expected: EvalJson;
  readonly observed: EvalJson;
  readonly observationRefs?: readonly EvalObservationReference[];
}

/** One immutable case verdict. B03 retains both turns in runIds, even when turn two fails. */
export interface RunEvalReport {
  readonly schemaVersion: 1;
  readonly suiteVersion: string;
  readonly graderVersion: string;
  readonly caseId: "B01" | "B02" | "B03" | "B07" | "L01" | "L02" | "L03";
  /** Absent on historical reports means scripted. Live case IDs require explicit classification. */
  readonly mode?: "scripted" | "live";
  readonly trialId: string;
  readonly ownerRunId: string;
  readonly runIds: readonly string[];
  readonly verdict: "pass" | "fail" | "blocked" | "error";
  readonly assertions: readonly EvalAssertion[];
  /** Eval-owned synthetic tasks only, including sanitized live captures. Never retain unrelated prompts or credentials. */
  readonly observations: readonly EvalJson[];
  readonly metadata: {
    readonly revision: string | null;
    readonly dirty: boolean;
    readonly versions: Readonly<Record<string, string>>;
    readonly startedAt: string;
    readonly completedAt: string;
    readonly trialCount: number;
    /** JSON-only model identity, settings, routing controls and environment for live trials. */
    readonly model?: EvalJson;
    readonly environment?: EvalJson;
  };
}

/** Reject unsupported schema versions and malformed verdicts before storing or consuming evidence. */
export function assertRunEvalReport(value: unknown): asserts value is RunEvalReport {
  if (!record(value) || value.schemaVersion !== 1 ||
      !["B01", "B02", "B03", "B07", "L01", "L02", "L03"].includes(String(value.caseId)) ||
      !["pass", "fail", "blocked", "error"].includes(String(value.verdict))) invalid();
  const liveCase = ["L01", "L02", "L03"].includes(String(value.caseId));
  if ((value.mode !== undefined && value.mode !== "scripted" && value.mode !== "live") ||
      (liveCase ? value.mode !== "live" : value.mode === "live")) invalid();
  for (const key of ["suiteVersion", "graderVersion", "trialId", "ownerRunId"]) {
    if (!text(value[key])) invalid();
  }
  if (!Array.isArray(value.runIds) || value.runIds.length === 0 || value.runIds.length > 2 ||
      value.runIds.some((id) => !text(id)) || new Set(value.runIds).size !== value.runIds.length ||
      !value.runIds.includes(value.ownerRunId) ||
      (!["B03", "B07", "L03"].includes(String(value.caseId)) && value.runIds.length !== 1)) invalid();
  if (!Array.isArray(value.assertions) || value.assertions.length > 128 ||
      !Array.isArray(value.observations)) invalid();
  for (const assertion of value.assertions) {
    if (!record(assertion) || !text(assertion.id) || typeof assertion.passed !== "boolean" ||
        !json(assertion.expected) || !json(assertion.observed)) invalid();
    if (assertion.observationRefs !== undefined) {
      if (!Array.isArray(assertion.observationRefs)) invalid();
      for (const ref of assertion.observationRefs) {
        if (!record(ref) || !value.runIds.includes(ref.runId) ||
            !["config.json", "events.jsonl", "context.json", "result.json", "artifacts/eval.json"].includes(String(ref.file)) ||
            (ref.pointer !== undefined && (typeof ref.pointer !== "string" ||
              (ref.pointer !== "" && !ref.pointer.startsWith("/"))))) invalid();
      }
    }
  }
  if (!value.observations.every((item) => json(item))) invalid();
  if (value.verdict === "pass" && (value.assertions.length === 0 || value.assertions.some((item) => !item.passed))) invalid();
  if (value.verdict === "fail" && !value.assertions.some((item) => !item.passed)) invalid();
  const metadata = value.metadata;
  if (!record(metadata) || (metadata.revision !== null && !text(metadata.revision)) ||
      typeof metadata.dirty !== "boolean" || !record(metadata.versions) ||
      !Object.values(metadata.versions).every(text) ||
      !date(metadata.startedAt) || !date(metadata.completedAt) ||
      Date.parse(String(metadata.completedAt)) < Date.parse(String(metadata.startedAt)) ||
      !Number.isSafeInteger(metadata.trialCount) || Number(metadata.trialCount) < 1 ||
      (metadata.model !== undefined && !json(metadata.model)) ||
      (metadata.environment !== undefined && !json(metadata.environment))) invalid();
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}
function date(value: unknown): boolean {
  return text(value) && !Number.isNaN(Date.parse(value));
}
function json(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => json(item, depth + 1));
  return record(value) && Object.values(value).every((item) => json(item, depth + 1));
}

function invalid(): never {
  throw new Error("Invalid schema-v1 agent eval report.");
}
