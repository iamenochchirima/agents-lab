import readline from "node:readline";
import type { Writable } from "node:stream";
import type { ChatApplication } from "../runtime/application.js";
import type { TurnEvent, TurnResult, TranscriptMessage } from "../runtime/contracts.js";

const COMMANDS = ["/help", "/status", "/history", "/evidence", "/clear", "/quit"] as const;

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
    return `${this.style("36;1", "You")} ${this.style("2", "›")} `;
  }

  printHeader(): void {
    const rule = this.style("2", "────────────────────────────────────────────────────────");
    this.write(`\n${this.style("36;1", "Computer Native")} ${this.style("2", "· standalone terminal agent")}\n`);
    this.write(`${rule}\n`);
    this.write(`${this.style("2", "session")}   ${this.application.sessionId}\n`);
    this.write(`${this.style("2", "model")}     ${this.application.providerLabel}\n`);
    this.write(`${this.style("2", "workspace")} ${this.application.workspaceRoot}\n`);
    this.write(`${this.style("2", "evidence")}  ${this.application.evidenceDirectory}\n`);
    this.write(`${rule}\n`);
    this.write(`${this.style("2", "Type /help for commands · Ctrl+C cancels a turn · Ctrl+D exits")}\n\n`);
  }

  private printHelp(): void {
    this.write(`\n${this.style("36;1", "Commands")}\n`);
    this.write(`  ${this.style("33", "/help")}       Show commands\n`);
    this.write(`  ${this.style("33", "/status")}     Show session and turn status\n`);
    this.write(`  ${this.style("33", "/history")}    Show recent transcript messages\n`);
    this.write(`  ${this.style("33", "/evidence")}   Show the durable evidence directory\n`);
    this.write(`  ${this.style("33", "/clear")}      Clear the terminal view\n`);
    this.write(`  ${this.style("33", "/quit")}       Close the session\n\n`);
    this.write(`${this.style("2", "A line ending in \\ continues into a multiline prompt.")}\n\n`);
  }

  private async printStatus(): Promise<void> {
    const transcript = await this.application.readTranscript();
    const turns = transcript.filter((message) => message.role === "user").length;
    const responses = transcript.filter((message) => message.role === "assistant").length;
    const elapsed = this.startedAt > 0 ? ` · ${formatDuration(Date.now() - this.startedAt)}` : "";
    this.write(`\n${this.style("36;1", "Session status")}\n`);
    this.write(`  session     ${this.application.sessionId}\n`);
    this.write(`  model       ${this.application.providerLabel}\n`);
    this.write(`  workspace   ${this.application.workspaceRoot}\n`);
    this.write(`  state       ${this.status}${this.statusRound > 0 ? ` · round ${this.statusRound}` : ""}${elapsed}\n`);
    this.write(`  turns       ${turns} user · ${responses} assistant\n`);
    this.write(`  evidence    ${this.application.evidenceDirectory}\n\n`);
  }

  private async printHistory(): Promise<void> {
    const transcript = await this.application.readTranscript();
    this.write(`\n${this.style("36;1", "Transcript")} ${this.style("2", `· ${transcript.length} messages`)}\n`);
    for (const message of transcript.slice(-12)) {
      const label = message.role === "user" ? "You" : "Agent";
      const colour = message.role === "user" ? "36;1" : "32;1";
      this.write(`  ${this.style(colour, label.padEnd(5))} ${shorten(message.content.replaceAll("\n", " "), 160)}\n`);
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
        break;
      case "text":
        this.status = "streaming";
        this.statusRound = event.round;
        break;
      case "tool_started":
        this.status = `running ${event.call.name}`;
        this.statusRound = event.round;
        this.write(`\n${this.style("33;1", "↳")} ${event.call.name} ${this.style("2", "started")}\n`);
        break;
      case "tool_completed":
        this.status = event.ok ? "tool completed" : "tool failed";
        this.statusRound = event.round;
        this.write(`${this.style(event.ok ? "32;1" : "31;1", event.ok ? "✓" : "×")} ${event.name} ${this.style("2", event.summary)}\n`);
        break;
      case "status":
        this.status = event.status;
        this.statusRound = event.round;
        break;
    }
  }

  private beginTurn(): void {
    this.startedAt = Date.now();
    this.responseStarted = false;
    this.waiting = false;
    this.status = "starting";
    this.statusRound = 0;
    this.write(`\n${this.style("32;1", "Agent")} ${this.style("2", "· starting")}\n`);
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
    this.write(`\n${this.style(result.status === "completed" ? "32;1" : "31;1", `${icon} ${result.status}`)} ${this.style("2", `· ${detail}`)}\n\n`);
    this.startedAt = 0;
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
