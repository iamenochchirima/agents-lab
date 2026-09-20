import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import { stableStringify } from "../persistence/json.js";
import { ToolExecutionError } from "../runtime/errors.js";
import { MIN_COMPUTER_CONFIDENCE, type ComputerEnvironmentObservation } from "./contracts.js";
import { ComputerFailureError } from "./failures.js";

const MAX_NATIVE_CANDIDATES = 128;
const MAX_NATIVE_LABEL_CHARS = 512;

export interface NativeSemanticCandidate {
  readonly candidateId: string;
  readonly actionId: string;
  readonly operation: "click";
  readonly elementToken: string;
  readonly role: string;
  readonly label: string;
  readonly source: "accessibility";
  readonly snapshotId?: string;
  /** Screen-space bounds used only to prove visual/semantic agreement. */
  readonly frame?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface NativeTypesafeDecision {
  readonly strategy: "typesafe";
  readonly model: string;
  readonly latencyMs: number;
  readonly candidate: NativeSemanticCandidate;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

function parseStructured(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength ? value.trim() : undefined;
}

function boundedFrame(value: unknown): NativeSemanticCandidate["frame"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const frame = value as Record<string, unknown>;
  const values = ["x", "y", "width", "height"].map((key) => frame[key]);
  if (values.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) return undefined;
  const [x, y, width, height] = values as [number, number, number, number];
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

function isClickableRole(role: string): boolean {
  return new Set(["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "combobox", "listitem"]).has(role.toLowerCase());
}

/**
 * Build a closed candidate set from CUA's accessibility snapshot. The model
 * can select an existing token only; it cannot manufacture a selector or
 * coordinate. If the host did not provide a semantic snapshot, this returns
 * an empty set so native Jev abstains instead of silently falling back to OCR
 * or a guessed desktop position.
 */
export function nativeAccessibilityCandidates(observation: ComputerEnvironmentObservation): readonly NativeSemanticCandidate[] {
  const root = parseStructured(observation.structuredJson);
  const accessibility = root?.accessibility;
  if (!accessibility || typeof accessibility !== "object" || Array.isArray(accessibility)) return [];
  const rawElements = (accessibility as Record<string, unknown>).elements;
  if (!Array.isArray(rawElements)) return [];
  const snapshotId = boundedString((accessibility as Record<string, unknown>).snapshotId, 256) ?? observation.windowSnapshotId;
  return rawElements.slice(0, MAX_NATIVE_CANDIDATES).flatMap((raw, index): NativeSemanticCandidate[] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const element = raw as Record<string, unknown>;
    const token = boundedString(element.elementToken, 256);
    const role = boundedString(element.role, 64);
    if (!token || !role || element.enabled === false) return [];
    const actions = Array.isArray(element.actions) ? element.actions.filter((action): action is string => typeof action === "string") : [];
    if (!actions.some((action) => /^(click|invoke|press|activate)$/iu.test(action)) && !isClickableRole(role)) return [];
    const label = boundedString(element.label, MAX_NATIVE_LABEL_CHARS) ?? boundedString(element.value, MAX_NATIVE_LABEL_CHARS) ?? role;
    const frame = boundedFrame(element.frame);
    const actionId = `native_accessibility_click_${index}`;
    return [{
      candidateId: actionId,
      actionId,
      operation: "click",
      elementToken: token,
      role,
      label,
      source: "accessibility",
      ...(snapshotId ? { snapshotId } : {}),
      ...(frame ? { frame } : {}),
    }];
  });
}

function safeProbabilities(value: unknown): Readonly<Record<string, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, probability]) =>
    key.length <= 256 && typeof probability === "number" && Number.isFinite(probability) && probability >= 0 && probability <= 1,
  ).slice(0, MAX_NATIVE_CANDIDATES + 1));
}

