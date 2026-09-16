import { randomUUID } from "node:crypto";
import { stableStringify } from "../persistence/json.js";
import { MutationError, ProcessExecutionError, redactSecrets, safeErrorMessage, ToolExecutionError } from "../runtime/errors.js";
import type { ModelToolCall, ModelToolDefinition, ProcessErrorCode } from "../runtime/contracts.js";
import { LocalProcessRunner } from "../process/local-runner.js";
import type { ProcessApprovalDecision, ProcessApprovalRequest, ProcessEvent, ProcessResult, ProcessRunner, ProcessToolEvent } from "../process/process.js";
import type { ProcessSecurityPolicy } from "../security/process-policy.js";

export type { ProcessToolEvent } from "../process/process.js";
import { MAX_MUTATION_SET_FILES, MAX_MUTATION_SET_REQUEST_BYTES, MAX_PATCH_REQUEST_BYTES, MAX_WRITE_FILE_REQUEST_BYTES, type MutationApproval, type MutationEvent, type MutationRisk } from "../workspace/mutation.js";
import type { MutationErrorCode } from "../runtime/contracts.js";
import { DEFAULT_SEARCH_MAX_MATCHES, MAX_QUARANTINE_ENTRIES, MAX_SEARCH_MATCHES, type PreparedWorkspaceMutation, type Workspace } from "../workspace/workspace.js";
import { BrowserError, BrowserTools, type BrowserApprovalDecision, type BrowserApprovalRequest, type BrowserToolErrorCode, type BrowserToolEvent, type BrowserToolOptions } from "../browser/index.js";

export interface ToolExecutionResult {
  readonly callId: string;
  readonly name: string;
  readonly ok: boolean;
  readonly content: string;
  readonly summary: string;
  readonly mutationId?: string;
  readonly errorCode?: MutationErrorCode | ProcessErrorCode | BrowserToolErrorCode;
}

export interface ProcessToolOptions {
  readonly policy: ProcessSecurityPolicy;
  readonly runner?: ProcessRunner;
  readonly redactionSecrets?: readonly string[];
}

export type { BrowserToolEvent } from "../browser/tools.js";

export interface ToolExecutionContext {
  readonly signal?: AbortSignal;
  readonly approvalTimeoutMs?: number;
  readonly pauseDeadline?: () => void;
  readonly resumeDeadline?: () => void;
  readonly pauseTurnDeadline?: () => void;
  readonly resumeTurnDeadline?: () => void;
  readonly approveMutation?: MutationApproval;
  readonly onMutation?: (event: MutationEvent) => Promise<void> | void;
  readonly approveProcess?: (request: ProcessApprovalRequest, signal?: AbortSignal) => Promise<ProcessApprovalDecision>;
  readonly onProcess?: (event: ProcessToolEvent) => Promise<void> | void;
  readonly approveBrowser?: (request: BrowserApprovalRequest, signal?: AbortSignal) => Promise<BrowserApprovalDecision>;
  readonly onBrowser?: (event: BrowserToolEvent) => Promise<void> | void;
  readonly processCallLimitReached?: boolean;
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

const STAT: ModelToolDefinition = {
  name: "stat",
  description: "Inspect bounded metadata for a path inside the configured workspace without reading file contents. Reports file type, size, timestamps, mode, and link count; symbolic-link targets are not followed.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Workspace-relative file, directory, or symbolic-link path." } },
    required: ["path"],
    additionalProperties: false,
  },
};

const SEARCH_FILES: ModelToolDefinition = {
  name: "search_files",
  description: "Search bounded workspace results by literal UTF-8 content, path-name pattern, or both. Use '*' and '?' for a relative name pattern; bracket expressions, traversal, and absolute patterns are rejected. Hidden, generated, sensitive, symbolic-link, oversized, and binary files are skipped.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative directory or file to search; defaults to the workspace root." },
      query: { type: "string", description: "Optional literal UTF-8 text to find." },
      namePattern: { type: "string", description: "Optional relative path-name pattern using '*' or '?' wildcards." },
      maxResults: { type: "integer", minimum: 1, maximum: MAX_SEARCH_MATCHES, description: "Maximum number of matching lines/occurrences to return; defaults to 100." },
    },
    additionalProperties: false,
  },
};

const LIST_QUARANTINE: ModelToolDefinition = {
  name: "list_quarantine",
  description: "List bounded metadata for files and directory trees held in the workspace recovery quarantine. This is read-only, never returns quarantined contents, and does not permanently remove anything.",
  inputSchema: {
    type: "object",
    properties: { maxEntries: { type: "integer", minimum: 1, maximum: MAX_QUARANTINE_ENTRIES, description: "Maximum recovery entries to return; defaults to 100." } },
    additionalProperties: false,
  },
};

const WRITE_FILE: ModelToolDefinition = {
  name: "write_file",
  description: "Prepare a complete UTF-8 text replacement or creation for one file inside the configured workspace. The exact bounded diff is shown for explicit approval before writing; this tool never edits multiple files.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative target file path." },
      content: { type: "string", description: "Complete UTF-8 text that should replace or create the file; an empty string is allowed." },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
};

const MKDIR: ModelToolDefinition = {
  name: "mkdir",
  description: "Prepare creation of one directory inside the configured workspace. The parent must already exist, recursive parent creation is not performed, and creation requires explicit approval. An existing directory is reported as an idempotent no-op.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Workspace-relative directory path to create." } },
    required: ["path"],
    additionalProperties: false,
  },
};

const DELETE_DIRECTORY: ModelToolDefinition = {
  name: "delete_directory",
  description: "Prepare deletion of one empty directory inside the configured workspace. The operation is never recursive, refuses non-empty directories, and requires explicit approval.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Workspace-relative empty directory path to delete." } },
    required: ["path"],
    additionalProperties: false,
  },
};

