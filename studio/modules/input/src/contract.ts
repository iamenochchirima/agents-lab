import type { ModuleIdentity } from "@agent-harness-lab/agent-protocol";
import type { InputConfig } from "./config.js";

export type InputSourceKind = "user" | "file" | "service" | "event";
export type InputTrust = "trusted" | "untrusted";

/** Provenance supplied by the host; normalization must preserve it. */
export interface InputSourceMetadata {
  readonly sourceId: string;
  readonly kind: InputSourceKind;
  readonly trust: InputTrust;
  readonly receivedAt: string;
  readonly mediaType?: string;
}

/** Attachments are references, not file contents or capabilities to read them. */
export interface RawInputAttachment {
  readonly attachmentId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly byteLength: number;
}

export interface RawInput {
  readonly text: string;
  readonly attachments?: readonly RawInputAttachment[];
}

export type NormalizedInputPart =
  | { readonly partId: string; readonly kind: "text"; readonly content: string }
  | { readonly partId: string; readonly kind: "attachment-reference"; readonly attachment: RawInputAttachment };

export interface NormalizedInput {
  readonly task: string;
  readonly parts: readonly NormalizedInputPart[];
  readonly source: InputSourceMetadata;
}

export type InputNormalizationErrorCode = "INVALID_RAW_INPUT" | "INVALID_SOURCE_METADATA" | "INPUT_TOO_LARGE";

export class InputNormalizationError extends Error {
  constructor(readonly code: InputNormalizationErrorCode, message: string) {
    super(message);
    this.name = "InputNormalizationError";
  }
}

/**
 * Convert one host-provided request into provenance-preserving task data.
 * Implementations must not infer that untrusted source content is authoritative.
 */
export interface InputNormalizer {
  readonly identity: ModuleIdentity;
  normalize(raw: RawInput, source: InputSourceMetadata): NormalizedInput;
}

export type InputNormalizerFactory = (config: InputConfig) => InputNormalizer;
