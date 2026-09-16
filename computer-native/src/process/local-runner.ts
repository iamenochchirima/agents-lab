import { spawn } from "node:child_process";
import type { ProcessEvent, PreparedProcess, ProcessResult, ProcessRunner } from "./process.js";

function elapsed(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

export class LocalProcessRunner implements ProcessRunner {
  constructor(private readonly verifyPrepared: (prepared: PreparedProcess) => Promise<void>) {}

  async run(prepared: PreparedProcess, signal?: AbortSignal, onEvent?: (event: ProcessEvent) => void): Promise<ProcessResult> {
    await this.verifyPrepared(prepared);
    const startedAt = Date.now();
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let capturedBytes = 0;
    let outputLimited = false;
    let timeout = false;
    let cancelled = false;
    let terminationRequested = false;
    let terminationConfirmed = false;
    let childPid: number | undefined;
    let childExited = false;
    let terminationTimer: NodeJS.Timeout | undefined;
    let forcedTerminationTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;
    let resolveClose: ((value: { readonly code: number | null; readonly signal: NodeJS.Signals | null; readonly error?: Error }) => void) | undefined;
    let child: ReturnType<typeof spawn>;
    const closePromise = new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null; readonly error?: Error }>((resolve) => {
      resolveClose = resolve;
    });

    const requestTermination = (reason: "timeout" | "output-limit" | "cancelled", emitEvent = true): void => {
      if (terminationRequested || childExited) return;
      terminationRequested = true;
      if (emitEvent) onEvent?.({ type: "terminating", executionId: prepared.executionId, reason });
      try {
        if (childPid !== undefined && process.platform !== "win32") process.kill(-childPid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch {
        try {
          child.kill("SIGTERM");
        } catch {
          // The close event below determines whether the process actually ended.
        }
      }
      terminationTimer = setTimeout(() => {
        if (childExited) return;
        try {
          if (childPid !== undefined && process.platform !== "win32") process.kill(-childPid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          // A missing process is handled as an unconfirmed termination below.
        }
        forcedTerminationTimer = setTimeout(() => {
          if (childExited) return;
          resolveClose?.({ code: null, signal: null, error: new Error("The process did not confirm termination after SIGKILL.") });
        }, prepared.limits.terminationGraceMs);
      }, prepared.limits.terminationGraceMs);
    };

    child = spawn(prepared.executablePath, prepared.args, {
      cwd: prepared.cwdAbsolutePath,
      env: prepared.environment,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    childPid = child.pid;
    if (childPid === undefined) {
      return {
        executionId: prepared.executionId,
        state: "failed",
        started: false,
        command: prepared.command,
        displayArgs: prepared.displayArgs,
        cwd: prepared.cwd,
        executablePath: prepared.executablePath,
        stdout: "",
        stderr: "",
        stdoutBytes: 0,
        stderrBytes: 0,
        outputTruncated: false,
        durationMs: elapsed(startedAt),
        terminationConfirmed: false,
        errorCode: "process-start",
        errorMessage: "The child process did not expose a process identifier.",
      };
    }
    const capture = (stream: "stdout" | "stderr", chunk: Buffer): void => {
      const remaining = prepared.limits.maxOutputBytes - capturedBytes;
      const accepted = Math.max(0, Math.min(chunk.byteLength, remaining));
      if (stream === "stdout") stdoutBytes += chunk.byteLength;
      else stderrBytes += chunk.byteLength;
      if (accepted > 0) {
        const value = chunk.subarray(0, accepted);
        if (stream === "stdout") stdout.push(value);
        else stderr.push(value);
        capturedBytes += accepted;
        onEvent?.({ type: "output", executionId: prepared.executionId, stream, bytes: accepted });
      }
      if (accepted < chunk.byteLength) {
        outputLimited = true;
        requestTermination("output-limit");
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => capture("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => capture("stderr", chunk));
    child.once("error", (error) => resolveClose?.({ code: null, signal: null, error }));
    child.once("close", (code, signalName) => {
      childExited = true;
      terminationConfirmed = terminationRequested;
      resolveClose?.({ code, signal: signalName });
    });

    try {
      await onEvent?.({ type: "started", executionId: prepared.executionId, pid: childPid });
    } catch (error) {
      // The started event is the acknowledgement boundary for durable launch
      // evidence. If that acknowledgement fails, do not leave the child alive
      // while the caller records the failed/ambiguous tool result.
      requestTermination("cancelled", false);
      await closePromise;
      if (terminationTimer) clearTimeout(terminationTimer);
      if (forcedTerminationTimer) clearTimeout(forcedTerminationTimer);
      throw error;
    }

    if (signal?.aborted) {
      cancelled = true;
      requestTermination("cancelled");
    } else {
      abortListener = () => {
        cancelled = true;
        requestTermination("cancelled");
      };
      signal?.addEventListener("abort", abortListener, { once: true });
    }
    timeoutTimer = setTimeout(() => {
      timeout = true;
      requestTermination("timeout");
    }, prepared.limits.timeoutMs);

    const closed = await closePromise;
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (terminationTimer) clearTimeout(terminationTimer);
    if (forcedTerminationTimer) clearTimeout(forcedTerminationTimer);
    if (abortListener) signal?.removeEventListener("abort", abortListener);
    const result: ProcessResult = {
      executionId: prepared.executionId,
      state: cancelled ? "cancelled" : "failed",
      started: true,
      pid: childPid,
      command: prepared.command,
      displayArgs: prepared.displayArgs,
      cwd: prepared.cwd,
      executablePath: prepared.executablePath,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
      stdoutBytes,
      stderrBytes,
      outputTruncated: outputLimited,
      durationMs: elapsed(startedAt),
      exitCode: closed.code,
      signal: closed.signal,
      terminationConfirmed,
      ...(timeout ? { errorCode: "process-timeout" as const, errorMessage: "The process exceeded its " + prepared.limits.timeoutMs + "ms deadline." } : {}),
      ...(outputLimited ? { errorCode: "process-output-limit" as const, errorMessage: "The process exceeded its " + prepared.limits.maxOutputBytes + "-byte output limit." } : {}),
      ...(cancelled ? { errorCode: "process-cancelled" as const, errorMessage: "The process was cancelled." } : {}),
      ...(!timeout && !outputLimited && !cancelled && closed.error ? { errorCode: "process-start" as const, errorMessage: closed.error.message } : {}),
      ...(!timeout && !outputLimited && !cancelled && !closed.error && closed.signal ? { errorCode: "process-signal" as const, errorMessage: "The process terminated with signal " + closed.signal + "." } : {}),
    };
    const finalResult: ProcessResult = !terminationConfirmed && (timeout || outputLimited || cancelled)
      ? { ...result, state: "ambiguous", errorCode: "process-ambiguous", errorMessage: "The process termination could not be confirmed." }
      : !timeout && !outputLimited && !cancelled && !closed.error && !closed.signal
        ? { ...result, state: "completed", ...(closed.code !== 0 ? { errorCode: "process-exit" as const, errorMessage: "The process exited with code " + (closed.code ?? "unknown") + "." } : {}) }
        : result;
    await onEvent?.({ type: "completed", executionId: prepared.executionId, result: finalResult });
    return finalResult;
  }
}
