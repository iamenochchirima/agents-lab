import type { ComputerRunEventKind, ComputerRunEventRecord, ComputerRunRecord } from "./records.js";

/**
 * Safe, read-only projection of one computer lifecycle event. Deliberately
 * excludes the original payload: event payloads may contain provider-shaped
 * data, screen paths, or labels that are not appropriate for routine TUI
 * rendering.
 */
export interface ComputerRunEventSummary {
  readonly eventId: string;
  readonly sequence: number;
  readonly kind: ComputerRunEventKind;
  readonly strategy: "traditional" | "typesafe" | "compare";
  readonly recordedAt: string;
  readonly observationId?: string;
  readonly previousObservationId?: string;
  readonly actionId?: string;
  readonly candidateId?: string;
  readonly operation?: string;
  readonly model?: string;
  readonly latencyMs?: number;
  readonly success?: boolean;
  readonly terminal?: boolean;
  readonly runStatus?: "completed" | "outcome-unknown" | "failed";
  readonly reason?: string;
  readonly artifactId?: string;
  readonly artifactPath?: string;
  readonly artifactBytes?: number;
  readonly artifactWidth?: number;
  readonly artifactHeight?: number;
}

/** Bounded metadata suitable for the TUI and diagnostic commands. */
export interface ComputerRunSummary {
  readonly run: ComputerRunRecord;
  readonly eventCount: number;
  readonly lastEvent?: ComputerRunEventSummary;
}

export interface ComputerRunRetentionOptions {
  readonly maxAgeMs: number;
  readonly maxEntries: number;
  readonly now?: () => number;
}

export interface ComputerRunRetentionResult {
  readonly scanned: number;
  readonly removed: number;
  readonly retained: number;
  readonly skipped: number;
  readonly failed: number;
  readonly truncated: boolean;
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, maxLength)
    : undefined;
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function safeStatus(value: unknown): ComputerRunEventSummary["runStatus"] {
  return value === "completed" || value === "outcome-unknown" || value === "failed" ? value : undefined;
}

/** Convert a durable event into a deliberately lossy inspection projection. */
export function summarizeComputerRunEvent(event: ComputerRunEventRecord): ComputerRunEventSummary {
  const payload = event.payload;
  return {
    eventId: event.eventId,
    sequence: event.sequence,
    kind: event.kind,
    strategy: event.strategy,
    recordedAt: event.recordedAt,
    ...(boundedString(payload.observationId, 256) ? { observationId: boundedString(payload.observationId, 256) } : {}),
    ...(boundedString(payload.previousObservationId, 256) ? { previousObservationId: boundedString(payload.previousObservationId, 256) } : {}),
    ...(boundedString(payload.actionId, 256) ? { actionId: boundedString(payload.actionId, 256) } : {}),
    ...(boundedString(payload.candidateId, 256) ? { candidateId: boundedString(payload.candidateId, 256) } : {}),
    ...(boundedString(payload.operation, 64) ? { operation: boundedString(payload.operation, 64) } : {}),
    ...(boundedString(payload.model, 256) ? { model: boundedString(payload.model, 256) } : {}),
    ...(safeNumber(payload.latencyMs) !== undefined ? { latencyMs: safeNumber(payload.latencyMs) } : {}),
    ...(typeof payload.success === "boolean" ? { success: payload.success } : {}),
    ...(typeof payload.terminal === "boolean" ? { terminal: payload.terminal } : {}),
    ...(safeStatus(payload.runStatus) ? { runStatus: safeStatus(payload.runStatus) } : {}),
    ...(boundedString(payload.reason, 2_000) ? { reason: boundedString(payload.reason, 2_000) } : {}),
    ...(boundedString(payload.artifactId, 256) ? { artifactId: boundedString(payload.artifactId, 256) } : {}),
    ...(boundedString(payload.artifactPath, 512) ? { artifactPath: boundedString(payload.artifactPath, 512) } : {}),
    ...(safeNumber(payload.artifactBytes) !== undefined ? { artifactBytes: safeNumber(payload.artifactBytes) } : {}),
    ...(safeNumber(payload.artifactWidth) !== undefined ? { artifactWidth: safeNumber(payload.artifactWidth) } : {}),
    ...(safeNumber(payload.artifactHeight) !== undefined ? { artifactHeight: safeNumber(payload.artifactHeight) } : {}),
  };
}

export function emptyComputerRunRetentionResult(): ComputerRunRetentionResult {
  return { scanned: 0, removed: 0, retained: 0, skipped: 0, failed: 0, truncated: false };
}
