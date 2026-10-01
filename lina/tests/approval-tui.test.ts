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
  assert.deepEqual(parseApprovalAction("t"), { kind: "approve-task" });
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

test("approval prompt visibly selects the first action and supports raw-terminal arrow navigation", async () => {
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
  input.write("\u001b[B");
  input.write("\u001b[A");
  input.write("\r");
  assert.deepEqual(await pending, { decision: "allow-once" });
  const rendered = chunks.join("");
  assert.match(rendered, /❯ 1\. Approve once \(selected · default\)/u);
  assert.match(rendered, /❯ 2\. Deny \(selected\)/u);
  assert.match(rendered, /↑\/↓ move · Enter confirm/u);
  assert.match(rendered, /The exact patch changes one line/u);
});

test("raw approval parses a split down-arrow and Enter confirms the highlighted denial", async () => {
  const { output, chunks } = captureOutput();
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: (enabled: boolean) => void };
  input.isTTY = true;
  input.setRawMode = () => undefined;
  const prompt = new ApprovalPrompt({ output, colour: false });
  const pending = prompt.ask(panel, {
    question: () => undefined,
    rawInput: input,
  });

  assert.match(chunks.join(""), /❯ 1\. Approve once \(selected · default\)/u);
  input.write("\u001b");
  await new Promise((resolve) => setTimeout(resolve, 10));
  input.write("[B");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(chunks.join(""), /❯ 2\. Deny \(selected\)/u);
  input.write("\r");

  assert.deepEqual(await pending, { decision: "deny", reason: "The user did not approve the proposed operation." });
});

test("raw approval ignores letter shortcuts and exposes bounded-task approval as a separate choice", async () => {
  const { output, chunks } = captureOutput();
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: (enabled: boolean) => void };
  input.isTTY = true;
  input.setRawMode = () => undefined;
  const prompt = new ApprovalPrompt({ output, colour: false });
  let settled = false;
  const pending = prompt.ask(panel, {
    question: () => undefined,
    rawInput: input,
    allowTask: true,
  }).then((result) => {
    settled = true;
    return result;
  });

  input.write("a");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(settled, false, "a single letter must not approve a TTY prompt");
  input.write("\u001b[B\r");

  assert.deepEqual(await pending, { decision: "allow-task" });
  assert.match(chunks.join(""), /2\. Approve this task \(selected\)/u);
});

test("a task-only approval names the grant accurately and defaults to the task", async () => {
  const { output, chunks } = captureOutput();
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: (enabled: boolean) => void };
  input.isTTY = true;
  input.setRawMode = () => undefined;
  const prompt = new ApprovalPrompt({ output, colour: false });
  const pending = prompt.ask(panel, {
    question: () => undefined,
    rawInput: input,
    taskOnly: true,
  });

  assert.match(chunks.join(""), /❯ 1\. Approve this task \(selected · default\)/u);
  assert.match(chunks.join(""), /2\. Deny/u);
  input.write("\r");

  assert.deepEqual(await pending, { decision: "allow-task" });
});

test("a browser task can offer a conversation grant through the shared approval menu", async () => {
  const { output, chunks } = captureOutput();
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: (enabled: boolean) => void };
  input.isTTY = true;
  input.setRawMode = () => undefined;
  const prompt = new ApprovalPrompt({ output, colour: false });
  const pending = prompt.ask(panel, {
    question: () => undefined,
    rawInput: input,
    taskOnly: true,
    allowConversation: true,
  });

  assert.match(chunks.join(""), /Approve this task \(selected · default\)/u);
  assert.match(chunks.join(""), /Approve for this conversation/u);
  input.write("\u001b[B\r");
  assert.deepEqual(await pending, { decision: "allow-conversation" });
});

test("task-only line-input approval explicitly requires the task choice", async () => {
  const { output } = captureOutput();
  const prompt = new ApprovalPrompt({ output, colour: false });

  const result = await prompt.ask(panel, {
    question: (_value, callback) => callback("t"),
    taskOnly: true,
  });

  assert.deepEqual(result, { decision: "allow-task" });
});

test("raw-terminal approval keeps the TTY readable when readline pause hooks are supplied", async () => {
  const { output } = captureOutput();
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: (enabled: boolean) => void };
  input.isTTY = true;
  input.setRawMode = () => undefined;
  const prompt = new ApprovalPrompt({ output, colour: false });
  const ownership: string[] = [];
  const pending = prompt.ask(panel, {
    question: () => undefined,
    rawInput: input,
    pauseRawInput: () => ownership.push("raw-start"),
    resumeRawInput: () => ownership.push("raw-end"),
  });
  input.write("\u001b[B\r");
  assert.deepEqual(await pending, { decision: "deny", reason: "The user did not approve the proposed operation." });
  assert.deepEqual(ownership, ["raw-start", "raw-end"]);
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

test("interactive Ctrl+C cancels the active turn and a second Ctrl+C exits", { timeout: 2_000 }, async () => {
  const input = new PassThrough();
  const chunks: string[] = [];
  let promptSent = false;
  let cancelSent = false;
  let exitSent = false;
  let cancellationObserved = false;
  let runCount = 0;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
      const rendered = chunks.join("");
      if (!promptSent && rendered.includes("❯ You ›")) {
        promptSent = true;
        queueMicrotask(() => input.write("work\n"));
      }
      if (promptSent && !cancelSent && rendered.includes("turn") && rendered.includes("starting model run")) {
        cancelSent = true;
        queueMicrotask(() => input.write("\u0003"));
      }
      if (cancellationObserved && !exitSent && rendered.includes("■ cancelled")) {
        exitSent = true;
        setTimeout(() => input.write("\u0003"), 10);
      }
    },
  });
  const application = {
    sessionId: "session_interactive_ctrl_c",
    modelLabel: "test/model",
    providerLabel: "test/model",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: [],
    recoverInterruptedTurns: async () => [],
    readTranscript: async () => [],
    runTurn: async (message: string, signal?: AbortSignal) => {
      runCount += 1;
      assert.equal(message, "work");
      return await new Promise((resolve) => {
        const cancel = () => {
          cancellationObserved = true;
          resolve({
            schemaVersion: 1,
            sessionId: "session_interactive_ctrl_c",
            turnId: "turn_interactive_ctrl_c",
            status: "cancelled",
            provider: "openrouter",
            model: "test/model",
            startedAt: new Date(0).toISOString(),
            finishedAt: new Date(1).toISOString(),
            error: { code: "cancelled", message: "The active turn was cancelled." },
          });
        };
        if (signal?.aborted) cancel();
        else signal?.addEventListener("abort", cancel, { once: true });
      });
    },
    close: async () => undefined,
  } as unknown as ChatApplication;

  await new TerminalUi(application, output, true).runInteractive(input);

  const rendered = chunks.join("").replace(/\u001b\[[0-9;]*m/gu, "");
  assert.equal(promptSent, true);
  assert.equal(cancelSent, true);
  assert.equal(cancellationObserved, true);
  assert.equal(exitSent, true);
  assert.equal(runCount, 1, "Ctrl+C must cancel the active turn, not submit its key as another prompt");
  assert.match(rendered, /Cancelling current turn/u);
  assert.match(rendered, /■ cancelled/u);
  assert.match(rendered, /Session closed\./u);
});

