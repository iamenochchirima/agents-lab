import readline from "node:readline";
import type { Writable } from "node:stream";
import type { ChatApplication } from "../runtime/application.js";
import type { TurnEvent, TurnResult, TranscriptMessage } from "../runtime/contracts.js";
import type { MutationApproval, MutationApprovalRequest, MutationApprovalDecision, MutationEvent } from "../workspace/mutation.js";
import type { ProcessApprovalDecision, ProcessApprovalRequest } from "../process/process.js";
import type { ProcessToolEvent } from "../tools/registry.js";
import type { BrowserApprovalDecision, BrowserApprovalRequest, BrowserToolEvent } from "../browser/index.js";
import { redactSecrets } from "../runtime/errors.js";

const COMMANDS = ["/help", "/status", "/history", "/evidence", "/clear", "/quit"] as const;
const PANEL_WIDTH = 72;
const LABEL_WIDTH = 11;

export type TuiCommand =
  | { readonly kind: "help" }
  | { readonly kind: "status" }
  | { readonly kind: "history" }
  | { readonly kind: "evidence" }
  | { readonly kind: "clear" }
  | { readonly kind: "quit" }
  | { readonly kind: "unknown"; readonly name: string };

export function parseTuiCommand(input: string): TuiCommand | undefined {
  const value = input.trim();
  if (!value.startsWith("/")) return undefined;
  const name = value.split(/\s+/u, 1)[0]?.toLowerCase() ?? value.toLowerCase();
  switch (name) {
    case "/help":
      return { kind: "help" };
    case "/status":
      return { kind: "status" };
    case "/history":
      return { kind: "history" };
    case "/evidence":
      return { kind: "evidence" };
    case "/clear":
      return { kind: "clear" };
    case "/quit":
    case "/exit":
      return { kind: "quit" };
    default:
      return { kind: "unknown", name };
  }
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}