const DELETE_DIRECTORY_TREE: ModelToolDefinition = {
  name: "delete_directory_tree",
  description: "Prepare bounded recursive deletion of one directory tree inside the configured workspace. The complete tree is preflighted for symlinks, special files, entry count, byte count, and depth, then moved into workspace quarantine after explicit approval so it can be restored with a token.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Workspace-relative directory path whose bounded tree should be quarantined." } },
    required: ["path"],
    additionalProperties: false,
  },
};

const DELETE_FILE: ModelToolDefinition = {
  name: "delete",
  description: "Prepare deletion of one regular file inside the configured workspace. The file is moved into a workspace-local quarantine after explicit approval and the result includes a restore token; permanent removal is not performed.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Workspace-relative regular file path to quarantine." } },
    required: ["path"],
    additionalProperties: false,
  },
};

const RESTORE_FILE: ModelToolDefinition = {
  name: "restore",
  description: "Prepare restoration of one previously quarantined file using its restore token. The original path must be available and is never overwritten; restoration requires explicit approval.",
  inputSchema: {
    type: "object",
    properties: { mutationId: { type: "string", description: "Restore token returned by a successful delete operation." } },
    required: ["mutationId"],
    additionalProperties: false,
  },
};

const RESTORE_DIRECTORY: ModelToolDefinition = {
  name: "restore_directory",
  description: "Prepare restoration of one previously quarantined directory tree using its restore token. The original path must be absent and the recorded tree manifest is checked before restoring; existing paths are never overwritten.",
  inputSchema: {
    type: "object",
    properties: { mutationId: { type: "string", description: "Restore token returned by a successful delete_directory_tree operation." } },
    required: ["mutationId"],
    additionalProperties: false,
  },
};

const PURGE_QUARANTINE: ModelToolDefinition = {
  name: "purge_quarantine",
  description: "Prepare permanent removal of one exact workspace quarantine entry using its token. This is irreversible, never accepts a path or wildcard, and requires explicit approval.",
  inputSchema: {
    type: "object",
    properties: { mutationId: { type: "string", description: "Exact quarantine token returned by delete or delete_directory_tree." } },
    required: ["mutationId"],
    additionalProperties: false,
  },
};

const COPY_FILE: ModelToolDefinition = {
  name: "copy",
  description: "Prepare a bounded copy of one regular file to a new workspace-relative destination. The source hash is checked again at commit, the destination must remain absent, and explicit approval is required.",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", description: "Workspace-relative regular file to copy." },
      destination: { type: "string", description: "Workspace-relative destination file; it must not already exist." },
    },
    required: ["source", "destination"],
    additionalProperties: false,
  },
};

const MOVE_FILE: ModelToolDefinition = {
  name: "move",
  description: "Prepare a same-filesystem move/rename of one regular file to a new workspace-relative destination. The source hash is checked again at commit, the destination must remain absent, and explicit approval is required.",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", description: "Workspace-relative regular file to move." },
      destination: { type: "string", description: "Workspace-relative destination file; it must not already exist." },
    },
    required: ["source", "destination"],
    additionalProperties: false,
  },
};

const APPLY_PATCH: ModelToolDefinition = {
  name: "apply_patch",
  description: `Prepare one bounded add or update patch for exactly one UTF-8 text file inside the configured workspace. The exact diff is shown for explicit approval before writing. Use this format:
*** Begin Patch
*** Update File: path/to/file.txt
@@
-old line
+new line
*** End Patch
This is exactly one file operation per call: use Update File or Add File. Delete, move, and multi-file patches are not supported.`,
  inputSchema: {
    type: "object",
    properties: { patch: { type: "string", description: "A single-file patch delimited by '*** Begin Patch' and '*** End Patch'." } },
    required: ["patch"],
    additionalProperties: false,
  },
};

const APPLY_PATCH_SET: ModelToolDefinition = {
  name: "apply_patch_set",
  description: `Prepare one bounded multi-file patch set for 2-${MAX_MUTATION_SET_FILES} UTF-8 text files inside the configured workspace. Every patch is validated and hashed before one explicit approval. The set is journaled member-by-member; this tool does not claim all-or-nothing filesystem atomicity and will require reconciliation if an interruption or conflict leaves a partial set.`,
  inputSchema: {
    type: "object",
    properties: {
      patches: {
        type: "array",
        minItems: 2,
        maxItems: MAX_MUTATION_SET_FILES,
        items: { type: "string" },
        description: "Two or more single-file Add/Update patch strings.",
      },
    },
    required: ["patches"],
    additionalProperties: false,
  },
};

const RUN_COMMAND: ModelToolDefinition = {
  name: "run_command",
  description: "Run one approved, non-interactive local command with an exact executable and argument list. The command starts in the workspace or a workspace-relative cwd, uses a sanitized environment, has bounded time/output, and does not interpret shell pipelines, redirection, backgrounding, or stdin.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Executable name or path, such as pnpm, git, or node." },
      args: { type: "array", items: { type: "string" }, description: "Exact arguments passed to the executable; shell syntax is not interpreted." },
      cwd: { type: "string", description: "Optional workspace-relative working directory; defaults to the workspace root." },
      timeoutMs: { type: "integer", minimum: 1, description: "Optional timeout in milliseconds within the configured process limit." },
    },
    required: ["command", "args"],
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

