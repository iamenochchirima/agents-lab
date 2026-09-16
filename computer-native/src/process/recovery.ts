import { setTimeout as delay } from "node:timers/promises";
import type { ProcessExecutionRecord } from "./process.js";

function isMissingProcess(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ESRCH" || code === "ENOENT";
}

function targetFor(pid: number): number {
  // LocalProcessRunner starts Unix children in a detached process group. Killing
  // the group prevents a command's descendants from surviving the harness.
  return process.platform === "win32" ? pid : -pid;
}

function processExists(pid: number): boolean {
  try {
    process.kill(targetFor(pid), 0);
    return true;
  } catch (error) {
    if (isMissingProcess(error)) return false;
    // EPERM still means that the process exists; the caller simply lacks the
    // permission to inspect or terminate it.
    if ((error as NodeJS.ErrnoException | undefined)?.code === "EPERM") return true;
    throw error;
  }
}

function sendSignal(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(targetFor(pid), signal);
    return true;
  } catch (error) {
    if (isMissingProcess(error)) return false;
    throw error;
  }
}

async function waitForTermination(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (processExists(pid)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await delay(Math.min(25, remaining));
  }
  return true;
}

function ambiguousRecord(record: ProcessExecutionRecord, terminationConfirmed: boolean, detail: string): ProcessExecutionRecord {
  return {
    ...record,
    status: "ambiguous",
    terminationConfirmed,
    errorCode: "process-ambiguous",
    errorMessage: `The process was running when the parent process stopped; its outcome is unknown and the command was not replayed. ${detail}`,
    finishedAt: new Date().toISOString(),
    recordedAt: new Date().toISOString(),
  };
}

/**
 * Reconcile a process that was recorded as running when the harness stopped.
 * The command is never replayed. On Unix, the persisted PID identifies the
 * detached process group created by LocalProcessRunner; on Windows, cleanup is
 * limited to the recorded child PID because Node does not expose equivalent
 * process-group signalling. A confirmed cleanup does not make the outcome
 * successful: the child may already have produced an external side effect.
 */
export async function reconcileRunningProcess(record: ProcessExecutionRecord): Promise<ProcessExecutionRecord> {
  if (record.pid === undefined || !Number.isSafeInteger(record.pid) || record.pid <= 0) {
    return ambiguousRecord(record, false, "No valid process identifier was persisted, so cleanup could not be attempted.");
  }

  try {
    if (!processExists(record.pid)) {
      return ambiguousRecord(record, true, "The process was already absent when cleanup began; termination was confirmed.");
    }
    sendSignal(record.pid, "SIGTERM");
    if (await waitForTermination(record.pid, record.limits.terminationGraceMs)) {
      return ambiguousRecord(record, true, "Process termination was confirmed after SIGTERM.");
    }
    sendSignal(record.pid, "SIGKILL");
    if (await waitForTermination(record.pid, record.limits.terminationGraceMs)) {
      return ambiguousRecord(record, true, "Process termination was confirmed after SIGKILL.");
    }
    return ambiguousRecord(record, false, "Process termination could not be confirmed after SIGKILL.");
  } catch (error) {
    return ambiguousRecord(record, false, `Process cleanup failed: ${error instanceof Error ? error.message : "unknown cleanup error"}`);
  }
}
