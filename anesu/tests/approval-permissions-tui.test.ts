import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { loadConfig } from "../src/config/config.js";
import { ApprovalPrompt, type ApprovalPanel } from "../src/cli/approval.js";
import { TerminalUi } from "../src/cli/tui.js";
import type { CuaAuthorizationDecision, CuaAuthorizationRequestView } from "../src/browser/cua-authorization.js";
import { ProcessApprovalPermissions } from "../src/persistence/process-approval-permissions.js";
import { SessionStore } from "../src/persistence/session-store.js";
import type { ModelProvider } from "../src/models/provider.js";
import type { ProcessApprovalRequest, ProcessToolEvent } from "../src/process/process.js";
import type { ChatApplication, ComputerUiStatus } from "../src/runtime/application.js";
import type { ModelRequest, ModelStreamEvent, TurnEvent } from "../src/runtime/contracts.js";
import { runTurn } from "../src/runtime/turn.js";
import { asSessionId } from "../src/runtime/contracts.js";

function captureOutput(): { readonly output: Writable; readonly chunks: string[] } {
  const chunks: string[] = [];
  return {
    chunks,
    output: new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback(); } }),
  };
}

async function waitFor(predicate: () => boolean, description: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for ${description}.`);
}

async function waitForRuntime(predicate: () => boolean, description: string, diagnostic?: () => string): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for ${description}.${diagnostic ? `\n${diagnostic().slice(-3_000)}` : ""}`);
}

function request(identity: string): ProcessApprovalRequest {
  return {
    callId: "call_permission_tui",
    executionId: "execution_permission_tui",
    command: "/usr/bin/printf",
    args: ["hello"],
    displayArgs: ["hello"],
    cwd: ".",
    executablePath: "/usr/bin/printf",
    environmentProfile: "sanitized-default",
    environmentKeys: ["PATH"],
    limits: { timeoutMs: 10_000, terminationGraceMs: 500, maxOutputBytes: 4096, maxArgumentCount: 32, maxArgumentBytes: 8192 },
    argvHash: "a".repeat(64),
    permissionIdentity: identity,
    approvalTimeoutMs: 120_000,
    warning: "This runs a real local host process; the workspace is not an OS sandbox.",
  };
}

class ProcessPermissionProvider implements ModelProvider {
  readonly provider = "deterministic" as const;
  readonly model = "recording/process-permissions";
  private callCount = 0;

  async *stream(modelRequest: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const last = modelRequest.messages.at(-1);
    if (last?.role === "user") {
      this.callCount += 1;
      const changed = last.content === "run changed";
      const script = changed
        ? "process.stdout.write('changed-result')"
        : "process.stdout.write('stable-result')";
      yield {
        type: "tool_call",
        call: {
          callId: `recorded_process_${this.callCount}`,
          name: "run_command",
          argumentsJson: JSON.stringify({ command: process.execPath, args: ["-e", script] }),
        },
      };
      yield { type: "completed" };
      return;
    }
    yield { type: "text", text: "The process request finished." };
    yield { type: "completed", usage: { outputTokens: 5, totalTokens: 5 } };
  }
}

async function openProcessPermissionApplication(
  config: ReturnType<typeof loadConfig>,
  provider: ModelProvider,
  sessionId: string | undefined,
  processEvents: ProcessToolEvent[],
): Promise<ChatApplication> {
  const store = await SessionStore.open(config.stateDir, sessionId);
  const lock = await store.acquireLock();
  const processPermissions = new ProcessApprovalPermissions(
    config.stateDir,
    store.sessionDirectory,
    store.metadata.sessionId,
    store.metadata.profileId,
  );
  const computer: ComputerUiStatus = { enabled: false };
  return {
    sessionId: store.metadata.sessionId,
    modelLabel: provider.model,
    providerLabel: provider.model,
    providerName: provider.provider,
    workspaceRoot: config.workspaceRoot,
    evidenceDirectory: store.sessionDirectory,
    processPermissions,
    toolNames: ["run_command"],
    computer,
    readContextSnapshot: () => store.readLatestContextSnapshot(),
    recoverInterruptedTurns: () => store.recoverInterruptedTurns(),
    readTranscript: () => store.readTranscript(),
    runTurn: (userPrompt, signal, onText, onEvent, approveMutation, onMutation, approveProcess, onProcess) => runTurn({
      session: store,
      provider,
      config,
      userPrompt,
      signal,
      onText,
      onEvent,
      approveMutation,
      onMutation,
      approveProcess,
      onProcess: async (event) => {
        processEvents.push(event);
        await onProcess?.(event);
      },
    }),
    close: () => lock.release(),
  };
}