function processResultForFailure(
  request: ProcessApprovalRequest,
  state: Extract<ProcessResult["state"], "failed" | "cancelled" | "ambiguous">,
  errorCode: ProcessErrorCode,
  errorMessage: string,
  started: boolean,
  pid?: number,
): ProcessResult {
  return {
    executionId: request.executionId,
    state,
    started,
    ...(pid !== undefined ? { pid } : {}),
    command: request.command,
    displayArgs: request.displayArgs,
    cwd: request.cwd,
    executablePath: request.executablePath,
    stdout: "",
    stderr: "",
    stdoutBytes: 0,
    stderrBytes: 0,
    outputTruncated: false,
    durationMs: 0,
    terminationConfirmed: false,
    errorCode,
    errorMessage,
  };
}

function processContent(result: ProcessResult, redactionSecrets: readonly string[]): string {
  return stableStringify({
    status: result.state,
    started: result.started,
    command: result.command,
    args: result.displayArgs.map((argument) => redactSecrets(argument, redactionSecrets)),
    cwd: result.cwd,
    stdout: redactSecrets(result.stdout, redactionSecrets),
    stderr: redactSecrets(result.stderr, redactionSecrets),
    stdoutBytes: result.stdoutBytes,
    stderrBytes: result.stderrBytes,
    outputTruncated: result.outputTruncated,
    durationMs: result.durationMs,
    exitCode: result.exitCode ?? null,
    signal: result.signal ?? null,
    terminationConfirmed: result.terminationConfirmed,
    errorCode: result.errorCode ?? null,
    errorMessage: result.errorMessage ?? null,
  });
}

function processSummary(request: ProcessApprovalRequest, result: ProcessResult): string {
  if (result.state === "completed" && result.errorCode === undefined) return "Ran " + request.command + " successfully in " + request.cwd + ".";
  if (result.errorCode === "process-exit") return "Command " + request.command + " exited with code " + (result.exitCode ?? "unknown") + ".";
  return result.errorMessage ?? "Command " + request.command + " did not complete successfully.";
}

function textArgument(args: ToolArguments, name: string, required: boolean): string | undefined {
  const value = args[name];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string") throw new ToolExecutionError(`Tool argument '${name}' must be a string.`);
  return value;
}

function numberArgument(args: ToolArguments, name: string, fallback: number): number {
  const value = args[name];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ToolExecutionError(`Tool argument '${name}' must be a positive integer.`);
  }
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

function mutationRisk(prepared: PreparedWorkspaceMutation): MutationRisk {
  switch (prepared.operation) {
    case "add": return "create-file";
    case "update": return "patch-file";
    case "write": return "replace-file";
    case "mkdir": return "create-directory";
    case "delete": return "quarantine-file";
    case "delete-directory": return "delete-directory";
    case "delete-directory-tree": return "delete-directory-tree";
    case "restore": return "restore-file";
    case "restore-directory": return "restore-directory";
    case "purge-quarantine": return "purge-quarantine";
    case "copy": return "copy-file";
    case "move": return "move-file";
    case "patch-set": return "multi-file-patch";
  }
}

export class ToolRegistry {
  private readonly baseDefinitions: readonly ModelToolDefinition[] = [LIST_DIRECTORY, READ_FILE, STAT, SEARCH_FILES, LIST_QUARANTINE, WRITE_FILE, MKDIR, DELETE_DIRECTORY, DELETE_DIRECTORY_TREE, DELETE_FILE, RESTORE_FILE, RESTORE_DIRECTORY, PURGE_QUARANTINE, COPY_FILE, MOVE_FILE, APPLY_PATCH, APPLY_PATCH_SET];
  readonly definitions: readonly ModelToolDefinition[];
  private readonly browserTools?: BrowserTools;

  constructor(
    private readonly workspace: Workspace,
    private readonly maxOutputBytes: number,
    private readonly process?: ProcessToolOptions,
    browser?: BrowserToolOptions,
  ) {
    this.browserTools = browser ? new BrowserTools(browser) : undefined;
    this.definitions = [
      ...(process ? [...this.baseDefinitions, RUN_COMMAND] : this.baseDefinitions),
      ...(this.browserTools?.definitions ?? []),
    ];
  }