test("interactive TUI renders unexpected turn errors and remains usable", { timeout: 2_000 }, async () => {
  const input = new PassThrough();
  const { output, chunks } = captureOutput();
  let calls = 0;
  const application = {
    sessionId: "session_tui_error",
    modelLabel: "test/model",
    providerLabel: "test/model",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: [],
    readTranscript: async () => [],
    runTurn: async (message: string, _signal: AbortSignal | undefined, onText?: (text: string) => void) => {
      calls += 1;
      if (message === "first") throw new Error("simulated persistence failure");
      onText?.("recovered");
      return { status: "completed", assistantText: "recovered" };
    },
  } as unknown as ChatApplication;
  const ui = new TerminalUi(application, output, false);
  const running = ui.runInteractive(input);
  input.end("first\nsecond\n");
  await running;

  assert.equal(calls, 2);
  const rendered = chunks.join("");
  assert.match(rendered, /× failed · simulated persistence failure/u);
  assert.match(rendered, /recovered/u);
  assert.match(rendered, /Session closed\./u);
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

test("TUI keeps an ambiguous browser action visible without overriding a completed agent turn", async () => {
  const { output, chunks } = captureOutput();
  const application = {
    sessionId: "session_browser_recovery",
    modelLabel: "test/model",
    providerLabel: "test/model",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: ["browser_click", "browser_snapshot"],
    runTurn: async (...args: unknown[]) => {
      const onText = args[2] as ((text: string) => void) | undefined;
      const onEvent = args[3] as ((event: unknown) => void) | undefined;
      const onBrowser = args[9] as ((event: unknown) => void) | undefined;
      onEvent?.({ type: "waiting", round: 1 });
      onBrowser?.({
        type: "completed",
        request: { action: "click" },
        ok: false,
        errorCode: "browser-ambiguous",
        summary: "Cua could not confirm the cross-origin click effect.",
      });
      // The model then receives fresh destination-page evidence through a
      // read-only browser tool and completes its answer. That observation does
      // not rewrite the click's separately recorded ambiguous outcome.
      onEvent?.({ type: "tool_started", round: 2, call: { name: "browser_snapshot" } });
      onEvent?.({ type: "tool_completed", round: 2, name: "browser_snapshot", ok: true, summary: "Read the destination page title." });
      onText?.("The destination page title is Example Domains.");
      onEvent?.({ type: "status", status: "completed", round: 0 });
      return { status: "completed", assistantText: "The destination page title is Example Domains." };
    },
  } as unknown as ChatApplication;

  await new TerminalUi(application, output, false).runSingle("Follow the link and report the page title.");

  const rendered = chunks.join("");
  assert.match(rendered, /browser · click · outcome unknown/u);
  assert.match(rendered, /✓ completed ·/u);
  assert.doesNotMatch(rendered, /turn completed · computer task outcome unknown/u);
});

test("TUI redacts configured and provider-shaped secrets from live output", async () => {
  const { output, chunks } = captureOutput();
  const application = {
    sessionId: "session_ui_redaction",
    modelLabel: "test/model",
    providerLabel: "test/model",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: ["example_tool"],
    redactionSecrets: ["configured-ui-secret"],
    runTurn: async (...args: unknown[]) => {
      const onText = args[2] as ((text: string) => void) | undefined;
      const onEvent = args[3] as ((event: unknown) => void) | undefined;
      onText?.("model output configured-ui-");
      onText?.("secret sk-or-v1-0123456789abcdef0123456789");
      onText?.("abcdef");
      onEvent?.({ type: "tool_completed", name: "example_tool", ok: false, summary: "tool saw configured-ui-secret" });
      return { status: "completed" };
    },
  } as unknown as ChatApplication;

  await new TerminalUi(application, output, false, ["configured-ui-secret"]).runSingle("show safe output");

  const rendered = chunks.join("");
  assert.doesNotMatch(rendered, /configured-ui-secret/u);
  assert.doesNotMatch(rendered, /sk-or-v1-0123456789abcdef0123456789abcdef/u);
  assert.match(rendered, /\[REDACTED\]/u);
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
