import { createHash } from "node:crypto";
import type {
  DriverAuthorizationAction,
  DriverAuthorizationDecision,
  DriverAuthorizationHost,
  DriverAuthorizationRequest,
} from "@trycua/cua-driver";

/** The only request fields an application approval surface is allowed to see. */
export interface CuaAuthorizationRequestView {
  readonly schema: string;
  readonly requestDigest: string;
  readonly adapterId: string;
  readonly riskClass: string;
  readonly publicSession: string;
  readonly humanSummary: string;
  readonly expiresUnixMs: number;
  /** Digest of the attested resource identity; the resource JSON itself is never exposed. */
  readonly resourceDigest: string;
  /** Anesu-owned task identity bound by the caller; never supplied by Cua. */
  readonly taskGrantHash?: string;
}

export type CuaAuthorizationDecision = "allow" | "deny" | "cancel";

export type CuaAuthorizationCallback = (
  request: CuaAuthorizationRequestView,
  signal?: AbortSignal,
) => Promise<CuaAuthorizationDecision>;

export interface CuaAuthorizationActions {
  readonly allow: DriverAuthorizationAction;
  readonly deny: DriverAuthorizationAction;
  readonly cancel: DriverAuthorizationAction;
}

export interface CuaAuthorizationHostOptions {
  readonly actions: CuaAuthorizationActions;
  readonly authorize?: CuaAuthorizationCallback;
  readonly now?: () => number;
}

const MAX_SCHEMA_BYTES = 128;
const MAX_DIGEST_BYTES = 256;
const MAX_ID_BYTES = 256;
const MAX_RISK_BYTES = 128;
const MAX_SESSION_BYTES = 256;
const MAX_SUMMARY_BYTES = 4_096;

function bounded(value: unknown, maxBytes: number): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return Buffer.byteLength(value, "utf8") <= maxBytes ? value : undefined;
}

function safeUnixMs(value: bigint): number | undefined {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return Number(value);
}

function resourceDigest(resourceJson: string): string {
  return createHash("sha256").update(resourceJson, "utf8").digest("hex");
}

function decisionAction(
  decision: CuaAuthorizationDecision,
  actions: CuaAuthorizationActions,
): DriverAuthorizationAction {
  if (decision === "allow") return actions.allow;
  if (decision === "deny") return actions.deny;
  return actions.cancel;
}

/**
 * Build the trusted host callback used by Cua's in-process configured driver.
 *
 * The host is deliberately fail-closed: no callback means cancellation, expired
 * or malformed requests are cancelled, and each request digest is consumed before
 * the callback runs so concurrent/replayed requests cannot receive two decisions.
 * `resourceJson` is hashed only for diagnostics and is never returned to callers.
 */
export function createCuaAuthorizationHost(options: CuaAuthorizationHostOptions): DriverAuthorizationHost {
  const consumedDigests = new Set<string>();
  const now = options.now ?? Date.now;

  return {
    async authorize(request: DriverAuthorizationRequest, asyncOptions?: { readonly signal: AbortSignal }): Promise<DriverAuthorizationDecision> {
      const requestDigest = bounded(request.requestDigest, MAX_DIGEST_BYTES);
      const expiresUnixMs = safeUnixMs(request.expiresUnixMs);
      const viewValues = {
        schema: bounded(request.schema, MAX_SCHEMA_BYTES),
        adapterId: bounded(request.adapterId, MAX_ID_BYTES),
        riskClass: bounded(request.riskClass, MAX_RISK_BYTES),
        publicSession: bounded(request.publicSession, MAX_SESSION_BYTES),
        humanSummary: bounded(request.humanSummary, MAX_SUMMARY_BYTES),
      };
      const valid = requestDigest !== undefined
        && expiresUnixMs !== undefined
        && Object.values(viewValues).every((value) => value !== undefined)
        && request.resourceJson.length <= 64 * 1024;

      if (!valid || consumedDigests.has(requestDigest ?? "")) {
        return { action: options.actions.cancel, requestDigest: request.requestDigest };
      }
      // Consume before awaiting application code. A second concurrent callback for
      // the same Cua request must not be able to turn one authorization into two.
      consumedDigests.add(requestDigest);
      if (expiresUnixMs <= now()) {
        return { action: options.actions.cancel, requestDigest };
      }
      if (!options.authorize) {
        return { action: options.actions.cancel, requestDigest };
      }

      let decision: CuaAuthorizationDecision;
      try {
        decision = await options.authorize({
          schema: viewValues.schema!,
          requestDigest,
          adapterId: viewValues.adapterId!,
          riskClass: viewValues.riskClass!,
          publicSession: viewValues.publicSession!,
          humanSummary: viewValues.humanSummary!,
          expiresUnixMs,
          resourceDigest: resourceDigest(request.resourceJson),
        }, asyncOptions?.signal);
      } catch {
        decision = "cancel";
      }
      return { action: decisionAction(decision, options.actions), requestDigest };
    },
  };
}
