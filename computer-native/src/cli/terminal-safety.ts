export interface SanitizedTerminalChunk {
  readonly text: string;
  readonly pending: string;
}

function isCsiFinal(value: string): boolean {
  const code = value.charCodeAt(0);
  return code >= 0x40 && code <= 0x7e;
}

/**
 * Remove terminal control sequences from untrusted text. The pending suffix
 * lets streamed provider chunks split an escape sequence without leaking the
 * first chunk to the terminal.
 */
export function sanitizeTerminalChunk(value: string, pending: string): SanitizedTerminalChunk {
  const input = pending + value;
  let text = "";
  let index = 0;
  while (index < input.length) {
    if (input[index] !== "\u001b") {
      const code = input.charCodeAt(index);
      if (code === 0x09 || code === 0x0a || code >= 0x20 && code !== 0x7f) text += input[index];
      index += 1;
      continue;
    }
    if (index + 1 >= input.length) return { text, pending: input.slice(index) };
    const kind = input[index + 1];
    if (kind === "[") {
      let end = index + 2;
      while (end < input.length && !isCsiFinal(input[end] ?? "")) end += 1;
      if (end >= input.length) return { text, pending: input.slice(index) };
      index = end + 1;
      continue;
    }
    if (kind === "]" || kind === "P" || kind === "^" || kind === "_" || kind === "X") {
      let end = index + 2;
      let terminator = -1;
      while (end < input.length) {
        if (input[end] === "\u0007") {
          terminator = end;
          break;
        }
        if (input[end] === "\u001b" && input[end + 1] === "\\") {
          terminator = end + 1;
          break;
        }
        end += 1;
      }
      if (terminator < 0) return { text, pending: input.slice(index) };
      index = terminator + 1;
      continue;
    }
    // Drop an unrecognised two-byte escape rather than allowing it to reach the terminal.
    index += 2;
  }
  return { text, pending: "" };
}

export function sanitizeTerminalText(value: string): string {
  return sanitizeTerminalChunk(value, "").text;
}

export function sanitizeTerminalSingleLine(value: string): string {
  return sanitizeTerminalText(value).replace(/\s+/gu, " ").trim();
}