test("process approval picker offers once, conversation, and exact local permission with once selected", async () => {
  const chunks: string[] = [];
  const output = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback(); } });
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: (enabled: boolean) => void };
  input.isTTY = true;
  input.setRawMode = () => undefined;
  const panel: ApprovalPanel = { title: "Process", risk: "local-process", action: "printf", target: "/usr/bin/printf", scope: ".", preview: "safe" };
  const prompt = new ApprovalPrompt({ output, colour: false });
  const pending = prompt.ask(panel, {
    question: () => undefined,
    rawInput: input,
    allowConversation: true,
    allowLocalLabel: "Always allow this exact command here",
  });

  assert.match(chunks.join(""), /1\. Approve once \(selected · default\)/u);
  assert.match(chunks.join(""), /2\. Approve for this conversation/u);
  assert.match(chunks.join(""), /3\. Always allow this exact command here/u);
  assert.match(chunks.join(""), /4\. Deny/u);
  input.write("\u001b[B\u001b[B\r");
  assert.deepEqual(await pending, { decision: "allow-local" });
});

test("TUI saves, reuses, and revokes an exact conversation process permission", { timeout: 5_000 }, async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "anesu-permission-tui-"));
  const sessionId = "session_tui_permission";
  const sessionDirectory = path.join(stateDir, "sessions", sessionId);
  await mkdir(sessionDirectory, { recursive: true });
  t.after(async () => await rm(stateDir, { recursive: true, force: true }));
  const permissions = new ProcessApprovalPermissions(stateDir, sessionDirectory, sessionId, "default");
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: (enabled: boolean) => void };
  input.isTTY = true;
  input.setRawMode = () => undefined;
  const { output, chunks } = captureOutput();
  const decisions: string[] = [];
  let callNumber = 0;
  const processRequest = request("b".repeat(64));
  const application = {
    sessionId,
    modelLabel: "test/model",
    providerLabel: "test/model",
    providerName: "deterministic",
    workspaceRoot: "/workspace",
    evidenceDirectory: sessionDirectory,
    toolNames: ["run_command"],
    computer: { enabled: false },
    processPermissions: permissions,
    readContextSnapshot: async () => undefined,
    readTranscript: async () => [],
    recoverInterruptedTurns: async () => [],
    runTurn: async (...args: unknown[]) => {
      callNumber += 1;
      const approve = args[6] as ((request: ProcessApprovalRequest) => Promise<{ readonly decision: string }>) | undefined;
      const onProcess = args[7] as ((event: ProcessToolEvent) => void) | undefined;
      onProcess?.({ type: "prepared", request: processRequest });
      const result = approve ? await approve(processRequest) : { decision: "unavailable" };
      decisions.push(result.decision);
      onProcess?.({ type: "approval_decided", request: processRequest, decision: result as never });
      return {
        schemaVersion: 1,
        sessionId: asSessionId(sessionId),
        turnId: `turn_${callNumber}` as never,
        status: "completed",
        provider: "deterministic",
        model: "test/model",
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(1).toISOString(),
        assistantText: "done",
      };
    },
    close: async () => undefined,
  } as unknown as ChatApplication;
  const ui = new TerminalUi(application, output, true);
  const running = ui.runInteractive(input);

  input.write("run exact\n");
  await waitFor(() => chunks.join("").includes("Choose an action"), "first process approval");
  input.write("\u001b[B\r");
  await waitFor(() => chunks.join("").includes("permission saved for this conversation"), "saved conversation grant");
  const saved = (await permissions.list()).find((grant) => grant.scope === "conversation");
  assert.ok(saved);

  input.write("run exact\n");
  await waitFor(() => callNumber === 2, "matching request reuse");
  await waitFor(() => chunks.join("").includes(`allowed by conversation permission ${saved.id}`), "saved grant activity");
  assert.deepEqual(decisions, ["allow-once", "allow-once"]);

  input.write("/permissions\n");
  await waitFor(() => chunks.join("").includes(saved.id), "permission listing");
  input.write(`/permissions revoke ${saved.id}\n`);
  await waitFor(() => chunks.join("").includes(`Revoked saved process permission ${saved.id}`), "permission revocation");

  const thirdPromptStart = chunks.join("").length;
  input.write("run exact\n");
  await waitFor(() => chunks.join("").slice(thirdPromptStart).includes("Choose an action"), "fresh approval after revocation");
  input.write("\u001b[B\u001b[B\u001b[B\r");
  await waitFor(() => decisions.length === 3, "denied post-revocation request");
  assert.equal(decisions[2], "deny");

  input.end("/permissions\n/quit\n");
  await running;
  await ui.close();
  assert.match(chunks.join(""), /No saved process permissions/u);
});

