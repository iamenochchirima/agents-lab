import type { ToolCall } from "../tools/contracts.js";

/** A decision authorizes one immutable invocation, never a tool name in general. */
export interface InvocationReview {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly revision: number;
  readonly runId: string;
  readonly turnId: string;
  readonly call: ToolCall;
  readonly catalogRevision: string;
  readonly sourceDigest: string;
  readonly connectionIdentity: string | null;
  readonly argumentDigest: string;
  readonly displayArguments: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: "pending" | "approved" | "denied" | "expired" | "cancelled" | "dispatching" | "completed";
  readonly decision: InvocationDecision | null;
  /** Server-issued identity for resuming a waiter onto a renewed review. */
  readonly renewalId?: string;
  /** Stored atomically with a decision/renewal; acceptance is not tool completion. */
  readonly delivery?: { readonly status: "pending" | "accepted" | "stopped"; readonly attemptCount: number;
    readonly lastAttemptAt?: string; readonly nextAttemptAt?: string; readonly errorCode?: string };
}

export interface InvocationDecision {
  readonly requestId: string;
  readonly revision: number;
  readonly argumentDigest: string;
  readonly decisionId: string;
  readonly decision: "approved" | "denied";
  readonly reason?: string;
}

/** Native workers wait on this safe identity; arguments remain in protected run storage. */
export interface InvocationResumeInput {
  readonly kind: "invocation_review";
  readonly requestId: string;
  readonly revision: number;
  readonly decisionId: string;
  readonly toolCallId: string;
  readonly decision: "approved" | "denied" | "renewed";
  readonly reason?: string;
}

export interface InvocationReviewView extends Omit<InvocationReview, "call"> {
  readonly call: { readonly toolCallId: string; readonly name: string; readonly round: number };
  /** Optional safe display projection; never part of the authorization identity. */
  readonly presentation?: {
    readonly displayName: string; readonly description: string;
    readonly source: { readonly id: string; readonly version: string };
    readonly risk: "pure" | "read" | "write" | "external";
    readonly argumentLabels: Readonly<Record<string, string>>;
  };
}
