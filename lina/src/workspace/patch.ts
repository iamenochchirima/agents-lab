import { createHash } from "node:crypto";
import { MutationError } from "../runtime/errors.js";

export type PatchOperation = "add" | "update";
export type WorkspaceMutationOperation = PatchOperation | "write" | "patch-set" | "mkdir" | "delete" | "delete-directory" | "delete-directory-tree" | "restore" | "restore-directory" | "purge-quarantine" | "copy" | "move" | "rename";

export interface PreparedPatch {
  readonly operation: PatchOperation | "write";
  readonly path: string;
  readonly beforeContent: string;
  readonly afterContent: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly diff: string;
  readonly addedLines: number;
  readonly removedLines: number;
}

export interface PatchDescriptor {
  readonly operation: PatchOperation;
  readonly path: string;
}

interface PatchHunk {
  readonly oldLines: readonly string[];
  readonly newLines: readonly string[];
}

interface DiffLine {
  readonly prefix: " " | "+" | "-";
  readonly line: string;
}

function patchError(message: string): MutationError {
  return new MutationError("mutation-invalid", `Invalid patch: ${message}`);
}

function assertTextContent(content: string, label: string): void {
  if (content.includes("\u0000")) throw patchError(`${label} appears to be binary; NUL content is not supported.`);
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
}

function contentLines(value: string): { readonly lines: string[]; readonly trailingNewline: boolean; readonly eol: string } {
  const normalized = normalizeLineEndings(value);
  const trailingNewline = normalized.endsWith("\n");
  if (normalized.length === 0) return { lines: [], trailingNewline: false, eol: "\n" };
  const lines = normalized.split("\n");
  if (trailingNewline) lines.pop();
  return { lines, trailingNewline, eol: value.includes("\r\n") ? "\r\n" : "\n" };
}

function parsePatch(patchText: string): PatchDescriptor & { readonly hunks: readonly PatchHunk[] } {
  const lines = normalizeLineEndings(patchText).split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines[0] !== "*** Begin Patch") throw patchError("expected '*** Begin Patch' as the first line.");
  if (lines.at(-1) !== "*** End Patch") throw patchError("expected '*** End Patch' as the last line.");

  const body = lines.slice(1, -1);
  const header = body[0];
  if (!header) throw patchError("a single file operation is required.");

  let operation: PatchOperation;
  let pathStart: string;
  if (header.startsWith("*** Update File:")) {
    operation = "update";
    pathStart = header.slice("*** Update File:".length);
  } else if (header.startsWith("*** Add File:")) {
    operation = "add";
    pathStart = header.slice("*** Add File:".length);
  } else {
    throw patchError("only 'Update File' and 'Add File' operations are supported.");
  }

  const path = pathStart.trim();
  if (path.length === 0) throw patchError("the target path cannot be empty.");
  if (path.includes("\u0000")) throw patchError("the target path cannot contain a NUL byte.");

  const remaining = body.slice(1);
  if (remaining.some((line) => line.startsWith("*** "))) {
    throw patchError("exactly one file operation is allowed per patch.");
  }

  if (operation === "add") {
    if (remaining.length === 0 || remaining.some((line) => !line.startsWith("+"))) {
      throw patchError("an added file must contain only '+' content lines.");
    }
    return {
      operation,
      path,
      hunks: [{ oldLines: [], newLines: remaining.map((line) => line.slice(1)) }],
    };
  }

  const hunks: PatchHunk[] = [];
  let current: { oldLines: string[]; newLines: string[] } | undefined;
  for (const line of remaining) {
    if (line.startsWith("@@")) {
      if (current) {
        if (current.oldLines.length === 0) throw patchError("an update hunk must include context or removed content.");
        hunks.push(current);
      }
      current = { oldLines: [], newLines: [] };
      continue;
    }
    if (!current) throw patchError("an update operation must contain a hunk header beginning with '@@'.");
    const prefix = line[0];
    if (prefix === " " || prefix === "-") current.oldLines.push(line.slice(1));
    if (prefix === " " || prefix === "+") current.newLines.push(line.slice(1));
    if (prefix !== " " && prefix !== "-" && prefix !== "+") {
      // The repository's patch format also permits unprefixed context lines.
      // Treating them as context keeps the parser compatible with patches
      // copied from a terminal while still rejecting malformed control lines.
      current.oldLines.push(line);
      current.newLines.push(line);
    }
  }
  if (current) {
    if (current.oldLines.length === 0) throw patchError("an update hunk must include context or removed content.");
    hunks.push(current);
  }
  if (hunks.length === 0) throw patchError("an update operation must contain at least one hunk.");
  return { operation, path, hunks };
}

export function describePatch(patchText: string): PatchDescriptor {
  const parsed = parsePatch(patchText);
  return { operation: parsed.operation, path: parsed.path };
}