export async function nativeTypesafeDecision(input: {
  readonly apiKey?: string;
  readonly model?: string;
  readonly fetchImpl?: typeof fetch;
  readonly goal: string;
  readonly observation: ComputerEnvironmentObservation;
  readonly signal?: AbortSignal;
}): Promise<NativeTypesafeDecision | undefined> {
  if (!input.apiKey) throw new ToolExecutionError("The native TypeSafe computer strategy requires TYPESAFE_API_KEY.");
  const candidates = nativeAccessibilityCandidates(input.observation);
  if (candidates.length === 0) return undefined;
  if (input.observation.windowPid === undefined || !input.observation.windowId) {
    throw new ToolExecutionError("Native TypeSafe computer use requires an exact accessible foreground window; CUA did not provide one.");
  }
  const labels = Object.fromEntries([
    ...candidates.map((candidate) => [candidate.actionId, { operation: candidate.operation, role: candidate.role, label: candidate.label }]),
    ["none", { operation: "abstain", reason: "No current accessibility candidate is safe or relevant." }],
  ]);
  const root = parseStructured(input.observation.structuredJson);
  const accessibility = root?.accessibility as Record<string, unknown> | undefined;
  const model = input.model ?? "jev-latest";
  const decisionStartedAt = Date.now();
  const client = new TypeSafeClient({
    apiKey: input.apiKey,
    defaultModel: model,
    retry: { maxRetries: 0 },
    ...(input.fetchImpl ? { fetch: input.fetchImpl } : {}),
  });
  const response = await client.systemOne({
    model,
    state: {
      goal: input.goal,
      environment: "ubuntu-x11-cua",
      windowTitle: boundedString(accessibility?.windowTitle, 512) ?? "",
      appName: boundedString(accessibility?.appName, 128) ?? "",
      accessibilityCandidates: labels,
      observationText: input.observation.text.slice(0, 4_000),
    },
    questions: {
      target: choice("Which current accessibility candidate should be activated for the safe goal? Choose none if no candidate is appropriate.", labels),
    },
  }, { signal: input.signal, timeout: 20_000 });
  const selected = response.answers.target.choice;
  if (selected === "none") return undefined;
  if (typeof selected !== "string") throw new ToolExecutionError("TypeSafe returned an invalid native candidate selection.");
  const candidate = candidates.find((value) => value.actionId === selected);
  if (!candidate) throw new ToolExecutionError("TypeSafe selected a native candidate that was not present in the current accessibility snapshot.");
  const confidence = response.answers.target.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < MIN_COMPUTER_CONFIDENCE || confidence > 1) {
    throw new ComputerFailureError("computer-confidence-abstention", `Native Jev abstained because its confidence was below the ${MIN_COMPUTER_CONFIDENCE} safety threshold.`);
  }
  return {
    strategy: "typesafe",
    model,
    latencyMs: Math.max(0, Date.now() - decisionStartedAt),
    candidate,
    confidence,
    probabilities: safeProbabilities(response.answers.target.probabilities),
  };
}

/**
 * A visual coordinate and an accessibility target agree only when CUA supplied
 * a bounded screen-space frame containing that coordinate. Matching operation
 * names alone is insufficient: executing a visual click when Jev selected a
 * different control would make compare mode unsafe.
 */
export function nativeSelectionsAgree(
  selection: { readonly operation: string; readonly x?: number; readonly y?: number },
  candidate: NativeSemanticCandidate,
): boolean {
  if (selection.operation !== "click" || candidate.operation !== "click" || !candidate.frame) return false;
  if (selection.x === undefined || selection.y === undefined) return false;
  return selection.x >= candidate.frame.x
    && selection.y >= candidate.frame.y
    && selection.x <= candidate.frame.x + candidate.frame.width
    && selection.y <= candidate.frame.y + candidate.frame.height;
}

export function nativeTypesafeEvidence(decision: NativeTypesafeDecision): string {
  return stableStringify({
    candidateId: decision.candidate.candidateId,
    source: decision.candidate.source,
    role: decision.candidate.role,
    label: decision.candidate.label,
    confidence: decision.confidence,
    probabilities: decision.probabilities,
    ...(decision.candidate.frame ? { frame: decision.candidate.frame } : {}),
  });
}
