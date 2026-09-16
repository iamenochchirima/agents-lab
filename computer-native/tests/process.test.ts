import { chmod, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { LocalProcessRunner } from "../src/process/local-runner.js";
import type { ProcessLimits } from "../src/process/process.js";
import type { ProcessExecutionRecord } from "../src/process/process.js";
import { ProcessSecurityPolicy } from "../src/security/process-policy.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { Workspace } from "../src/workspace/workspace.js";
import { loadConfig } from "../src/config/config.js";
import { DeterministicModelProvider } from "../src/models/deterministic.js";
import { SessionStore } from "../src/persistence/session-store.js";
import { runTurn } from "../src/runtime/turn.js";

const limits: ProcessLimits = {
  timeoutMs: 500,
  terminationGraceMs: 100,
  maxOutputBytes: 4_096,
  maxArgumentCount: 16,
  maxArgumentBytes: 4_096,
};

async function createHarness(): Promise<{ readonly root: string; readonly policy: ProcessSecurityPolicy; readonly cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-process-test-"));
  const workspace = await Workspace.open(root, { maxFileBytes: 64 * 1024, maxDirectoryEntries: 50 });
  const policy = new ProcessSecurityPolicy({
    workspace: workspace.policy,
    limits,
    environment: {
      PATH: process.env.PATH,
      HOME: "/tmp/computer-native-home",
      OPENROUTER_API_KEY: "must-not-be-inherited",
      DATABASE_URL: "must-not-be-inherited",
    },
  });
  return { root, policy, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("local process runner executes exact argv with bounded, sanitized context", async () => {
  const harness = await createHarness();
  try {
    const prepared = await harness.policy.prepare({
      command: process.execPath,
      args: ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.stdout.write(String(process.env.OPENROUTER_API_KEY));"],
    }, "execution_success");
    assert.equal(prepared.environmentProfile, "sanitized-default");
    assert.equal(prepared.environment.OPENROUTER_API_KEY, undefined);
    assert.equal(prepared.environment.DATABASE_URL, undefined);
    const events: string[] = [];
    const result = await new LocalProcessRunner((value) => harness.policy.verify(value)).run(prepared, undefined, (event) => {
      events.push(event.type);
    });
    assert.equal(result.state, "completed");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "outundefined");
    assert.equal(result.stderr, "err");
    assert.equal(result.outputTruncated, false);
    assert.equal(result.terminationConfirmed, false);
    assert.equal(events[0], "started");
    assert.equal(events.at(-1), "completed");
    assert.ok(events.filter((event) => event === "output").length >= 2);
  } finally {
    await harness.cleanup();
  }
});

test("non-zero process exits are completed observations with a typed result", async () => {
  const harness = await createHarness();
  try {
    const prepared = await harness.policy.prepare({
      command: process.execPath,
      args: ["-e", "process.stderr.write('bad'); process.exitCode = 7;"],
    }, "execution_nonzero");
    const result = await new LocalProcessRunner((value) => harness.policy.verify(value)).run(prepared);
    assert.equal(result.state, "completed");
    assert.equal(result.exitCode, 7);
    assert.equal(result.errorCode, "process-exit");
    assert.equal(result.stderr, "bad");
  } finally {
    await harness.cleanup();
  }
});

test("signal termination is reported separately from a non-zero exit", async () => {
  const harness = await createHarness();
  try {
    const prepared = await harness.policy.prepare({
      command: process.execPath,
      args: ["-e", "process.kill(process.pid, 'SIGTERM');"],
    }, "execution_signal");
    const result = await new LocalProcessRunner((value) => harness.policy.verify(value)).run(prepared);
    assert.equal(result.state, "failed");
    assert.equal(result.errorCode, "process-signal");
    assert.equal(result.signal, "SIGTERM");
  } finally {
    await harness.cleanup();
  }
});

test("output limit terminates a noisy process and bounds captured output", async () => {
  const harness = await createHarness();
  try {
    const prepared = await harness.policy.prepare({
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(100000)); setTimeout(() => {}, 5000);"],
    }, "execution_output_limit");
    const result = await new LocalProcessRunner((value) => harness.policy.verify(value)).run(prepared);
    assert.equal(result.state, "failed");
    assert.equal(result.errorCode, "process-output-limit");
    assert.equal(result.outputTruncated, true);
    assert.ok(result.stdoutBytes > result.stdout.length);
    assert.ok(Buffer.byteLength(result.stdout, "utf8") <= limits.maxOutputBytes);
    assert.equal(result.terminationConfirmed, true);
  } finally {
    await harness.cleanup();
  }
});

test("timeout and cancellation terminate foreground processes", async () => {
  const harness = await createHarness();
  try {
    const runner = new LocalProcessRunner((value) => harness.policy.verify(value));
    const timeoutPrepared = await harness.policy.prepare({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 5000);"],
      timeoutMs: 25,
    }, "execution_timeout");
    const timeoutResult = await runner.run(timeoutPrepared);
    assert.equal(timeoutResult.errorCode, "process-timeout");
    assert.equal(timeoutResult.terminationConfirmed, true);

    const cancellationPrepared = await harness.policy.prepare({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 5000);"],
    }, "execution_cancel");
    const controller = new AbortController();
    const running = runner.run(cancellationPrepared, controller.signal);
    setTimeout(() => controller.abort(), 25);
    const cancellationResult = await running;
    assert.equal(cancellationResult.state, "cancelled");
    assert.equal(cancellationResult.errorCode, "process-cancelled");
    assert.equal(cancellationResult.terminationConfirmed, true);
  } finally {
    await harness.cleanup();
  }
});

