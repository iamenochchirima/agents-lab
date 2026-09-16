import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import {
  ApprovalPrompt,
  parseApprovalAction,
  renderApprovalPanel,
  type ApprovalPanel,
} from "../src/cli/approval.js";
import { TerminalUi } from "../src/cli/tui.js";
import type { ChatApplication } from "../src/runtime/application.js";

function captureOutput(): { readonly output: Writable; readonly chunks: string[] } {
  const chunks: string[] = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  return { output, chunks };
}

const panel: ApprovalPanel = {
  title: "Proposed workspace change",
  risk: "patch-file",
  action: "update",
  target: "notes.md",
  scope: "/tmp/workspace",
  preview: "--- a/notes.md\n+++ b/notes.md\n-old\n+new\nBearer secret-value",
  details: "The exact patch changes one line and writes atomically.",
  redactionSecrets: ["secret-value"],
};

test("approval actions are explicit and keep deny/cancel distinct", () => {
  assert.deepEqual(parseApprovalAction("a"), { kind: "approve-once" });
  assert.deepEqual(parseApprovalAction("y"), { kind: "approve-once" });
  assert.deepEqual(parseApprovalAction("d"), { kind: "deny" });
  assert.deepEqual(parseApprovalAction("v"), { kind: "details" });
  assert.deepEqual(parseApprovalAction("\u001b"), { kind: "cancel" });
  assert.deepEqual(parseApprovalAction("cancel"), { kind: "cancel" });
  assert.deepEqual(parseApprovalAction("unexpected"), { kind: "deny" });
});

test("approval panel renders the required context and redacts secrets", () => {
  const rendered = renderApprovalPanel(panel, { colour: false });

  assert.match(rendered, /risk\s+patch-file/u);
  assert.match(rendered, /action\s+update/u);
  assert.match(rendered, /target\s+notes\.md/u);
  assert.match(rendered, /scope\s+\/tmp\/workspace/u);
  assert.match(rendered, /preview\s+--- a\/notes\.md/u);
  assert.match(rendered, /\[REDACTED\]/u);
  assert.doesNotMatch(rendered, /secret-value/u);
});

test("approval prompt supports details and line-input fallback", async () => {
  const { output, chunks } = captureOutput();
  const answers = ["v", "a"];
  const prompts: string[] = [];
  const prompt = new ApprovalPrompt({ output, colour: false });

  const result = await prompt.ask(panel, {
    question: (value, callback) => {
      prompts.push(value);
      callback(answers.shift() ?? "d");
    },
  });

  assert.deepEqual(result, { decision: "allow-once" });
  assert.equal(prompts.length, 2);
  const rendered = chunks.join("");
  assert.match(rendered, /The exact patch changes one line/u);
  assert.match(rendered, /\[a\] approve once/u);
  assert.match(rendered, /\[d\] deny/u);
  assert.match(rendered, /Esc cancel/u);
});

test("approval prompt turns Escape into a cancelled safe result", async () => {
  const { output } = captureOutput();
  const prompt = new ApprovalPrompt({ output, colour: false });

  const result = await prompt.ask(panel, {
    question: (_value, callback) => callback("\u001b"),
  });

  assert.deepEqual(result, {
    decision: "unavailable",
    reason: "The approval prompt was cancelled before the operation started.",
  });
});

test("approval prompt supports raw-terminal navigation with a safe deny default", async () => {
  const { output, chunks } = captureOutput();
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: (enabled: boolean) => void };
  input.isTTY = true;
  input.setRawMode = () => undefined;
  const prompt = new ApprovalPrompt({ output, colour: false });
  const pending = prompt.ask(panel, {
    question: () => undefined,
    rawInput: input,
  });
  input.write("v");
  input.write("\u001b[A");
  input.write("\r");
  assert.deepEqual(await pending, { decision: "allow-once" });
  const rendered = chunks.join("");
  assert.match(rendered, /arrows\/j\/k move/u);
  assert.match(rendered, /The exact patch changes one line/u);
});

test("idle Ctrl+C closes the interactive TUI", { timeout: 2_000 }, async () => {
  const input = new PassThrough();
  const { output, chunks } = captureOutput();
  const application = {
    sessionId: "session_ctrl_c",
    modelLabel: "test/model",
    providerLabel: "test/model",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: [],
    recoverInterruptedTurns: async () => [],
    readTranscript: async () => [],
    runTurn: async () => {
      throw new Error("idle Ctrl+C must not start a turn");
    },
    close: async () => undefined,
  } as unknown as ChatApplication;

  const running = new TerminalUi(application, output, true).runInteractive(input);
  setTimeout(() => input.write("\u0003"), 10);
  await running;

  const rendered = chunks.join("").replace(/\u001b\[[0-9;]*m/gu, "");
  assert.match(rendered, /Session closed\./u);
  assert.doesNotMatch(rendered, /Nothing is running/u);
});

test("TUI renders one terminal activity line for a mixed memory batch", async () => {
  const chunks: string[] = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const application = {
    sessionId: "session_memory_batch_ui",
    modelLabel: "deterministic/memory-batch",
    providerLabel: "deterministic/deterministic/memory-batch",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: ["memory"],
    runTurn: async (
      _message: string,
      _signal: AbortSignal | undefined,
      _onText: ((text: string) => void) | undefined,
      _onEvent: ((event: unknown) => void) | undefined,
      _approveMutation: unknown,
      _onMutation: unknown,
      _approveProcess: unknown,
      _onProcess: unknown,
      _approveBrowser: unknown,
      _onBrowser: unknown,
      _approveMemory: unknown,
      onMemory: ((event: unknown) => void) | undefined,
    ) => {
      onMemory?.({
        type: "batch_committed",
        request: {
          operationId: "memory_batch_ui",
          callId: "memory_batch_call_ui",
          operation: "batch",
          scope: "workspace",
          sourcePath: "/tmp/state/memory/MEMORY.md",
          contentPreview: "two changes",
          risk: "batch",
          batch: [],
        },
        results: [
          { operation: "add", recordId: "memory_one" },
          { operation: "remove", recordId: "memory_two" },
        ],
      });
      return { status: "completed" };
    },
  } as unknown as ChatApplication;

  await new TerminalUi(application, output, false).runSingle("apply memory batch");

  assert.match(chunks.join(""), /memory · batch committed · 2 changes/u);
});
