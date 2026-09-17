import { createReadStream } from "node:fs";
import { access, constants, lstat, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { WorkspaceAccessError } from "../runtime/errors.js";
import type { ProcessIdentity, ProcessLimits, ProcessRequest, PreparedProcess } from "../process/process.js";
import type { WorkspaceSecurityPolicy } from "./workspace-policy.js";

export interface ProcessPolicyOptions {
  readonly workspace: WorkspaceSecurityPolicy;
  readonly environment?: NodeJS.ProcessEnv;
  readonly limits: ProcessLimits;
}

const SAFE_ENVIRONMENT_KEYS = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "TERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "CI",
]);

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const SENSITIVE_ARGUMENT = /(?:api[_-]?key|token|secret|password|passwd|credential|private[_-]?key|authorization)/iu;
const DEFAULT_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

function identityFromStats(metadata: { readonly dev: number; readonly ino: number; readonly mode: number; readonly size: number; readonly mtimeMs: number }): ProcessIdentity {
  return {
    device: metadata.dev,
    inode: metadata.ino,
    mode: metadata.mode & 0o7777,
    size: metadata.size,
    modifiedAtMs: metadata.mtimeMs,
  };
}

function sameIdentity(left: ProcessIdentity, right: ProcessIdentity): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.mode === right.mode
    && left.size === right.size
    && left.modifiedAtMs === right.modifiedAtMs
    && left.contentHash === right.contentHash;
}