  async execute(call: ModelToolCall, context: ToolExecutionContext = {}): Promise<ToolExecutionResult> {
    try {
      const args = parseArguments(call);
      const result = call.name === LIST_DIRECTORY.name
        ? await this.listDirectory(call, args)
        : call.name === READ_FILE.name
          ? await this.readFile(call, args)
          : call.name === STAT.name
            ? await this.stat(call, args)
            : call.name === SEARCH_FILES.name
            ? await this.searchFiles(call, args, context.signal)
              : call.name === LIST_QUARANTINE.name
                ? await this.listQuarantine(call, args)
              : call.name === WRITE_FILE.name
                ? await this.writeFile(call, args, context)
                : call.name === MKDIR.name
                ? await this.makeDirectory(call, args, context)
                : call.name === DELETE_DIRECTORY.name
                ? await this.deleteDirectory(call, args, context)
                : call.name === DELETE_DIRECTORY_TREE.name
                ? await this.deleteDirectoryTree(call, args, context)
                : call.name === DELETE_FILE.name
                  ? await this.deleteFile(call, args, context)
                  : call.name === RESTORE_FILE.name
                  ? await this.restoreFile(call, args, context)
                  : call.name === RESTORE_DIRECTORY.name
                  ? await this.restoreDirectory(call, args, context)
                  : call.name === PURGE_QUARANTINE.name
                  ? await this.purgeQuarantine(call, args, context)
                    : call.name === COPY_FILE.name
                      ? await this.copyFile(call, args, context)
                        : call.name === MOVE_FILE.name
                          ? await this.moveFile(call, args, context)
                        : call.name === APPLY_PATCH_SET.name
                            ? await this.applyPatchSet(call, args, context)
                          : call.name === RUN_COMMAND.name
                            ? await this.runCommand(call, args, context)
                          : call.name === APPLY_PATCH.name
                          ? await this.applyPatch(call, args, context)
                          : this.browserTools && this.browserTools.definitions.some((definition) => definition.name === call.name)
                            ? await this.executeBrowser(call, args, context)
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
        ...(error instanceof MutationError ? { errorCode: error.mutationCode } : {}),
        ...(error instanceof ProcessExecutionError ? { errorCode: error.processCode } : {}),
        ...(error instanceof BrowserError ? { errorCode: error.browserCode } : {}),
      };
    }
  }

  private async executeBrowser(call: ModelToolCall, args: ToolArguments, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    if (!this.browserTools) throw new ToolExecutionError("Browser tools are disabled by configuration.");
    const outcome = await this.browserTools.execute(call.name, call.callId, args, {
      signal: context.signal,
      approvalTimeoutMs: context.approvalTimeoutMs,
      pauseDeadline: context.pauseDeadline,
      resumeDeadline: context.resumeDeadline,
      pauseTurnDeadline: context.pauseTurnDeadline,
      resumeTurnDeadline: context.resumeTurnDeadline,
      approveBrowser: context.approveBrowser,
      onBrowser: context.onBrowser,
    });
    return { callId: call.callId, name: call.name, ...outcome };
  }

  private async runCommand(call: ModelToolCall, args: ToolArguments, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    if (!this.process) throw new ProcessExecutionError("process-policy", "Local process execution is disabled by configuration.");
    if (context.processCallLimitReached) throw new ProcessExecutionError("process-policy", "The per-turn local process call limit has been reached; the command was not started.");
    const command = stringArgument(args, "command", true) ?? "";
    const rawArgs = args.args;
    if (!Array.isArray(rawArgs) || rawArgs.some((value) => typeof value !== "string")) {
      throw new ProcessExecutionError("process-policy", "Tool argument 'args' must be an array of strings.");
    }
    const commandArgs = rawArgs as string[];
    const cwd = stringArgument(args, "cwd", false);
    const timeoutMs = args.timeoutMs === undefined ? undefined : numberArgument(args, "timeoutMs", 1);
    const executionId = "execution_" + randomUUID().replaceAll("-", "");
    let prepared;
    try {
      prepared = await this.process.policy.prepare({
        command,
        args: commandArgs,
        ...(cwd ? { cwd } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      }, executionId);
    } catch (error) {
      throw new ProcessExecutionError("process-policy", safeErrorMessage(error), { cause: error });
    }
    const redactionSecrets = [...(this.process.redactionSecrets ?? []), process.env.OPENROUTER_API_KEY ?? ""];
    const request: ProcessApprovalRequest = {
      callId: call.callId,
      executionId,
      command: prepared.command,
      args: prepared.args,
      displayArgs: prepared.displayArgs.map((argument) => redactSecrets(argument, redactionSecrets)),
      cwd: prepared.cwd,
      executablePath: prepared.executablePath,
      environmentProfile: prepared.environmentProfile,
      environmentKeys: prepared.environmentKeys,
      limits: prepared.limits,
      argvHash: prepared.argvHash,
      warning: "This runs a real local host process. The workspace is its starting directory, not an OS sandbox; the command may access other files, network resources, and credentials available through the host.",
    };
    await context.onProcess?.({ type: "prepared", request });
    context.pauseDeadline?.();
    context.pauseTurnDeadline?.();
    let decision: ProcessApprovalDecision;
    try {
      decision = context.approveProcess
        ? await this.awaitProcessApproval(context.approveProcess, request, context.signal, context.approvalTimeoutMs ?? 120_000)
        : { decision: "unavailable", reason: "No interactive approval channel is available; the process was not started." };
    } finally {
      context.resumeTurnDeadline?.();
      context.resumeDeadline?.();
    }
    await context.onProcess?.({ type: "approval_decided", request, decision });
    if (decision.decision !== "allow-once") {
      const reason = decision.reason ? " " + decision.reason : "";
      return {
        callId: call.callId,
        name: call.name,
        ok: false,
        content: "Process not started." + reason,
        summary: decision.decision === "deny" ? "Command approval denied for " + request.command + "." : "Command approval unavailable for " + request.command + ".",
        errorCode: decision.decision === "deny" ? "process-approval-denied" : "process-approval-unavailable",
      };
    }
    if (context.signal?.aborted) {
      const result = processResultForFailure(request, "cancelled", "process-cancelled", "The process was cancelled before it started.", false);
      await context.onProcess?.({ type: "completed", request, result });
      return {
        callId: call.callId,
        name: call.name,
        ok: false,
        content: processContent(result, redactionSecrets),
        summary: processSummary(request, result),
        errorCode: result.errorCode,
      };
    }
    const policy = this.process.policy;
    const runner = this.process.runner ?? new LocalProcessRunner((value) => policy.verify(value));
    let started = false;
    let startedPid: number | undefined;
    let result: ProcessResult;
    try {
      result = await runner.run(prepared, context.signal, async (event: ProcessEvent) => {
        switch (event.type) {
          case "started":
            started = true;
            startedPid = event.pid;
            await context.onProcess?.({ type: "started", request, pid: event.pid });
            break;
          case "output": await context.onProcess?.({ type: "output", request, stream: event.stream, bytes: event.bytes }); break;
          case "terminating": await context.onProcess?.({ type: "terminating", request, reason: event.reason }); break;
          case "completed": await context.onProcess?.({ type: "completed", request, result: event.result }); break;
        }
      });
    } catch (error) {
      const errorMessage = safeErrorMessage(error);
      const failure = started
        ? processResultForFailure(request, "ambiguous", "process-ambiguous", "The process started but its final outcome could not be confirmed: " + errorMessage, true, startedPid)
        : processResultForFailure(request, "failed", "process-policy", errorMessage, false);
      await context.onProcess?.({ type: "completed", request, result: failure });
      return {
        callId: call.callId,
        name: call.name,
        ok: false,
        content: processContent(failure, redactionSecrets),
        summary: processSummary(request, failure),
        errorCode: failure.errorCode,
      };
    }
    const content = processContent(result, redactionSecrets);
    const ok = result.state === "completed" && result.errorCode === undefined;
    return { callId: call.callId, name: call.name, ok, content, summary: processSummary(request, result), errorCode: result.errorCode };
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

  private async stat(call: ModelToolCall, args: ToolArguments): Promise<ToolExecutionResult> {
    const requestedPath = stringArgument(args, "path", true);
    const metadata = await this.workspace.stat(requestedPath ?? "");
    return {
      callId: call.callId,
      name: call.name,
      ok: true,
      content: stableStringify(metadata),
      summary: `Inspected ${metadata.path} (${metadata.kind}, ${metadata.sizeBytes} bytes).`,
    };
  }

  private async searchFiles(call: ModelToolCall, args: ToolArguments, signal?: AbortSignal): Promise<ToolExecutionResult> {
    const requestedPath = stringArgument(args, "path", false) ?? ".";
    const query = textArgument(args, "query", false) ?? "";
    const namePattern = stringArgument(args, "namePattern", false);
    if (query.length === 0 && !namePattern) throw new ToolExecutionError("Tool argument 'query' or 'namePattern' is required.");
    const maxResults = numberArgument(args, "maxResults", DEFAULT_SEARCH_MAX_MATCHES);
    if (maxResults > MAX_SEARCH_MATCHES) throw new ToolExecutionError(`Tool argument 'maxResults' must not exceed ${MAX_SEARCH_MATCHES}.`);
    const result = await this.workspace.searchFiles(requestedPath, query, maxResults, signal, namePattern);
    return {
      callId: call.callId,
      name: call.name,
      ok: true,
      content: boundOutput(stableStringify(result), this.maxOutputBytes).text,
      summary: `Searched ${result.path} for ${result.query.length > 0 ? JSON.stringify(result.query) : JSON.stringify(result.namePattern)} (${result.matches.length + result.nameMatches.length} matches${result.truncated ? ", truncated" : ""}).`,
    };
  }

  private async listQuarantine(call: ModelToolCall, args: ToolArguments): Promise<ToolExecutionResult> {
    const maxEntries = numberArgument(args, "maxEntries", MAX_QUARANTINE_ENTRIES);
    const listing = await this.workspace.listQuarantine(maxEntries);
    const output = boundOutput(stableStringify(listing), this.maxOutputBytes);
    return {
      callId: call.callId,
      name: call.name,
      ok: true,
      content: output.text,
      summary: `Listed ${listing.entries.length} quarantined entr${listing.entries.length === 1 ? "y" : "ies"}${listing.truncated ? " (truncated)" : ""}.`,
    };
  }

  private async applyPatch(call: ModelToolCall, args: ToolArguments, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const patch = stringArgument(args, "patch", true) ?? "";
    if (Buffer.byteLength(patch, "utf8") > MAX_PATCH_REQUEST_BYTES) {
      throw new ToolExecutionError(`The patch request is larger than the ${MAX_PATCH_REQUEST_BYTES}-byte limit.`);
    }
    const prepared = await this.workspace.preparePatch(patch);
    return this.executePreparedMutation(call, prepared, context);
  }

  private async applyPatchSet(call: ModelToolCall, args: ToolArguments, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const patches = args.patches;
    if (!Array.isArray(patches) || patches.length < 2 || patches.length > MAX_MUTATION_SET_FILES || patches.some((patch) => typeof patch !== "string")) {
      throw new ToolExecutionError(`Tool argument 'patches' must contain between 2 and ${MAX_MUTATION_SET_FILES} patch strings.`);
    }
    const requestBytes = patches.reduce((total, patch) => total + Buffer.byteLength(patch, "utf8"), 0);
    if (requestBytes > MAX_MUTATION_SET_REQUEST_BYTES) {
      throw new ToolExecutionError(`The patch set request is larger than the ${MAX_MUTATION_SET_REQUEST_BYTES}-byte limit.`);
    }
    const mutationId = `mutation_${randomUUID().replaceAll("-", "")}`;
    const prepared = await this.workspace.preparePatchSet(patches, mutationId);
    return this.executePreparedMutation(call, prepared, context, mutationId);
  }

  private async writeFile(call: ModelToolCall, args: ToolArguments, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const requestedPath = stringArgument(args, "path", true) ?? "";
    const content = textArgument(args, "content", true) ?? "";
    if (Buffer.byteLength(content, "utf8") > MAX_WRITE_FILE_REQUEST_BYTES) {
      throw new ToolExecutionError(`The file content is larger than the ${MAX_WRITE_FILE_REQUEST_BYTES}-byte limit.`);
    }
    const prepared = await this.workspace.prepareWrite(requestedPath, content);
    return this.executePreparedMutation(call, prepared, context);
  }

  private async makeDirectory(call: ModelToolCall, args: ToolArguments, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const requestedPath = stringArgument(args, "path", true) ?? "";
    const prepared = await this.workspace.prepareDirectory(requestedPath);
    if (prepared.alreadyExists) {
      return {
        callId: call.callId,
        name: call.name,
        ok: true,
        content: stableStringify({ status: "already_exists", path: prepared.path }),
        summary: `Directory ${prepared.path} already exists; no change was made.`,
      };
    }
    return this.executePreparedMutation(call, prepared, context);
  }

  private async deleteDirectory(call: ModelToolCall, args: ToolArguments, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const requestedPath = stringArgument(args, "path", true) ?? "";
    const prepared = await this.workspace.prepareDirectoryDeletion(requestedPath);
    return this.executePreparedMutation(call, prepared, context);
  }

  private async deleteDirectoryTree(call: ModelToolCall, args: ToolArguments, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const requestedPath = stringArgument(args, "path", true) ?? "";
    const mutationId = `mutation_${randomUUID().replaceAll("-", "")}`;
    const prepared = await this.workspace.prepareDirectoryTreeDeletion(requestedPath, mutationId);
    return this.executePreparedMutation(call, prepared, context, mutationId);
  }

  private async deleteFile(call: ModelToolCall, args: ToolArguments, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const requestedPath = stringArgument(args, "path", true) ?? "";
    const mutationId = `mutation_${randomUUID().replaceAll("-", "")}`;
    const prepared = await this.workspace.prepareDelete(requestedPath, mutationId);
    return this.executePreparedMutation(call, prepared, context, mutationId);
  }

  private async restoreFile(call: ModelToolCall, args: ToolArguments, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const mutationId = stringArgument(args, "mutationId", true) ?? "";
    const prepared = await this.workspace.prepareRestore(mutationId);
    return this.executePreparedMutation(call, prepared, context);
  }

  private async restoreDirectory(call: ModelToolCall, args: ToolArguments, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const mutationId = stringArgument(args, "mutationId", true) ?? "";
    const prepared = await this.workspace.prepareDirectoryRestore(mutationId);
    return this.executePreparedMutation(call, prepared, context);
  }

  private async purgeQuarantine(call: ModelToolCall, args: ToolArguments, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const mutationId = stringArgument(args, "mutationId", true) ?? "";
    const prepared = await this.workspace.prepareQuarantinePurge(mutationId);
    return this.executePreparedMutation(call, prepared, context);
  }

  private async copyFile(call: ModelToolCall, args: ToolArguments, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const sourcePath = stringArgument(args, "source", true) ?? "";
    const destinationPath = stringArgument(args, "destination", true) ?? "";
    const prepared = await this.workspace.prepareCopy(sourcePath, destinationPath);
    return this.executePreparedMutation(call, prepared, context);
  }

  private async moveFile(call: ModelToolCall, args: ToolArguments, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const sourcePath = stringArgument(args, "source", true) ?? "";
    const destinationPath = stringArgument(args, "destination", true) ?? "";
    const prepared = await this.workspace.prepareMove(sourcePath, destinationPath);
    return this.executePreparedMutation(call, prepared, context);
  }

  private async executePreparedMutation(call: ModelToolCall, prepared: PreparedWorkspaceMutation, context: ToolExecutionContext, mutationId = `mutation_${randomUUID().replaceAll("-", "")}`): Promise<ToolExecutionResult> {
    const preview = prepared.operation === "patch-set" || prepared.operation === "mkdir" || prepared.operation === "delete-directory" || prepared.operation === "delete-directory-tree" || prepared.operation === "delete" || prepared.operation === "restore" || prepared.operation === "restore-directory" || prepared.operation === "purge-quarantine" || prepared.operation === "copy" || prepared.operation === "move" ? prepared.preview : prepared.diff;
    if (Buffer.byteLength(preview, "utf8") > this.maxOutputBytes) {
      throw new ToolExecutionError(`The proposed diff is larger than the ${this.maxOutputBytes}-byte review limit; split the change into smaller patches.`);
    }
    const request = {
      callId: call.callId,
      mutationId,
      operation: prepared.operation,
      risk: mutationRisk(prepared),
      ...(prepared.operation === "patch-set" ? { paths: prepared.paths, members: prepared.members, journal: prepared.journal } : {}),
      path: prepared.path,
      ...(prepared.operation === "mkdir" || prepared.operation === "delete-directory" || prepared.operation === "delete-directory-tree" || prepared.operation === "restore-directory" || prepared.operation === "purge-quarantine" || prepared.operation === "patch-set" ? {} : { beforeHash: prepared.beforeHash }),
      ...(prepared.operation === "add" || prepared.operation === "update" || prepared.operation === "write" || prepared.operation === "copy" || prepared.operation === "move" ? { afterHash: prepared.afterHash } : {}),
      ...(prepared.operation === "delete" || prepared.operation === "delete-directory-tree" || prepared.operation === "restore" || prepared.operation === "restore-directory" || prepared.operation === "purge-quarantine" ? { quarantinePath: prepared.quarantinePath } : {}),
      ...(prepared.operation === "restore" || prepared.operation === "restore-directory" || prepared.operation === "purge-quarantine" ? { sourceMutationId: prepared.sourceMutationId } : {}),
      ...(prepared.operation === "delete-directory-tree" || prepared.operation === "restore-directory" ? { manifestHash: prepared.manifestHash, entryCount: prepared.entryCount, totalBytes: prepared.totalBytes, maxDepth: prepared.maxDepth } : {}),
      ...(prepared.operation === "copy" || prepared.operation === "move" ? { sourcePath: prepared.sourcePath, sourceHash: prepared.beforeHash } : {}),
      addedLines: prepared.operation === "add" || prepared.operation === "update" || prepared.operation === "write" || prepared.operation === "patch-set" ? prepared.addedLines : 0,
      removedLines: prepared.operation === "add" || prepared.operation === "update" || prepared.operation === "write" || prepared.operation === "patch-set" ? prepared.removedLines : 0,
      diff: preview,
    } as const;
    await context.onMutation?.({ type: "proposed", request });
    context.pauseDeadline?.();
    context.pauseTurnDeadline?.();
    let decision: Awaited<ReturnType<MutationApproval>>;
    try {
      decision = context.approveMutation
        ? await this.awaitApproval(context.approveMutation, request, context.signal, context.approvalTimeoutMs ?? 120_000)
        : { decision: "unavailable" as const, reason: "No interactive approval channel is available; the mutation was not written." };
    } finally {
      context.resumeTurnDeadline?.();
      context.resumeDeadline?.();
    }
    await context.onMutation?.({ type: "approval_decided", request, decision });
    if (decision.decision !== "allow-once") {
      const reason = decision.reason ? ` ${decision.reason}` : "";
      const summary = decision.decision === "deny" ? `Mutation denied for ${prepared.path}.` : `Mutation approval unavailable for ${prepared.path}.`;
      return {
        callId: call.callId,
        name: call.name,
        ok: false,
        mutationId: request.mutationId,
        content: `Mutation not applied.${reason} The ${prepared.operation === "mkdir" || prepared.operation === "delete-directory" || prepared.operation === "delete-directory-tree" || prepared.operation === "restore-directory" ? "directory" : prepared.operation === "purge-quarantine" ? "quarantine entry" : "file"} was left unchanged.`,
        summary,
        errorCode: decision.decision === "deny" ? "approval-denied" : "approval-unavailable",
      };
    }
    if (context.signal?.aborted) {
      return {
        callId: call.callId,
        name: call.name,
        ok: false,
        mutationId: request.mutationId,
        content: `Mutation not applied. The active turn ended before the approved change could be committed; the ${prepared.operation === "mkdir" || prepared.operation === "delete-directory" || prepared.operation === "delete-directory-tree" || prepared.operation === "restore-directory" ? "directory" : prepared.operation === "purge-quarantine" ? "quarantine entry" : "file"} was left unchanged.`,
        summary: "Mutation cancelled before commit.",
      };
    }
    let latestJournal = prepared.operation === "patch-set" ? prepared.journal : undefined;
    await context.onMutation?.({ type: "applying", request, ...(latestJournal ? { journal: latestJournal } : {}) });
    let committedPath: string;
    let afterHash: string | undefined;
    let bytesWritten = 0;
    let quarantinedBytes = 0;
    let restoredBytes = 0;
    let createdDirectory = false;
    let quarantinePath: string | undefined;
    let sourceMutationId: string | undefined;
    let transferredBytes = 0;
    try {
      if (prepared.operation === "patch-set") {
        const committed = await this.workspace.commitPatchSet(prepared, async (journal) => {
          latestJournal = journal;
          await context.onMutation?.({ type: "progress", request, journal });
        });
        committedPath = committed.paths[0] ?? prepared.path;
        latestJournal = committed.journal;
      } else if (prepared.operation === "mkdir") {
        const committed = await this.workspace.commitDirectory(prepared);
        committedPath = committed.path;
        createdDirectory = committed.created;
      } else if (prepared.operation === "delete-directory") {
        const committed = await this.workspace.commitDirectoryDeletion(prepared);
        committedPath = committed.path;
      } else if (prepared.operation === "delete-directory-tree") {
        const committed = await this.workspace.commitDirectoryTreeDeletion(prepared);
        committedPath = committed.path;
        quarantinePath = committed.quarantinePath;
        quarantinedBytes = committed.bytes;
      } else if (prepared.operation === "restore-directory") {
        const committed = await this.workspace.commitDirectoryRestore(prepared);
        committedPath = committed.path;
        sourceMutationId = committed.sourceMutationId;
        restoredBytes = committed.bytes;
      } else if (prepared.operation === "purge-quarantine") {
        const committed = await this.workspace.commitQuarantinePurge(prepared);
        committedPath = prepared.path;
        sourceMutationId = committed.sourceMutationId;
        quarantinedBytes = committed.bytes;
      } else if (prepared.operation === "delete") {
        const committed = await this.workspace.commitDelete(prepared);
        committedPath = committed.path;
        quarantinePath = committed.quarantinePath;
        quarantinedBytes = committed.bytes;
      } else if (prepared.operation === "restore") {
        const committed = await this.workspace.commitRestore(prepared);
        committedPath = committed.path;
        sourceMutationId = committed.sourceMutationId;
        restoredBytes = committed.bytes;
      } else if (prepared.operation === "copy") {
        const committed = await this.workspace.commitCopy(prepared);
        committedPath = committed.path;
        transferredBytes = committed.bytes;
        afterHash = prepared.afterHash;
      } else if (prepared.operation === "move") {
        const committed = await this.workspace.commitMove(prepared);
        committedPath = committed.path;
        transferredBytes = committed.bytes;
        afterHash = prepared.afterHash;
      } else {
        const committed = await this.workspace.commitPatch(prepared);
        committedPath = committed.path;
        afterHash = committed.afterHash;
        bytesWritten = committed.bytesWritten;
      }
    } catch (error) {
      const mutationError = error instanceof MutationError
        ? error
        : new MutationError("mutation-failed", safeErrorMessage(error), { cause: error });
      await context.onMutation?.({ type: "failed", request, reason: mutationError.safeMessage, code: mutationError.mutationCode, ...(latestJournal ? { journal: latestJournal } : {}) });
      throw mutationError;
    }
    await context.onMutation?.({
      type: "committed",
      request,
      ...(afterHash ? { afterHash } : {}),
      ...(latestJournal ? { journal: latestJournal } : {}),
      ...(prepared.operation === "copy" ? { bytesWritten: transferredBytes } : {}),
      ...(prepared.operation === "add" || prepared.operation === "update" || prepared.operation === "write" ? { bytesWritten } : {}),
    });
    if (prepared.operation === "patch-set") {
      return {
        callId: call.callId,
        name: call.name,
        ok: true,
        mutationId: request.mutationId,
        content: stableStringify({ status: "applied", paths: prepared.paths, journal: latestJournal }),
        summary: `Applied the approved patch set to ${prepared.paths.length} files; filesystem atomicity is not claimed across the set.`,
      };
    }
    if (prepared.operation === "mkdir") {
      return {
        callId: call.callId,
        name: call.name,
        ok: true,
        mutationId: request.mutationId,
        content: stableStringify({ status: createdDirectory ? "created" : "already_exists", path: committedPath }),
        summary: createdDirectory
          ? `Created directory ${committedPath}.`
          : `Directory ${committedPath} already existed; no change was made.`,
      };
    }
    if (prepared.operation === "delete-directory") {
      return {
        callId: call.callId,
        name: call.name,
        ok: true,
        mutationId: request.mutationId,
        content: stableStringify({ status: "deleted", path: committedPath }),
        summary: `Deleted empty directory ${committedPath}.`,
      };
    }
    if (prepared.operation === "delete-directory-tree") {
      return {
        callId: call.callId,
        name: call.name,
        ok: true,
        mutationId: request.mutationId,
        content: stableStringify({ status: "quarantined", path: committedPath, quarantinePath, restoreToken: request.mutationId, bytes: quarantinedBytes, entryCount: prepared.entryCount, manifestHash: prepared.manifestHash }),
        summary: `Quarantined directory tree ${committedPath}; restore token ${request.mutationId}.`,
      };
    }
    if (prepared.operation === "restore-directory") {
      return {
        callId: call.callId,
        name: call.name,
        ok: true,
        mutationId: request.mutationId,
        content: stableStringify({ status: "restored", path: committedPath, sourceMutationId, bytes: restoredBytes, entryCount: prepared.entryCount }),
        summary: `Restored directory tree ${committedPath}.`,
      };
    }
    if (prepared.operation === "purge-quarantine") {
      return {
        callId: call.callId,
        name: call.name,
        ok: true,
        mutationId: request.mutationId,
        content: stableStringify({ status: "purged", sourceMutationId, bytes: quarantinedBytes }),
        summary: `Permanently purged quarantine entry ${sourceMutationId}.`,
      };
    }
    if (prepared.operation === "delete") {
      return {
        callId: call.callId,
        name: call.name,
        ok: true,
        mutationId: request.mutationId,
        content: stableStringify({ status: "quarantined", path: committedPath, quarantinePath, restoreToken: request.mutationId, bytes: quarantinedBytes }),
        summary: `Quarantined ${committedPath}; restore token ${request.mutationId}.`,
      };
    }
    if (prepared.operation === "restore") {
      return {
        callId: call.callId,
        name: call.name,
        ok: true,
        mutationId: request.mutationId,
        content: stableStringify({ status: "restored", path: committedPath, sourceMutationId, bytes: restoredBytes }),
        summary: `Restored ${committedPath}.`,
      };
    }
    if (prepared.operation === "copy" || prepared.operation === "move") {
      return {
        callId: call.callId,
        name: call.name,
        ok: true,
        mutationId: request.mutationId,
        content: stableStringify({ status: prepared.operation === "copy" ? "copied" : "moved", source: prepared.sourcePath, path: committedPath, bytes: transferredBytes }),
        summary: `${prepared.operation === "copy" ? "Copied" : "Moved"} ${prepared.sourcePath} to ${committedPath}.`,
      };
    }
    return {
      callId: call.callId,
      name: call.name,
      ok: true,
      mutationId: request.mutationId,
      content: stableStringify({ status: "applied", path: committedPath, afterHash, bytesWritten }),
      summary: `Applied ${prepared.operation} change to ${committedPath} (${prepared.addedLines} additions, ${prepared.removedLines} removals).`,
    };
  }

  private async awaitApproval(
    approveMutation: MutationApproval,
    request: Parameters<MutationApproval>[0],
    parentSignal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<Awaited<ReturnType<MutationApproval>>> {
    const approvalController = new AbortController();
    const onParentAbort = () => approvalController.abort(parentSignal?.reason);
    if (parentSignal?.aborted) approvalController.abort(parentSignal.reason);
    else parentSignal?.addEventListener("abort", onParentAbort, { once: true });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<Awaited<ReturnType<MutationApproval>>>((resolve) => {
      timer = setTimeout(() => {
        approvalController.abort("approval-timeout");
        resolve({ decision: "unavailable", reason: `Approval was not received within ${timeoutMs}ms; the mutation was not written.` });
      }, timeoutMs);
    });
    try {
      return await Promise.race([approveMutation(request, approvalController.signal), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    }
  }

  private async awaitProcessApproval(
    approveProcess: NonNullable<ToolExecutionContext["approveProcess"]>,
    request: ProcessApprovalRequest,
    parentSignal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<ProcessApprovalDecision> {
    const approvalController = new AbortController();
    const onParentAbort = () => approvalController.abort(parentSignal?.reason);
    let resolveCancellation: ((decision: ProcessApprovalDecision) => void) | undefined;
    const cancellation = new Promise<ProcessApprovalDecision>((resolve) => {
      resolveCancellation = resolve;
    });
    const onParentAbortAndResolve = () => {
      onParentAbort();
      resolveCancellation?.({ decision: "unavailable", reason: "The active turn ended before process approval was completed." });
    };
    if (parentSignal?.aborted) onParentAbortAndResolve();
    else parentSignal?.addEventListener("abort", onParentAbortAndResolve, { once: true });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<ProcessApprovalDecision>((resolve) => {
      timer = setTimeout(() => {
        approvalController.abort("approval-timeout");
        resolve({ decision: "unavailable", reason: "Approval was not received within " + timeoutMs + "ms; the process was not started." });
      }, timeoutMs);
    });
    try {
      return await Promise.race([approveProcess(request, approvalController.signal), timeout, cancellation]);
    } finally {
      if (timer) clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbortAndResolve);
    }
  }
}
