import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { LocalProcessRunner } from "../src/process/local-runner.js";
import { readProcessIdentity, reconcileRunningProcess } from "../src/process/recovery.js";
import type { ProcessLimits } from "../src/process/process.js";
import type { ProcessExecutionRecord } from "../src/process/process.js";
import { ProcessSecurityPolicy } from "../src/security/process-policy.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { Workspace } from "../src/workspace/workspace.js";
import { loadConfig } from "../src/config/config.js";
import { DeterministicModelProvider } from "../src/models/deterministic.js";
import { SessionStore } from "../src/persistence/session-store.js";
import { runTurn } from "../src/runtime/turn.js";
import { atomicWriteJson } from "../src/persistence/json.js";

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

test("a launch-record acknowledgement failure terminates the spawned child", async () => {
  const harness = await createHarness();
  try {
    const prepared = await harness.policy.prepare({
      command: process.execPath,
      args: ["-e", "setTimeout(() => require('node:fs').writeFileSync('launch-failure-marker.txt', 'ran'), 300)"],
    }, "execution_launch_ack_failure");
    const runner = new LocalProcessRunner((value) => harness.policy.verify(value));
    await assert.rejects(
      () => runner.run(prepared, undefined, async (event) => {
        if (event.type === "started") throw new Error("simulated launch record acknowledgement failure");
      }),
      /simulated launch record acknowledgement failure/u,
    );
    await new Promise((resolve) => setTimeout(resolve, 450));
    await assert.rejects(() => readFile(path.join(harness.root, "launch-failure-marker.txt"), "utf8"), { code: "ENOENT" });
  } finally {
    await harness.cleanup();
  }
});

test("an asynchronous output acknowledgement failure is surfaced and terminates the child", async () => {
  const harness = await createHarness();
  try {
    const prepared = await harness.policy.prepare({
      command: process.execPath,
      args: ["-e", "process.stdout.write('output'); setTimeout(() => require('node:fs').writeFileSync('output-ack-failure-marker.txt', 'ran'), 300)"],
    }, "execution_output_ack_failure");
    const runner = new LocalProcessRunner((value) => harness.policy.verify(value));
    await assert.rejects(
      () => runner.run(prepared, undefined, async (event) => {
        if (event.type === "output") throw new Error("simulated output acknowledgement failure");
      }),
      /simulated output acknowledgement failure/u,
    );
    await new Promise((resolve) => setTimeout(resolve, 450));
    await assert.rejects(() => readFile(path.join(harness.root, "output-ack-failure-marker.txt"), "utf8"), { code: "ENOENT" });
  } finally {
    await harness.cleanup();
  }
});

