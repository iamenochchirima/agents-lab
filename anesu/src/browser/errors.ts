import { AnesuError } from "../runtime/errors.js";
import type { BrowserDialogDecision, BrowserDialogObservation } from "./contracts.js";

export interface BrowserDiagnostic {
  readonly name: string;
  readonly message: string;
}

export type BrowserErrorCode =
  | "session-not-found"
  | "session-closed"
  | "session-timeout"
  | "tab-not-found"
  | "tab-closed"
  | "tab-ownership"
  | "navigation-policy"
  | "stale-reference"
  | "invalid-action"
  | "browser-timeout"
  | "browser-cancelled"
  | "browser-crash"
  | "browser-ambiguous"
  | "browser-resource-limit"
  | "artifact-violation"
  | "adapter-failure";

export class BrowserError extends AnesuError {
  readonly browserCode: BrowserErrorCode;
  readonly dialog?: BrowserDialogObservation;
  readonly dialogDecision?: BrowserDialogDecision;
  readonly cancellationConfirmed?: boolean;
  readonly diagnostic?: BrowserDiagnostic;

  constructor(code: BrowserErrorCode, message: string, options?: { readonly cause?: unknown; readonly dialog?: BrowserDialogObservation; readonly dialogDecision?: BrowserDialogDecision; readonly cancellationConfirmed?: boolean }) {
    super("browser", message, options);
    this.name = "BrowserError";
    this.browserCode = code;
    this.dialog = options?.dialog;
    this.dialogDecision = options?.dialogDecision;
    this.cancellationConfirmed = options?.cancellationConfirmed;
    if (options?.cause instanceof Error) {
      this.diagnostic = { name: options.cause.name, message: options.cause.message };
    }
  }
}
