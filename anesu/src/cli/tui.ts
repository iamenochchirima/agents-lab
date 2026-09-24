import readline from "node:readline";
import type { Writable } from "node:stream";
import type { ChatApplication, ComputerUiStatus } from "../runtime/application.js";
import type { TurnEvent, TurnResult, TranscriptMessage } from "../runtime/contracts.js";
import type { MutationApproval, MutationApprovalRequest, MutationApprovalDecision, MutationEvent } from "../workspace/mutation.js";
import type { ProcessApprovalDecision, ProcessApprovalRequest } from "../process/process.js";
import type { ProcessToolEvent } from "../tools/registry.js";
import type { BrowserApprovalDecision, BrowserApprovalRequest, BrowserToolEvent } from "../browser/index.js";
import type { ComputerEvent } from "../computer/runner.js";
import type { ComputerApprovalDecision, ComputerApprovalEvent, ComputerApprovalRequest, ComputerEnvironmentReadiness } from "../computer/contracts.js";
import type { ComputerNativeFallbackRoute, ComputerTaskApprovalDecision, ComputerTaskApprovalRequest } from "../computer/task.js";
import type { CuaAuthorizationDecision, CuaAuthorizationRequestView } from "../browser/cua-authorization.js";
import type { MemoryApproval, MemoryApprovalDecision, MemoryApprovalRequest, MemoryEvent, MemorySearchEvidence } from "../memory/contracts.js";
import type { SkillCatalog } from "../skills/index.js";
import type { ContextSnapshot } from "../context/context.js";
import { AnesuError, redactSecrets, safeErrorMessage } from "../runtime/errors.js";
import { ApprovalPrompt, type ApprovalPanel } from "./approval.js";
import type { ModelProviderSummary } from "../models/registry.js";
import { sanitizeTerminalChunk, sanitizeTerminalSingleLine, sanitizeTerminalText } from "./terminal-safety.js";
import type { SessionSummary } from "../persistence/session-store.js";
import type { ProcessPermissionScope } from "../persistence/process-approval-permissions.js";

const COMMANDS = ["/help", "/status", "/context", "/models", "/history", "/skills", "/memory", "/computer", "/evidence", "/permissions", "/new", "/resume", "/clear", "/quit"] as const;
const PANEL_WIDTH = 72;
const MIN_PANEL_WIDTH = 24;
const MAX_PANEL_WIDTH = 100;
const LABEL_WIDTH = 11;

type TerminalOutput = Writable & { readonly columns?: number };
type TuiComputerTaskIssue = "failed" | "outcome-unknown" | "not-completed" | "cancelled";

export interface TuiSessionController {
  listRecent(): Promise<readonly SessionSummary[]>;
  open(sessionId?: string): Promise<ChatApplication>;
}

function computerTaskIssueLabel(issue: TuiComputerTaskIssue): string {
  switch (issue) {
    case "failed": return "computer task failed";
    case "outcome-unknown": return "computer task outcome unknown";
    case "not-completed": return "computer task did not complete";
    case "cancelled": return "computer task cancelled";
  }
}

export type TuiCommand =
  | { readonly kind: "help" }
  | { readonly kind: "status" }
  | { readonly kind: "context" }
  | { readonly kind: "models" }
  | { readonly kind: "history" }
  | { readonly kind: "skills" }
  | { readonly kind: "memory" }
  | { readonly kind: "computer" }
  | { readonly kind: "evidence" }
  | { readonly kind: "permissions" }
  | { readonly kind: "revoke-permission"; readonly permissionId: string }
  | { readonly kind: "new-session" }
  | { readonly kind: "resume-session"; readonly sessionId?: string }
  | { readonly kind: "clear" }
  | { readonly kind: "quit" }
  | { readonly kind: "unknown"; readonly name: string };

