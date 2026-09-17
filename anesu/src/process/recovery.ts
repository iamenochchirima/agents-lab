import { setTimeout as delay } from "node:timers/promises";
import { readFile, readlink } from "node:fs/promises";
import type { ProcessExecutionRecord, ProcessIdentityToken } from "./process.js";

function isMissingProcess(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ESRCH" || code === "ENOENT";
}

/**
 * Return an OS-provided identity token when the platform exposes one safely.
 * Linux's `/proc` start time is measured from boot and changes when a PID is
 * reused; it is stronger than comparing the PID or executable path alone.
 */
export async function readProcessIdentity(pid: number): Promise<ProcessIdentityToken | undefined> {
  if (process.platform !== "linux") return undefined;
  try {
    const [executablePath, stat] = await Promise.all([
      readlink(`/proc/${pid}/exe`),
      readFile(`/proc/${pid}/stat`, "utf8"),
    ]);
    const commandEnd = stat.lastIndexOf(")");
    if (commandEnd < 0) return undefined;
    const fields = stat.slice(commandEnd + 1).trim().split(/\s+/u);
    const startTime = fields[19];
    if (!startTime) return undefined;
    return { platform: process.platform, executablePath, startTime };
  } catch {
    return undefined;
  }
}

function sameProcessIdentity(left: ProcessIdentityToken, right: ProcessIdentityToken): boolean {
  return left.platform === right.platform
    && left.executablePath === right.executablePath
    && left.startTime === right.startTime;
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
 * detached process group created by LocalProcessRunner. Platforms without a safe
 * persisted process-identity source fail closed instead of signalling a potentially
 * reused PID. A confirmed cleanup does not make the outcome successful: the child may
 * already have produced an external side effect.
 */
export async function reconcileRunningProcess(record: ProcessExecutionRecord): Promise<ProcessExecutionRecord> {
  if (record.pid === undefined || !Number.isSafeInteger(record.pid) || record.pid <= 0) {
    return ambiguousRecord(record, false, "No valid process identifier was persisted, so cleanup could not be attempted.");
  }

  try {
    const currentIdentity = record.processIdentity ? await readProcessIdentity(record.pid) : undefined;
    if (record.processIdentity && currentIdentity && !sameProcessIdentity(record.processIdentity, currentIdentity)) {
      return ambiguousRecord(record, false, "The persisted process identity does not match the current PID, so cleanup was not attempted.");
    }
    const targetExists = processExists(record.pid);
    if (!targetExists) {
      if (record.processIdentity && currentIdentity) {
        return ambiguousRecord(record, false, "The recorded process still exists but its process group is unavailable, so cleanup was not attempted.");
      }
      return ambiguousRecord(record, true, "The process was already absent when cleanup began; termination was confirmed.");
    }
    if (!record.processIdentity) {
      return ambiguousRecord(record, false, "No persisted process identity was available, so cleanup was not attempted.");
    }
    if (!currentIdentity) {
      return ambiguousRecord(record, false, "The current process identity could not be verified, so cleanup was not attempted.");
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
