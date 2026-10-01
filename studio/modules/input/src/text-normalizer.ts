import type { ModuleIdentity } from "@agent-harness-lab/agent-protocol";
import { parseInputConfig, type InputConfig } from "./config.js";
import {
  InputNormalizationError,
  type InputNormalizer,
  type InputSourceMetadata,
  type NormalizedInput,
  type NormalizedInputPart,
  type RawInput,
  type RawInputAttachment,
} from "./contract.js";

const IDENTITY: ModuleIdentity = Object.freeze({ id: "text-input-normalizer", version: "0.1.0" });
const SOURCE_KINDS = new Set(["user", "file", "service", "event"]);
const TRUST_LABELS = new Set(["trusted", "untrusted"]);
const RFC3339_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|([+-])(\d{2}):(\d{2}))$/;
const UTC_LEAP_SECOND_DATES = new Set([
  "1972-06-30", "1972-12-31", "1973-12-31", "1974-12-31", "1975-12-31", "1976-12-31",
  "1977-12-31", "1978-12-31", "1979-12-31", "1981-06-30", "1982-06-30", "1983-06-30",
  "1985-06-30", "1987-12-31", "1989-12-31", "1990-12-31", "1992-06-30", "1993-06-30",
  "1994-06-30", "1995-12-31", "1997-06-30", "1998-12-31", "2005-12-31", "2008-12-31",
  "2012-06-30", "2015-06-30", "2016-12-31",
]);

/**
 * Deterministic, stateless text normalizer. Part IDs derive only from supplied
 * source and attachment IDs; attachment references are copied as metadata and
 * are never opened or fetched.
 */
class TextInputNormalizer implements InputNormalizer {
  readonly identity = IDENTITY;

  constructor(private readonly config: InputConfig) {}

  normalize(raw: RawInput, source: InputSourceMetadata): NormalizedInput {
    const input = requireRecord(raw, "Raw input must be an object.", "INVALID_RAW_INPUT");
    rejectUnknownKeys(input, ["text", "attachments"], "INVALID_RAW_INPUT", "Raw input");
    const text = input.text;
    if (typeof text !== "string" || !isWellFormedUnicode(text) || text.trim().length === 0) {
      throw invalidRaw("Raw input text must be non-empty, well-formed Unicode text.");
    }

    const textBytes = new TextEncoder().encode(text).byteLength;
    if (textBytes > this.config.maxTextBytes) {
      throw new InputNormalizationError(
        "INPUT_TOO_LARGE",
        `Raw input text is ${textBytes} UTF-8 bytes; the configured limit is ${this.config.maxTextBytes}.`,
      );
    }

    const normalizedSource = validateAndCopySource(source);
    const attachments = validateAndCopyAttachments(input.attachments, this.config.maxAttachments);
    const sourceKey = encodeURIComponent(normalizedSource.sourceId);
    const parts: NormalizedInputPart[] = [Object.freeze({
      partId: `input:${sourceKey}:text`,
      kind: "text",
      content: text,
    })];

    for (const attachment of attachments) {
      parts.push(Object.freeze({
        partId: `input:${sourceKey}:attachment:${encodeURIComponent(attachment.attachmentId)}`,
        kind: "attachment-reference",
        attachment,
      }));
    }

    return Object.freeze({
      task: text,
      parts: Object.freeze(parts),
      source: normalizedSource,
    });
  }
}

/** Create the initial text implementation using either defaults or config overrides. */
export function createTextInputNormalizer(config: unknown = {}): InputNormalizer {
  return new TextInputNormalizer(parseInputConfig(config));
}

function validateAndCopySource(value: unknown): InputSourceMetadata {
  const source = requireRecord(value, "Source metadata must be an object.", "INVALID_SOURCE_METADATA");
  rejectUnknownKeys(source, ["sourceId", "kind", "trust", "receivedAt", "mediaType"], "INVALID_SOURCE_METADATA", "Source metadata");
  requireIdentifier(source.sourceId, "sourceId", "INVALID_SOURCE_METADATA");
  if (typeof source.kind !== "string" || !SOURCE_KINDS.has(source.kind)) {
    throw invalidSourceMetadata("Source kind must be user, file, service, or event.");
  }
  if (typeof source.trust !== "string" || !TRUST_LABELS.has(source.trust)) {
    throw invalidSourceMetadata("Source trust must be trusted or untrusted.");
  }
  if (typeof source.receivedAt !== "string" || !isValidRfc3339Timestamp(source.receivedAt)) {
    throw invalidSourceMetadata("receivedAt must be an RFC 3339 date-time with an explicit UTC designator or numeric offset.");
  }
  if (source.mediaType !== undefined) requireMetadataText(source.mediaType, "mediaType", "INVALID_SOURCE_METADATA");

  const copy: InputSourceMetadata = {
    sourceId: source.sourceId as string,
    kind: source.kind as InputSourceMetadata["kind"],
    trust: source.trust as InputSourceMetadata["trust"],
    receivedAt: source.receivedAt,
    ...(source.mediaType === undefined ? {} : { mediaType: source.mediaType as string }),
  };
  return Object.freeze(copy);
}

