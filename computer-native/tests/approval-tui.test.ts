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
  identity: "mutation mutation_test",
  expiry: "120000ms from prompt",
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
  assert.match(rendered, /identity\s+mutation mutation_test/u);
  assert.match(rendered, /expires\s+120000ms from prompt/u);
  assert.match(rendered, /preview\s+--- a\/notes\.md/u);
  assert.match(rendered, /\[REDACTED\]/u);
  assert.doesNotMatch(rendered, /secret-value/u);
});

test("approval panel strips terminal controls from untrusted review values", () => {
  const rendered = renderApprovalPanel({
    ...panel,
    title: "Proposed\u001b[31m workspace change\u001b[0m",
    target: "notes\u001b[2J.md",
    preview: "diff\u001b]0;attacker title\u0007safe\u0001",
  }, { colour: false });

  assert.doesNotMatch(rendered, /\u001b|\u0001|\u0007/u);
  assert.match(rendered, /Proposed workspace change/u);
  assert.match(rendered, /notes\.md/u);
  assert.match(rendered, /diffsafe/u);
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

test("active Ctrl+C cancellation is idempotent and reaches a terminal result", { timeout: 2_000 }, async () => {
  const { output, chunks } = captureOutput();
  const application = {
    sessionId: "session_active_ctrl_c",
    modelLabel: "test/model",
    providerLabel: "test/model",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: [],
    runTurn: async (_message: string, signal?: AbortSignal) => new Promise((resolve) => {
      signal?.addEventListener("abort", () => resolve({ status: "cancelled" }), { once: true });
    }),
  } as unknown as ChatApplication;
  const ui = new TerminalUi(application, output, false);
  const running = ui.runTurn("cancel this turn");

  assert.equal(ui.cancelActiveTurn(), true);
  assert.equal(ui.cancelActiveTurn(), true);
  await running;

  const rendered = chunks.join("");
  assert.equal(rendered.match(/Cancelling current turn…/gu)?.length, 1);
  assert.match(rendered, /cancelled/u);
});

test("TUI distinguishes partial and outcome-unknown actions from ordinary failure", async () => {
  const { output, chunks } = captureOutput();
  const application = {
    sessionId: "session_outcome_states",
    modelLabel: "test/model",
    providerLabel: "test/model",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: ["apply_patch_set", "browser_click"],
    runTurn: async (...args: unknown[]) => {
      const onMutation = args[5] as ((event: unknown) => void) | undefined;
      const onBrowser = args[9] as ((event: unknown) => void) | undefined;
      onMutation?.({
        type: "failed",
        request: { path: "one.txt" },
        code: "reconciliation-required",
        reason: "one member committed and another member is still staged",
      });
      onBrowser?.({
        type: "completed",
        request: { action: "click" },
        ok: false,
        errorCode: "browser-ambiguous",
        summary: "the adapter stopped after dispatch",
      });
      return { status: "completed" };
    },
  } as unknown as ChatApplication;

  await new TerminalUi(application, output, false).runSingle("show outcomes");

  const rendered = chunks.join("");
  assert.match(rendered, /workspace change · partial\/uncertain · one\.txt/u);
  assert.match(rendered, /browser · click · outcome unknown/u);
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
