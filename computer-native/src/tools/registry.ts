import { stableStringify } from "../persistence/json.js";
import { ToolExecutionError } from "../runtime/errors.js";
import type { ModelToolCall, ModelToolDefinition } from "../runtime/contracts.js";
import type { Workspace } from "../workspace/workspace.js";

export interface ToolExecutionResult {
  readonly callId: string;
  readonly name: string;
  readonly ok: boolean;
  readonly content: string;
  readonly summary: string;
}

interface ToolArguments {
  readonly [key: string]: unknown;
}

const LIST_DIRECTORY: ModelToolDefinition = {
  name: "list_directory",
  description: "List entries in a directory inside the configured workspace. Paths are workspace-relative.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Workspace-relative directory path; defaults to the workspace root." } },
    additionalProperties: false,
  },
};

const READ_FILE: ModelToolDefinition = {
  name: "read_file",
  description: "Read a UTF-8 text file inside the configured workspace. The file must be within the workspace and below the configured size limit.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Workspace-relative file path." } },
    required: ["path"],
    additionalProperties: false,
  },
};

function parseArguments(call: ModelToolCall): ToolArguments {
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.argumentsJson);
  } catch {
    throw new ToolExecutionError(`Tool '${call.name}' received malformed JSON arguments.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ToolExecutionError(`Tool '${call.name}' requires a JSON object of arguments.`);
  }
  return parsed as ToolArguments;
}

function stringArgument(args: ToolArguments, name: string, required: boolean): string | undefined {
  const value = args[name];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) throw new ToolExecutionError(`Tool argument '${name}' must be a non-empty string.`);
  return value;
}

function boundOutput(value: string, maxBytes: number): { readonly text: string; readonly truncated: boolean } {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= maxBytes) return { text: value, truncated: false };
  const marker = `\n[output truncated at ${maxBytes} bytes]`;
  const fit = (input: string, limit: number): string => {
    const source = Buffer.from(input, "utf8");
    for (let length = Math.min(source.byteLength, limit); length >= 0; length -= 1) {
      const candidate = source.subarray(0, length).toString("utf8");
      if (Buffer.byteLength(candidate, "utf8") <= limit) return candidate;
    }
    return "";
  };
  const markerBytes = Buffer.byteLength(marker, "utf8");
  if (markerBytes >= maxBytes) return { text: fit(marker, maxBytes), truncated: true };
  return { text: `${fit(value, maxBytes - markerBytes)}${marker}`, truncated: true };
}

export class ToolRegistry {
  readonly definitions: readonly ModelToolDefinition[] = [LIST_DIRECTORY, READ_FILE];

  constructor(
    private readonly workspace: Workspace,
    private readonly maxOutputBytes: number,
  ) {}

  async execute(call: ModelToolCall): Promise<ToolExecutionResult> {
    try {
      const args = parseArguments(call);
      const result = call.name === LIST_DIRECTORY.name
        ? await this.listDirectory(call, args)
        : call.name === READ_FILE.name
          ? await this.readFile(call, args)
          : this.unknown(call);
      return result;
    } catch (error) {
      const message = error instanceof ToolExecutionError ? error.safeMessage : error instanceof Error ? error.message : "Tool execution failed.";
      return {
        callId: call.callId,
        name: call.name,
        ok: false,
        content: `Tool error: ${message}`,
        summary: message,
      };
    }
  }

  private unknown(call: ModelToolCall): ToolExecutionResult {
    throw new ToolExecutionError(`Unknown tool '${call.name}'.`);
  }

  private async listDirectory(call: ModelToolCall, args: ToolArguments): Promise<ToolExecutionResult> {
    const requestedPath = stringArgument(args, "path", false) ?? ".";
    const listing = await this.workspace.listDirectory(requestedPath);
    const output = boundOutput(stableStringify(listing), this.maxOutputBytes);
    return {
      callId: call.callId,
      name: call.name,
      ok: true,
      content: output.text,
      summary: `Listed ${listing.path} (${listing.entries.length} entries${listing.truncated ? ", truncated" : ""}).`,
    };
  }

  private async readFile(call: ModelToolCall, args: ToolArguments): Promise<ToolExecutionResult> {
    const requestedPath = stringArgument(args, "path", true);
    const file = await this.workspace.readFile(requestedPath ?? "");
    const output = boundOutput(file.content, this.maxOutputBytes);
    return {
      callId: call.callId,
      name: call.name,
      ok: true,
      content: output.text,
      summary: `Read ${file.path} (${file.sizeBytes} bytes${output.truncated ? ", output truncated" : ""}).`,
    };
  }
}
