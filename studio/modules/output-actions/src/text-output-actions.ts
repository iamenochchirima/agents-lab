import type { JsonValue, ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";
import { parseOutputActionsConfig, type OutputActionsConfig } from "./config.js";
import {
  OutputActionsError,
  type OutputActionProposal,
  type OutputActionReceipt,
  type OutputActionRequest,
  type OutputActionsDependencies,
  type OutputActionsModule,
} from "./contract.js";

const IDENTITY: ModuleIdentity = Object.freeze({ id: "text-output-actions", version: "0.1.0" });
const ACTION_KIND = "text-response";
const PROPOSAL_SUMMARY = "Deliver final text to the host response sink.";

type DeliveryOutcome =
  | { readonly kind: "receipt"; readonly receipt: OutputActionReceipt }
  | { readonly kind: "cancelled" };

/** Prepares final text without side effects and hands approved proposals to a host sink. */
class TextOutputActions implements OutputActionsModule {
  readonly identity = IDENTITY;

  constructor(
    private readonly config: OutputActionsConfig,
    private readonly dependencies: OutputActionsDependencies,
  ) {}

  async prepare(
    inputValue: { readonly scope: RunScope; readonly action: OutputActionRequest },
    signal: AbortSignal,
  ): Promise<OutputActionProposal> {
    assertSignal(signal);
    throwIfCancelled(signal);
    validateScope(inputValue?.scope);
    const action = validateRequest(inputValue?.action);
    if (action.kind !== ACTION_KIND) {
      throw invalidInput(`This baseline supports only ${JSON.stringify(ACTION_KIND)} actions.`);
    }
    if (!isRecord(action.payload) || Object.keys(action.payload).length !== 1
      || typeof action.payload.text !== "string" || action.payload.text.trim().length === 0
      || !isWellFormedUnicode(action.payload.text)) {
      throw invalidInput('A text-response payload must be an object with one non-empty "text" field.');
    }

    const payload = freezeJson({ text: action.payload.text });
    const payloadBytes = utf8Bytes(JSON.stringify(payload));
    if (payloadBytes > this.config.maxPayloadBytes) {
      throw new OutputActionsError(
        "OUTPUT_ACTION_TOO_LARGE",
        `Serialized text response is ${payloadBytes} UTF-8 bytes; the configured limit is ${this.config.maxPayloadBytes}.`,
      );
    }

    const proposal: OutputActionProposal = Object.freeze({
      actionId: action.actionId,
      kind: ACTION_KIND,
      payload,
      status: "proposed",
      summary: PROPOSAL_SUMMARY,
      evidence: Object.freeze({ payloadBytes }),
    });
    throwIfCancelled(signal);
    return proposal;
  }

  async deliver(
    inputValue: { readonly scope: RunScope; readonly proposal: OutputActionProposal; readonly idempotencyKey?: string },
    signal: AbortSignal,
  ): Promise<OutputActionReceipt> {
    assertSignal(signal);
    throwIfCancelled(signal);
    const scope = validateScope(inputValue?.scope);
    const proposal = validateProposal(inputValue?.proposal, this.config.maxPayloadBytes);
    const idempotencyKey = inputValue.idempotencyKey;
    if (idempotencyKey !== undefined && !isIdentifier(idempotencyKey)) {
      throw invalidInput("idempotencyKey must be a non-empty identifier when provided.");
    }
    if (this.config.requireIdempotencyKey && idempotencyKey === undefined) {
      throw invalidInput("This output configuration requires an idempotencyKey before delivery.");
    }
    throwIfCancelled(signal);

    const outcome = await deliverWithCancellation(
      this.dependencies,
      { scope, proposal, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) },
      signal,
    );
    if (outcome.kind === "cancelled") {
      return Object.freeze({
        actionId: proposal.actionId,
        status: "uncertain",
        reason: "Delivery was cancelled after calling the host sink; the sink may have accepted the output.",
      });
    }
    return outcome.receipt;
  }
}

/** Create the initial text-response implementation with an injected host sink. */
export function createTextOutputActions(config: unknown, dependencies: OutputActionsDependencies): OutputActionsModule {
  const parsed = parseOutputActionsConfig(config);
  if (!isRecord(dependencies) || !isRecord(dependencies.sink) || typeof dependencies.sink.deliver !== "function") {
    throw invalidInput("Text Output Actions requires a host sink with a deliver method.");
  }
  return new TextOutputActions(parsed, dependencies);
}

function validateRequest(value: unknown): OutputActionRequest {
  if (!isRecord(value) || !isIdentifier(value.actionId) || typeof value.kind !== "string"
    || value.kind.trim().length === 0 || !isJsonValue(value.payload)) {
    throw invalidInput("Output action must have a valid actionId, kind, and JSON payload.");
  }
  return { actionId: value.actionId, kind: value.kind, payload: value.payload };
}