function validateAndCopyAttachments(value: unknown, maxAttachments: number): readonly RawInputAttachment[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw invalidRaw("attachments must be an array when provided.");
  if (value.length > maxAttachments) {
    throw new InputNormalizationError(
      "INPUT_TOO_LARGE",
      `Raw input has ${value.length} attachments; the configured limit is ${maxAttachments}.`,
    );
  }

  const seenIds = new Set<string>();
  const attachments: RawInputAttachment[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index];
    const attachment = requireRecord(entry, `Attachment ${index} must be an object.`, "INVALID_RAW_INPUT");
    rejectUnknownKeys(attachment, ["attachmentId", "name", "mediaType", "byteLength"], "INVALID_RAW_INPUT", `Attachment ${index}`);
    requireIdentifier(attachment.attachmentId, `attachments[${index}].attachmentId`, "INVALID_RAW_INPUT");
    if (seenIds.has(attachment.attachmentId as string)) {
      throw invalidRaw(`Attachment ID ${JSON.stringify(attachment.attachmentId)} appears more than once.`);
    }
    seenIds.add(attachment.attachmentId as string);
    requireMetadataText(attachment.name, `attachments[${index}].name`, "INVALID_RAW_INPUT");
    requireMetadataText(attachment.mediaType, `attachments[${index}].mediaType`, "INVALID_RAW_INPUT");
    if (typeof attachment.byteLength !== "number" || !Number.isSafeInteger(attachment.byteLength) || attachment.byteLength < 0) {
      throw invalidRaw(`Attachment ${index} byteLength must be a non-negative safe integer.`);
    }
    attachments.push(Object.freeze({
      attachmentId: attachment.attachmentId as string,
      name: attachment.name as string,
      mediaType: attachment.mediaType as string,
      byteLength: attachment.byteLength,
    }));
  }
  return Object.freeze(attachments);
}

function requireRecord(value: unknown, message: string, code: "INVALID_RAW_INPUT" | "INVALID_SOURCE_METADATA"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InputNormalizationError(code, message);
  }
  return value as Record<string, unknown>;
}

function requireIdentifier(value: unknown, field: string, code: "INVALID_RAW_INPUT" | "INVALID_SOURCE_METADATA"): void {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || /[\p{Cc}]/u.test(value) || !isWellFormedUnicode(value)) {
    throw new InputNormalizationError(code, `${field} must be non-empty text without surrounding whitespace or control characters.`);
  }
}

function requireMetadataText(value: unknown, field: string, code: "INVALID_RAW_INPUT" | "INVALID_SOURCE_METADATA"): void {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || /[\p{Cc}]/u.test(value) || !isWellFormedUnicode(value)) {
    throw new InputNormalizationError(code, `${field} must be non-empty text without surrounding whitespace or control characters.`);
  }
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  code: "INVALID_RAW_INPUT" | "INVALID_SOURCE_METADATA",
  label: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new InputNormalizationError(code, `${label} field ${JSON.stringify(key)} is not supported.`);
  }
}

function isValidRfc3339Timestamp(value: string): boolean {
  const match = RFC3339_TIMESTAMP.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone, sign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (year === 0 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)
    || hour > 23 || minute > 59 || second > 60) return false;
  const offsetHour = zone?.toLowerCase() === "z" ? 0 : Number(offsetHourText);
  const offsetMinute = zone?.toLowerCase() === "z" ? 0 : Number(offsetMinuteText);
  if (offsetHour > 23 || offsetMinute > 59 || (zone?.toLowerCase() !== "z" && sign !== "+" && sign !== "-")) return false;
  if (second !== 60) return true;

  // RFC 3339 permits :60 only where a UTC leap second was actually inserted.
  // Convert the supplied offset representation to the following UTC midnight.
  const offsetMilliseconds = (offsetHour * 60 + offsetMinute) * 60_000 * (sign === "+" ? 1 : -1);
  const utcAfterLeap = new Date(Date.UTC(year, month - 1, day, hour, minute, 59) - offsetMilliseconds + 1_000);
  if (utcAfterLeap.getUTCHours() !== 0 || utcAfterLeap.getUTCMinutes() !== 0 || utcAfterLeap.getUTCSeconds() !== 0) return false;
  const utcLeapDate = new Date(utcAfterLeap.getTime() - 86_400_000);
  return UTC_LEAP_SECOND_DATES.has(
    `${utcLeapDate.getUTCFullYear().toString().padStart(4, "0")}-${(utcLeapDate.getUTCMonth() + 1).toString().padStart(2, "0")}-${utcLeapDate.getUTCDate().toString().padStart(2, "0")}`,
  );
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function invalidRaw(message: string): InputNormalizationError {
  return new InputNormalizationError("INVALID_RAW_INPUT", message);
}

function invalidSourceMetadata(message: string): InputNormalizationError {
  return new InputNormalizationError("INVALID_SOURCE_METADATA", message);
}
