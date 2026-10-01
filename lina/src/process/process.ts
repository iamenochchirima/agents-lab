import { createHash } from "node:crypto";
import type { CorrelationId, ProcessErrorCode } from "../runtime/contracts.js";
import { assertLifecycleTransition } from "../runtime/lifecycle.js";

export type ProcessState =
  | "prepared"
  | "approved"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "ambiguous";

export interface ProcessLimits {
  readonly timeoutMs: number;
  readonly terminationGraceMs: number;
  readonly maxOutputBytes: number;
  readonly maxArgumentCount: number;
  readonly maxArgumentBytes: number;
}

export interface ProcessRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

export interface ProcessIdentity {
  readonly device: number;
  readonly inode: number;
  readonly mode: number;
  readonly size: number;
  readonly modifiedAtMs: number;
  readonly contentHash?: string;
}

/**
 * Operating-system evidence used to avoid signalling a reused PID during
 * restart recovery. The token is optional because the current platform may not
 * expose a safe process identity source.
 */
export interface ProcessIdentityToken {
  readonly platform: NodeJS.Platform;
  readonly executablePath: string;
  readonly startTime: string;
}

function sameProcessIdentity(left: ProcessIdentityToken | undefined, right: ProcessIdentityToken | undefined): boolean {
  return left?.platform === right?.platform
    && left?.executablePath === right?.executablePath
    && left?.startTime === right?.startTime;
}

export interface PreparedProcess {
  readonly executionId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly displayArgs: readonly string[];
  readonly cwd: string;
  readonly cwdAbsolutePath: string;
  readonly cwdIdentity: ProcessIdentity;
  readonly executablePath: string;
  readonly executableIdentity: ProcessIdentity;
  readonly argvHash: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly environmentProfile: "sanitized-default";
  readonly environmentKeys: readonly string[];
  readonly limits: ProcessLimits;
}

export interface ProcessApprovalRequest {
  readonly callId: string;
  readonly executionId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly displayArgs: readonly string[];
  readonly cwd: string;
  readonly executablePath: string;
  readonly environmentProfile: "sanitized-default";
  readonly environmentKeys: readonly string[];
  readonly limits: ProcessLimits;
  readonly argvHash: string;
  /** Opaque identity for an exact request; includes resolved executable, cwd, environment, and limits. */
  readonly permissionIdentity?: string;
  readonly approvalTimeoutMs?: number;
  readonly warning: string;
}

export type ProcessApprovalDecision =
  | { readonly decision: "allow-once"; readonly permissionGrant?: { readonly id: string; readonly scope: "conversation" | "local" } }
  | { readonly decision: "deny"; readonly reason?: string }
  | { readonly decision: "unavailable"; readonly reason: string };