function shorten(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function singleLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function panelRule(title: string): string {
  return `╭─ ${title} ${"─".repeat(Math.max(1, PANEL_WIDTH - title.length - 1))}╮`;
}

function panelBottom(): string {
  return `╰${"─".repeat(PANEL_WIDTH + 2)}╯`;
}

function panelRow(label: string, value: string): string {
  const clipped = shorten(value, PANEL_WIDTH - LABEL_WIDTH - 1);
  const content = `${label.padEnd(LABEL_WIDTH)} ${clipped}`;
  return `│ ${content}${" ".repeat(PANEL_WIDTH - content.length)} │`;
}

function commandCompleter(line: string): [string[], string] {
  if (!line.trimStart().startsWith("/")) return [[], line];
  const prefix = line.trimStart().toLowerCase();
  return [COMMANDS.filter((command) => command.startsWith(prefix) || (command === "/quit" && "/exit".startsWith(prefix))), line];
}

export class TerminalUi {
  private activeController: AbortController | undefined;
  private responseStarted = false;
  private waiting = false;
  private status: string = "ready";
  private statusRound = 0;
  private startedAt = 0;
  private readonly colour: boolean;
  private approvalQuestion: MutationApproval | undefined;
  private processApprovalQuestion: ((request: ProcessApprovalRequest, signal?: AbortSignal) => Promise<ProcessApprovalDecision>) | undefined;
  private browserApprovalQuestion: ((request: BrowserApprovalRequest, signal?: AbortSignal) => Promise<BrowserApprovalDecision>) | undefined;

  constructor(
    private readonly application: ChatApplication,
    private readonly output: Writable,
    private readonly interactive: boolean,
  ) {
    this.colour = interactive && !process.env.NO_COLOR && process.env.TERM !== "dumb";
  }

  private style(code: string, value: string): string {
    return this.colour ? `\u001b[${code}m${value}\u001b[0m` : value;
  }

  private write(value: string): void {
    this.output.write(value);
  }

  private promptText(): string {
    return `${this.style("33;1", "❯")} ${this.style("36;1", "You")} ${this.style("2", "›")} `;
  }

  private printPanel(title: string, rows: readonly (readonly [string, string])[]): void {
    this.write(`${this.style("33;1", panelRule(title))}\n`);
    for (const [label, value] of rows) {
      this.write(`${this.style("2", panelRow(label, value))}\n`);
    }
    this.write(`${this.style("33;1", panelBottom())}\n`);
  }

  private printActivity(icon: string, message: string, colour = "2"): void {
    this.write(`${this.style(colour, icon)} ${this.style("2", message)}\n`);
  }

  private statusIcon(): string {
    switch (this.status) {
      case "completed":
        return "✓";
      case "failed":
        return "×";
      case "cancelled":
        return "■";
      case "streaming":
        return "✦";
      case "waiting for model":
        return "◌";
      default:
        return "◆";
    }
  }

  private printStatusLine(): void {
    const elapsed = this.startedAt > 0 ? ` · ${formatDuration(Date.now() - this.startedAt)}` : "";
    const round = this.statusRound > 0 ? ` · round ${this.statusRound}` : "";
    this.write(`${this.style("2", "│")} ${this.style("33;1", this.statusIcon())} ${this.style("2", this.status)}${this.style("2", `${round}${elapsed}`)}\n`);
  }

  printHeader(): void {
    this.write(`\n${this.style("33;1", "◆")} ${this.style("36;1", "COMPUTER NATIVE")} ${this.style("2", "standalone agent console")}\n`);
    this.write(`${this.style("2", "Workspace-first turns with visible activity and durable evidence.")}\n\n`);
    this.printPanel("Session · Available tools", [
      ["model", this.application.providerLabel],
      ["session", this.application.sessionId],
      ["workspace", this.application.workspaceRoot],
      ["tools", this.application.toolNames.join(" · ") || "none registered"],
      ["evidence", this.application.evidenceDirectory],
    ]);
    this.write(`${this.style("2", "Type /help for commands · Ctrl+C cancels · Ctrl+D exits")}\n`);
    this.printStatusLine();
    this.write("\n");
  }

  private printHelp(): void {
    this.write(`\n${this.style("36;1", "Computer Native controls")}\n`);
    this.write(`${this.style("33;1", "Session")}\n`);
    this.write(`  ${this.style("33", "/status")}     Show session, model, tools, and turn state\n`);
    this.write(`  ${this.style("33", "/history")}    Show recent transcript messages\n`);
    this.write(`  ${this.style("33", "/evidence")}   Show the durable evidence directory\n`);
    this.write(`  ${this.style("33", "/clear")}      Redraw the console\n`);
    this.write(`  ${this.style("33", "/quit")}       Close the session\n\n`);
    this.write(`${this.style("33;1", "Input")}\n`);
    this.write(`  ${this.style("2", "Enter")}        Submit a prompt\n`);
    this.write(`  ${this.style("2", "\\ at end")}    Continue into multiline input\n`);
    this.write(`  ${this.style("2", "Ctrl+C")}       Cancel the active turn\n`);
    this.write(`  ${this.style("2", "Ctrl+D")}       Exit the session\n\n`);
    this.write(`${this.style("2", "Commands are intentionally limited to capabilities that exist.")}\n\n`);
  }

  private async printStatus(): Promise<void> {
    const transcript = await this.application.readTranscript();
    const turns = transcript.filter((message) => message.role === "user").length;
    const responses = transcript.filter((message) => message.role === "assistant").length;
    const elapsed = this.startedAt > 0 ? ` · ${formatDuration(Date.now() - this.startedAt)}` : "";
    this.write("\n");
    this.printPanel("Session status", [
      ["state", `${this.status}${this.statusRound > 0 ? ` · round ${this.statusRound}` : ""}${elapsed}`],
      ["model", this.application.providerLabel],
      ["session", this.application.sessionId],
      ["workspace", this.application.workspaceRoot],
      ["tools", this.application.toolNames.join(" · ") || "none registered"],
      ["turns", `${turns} user · ${responses} assistant`],
      ["evidence", this.application.evidenceDirectory],
    ]);
    this.write("\n");
  }

  private async printHistory(): Promise<void> {
    const transcript = await this.application.readTranscript();
    this.write(`\n${this.style("36;1", "Transcript")} ${this.style("2", `· ${transcript.length} messages`)}\n`);
    this.write(`${this.style("2", "────────────────────────────────────────────────────────────")}` + "\n");
    for (const message of transcript.slice(-12)) {
      const label = message.role === "user" ? "You" : "Agent";
      const colour = message.role === "user" ? "36;1" : "32;1";
      this.write(`  ${this.style(colour, label.padEnd(5))} ${this.style("2", shorten(message.content.replaceAll("\n", " "), 160))}\n`);
    }
    if (transcript.length === 0) this.write(`  ${this.style("2", "No messages yet.")}\n`);
    if (transcript.length > 12) this.write(`  ${this.style("2", `… ${transcript.length - 12} earlier messages omitted`)}\n`);
    this.write("\n");
  }

  async runCommand(command: TuiCommand): Promise<boolean> {
    switch (command.kind) {
      case "help":
        this.printHelp();
        return true;
      case "status":
        await this.printStatus();
        return true;
      case "history":
        await this.printHistory();
        return true;
      case "evidence":
        this.write(`\nEvidence directory:\n${this.application.evidenceDirectory}\n\n`);
        return true;
      case "clear":
        if (this.interactive) this.write("\u001b[2J\u001b[H");
        this.printHeader();
        return true;
      case "quit":
        return false;
      case "unknown":
        this.write(`\nUnknown command '${command.name}'. Type /help to see available commands.\n\n`);
        return true;
    }
  }

  private handleEvent(event: TurnEvent): void {
    switch (event.type) {
      case "waiting":
        this.waiting = true;
        this.status = "waiting for model";
        this.statusRound = event.round;
        this.printActivity("◌", `waiting for model · round ${event.round}`);
        break;
      case "text":
        this.status = "streaming";
        this.statusRound = event.round;
        break;
      case "tool_started":
        this.status = `running ${event.call.name}`;
        this.statusRound = event.round;
        this.printActivity("↳", `${event.call.name} · started`, "33;1");
        break;
      case "tool_completed":
        this.status = event.ok ? "tool completed" : "tool failed";
        this.statusRound = event.round;
        this.printActivity(event.ok ? "✓" : "×", `${event.name} · ${event.summary}`, event.ok ? "32;1" : "31;1");
        break;
      case "status":
        this.status = event.status;
        this.statusRound = event.round;
        break;
    }
  }

  private handleMutation(event: MutationEvent): void {
    const path = event.request.path;
    switch (event.type) {
      case "proposed":
        this.status = `workspace change proposed: ${path}`;
        this.printActivity("◇", `workspace change · proposed ${path}`, "33;1");
        break;
      case "approval_decided":
        if (event.decision.decision === "allow-once") {
          this.status = `workspace change approved: ${path}`;
          this.printActivity("✓", `workspace change · approved ${path}`, "32;1");
        } else {
          this.status = `workspace change denied: ${path}`;
          this.printActivity("×", `workspace change · ${event.decision.decision} ${path}`, "31;1");
        }
        break;
      case "applying":
        this.status = `workspace change applying: ${path}`;
        this.printActivity("↳", `workspace change · applying ${path}`, "33;1");
        break;
      case "committed":
        this.status = `workspace change committed: ${path}`;
        this.printActivity("✓", `workspace change · committed ${path}${event.bytesWritten === undefined ? "" : ` · ${event.bytesWritten} bytes`}`, "32;1");
        break;
      case "failed":
        this.status = `workspace change failed: ${path}`;
        this.printActivity("×", `workspace change · failed ${path} · ${event.reason}`, "31;1");
        break;
    }
  }

  private handleProcess(event: ProcessToolEvent): void {
    switch (event.type) {
      case "prepared":
        this.status = `command approval: ${event.request.command}`;
        this.printActivity("◇", `command · approval requested · ${event.request.command} ${event.request.displayArgs.join(" ")}`, "33;1");
        break;
      case "approval_decided":
        if (event.decision.decision === "allow-once") {
          this.status = `command approved: ${event.request.command}`;
          this.printActivity("✓", `command · approved · ${event.request.command}`, "32;1");
        } else {
          this.status = `command not started: ${event.request.command}`;
          this.printActivity("×", `command · ${event.decision.decision} · ${event.request.command}`, "31;1");
        }
        break;
      case "started":
        this.status = `running ${event.request.command}`;
        this.printActivity("↳", `command · running · pid ${event.pid}`, "33;1");
        break;
      case "output":
        this.status = `running ${event.request.command}`;
        break;
      case "terminating":
        this.status = `command ${event.reason}: ${event.request.command}`;
        this.printActivity("■", `command · ${event.reason} · ${event.request.command}`, "33;1");
        break;
      case "completed":
        this.status = `command ${event.result.state}: ${event.request.command}`;
        this.printActivity(event.result.state === "completed" && event.result.errorCode === undefined ? "✓" : "×", `command · ${event.result.state} · ${event.request.command}`, event.result.state === "completed" && event.result.errorCode === undefined ? "32;1" : "31;1");
        break;
    }
  }

  private handleBrowser(event: BrowserToolEvent): void {
    switch (event.type) {
      case "artifact":
        this.status = `browser artifact captured: ${event.artifact.artifactId}`;
        this.printActivity("◆", `browser · ${event.artifact.kind} · ${event.artifact.artifactId} · ${event.artifact.byteSize} bytes · ${event.artifact.path}`, "36;1");
        break;
      case "prepared":
        this.status = `browser approval: ${event.request.action}`;
        this.printActivity("◇", `browser · approval requested · ${event.request.action} ${event.request.reference}`, "33;1");
        break;
      case "approval_decided":
        if (event.decision.decision === "allow-once") {
          this.status = `browser approved: ${event.request.action}`;
          const dialogDecision = event.decision.dialogDecision ? ` · ${event.decision.dialogDecision}` : "";
          this.printActivity("✓", `browser · approved · ${event.request.action}${dialogDecision}`, "32;1");
        } else {
          this.status = `browser ${event.request.action} not approved`;
          this.printActivity("×", `browser · ${event.request.action} not approved`, "31;1");
        }
        break;
      case "started":
        this.status = `browser ${event.request.action} running`;
        this.printActivity("↳", `browser · ${event.request.action} running · ${event.request.reference}`, "33;1");
        break;
      case "completed":
        this.status = event.ok ? "browser action completed" : "browser action failed";
        const dialogText = event.dialog
          ? ` · dialog ${event.dialog.type}: ${singleLine(redactSecrets(event.dialog.message, [process.env.OPENROUTER_API_KEY ?? ""]))}`
          : "";
        this.printActivity(event.ok ? "✓" : "×", `browser · ${event.request.action} · ${event.summary}${dialogText}${event.cancellationConfirmed === true ? " · cancellation confirmed" : event.cancellationConfirmed === false ? " · cancellation unconfirmed" : ""}`, event.ok ? "32;1" : "31;1");
        break;
    }
  }

  private beginTurn(): void {
    this.startedAt = Date.now();
    this.responseStarted = false;
    this.waiting = false;
    this.status = "starting";
    this.statusRound = 0;
    this.write(`\n${this.style("36;1", "┌ turn")} ${this.style("2", "starting model run")}\n`);
  }

  private appendText(text: string): void {
    if (!this.responseStarted) {
      this.write(`${this.style("32;1", "Agent")} ${this.style("2", "›")} `);
      this.responseStarted = true;
    }
    this.write(text);
  }

  private finishTurn(result: TurnResult): void {
    const elapsed = formatDuration(Date.now() - this.startedAt);
    const icon = result.status === "completed" ? "✓" : result.status === "cancelled" ? "■" : "×";
    const detail = result.status === "completed"
      ? `${elapsed}${result.usage?.outputTokens === undefined ? "" : ` · ${result.usage.outputTokens} output tokens`}`
      : result.error?.message ?? "No assistant response was committed.";
    this.status = result.status;
    this.statusRound = 0;
    this.write(`\n${this.style(result.status === "completed" ? "32;1" : "31;1", `${icon} ${result.status}`)} ${this.style("2", `· ${detail}`)}\n`);
    this.printStatusLine();
    this.write(`${this.style("2", "────────────────────────────────────────────────────────────")}\n\n`);
    this.startedAt = 0;
  }

  private async askForMutationApproval(
    request: MutationApprovalRequest,
    question: (prompt: string, callback: (answer: string) => void) => void,
    signal?: AbortSignal,
    cancelQuestion?: () => void,
  ): Promise<MutationApprovalDecision> {
    const targetNoun = request.operation === "mkdir" || request.operation === "delete-directory" || request.operation === "delete-directory-tree" || request.operation === "restore-directory" ? "directory" : request.operation === "patch-set" ? "files" : request.operation === "purge-quarantine" ? "quarantine entry" : "file";
    const risk = request.risk ?? (request.operation === "mkdir" ? "create-directory" : request.operation === "delete-directory" ? "delete-directory" : request.operation === "delete-directory-tree" ? "delete-directory-tree" : request.operation === "delete" ? "quarantine-file" : request.operation === "restore-directory" ? "restore-directory" : request.operation === "purge-quarantine" ? "purge-quarantine" : request.operation === "restore" ? "restore-file" : request.operation === "copy" ? "copy-file" : request.operation === "move" ? "move-file" : request.operation === "add" ? "create-file" : request.operation === "update" ? "patch-file" : "replace-file");
    const change = request.operation === "patch-set"
      ? `${request.paths?.length ?? request.members?.length ?? 0} files · +${request.addedLines} / -${request.removedLines} lines`
      : request.operation === "mkdir" ? "create directory" : request.operation === "delete-directory" ? "delete empty directory" : request.operation === "delete-directory-tree" ? `quarantine directory tree · ${request.entryCount ?? "?"} entries · ${request.totalBytes ?? "?"} bytes` : request.operation === "delete" ? "quarantine file" : request.operation === "restore-directory" ? "restore directory tree" : request.operation === "purge-quarantine" ? "permanently remove quarantine entry" : request.operation === "restore" ? "restore file" : request.operation === "copy" ? "copy file" : request.operation === "move" ? "move/rename file" : `+${request.addedLines} / -${request.removedLines} lines`;
    this.write("\n");
    this.printPanel("Proposed workspace change", [
      ["operation", request.operation],
      ["risk", risk],
      ["path", request.path],
      ...(request.paths && request.paths.length > 0 ? [["paths", request.paths.join("\n")] as const] : []),
      ["change", change],
      ["before", request.beforeHash ?? "absent"],
      ["after", request.afterHash ?? (request.operation === "mkdir" ? "directory" : request.operation === "delete-directory" ? "absent" : request.operation === "delete-directory-tree" ? "quarantine" : request.operation === "delete" ? "quarantine" : request.operation === "restore-directory" ? "restored" : request.operation === "purge-quarantine" ? "permanently removed" : request.operation === "restore" ? "restored" : "not recorded")],
    ]);
    this.write(`${this.style("2", request.diff)}\n`);
    const answer = await new Promise<{ readonly kind: "answer"; readonly value: string } | { readonly kind: "cancelled" }>((resolve) => {
      let settled = false;
      const finish = (result: { readonly kind: "answer"; readonly value: string } | { readonly kind: "cancelled" }): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        cancelQuestion?.();
        resolve({ kind: "cancelled" });
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      question(`${this.style("33;1", "Apply this change? [y/N]")} `, (value) => finish({ kind: "answer", value }));
    });
    if (answer.kind === "cancelled") {
      this.write(`${this.style("33;1", `Approval cancelled; the ${targetNoun} was left unchanged.`)}\n`);
      return { decision: "unavailable", reason: "The active turn ended before approval was completed." };
    }
    if (answer.value.trim().toLowerCase() === "y" || answer.value.trim().toLowerCase() === "yes") {
      this.write(`${this.style("32;1", "✓ approved once")}\n`);
      return { decision: "allow-once" };
    }
    this.write(`${this.style("2", `Change denied; the ${targetNoun} was left unchanged.`)}\n`);
    return { decision: "deny", reason: "The user did not approve the proposed change." };
  }

  private async askForProcessApproval(
    request: ProcessApprovalRequest,
    question: (prompt: string, callback: (answer: string) => void) => void,
    signal?: AbortSignal,
    cancelQuestion?: () => void,
  ): Promise<ProcessApprovalDecision> {
    const command = [request.command, ...request.displayArgs.map((argument) => JSON.stringify(argument))].join(" ");
    this.write("\n");
    this.printPanel("Proposed local process", [
      ["command", command],
      ["cwd", request.cwd],
      ["executable", request.executablePath],
      ["environment", `${request.environmentProfile} · ${request.environmentKeys.join(", ")}`],
      ["limits", `${request.limits.timeoutMs}ms · ${request.limits.maxOutputBytes} output bytes`],
      ["warning", request.warning],
    ]);
    const answer = await new Promise<{ readonly kind: "answer"; readonly value: string } | { readonly kind: "cancelled" }>((resolve) => {
      let settled = false;
      const finish = (result: { readonly kind: "answer"; readonly value: string } | { readonly kind: "cancelled" }): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        cancelQuestion?.();
        resolve({ kind: "cancelled" });
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      question(`${this.style("33;1", "Run this command? [y/N]")} `, (value) => finish({ kind: "answer", value }));
    });
    if (answer.kind === "cancelled") {
      this.write(`${this.style("33;1", "Approval cancelled; the process was not started.")}\n`);
      return { decision: "unavailable", reason: "The active turn ended before process approval was completed." };
    }
    if (answer.value.trim().toLowerCase() === "y" || answer.value.trim().toLowerCase() === "yes") {
      this.write(`${this.style("32;1", "✓ approved once")}\n`);
      return { decision: "allow-once" };
    }
    this.write(`${this.style("2", "Command denied; the process was not started.")}\n`);
    return { decision: "deny", reason: "The user did not approve the command." };
  }

  private async askForBrowserApproval(
    request: BrowserApprovalRequest,
    question: (prompt: string, callback: (answer: string) => void) => void,
    signal?: AbortSignal,
    cancelQuestion?: () => void,
  ): Promise<BrowserApprovalDecision> {
    this.write("\n");
    this.printPanel("Proposed browser interaction", [
      ["action", request.action],
      ["session", request.sessionId],
      ["tab", request.tabId],
      ["reference", request.reference],
      ["document", request.documentId],
      ...(request.text !== undefined ? [["text", redactSecrets(request.text, [process.env.OPENROUTER_API_KEY ?? ""]) ] as const] : []),
      ...(request.key !== undefined ? [["key", request.key] as const] : []),
      ...(request.path !== undefined ? [["path", redactSecrets(request.path, [process.env.OPENROUTER_API_KEY ?? ""]) ] as const] : []),
      ...(request.maxBytes !== undefined ? [["max bytes", String(request.maxBytes)] as const] : []),
      ...(request.dialog ? [["dialog", `${request.dialog.type}: ${redactSecrets(request.dialog.message, [process.env.OPENROUTER_API_KEY ?? ""])}`] as const] : []),
      ["hash", request.actionHash],
      ["warning", request.warning],
    ]);
    const answer = await new Promise<{ readonly kind: "answer"; readonly value: string } | { readonly kind: "cancelled" }>((resolve) => {
      let finished = false;
      const finish = (value: { readonly kind: "answer"; readonly value: string } | { readonly kind: "cancelled" }) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const onAbort = () => {
        cancelQuestion?.();
        finish({ kind: "cancelled" });
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      const prompt = request.dialog
        ? request.dialog.type === "prompt"
          ? "Resolve page prompt? [a:<text>/d/N]"
          : "Resolve page dialog? [a]ccept/[d]ismiss/N"
        : "Allow this browser action? [y/N]";
      question(`${this.style("33;1", prompt)} `, (value) => finish({ kind: "answer", value }));
    });
    if (answer.kind === "cancelled") {
      this.write(`${this.style("33;1", "Approval cancelled; the browser action was not started.")}\n`);
      return { decision: "unavailable", reason: "The active turn ended before browser approval was completed." };
    }
    const normalized = answer.value.trim();
    const lower = normalized.toLowerCase();
    if (request.dialog) {
      if (lower === "d" || lower === "dismiss") {
        this.write(`${this.style("32;1", "✓ dialog dismissed")}${this.style("2", "; the browser action remains uncertain") }\n`);
        return { decision: "allow-once", dialogDecision: "dismiss" };
      }
      const acceptPrefix = lower === "a" || lower === "accept";
      const promptMatch = /^(?:a|accept)\s*:\s*([\s\S]*)$/iu.exec(normalized) ?? /^(?:a|accept)\s+([\s\S]+)$/iu.exec(normalized);
      if (acceptPrefix && request.dialog.type !== "prompt") {
        this.write(`${this.style("32;1", "✓ dialog accepted")}${this.style("2", "; the browser action remains uncertain") }\n`);
        return { decision: "allow-once", dialogDecision: "accept" };
      }
      if (promptMatch && request.dialog.type === "prompt") {
        this.write(`${this.style("32;1", "✓ dialog accepted")}${this.style("2", "; the browser action remains uncertain") }\n`);
        return { decision: "allow-once", dialogDecision: "accept", promptText: promptMatch[1] ?? "" };
      }
      this.write(`${this.style("2", "Dialog not resolved; the browser action was not allowed to continue.")}\n`);
      return { decision: "deny", reason: "The page dialog was not explicitly accepted or dismissed." };
    }
    if (lower === "y" || lower === "yes") {
      this.write(`${this.style("32;1", "✓ approved once")}\n`);
      return { decision: "allow-once" };
    }
    this.write(`${this.style("2", "Browser action denied; no interaction was performed.")}\n`);
    return { decision: "deny", reason: "The user did not approve the browser action." };
  }

  async runTurn(message: string, signal?: AbortSignal): Promise<TurnResult> {
    this.beginTurn();
    const controller = new AbortController();
    this.activeController = controller;
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    }
    try {
      const result = await this.application.runTurn(
        message,
        controller.signal,
        (text) => this.appendText(text),
        (event) => this.handleEvent(event),
        this.approvalQuestion,
        (event) => this.handleMutation(event),
        this.processApprovalQuestion,
        (event) => this.handleProcess(event),
        this.browserApprovalQuestion,
        (event) => this.handleBrowser(event),
      );
      this.finishTurn(result);
      return result;
    } finally {
      this.activeController = undefined;
    }
  }

  cancelActiveTurn(): boolean {
    if (!this.activeController) return false;
    this.activeController.abort("cancelled");
    this.write(`${this.style("33;1", "Cancelling current turn…")}\n`);
    return true;
  }

  async runInteractive(input: NodeJS.ReadableStream): Promise<void> {
    this.printHeader();
    const readlineInterface = readline.createInterface({
      input,
      output: this.output,
      terminal: this.interactive,
      crlfDelay: Infinity,
      historySize: 100,
      removeHistoryDuplicates: true,
      completer: commandCompleter,
    });
      this.approvalQuestion = this.interactive
      ? (request, signal) => this.askForMutationApproval(
        request,
        (prompt, callback) => readlineInterface.question(prompt, callback),
        signal,
        () => readlineInterface.write("\n"),
        )
      : undefined;
    this.processApprovalQuestion = this.interactive
      ? (request, signal) => this.askForProcessApproval(
        request,
        (prompt, callback) => readlineInterface.question(prompt, callback),
        signal,
        () => readlineInterface.write("\n"),
      )
      : undefined;
    this.browserApprovalQuestion = this.interactive
      ? (request, signal) => this.askForBrowserApproval(
        request,
        (prompt, callback) => readlineInterface.question(prompt, callback),
        signal,
        () => readlineInterface.write("\n"),
      )
      : undefined;
    const onInterrupt = () => {
      if (this.cancelActiveTurn()) return;
      this.write(`${this.style("2", "Nothing is running. Type /help or /quit.")}\n`);
      if (this.interactive) readlineInterface.prompt();
    };
    readlineInterface.on("SIGINT", onInterrupt);
    const onResize = () => {
      if (!this.interactive) return;
      this.write("\u001b[2K\r");
      readlineInterface.prompt(true);
    };
    this.output.on("resize", onResize);
    let multiline: string[] = [];
    try {
      if (this.interactive) {
        readlineInterface.setPrompt(this.promptText());
        readlineInterface.prompt();
      }
      for await (const line of readlineInterface) {
        const continued = line.endsWith("\\");
        const part = continued ? line.slice(0, -1) : line;
        if (multiline.length > 0 || continued) {
          multiline.push(part);
          if (continued) {
            if (this.interactive) {
              readlineInterface.setPrompt(`${this.style("2", "…")} `);
              readlineInterface.prompt();
            }
            continue;
          }
        }
        const value = (multiline.length > 0 ? multiline.join("\n") : line).trim();
        multiline = [];
        if (this.interactive) readlineInterface.setPrompt(this.promptText());
        if (value.length === 0) {
          if (this.interactive) readlineInterface.prompt();
          continue;
        }
        const command = parseTuiCommand(value);
        if (command) {
          const keepRunning = await this.runCommand(command);
          if (!keepRunning) break;
          if (this.interactive) readlineInterface.prompt();
          continue;
        }
        await this.runTurn(value);
        if (this.interactive) readlineInterface.prompt();
      }
    } finally {
      this.approvalQuestion = undefined;
      this.processApprovalQuestion = undefined;
      this.browserApprovalQuestion = undefined;
      readlineInterface.removeListener("SIGINT", onInterrupt);
      this.output.removeListener("resize", onResize);
      readlineInterface.close();
    }
    this.write(`${this.style("2", "Session closed.")}\n`);
  }

  async runSingle(message: string): Promise<TurnResult> {
    this.write(`${this.style("36;1", "You")}\n${message.trim()}\n`);
    return this.runTurn(message);
  }
}

export function transcriptSummary(transcript: readonly TranscriptMessage[]): string {
  return transcript.map((message) => `${message.role}: ${message.content}`).join("\n");
}