function findUniqueSequence(lines: readonly string[], sequence: readonly string[]): number {
  const matches: number[] = [];
  for (let index = 0; index <= lines.length - sequence.length; index += 1) {
    if (sequence.every((line, offset) => lines[index + offset] === line)) matches.push(index);
  }
  if (matches.length === 0) throw patchError("the expected file context was not found.");
  if (matches.length > 1) throw patchError("the file context is ambiguous; refusing to guess which occurrence to change.");
  return matches[0]!;
}

function applyHunks(existingContent: string, hunks: readonly PatchHunk[]): string {
  const source = contentLines(existingContent);
  const lines = [...source.lines];
  for (const hunk of hunks) {
    const start = findUniqueSequence(lines, hunk.oldLines);
    lines.splice(start, hunk.oldLines.length, ...hunk.newLines);
  }
  const normalized = lines.join("\n") + (source.trailingNewline ? "\n" : "");
  return source.eol === "\r\n" ? normalized.replace(/\n/gu, "\r\n") : normalized;
}

function buildDiff(beforeContent: string, afterContent: string, targetPath: string): { readonly diff: string; readonly addedLines: number; readonly removedLines: number } {
  const beforeSource = contentLines(beforeContent);
  const afterSource = contentLines(afterContent);
  const before = beforeSource.lines;
  const after = afterSource.lines;
  const table: number[][] = Array.from({ length: before.length + 1 }, () => Array<number>(after.length + 1).fill(0));
  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      table[beforeIndex]![afterIndex] = before[beforeIndex] === after[afterIndex]
        ? table[beforeIndex + 1]![afterIndex + 1]! + 1
        : Math.max(table[beforeIndex + 1]![afterIndex]!, table[beforeIndex]![afterIndex + 1]!);
    }
  }

  const lines: DiffLine[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < before.length || afterIndex < after.length) {
    if (beforeIndex < before.length && afterIndex < after.length && before[beforeIndex] === after[afterIndex]) {
      lines.push({ prefix: " ", line: before[beforeIndex]! });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (afterIndex >= after.length || (beforeIndex < before.length && table[beforeIndex + 1]![afterIndex]! >= table[beforeIndex]![afterIndex + 1]!)) {
      lines.push({ prefix: "-", line: before[beforeIndex]! });
      beforeIndex += 1;
    } else {
      lines.push({ prefix: "+", line: after[afterIndex]! });
      afterIndex += 1;
    }
  }
  const addedLines = lines.filter((line) => line.prefix === "+").length;
  const removedLines = lines.filter((line) => line.prefix === "-").length;
  const newlineNote = beforeSource.trailingNewline === afterSource.trailingNewline
    ? []
    : [`\\ newline at end: before ${beforeSource.trailingNewline ? "present" : "absent"}, after ${afterSource.trailingNewline ? "present" : "absent"}`];
  return {
    diff: [`--- a/${targetPath}`, `+++ b/${targetPath}`, "@@", ...lines.map((line) => `${line.prefix}${line.line}`), ...newlineNote].join("\n") + "\n",
    addedLines,
    removedLines,
  };
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function contentHashBytes(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function prepareFileWrite(path: string, beforeContent: string, afterContent: string): PreparedPatch {
  if (path.trim().length === 0) throw new MutationError("mutation-invalid", "Invalid file write: the target path cannot be empty.");
  if (path.includes("\u0000")) throw new MutationError("mutation-invalid", "Invalid file write: the target path cannot contain a NUL byte.");
  assertTextContent(beforeContent, "The existing file content");
  assertTextContent(afterContent, "The proposed file content");
  return {
    operation: "write",
    path,
    beforeContent,
    afterContent,
    beforeHash: contentHash(beforeContent),
    afterHash: contentHash(afterContent),
    ...buildDiff(beforeContent, afterContent, path),
  };
}

export function preparePatch(patchText: string, existingContent = ""): PreparedPatch {
  const parsed = parsePatch(patchText);
  assertTextContent(existingContent, "The existing file content");
  if (parsed.operation === "add") {
    if (existingContent.length > 0) throw patchError(`cannot add '${parsed.path}' because it already has content.`);
    const afterContent = parsed.hunks[0]!.newLines.join("\n") + "\n";
    assertTextContent(afterContent, "The proposed file content");
    const diff = buildDiff(existingContent, afterContent, parsed.path);
    return {
      operation: parsed.operation,
      path: parsed.path,
      beforeContent: existingContent,
      afterContent,
      beforeHash: contentHash(existingContent),
      afterHash: contentHash(afterContent),
      ...diff,
    };
  }
  const afterContent = applyHunks(existingContent, parsed.hunks);
  assertTextContent(afterContent, "The proposed file content");
  const diff = buildDiff(existingContent, afterContent, parsed.path);
  return {
    operation: parsed.operation,
    path: parsed.path,
    beforeContent: existingContent,
    afterContent,
    beforeHash: contentHash(existingContent),
    afterHash: contentHash(afterContent),
    ...diff,
  };
}
