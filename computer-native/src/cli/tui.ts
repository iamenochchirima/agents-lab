import readline from "node:readline";
import type { Writable } from "node:stream";
import type { ChatApplication } from "../runtime/application.js";
import type { TurnEvent, TurnResult, TranscriptMessage } from "../runtime/contracts.js";
import type { MutationApproval, MutationApprovalRequest, MutationApprovalDecision, MutationEvent } from "../workspace/mutation.js";
import type { ProcessApprovalDecision, ProcessApprovalRequest } from "../process/process.js";
import type { ProcessToolEvent } from "../tools/registry.js";
import type { BrowserApprovalDecision, BrowserApprovalRequest, BrowserToolEvent } from "../browser/index.js";
import type { MemoryApproval, MemoryApprovalDecision, MemoryApprovalRequest, MemoryEvent, MemorySearchEvidence } from "../memory/contracts.js";
import { redactSecrets } from "../runtime/errors.js";
import { ApprovalPrompt, type ApprovalPanel } from "./approval.js";

const COMMANDS = ["/help", "/status", "/history", "/memory", "/evidence", "/clear", "/quit"] as const;
const PANEL_WIDTH = 72;
const LABEL_WIDTH = 11;

export type TuiCommand =
  | { readonly kind: "help" }
  | { readonly kind: "status" }
  | { readonly kind: "history" }
  | { readonly kind: "memory" }
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
    case "/memory":
      return { kind: "memory" };
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
  private memoryApprovalQuestion: MemoryApproval | undefined;
  private approvalInput: NodeJS.ReadableStream | undefined;
  private pauseApprovalInput: (() => void) | undefined;
  private resumeApprovalInput: (() => void) | undefined;

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
    this.write(`  ${this.style("33", "/memory")}     Show bounded durable-memory status\n`);
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
      case "memory":
        if (this.application.readMemoryStatus) {
          const status = await this.application.readMemoryStatus();
          this.write("\n");
          this.printPanel("Durable memory", [
            ["state", status.enabled ? "enabled" : "disabled"],
            ["entries", `${status.entries} total · ${status.userEntries} user · ${status.workspaceEntries} workspace · ${status.dailyEntries} daily`],
            ["retention", `${status.dailyRetentionDays} days for daily notes (cleanup is explicit)`],
            ["index health", `${status.indexStatus} · ${status.indexEntries} indexed`],
            ["index", status.indexPath],
            ["canonical", status.canonicalPaths.join(" · ")],
          ]);
          this.write("\n");
        } else {
          this.write(`\n${this.style("2", "Durable memory is not enabled for this session.")}\n\n`);
        }
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
      case "retry":
        this.waiting = true;
        this.status = `retrying model · attempt ${event.attempt}`;
        this.statusRound = event.round;
        this.printActivity("↻", `model retry · attempt ${event.attempt} · ${event.reason}${event.delayMs > 0 ? ` · waiting ${event.delayMs}ms` : ""}`, "33;1");
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

  private handleMemory(event: MemoryEvent): void {
    const target = event.request.recordId ?? event.request.scope;
    switch (event.type) {
      case "prepared":
        this.status = `memory approval: ${event.request.operation}`;
        this.printActivity("◇", `memory · approval requested · ${event.request.operation} · ${target}`, "33;1");
        break;
      case "approval_decided":
        this.status = event.decision.decision === "allow-once" ? `memory approved: ${target}` : `memory not approved: ${target}`;
        this.printActivity(event.decision.decision === "allow-once" ? "✓" : "×", `memory · ${event.decision.decision} · ${target}`, event.decision.decision === "allow-once" ? "32;1" : "31;1");
        break;
      case "committed":
        this.status = `memory stored: ${event.record.id}`;
        this.printActivity("✓", `memory · stored · ${event.record.scope} · ${event.record.id}`, "32;1");
        break;
      case "forgotten":
        this.status = `memory removed: ${target}`;
        this.printActivity("✓", `memory · removed · ${target}`, "32;1");
        break;
      case "failed":
        this.status = `memory failed: ${target}`;
        this.printActivity("×", `memory · failed · ${target} · ${event.reason}`, "31;1");
        break;
    }
  }

  private handleMemorySearch(evidence: Omit<MemorySearchEvidence, "sessionId" | "turnId" | "recordedAt">): void {
    this.status = `memory search: ${evidence.resultCount} result${evidence.resultCount === 1 ? "" : "s"}`;
    this.printActivity("⌕", `memory · search · ${evidence.resultCount} result${evidence.resultCount === 1 ? "" : "s"}${evidence.truncated ? " · more results available" : ""}`, "36;1");
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
    const isDirectoryAction = request.kind === "directory" || request.operation === "mkdir" || request.operation === "delete-directory" || request.operation === "delete-directory-tree" || request.operation === "restore-directory" || request.risk?.endsWith("-directory");
    const targetNoun = isDirectoryAction ? "directory" : request.operation === "patch-set" ? "files" : request.operation === "purge-quarantine" ? "quarantine entry" : "file";
    const risk = request.risk ?? (request.operation === "mkdir" ? "create-directory" : request.operation === "delete-directory" ? "delete-directory" : request.operation === "delete-directory-tree" ? "delete-directory-tree" : request.operation === "delete" ? "quarantine-file" : request.operation === "restore-directory" ? "restore-directory" : request.operation === "purge-quarantine" ? "purge-quarantine" : request.operation === "restore" ? "restore-file" : request.operation === "copy" ? (isDirectoryAction ? "copy-directory" : "copy-file") : request.operation === "move" ? (isDirectoryAction ? "move-directory" : "move-file") : request.operation === "rename" ? (isDirectoryAction ? "rename-directory" : "rename-file") : request.operation === "add" ? "create-file" : request.operation === "update" ? "patch-file" : "replace-file");
    const change = request.operation === "patch-set"
      ? `${request.paths?.length ?? request.members?.length ?? 0} files · +${request.addedLines} / -${request.removedLines} lines`
      : request.operation === "mkdir" ? "create directory" : request.operation === "delete-directory" ? "delete empty directory" : request.operation === "delete-directory-tree" ? `quarantine directory tree · ${request.entryCount ?? "?"} entries · ${request.totalBytes ?? "?"} bytes` : request.operation === "delete" ? "quarantine file" : request.operation === "restore-directory" ? "restore directory tree" : request.operation === "purge-quarantine" ? "permanently remove quarantine entry" : request.operation === "restore" ? "restore file" : request.operation === "copy" ? (isDirectoryAction ? `copy directory tree · ${request.entryCount ?? "?"} entries · ${request.totalBytes ?? "?"} bytes` : "copy file") : request.operation === "move" ? (isDirectoryAction ? `move directory tree · ${request.entryCount ?? "?"} entries · ${request.totalBytes ?? "?"} bytes` : "move file") : request.operation === "rename" ? (isDirectoryAction ? `rename directory tree · ${request.entryCount ?? "?"} entries · ${request.totalBytes ?? "?"} bytes` : "rename file") : `+${request.addedLines} / -${request.removedLines} lines`;
    const panel: ApprovalPanel = {
      title: "Proposed workspace change",
      risk,
      action: request.operation,
      target: request.path,
      scope: "workspace",
      extra: [
        ...(request.paths && request.paths.length > 0 ? [["paths", request.paths.join(", ")] as const] : []),
        ["change", change],
        ["before", request.beforeHash ?? "absent"],
        ["after", request.afterHash ?? (request.operation === "mkdir" ? "directory" : request.operation === "delete-directory" ? "absent" : request.operation === "delete-directory-tree" ? "quarantine" : request.operation === "delete" ? "quarantine" : request.operation === "restore-directory" ? "restored" : request.operation === "purge-quarantine" ? "permanently removed" : request.operation === "restore" ? "restored" : "not recorded")],
      ],
      preview: `${change}\n${request.diff}`,
      details: [
        `paths: ${request.paths?.join(", ") ?? request.path}`,
        `before: ${request.beforeHash ?? "absent"}`,
        `after: ${request.afterHash ?? (request.operation === "mkdir" ? "directory" : request.operation === "delete-directory" ? "absent" : request.operation === "delete-directory-tree" ? "quarantine" : request.operation === "delete" ? "quarantine" : request.operation === "restore-directory" ? "restored" : request.operation === "purge-quarantine" ? "permanently removed" : request.operation === "restore" ? "restored" : "not recorded")}`,
        request.diff,
      ].join("\n"),
      redactionSecrets: [process.env.OPENROUTER_API_KEY ?? ""],
    };
    const answer = await new ApprovalPrompt({ output: this.output, colour: this.colour }).ask(panel, { question, signal, cancelQuestion, rawInput: this.approvalInput, pauseInput: this.pauseApprovalInput, resumeInput: this.resumeApprovalInput });
    if (answer.decision === "unavailable") {
      this.write(`${this.style("33;1", `Approval cancelled; the ${targetNoun} was left unchanged.`)}\n`);
      return answer;
    }
    if (answer.decision === "allow-once") {
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
    const panel: ApprovalPanel = {
      title: "Proposed local process",
      risk: "local-process",
      action: request.command,
      target: request.executablePath,
      scope: request.cwd,
      preview: `${command}\n${request.warning}`,
      details: [
        `command: ${command}`,
        `environment: ${request.environmentProfile} · ${request.environmentKeys.join(", ")}`,
        `limits: ${request.limits.timeoutMs}ms · ${request.limits.maxOutputBytes} output bytes`,
        `argv hash: ${request.argvHash}`,
        `warning: ${request.warning}`,
      ].join("\n"),
      redactionSecrets: [process.env.OPENROUTER_API_KEY ?? ""],
    };
    const answer = await new ApprovalPrompt({ output: this.output, colour: this.colour }).ask(panel, { question, signal, cancelQuestion, rawInput: this.approvalInput, pauseInput: this.pauseApprovalInput, resumeInput: this.resumeApprovalInput });
    if (answer.decision === "unavailable") {
      this.write(`${this.style("33;1", "Approval cancelled; the process was not started.")}\n`);
      return answer;
    }
    if (answer.decision === "allow-once") {
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
    const preview = [
      request.text === undefined ? undefined : `text: ${request.text}`,
      request.key === undefined ? undefined : `key: ${request.key}`,
      request.path === undefined ? undefined : `path: ${request.path}`,
      request.maxBytes === undefined ? undefined : `max bytes: ${request.maxBytes}`,
      request.dialog === undefined ? undefined : `dialog: ${request.dialog.type}: ${request.dialog.message}`,
      request.warning,
    ].filter((value): value is string => value !== undefined).join("\n");
    const panel: ApprovalPanel = {
      title: "Proposed browser interaction",
      risk: request.dialog ? "page-dialog" : "browser-interaction",
      action: request.action,
      target: `${request.reference} · document ${request.documentId}`,
      scope: `${request.sessionId} · ${request.tabId}`,
      extra: [
        ["document", request.documentId],
        ...(request.text === undefined ? [] : [["text", request.text] as const]),
        ...(request.key === undefined ? [] : [["key", request.key] as const]),
        ...(request.path === undefined ? [] : [["path", request.path] as const]),
        ...(request.maxBytes === undefined ? [] : [["max bytes", String(request.maxBytes)] as const]),
        ...(request.dialog === undefined ? [] : [["dialog", `${request.dialog.type}: ${request.dialog.message}`] as const]),
        ["hash", request.actionHash],
      ],
      preview,
      details: [
        `document: ${request.documentId}`,
        `reference: ${request.reference}`,
        request.text === undefined ? undefined : `text: ${request.text}`,
        request.key === undefined ? undefined : `key: ${request.key}`,
        request.path === undefined ? undefined : `path: ${request.path}`,
        request.maxBytes === undefined ? undefined : `max bytes: ${request.maxBytes}`,
        request.dialog === undefined ? undefined : `dialog: ${request.dialog.type}: ${request.dialog.message}`,
        `action hash: ${request.actionHash}`,
        `warning: ${request.warning}`,
      ].filter((value): value is string => value !== undefined).join("\n"),
      redactionSecrets: [process.env.OPENROUTER_API_KEY ?? ""],
    };
    const prompt = new ApprovalPrompt({ output: this.output, colour: this.colour });
    const answer = request.dialog
      ? await prompt.askDialog(panel, request.dialog.type, { question, signal, cancelQuestion, rawInput: this.approvalInput, pauseInput: this.pauseApprovalInput, resumeInput: this.resumeApprovalInput })
      : await prompt.ask(panel, { question, signal, cancelQuestion, rawInput: this.approvalInput, pauseInput: this.pauseApprovalInput, resumeInput: this.resumeApprovalInput });
    if (answer.decision === "unavailable") {
      this.write(`${this.style("33;1", "Approval cancelled; the browser action was not started.")}\n`);
      return answer;
    }
    if (request.dialog) {
      if (answer.decision === "allow-once" && "dialogDecision" in answer && answer.dialogDecision === "dismiss") {
        this.write(`${this.style("32;1", "✓ dialog dismissed")}${this.style("2", "; the browser action remains uncertain") }\n`);
        return { decision: "allow-once", dialogDecision: "dismiss" };
      }
      if (answer.decision === "allow-once" && "dialogDecision" in answer && answer.dialogDecision === "accept") {
        this.write(`${this.style("32;1", "✓ dialog accepted")}${this.style("2", "; the browser action remains uncertain") }\n`);
        return {
          decision: "allow-once",
          dialogDecision: "accept",
          promptText: "promptText" in answer && typeof answer.promptText === "string" ? answer.promptText : undefined,
        };
      }
      this.write(`${this.style("2", "Dialog not resolved; the browser action was not allowed to continue.")}\n`);
      return answer;
    }
    if (answer.decision === "allow-once") {
      this.write(`${this.style("32;1", "✓ approved once")}\n`);
      return { decision: "allow-once" };
    }
    this.write(`${this.style("2", "Browser action denied; no interaction was performed.")}\n`);
    return { decision: "deny", reason: "The user did not approve the browser action." };
  }

  private async askForMemoryApproval(
    request: MemoryApprovalRequest,
    question: (prompt: string, callback: (answer: string) => void) => void,
    signal?: AbortSignal,
    cancelQuestion?: () => void,
  ): Promise<MemoryApprovalDecision> {
    const panel: ApprovalPanel = {
      title: request.operation === "remove" ? "Proposed memory removal" : request.operation === "batch" ? "Proposed memory consolidation" : "Proposed durable memory",
      risk: request.risk,
      action: request.operation,
      target: request.recordId ?? request.sourcePath,
      scope: request.scope,
      extra: [
        ["operation", request.operation],
        ["source", request.sourcePath],
        ...(request.recordId ? [["record", request.recordId] as const] : []),
        ...(request.beforeContentHash ? [["before", request.beforeContentHash] as const] : []),
        ...(request.afterContentHash ? [["after", request.afterContentHash] as const] : []),
        ...(request.batch ? [["operations", `${request.batch.length} bounded changes`] as const] : []),
      ],
      preview: request.contentPreview,
      details: `operation id: ${request.operationId}\nsource: ${request.sourcePath}\nThis entry is advisory context and cannot change policy or permissions.`,
      redactionSecrets: [process.env.OPENROUTER_API_KEY ?? ""],
    };
    const answer = await new ApprovalPrompt({ output: this.output, colour: this.colour }).ask(panel, { question, signal, cancelQuestion, rawInput: this.approvalInput, pauseInput: this.pauseApprovalInput, resumeInput: this.resumeApprovalInput });
    if (answer.decision === "allow-once") {
      this.write(`${this.style("32;1", "✓ approved once")}\n`);
      return answer;
    }
    if (answer.decision === "unavailable") {
      this.write(`${this.style("33;1", "Memory change cancelled; no entry was changed.")}\n`);
      return answer;
    }
    this.write(`${this.style("2", "Memory change denied; no entry was changed.")}\n`);
    return answer;
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
        this.memoryApprovalQuestion,
        (event) => this.handleMemory(event),
        (evidence) => this.handleMemorySearch(evidence),
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
    this.approvalInput = input;
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
    this.pauseApprovalInput = () => readlineInterface.pause();
    this.resumeApprovalInput = () => readlineInterface.resume();
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
    this.memoryApprovalQuestion = this.interactive
      ? (request, signal) => this.askForMemoryApproval(
        request,
        (prompt, callback) => readlineInterface.question(prompt, callback),
        signal,
        () => readlineInterface.write("\n"),
      )
      : undefined;
    let shouldQuit = false;
    let draftWasCleared = false;
    const onInterrupt = () => {
      if (this.cancelActiveTurn()) return;
      if (shouldQuit) return;
      if (readlineInterface.line.trim().length > 0 && !draftWasCleared) {
        readlineInterface.write(null, { ctrl: true, name: "u" });
        draftWasCleared = true;
        this.write(`${this.style("2", "Draft cleared. Press Ctrl+C again to exit.")}\n`);
        if (this.interactive) readlineInterface.prompt();
        return;
      }
      shouldQuit = true;
      this.write(`${this.style("2", "Closing the session.")}\n`);
      // Closing readline does not wake its async iterator on every stream
      // implementation. End readable test/pipe streams as well so the loop
      // cannot leave the process pending after an idle interrupt.
      readlineInterface.close();
      const readable = input as NodeJS.ReadableStream & { push?: (chunk: null) => void };
      readable.push?.(null);
    };
    readlineInterface.on("SIGINT", onInterrupt);
    const onInputData = (chunk: string | Buffer): void => {
      if (String(chunk).includes("\u0003")) onInterrupt();
    };
    input.on("data", onInputData);
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
        if (shouldQuit) break;
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
        draftWasCleared = false;
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
      this.memoryApprovalQuestion = undefined;
      this.approvalInput = undefined;
      this.pauseApprovalInput = undefined;
      this.resumeApprovalInput = undefined;
      readlineInterface.removeListener("SIGINT", onInterrupt);
      input.removeListener("data", onInputData);
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
