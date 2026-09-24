import type { Writable } from "node:stream";
import { redactSecrets } from "../runtime/errors.js";
import { sanitizeTerminalSingleLine, sanitizeTerminalText } from "./terminal-safety.js";

const PANEL_WIDTH = 72;
const LABEL_WIDTH = 11;
const PREVIEW_LIMIT = 480;
const DETAILS_LIMIT = 8_000;

export interface ApprovalPanel {
  readonly title: string;
  readonly risk: string;
  readonly action: string;
  readonly target: string;
  readonly scope: string;
  /** Stable prepared-operation identity shown so the decision is auditable. */
  readonly identity?: string;
  /** Human-readable approval lifetime shown next to the identity. */
  readonly expiry?: string;
  readonly extra?: readonly (readonly [string, string])[];
  readonly preview: string;
  readonly details?: string;
  readonly redactionSecrets?: readonly string[];
}

export type ApprovalAction =
  | { readonly kind: "approve-once" }
  | { readonly kind: "approve-task" }
  | { readonly kind: "approve-conversation" }
  | { readonly kind: "approve-local" }
  | { readonly kind: "deny" }
  | { readonly kind: "details" }
  | { readonly kind: "cancel" };

export type DialogApprovalAction =
  | { readonly kind: "accept"; readonly promptText?: string }
  | { readonly kind: "dismiss" }
  | { readonly kind: "details" }
  | { readonly kind: "cancel" }
  | { readonly kind: "deny" };

export type ApprovalResult =
  | { readonly decision: "allow-once" }
  | { readonly decision: "allow-task" }
  | { readonly decision: "allow-conversation" }
  | { readonly decision: "allow-local" }
  | { readonly decision: "deny"; readonly reason?: string }
  | { readonly decision: "unavailable"; readonly reason: string };

export type DialogApprovalResult =
  | { readonly decision: "allow-once"; readonly dialogDecision: "accept"; readonly promptText?: string }
  | { readonly decision: "allow-once"; readonly dialogDecision: "dismiss" }
  | { readonly decision: "deny"; readonly reason?: string }
  | { readonly decision: "unavailable"; readonly reason: string };

export interface ApprovalQuestionOptions {
  readonly question: (prompt: string, callback: (answer: string) => void) => void;
  readonly signal?: AbortSignal;
  readonly cancelQuestion?: () => void;
  /** Raw terminal input is used only when the caller explicitly supplies a TTY. */
  readonly rawInput?: NodeJS.ReadableStream;
  /** Temporarily transfers raw TTY ownership away from the line editor. */
  readonly pauseRawInput?: () => void;
  /** Restores line-editor ownership after a raw approval decision. */
  readonly resumeRawInput?: () => void;
  /** Offer one grant for the bounded high-level task in addition to one action. */
  readonly allowTask?: boolean;
  /** The prompt itself approves one already-compiled bounded task, not a single action. */
  readonly taskOnly?: boolean;
  /** Offer a durable grant scoped to the current conversation. */
  readonly allowConversation?: boolean;
  /** Offer a local saved grant with this exact, user-facing matcher description. */
  readonly allowLocalLabel?: string;
}

export interface ApprovalPromptOptions {
  readonly output: Writable;
  readonly colour: boolean;
  readonly width?: number;
}

export type BrowserDialogKind = "alert" | "beforeunload" | "confirm" | "prompt";