test("process policy rejects outside and symlink working directories", async () => {
  const harness = await createHarness();
  const outside = await mkdtemp(path.join(os.tmpdir(), "computer-native-process-outside-"));
  try {
    await assert.rejects(
      harness.policy.prepare({ command: process.execPath, args: [], cwd: "../" }, "execution_escape"),
      /outside the workspace root/u,
    );
    await symlink(outside, path.join(harness.root, "linked"));
    await assert.rejects(
      harness.policy.prepare({ command: process.execPath, args: [], cwd: "linked" }, "execution_symlink"),
      /symbolic link/u,
    );
  } finally {
    await harness.cleanup();
    await rm(outside, { recursive: true, force: true });
  }
});

test("process policy rejects malformed argv, absolute cwd, and configured limits", async () => {
  const harness = await createHarness();
  try {
    await assert.rejects(harness.policy.prepare({ command: "", args: [] }, "execution_empty"), /cannot be empty/u);
    await assert.rejects(harness.policy.prepare({ command: process.execPath, args: ["bad\u0000arg"] }, "execution_nul"), /control characters/u);
    await assert.rejects(harness.policy.prepare({ command: process.execPath, args: Array.from({ length: limits.maxArgumentCount + 1 }, () => "x") }, "execution_arg_count"), /argument/u);
    await assert.rejects(harness.policy.prepare({ command: process.execPath, args: ["x".repeat(limits.maxArgumentBytes)] }, "execution_arg_bytes"), /bytes/u);
    await assert.rejects(harness.policy.prepare({ command: process.execPath, args: [], cwd: harness.root }, "execution_absolute_cwd"), /relative/u);
    await assert.rejects(harness.policy.prepare({ command: process.execPath, args: [], timeoutMs: limits.timeoutMs + 1 }, "execution_timeout_limit"), /no greater/u);
  } finally {
    await harness.cleanup();
  }
});