function validateProposal(value: unknown, maxPayloadBytes: number): OutputActionProposal {
  if (!isRecord(value) || value.status !== "proposed" || !isIdentifier(value.actionId)
    || value.kind !== ACTION_KIND || typeof value.summary !== "string" || !isWellFormedText(value.summary)
    || !isRecord(value.payload) || Object.keys(value.payload).length !== 1
    || typeof value.payload.text !== "string" || value.payload.text.trim().length === 0
    || !isWellFormedUnicode(value.payload.text)
    || (value.evidence !== undefined && !isJsonValue(value.evidence))) {
    throw invalidInput("Output proposal is not a valid prepared text-response action.");
  }
  const payload = freezeJson({ text: value.payload.text });
  const bytes = utf8Bytes(JSON.stringify(payload));
  if (bytes > maxPayloadBytes) {
    throw new OutputActionsError("OUTPUT_ACTION_TOO_LARGE", `Serialized text response is ${bytes} UTF-8 bytes; the configured limit is ${maxPayloadBytes}.`);
  }
  return Object.freeze({
    actionId: value.actionId,
    kind: ACTION_KIND,
    payload,
    status: "proposed",
    summary: value.summary,
    ...(value.evidence === undefined ? {} : { evidence: freezeJson(value.evidence) }),
  });
}

function validateScope(value: unknown): RunScope {
  if (!isRecord(value) || !isIdentifier(value.runId)
    || (value.sessionId !== undefined && !isIdentifier(value.sessionId))
    || (value.turnId !== undefined && !isIdentifier(value.turnId))) {
    throw invalidInput("Output action scope requires a valid runId and optional valid sessionId and turnId values.");
  }
  return {
    runId: value.runId,
    ...(value.sessionId === undefined ? {} : { sessionId: value.sessionId }),
    ...(value.turnId === undefined ? {} : { turnId: value.turnId }),
  } as unknown as RunScope;
}

function deliverWithCancellation(
  dependencies: OutputActionsDependencies,
  input: { readonly scope: RunScope; readonly proposal: OutputActionProposal; readonly idempotencyKey?: string },
  signal: AbortSignal,
): Promise<DeliveryOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const onAbort = () => finish({ kind: "cancelled" });
    const finish = (outcome: DeliveryOutcome) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(outcome);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }

    let pending: Promise<OutputActionReceipt>;
    try {
      pending = Promise.resolve(dependencies.sink.deliver(input, signal));
    } catch {
      finish({ kind: "receipt", receipt: {
        actionId: input.proposal.actionId,
        status: "uncertain",
        reason: "The host sink threw while delivery was starting; the result is unknown.",
      } });
      return;
    }

    pending.then((receipt) => {
      let normalized: OutputActionReceipt;
      try {
        normalized = validateReceipt(receipt, input.proposal.actionId);
      } catch (error) {
        normalized = {
          actionId: input.proposal.actionId,
          status: "uncertain",
          reason: `The host sink returned a receipt that could not be validated: ${errorMessage(error)}`,
        };
      }
      finish({ kind: "receipt", receipt: normalized });
    }, (error: unknown) => {
      finish({ kind: "receipt", receipt: {
        actionId: input.proposal.actionId,
        status: "uncertain",
        reason: `The host sink rejected after delivery started; the result is unknown: ${errorMessage(error)}`,
      } });
    });
  });
}

function validateReceipt(value: unknown, expectedActionId: string): OutputActionReceipt {
  if (!isRecord(value) || value.actionId !== expectedActionId) {
    return { actionId: expectedActionId, status: "uncertain", reason: "The host sink returned an invalid or mismatched receipt." };
  }
  if (value.status === "committed" && isJsonValue(value.receipt)) {
    return Object.freeze({ actionId: expectedActionId, status: "committed", receipt: freezeJson(value.receipt) });
  }
  if (value.status === "rejected" && typeof value.reason === "string" && isWellFormedText(value.reason)) {
    return Object.freeze({ actionId: expectedActionId, status: "rejected", reason: value.reason });
  }
  if (value.status === "uncertain" && typeof value.reason === "string" && isWellFormedText(value.reason)
    && (value.receipt === undefined || isJsonValue(value.receipt))) {
    return Object.freeze({
      actionId: expectedActionId,
      status: "uncertain",
      reason: value.reason,
      ...(value.receipt === undefined ? {} : { receipt: freezeJson(value.receipt) }),
    });
  }
  return { actionId: expectedActionId, status: "uncertain", reason: "The host sink returned an invalid receipt; delivery outcome is unknown." };
}

function assertSignal(value: unknown): asserts value is AbortSignal {
  if (!isRecord(value) || typeof value.aborted !== "boolean"
    || typeof value.addEventListener !== "function" || typeof value.removeEventListener !== "function") {
    throw invalidInput("A valid AbortSignal is required.");
  }
}

function throwIfCancelled(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw new OutputActionsError("OUTPUT_ACTION_CANCELLED", "Output action was cancelled before delivery began.");
}

function invalidInput(message: string): OutputActionsError {
  return new OutputActionsError("INVALID_OUTPUT_ACTION_INPUT", message);
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string") return typeof value !== "string" || isWellFormedUnicode(value);
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : Object.values(value as Record<string, unknown>).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

function freezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map((item) => freezeJson(item)));
  if (typeof value === "object" && value !== null) {
    const copy: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      Object.defineProperty(copy, key, { value: freezeJson(item), enumerable: true, writable: false, configurable: false });
    }
    return Object.freeze(copy);
  }
  return value;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value) && isWellFormedUnicode(value);
}

function isWellFormedText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && isWellFormedUnicode(value);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : "no error detail";
}