/** Build a stable, secret-free matcher for an exact prepared request. */
export function processPermissionIdentity(prepared: PreparedProcess): string {
  const payload = {
    command: prepared.command,
    argvHash: prepared.argvHash,
    cwdAbsolutePath: prepared.cwdAbsolutePath,
    cwdIdentity: {
      device: prepared.cwdIdentity.device,
      inode: prepared.cwdIdentity.inode,
      mode: prepared.cwdIdentity.mode,
    },
    executablePath: prepared.executablePath,
    executableIdentity: prepared.executableIdentity,
    environment: Object.entries(prepared.environment).sort(([left], [right]) => left.localeCompare(right)),
    environmentProfile: prepared.environmentProfile,
    environmentKeys: prepared.environmentKeys,
    limits: prepared.limits,
  };
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

export interface ProcessExecutionRecord {
  readonly schemaVersion: 1;
  readonly executionId: string;
  readonly callId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly correlationId?: CorrelationId;
  readonly command: string;
  readonly displayArgs: readonly string[];
  readonly cwd: string;
  readonly executablePath: string;
  readonly environmentProfile: "sanitized-default";
  readonly environmentKeys: readonly string[];
  readonly limits: ProcessLimits;
  readonly argvHash: string;
  readonly permissionGrant?: { readonly id: string; readonly scope: "conversation" | "local" };
  readonly approvalTimeoutMs?: number;
  readonly status: ProcessState;
  readonly decision?: "allow-once" | "deny" | "unavailable";
  readonly pid?: number;
  readonly processIdentity?: ProcessIdentityToken;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly stdoutBytes?: number;
  readonly stderrBytes?: number;
  readonly outputTruncated?: boolean;
  readonly durationMs?: number;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly terminationConfirmed?: boolean;
  readonly errorCode?: ProcessErrorCode;
  readonly errorMessage?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly recordedAt: string;
}

const PROCESS_TRANSITIONS: Readonly<Record<ProcessState, readonly ProcessState[]>> = {
  prepared: ["approved", "failed", "cancelled"],
  approved: ["running", "failed", "cancelled"],
  running: ["completed", "failed", "cancelled", "ambiguous"],
  completed: [],
  failed: [],
  cancelled: [],
  ambiguous: [],
};

export function assertProcessTransition(previous: ProcessExecutionRecord, next: ProcessExecutionRecord): void {
  const sameLimits = previous.limits.timeoutMs === next.limits.timeoutMs
    && previous.limits.terminationGraceMs === next.limits.terminationGraceMs
    && previous.limits.maxOutputBytes === next.limits.maxOutputBytes
    && previous.limits.maxArgumentCount === next.limits.maxArgumentCount
    && previous.limits.maxArgumentBytes === next.limits.maxArgumentBytes;
  const changedFields = [
    previous.executionId !== next.executionId ? "executionId" : undefined,
    previous.callId !== next.callId ? "callId" : undefined,
    previous.sessionId !== next.sessionId ? "sessionId" : undefined,
    previous.turnId !== next.turnId ? "turnId" : undefined,
    previous.correlationId !== undefined && previous.correlationId !== next.correlationId ? "correlationId" : undefined,
    previous.command !== next.command ? "command" : undefined,
    JSON.stringify(previous.displayArgs) !== JSON.stringify(next.displayArgs) ? "displayArgs" : undefined,
    previous.cwd !== next.cwd ? "cwd" : undefined,
    previous.executablePath !== next.executablePath ? "executablePath" : undefined,
    previous.environmentProfile !== next.environmentProfile ? "environmentProfile" : undefined,
    JSON.stringify(previous.environmentKeys) !== JSON.stringify(next.environmentKeys) ? "environmentKeys" : undefined,
    previous.processIdentity !== undefined && !sameProcessIdentity(previous.processIdentity, next.processIdentity) ? "processIdentity" : undefined,
    !sameLimits ? "limits" : undefined,
    previous.argvHash !== next.argvHash ? "argvHash" : undefined,
    previous.permissionGrant !== undefined && JSON.stringify(previous.permissionGrant) !== JSON.stringify(next.permissionGrant) ? "permissionGrant" : undefined,
    previous.approvalTimeoutMs !== next.approvalTimeoutMs ? "approvalTimeoutMs" : undefined,
  ].filter((field): field is string => field !== undefined);
  if (changedFields.length > 0) throw new Error("Process execution identity cannot change after it is recorded (" + changedFields.join(", ") + ").");
  assertLifecycleTransition(PROCESS_TRANSITIONS, previous.status, next.status, (from, to) => `Process execution cannot transition from ${from} to ${to}.`);
}

export type ProcessEvent =
  | { readonly type: "started"; readonly executionId: string; readonly pid: number; readonly processIdentity?: ProcessIdentityToken }
  | { readonly type: "output"; readonly executionId: string; readonly stream: "stdout" | "stderr"; readonly bytes: number }
  | { readonly type: "terminating"; readonly executionId: string; readonly reason: "timeout" | "output-limit" | "cancelled" }
  | { readonly type: "completed"; readonly executionId: string; readonly result: ProcessResult };

export type ProcessToolEvent =
  | { readonly type: "prepared"; readonly request: ProcessApprovalRequest }
  | { readonly type: "approval_decided"; readonly request: ProcessApprovalRequest; readonly decision: ProcessApprovalDecision }
  | { readonly type: "started"; readonly request: ProcessApprovalRequest; readonly pid: number; readonly processIdentity?: ProcessIdentityToken }
  | { readonly type: "output"; readonly request: ProcessApprovalRequest; readonly stream: "stdout" | "stderr"; readonly bytes: number }
  | { readonly type: "terminating"; readonly request: ProcessApprovalRequest; readonly reason: "timeout" | "output-limit" | "cancelled" }
  | { readonly type: "completed"; readonly request: ProcessApprovalRequest; readonly result: ProcessResult };

export interface ProcessResult {
  readonly executionId: string;
  readonly state: Extract<ProcessState, "completed" | "failed" | "cancelled" | "ambiguous">;
  readonly started: boolean;
  readonly pid?: number;
  readonly processIdentity?: ProcessIdentityToken;
  readonly command: string;
  readonly displayArgs: readonly string[];
  readonly cwd: string;
  readonly executablePath: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly outputTruncated: boolean;
  readonly durationMs: number;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly terminationConfirmed: boolean;
  readonly errorCode?: ProcessErrorCode;
  readonly errorMessage?: string;
}

export interface ProcessRunner {
  run(prepared: PreparedProcess, signal?: AbortSignal, onEvent?: (event: ProcessEvent) => void | Promise<void>): Promise<ProcessResult>;
}