test("executable identity is rechecked after approval preparation", async () => {
  const harness = await createHarness();
  try {
    const executable = path.join(harness.root, "run-command");
    await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    await chmod(executable, 0o700);
    const prepared = await harness.policy.prepare({ command: "./run-command", args: [] }, "execution_stale");
    await writeFile(executable, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
    await assert.rejects(
      new LocalProcessRunner((value) => harness.policy.verify(value)).run(prepared),
      /changed while approval was pending/u,
    );
  } finally {
    await harness.cleanup();
  }
});

test("run_command is approval-gated and returns the real bounded process result", async () => {
  const harness = await createHarness();
  try {
    const workspace = await Workspace.open(harness.root, { maxFileBytes: 64 * 1024, maxDirectoryEntries: 50 });
    const registry = new ToolRegistry(workspace, 8_192, {
      policy: harness.policy,
      runner: new LocalProcessRunner((value) => harness.policy.verify(value)),
      redactionSecrets: ["process-secret"],
    });
    assert.ok(registry.definitions.some((definition) => definition.name === "run_command"));
    const events: string[] = [];
    const result = await registry.execute({
      callId: "process_tool_call",
      name: "run_command",
      argumentsJson: JSON.stringify({ command: process.execPath, args: ["-e", "process.stdout.write(process.argv[1])", "process-secret"] }),
    }, {
      approveProcess: async (request) => {
        assert.equal(request.cwd, ".");
        assert.equal(request.environmentProfile, "sanitized-default");
        assert.match(request.warning, /not an OS sandbox/u);
        return { decision: "allow-once" };
      },
      onProcess: (event) => { events.push(event.type); },
    });
    assert.equal(result.ok, true);
    assert.match(result.content, /\[REDACTED\]/u);
    assert.doesNotMatch(result.content, /process-secret/u);
    assert.deepEqual(events.slice(0, 3), ["prepared", "approval_decided", "started"]);
    assert.equal(events.at(-1), "completed");
  } finally {
    await harness.cleanup();
  }
});

test("run_command fails closed without approval and does not start a child", async () => {
  const harness = await createHarness();
  try {
    const workspace = await Workspace.open(harness.root, { maxFileBytes: 64 * 1024, maxDirectoryEntries: 50 });
    const registry = new ToolRegistry(workspace, 8_192, { policy: harness.policy });
    const result = await registry.execute({
      callId: "process_no_approval",
      name: "run_command",
      argumentsJson: JSON.stringify({ command: process.execPath, args: ["-e", "process.exit(17)"] }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "process-approval-unavailable");
    assert.match(result.content, /not started/u);
  } finally {
    await harness.cleanup();
  }
});

test("process approval timeout fails closed and records no launch", async () => {
  const harness = await createHarness();
  try {
    const workspace = await Workspace.open(harness.root, { maxFileBytes: 64 * 1024, maxDirectoryEntries: 50 });
    const events: string[] = [];
    const registry = new ToolRegistry(workspace, 8_192, { policy: harness.policy, runner: { run: async () => { throw new Error("runner must not be called"); } } });
    const result = await registry.execute({
      callId: "process_approval_timeout",
      name: "run_command",
      argumentsJson: JSON.stringify({ command: process.execPath, args: ["-e", "process.exit(0)"] }),
    }, {
      approvalTimeoutMs: 10,
      approveProcess: async () => await new Promise(() => undefined),
      onProcess: (event) => { events.push(event.type); },
    });
    assert.equal(result.errorCode, "process-approval-unavailable");
    assert.deepEqual(events, ["prepared", "approval_decided"]);
  } finally {
    await harness.cleanup();
  }
});

test("approved cancellation before spawn is recorded as a terminal process outcome", async () => {
  const harness = await createHarness();
  try {
    const workspace = await Workspace.open(harness.root, { maxFileBytes: 64 * 1024, maxDirectoryEntries: 50 });
    const controller = new AbortController();
    controller.abort("cancelled");
    const events: string[] = [];
    const registry = new ToolRegistry(workspace, 8_192, {
      policy: harness.policy,
      runner: { run: async () => { throw new Error("runner must not be called"); } },
    });
    const result = await registry.execute({
      callId: "process_cancel_before_spawn",
      name: "run_command",
      argumentsJson: JSON.stringify({ command: process.execPath, args: ["-e", "process.exit(0)"] }),
    }, {
      signal: controller.signal,
      approveProcess: async () => ({ decision: "allow-once" }),
      onProcess: (event) => { events.push(event.type); },
    });
    assert.equal(result.errorCode, "process-cancelled");
    assert.deepEqual(events, ["prepared", "approval_decided", "completed"]);
    assert.match(result.content, /"status":"cancelled"/u);
  } finally {
    await harness.cleanup();
  }
});

test("runner failures become durable terminal process observations", async () => {
  const harness = await createHarness();
  try {
    const workspace = await Workspace.open(harness.root, { maxFileBytes: 64 * 1024, maxDirectoryEntries: 50 });
    const events: string[] = [];
    const registry = new ToolRegistry(workspace, 8_192, {
      policy: harness.policy,
      runner: { run: async () => { throw new Error("spawn unavailable"); } },
    });
    const result = await registry.execute({
      callId: "process_runner_failure",
      name: "run_command",
      argumentsJson: JSON.stringify({ command: process.execPath, args: ["-e", "process.exit(0)"] }),
    }, {
      approveProcess: async () => ({ decision: "allow-once" }),
      onProcess: (event) => { events.push(event.type); },
    });
    assert.equal(result.errorCode, "process-policy");
    assert.deepEqual(events, ["prepared", "approval_decided", "completed"]);
    assert.match(result.content, /spawn unavailable/u);
  } finally {
    await harness.cleanup();
  }
});

test("the per-turn process call limit fails closed before preparation", async () => {
  const harness = await createHarness();
  try {
    const workspace = await Workspace.open(harness.root, { maxFileBytes: 64 * 1024, maxDirectoryEntries: 50 });
    const registry = new ToolRegistry(workspace, 8_192, { policy: harness.policy, runner: { run: async () => { throw new Error("runner must not be called"); } } });
    const result = await registry.execute({
      callId: "process_limit",
      name: "run_command",
      argumentsJson: JSON.stringify({ command: process.execPath, args: ["-e", "process.exit(0)"] }),
    }, { processCallLimitReached: true });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "process-policy");
    assert.match(result.content, /call limit/u);
  } finally {
    await harness.cleanup();
  }
});

test("model run persists bounded process evidence and returns the real result", async () => {
  const harness = await createHarness();
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-process-state-"));
  try {
    const config = loadConfig({
      stateDir,
      workspaceRoot: harness.root,
      processMode: "approval",
      processDurationMs: limits.timeoutMs,
      processTerminationGraceMs: limits.terminationGraceMs,
      processOutputBytes: limits.maxOutputBytes,
      processArgumentCount: limits.maxArgumentCount,
      processArgumentBytes: limits.maxArgumentBytes,
    }, {});
    const session = await SessionStore.open(stateDir);
    const result = await runTurn({
      session,
      provider: new DeterministicModelProvider("deterministic/process", {
        toolCall: {
          name: "run_command",
          argumentsJson: JSON.stringify({ command: process.execPath, args: ["-e", "process.stdout.write('persisted output')"] }),
          finalResponse: "The command completed.",
        },
      }),
      config,
      userPrompt: "Run the harmless process.",
      approveProcess: async () => ({ decision: "allow-once" }),
    });
    assert.equal(result.status, "completed");
    assert.equal(result.assistantText, "The command completed.");
    const executionDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId, "executions");
    const executionEntry = (await readdir(executionDirectory))[0];
    assert.ok(executionEntry);
    const records = await readFile(path.join(executionDirectory, executionEntry), "utf8");
    assert.match(records, /persisted output/u);
    assert.match(records, /"status":"completed"/u);
    assert.doesNotMatch(records, /OPENROUTER_API_KEY|must-not-be-inherited/u);
    const events = await readFile(path.join(executionDirectory, "..", "events.jsonl"), "utf8");
    assert.match(events, /ProcessPrepared/u);
    assert.match(events, /ProcessApprovalDecided/u);
    assert.match(events, /ProcessStarted/u);
    assert.match(events, /ProcessCompleted/u);
  } finally {
    await harness.cleanup();
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("restart reconciles an incomplete process without replaying it", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-process-recovery-"));
  try {
    const session = await SessionStore.open(stateDir);
    const turn = await session.admitTurn("Run the command", "deterministic", "deterministic/process");
    const base: ProcessExecutionRecord = {
      schemaVersion: 1,
      executionId: "execution_recovery",
      callId: "call_recovery",
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      command: process.execPath,
      displayArgs: ["-e", "process.exit(0)"],
      cwd: ".",
      executablePath: process.execPath,
      environmentProfile: "sanitized-default",
      environmentKeys: ["PATH"],
      limits,
      argvHash: "recovery-hash",
      status: "prepared",
      recordedAt: new Date().toISOString(),
    };
    await turn.writeProcess(base);
    await turn.writeProcess({ ...base, status: "approved", decision: "allow-once", recordedAt: new Date().toISOString() });
    await turn.writeProcess({ ...base, status: "running", decision: "allow-once", pid: 999999, startedAt: new Date().toISOString(), recordedAt: new Date().toISOString() });
    const recovered = await session.recoverInterruptedTurns();
    assert.equal(recovered[0]?.status, "interrupted");
    const records = await turn.readProcesses();
    assert.equal(records[0]?.status, "ambiguous");
    assert.equal(records[0]?.errorCode, "process-ambiguous");
    assert.match(records[0]?.errorMessage ?? "", /not replayed/u);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("process execution records preserve identity and one-way transitions", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-process-transition-"));
  try {
    const session = await SessionStore.open(stateDir);
    const turn = await session.admitTurn("record process", "deterministic", "deterministic/process");
    const base: ProcessExecutionRecord = {
      schemaVersion: 1,
      executionId: "execution_transition",
      callId: "call_transition",
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      command: process.execPath,
      displayArgs: ["-e", "process.exit(0)"],
      cwd: ".",
      executablePath: process.execPath,
      environmentProfile: "sanitized-default",
      environmentKeys: ["PATH"],
      limits,
      argvHash: "transition-hash",
      status: "prepared",
      recordedAt: new Date().toISOString(),
    };
    await turn.writeProcess(base);
    await assert.rejects(
      turn.writeProcess({ ...base, command: "other", status: "failed", errorCode: "process-policy", recordedAt: new Date().toISOString() }),
      /identity cannot change/u,
    );
    await turn.writeProcess({ ...base, status: "failed", errorCode: "process-policy", recordedAt: new Date().toISOString() });
    await assert.rejects(
      turn.writeProcess({ ...base, status: "running", recordedAt: new Date().toISOString() }),
      /cannot transition/u,
    );
    await turn.writeProcess({ ...base, status: "failed", errorCode: "process-policy", recordedAt: new Date().toISOString() });
    assert.equal((await turn.readProcesses())[0]?.status, "failed");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("restart closes prepared and approved processes without launching them", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-process-prelaunch-recovery-"));
  try {
    const session = await SessionStore.open(stateDir);
    const preparedTurn = await session.admitTurn("prepared process", "deterministic", "deterministic/process");
    const approvedTurn = await session.admitTurn("approved process", "deterministic", "deterministic/process");
    const record = (turnId: string, executionId: string): ProcessExecutionRecord => ({
      schemaVersion: 1,
      executionId,
      callId: executionId.replace("execution", "call"),
      sessionId: session.metadata.sessionId,
      turnId,
      command: process.execPath,
      displayArgs: ["-e", "process.exit(0)"],
      cwd: ".",
      executablePath: process.execPath,
      environmentProfile: "sanitized-default",
      environmentKeys: ["PATH"],
      limits,
      argvHash: executionId,
      status: "prepared",
      recordedAt: new Date().toISOString(),
    });
    const prepared = record(preparedTurn.turnId, "execution_prepared_recovery");
    await preparedTurn.writeProcess(prepared);
    const approved = record(approvedTurn.turnId, "execution_approved_recovery");
    await approvedTurn.writeProcess(approved);
    await approvedTurn.writeProcess({ ...approved, status: "approved", decision: "allow-once", recordedAt: new Date().toISOString() });

    const recoveredSession = await SessionStore.open(stateDir, session.metadata.sessionId);
    await recoveredSession.recoverInterruptedTurns();
    assert.equal((await preparedTurn.readProcesses())[0]?.errorCode, "process-approval-unavailable");
    assert.equal((await approvedTurn.readProcesses())[0]?.errorCode, "process-approval-unavailable");
    assert.equal((await preparedTurn.readProcesses())[0]?.status, "failed");
    assert.equal((await approvedTurn.readProcesses())[0]?.status, "failed");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