async function contentHash(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function displayArgument(value: string, previous: string | undefined): string {
  if (previous && SENSITIVE_ARGUMENT.test(previous)) return "[REDACTED]";
  if (/^[A-Z_][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*=/iu.test(value)) {
    return value.slice(0, value.indexOf("=") + 1) + "[REDACTED]";
  }
  if (/^[^\\s:@/]+:[^\\s/@]+@/u.test(value)) return "[REDACTED URL CREDENTIALS]";
  return value;
}

function displayArgs(args: readonly string[]): string[] {
  return args.map((value, index) => displayArgument(value, args[index - 1]));
}

function validateText(value: string, label: string): void {
  if (value.length === 0) throw new WorkspaceAccessError(label + " cannot be empty.");
  if (CONTROL_CHARACTERS.test(value)) throw new WorkspaceAccessError(label + " contains unsupported control characters.");
}

function hashArgv(command: string, args: readonly string[], cwd: string): string {
  return createHash("sha256").update(JSON.stringify({ command, args, cwd })).digest("hex");
}

function isExecutable(metadata: { isFile(): boolean; readonly mode: number }): boolean {
  return metadata.isFile() && Boolean(metadata.mode & 0o111);
}

export class ProcessSecurityPolicy {
  private readonly environment: NodeJS.ProcessEnv;

  constructor(private readonly options: ProcessPolicyOptions) {
    this.environment = options.environment ?? process.env;
  }

  get limits(): ProcessLimits {
    return this.options.limits;
  }

  async prepare(request: ProcessRequest, executionId: string): Promise<PreparedProcess> {
    validateText(request.command, "The executable");
    request.args.forEach((argument, index) => validateText(argument, "Argument " + (index + 1)));
    if (request.args.length > this.options.limits.maxArgumentCount) {
      throw new WorkspaceAccessError("The command has " + request.args.length + " arguments; the limit is " + this.options.limits.maxArgumentCount + ".");
    }
    const argumentBytes = request.args.reduce((total, argument) => total + Buffer.byteLength(argument, "utf8"), Buffer.byteLength(request.command, "utf8"));
    if (argumentBytes > this.options.limits.maxArgumentBytes) {
      throw new WorkspaceAccessError("The command arguments use " + argumentBytes + " bytes; the limit is " + this.options.limits.maxArgumentBytes + ".");
    }

    const requestedCwd = request.cwd ?? ".";
    validateText(requestedCwd, "The working directory");
    const metadataPath = await this.options.workspace.resolveMetadata(requestedCwd);
    const cwdLink = await lstat(metadataPath.absolutePath).catch((error) => {
      throw new WorkspaceAccessError("Working directory '" + requestedCwd + "' cannot be inspected safely.", { cause: error });
    });
    if (cwdLink.isSymbolicLink()) throw new WorkspaceAccessError("Working directory '" + requestedCwd + "' is a symbolic link and cannot be used for a process.");
    const cwdStats = await stat(metadataPath.absolutePath).catch((error) => {
      throw new WorkspaceAccessError("Working directory '" + requestedCwd + "' cannot be inspected.", { cause: error });
    });
    if (!cwdStats.isDirectory()) throw new WorkspaceAccessError("Working directory '" + requestedCwd + "' is not a directory.");
    const cwdRealPath = await realpath(metadataPath.absolutePath).catch((error) => {
      throw new WorkspaceAccessError("Working directory '" + requestedCwd + "' cannot be resolved.", { cause: error });
    });
    if (cwdRealPath !== metadataPath.absolutePath) throw new WorkspaceAccessError("Working directory '" + requestedCwd + "' resolves through a symbolic link.");

    const childEnvironment = this.buildEnvironment(cwdRealPath);
    const executable = await this.resolveExecutable(request.command, cwdRealPath, childEnvironment.PATH ?? DEFAULT_PATH);
    const timeoutMs = request.timeoutMs ?? this.options.limits.timeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > this.options.limits.timeoutMs) {
      throw new WorkspaceAccessError("The process timeout must be a positive integer no greater than " + this.options.limits.timeoutMs + "ms.");
    }
    const limits: ProcessLimits = { ...this.options.limits, timeoutMs };
    return {
      executionId,
      command: request.command,
      args: [...request.args],
      displayArgs: displayArgs(request.args),
      cwd: metadataPath.relativePath,
      cwdAbsolutePath: cwdRealPath,
      cwdIdentity: identityFromStats(cwdStats),
      executablePath: executable.path,
      executableIdentity: executable.identity,
      argvHash: hashArgv(request.command, request.args, metadataPath.relativePath),
      environment: childEnvironment,
      environmentProfile: "sanitized-default",
      environmentKeys: Object.keys(childEnvironment).sort(),
      limits,
    };
  }

  async verify(prepared: PreparedProcess): Promise<void> {
    const currentCwd = await lstat(prepared.cwdAbsolutePath).catch((error) => {
      throw new WorkspaceAccessError("Working directory '" + prepared.cwd + "' is no longer available.", { cause: error });
    });
    if (currentCwd.isSymbolicLink()) throw new WorkspaceAccessError("Working directory '" + prepared.cwd + "' changed to a symbolic link while approval was pending.");
    const currentCwdStats = await stat(prepared.cwdAbsolutePath).catch((error) => {
      throw new WorkspaceAccessError("Working directory '" + prepared.cwd + "' cannot be rechecked.", { cause: error });
    });
    if (!currentCwdStats.isDirectory() || !sameIdentity(prepared.cwdIdentity, identityFromStats(currentCwdStats))) {
      throw new WorkspaceAccessError("Working directory '" + prepared.cwd + "' changed while approval was pending.");
    }
    const executableStats = await lstat(prepared.executablePath).catch((error) => {
      throw new WorkspaceAccessError("Executable '" + prepared.executablePath + "' is no longer available.", { cause: error });
    });
    if (executableStats.isSymbolicLink() || !isExecutable(executableStats)) {
      throw new WorkspaceAccessError("Executable '" + prepared.executablePath + "' is no longer a regular executable.");
    }
    const currentExecutableIdentity = {
      ...identityFromStats(executableStats),
      contentHash: await contentHash(prepared.executablePath),
    };
    if (!sameIdentity(prepared.executableIdentity, currentExecutableIdentity)) {
      throw new WorkspaceAccessError("Executable '" + prepared.executablePath + "' changed while approval was pending.");
    }
  }

  private buildEnvironment(cwd: string): NodeJS.ProcessEnv {
    const source = this.environment;
    const output: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;
      if (SAFE_ENVIRONMENT_KEYS.has(key) || /^LC_[A-Z0-9_]+$/u.test(key)) output[key] = value;
    }
    output.PATH = output.PATH ?? DEFAULT_PATH;
    output.PWD = cwd;
    return output;
  }

  private async resolveExecutable(command: string, cwd: string, pathValue: string): Promise<{ readonly path: string; readonly identity: ProcessIdentity }> {
    const candidates = command.includes(path.sep) || command.includes("/")
      ? [path.isAbsolute(command) ? command : path.resolve(cwd, command)]
      : pathValue.split(path.delimiter).filter((entry) => entry.length > 0).map((entry) => path.join(path.isAbsolute(entry) ? entry : path.resolve(cwd, entry), command));
    for (const candidate of candidates) {
      const link = await lstat(candidate).catch(() => undefined);
      if (!link || link.isSymbolicLink() || !isExecutable(link)) continue;
      const resolved = await realpath(candidate).catch(() => undefined);
      if (!resolved) continue;
      const metadata = await lstat(resolved).catch(() => undefined);
      if (!metadata || metadata.isSymbolicLink() || !isExecutable(metadata)) continue;
      try {
        await access(resolved, constants.X_OK);
      } catch {
        continue;
      }
      return { path: resolved, identity: { ...identityFromStats(metadata), contentHash: await contentHash(resolved) } };
    }
    throw new WorkspaceAccessError("Executable '" + command + "' could not be resolved through the configured PATH.");
  }
}

export function sameProcessIdentity(left: ProcessIdentity, right: ProcessIdentity): boolean {
  return sameIdentity(left, right);
}
