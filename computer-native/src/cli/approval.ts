import type { Writable } from "node:stream";
import { redactSecrets } from "../runtime/errors.js";

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
  readonly pauseInput?: () => void;
  readonly resumeInput?: () => void;
  /** Raw terminal input is used only when the caller explicitly supplies a TTY. */
  readonly rawInput?: NodeJS.ReadableStream;
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
  return result;
}

function panelRule(title: string, width: number): string {
  return `╭─ ${title} ${"─".repeat(Math.max(1, width - title.length - 1))}╮`;
}

function panelBottom(width: number): string {
  return `╰${"─".repeat(width + 2)}╯`;
}

function panelRow(label: string, value: string, width: number, secrets: readonly string[]): string {
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
    style(options.colour, "33;1", panelRule(panel.title, width)),
    ...rows.map(([label, value]) => style(options.colour, "2", panelRow(label, value, width, secrets))),
    style(options.colour, "33;1", panelBottom(width)),
  ];
  return `${lines.join("\n")}\n`;
}

export function parseApprovalAction(input: string): ApprovalAction {
  const normalized = input.trim().toLowerCase();
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
    if (isRawTerminal(options.rawInput)) {
      options.pauseInput?.();
      let choice: Awaited<ReturnType<ApprovalPrompt["askKeyboard"]>>;
      try {
        choice = await this.askKeyboard(options.rawInput, options.signal, "approve once", "deny", () => this.writeDetails(panel));
      } finally {
        options.resumeInput?.();
      }
      if (choice === "approve") return { decision: "allow-once" };
      if (choice === "cancel") return { decision: "unavailable", reason: "The approval prompt was cancelled before the operation started." };
      return { decision: "deny", reason: "The user did not approve the proposed operation." };
    }
    let detailsShown = false;
    for (;;) {
      if (detailsShown) this.writeDetails(panel);
      const answer = await this.readAnswer("Choice [a] approve once · [d] deny · [v] details · Esc cancel", options);
      if (answer.kind === "cancelled") {
        return { decision: "unavailable", reason: "The approval prompt was cancelled before the operation started." };
      }
      const action = parseApprovalAction(answer.value);
      if (action.kind === "details") {
        detailsShown = true;
        continue;
      }
      if (action.kind === "approve-once") return { decision: "allow-once" };
      if (action.kind === "cancel") return { decision: "unavailable", reason: "The approval prompt was cancelled before the operation started." };
      return { decision: "deny", reason: "The user did not approve the proposed operation." };
    }
  }

  async askDialog(panel: ApprovalPanel, dialog: BrowserDialogKind, options: ApprovalQuestionOptions): Promise<DialogApprovalResult> {
    this.writePanel(panel);
    if (dialog !== "prompt" && isRawTerminal(options.rawInput)) {
      options.pauseInput?.();
      let choice: Awaited<ReturnType<ApprovalPrompt["askKeyboard"]>>;
      try {
        choice = await this.askKeyboard(options.rawInput, options.signal, "accept", "dismiss", () => this.writeDetails(panel));
      } finally {
        options.resumeInput?.();
      }
      if (choice === "approve") return { decision: "allow-once", dialogDecision: "accept" };
      if (choice === "cancel") return { decision: "unavailable", reason: "The approval prompt was cancelled before the dialog was resolved." };
      return { decision: "allow-once", dialogDecision: "dismiss" };
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
  ): Promise<"approve" | "deny" | "cancel"> {
    type Choice = "approve" | "deny" | "cancel";
    const choices: readonly Choice[] = ["approve", "deny", "cancel"];
    let selected = 1;
    let detailsShown = false;
    const labels: Record<Choice, string> = { approve: approveLabel, deny: denyLabel, cancel: "cancel" };
    const renderChoices = (): void => {
      const line = choices.map((choice, index) => `${index === selected ? "›" : " "} [${choice === "approve" ? "a" : choice === "deny" ? "d" : "Esc"}] ${labels[choice]}`).join("   ");
      this.output.write(`\n${style(this.colour, "33;1", line)}${style(this.colour, "2", " · arrows/j/k move · Enter select · v details")}\n`);
    };
    renderChoices();
    return new Promise((resolve) => {
      let settled = false;
      const raw = input as NodeJS.ReadableStream & { setRawMode?: (enabled: boolean) => void };
      const finish = (choice: "approve" | "deny" | "cancel"): void => {
        if (settled) return;
        settled = true;
        input.removeListener("data", onData);
        signal?.removeEventListener("abort", onAbort);
        raw.setRawMode?.(false);
        this.output.write("\n");
        resolve(choice);
      };
      const onAbort = (): void => finish("cancel");
      const onData = (chunk: string | Buffer): void => {
        const value = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (value.includes("\u0003") || value === "\u001b") return finish("cancel");
        if (value.includes("\u001b[A") || value.toLowerCase() === "k") selected = Math.max(0, selected - 1);
        else if (value.includes("\u001b[B") || value.toLowerCase() === "j") selected = Math.min(choices.length - 1, selected + 1);
        else if (value.toLowerCase() === "a") return finish("approve");
        else if (value.toLowerCase() === "d") return finish("deny");
        else if (value.toLowerCase() === "v") {
          detailsShown = !detailsShown;
          this.output.write(`${style(this.colour, "36;1", detailsShown ? "Details shown" : "Details hidden")}\n`);
          if (detailsShown) showDetails();
        } else if (value.includes("\r") || value.includes("\n")) return finish(choices[selected] ?? "cancel");
        renderChoices();
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