test("a termination acknowledgement failure is surfaced after the child is stopped", async () => {
  const harness = await createHarness();
  try {
    const prepared = await harness.policy.prepare({
      command: process.execPath,
      args: ["-e", "setTimeout(() => require('node:fs').writeFileSync('termination-ack-failure-marker.txt', 'ran'), 300)"],
      timeoutMs: 25,
    }, "execution_termination_ack_failure");
    const runner = new LocalProcessRunner((value) => harness.policy.verify(value));
    await assert.rejects(
      () => runner.run(prepared, undefined, async (event) => {
        if (event.type === "terminating") throw new Error("simulated termination acknowledgement failure");
      }),
      /simulated termination acknowledgement failure/u,
    );
    await new Promise((resolve) => setTimeout(resolve, 450));
    await assert.rejects(() => readFile(path.join(harness.root, "termination-ack-failure-marker.txt"), "utf8"), { code: "ENOENT" });
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
        assert.equal(request.approvalTimeoutMs, 120_000);
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
    assert.deepEqual(events, ["prepared", "approval_decided", "completed"]);
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
    assert.match(records, /"approvalTimeoutMs":120000/u);
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

test("model run persists a terminal process outcome when approval is denied", async () => {
  const harness = await createHarness();
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-process-denial-state-"));
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
      provider: new DeterministicModelProvider("deterministic/process-denied", {
        toolCall: {
          name: "run_command",
          argumentsJson: JSON.stringify({ command: process.execPath, args: ["-e", "process.exit(0)"] }),
          finalResponse: "The command was not run.",
        },
      }),
      config,
      userPrompt: "Run the command only if approved.",
      approveProcess: async () => ({ decision: "deny", reason: "not approved for this turn" }),
    });
    assert.equal(result.status, "completed");
    assert.equal(result.assistantText, "The command was not run.");

    const turnDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId);
    const events = await readFile(path.join(turnDirectory, "events.jsonl"), "utf8");
    assert.match(events, /ProcessPrepared/u);
    assert.match(events, /ProcessApprovalDecided/u);
    assert.match(events, /ProcessCompleted/u);
    assert.match(events, /"errorCode":"process-approval-denied"/u);
    assert.doesNotMatch(events, /ProcessStarted/u);

    const executionDirectory = path.join(turnDirectory, "executions");
    const executionEntry = (await readdir(executionDirectory))[0];
    assert.ok(executionEntry);
    const record = JSON.parse(await readFile(path.join(executionDirectory, executionEntry), "utf8")) as { status: string; errorCode?: string; correlationId?: string };
    assert.equal(record.status, "failed");
    assert.equal(record.errorCode, "process-approval-denied");
    assert.equal(record.correlationId, result.correlationId);
    const lifecycleEvents = events.trim().split("\n").map((line) => JSON.parse(line) as { correlationId?: string });
    assert.ok(lifecycleEvents.every((event) => event.correlationId === result.correlationId));
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

test("recovery rejects a malformed process record before interpreting its PID", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-process-malformed-record-"));
  try {
    const session = await SessionStore.open(stateDir);
    const turn = await session.admitTurn("malformed process", "deterministic", "deterministic/process");
    const base: ProcessExecutionRecord = {
      schemaVersion: 1,
      executionId: "execution_malformed",
      callId: "call_malformed",
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      command: process.execPath,
      displayArgs: ["-e", "process.exit(0)"],
      cwd: ".",
      executablePath: process.execPath,
      environmentProfile: "sanitized-default",
      environmentKeys: ["PATH"],
      limits,
      argvHash: "malformed-hash",
      status: "prepared",
      recordedAt: new Date().toISOString(),
    };
    await turn.writeProcess(base);
    await atomicWriteJson(path.join(turn.directory, "executions", "execution_malformed.json"), {
      ...base,
      status: "running",
      pid: "not-a-pid",
    });

    await assert.rejects(
      () => session.recoverInterruptedTurns(),
      /invalid durable record/u,
    );
    await atomicWriteJson(path.join(turn.directory, "executions", "execution_malformed.json"), {
      ...base,
      status: "failed",
      errorCode: "not-a-process-error",
    });
    await assert.rejects(
      () => session.recoverInterruptedTurns(),
      /invalid durable record/u,
    );
    assert.match(await readFile(path.join(turn.directory, "turn.json"), "utf8"), /"state":"submitting"/u);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("restart reconciles a running process after its durable record acknowledgement is lost", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-process-ack-recovery-"));
  try {
    let executionWrites = 0;
    const session = await SessionStore.open(stateDir, undefined, {
      writeHooks: {
        afterWrite: (operation, filePath) => {
          if (operation === "replace-json" && filePath.includes(`${path.sep}executions${path.sep}`) && executionWrites++ === 2) {
            throw new Error("simulated running process acknowledgement failure");
          }
        },
      },
    });
    const turn = await session.admitTurn("recover the process record", "deterministic", "deterministic/process");
    const base: ProcessExecutionRecord = {
      schemaVersion: 1,
      executionId: "execution_ack_recovery",
      callId: "call_ack_recovery",
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      command: process.execPath,
      displayArgs: ["-e", "process.exit(0)"],
      cwd: ".",
      executablePath: process.execPath,
      environmentProfile: "sanitized-default",
      environmentKeys: ["PATH"],
      limits,
      argvHash: "ack-recovery-hash",
      status: "prepared",
      recordedAt: new Date().toISOString(),
    };
    await turn.writeProcess(base);
    await turn.writeProcess({ ...base, status: "approved", decision: "allow-once", recordedAt: new Date().toISOString() });
    await assert.rejects(
      () => turn.writeProcess({ ...base, status: "running", decision: "allow-once", pid: 999999, startedAt: new Date().toISOString(), recordedAt: new Date().toISOString() }),
      /simulated running process acknowledgement failure/u,
    );

    const recoveredSession = await SessionStore.open(stateDir, session.metadata.sessionId);
    const firstRecovery = await recoveredSession.recoverInterruptedTurns();
    assert.equal(firstRecovery[0]?.status, "interrupted");
    assert.equal((await turn.readProcesses())[0]?.status, "ambiguous");
    assert.equal((await turn.readProcesses())[0]?.errorCode, "process-ambiguous");
    assert.match((await turn.readProcesses())[0]?.errorMessage ?? "", /not replayed/u);

    const secondRecovery = await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns();
    assert.deepEqual(secondRecovery, []);
    assert.equal((await turn.readProcesses())[0]?.status, "ambiguous");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("restart repairs missing process completion evidence from a durable terminal record", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-process-event-recovery-"));
  try {
    const session = await SessionStore.open(stateDir);
    const turn = await session.admitTurn("repair process evidence", "deterministic", "deterministic/process");
    await turn.updateState("streaming");
    const executionId = "execution_event_recovery";
    const callId = "call_event_recovery";
    await turn.appendEvent("TurnStarted");
    await turn.appendEvent("ProcessPrepared", { executionId, callId, command: process.execPath, cwd: "." });
    await turn.appendEvent("ProcessApprovalDecided", { executionId, callId, decision: "allow-once" });
    await turn.appendEvent("ProcessStarted", { executionId, callId, pid: 999999 });
    await turn.writeProcess({
      schemaVersion: 1,
      executionId,
      callId,
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      command: process.execPath,
      displayArgs: ["-e", "process.exit(0)"],
      cwd: ".",
      executablePath: process.execPath,
      environmentProfile: "sanitized-default",
      environmentKeys: ["PATH"],
      limits,
      argvHash: "event-recovery-hash",
      status: "completed",
      decision: "allow-once",
      pid: 999999,
      stdout: "done",
      stderr: "",
      stdoutBytes: 4,
      stderrBytes: 0,
      outputTruncated: false,
      durationMs: 10,
      exitCode: 0,
      signal: null,
      terminationConfirmed: true,
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(1).toISOString(),
      recordedAt: new Date(1).toISOString(),
    });

    await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns();
    const events = await turn.readEvents();
    assert.deepEqual(events.map((event) => event.type), [
      "TurnStarted",
      "ProcessPrepared",
      "ProcessApprovalDecided",
      "ProcessStarted",
      "ProcessCompleted",
      "TurnInterrupted",
    ]);
    assert.equal(events[4]?.payload.executionId, executionId);
    assert.equal(events[4]?.payload.status, "completed");
    assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns(), []);
    assert.equal((await turn.readEvents()).filter((event) => event.type === "ProcessCompleted").length, 1);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("restart repairs a missing process prelude before an already durable terminal event", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-process-prelude-recovery-"));
  try {
    const session = await SessionStore.open(stateDir);
    const turn = await session.admitTurn("repair process prelude", "deterministic", "deterministic/process");
    await turn.updateState("streaming");
    const executionId = "execution_prelude_recovery";
    const callId = "call_prelude_recovery";
    await turn.appendEvent("TurnStarted");
    await turn.writeProcess({
      schemaVersion: 1,
      executionId,
      callId,
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      command: process.execPath,
      displayArgs: ["-e", "process.exitCode = 1"],
      cwd: ".",
      executablePath: process.execPath,
      environmentProfile: "sanitized-default",
      environmentKeys: ["PATH"],
      limits,
      argvHash: "prelude-recovery-hash",
      status: "failed",
      decision: "allow-once",
      errorCode: "process-exit",
      errorMessage: "the terminal record was durable before its prelude acknowledgement",
      stdout: "",
      stderr: "",
      stdoutBytes: 0,
      stderrBytes: 0,
      outputTruncated: false,
      durationMs: 10,
      exitCode: 1,
      signal: null,
      terminationConfirmed: true,
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(1).toISOString(),
      recordedAt: new Date(1).toISOString(),
    });
    await turn.appendEvent("ProcessCompleted", {
      executionId,
      callId,
      status: "failed",
      errorCode: "process-exit",
      stdoutBytes: 0,
      stderrBytes: 0,
      recovered: true,
    });

    await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns();
    const events = await turn.readEvents();
    assert.deepEqual(events.map((event) => event.type), [
      "TurnStarted",
      "ProcessPrepared",
      "ProcessApprovalDecided",
      "ProcessCompleted",
      "TurnInterrupted",
    ]);
    assert.ok(events.filter((event) => event.type === "ProcessPrepared" || event.type === "ProcessApprovalDecided").every((event) => event.payload.recovered === true));
    assert.equal(events[3]?.payload.recovered, true);
    assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns(), []);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("restart repairs process evidence after a real side effect completes before acknowledgement", async () => {
  const harness = await createHarness();
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-process-side-effect-recovery-"));
  try {
    let executionWrites = 0;
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
    const session = await SessionStore.open(stateDir, undefined, {
      writeHooks: {
        afterWrite: (operation, filePath) => {
          if (operation === "replace-json" && filePath.includes(`${path.sep}executions${path.sep}`) && executionWrites++ === 3) {
            throw new Error("simulated completed process acknowledgement failure");
          }
        },
      },
    });
    const result = await runTurn({
      session,
      provider: new DeterministicModelProvider("deterministic/process", {
        toolCall: {
          name: "run_command",
          argumentsJson: JSON.stringify({ command: process.execPath, args: ["-e", "require('node:fs').writeFileSync('marker.txt', 'ran')"] }),
          finalResponse: "The command completed.",
        },
      }),
      config,
      userPrompt: "Run the marker command.",
      approveProcess: async () => ({ decision: "allow-once" }),
    });
    assert.equal(result.status, "completed");
    assert.equal(await readFile(path.join(harness.root, "marker.txt"), "utf8"), "ran");
    const executionDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId, "executions");
    const executionEntry = (await readdir(executionDirectory))[0];
    assert.ok(executionEntry);
    const processRecord = JSON.parse(await readFile(path.join(executionDirectory, executionEntry), "utf8")) as { status: string };
    assert.equal(processRecord.status, "completed");
    let recoveryAcknowledgements = 0;
    const recoverySession = await SessionStore.open(stateDir, result.sessionId, {
      writeHooks: {
        afterWrite: (operation, filePath) => {
          if (operation === "replace-json-lines" && filePath.endsWith(`${path.sep}events.jsonl`) && recoveryAcknowledgements++ === 0) {
            throw new Error("simulated repaired event acknowledgement failure");
          }
        },
      },
    });
    await assert.rejects(() => recoverySession.recoverInterruptedTurns(), /simulated repaired event acknowledgement failure/u);
    const recovered = await (await SessionStore.open(stateDir, result.sessionId)).recoverInterruptedTurns();
    assert.deepEqual(recovered, []);
    assert.equal(await readFile(path.join(harness.root, "marker.txt"), "utf8"), "ran");
    const events = await readFile(path.join(executionDirectory, "..", "events.jsonl"), "utf8");
    assert.equal((events.match(/ProcessCompleted/g) ?? []).length, 1);
    assert.deepEqual(await (await SessionStore.open(stateDir, result.sessionId)).recoverInterruptedTurns(), []);
    assert.equal(await readFile(path.join(harness.root, "marker.txt"), "utf8"), "ran");
  } finally {
    await harness.cleanup();
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("a crashed process is recovered without replaying a completed side effect", async () => {
  const harness = await createHarness();
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-process-crash-harness-"));
  try {
    const moduleRoot = path.resolve(process.cwd(), "dist", "src");
    const importUrl = (relativePath: string): string => pathToFileURL(path.join(moduleRoot, relativePath)).href;
    const childScript = `
      const { SessionStore } = await import(${JSON.stringify(importUrl("persistence/session-store.js"))});
      const { DeterministicModelProvider } = await import(${JSON.stringify(importUrl("models/deterministic.js"))});
      const { loadConfig } = await import(${JSON.stringify(importUrl("config/config.js"))});
      const { runTurn } = await import(${JSON.stringify(importUrl("runtime/turn.js"))});
      const { sep } = await import("node:path");
      const stateDir = process.env.COMPUTER_NATIVE_CRASH_STATE;
      const workspaceRoot = process.env.COMPUTER_NATIVE_CRASH_WORKSPACE;
      if (!stateDir || !workspaceRoot) process.exit(2);
      let executionWrites = 0;
      const session = await SessionStore.open(stateDir, undefined, {
        writeHooks: {
          afterWrite: (operation, filePath) => {
            if (operation === "replace-json" && filePath.includes(sep + "executions" + sep) && executionWrites++ === 3) process.exit(42);
          },
        },
      });
      const config = loadConfig({
        stateDir,
        workspaceRoot,
        processMode: "approval",
        processDurationMs: 500,
        processTerminationGraceMs: 100,
        processOutputBytes: 4096,
        processArgumentCount: 16,
        processArgumentBytes: 4096,
      }, {});
      await runTurn({
        session,
        provider: new DeterministicModelProvider("deterministic/process", {
          toolCall: {
            name: "run_command",
            argumentsJson: JSON.stringify({ command: process.execPath, args: ["-e", "require('node:fs').appendFileSync('marker.txt', 'ran\\\\n')"] }),
            finalResponse: "The command completed.",
          },
        }),
        config,
        userPrompt: "Run the marker command.",
        approveProcess: async () => ({ decision: "allow-once" }),
      });
    `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", childScript], {
      env: {
        ...process.env,
        COMPUTER_NATIVE_CRASH_STATE: stateDir,
        COMPUTER_NATIVE_CRASH_WORKSPACE: harness.root,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let childStderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { childStderr += chunk.toString("utf8"); });
    const childExit = await new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    assert.equal(childExit.code, 42, childStderr);
    assert.equal(childExit.signal, null);
    assert.equal(await readFile(path.join(harness.root, "marker.txt"), "utf8"), "ran\n");

    const sessionId = (await readdir(path.join(stateDir, "sessions"))).find((entry) => entry !== ".lock");
    assert.ok(sessionId);
    const restarted = await SessionStore.open(stateDir, sessionId);
    const transcript = await restarted.readTranscript();
    const turnId = transcript[0]?.turnId;
    assert.ok(turnId);
    const recovered = await restarted.recoverInterruptedTurns(undefined, reconcileRunningProcess);
    assert.equal(recovered[0]?.status, "interrupted");
    assert.equal(await readFile(path.join(harness.root, "marker.txt"), "utf8"), "ran\n");

    const turnDirectory = path.join(stateDir, "sessions", sessionId, "turns", turnId);
    const events = (await readFile(path.join(turnDirectory, "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { type: string; sequence: number });
    assert.equal(events.filter((event) => event.type === "ProcessCompleted").length, 1);
    assert.equal(events.at(-1)?.type, "TurnInterrupted");
    assert.deepEqual(events.map((event) => event.sequence), events.map((_, index) => index + 1));

    assert.deepEqual(await (await SessionStore.open(stateDir, sessionId)).recoverInterruptedTurns(undefined, reconcileRunningProcess), []);
    assert.equal(await readFile(path.join(harness.root, "marker.txt"), "utf8"), "ran\n");
  } finally {
    await harness.cleanup();
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("recovery terminates a still-running child without replaying it", { skip: process.platform !== "linux" }, async () => {
  const harness = await createHarness();
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-process-orphan-recovery-"));
  try {
    const moduleRoot = path.resolve(process.cwd(), "dist", "src");
    const importUrl = (relativePath: string): string => pathToFileURL(path.join(moduleRoot, relativePath)).href;
    const childScript = `
      const { SessionStore } = await import(${JSON.stringify(importUrl("persistence/session-store.js"))});
      const { DeterministicModelProvider } = await import(${JSON.stringify(importUrl("models/deterministic.js"))});
      const { loadConfig } = await import(${JSON.stringify(importUrl("config/config.js"))});
      const { runTurn } = await import(${JSON.stringify(importUrl("runtime/turn.js"))});
      const { sep } = await import("node:path");
      const stateDir = process.env.COMPUTER_NATIVE_CRASH_STATE;
      const workspaceRoot = process.env.COMPUTER_NATIVE_CRASH_WORKSPACE;
      if (!stateDir || !workspaceRoot) process.exit(2);
      let executionWrites = 0;
      const session = await SessionStore.open(stateDir, undefined, {
        writeHooks: {
          afterWrite: (operation, filePath) => {
            if (operation === "replace-json" && filePath.includes(sep + "executions" + sep) && executionWrites++ === 2) process.exit(43);
          },
        },
      });
      const config = loadConfig({
        stateDir,
        workspaceRoot,
        processMode: "approval",
        processDurationMs: 5_000,
        processTerminationGraceMs: 100,
        processOutputBytes: 4096,
        processArgumentCount: 16,
        processArgumentBytes: 4096,
      }, {});
      await runTurn({
        session,
        provider: new DeterministicModelProvider("deterministic/process", {
          toolCall: {
            name: "run_command",
            argumentsJson: JSON.stringify({ command: process.execPath, args: ["-e", "setTimeout(() => require('node:fs').appendFileSync('marker.txt', 'ran\\\\n'), 500)"] }),
            finalResponse: "The command completed.",
          },
        }),
        config,
        userPrompt: "Run the delayed marker command.",
        approveProcess: async () => ({ decision: "allow-once" }),
      });
    `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", childScript], {
      env: {
        ...process.env,
        COMPUTER_NATIVE_CRASH_STATE: stateDir,
        COMPUTER_NATIVE_CRASH_WORKSPACE: harness.root,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let childStderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { childStderr += chunk.toString("utf8"); });
    const childExit = await new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    assert.equal(childExit.code, 43, childStderr);
    assert.equal(childExit.signal, null);

    const sessionId = (await readdir(path.join(stateDir, "sessions"))).find((entry) => entry !== ".lock");
    assert.ok(sessionId);
    const restarted = await SessionStore.open(stateDir, sessionId);
    const transcript = await restarted.readTranscript();
    const turnId = transcript[0]?.turnId;
    assert.ok(turnId);
    const recovered = await restarted.recoverInterruptedTurns(undefined, reconcileRunningProcess);
    assert.equal(recovered[0]?.status, "interrupted");
    const turnDirectory = path.join(stateDir, "sessions", sessionId, "turns", turnId);
    const executionEntry = (await readdir(path.join(turnDirectory, "executions")))[0];
    assert.ok(executionEntry);
    const processRecord = JSON.parse(await readFile(path.join(turnDirectory, "executions", executionEntry), "utf8")) as ProcessExecutionRecord;
    assert.ok(processRecord.processIdentity);
    await new Promise((resolve) => setTimeout(resolve, 650));
    await assert.rejects(() => readFile(path.join(harness.root, "marker.txt"), "utf8"), { code: "ENOENT" }, JSON.stringify(processRecord));

    assert.equal(processRecord.status, "ambiguous");
    assert.equal(processRecord.terminationConfirmed, true);
    assert.match(processRecord.errorMessage ?? "", /termination was confirmed/u);
    assert.deepEqual(await (await SessionStore.open(stateDir, sessionId)).recoverInterruptedTurns(undefined, reconcileRunningProcess), []);
  } finally {
    await harness.cleanup();
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("process recovery fails closed when the persisted identity does not match the PID", { skip: process.platform !== "linux" }, async () => {
  const identity = await readProcessIdentity(process.pid);
  assert.ok(identity);
  const record: ProcessExecutionRecord = {
    schemaVersion: 1,
    executionId: "execution_pid_reuse",
    callId: "call_pid_reuse",
    sessionId: "session_pid_reuse",
    turnId: "turn_pid_reuse",
    command: process.execPath,
    displayArgs: ["-e", "setTimeout(() => {}, 1000)"],
    cwd: ".",
    executablePath: identity.executablePath,
    environmentProfile: "sanitized-default",
    environmentKeys: ["PATH"],
    limits,
    argvHash: "pid-reuse-hash",
    status: "running",
    decision: "allow-once",
    pid: process.pid,
    processIdentity: { ...identity, startTime: `${identity.startTime}:different` },
    startedAt: new Date().toISOString(),
    recordedAt: new Date().toISOString(),
  };
  const reconciled = await reconcileRunningProcess(record);
  assert.equal(reconciled.status, "ambiguous");
  assert.equal(reconciled.terminationConfirmed, false);
  assert.match(reconciled.errorMessage ?? "", /identity does not match/u);
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
      turn.writeProcess({ ...base, status: "running", pid: 1, startedAt: new Date().toISOString(), recordedAt: new Date().toISOString() }),
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

test("restart repairs a missing first process lifecycle event", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-process-first-event-recovery-"));
  try {
    const session = await SessionStore.open(stateDir);
    const turn = await session.admitTurn("recover the process evidence", "deterministic", "deterministic/process");
    await turn.updateState("streaming");
    await turn.appendEvent("TurnStarted");
    await turn.writeProcess({
      schemaVersion: 1,
      executionId: "execution_first_event_recovery",
      callId: "call_first_event_recovery",
      sessionId: session.metadata.sessionId,
      turnId: turn.turnId,
      command: process.execPath,
      displayArgs: ["-e", "process.exit(0)"],
      cwd: ".",
      executablePath: process.execPath,
      environmentProfile: "sanitized-default",
      environmentKeys: ["PATH"],
      limits,
      argvHash: "first-event-recovery-hash",
      status: "prepared",
      recordedAt: new Date().toISOString(),
    });

    const restarted = await SessionStore.open(stateDir, session.metadata.sessionId);
    assert.equal((await restarted.recoverInterruptedTurns())[0]?.status, "interrupted");
    const record = (await turn.readProcesses())[0];
    assert.equal(record?.status, "failed");
    assert.equal(record?.errorCode, "process-approval-unavailable");
    const events = await turn.readEvents();
    assert.deepEqual(events.map((event) => event.type), [
      "TurnStarted",
      "ProcessPrepared",
      "ProcessApprovalDecided",
      "ProcessCompleted",
      "TurnInterrupted",
    ]);
    assert.ok(events.filter((event) => event.type.startsWith("Process")).every((event) => event.payload.recovered === true));
    assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns(), []);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