test("real TUI/runtime process grants survive restart and require a fresh decision for changed arguments", { timeout: 45_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-process-permission-runtime-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const config = loadConfig({
    stateDir: path.join(root, "state"),
    workspaceRoot: root,
    browserEnabled: false,
    computerEnabled: false,
    memoryEnabled: false,
    processMode: "approval",
  }, {});
  const provider = new ProcessPermissionProvider();
  const processEvents: ProcessToolEvent[] = [];
  const firstApplication = await openProcessPermissionApplication(config, provider, undefined, processEvents);
  const sessionId = firstApplication.sessionId;
  const firstInput = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: (enabled: boolean) => void };
  firstInput.isTTY = true;
  firstInput.setRawMode = () => undefined;
  const firstOutput = captureOutput();
  const firstUi = new TerminalUi(firstApplication, firstOutput.output, true);
  const firstRun = firstUi.runInteractive(firstInput);

  firstInput.write("run stable\n");
  await waitForRuntime(() => firstOutput.chunks.join("").includes("Choose an action"), "local process approval");
  assert.match(firstOutput.chunks.join(""), /Approve once \(selected · default\)/u);
  firstInput.write("\u001b[B\u001b[B\r");
  await waitForRuntime(() => firstOutput.chunks.join("").includes("permission saved for this local profile"), "local permission save");
  await waitForRuntime(() => firstOutput.chunks.join("").includes("stable-result"), "approved process completion");
  firstInput.end("/quit\n");
  await firstRun;
  await firstUi.close();

  const restartedEvents: ProcessToolEvent[] = [];
  const restartedApplication = await openProcessPermissionApplication(config, provider, sessionId, restartedEvents);
  const restartedInput = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: (enabled: boolean) => void };
  restartedInput.isTTY = true;
  restartedInput.setRawMode = () => undefined;
  const restartedOutput = captureOutput();
  const restartedUi = new TerminalUi(restartedApplication, restartedOutput.output, true);
  const restartedRun = restartedUi.runInteractive(restartedInput);

  restartedInput.write("run stable\n");
  await waitForRuntime(() => restartedOutput.chunks.join("").includes("allowed by local profile permission"), "persisted local permission reuse after restart");
  await waitForRuntime(() => restartedOutput.chunks.join("").includes("stable-result"), "restarted process completion");
  assert.doesNotMatch(restartedOutput.chunks.join(""), /Choose an action/u);

  const changeStart = restartedOutput.chunks.join("").length;
  restartedInput.write("run changed\n");
  await waitForRuntime(() => restartedOutput.chunks.join("").slice(changeStart).includes("Choose an action"), "approval after argv mismatch");
  restartedInput.write("\u001b[B\u001b[B\u001b[B\r");
  await waitForRuntime(() => restartedOutput.chunks.join("").slice(changeStart).includes("Command denied; the process was not started."), "denial after argv mismatch");
  assert.equal(restartedEvents.some((event) => event.type === "started" && event.request.args.includes("process.stdout.write('changed-result')")), false);
  assert.doesNotMatch(restartedOutput.chunks.join("").slice(changeStart), /command output · changed-result/u);

  const localPermission = (await restartedApplication.processPermissions!.list()).find((grant) => grant.scope === "local");
  assert.ok(localPermission);
  restartedInput.write(`/permissions revoke ${localPermission.id}\n`);
  await waitForRuntime(() => restartedOutput.chunks.join("").includes(`Revoked saved process permission ${localPermission.id}`), "local permission revocation");
  const afterRevokeStart = restartedOutput.chunks.join("").length;
  restartedInput.write("run stable\n");
  await waitForRuntime(() => restartedOutput.chunks.join("").slice(afterRevokeStart).includes("Choose an action"), "approval after revocation");
  restartedInput.write("\u001b[B\u001b[B\u001b[B\r");
  await waitForRuntime(() => restartedOutput.chunks.join("").slice(afterRevokeStart).includes("Command denied; the process was not started."), "post-revocation denial");

  const permissionsFile = path.join(config.stateDir, "permissions", "default", "process.json");
  await writeFile(permissionsFile, "not-json", "utf8");
  const corruptStoreStart = restartedOutput.chunks.join("").length;
  const startedBeforeCorruptStore = restartedEvents.filter((event) => event.type === "started").length;
  restartedInput.write("run stable\n");
  await waitForRuntime(() => restartedOutput.chunks.join("").slice(corruptStoreStart).includes("Saved permission check failed; the command was not started"), "fail-closed corrupt permission store", () => restartedOutput.chunks.join(""));
  assert.equal(restartedEvents.filter((event) => event.type === "started").length, startedBeforeCorruptStore);

  restartedInput.end("/quit\n");
  await restartedRun;
  await restartedUi.close();
});