function shorten(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function singleLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function redactApprovalValue(value: string, secrets: readonly string[]): string {
  const configuredSecrets = [process.env.OPENROUTER_API_KEY ?? "", ...secrets];
  let result = redactSecrets(value, configuredSecrets);
  result = result
    .replace(/-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/giu, "[REDACTED PRIVATE KEY]")
    .replace(/\bsk(?:-[a-z0-9]+)?-[a-z0-9._-]{12,}\b/giu, "[REDACTED]")
    .replace(/\b(?:api[_-]?key|access[_-]?token|password|secret|token)\s*[:=]\s*[^\s,;]+/giu, (match) => `${match.slice(0, match.indexOf(match.match(/[:=]/u)?.[0] ?? "=") + 1)}[REDACTED]`);
  return sanitizeTerminalText(result);
}

function panelRule(title: string, width: number): string {
  return `╭─ ${title} ${"─".repeat(Math.max(1, width - title.length - 1))}╮`;
}

function panelBottom(width: number): string {
  return `╰${"─".repeat(width + 2)}╯`;
}

function panelRow(label: string, value: string, width: number, secrets: readonly string[]): string {
  label = sanitizeTerminalSingleLine(label);
  const safeValue = shorten(singleLine(redactApprovalValue(value, secrets)), width - LABEL_WIDTH - 1);
  const content = `${label.padEnd(LABEL_WIDTH)} ${safeValue}`;
  return `│ ${content}${" ".repeat(Math.max(0, width - content.length))} │`;
}

function style(colour: boolean, code: string, value: string): string {
  return colour ? `\u001b[${code}m${value}\u001b[0m` : value;
}

export function renderApprovalPanel(panel: ApprovalPanel, options: { readonly colour: boolean; readonly width?: number } = { colour: false }): string {
  const width = options.width ?? PANEL_WIDTH;
  const secrets = panel.redactionSecrets ?? [];
  const title = sanitizeTerminalSingleLine(panel.title);
  const preview = shorten(redactApprovalValue(panel.preview, secrets), PREVIEW_LIMIT);
  const rows: readonly (readonly [string, string])[] = [
    ["risk", panel.risk],
    ["action", panel.action],
    ["target", panel.target],
    ["scope", panel.scope],
    ...(panel.identity === undefined ? [] : [["identity", panel.identity] as const]),
    ...(panel.expiry === undefined ? [] : [["expires", panel.expiry] as const]),
    ...(panel.extra ?? []),
    ["preview", preview],
  ];
  const lines = [
    style(options.colour, "33;1", panelRule(title, width)),
    ...rows.map(([label, value]) => style(options.colour, "2", panelRow(label, value, width, secrets))),
    style(options.colour, "33;1", panelBottom(width)),
  ];
  return `${lines.join("\n")}\n`;
}

export function parseApprovalAction(input: string): ApprovalAction {
  const normalized = input.trim().toLowerCase();
  if (normalized === "t" || normalized === "task" || normalized === "approve task" || normalized === "allow task") return { kind: "approve-task" };
  if (normalized === "c" || normalized === "conversation" || normalized === "approve for this conversation") return { kind: "approve-conversation" };
  if (normalized === "l" || normalized === "p" || normalized === "always" || normalized === "approve local" || normalized === "always allow") return { kind: "approve-local" };
  if (normalized === "a" || normalized === "approve" || normalized === "approve once" || normalized === "y" || normalized === "yes") {
    return { kind: "approve-once" };
  }
  if (normalized === "v" || normalized === "details" || normalized === "view") return { kind: "details" };
  if (normalized === "\u001b" || normalized === "esc" || normalized === "escape" || normalized === "cancel") return { kind: "cancel" };
  return { kind: "deny" };
}

export function parseDialogApprovalAction(input: string, dialog: BrowserDialogKind): DialogApprovalAction {
  const normalized = input.trim();
  const lower = normalized.toLowerCase();
  if (lower === "v" || lower === "details" || lower === "view") return { kind: "details" };
  if (lower === "\u001b" || lower === "esc" || lower === "escape" || lower === "cancel") return { kind: "cancel" };
  if (lower === "d" || lower === "dismiss") return { kind: "dismiss" };
  if (dialog !== "prompt" && (lower === "a" || lower === "accept")) return { kind: "accept" };
  if (dialog === "prompt") {
    const match = /^(?:a|accept)\s*:\s*([\s\S]*)$/iu.exec(normalized) ?? /^(?:a|accept)\s+([\s\S]+)$/iu.exec(normalized);
    if (match) return { kind: "accept", promptText: match[1] ?? "" };
  }
  return { kind: "deny" };
}

export class ApprovalPrompt {
  private readonly output: Writable;
  private readonly colour: boolean;
  private readonly width: number;

  constructor(options: ApprovalPromptOptions) {
    this.output = options.output;
    this.colour = options.colour;
    this.width = options.width ?? PANEL_WIDTH;
  }

  async ask(panel: ApprovalPanel, options: ApprovalQuestionOptions): Promise<ApprovalResult> {
    this.writePanel(panel);
    const rawTerminal = isRawTerminal(options.rawInput);
    if (rawTerminal) {
      options.pauseRawInput?.();
      try {
        const choice = await this.askKeyboard(options.rawInput, options.signal, "approve once", "deny", () => this.writeDetails(panel), options.allowTask, options.taskOnly, options.allowConversation, options.allowLocalLabel);
        if (choice === "approve") return { decision: "allow-once" };
        if (choice === "task") return { decision: "allow-task" };
        if (choice === "conversation") return { decision: "allow-conversation" };
        if (choice === "local") return { decision: "allow-local" };
        if (choice === "cancel") return { decision: "unavailable", reason: "The approval prompt was cancelled before the operation started." };
        return { decision: "deny", reason: "The user did not approve the proposed operation." };
      } finally {
        options.resumeRawInput?.();
      }
    }
    let detailsShown = false;
    for (;;) {
      if (detailsShown) this.writeDetails(panel);
      const taskChoice = options.allowTask ? " · [t] approve this task" : "";
      const conversationChoice = options.allowConversation ? " · [c] approve for this conversation" : "";
      const localChoice = options.allowLocalLabel ? ` · [l] ${options.allowLocalLabel}` : "";
      const instruction = options.taskOnly
        ? "Choice [t] approve this task · [d] deny · [v] details · Esc cancel"
        : `Choice [a] approve once${taskChoice}${conversationChoice}${localChoice} · [d] deny · [v] details · Esc cancel`;
      const answer = await this.readAnswer(instruction, options);
      if (answer.kind === "cancelled") {
        return { decision: "unavailable", reason: "The approval prompt was cancelled before the operation started." };
      }
      const action = parseApprovalAction(answer.value);
      if (action.kind === "details") {
        detailsShown = true;
        continue;
      }
      if (action.kind === "approve-once" && !options.taskOnly) return { decision: "allow-once" };
      if (action.kind === "approve-task" && options.taskOnly) return { decision: "allow-task" };
      if (action.kind === "approve-task" && options.allowTask) return { decision: "allow-task" };
      if (action.kind === "approve-conversation" && options.allowConversation) return { decision: "allow-conversation" };
      if (action.kind === "approve-local" && options.allowLocalLabel) return { decision: "allow-local" };
      if (action.kind === "cancel") return { decision: "unavailable", reason: "The approval prompt was cancelled before the operation started." };
      return { decision: "deny", reason: "The user did not approve the proposed operation." };
    }
  }

  async askDialog(panel: ApprovalPanel, dialog: BrowserDialogKind, options: ApprovalQuestionOptions): Promise<DialogApprovalResult> {
    this.writePanel(panel);
    if (dialog !== "prompt" && isRawTerminal(options.rawInput)) {
      options.pauseRawInput?.();
      try {
        const choice = await this.askKeyboard(options.rawInput, options.signal, "accept", "dismiss", () => this.writeDetails(panel));
        if (choice === "approve") return { decision: "allow-once", dialogDecision: "accept" };
        if (choice === "cancel") return { decision: "unavailable", reason: "The approval prompt was cancelled before the dialog was resolved." };
        return { decision: "allow-once", dialogDecision: "dismiss" };
      } finally {
        options.resumeRawInput?.();
      }
    }
    let detailsShown = false;
    const instruction = dialog === "prompt"
      ? "Resolve page prompt · [a:<text>] accept · [d] dismiss · [v] details · Esc cancel"
      : "Resolve page dialog · [a] accept · [d] dismiss · [v] details · Esc cancel";
    for (;;) {
      if (detailsShown) this.writeDetails(panel);
      const answer = await this.readAnswer(instruction, options);
      if (answer.kind === "cancelled") {
        return { decision: "unavailable", reason: "The approval prompt was cancelled before the dialog was resolved." };
      }
      const action = parseDialogApprovalAction(answer.value, dialog);
      if (action.kind === "details") {
        detailsShown = true;
        continue;
      }
      if (action.kind === "cancel") return { decision: "unavailable", reason: "The approval prompt was cancelled before the dialog was resolved." };
      if (action.kind === "accept") return { decision: "allow-once", dialogDecision: "accept", promptText: action.promptText };
      if (action.kind === "dismiss") return { decision: "allow-once", dialogDecision: "dismiss" };
      return { decision: "deny", reason: "The page dialog was not explicitly accepted or dismissed." };
    }
  }

  private writePanel(panel: ApprovalPanel): void {
    this.output.write("\n");
    this.output.write(renderApprovalPanel(panel, { colour: this.colour, width: this.width }));
  }

  private writeDetails(panel: ApprovalPanel): void {
    const secrets = panel.redactionSecrets ?? [];
    const details = panel.details === undefined || panel.details.length === 0 ? "No additional details are available." : shorten(panel.details, DETAILS_LIMIT);
    this.output.write(`${style(this.colour, "36;1", "Details")}\n${style(this.colour, "2", redactApprovalValue(details, secrets))}\n`);
  }

  private write(value: string): void {
    this.output.write(`${style(this.colour, "33;1", value)}\n`);
  }

  private async readAnswer(instruction: string, options: ApprovalQuestionOptions): Promise<{ readonly kind: "answer"; readonly value: string } | { readonly kind: "cancelled" }> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: { readonly kind: "answer"; readonly value: string } | { readonly kind: "cancelled" }): void => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const onAbort = (): void => {
        finish({ kind: "cancelled" });
        // Resolve first. readline.question can synchronously deliver the
        // cleanup newline to its callback; a settled prompt must not turn
        // cancellation into the safe-default denial result.
        options.cancelQuestion?.();
      };
      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      options.signal?.addEventListener("abort", onAbort, { once: true });
      this.write(this.stylePrompt(instruction));
      options.question("", (answer) => finish({ kind: "answer", value: answer }));
    });
  }

  private stylePrompt(value: string): string {
    return style(this.colour, "33;1", value);
  }

  private async askKeyboard(
    input: NodeJS.ReadableStream,
    signal: AbortSignal | undefined,
    approveLabel: string,
    denyLabel: string,
    showDetails: () => void,
    allowTask = false,
    taskOnly = false,
    allowConversation = false,
    allowLocalLabel?: string,
  ): Promise<"approve" | "task" | "conversation" | "local" | "deny" | "cancel"> {
    type Choice = "approve" | "task" | "conversation" | "local" | "deny";
    const choices: readonly Choice[] = taskOnly
      ? ["task", "deny"]
      : ["approve", ...(allowTask ? ["task" as const] : []), ...(allowConversation ? ["conversation" as const] : []), ...(allowLocalLabel ? ["local" as const] : []), "deny"];
    const defaultChoice = choices[0] ?? "deny";
    let selected = 0;
    let detailsShown = false;
    const labels: Record<Choice, string> = {
      approve: approveLabel,
      task: "approve this task",
      conversation: "approve for this conversation",
      local: allowLocalLabel ?? "always allow this exact request",
      deny: denyLabel,
    };
    const menuLines = choices.length + 2;
    let rendered = false;
    const renderChoices = (): void => {
      if (rendered) this.output.write(`\u001b[${menuLines}A\r\u001b[J`);
      else this.output.write("\n");
      this.output.write(`${style(this.colour, "36;1", "Choose an action") }\n`);
      for (let index = 0; index < choices.length; index += 1) {
        const choice = choices[index]!;
        const isSelected = index === selected;
        const isDefault = choice === defaultChoice;
        const title = `${labels[choice].charAt(0).toUpperCase()}${labels[choice].slice(1)}`;
        const label = `${title}${isDefault ? (isSelected && !this.colour ? " (selected · default)" : " (default)") : isSelected && !this.colour ? " (selected)" : ""}`;
        const row = `${isSelected ? "❯" : " "} ${index + 1}. ${label}`;
        const visibleRow = isSelected && this.colour ? row.padEnd(Math.max(row.length, this.width)) : row;
        this.output.write(`${isSelected && this.colour ? style(true, "30;43;1", visibleRow) : row}\n`);
      }
      this.output.write(`${style(this.colour, "2", `↑/↓ move · Enter confirm · Esc/Ctrl+C cancel${detailsShown ? " · details shown" : " · v details"}`)}\n`);
      rendered = true;
    };
    renderChoices();
    return new Promise((resolve) => {
      let settled = false;
      const raw = input as NodeJS.ReadableStream & { setRawMode?: (enabled: boolean) => void };
      let keyBuffer = "";
      let escapeTimer: NodeJS.Timeout | undefined;
      const finish = (choice: "approve" | "task" | "conversation" | "local" | "deny" | "cancel"): void => {
        if (settled) return;
        settled = true;
        if (escapeTimer) clearTimeout(escapeTimer);
        input.removeListener("data", onData);
        signal?.removeEventListener("abort", onAbort);
        raw.setRawMode?.(false);
        this.output.write("\n");
        resolve(choice);
      };
      const onAbort = (): void => finish("cancel");
      const move = (delta: -1 | 1): void => {
        const next = Math.max(0, Math.min(choices.length - 1, selected + delta));
        if (next === selected) return;
        selected = next;
        renderChoices();
      };
      const onEnter = (): void => finish(choices[selected] ?? "deny");
      const onEscape = (): void => finish("cancel");
      const showMoreDetails = (): void => {
        if (detailsShown) return;
        detailsShown = true;
        this.output.write(`\u001b[${menuLines}A\r\u001b[J`);
        rendered = false;
        showDetails();
        renderChoices();
      };
      const knownArrows: Readonly<Record<string, -1 | 1>> = {
        "\u001b[A": -1,
        "\u001b[B": 1,
        "\u001bOA": -1,
        "\u001bOB": 1,
      };
      const arrowPrefixes = Object.keys(knownArrows);
      const processKeys = (): void => {
        while (!settled && keyBuffer.length > 0) {
          if (keyBuffer.startsWith("\u0003")) return onEscape();
          const arrow = Object.keys(knownArrows).find((sequence) => keyBuffer.startsWith(sequence));
          if (arrow) {
            if (escapeTimer) clearTimeout(escapeTimer);
            escapeTimer = undefined;
            keyBuffer = keyBuffer.slice(arrow.length);
            move(knownArrows[arrow]!);
            continue;
          }
          if (keyBuffer.startsWith("\u001b")) {
            if (arrowPrefixes.some((sequence) => sequence.startsWith(keyBuffer))) {
              if (!escapeTimer) {
                escapeTimer = setTimeout(() => {
                  escapeTimer = undefined;
                  if (keyBuffer === "\u001b") onEscape();
                  else keyBuffer = "";
                }, 80);
              }
              return;
            }
            if (keyBuffer.startsWith("\u001b[")) {
              const finalByte = [...keyBuffer].findIndex((character, index) => index >= 2 && /[\u0040-\u007e]/u.test(character));
              if (finalByte < 0) return;
              keyBuffer = keyBuffer.slice(finalByte + 1);
              continue;
            }
            if (keyBuffer.startsWith("\u001bO") && keyBuffer.length < 3) return;
            keyBuffer = keyBuffer.slice(1);
            continue;
          }
          const character = keyBuffer[0]!;
          keyBuffer = keyBuffer.slice(1);
          if (character === "\r" || character === "\n") return onEnter();
          if (character.toLowerCase() === "v") showMoreDetails();
        }
      };
      const onData = (chunk: string | Buffer): void => {
        keyBuffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        processKeys();
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      raw.setRawMode?.(true);
      input.on("data", onData);
    });
  }
}

function isRawTerminal(input: NodeJS.ReadableStream | undefined): input is NodeJS.ReadableStream & { isTTY: true; setRawMode: (enabled: boolean) => void } {
  const candidate = input as (NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (enabled: boolean) => void }) | undefined;
  return candidate?.isTTY === true && typeof candidate.setRawMode === "function";
}