export function parseTuiCommand(input: string): TuiCommand | undefined {
  const value = input.trim();
  if (!value.startsWith("/")) return undefined;
  const parts = value.split(/\s+/u);
  const name = parts[0]?.toLowerCase() ?? value.toLowerCase();
  switch (name) {
    case "/help":
      return { kind: "help" };
    case "/status":
      return { kind: "status" };
    case "/context":
      return { kind: "context" };
    case "/models":
      return { kind: "models" };
    case "/history":
      return { kind: "history" };
    case "/skills":
      return { kind: "skills" };
    case "/memory":
      return { kind: "memory" };
    case "/computer":
      return { kind: "computer" };
    case "/evidence":
      return { kind: "evidence" };
    case "/permissions":
      if (parts.length === 1) return { kind: "permissions" };
      if (parts.length === 3 && parts[1]?.toLowerCase() === "revoke") {
        return { kind: "revoke-permission", permissionId: parts[2]! };
      }
      return { kind: "unknown", name: "Use /permissions or /permissions revoke <permission-id>" };
    case "/new":
      return parts.length === 1 ? { kind: "new-session" } : { kind: "unknown", name: "/new takes no arguments" };
    case "/resume":
      return parts.length <= 2
        ? { kind: "resume-session", ...(parts[1] ? { sessionId: parts[1] } : {}) }
        : { kind: "unknown", name: "/resume accepts at most one session ID" };
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

function browserTargetLabel(request: BrowserApprovalRequest): string {
  if (request.dialog) return `${request.dialog.type} dialog`;
  if (request.action === "scroll") return "page viewport";
  const name = request.targetName === undefined
    ? undefined
    : sanitizeTerminalSingleLine(request.targetName).slice(0, 160);
  const role = request.targetRole === undefined
    ? undefined
    : sanitizeTerminalSingleLine(request.targetRole).slice(0, 64);
  if (name && role) return `${name} (${role})`;
  if (name) return name;
  if (role) return `current ${role}`;
  return "current page element";
}

export function formatComputerApprovalTarget(request: ComputerApprovalRequest): string {
  if (request.targetLabel) {
    const role = request.targetRole ? ` (${request.targetRole})` : "";
    return `${request.displayId} · ${request.targetLabel}${role}`;
  }
  if (request.x === undefined || request.y === undefined) return `${request.displayId} · current foreground target`;
  if (request.endX === undefined || request.endY === undefined) return `${request.displayId} · (${request.x}, ${request.y})`;
  return `${request.displayId} · (${request.x}, ${request.y}) → (${request.endX}, ${request.endY})`;
}

export function formatComputerTaskCompletion(
  completion: ComputerTaskApprovalRequest["completion"],
  surface?: ComputerTaskApprovalRequest["surface"],
): string {
  if (completion.expected) {
    return `${completion.kind} · ${completion.expected}${completion.state ? ` · ${completion.state}` : ""}`;
  }
  if (completion.kind === "none" && surface === "browser") return "model-directed · answer from fresh page evidence";
  return completion.kind === "none" ? "none · terminal assurance unavailable" : completion.kind;
}

export function formatComputerNativeFallback(routes: readonly ComputerNativeFallbackRoute[] | undefined): string | undefined {
  if (!routes || routes.length === 0) return undefined;
  const labels: Record<ComputerNativeFallbackRoute, string> = {
    structured: "structured accessibility",
    "focused-key-text": "focused key/text",
    "background-pixel": "background pixel",
    "foreground-pixel": "foreground pixel",
  };
  return routes.map((route) => labels[route]).join(" → ");
}

function capabilitySummary(capabilities: ModelProviderSummary["capabilities"]): string {
  const supported = [
    capabilities.streaming ? "streaming" : undefined,
    capabilities.toolCalls ? "tools" : undefined,
    capabilities.structuredOutput ? "structured" : undefined,
    capabilities.vision ? "vision" : undefined,
    capabilities.reasoningControls ? "reasoning" : undefined,
    capabilities.usageReporting ? "usage" : undefined,
  ].filter((value): value is string => value !== undefined);
  return `${supported.join(", ") || "no declared capabilities"} · context ${capabilities.contextWindow}`;
}

function computerSummary(computer: ComputerUiStatus | undefined): string {
  if (!computer?.enabled) return "disabled · enable explicitly";
  const environment = computer.environment === "ubuntu-x11-cua" ? "ubuntu-x11-cua" : computer.environment ?? "unselected";
  const isolation = computer.environment === "ubuntu-x11-cua"
    ? computer.isolated === true ? "isolated" : "not isolated"
    : computer.visible === true ? "visible browser" : "managed browser";
  return `${computer.strategy ?? "unselected"} · ${environment} · ${isolation}${computer.model ? ` · ${computer.model}` : ""}${computer.surface ? ` · ${computer.surface} surface` : ""}${computer.browserInputRoute ? ` · ${computer.browserInputRoute}` : ""}`;
}

function panelRule(title: string, width: number): string {
  return `╭─ ${title} ${"─".repeat(Math.max(1, width - title.length - 1))}╮`;
}

function panelBottom(width: number): string {
  return `╰${"─".repeat(width + 2)}╯`;
}

function panelRow(label: string, value: string, width: number): string {
  const safeLabel = shorten(sanitizeTerminalSingleLine(label), LABEL_WIDTH).padEnd(LABEL_WIDTH);
  const clipped = shorten(sanitizeTerminalSingleLine(value), Math.max(1, width - LABEL_WIDTH - 1));
  const content = `${safeLabel} ${clipped}`;
  return `│ ${content}${" ".repeat(Math.max(0, width - content.length))} │`;
}

function commandCompleter(line: string): [string[], string] {
  if (!line.trimStart().startsWith("/")) return [[], line];
  const prefix = line.trimStart().toLowerCase();
  return [COMMANDS.filter((command) => command.startsWith(prefix) || (command === "/quit" && "/exit".startsWith(prefix))), line];
}

export class TerminalUi {
  private readonly openApplications = new Set<ChatApplication>();
  private pendingSessionChoices: readonly SessionSummary[] | undefined;
  private activeController: AbortController | undefined;
  private responseStarted = false;
  private waiting = false;
  private cancellationRequested = false;
  private computerTaskIssue: TuiComputerTaskIssue | undefined;
  private status: string = "ready";
  private statusRound = 0;
  private startedAt = 0;
  private pendingTerminalEscape = "";
  private pendingRedaction = "";
  private readonly colour: boolean;
  private readonly redactionSecrets: readonly string[];
  private approvalQuestion: MutationApproval | undefined;
  private processApprovalQuestion: ((request: ProcessApprovalRequest, signal?: AbortSignal) => Promise<ProcessApprovalDecision>) | undefined;
  private browserApprovalQuestion: ((request: BrowserApprovalRequest, signal?: AbortSignal) => Promise<BrowserApprovalDecision>) | undefined;
  private computerApprovalQuestion: ((request: ComputerApprovalRequest, signal?: AbortSignal) => Promise<ComputerApprovalDecision>) | undefined;
  private computerTaskApprovalQuestion: ((request: ComputerTaskApprovalRequest, signal?: AbortSignal) => Promise<ComputerTaskApprovalDecision>) | undefined;
  private existingProfileAuthorizationQuestion: ((request: CuaAuthorizationRequestView, signal?: AbortSignal) => Promise<CuaAuthorizationDecision>) | undefined;
  private memoryApprovalQuestion: MemoryApproval | undefined;
  private approvalInput: NodeJS.ReadableStream | undefined;
  private pauseApprovalInput: (() => void) | undefined;
  private resumeApprovalInput: (() => void) | undefined;

  constructor(
    private application: ChatApplication,
    private readonly output: Writable,
    private readonly interactive: boolean,
    redactionSecrets: readonly string[] = [],
    private readonly sessions?: TuiSessionController,
  ) {
    this.openApplications.add(application);
    this.colour = interactive && !process.env.NO_COLOR && process.env.TERM !== "dumb";
    this.redactionSecrets = [process.env.OPENROUTER_API_KEY ?? "", ...redactionSecrets]
      .filter((secret, index, values) => secret.length > 0 && values.indexOf(secret) === index);
  }

  private style(code: string, value: string): string {
    value = sanitizeTerminalText(value);
    return this.colour ? `\u001b[${code}m${value}\u001b[0m` : value;
  }

  private write(value: string): void {
    this.output.write(redactSecrets(value, this.redactionSecrets));
  }

  private promptText(): string {
    return `${this.style("33;1", "❯")} ${this.style("36;1", "You")} ${this.style("2", "›")} `;
  }

  private panelWidth(): number {
    const columns = (this.output as TerminalOutput).columns;
    if (columns === undefined || !Number.isSafeInteger(columns) || columns <= 0) return PANEL_WIDTH;
    return Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, columns - 4));
  }

  private printPanel(title: string, rows: readonly (readonly [string, string])[]): void {
    const width = this.panelWidth();
    this.write(`${this.style("33;1", panelRule(title, width))}\n`);
    for (const [label, value] of rows) {
      this.write(`${this.style("2", panelRow(label, value, width))}\n`);
    }
    this.write(`${this.style("33;1", panelBottom(width))}\n`);
  }

  private printActivity(icon: string, message: string, colour = "2"): void {
    this.closeResponseLine();
    message = sanitizeTerminalSingleLine(message);
    this.write(`${this.style(colour, icon)} ${this.style("2", message)}\n`);
  }

  private closeResponseLine(): void {
    this.flushRedactedText();
    if (!this.responseStarted) return;
    this.write("\n");
    this.responseStarted = false;
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
      case "cancelling":
        return "■";
      case "interrupted":
        return "!";
      case "computer task failed":
        return "×";
      case "computer task outcome unknown":
        return "?";
      case "computer task did not complete":
        return "!";
      case "computer task cancelled":
        return "■";
      default:
        return "◆";
    }
  }

  private printStatusLine(): void {
    this.status = sanitizeTerminalSingleLine(this.status);
    const elapsed = this.startedAt > 0 ? ` · ${formatDuration(Date.now() - this.startedAt)}` : "";
    const round = this.statusRound > 0 ? ` · round ${this.statusRound}` : "";
    this.write(`${this.style("2", "│")} ${this.style("33;1", this.statusIcon())} ${this.style("2", this.status)}${this.style("2", `${round}${elapsed}`)}\n`);
  }

  printHeader(): void {
    this.write(`\n${this.style("33;1", "◆")} ${this.style("36;1", "ANESU")} ${this.style("2", "standalone agent console")}\n`);
    this.write(`${this.style("2", "Workspace-first turns with visible activity and durable evidence.")}\n\n`);
    this.printPanel("Session · Available tools", [
      ["model", this.application.providerLabel],
      ["session", this.application.sessionId],
      ["workspace", this.application.workspaceRoot],
      ["computer", computerSummary(this.application.computer)],
      ["tools", this.application.toolNames.join(" · ") || "none registered"],
      ["evidence", this.application.evidenceDirectory],
    ]);
    this.write(`${this.style("2", "Type /help for commands · Ctrl+C cancels · Ctrl+D exits")}\n`);
    this.printStatusLine();
    this.write("\n");
  }

  private printHelp(): void {
    this.write(`\n${this.style("36;1", "Anesu controls")}\n`);
    this.write(`${this.style("33;1", "Session")}\n`);
    this.write(`  ${this.style("33", "/status")}     Show session, model, tools, and turn state\n`);
    this.write(`  ${this.style("33", "/context")}    Inspect the last prepared model context and its budget\n`);
    this.write(`  ${this.style("33", "/models")}     Show provider choices and model capabilities\n`);
    this.write(`  ${this.style("33", "/history")}    Show recent transcript messages\n`);
    this.write(`  ${this.style("33", "/new")}        Start a new conversation\n`);
    this.write(`  ${this.style("33", "/resume")}     Pick a recent conversation\n`);
    this.write(`  ${this.style("33", "/resume ID")}  Resume an exact session ID\n`);
    this.write(`  ${this.style("33", "/skills")}     Show workspace skill packages\n`);
    this.write(`  ${this.style("33", "/memory")}     Show bounded durable-memory status\n`);
    this.write(`  ${this.style("33", "/computer")}   Inspect computer environment, strategy, and readiness\n`);
    this.write(`  ${this.style("33", "/evidence")}   Show the durable evidence directory\n`);
    this.write(`  ${this.style("33", "/permissions")}  List saved process permissions\n`);
    this.write(`  ${this.style("33", "/permissions revoke <permission-id>")}  Revoke one saved permission\n`);
    this.write(`  ${this.style("33", "/clear")}      Redraw the console\n`);
    this.write(`  ${this.style("33", "/quit")}       Close the session\n\n`);
    this.write(`${this.style("33;1", "Input")}\n`);
    this.write(`  ${this.style("2", "Enter")}        Submit a prompt\n`);
    this.write(`  ${this.style("2", "\\ at end")}    Continue into multiline input\n`);
    this.write(`  ${this.style("2", "Ctrl+C")}       Cancel the active turn\n`);
    this.write(`  ${this.style("2", "Ctrl+D")}       Exit the session\n\n`);
    this.write(`${this.style("2", "Commands are intentionally limited to capabilities that exist.")}\n\n`);
  }

  private async printComputer(): Promise<void> {
    const computer = this.application.computer;
    const readiness: ComputerEnvironmentReadiness | undefined = computer.readiness;
    const readinessValue = readiness === undefined
      ? "not probed"
      : readiness.available
        ? "ready"
        : `unavailable · ${readiness.reason ?? "host requirements not met"}`;
    this.write("\n");
    const runs = this.application.readComputerRuns ? await this.application.readComputerRuns() : [];
    const latestRun = runs[0];
    const latestArtifact = latestRun?.lastEvent?.artifactPath
      ? sanitizeTerminalSingleLine(shorten(latestRun.lastEvent.artifactPath, 56))
      : "not captured";
    this.printPanel("Computer use", [
      ["state", computer.enabled ? "enabled" : "disabled · opt-in required"],
      ["environment", computer.environment ?? "not selected"],
      ["surface", computer.surface ?? "auto"],
      ["strategy", computer.strategy ?? "not selected"],
      ["model", computer.model ?? "not selected"],
      ["browser input", computer.browserInputRoute ?? "not selected"],
      ["readiness", readinessValue],
      ["display", readiness?.display ?? "not reported"],
      ["isolation", computer.isolated === undefined ? "not applicable" : computer.isolated ? "isolated" : "not isolated"],
      ["visibility", computer.visible === undefined ? "not reported" : computer.visible ? "visible" : "headless"],
      ...(computer.nativeCatalog ? [["native catalog", computer.nativeCatalog.join(" · ")] as const] : []),
      ["last run", latestRun ? `${latestRun.run.outcome ?? latestRun.run.status} · ${latestRun.eventCount} events` : "none recorded"],
      ["artifact", latestArtifact],
    ]);
    if (runs.length > 0) {
      this.write(`${this.style("36;1", "Recent computer runs") }\n`);
      for (const summary of runs.slice(0, 5)) {
        const latest = summary.lastEvent ? ` · latest ${summary.lastEvent.kind}${summary.lastEvent.artifactPath ? ` · artifact ${shorten(sanitizeTerminalSingleLine(summary.lastEvent.artifactPath), 40)}` : ""}` : "";
        this.write(`  ${this.style("33", shorten(summary.run.runId, 36))} ${this.style("2", `${summary.run.outcome ?? summary.run.status} · ${summary.run.strategy} · ${summary.eventCount} events${latest}`)}\n`);
      }
      this.write("\n");
    }
    this.write(`${this.style("2", "Read-only inspection; enabling or changing computer use is done through configuration.")}\n\n`);
  }

  private printModels(): void {
    const providers = this.application.availableProviders ?? [];
    const rows: Array<readonly [string, string]> = [
      ["active", this.application.providerLabel],
      ["selection", "Choose with --provider and --model before starting a session"],
    ];
    for (const provider of providers) {
      rows.push([provider.provider, `${provider.label} · ${provider.modelHint} · ${capabilitySummary(provider.capabilities)}`]);
    }
    if (providers.length === 0) rows.push(["choices", "Provider registry is unavailable for this session"]);
    this.write("\n");
    this.printPanel("Model providers", rows);
    this.write(`${this.style("2", "Provider/model selection is fixed for the current session; no fallback is automatic.")}\n\n`);
  }

  private async printStatus(): Promise<void> {
    const transcript = await this.application.readTranscript();
    const context = await this.application.readContextSnapshot();
    const turns = transcript.filter((message) => message.role === "user").length;
    const responses = transcript.filter((message) => message.role === "assistant").length;
    const elapsed = this.startedAt > 0 ? ` · ${formatDuration(Date.now() - this.startedAt)}` : "";
    const contextSummary = context
      ? `r${context.revision} · ${context.budget.pressure} · ${context.budget.requestBytes}/${context.budget.maxRequestBytes} bytes`
      : "not prepared";
    this.write("\n");
    this.printPanel("Session status", [
      ["state", `${this.status}${this.statusRound > 0 ? ` · round ${this.statusRound}` : ""}${elapsed}`],
      ["model", this.application.providerLabel],
      ["context", contextSummary],
      ["computer", computerSummary(this.application.computer)],
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
    this.printTranscript(transcript, "Transcript");
  }

  private async printConversationTranscript(): Promise<void> {
    const transcript = await this.application.readTranscript();
    if (transcript.length === 0) return;
    this.printTranscript(transcript, "Recent conversation");
  }

  private printTranscript(transcript: readonly TranscriptMessage[], title: string): void {
    this.write(`\n${this.style("36;1", title)} ${this.style("2", `· ${transcript.length} messages`)}\n`);
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

  private async printContext(): Promise<void> {
    const snapshot: ContextSnapshot | undefined = await this.application.readContextSnapshot();
    if (!snapshot) {
      this.write(`\n${this.style("2", "No prepared context snapshot exists yet. Send a prompt first.")}\n\n`);
      return;
    }
    const compaction = snapshot.compaction
      ? `${snapshot.compaction.removedMessageIds.length} messages · ${snapshot.compaction.reason} · ${snapshot.compaction.removedGroupIds.length} groups removed`
      : "none";
    this.write("\n");
    const rows: Array<readonly [string, string]> = [
      ["pressure", snapshot.budget.pressure],
      ["request", `${snapshot.budget.requestBytes} / ${snapshot.budget.maxRequestBytes} bytes`],
      ["reserved", `${snapshot.budget.reservedOutputBytes} output bytes`],
      ["input", `${snapshot.budget.inputBytes} bytes · ~${snapshot.budget.estimatedInputTokens} tokens`],
      ["snapshot", snapshot.snapshotId],
      ["revision", `${snapshot.revision}${snapshot.previousSnapshotId ? ` · after ${shorten(snapshot.previousSnapshotId, 24)}` : " · initial"}`],
      ["compaction", compaction],
    ];
    if (snapshot.compaction?.beforeRequestBytes !== undefined && snapshot.compaction.afterRequestBytes !== undefined) {
      rows.push(["budget", `${snapshot.compaction.beforeRequestBytes} → ${snapshot.compaction.afterRequestBytes} bytes`]);
    }
    this.printPanel("Prepared context", rows);
    this.write(`${this.style("36;1", "Sources")}\n`);
    for (const source of snapshot.sources) {
      const detail = source.status === "omitted"
        ? `${source.status} · ${source.reason ?? "no reason recorded"}`
        : `${source.status} · ${source.selectedBytes}/${source.bytes} bytes`;
      const colour = source.status === "omitted" ? "31" : source.status === "truncated" ? "33" : "2";
      this.write(`  ${this.style(colour, source.id.padEnd(24))} ${this.style("2", detail)}\n`);
    }
    this.write("\n");
  }

  private async printSkills(): Promise<void> {
    if (!this.application.readSkills) {
      this.write(`\n${this.style("2", "Workspace skills are not available for this session.")}\n\n`);
      return;
    }
    const catalog: SkillCatalog = await this.application.readSkills();
    this.write("\n");
    this.printPanel("Workspace skills", [
      ["available", `${catalog.skills.length}`],
      ["location", "skills/"],
      ["loading", "read-only · exact id required"],
    ]);
    for (const skill of catalog.skills) {
      const version = skill.version ? ` · v${skill.version}` : "";
      this.write(`  ${this.style("33", skill.id)} ${this.style("2", shorten(`${skill.name}${version} · ${skill.description}`, 210))}\n`);
    }
    if (catalog.skills.length === 0) this.write(`  ${this.style("2", "No valid workspace skills found.")}\n`);
    if (catalog.skipped > 0) this.write(`  ${this.style("2", `${catalog.skipped} invalid or bounded-out package${catalog.skipped === 1 ? "" : "s"} skipped.`)}\n`);
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
      case "context":
        await this.printContext();
        return true;
      case "models":
        this.printModels();
        return true;
      case "history":
        await this.printHistory();
        return true;
      case "skills":
        await this.printSkills();
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
      case "computer":
        await this.printComputer();
        return true;
      case "evidence":
        this.printEvidence();
        return true;
      case "permissions":
        await this.printPermissions();
        return true;
      case "revoke-permission":
        await this.revokePermission(command.permissionId);
        return true;
      case "new-session":
        await this.switchSession();
        return true;
      case "resume-session":
        if (command.sessionId) await this.switchSession(command.sessionId);
        else await this.showSessionPicker();
        return true;
      case "clear":
        if (this.interactive) this.write("\u001b[2J\u001b[H");
        this.printHeader();
        await this.printConversationTranscript();
        return true;
      case "quit":
        return false;
      case "unknown":
        this.write(`\nUnknown command '${command.name}'. Type /help to see available commands.\n\n`);
        return true;
    }
  }

  private printEvidence(): void {
    this.write("\nEvidence directory:\n");
    this.write(sanitizeTerminalText(this.application.evidenceDirectory) + "\n\n");
  }

  private async printPermissions(): Promise<void> {
    const permissions = this.application.processPermissions;
    if (!permissions) {
      this.write(`\n${this.style("31", "Saved permissions are unavailable in this invocation.")}\n\n`);
      return;
    }
    try {
      const grants = await permissions.list();
      this.write("\n");
      this.printPanel("Saved process permissions", [
        ["scope", "current conversation and local profile"],
        ["matching", "exact command, arguments, directory, environment, limits, and executable version"],
      ]);
      if (grants.length === 0) {
        this.write(`  ${this.style("2", "No saved process permissions.")}\n\n`);
        return;
      }
      for (const grant of grants) {
        this.write(`  ${this.style("36", grant.id)} · ${grant.scope === "conversation" ? "this conversation" : "local profile"}\n`);
        this.write(`    ${sanitizeTerminalSingleLine(grant.label)}\n`);
        this.write(`    created ${grant.createdAt}${grant.lastUsedAt ? ` · last used ${grant.lastUsedAt}` : " · not used yet"}\n`);
      }
      this.write(`\n${this.style("2", "Revoke with /permissions revoke <permission-id>.")}\n\n`);
    } catch (error) {
      this.write(`\n${this.style("31", `Saved permissions could not be read: ${safeErrorMessage(error)}`)}\n\n`);
    }
  }

  private async revokePermission(permissionId: string): Promise<void> {
    const permissions = this.application.processPermissions;
    if (!permissions) {
      this.write(`\n${this.style("31", "Saved permissions are unavailable in this invocation.")}\n\n`);
      return;
    }
    try {
      const revoked = await permissions.revoke(permissionId);
      this.write(revoked
        ? `\n${this.style("32;1", `Revoked saved process permission ${permissionId}. Future matching commands will ask again.`)}\n\n`
        : `\n${this.style("31", `No saved process permission '${permissionId}' was found for this conversation or local profile.`)}\n\n`);
    } catch (error) {
      this.write(`\n${this.style("31", `Permission was not revoked: ${safeErrorMessage(error)}`)}\n\n`);
    }
  }

  private async showSessionPicker(): Promise<void> {
    if (!this.sessions) {
      this.write(`\n${this.style("31", "Session switching is unavailable in this invocation.")}\n\n`);
      return;
    }
    const sessions = await this.sessions.listRecent();
    this.pendingSessionChoices = sessions;
    this.write("\n");
    this.printPanel("Recent conversations", [
      ["current", this.application.sessionId],
      ["selection", "Enter a number or exact session ID · /cancel to keep current"],
    ]);
    if (sessions.length === 0) {
      this.write(`  ${this.style("2", "No saved conversations found.")}\n\n`);
      this.pendingSessionChoices = undefined;
      return;
    }
    sessions.forEach((session, index) => {
      const time = session.lastActivityAt ?? session.createdAt ?? "time unavailable";
      const preview = session.lastMessage
        ? ` · ${session.lastMessage.role}: ${session.lastMessage.preview}`
        : "";
      const state = session.state === "available" ? "" : " · unavailable metadata";
      this.write(`  ${this.style("33", `${index + 1}.`)} ${this.style("36", session.sessionId)} ${this.style("2", `${time}${state}${preview}`)}\n`);
    });
    this.write("\n");
  }

  private async selectSession(value: string): Promise<boolean> {
    const choices = this.pendingSessionChoices;
    if (!choices) return false;
    if (value === "/cancel" || value.toLowerCase() === "cancel" || value.toLowerCase() === "q") {
      this.pendingSessionChoices = undefined;
      this.write(`${this.style("2", "Keeping the current conversation.")}\n`);
      return true;
    }
    if (value === "/new") {
      this.pendingSessionChoices = undefined;
      await this.switchSession();
      return true;
    }
    const command = parseTuiCommand(value);
    if (value.startsWith("/") && command) {
      this.pendingSessionChoices = undefined;
      return false;
    }
    const index = /^\d+$/u.test(value) ? Number(value) - 1 : -1;
    const selected = index >= 0 ? choices[index] : choices.find((session) => session.sessionId === value);
    if (!selected) {
      this.write(`${this.style("31", "Choose a listed number or exact session ID; use /cancel to keep the current conversation.")}\n`);
      return true;
    }
    this.pendingSessionChoices = undefined;
    await this.switchSession(selected.sessionId);
    return true;
  }

  private async switchSession(sessionId?: string): Promise<void> {
    if (!this.sessions) {
      this.write(`\n${this.style("31", "Session switching is unavailable in this invocation.")}\n\n`);
      return;
    }
    if (sessionId && sessionId === this.application.sessionId) {
      this.write(`\n${this.style("2", "That conversation is already active.")}\n\n`);
      return;
    }
    if (this.activeController || this.waiting) {
      this.write(`\n${this.style("33;1", "Finish or cancel the active turn before switching conversations.")}\n\n`);
      return;
    }
    const current = this.application;
    let next: ChatApplication;
    try {
      // Keep the current app active until the destination has opened and acquired its lock.
      next = await this.sessions.open(sessionId);
    } catch (error) {
      const message = error instanceof AnesuError && error.code === "session-not-found"
        ? "No conversation has that exact ID. Use /resume to choose from recent conversations."
        : safeErrorMessage(error);
      this.printActivity("×", `conversation not switched · ${message}`, "31;1");
      return;
    }
    this.openApplications.add(next);
    this.application = next;
    this.pendingSessionChoices = undefined;
    this.write(`\n${this.style("32;1", sessionId ? "Resumed conversation" : "Started new conversation")} ${this.style("36", next.sessionId)}\n\n`);
    this.write(`${this.style("2", "Any live browser from the previous conversation was closed; it is not carried into this one.")}\n\n`);
    await this.printConversationTranscript();
    try {
      await current.close();
      this.openApplications.delete(current);
    } catch (error) {
      this.write(`${this.style("31", `Previous session cleanup failed: ${safeErrorMessage(error)}`)}\n`);
    }
  }

  async close(): Promise<void> {
    let firstError: unknown;
    for (const application of this.openApplications) {
      try {
        await application.close();
        this.openApplications.delete(application);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  }

  private handleEvent(event: TurnEvent): void {
    switch (event.type) {
      case "context_prepared":
        this.status = `context prepared · revision ${event.revision}`;
        this.statusRound = 0;
        this.printActivity("◇", `context · prepared · revision ${event.revision} · ${event.sourceCount} sources · ${event.requestBytes}/${event.maxRequestBytes} bytes`);
        break;
      case "context_compacted":
        this.status = `context compacted · ${event.reason}`;
        this.statusRound = 0;
        this.printActivity("≈", `context · compacted · ${event.removedMessageCount} messages · ${event.reason}`, "33;1");
        break;
      case "context_round_compacted":
        this.status = `context round ${event.round} compacted`;
        this.statusRound = event.round;
        this.printActivity("≈", `context · round ${event.round} compacted · ${event.removedMessageCount} messages · ${event.removedGroupCount} groups`, "33;1");
        break;
      case "context_pressure":
        this.status = `context pressure · ${event.pressure}`;
        this.statusRound = 0;
        this.printActivity("!", `context · pressure ${event.pressure}${event.reason ? ` · ${event.reason}` : ""}`, "33;1");
        break;
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
        if (!event.ok && event.name === "computer") this.computerTaskIssue ??= "failed";
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
        if (event.code === "reconciliation-required") {
          this.status = `workspace change outcome unknown: ${path}`;
          this.printActivity("?", `workspace change · partial/uncertain · ${path} · ${event.reason}`, "33;1");
          break;
        }
        this.status = `workspace change failed: ${path}`;
        this.printActivity("×", `workspace change · failed ${path} · ${event.reason}`, "31;1");
        break;
    }
  }

  private handleProcess(event: ProcessToolEvent): void {
    switch (event.type) {
      case "prepared":
        this.status = `command approval: ${event.request.command}`;
        this.printActivity("◇", `command · checking permission · ${event.request.command} ${event.request.displayArgs.join(" ")}`, "33;1");
        break;
      case "approval_decided":
        if (event.decision.decision === "allow-once") {
          const grant = event.decision.permissionGrant;
          const source = grant ? ` by ${grant.scope} permission ${grant.id}` : " once";
          this.status = `command approved: ${event.request.command}`;
          this.printActivity("✓", `command · approved${source} · ${event.request.command}`, "32;1");
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
        if (event.result.state === "ambiguous") {
          this.status = `command outcome unknown: ${event.request.command}`;
          this.printActivity("?", `command · outcome unknown · ${event.request.command}`, "33;1");
          break;
        }
        this.status = `command ${event.result.state}: ${event.request.command}`;
        this.printActivity(event.result.state === "completed" && event.result.errorCode === undefined ? "✓" : "×", `command · ${event.result.state} · ${event.request.command}`, event.result.state === "completed" && event.result.errorCode === undefined ? "32;1" : "31;1");
        const output = [
          event.result.stdout.length > 0 ? event.result.stdout : undefined,
          event.result.stderr.length > 0 ? `stderr: ${event.result.stderr}` : undefined,
        ].filter((value): value is string => value !== undefined).join(" · ");
        if (output.length > 0) this.printActivity("│", `command output · ${shorten(sanitizeTerminalSingleLine(output), 512)}`);
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
        {
          const taskGrant = event.request.taskId !== undefined
            && event.request.grantHash !== undefined
            && event.request.approvalScope !== "action";
          this.status = taskGrant ? `browser · task grant covers ${event.request.action}` : `browser approval: ${event.request.action}`;
          this.printActivity("◇", `browser · ${taskGrant ? "task grant covers" : "approval requested"} · ${event.request.action} ${browserTargetLabel(event.request)}`, "33;1");
        }
        break;
      case "approval_decided":
        if (event.decision.decision === "allow-once") {
          const taskGrant = event.request.taskId !== undefined
            && event.request.grantHash !== undefined
            && event.request.approvalScope !== "action";
          this.status = `${taskGrant ? "browser task grant covers" : "browser approved"}: ${event.request.action}`;
          const dialogDecision = event.decision.dialogDecision ? ` · ${event.decision.dialogDecision}` : "";
          this.printActivity("✓", `browser · ${taskGrant ? "task-grant" : "approved"} · ${event.request.action}${dialogDecision}`, "32;1");
        } else {
          this.status = `browser ${event.request.action} not approved`;
          this.printActivity("×", `browser · ${event.request.action} not approved`, "31;1");
        }
        break;
      case "started":
        this.status = `browser ${event.request.action} running`;
        this.printActivity("↳", `browser · ${event.request.action} running · ${browserTargetLabel(event.request)}`, "33;1");
        break;
      case "completed":
        const outcomeUnknown = !event.ok && event.errorCode === "browser-ambiguous";
        this.status = outcomeUnknown ? "browser action outcome unknown" : event.ok ? "browser action completed" : "browser action failed";
        const dialogText = event.dialog
          ? ` · dialog ${event.dialog.type}: ${sanitizeTerminalSingleLine(redactSecrets(event.dialog.message, this.redactionSecrets))}`
          : "";
        this.printActivity(outcomeUnknown ? "?" : event.ok ? "✓" : "×", `browser · ${event.request.action} · ${outcomeUnknown ? "outcome unknown" : event.summary}${dialogText}${event.cancellationConfirmed === true ? " · cancellation confirmed" : event.cancellationConfirmed === false ? " · cancellation unconfirmed" : ""}`, outcomeUnknown ? "33;1" : event.ok ? "32;1" : "31;1");
        break;
    }
  }

  private handleComputer(event: ComputerEvent): void {
    switch (event.type) {
      case "routed":
        this.status = `computer · routing · ${event.surface}`;
        this.printActivity("◇", `computer · route · ${event.surface} · ${event.reason}`, "36;1");
        break;
      case "started":
        this.status = `computer · ${event.strategy} · starting`;
        this.printActivity("◌", `computer · ${event.strategy} · observe · goal: ${shorten(sanitizeTerminalSingleLine(event.goal), 96)} · ${event.surface ?? event.environment ?? "selected"}${event.fallbackFrom ? ` · fallback from ${event.fallbackFrom}` : ""}`, "36;1");
        break;
      case "observed":
        this.status = `computer · ${event.strategy} · step ${event.step ?? 0}`;
        this.printActivity("⌕", `computer · observed · ${event.candidateCount} candidate${event.candidateCount === 1 ? "" : "s"} · step ${event.step ?? 0}${event.maxActions === undefined ? "" : `/${event.maxActions}`} · observing${event.cursorX === undefined || event.cursorY === undefined ? "" : ` · cursor ${event.cursorX},${event.cursorY}`}`, "36;1");
        break;
      case "decision_attempt":
        this.status = event.retrying
          ? `computer · ${event.strategy} · retrying decision`
          : `computer · ${event.strategy} · decision failed`;
        this.printActivity(event.retrying ? "↻" : "×", `computer · ${event.strategy} · decision attempt ${event.attempt}/${event.maxAttempts} failed${event.retrying ? " · retrying" : ""} · ${event.reason}`, event.retrying ? "33;1" : "31;1");
        break;
      case "proposed":
        this.status = `computer · ${event.strategy} · step ${event.step ?? "?"} · proposal`;
        this.printActivity("◇", `computer · ${event.strategy} · proposed ${event.operation} ${event.targetLabel ? `“${sanitizeTerminalSingleLine(event.targetLabel)}” ` : ""}${event.candidateId}${event.confidence === undefined ? "" : ` · confidence ${(event.confidence * 100).toFixed(0)}%`} · step ${event.step ?? "?"}${event.maxActions === undefined ? "" : `/${event.maxActions}`}`, "33;1");
        break;
      case "abstained":
        this.computerTaskIssue ??= "not-completed";
        this.status = `computer · ${event.strategy} · ${event.outcome ?? "abstained"}`;
        this.printActivity("!", `computer · ${event.outcome ?? "abstained"}${event.errorCode ? ` · ${event.errorCode}` : ""} · ${event.reason}`, "33;1");
        break;
      case "act_requested":
        this.status = `computer · ${event.strategy} · step ${event.step ?? "?"} · approval`;
        this.printActivity("↳", `computer · step ${event.step ?? "?"}${event.maxActions === undefined ? "" : `/${event.maxActions}`} · dispatch requested · ${event.operation} · ${event.candidateId}`, "33;1");
        break;
      case "verified":
        if (event.terminal !== false) {
          this.computerTaskIssue = event.success
            ? undefined
            : event.outcome === "outcome-unknown" ? "outcome-unknown" : "failed";
        }
        this.status = event.success ? "computer · completed" : `computer · ${event.outcome ?? "outcome-unknown"}`;
        this.printActivity(event.success ? "✓" : event.outcome === "outcome-unknown" ? "?" : "×", `computer · verify · ${event.success ? "success" : event.outcome ?? "failed"}${event.verifier ? ` · ${event.verifier}` : ""} · step ${event.step ?? "?"}${event.reason ? ` · ${sanitizeTerminalSingleLine(event.reason)}` : ""}`, event.success ? "32;1" : event.outcome === "outcome-unknown" ? "33;1" : "31;1");
        break;
      case "cancelled":
        this.computerTaskIssue ??= "cancelled";
        this.status = `computer · ${event.strategy} · cancelled`;
        this.printActivity("■", `computer · cancelled${event.actionId ? ` · ${event.actionId}` : ""} · ${event.reason}`, "2");
        break;
      case "failed":
        this.computerTaskIssue ??= event.outcome === "outcome-unknown" || event.runStatus === "outcome-unknown"
          ? "outcome-unknown"
          : "failed";
        this.status = `computer · ${event.strategy} · ${event.outcome ?? "failed"}`;
        this.printActivity("×", `computer · ${event.strategy} · ${event.outcome ?? "failed"}${event.errorCode ? ` · ${event.errorCode}` : ""} · ${event.reason}`, "31;1");
        break;
    }
  }

  private handleComputerApproval(event: ComputerApprovalEvent): void {
    const request = event.request;
    const target = formatComputerApprovalTarget(request);
    const strategy = request.strategy === "typesafe" ? "Jev" : request.strategy === "traditional" ? "traditional vision" : request.strategy === "compare" ? "compare" : undefined;
    const taskGrant = request.taskId !== undefined && request.grantHash !== undefined;
    if (event.type === "prepared") {
      this.status = taskGrant ? "computer · task grant covers action" : "computer approval requested";
      this.printActivity("◇", `computer · ${taskGrant ? "task grant covers" : "approval requested"}${strategy ? ` · ${strategy}` : ""} · ${request.operation} · ${target}`, "33;1");
      return;
    }
    this.status = event.decision.decision === "allow-once" ? "computer approved" : "computer not approved";
    const decisionLabel = taskGrant && event.decision.decision === "allow-once" ? "task-grant" : event.decision.decision;
    this.printActivity(event.decision.decision === "allow-once" ? "✓" : "×", `computer · ${decisionLabel}${strategy ? ` · ${strategy}` : ""} · ${request.operation} · ${target}`, event.decision.decision === "allow-once" ? "32;1" : "31;1");
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
      case "batch_committed":
        this.status = `memory batch committed: ${event.results.length} changes`;
        this.printActivity("✓", `memory · batch committed · ${event.results.length} changes`, "32;1");
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
    this.pendingTerminalEscape = "";
    this.pendingRedaction = "";
    this.waiting = false;
    this.cancellationRequested = false;
    this.computerTaskIssue = undefined;
    this.status = "starting";
    this.statusRound = 0;
    this.write(`\n${this.style("36;1", "┌ turn")} ${this.style("2", "starting model run")}\n`);
  }

  private appendText(text: string): void {
    const sanitized = sanitizeTerminalChunk(text, this.pendingTerminalEscape);
    this.pendingTerminalEscape = sanitized.pending;
    if (sanitized.text.length === 0) return;
    if (!this.responseStarted) {
      this.write(`${this.style("32;1", "Agent")} ${this.style("2", "›")} `);
      this.responseStarted = true;
    }
    this.appendRedactedText(sanitized.text);
  }

  private redactionSuffixStart(value: string): number {
    let start = value.length;
    // Provider chunks can split a credential between writes. Hold only a suffix
    // that could still become a known secret or a provider-shaped key; ordinary
    // model text remains streaming instead of waiting for the whole response.
    for (const secret of this.redactionSecrets) {
      const maximumPrefixLength = Math.min(secret.length - 1, value.length);
      for (let length = maximumPrefixLength; length > 0; length -= 1) {
        if (value.endsWith(secret.slice(0, length))) {
          start = Math.min(start, value.length - length);
          break;
        }
      }
    }
    const providerToken = /(?:^|[\s"'`([{=:])(sk-[A-Za-z0-9._-]*)$/u.exec(value)?.[1];
    if (providerToken !== undefined) start = Math.min(start, value.length - providerToken.length);
    return start;
  }

  private appendRedactedText(text: string): void {
    const combined = `${this.pendingRedaction}${text}`;
    const suffixStart = this.redactionSuffixStart(combined);
    this.pendingRedaction = combined.slice(suffixStart);
    const safe = combined.slice(0, suffixStart);
    if (safe.length > 0) this.write(safe);
  }

  private flushRedactedText(): void {
    if (this.pendingRedaction.length === 0) return;
    const pending = this.pendingRedaction;
    this.pendingRedaction = "";
    this.write(pending);
  }

  private finishTurn(result: TurnResult): void {
    this.closeResponseLine();
    this.pendingTerminalEscape = "";
    const elapsed = formatDuration(Date.now() - this.startedAt);
    const computerIssue = result.status === "completed" ? this.computerTaskIssue : undefined;
    const issueLabel = computerIssue ? computerTaskIssueLabel(computerIssue) : undefined;
    const icon = issueLabel
      ? computerIssue === "outcome-unknown" ? "?" : "!"
      : result.status === "completed" ? "✓" : result.status === "cancelled" ? "■" : result.status === "interrupted" ? "!" : "×";
    const terminalLabel = issueLabel ? `turn completed · ${issueLabel}` : result.status;
    const detail = result.status === "completed"
      ? `${elapsed}${result.usage?.outputTokens === undefined ? "" : ` · ${result.usage.outputTokens} output tokens`}`
      : result.error?.message ?? "No assistant response was committed.";
    const terminalColour = issueLabel ? "33;1" : result.status === "completed" ? "32;1" : "31;1";
    this.status = issueLabel ?? result.status;
    this.statusRound = 0;
    this.waiting = false;
    this.cancellationRequested = false;
    this.write(`\n${this.style(terminalColour, `${icon} ${terminalLabel}`)} ${this.style("2", `· ${detail}`)}\n`);
    this.printStatusLine();
    this.write(`${this.style("2", "────────────────────────────────────────────────────────────")}\n\n`);
    this.startedAt = 0;
  }

  private finishUnexpectedError(error: unknown): void {
    this.closeResponseLine();
    this.pendingTerminalEscape = "";
    const message = shorten(sanitizeTerminalSingleLine(safeErrorMessage(error)) || "Unexpected failure.", 1_000);
    this.status = "failed";
    this.statusRound = 0;
    this.waiting = false;
    this.cancellationRequested = false;
    this.write(`${this.style("31;1", "× failed")} ${this.style("2", `· ${message}`)}\n`);
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
      ? `${request.paths?.length ?? request.members?.length ?? 0} files · ${request.totalBytes ?? "?"} bytes · +${request.addedLines} / -${request.removedLines} lines`
      : request.operation === "mkdir" ? "create directory" : request.operation === "delete-directory" ? "delete empty directory" : request.operation === "delete-directory-tree" ? `quarantine directory tree · ${request.entryCount ?? "?"} entries · ${request.totalBytes ?? "?"} bytes` : request.operation === "delete" ? "quarantine file" : request.operation === "restore-directory" ? "restore directory tree" : request.operation === "purge-quarantine" ? "permanently remove quarantine entry" : request.operation === "restore" ? "restore file" : request.operation === "copy" ? (isDirectoryAction ? `copy directory tree · ${request.entryCount ?? "?"} entries · ${request.totalBytes ?? "?"} bytes` : "copy file") : request.operation === "move" ? (isDirectoryAction ? `move directory tree · ${request.entryCount ?? "?"} entries · ${request.totalBytes ?? "?"} bytes` : "move file") : request.operation === "rename" ? (isDirectoryAction ? `rename directory tree · ${request.entryCount ?? "?"} entries · ${request.totalBytes ?? "?"} bytes` : "rename file") : `+${request.addedLines} / -${request.removedLines} lines`;
    const panel: ApprovalPanel = {
      title: "Proposed workspace change",
      risk,
      action: request.operation,
      target: request.path,
      scope: "workspace",
      identity: `mutation ${request.mutationId}`,
      expiry: `${request.approvalTimeoutMs ?? "?"}ms from prompt`,
      extra: [
        ...(request.paths && request.paths.length > 0 ? [["paths", request.paths.join(", ")] as const] : []),
        ["change", change],
        ...(request.maxBytes !== undefined ? [["byte limit", `${request.maxBytes} bytes maximum`] as const] : []),
        ["before", request.beforeHash ?? "absent"],
        ["after", request.afterHash ?? (request.operation === "mkdir" ? "directory" : request.operation === "delete-directory" ? "absent" : request.operation === "delete-directory-tree" ? "quarantine" : request.operation === "delete" ? "quarantine" : request.operation === "restore-directory" ? "restored" : request.operation === "purge-quarantine" ? "permanently removed" : request.operation === "restore" ? "restored" : "not recorded")],
      ],
      preview: `${change}\n${request.diff}`,
      details: [
        `paths: ${request.paths?.join(", ") ?? request.path}`,
        `approval timeout: ${request.approvalTimeoutMs ?? "unknown"}ms from prompt`,
        `before: ${request.beforeHash ?? "absent"}`,
        `after: ${request.afterHash ?? (request.operation === "mkdir" ? "directory" : request.operation === "delete-directory" ? "absent" : request.operation === "delete-directory-tree" ? "quarantine" : request.operation === "delete" ? "quarantine" : request.operation === "restore-directory" ? "restored" : request.operation === "purge-quarantine" ? "permanently removed" : request.operation === "restore" ? "restored" : "not recorded")}`,
        request.diff,
      ].join("\n"),
      redactionSecrets: this.redactionSecrets,
    };
    const answer = await new ApprovalPrompt({ output: this.output, colour: this.colour, width: this.panelWidth() }).ask(panel, { question, signal, cancelQuestion, rawInput: this.approvalInput, pauseRawInput: this.pauseApprovalInput, resumeRawInput: this.resumeApprovalInput });
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
    const permissions = this.application.processPermissions;
    const identityHash = request.permissionIdentity;
    const maySave = Boolean(permissions && identityHash && !request.displayArgs.some((argument) => argument.includes("[REDACTED]")));
    if (maySave && identityHash) {
      try {
        const saved = await permissions!.find(identityHash);
        if (saved) {
          this.write(`${this.style("32;1", `✓ allowed by ${saved.scope === "conversation" ? "conversation" : "local profile"} permission ${saved.id}`)}\n`);
          return { decision: "allow-once", permissionGrant: { id: saved.id, scope: saved.scope } };
        }
      } catch (error) {
        this.write(`${this.style("31", `Saved permission check failed; the command was not started: ${safeErrorMessage(error)}`)}\n`);
        return { decision: "unavailable", reason: "Saved process permissions could not be safely checked." };
      }
    }
    const command = [request.command, ...request.displayArgs.map((argument) => JSON.stringify(argument))].join(" ");
    const panel: ApprovalPanel = {
      title: "Proposed local process",
      risk: "local-process",
      action: request.command,
      target: request.executablePath,
      scope: request.cwd,
      identity: `execution ${request.executionId} · argv ${request.argvHash}`,
      expiry: `${request.approvalTimeoutMs ?? "?"}ms from prompt`,
      extra: maySave ? [["saved match", "exact request digest; command details are not stored"]] : undefined,
      preview: `${command}\n${request.warning}`,
      details: [
        `command: ${command}`,
        `environment: ${request.environmentProfile} · ${request.environmentKeys.join(", ")}`,
        `limits: ${request.limits.timeoutMs}ms · ${request.limits.maxOutputBytes} output bytes`,
        `argv hash: ${request.argvHash}`,
        `approval timeout: ${request.approvalTimeoutMs ?? "unknown"}ms from prompt`,
        `warning: ${request.warning}`,
      ].join("\n"),
      redactionSecrets: this.redactionSecrets,
    };
    const localLabel = maySave ? "Always allow this exact command here" : undefined;
    const answer = await new ApprovalPrompt({ output: this.output, colour: this.colour, width: this.panelWidth() }).ask(panel, {
      question,
      signal,
      cancelQuestion,
      rawInput: this.approvalInput,
      pauseRawInput: this.pauseApprovalInput,
      resumeRawInput: this.resumeApprovalInput,
      allowConversation: maySave,
      allowLocalLabel: localLabel,
    });
    if (answer.decision === "unavailable") {
      this.write(`${this.style("33;1", "Approval cancelled; the process was not started.")}\n`);
      return answer;
    }
    if (answer.decision === "allow-once") {
      this.write(`${this.style("32;1", "✓ approved once")}\n`);
      return { decision: "allow-once" };
    }
    if ((answer.decision === "allow-conversation" || answer.decision === "allow-local") && maySave && identityHash && permissions) {
      const scope: ProcessPermissionScope = answer.decision === "allow-conversation" ? "conversation" : "local";
      try {
        const grant = await permissions.save(scope, identityHash, `${request.executablePath} · argv ${request.argvHash.slice(0, 12)} · cwd ${request.cwd}`);
        this.write(`${this.style("32;1", `✓ permission saved for ${scope === "conversation" ? "this conversation" : "this local profile"} · ${grant.id}`)}\n`);
        return { decision: "allow-once", permissionGrant: { id: grant.id, scope: grant.scope } };
      } catch (error) {
        this.write(`${this.style("31", `Permission was not saved; command not started: ${safeErrorMessage(error)}`)}\n`);
        return { decision: "unavailable", reason: "The requested process permission could not be saved safely." };
      }
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
    const targetLabel = request.targetName === undefined
      ? undefined
      : sanitizeTerminalSingleLine(request.targetName).slice(0, 160);
    const targetDescription = browserTargetLabel(request);
    const approvalScope = request.approvalScope ?? "action";
    const preview = [
      request.origin === undefined ? undefined : `site: ${request.origin}`,
      request.text === undefined ? undefined : `text: ${request.text}`,
      request.key === undefined ? undefined : `key: ${request.key}`,
      request.value === undefined ? undefined : `value: ${request.value}`,
      request.direction === undefined ? undefined : `direction: ${request.direction}`,
      request.amount === undefined ? undefined : `amount: ${request.amount}px`,
      request.path === undefined ? undefined : `path: ${request.path}`,
      request.maxBytes === undefined ? undefined : `max bytes: ${request.maxBytes}`,
      request.inputRoute === undefined ? undefined : `input route: ${request.inputRoute}`,
      request.dialog === undefined ? undefined : `dialog: ${request.dialog.type}: ${request.dialog.message}`,
      request.step === undefined ? undefined : `step: ${request.step}${request.maxActions === undefined ? "" : `/${request.maxActions}`}`,
      request.expectedVerification === undefined ? undefined : `verify: ${request.expectedVerification.kind}${request.expectedVerification.expected ? ` · ${request.expectedVerification.expected}` : ""}${request.expectedVerification.state ? ` · ${request.expectedVerification.state}` : ""}`,
      request.warning,
    ].filter((value): value is string => value !== undefined).join("\n");
    const panel: ApprovalPanel = {
      title: "Proposed browser interaction",
      risk: request.dialog ? "page-dialog" : "browser-interaction",
      action: request.action,
      target: targetDescription,
      scope: `${request.origin ?? "current browser origin"} · managed browser session`,
      identity: `action ${request.actionId} · ${request.actionHash}`,
      expiry: `${request.approvalTimeoutMs ?? "?"}ms from prompt`,
      extra: [
        ["approval scope", approvalScope === "action" ? "this exact action" : "approved browser task"],
        ...(request.targetRole === undefined ? [] : [["target role", sanitizeTerminalSingleLine(request.targetRole).slice(0, 64)] as const]),
        ...(targetLabel === undefined ? [] : [["target name", targetLabel] as const]),
        ...(request.origin === undefined ? [] : [["site", request.origin] as const]),
        ...(request.text === undefined ? [] : [["text", request.text] as const]),
        ...(request.key === undefined ? [] : [["key", request.key] as const]),
        ...(request.value === undefined ? [] : [["value", request.value] as const]),
        ...(request.direction === undefined ? [] : [["direction", request.direction] as const]),
        ...(request.amount === undefined ? [] : [["amount", `${request.amount}px`] as const]),
        ...(request.path === undefined ? [] : [["path", request.path] as const]),
        ...(request.maxBytes === undefined ? [] : [["max bytes", String(request.maxBytes)] as const]),
        ...(request.inputRoute === undefined ? [] : [["input route", request.inputRoute] as const]),
        ...(request.dialog === undefined ? [] : [["dialog", `${request.dialog.type}: ${request.dialog.message}`] as const]),
        ...(request.step === undefined ? [] : [["step", `${request.step}${request.maxActions === undefined ? "" : `/${request.maxActions}`}`] as const]),
        ...(request.expectedVerification === undefined ? [] : [["verify", `${request.expectedVerification.kind}${request.expectedVerification.expected ? ` · ${request.expectedVerification.expected}` : ""}${request.expectedVerification.state ? ` · ${request.expectedVerification.state}` : ""}`] as const]),
        ["hash", request.actionHash],
        ["approval", `${request.approvalTimeoutMs ?? "?"}ms from prompt`],
      ],
      preview,
      details: [
        `approval scope: ${approvalScope}`,
        ...(request.origin === undefined ? [] : [`site: ${request.origin}`]),
        ...(request.targetRole === undefined ? [] : [`target role: ${sanitizeTerminalSingleLine(request.targetRole).slice(0, 64)}`]),
        ...(targetLabel === undefined ? [] : [`target name: ${targetLabel}`]),
        request.text === undefined ? undefined : `text: ${request.text}`,
        request.key === undefined ? undefined : `key: ${request.key}`,
        request.value === undefined ? undefined : `value: ${request.value}`,
        request.direction === undefined ? undefined : `direction: ${request.direction}`,
        request.amount === undefined ? undefined : `amount: ${request.amount}px`,
        request.path === undefined ? undefined : `path: ${request.path}`,
        request.maxBytes === undefined ? undefined : `max bytes: ${request.maxBytes}`,
        request.inputRoute === undefined ? undefined : `input route: ${request.inputRoute}`,
        request.dialog === undefined ? undefined : `dialog: ${request.dialog.type}: ${request.dialog.message}`,
        request.step === undefined ? undefined : `step: ${request.step}${request.maxActions === undefined ? "" : `/${request.maxActions}`}`,
        request.expectedVerification === undefined ? undefined : `verification: ${request.expectedVerification.kind}${request.expectedVerification.expected ? ` · ${request.expectedVerification.expected}` : ""}${request.expectedVerification.state ? ` · ${request.expectedVerification.state}` : ""}`,
        `action hash: ${request.actionHash}`,
        `approval timeout: ${request.approvalTimeoutMs ?? "unknown"}ms from prompt`,
        `warning: ${request.warning}`,
      ].filter((value): value is string => value !== undefined).join("\n"),
      redactionSecrets: this.redactionSecrets,
    };
    const prompt = new ApprovalPrompt({ output: this.output, colour: this.colour, width: this.panelWidth() });
    const answer = request.dialog
      ? await prompt.askDialog(panel, request.dialog.type, { question, signal, cancelQuestion, rawInput: this.approvalInput, pauseRawInput: this.pauseApprovalInput, resumeRawInput: this.resumeApprovalInput })
      : await prompt.ask(panel, { question, signal, cancelQuestion, rawInput: this.approvalInput, pauseRawInput: this.pauseApprovalInput, resumeRawInput: this.resumeApprovalInput, allowTask: request.taskId !== undefined && approvalScope !== "action" });
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
      return { decision: "deny", reason: "The page dialog was not explicitly resolved." };
    }
    if (answer.decision === "allow-once") {
      this.write(`${this.style("32;1", "✓ approved once")}\n`);
      return { decision: "allow-once" };
    }
    if (answer.decision === "allow-task" && request.taskId && request.grantHash) {
      this.write(`${this.style("32;1", "✓ approved for this bounded task")}\n`);
      return { decision: "allow-task", grantHash: request.grantHash };
    }
    this.write(`${this.style("2", "Browser action denied; no interaction was performed.")}\n`);
    return { decision: "deny", reason: "The user did not approve the browser action." };
  }

  private async askForComputerApproval(
    request: ComputerApprovalRequest,
    question: (prompt: string, callback: (answer: string) => void) => void,
    signal?: AbortSignal,
    cancelQuestion?: () => void,
  ): Promise<ComputerApprovalDecision> {
    const target = formatComputerApprovalTarget(request);
    const semanticTarget = request.targetLabel !== undefined;
    const payload = request.operation === "type"
      ? `${request.textLength ?? 0} chars${request.textPreview ? ` · ${request.textPreview}` : ""}`
      : request.operation === "press"
        ? `${request.key ?? "key"}${request.modifiers?.length ? ` · ${request.modifiers.join("+")}` : ""}`
        : request.operation === "scroll"
          ? `${request.direction ?? "?"} · ${request.amount ?? 1}`
          : undefined;
    const strategyLabel = request.strategy === "typesafe" ? "Jev" : request.strategy === "traditional" ? "traditional vision" : request.strategy === "compare" ? "compare" : undefined;
    const panel: ApprovalPanel = {
      title: strategyLabel ? `Proposed computer interaction · ${strategyLabel}` : "Proposed computer interaction",
      risk: "native-computer-use",
      action: request.operation,
      target,
      scope: `${request.environment}${strategyLabel ? ` · ${strategyLabel}` : ""} · session ${request.sessionId}`,
      identity: `action ${request.actionId} · observation ${request.observationId} · generation ${request.generation}`,
      expiry: `${request.approvalTimeoutMs ?? "?"}ms from prompt`,
      extra: [
        ...(request.taskId ? [["task", `${request.taskId} · grant ${request.grantHash ?? "unknown"}`] as const] : []),
        ...(request.targetLabel ? [["target", `${request.targetLabel}${request.targetRole ? ` (${request.targetRole})` : ""}`] as const] : []),
        ...(request.targetSource ? [["source", request.targetSource] as const] : []),
        ...(request.menuPath ? [["menu path", request.menuPath.join(" → ")] as const] : []),
        ...(request.x === undefined || request.y === undefined ? [] : [["coordinates", `${request.x}, ${request.y}`] as const]),
        ...(request.endX === undefined || request.endY === undefined ? [] : [["end", `${request.endX}, ${request.endY}`] as const]),
        ...(payload ? [["payload", payload] as const] : []),
        ...(request.step === undefined ? [] : [["step", `${request.step}${request.maxActions === undefined ? "" : `/${request.maxActions}`}`] as const]),
        ...(request.expectedVerification ? [["verify", `${request.expectedVerification.kind}${request.expectedVerification.expected ? ` · ${request.expectedVerification.expected}` : ""}${request.expectedVerification.state ? ` · ${request.expectedVerification.state}` : ""}`] as const] : []),
        ["warning", request.warning],
      ],
      preview: semanticTarget
        ? `One semantic ${request.operation} of the observed target on the isolated display.`
        : `One visible foreground ${request.operation} on the isolated display.`,
      details: [
        `operation: ${request.operation}`,
        ...(strategyLabel ? [`strategy: ${strategyLabel}`] : []),
        `display: ${request.displayId}`,
        ...(request.targetLabel ? [`target: ${request.targetLabel}${request.targetRole ? ` (${request.targetRole})` : ""}`] : []),
        ...(request.targetSource ? [`target source: ${request.targetSource}`] : []),
        ...(request.menuPath ? [`menu path: ${request.menuPath.join(" → ")}`] : []),
        ...(request.x === undefined || request.y === undefined ? [] : [`coordinates: ${request.x}, ${request.y}`]),
        ...(request.endX === undefined || request.endY === undefined ? [] : [`end coordinates: ${request.endX}, ${request.endY}`]),
        ...(payload ? [`payload: ${payload}`] : []),
        ...(request.step === undefined ? [] : [`step: ${request.step}${request.maxActions === undefined ? "" : `/${request.maxActions}`}`]),
        ...(request.expectedVerification ? [`verification: ${request.expectedVerification.kind}${request.expectedVerification.expected ? ` · ${request.expectedVerification.expected}` : ""}${request.expectedVerification.state ? ` · ${request.expectedVerification.state}` : ""}`] : []),
        `session: ${request.sessionId}`,
        `observation: ${request.observationId}`,
        `generation: ${request.generation}`,
        `warning: ${request.warning}`,
      ].join("\n"),
      redactionSecrets: this.redactionSecrets,
    };
    const answer = await new ApprovalPrompt({ output: this.output, colour: this.colour, width: this.panelWidth() }).ask(panel, { question, signal, cancelQuestion, rawInput: this.approvalInput, pauseRawInput: this.pauseApprovalInput, resumeRawInput: this.resumeApprovalInput, allowTask: request.taskId !== undefined });
    if (answer.decision === "allow-once") {
      this.write(`${this.style("32;1", "✓ approved once")}\n`);
      return { decision: "allow-once" };
    }
    if (answer.decision === "allow-task" && request.taskId && request.grantHash) {
      this.write(`${this.style("32;1", "✓ approved for this bounded task")}\n`);
      return { decision: "allow-task", grantHash: request.grantHash };
    }
    if (answer.decision === "unavailable") {
      this.write(`${this.style("33;1", "Approval cancelled; the native computer action was not started.")}\n`);
      return answer;
    }
    this.write(`${this.style("2", "Computer action denied; no native input was sent.")}\n`);
    return { decision: "deny", reason: "The user did not approve the native computer action." };
  }

  private async askForComputerTaskApproval(
    request: ComputerTaskApprovalRequest,
    question: (prompt: string, callback: (answer: string) => void) => void,
    signal?: AbortSignal,
    cancelQuestion?: () => void,
  ): Promise<ComputerTaskApprovalDecision> {
    const target = request.surface === "native"
      ? request.applicationName ?? "approved native application"
      : request.profileMode === "existing_profile"
        ? "the currently visible Chrome/Edge window (existing profile)"
        : "isolated Chrome/Edge browser";
    const completion = formatComputerTaskCompletion(request.completion, request.surface);
    const applicationArguments = request.applicationArguments?.join(" ") ?? "";
    const nativeFallback = formatComputerNativeFallback(request.nativeFallbackRoutes);
    const profileWarning = request.profileMode === "existing_profile"
      ? "This task may access live browser tabs, cookies, and storage through the separately approved existing profile."
      : undefined;
    const values = Object.entries(request.values)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
      .map(([key, value]) => `${key}=${value}`)
      .join(" · ");
    const panel: ApprovalPanel = {
      title: "Approve bounded computer task",
      risk: "computer-task",
      action: "run this bounded task once",
      target,
      scope: `${request.surface} · ${request.profileMode} · ${request.inputRoute}${request.surface === "browser" && request.browserOriginPolicy === "public-web" ? " · public HTTPS sites" : request.allowedOrigins.length > 0 ? ` · ${request.allowedOrigins.join(", ")}` : ""}`,
      identity: `task ${request.taskId} · grant ${request.grantHash}`,
      expiry: new Date(request.expiresAtMs).toISOString(),
      extra: [
        ["grant scope", "this bounded task only"],
        ...(request.surface === "browser" && request.browserOriginPolicy === "public-web"
          ? [["browser sites", "public HTTPS destinations · private/local blocked"] as const]
          : []),
        ["actions", request.allowedActions.join(", ")],
        ["input route", request.inputRoute],
        ...(nativeFallback ? [["native fallback", nativeFallback] as const] : []),
        ...(request.profileMode === "existing_profile" ? [["profile access", "live tabs · cookies · storage"] as const] : []),
        ...(request.surface === "native" || request.surface === "mixed" ? [["visual/foreground", "not authorized in this Cua profile"] as const] : []),
        ...(applicationArguments ? [["launch arguments", applicationArguments] as const] : []),
        ["timezone", request.timeZone],
        ...(values ? [["values", values] as const] : []),
        ["limit", String(request.maxActions)],
        ["completion", completion],
        ["deadline", `${request.deadlineMs}ms`],
      ],
      preview: profileWarning ? `${request.originalGoal}\n\n${profileWarning}` : request.originalGoal,
      details: [
        `goal: ${request.originalGoal}`,
        `surface: ${request.surface}`,
        `target: ${target}`,
        "grant scope: this bounded task only",
        `profile: ${request.profileMode}`,
        `input route: ${request.inputRoute}`,
        ...(request.surface === "browser" && request.browserOriginPolicy === "public-web"
          ? ["browser sites: public HTTPS destinations; private and local destinations are blocked"]
          : []),
        ...(nativeFallback ? [`native fallback: ${nativeFallback}`] : []),
        ...(request.surface === "native" || request.surface === "mixed" ? ["visual/foreground: not authorized in this Cua profile; a separate capability and approval are required"] : []),
        ...(profileWarning ? [profileWarning] : []),
        ...(applicationArguments ? [`launch arguments: ${applicationArguments}`] : []),
        `timezone: ${request.timeZone}`,
        ...(values ? [`values: ${values}`] : []),
        `origins: ${request.allowedOrigins.join(", ") || "none"}`,
        `actions: ${request.allowedActions.join(", ")}`,
        `maximum actions: ${request.maxActions}`,
        `completion: ${completion}`,
        `expires: ${new Date(request.expiresAtMs).toISOString()}`,
        `grant hash: ${request.grantHash}`,
      ].join("\n"),
      redactionSecrets: this.redactionSecrets,
    };
    const answer = await new ApprovalPrompt({ output: this.output, colour: this.colour, width: this.panelWidth() }).ask(panel, {
      question,
      signal,
      cancelQuestion,
      rawInput: this.approvalInput,
      pauseRawInput: this.pauseApprovalInput,
      resumeRawInput: this.resumeApprovalInput,
      taskOnly: true,
    });
    if (answer.decision === "allow-task") {
      this.write(`${this.style("32;1", "✓ approved for this task")}\n`);
      return { decision: "allow-task", grantHash: request.grantHash };
    }
    if (answer.decision === "unavailable") {
      this.write(`${this.style("33;1", "Task approval cancelled; no computer process was started.")}\n`);
      return answer;
    }
    const reason = "The user did not approve the bounded computer task.";
    this.write(`${this.style("2", reason)}\n`);
    return { decision: "deny", reason };
  }

  private async askForExistingProfileAuthorization(
    request: CuaAuthorizationRequestView,
    question: (prompt: string, callback: (answer: string) => void) => void,
    signal?: AbortSignal,
    cancelQuestion?: () => void,
  ): Promise<CuaAuthorizationDecision> {
    const panel: ApprovalPanel = {
      title: "Approve existing browser profile",
      risk: "browser-profile",
      action: "attach profile",
      target: "the currently visible Chrome or Edge window",
      scope: `${request.riskClass} · ${request.adapterId} · session ${request.publicSession}`,
      identity: `Cua request ${request.requestDigest}`,
      expiry: new Date(request.expiresUnixMs).toISOString(),
      extra: [
        ["summary", request.humanSummary],
        ["resource digest", request.resourceDigest],
        ...(request.taskGrantHash ? [["task grant", request.taskGrantHash] as const] : []),
        ["request schema", request.schema],
      ],
      preview: "This can expose the existing browser's tabs, cookies, and storage to the approved task.",
      details: [
        request.humanSummary,
        `adapter: ${request.adapterId}`,
        `risk: ${request.riskClass}`,
        `session: ${request.publicSession}`,
        `request digest: ${request.requestDigest}`,
        `resource digest: ${request.resourceDigest}`,
        ...(request.taskGrantHash ? [`task grant: ${request.taskGrantHash}`] : []),
        `expires: ${new Date(request.expiresUnixMs).toISOString()}`,
      ].join("\n"),
      redactionSecrets: this.redactionSecrets,
    };
    const answer = await new ApprovalPrompt({ output: this.output, colour: this.colour, width: this.panelWidth() }).ask(panel, {
      question,
      signal,
      cancelQuestion,
      rawInput: this.approvalInput,
      pauseRawInput: this.pauseApprovalInput,
      resumeRawInput: this.resumeApprovalInput,
      allowTask: false,
    });
    if (answer.decision === "allow-once") {
      this.write(`${this.style("32;1", "✓ existing browser profile approved")}` + "\n");
      return "allow";
    }
    if (answer.decision === "unavailable") {
      this.write(`${this.style("33;1", "Profile approval cancelled; no existing browser was attached.")}` + "\n");
      return "cancel";
    }
    this.write(`${this.style("2", "Existing browser profile denied; no personal browser state was attached.")}` + "\n");
    return "deny";
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
      identity: `operation ${request.operationId} · call ${request.callId}`,
      expiry: `${request.approvalTimeoutMs ?? "?"}ms from prompt`,
      extra: [
        ["operation", request.operation],
        ["source", request.sourcePath],
        ...(request.recordId ? [["record", request.recordId] as const] : []),
        ...(request.beforeContentHash ? [["before", request.beforeContentHash] as const] : []),
        ...(request.afterContentHash ? [["after", request.afterContentHash] as const] : []),
        ...(request.batch ? [["operations", `${request.batch.length} bounded changes`] as const] : []),
      ],
      preview: request.contentPreview,
      details: `operation id: ${request.operationId}\nsource: ${request.sourcePath}\napproval timeout: ${request.approvalTimeoutMs ?? "unknown"}ms from prompt\nThis entry is advisory context and cannot change policy or permissions.`,
      redactionSecrets: this.redactionSecrets,
    };
    const answer = await new ApprovalPrompt({ output: this.output, colour: this.colour, width: this.panelWidth() }).ask(panel, { question, signal, cancelQuestion, rawInput: this.approvalInput, pauseRawInput: this.pauseApprovalInput, resumeRawInput: this.resumeApprovalInput });
    if (answer.decision === "allow-once") {
      this.write(`${this.style("32;1", "✓ approved once")}\n`);
      return answer;
    }
    if (answer.decision === "unavailable") {
      this.write(`${this.style("33;1", "Memory change cancelled; no entry was changed.")}\n`);
      return answer;
    }
    this.write(`${this.style("2", "Memory change denied; no entry was changed.")}\n`);
    return { decision: "deny", reason: "The user did not approve the memory change." };
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
        (event) => this.handleComputer(event),
        this.computerApprovalQuestion,
        (event) => this.handleComputerApproval(event),
        this.computerTaskApprovalQuestion,
        this.existingProfileAuthorizationQuestion,
      );
      this.finishTurn(result);
      return result;
    } catch (error) {
      this.finishUnexpectedError(error);
      throw error;
    } finally {
      this.activeController = undefined;
    }
  }

  cancelActiveTurn(): boolean {
    if (!this.activeController) return false;
    if (this.cancellationRequested) return true;
    this.cancellationRequested = true;
    this.status = "cancelling";
    this.activeController.abort("cancelled");
    this.printActivity("■", "Cancelling current turn…", "33;1");
    return true;
  }

  async runInteractive(input: NodeJS.ReadableStream): Promise<void> {
    this.approvalInput = input;
    this.printHeader();
    await this.printConversationTranscript();
    const readlineInterface = readline.createInterface({
      input,
      output: this.output,
      terminal: this.interactive,
      crlfDelay: Infinity,
      historySize: 100,
      removeHistoryDuplicates: true,
      completer: commandCompleter,
    });
    // readline owns the same TTY used by raw approval navigation. Temporarily
    // remove only readline's data listeners while the approval panel owns the
    // stream; pausing the stream itself would prevent the raw listener from
    // receiving the decision key.
    const readlineDataListeners = input.listeners("data") as Array<(...args: any[]) => void>;
    this.pauseApprovalInput = () => {
      readlineInterface.pause();
      for (const listener of readlineDataListeners) input.removeListener("data", listener);
      input.resume();
    };
    this.resumeApprovalInput = () => {
      for (const listener of readlineDataListeners) input.on("data", listener);
      readlineInterface.resume();
    };
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
    this.computerApprovalQuestion = this.interactive
      ? (request, signal) => this.askForComputerApproval(
        request,
        (prompt, callback) => readlineInterface.question(prompt, callback),
        signal,
        () => readlineInterface.write("\n"),
      )
      : undefined;
    this.computerTaskApprovalQuestion = this.interactive
      ? (request, signal) => this.askForComputerTaskApproval(
        request,
        (prompt, callback) => readlineInterface.question(prompt, callback),
        signal,
        () => readlineInterface.write("\n"),
      )
      : undefined;
    this.existingProfileAuthorizationQuestion = this.interactive
      ? (request, signal) => this.askForExistingProfileAuthorization(
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
        try {
          if (await this.selectSession(value)) {
            if (this.interactive) readlineInterface.prompt();
            continue;
          }
        } catch (error) {
          this.finishUnexpectedError(error);
          if (this.interactive) readlineInterface.prompt();
          continue;
        }
        const command = parseTuiCommand(value);
        if (command) {
          let keepRunning = true;
          try {
            keepRunning = await this.runCommand(command);
          } catch (error) {
            this.finishUnexpectedError(error);
          }
          if (!keepRunning) break;
          if (this.interactive) readlineInterface.prompt();
          continue;
        }
        try {
          await this.runTurn(value);
        } catch {
          // runTurn has already rendered the bounded failure state. Keep the
          // composer alive so a transient runtime/persistence failure does
          // not end an otherwise usable interactive session.
        }
        if (this.interactive) readlineInterface.prompt();
      }
    } finally {
      this.approvalQuestion = undefined;
      this.processApprovalQuestion = undefined;
      this.browserApprovalQuestion = undefined;
      this.computerApprovalQuestion = undefined;
      this.computerTaskApprovalQuestion = undefined;
      this.existingProfileAuthorizationQuestion = undefined;
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
    message = sanitizeTerminalText(message);
    this.write(`${this.style("36;1", "You")}\n${message.trim()}\n`);
    return this.runTurn(message);
  }
}

export function transcriptSummary(transcript: readonly TranscriptMessage[]): string {
  return transcript.map((message) => `${message.role}: ${message.content}`).join("\n");
}