test("TUI denial of an existing-profile request is returned to the Cua authorization callback", { timeout: 5_000 }, async () => {
  const sessionId = "session_existing_profile_tui";
  const sessionDirectory = "/tmp/anesu-existing-profile-tui";
  const request: CuaAuthorizationRequestView = {
    schema: "cua.authorization.v1",
    requestDigest: "a".repeat(64),
    adapterId: "browser",
    riskClass: "existing_profile",
    publicSession: "browser_existing_profile_tui",
    humanSummary: "Attach to the explicitly approved browser profile.",
    expiresUnixMs: 2_000,
    resourceDigest: "b".repeat(64),
    taskGrantHash: "c".repeat(64),
  };
  const decisions: CuaAuthorizationDecision[] = [];
  let attachmentAttempts = 0;
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: (enabled: boolean) => void };
  input.isTTY = true;
  input.setRawMode = () => undefined;
  const { output, chunks } = captureOutput();
  const application = {
    sessionId,
    modelLabel: "test/model",
    providerLabel: "test/model",
    providerName: "deterministic",
    workspaceRoot: "/workspace",
    evidenceDirectory: sessionDirectory,
    toolNames: ["computer"],
    runTurn: async (...args: unknown[]) => {
      const authorize = args[17] as ((value: CuaAuthorizationRequestView) => Promise<CuaAuthorizationDecision>) | undefined;
      const decision = authorize ? await authorize(request) : "cancel";
      decisions.push(decision);
      if (decision === "allow") attachmentAttempts += 1;
      return {
        schemaVersion: 1,
        sessionId: asSessionId(sessionId),
        turnId: "turn_existing_profile_tui" as never,
        status: "completed",
        provider: "deterministic",
        model: "test/model",
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(1).toISOString(),
        assistantText: decision === "deny" ? "The profile was not attached." : "The request was cancelled.",
      };
    },
    close: async () => undefined,
  } as unknown as ChatApplication;
  const ui = new TerminalUi(application, output, true);
  const running = ui.runInteractive(input);
  input.write("Use my existing browser profile.\n");
  await waitFor(() => chunks.join("").includes("Approve existing browser profile"), "existing-profile approval panel");
  assert.match(chunks.join(""), /Attach to the explicitly approved browser profile/u);
  assert.match(chunks.join(""), /Approve once \(selected · default\)/u);
  assert.match(chunks.join(""), /Deny/u);
  input.write("\u001b[B\r");
  await waitFor(() => decisions.length === 1, "Cua authorization decision");
  assert.deepEqual(decisions, ["deny"]);
  assert.equal(attachmentAttempts, 0, "a denied profile authorization must not reach attachment");
  assert.match(chunks.join(""), /no personal browser state was attached/u);
  input.end("/quit\n");
  await running;
  await ui.close();
});
