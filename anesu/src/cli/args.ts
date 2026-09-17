import type { DeterministicBehavior, ProviderName } from "../runtime/contracts.js";
import type { ProcessMode } from "../config/config.js";
import { AnesuError } from "../runtime/errors.js";

export interface CliOptions {
  readonly command: "chat" | "doctor";
  readonly stateDir?: string;
  readonly sessionId?: string;
  readonly provider?: ProviderName;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly firstEventTimeoutMs?: number;
  readonly approvalTimeoutMs?: number;
  readonly processMode?: ProcessMode;
  readonly processCallsPerTurn?: number;
  readonly workspaceRoot?: string;
  readonly deterministicBehavior?: DeterministicBehavior;
  readonly deterministicDelayMs?: number;
  readonly message?: string;
  readonly help: boolean;
}

function nextValue(args: readonly string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new AnesuError("invalid-input", `${name} requires a value.`);
  return value;
}

function integer(value: string, name: string, allowZero = false): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
    throw new AnesuError("invalid-input", `${name} must be a ${allowZero ? "non-negative" : "positive"} integer.`);
  }
  return parsed;
}

export function parseArgs(args: readonly string[]): CliOptions {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return { command: "chat", help: true };
  }
  const command = args[0];
  if (command !== "chat" && command !== "doctor") {
    throw new AnesuError("invalid-input", `Unknown command '${command}'. Use 'anesu chat' or 'anesu doctor'.`);
  }
  const result: {
    command: "chat" | "doctor";
    stateDir?: string;
    sessionId?: string;
    provider?: ProviderName;
    model?: string;
    timeoutMs?: number;
    firstEventTimeoutMs?: number;
    approvalTimeoutMs?: number;
    processMode?: ProcessMode;
    processCallsPerTurn?: number;
    workspaceRoot?: string;
    deterministicBehavior?: DeterministicBehavior;
    deterministicDelayMs?: number;
    message?: string;
    help: boolean;
  } = { command, help: false };
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--help":
      case "-h":
        result.help = true;
        break;
      case "--state-dir":
        result.stateDir = nextValue(args, index, "--state-dir");
        index += 1;
        break;
      case "--session":
      case "--session-id":
        result.sessionId = nextValue(args, index, argument);
        index += 1;
        break;
      case "--provider": {
        const value = nextValue(args, index, "--provider");
        index += 1;
        if (value !== "deterministic" && value !== "openrouter") throw new AnesuError("invalid-input", "--provider must be deterministic or openrouter.");
        result.provider = value;
        break;
      }
      case "--model":
        result.model = nextValue(args, index, "--model");
        index += 1;
        break;
      case "--timeout-ms":
        result.timeoutMs = integer(nextValue(args, index, "--timeout-ms"), "--timeout-ms");
        index += 1;
        break;
      case "--first-event-timeout-ms":
        result.firstEventTimeoutMs = integer(nextValue(args, index, "--first-event-timeout-ms"), "--first-event-timeout-ms");
        index += 1;
        break;
      case "--approval-timeout-ms":
        result.approvalTimeoutMs = integer(nextValue(args, index, "--approval-timeout-ms"), "--approval-timeout-ms");
        index += 1;
        break;
      case "--process-mode": {
        const value = nextValue(args, index, "--process-mode");
        index += 1;
        if (value !== "deny" && value !== "approval") throw new AnesuError("invalid-input", "--process-mode must be deny or approval.");
        result.processMode = value;
        break;
      }
      case "--process-calls-per-turn":
        result.processCallsPerTurn = integer(nextValue(args, index, "--process-calls-per-turn"), "--process-calls-per-turn");
        index += 1;
        break;
      case "--workspace":
      case "--workspace-root":
        result.workspaceRoot = nextValue(args, index, argument);
        index += 1;
        break;
      case "--deterministic-behavior": {
        const value = nextValue(args, index, "--deterministic-behavior");
        index += 1;
        if (value !== "success" && value !== "failure" && value !== "timeout") {
          throw new AnesuError("invalid-input", "--deterministic-behavior must be success, failure, or timeout.");
        }
        result.deterministicBehavior = value;
        break;
      }
      case "--deterministic-delay-ms":
        result.deterministicDelayMs = integer(nextValue(args, index, "--deterministic-delay-ms"), "--deterministic-delay-ms", true);
        index += 1;
        break;
      case "--message":
      case "--prompt":
        result.message = nextValue(args, index, argument);
        index += 1;
        break;
      default:
        throw new AnesuError("invalid-input", `Unknown option '${argument}'.`);
    }
  }
  if (result.command === "doctor" && result.message !== undefined) {
    throw new AnesuError("invalid-input", "The doctor command does not accept --message.");
  }
  return result;
}

export const HELP_TEXT = `Usage: anesu <chat|doctor> [options]

Start a local Anesu terminal session with 'chat', or run a bounded provider
and workspace diagnostic with 'doctor'. The deterministic local provider is the default
and never uses the network.

Options:
  --message <text>           Run one non-interactive chat turn
  --state-dir <path>         Durable state directory
  --session <id>             Resume an existing chat session
  --provider <deterministic|openrouter>
  --model <provider/model>   Model identifier
  --timeout-ms <milliseconds>
  --first-event-timeout-ms <milliseconds>
  --approval-timeout-ms <milliseconds>
  --process-mode <deny|approval>
  --process-calls-per-turn <count>
  --workspace <path>         Workspace root for inspection and approved file changes
  --deterministic-behavior <mode>
                             success, failure, or timeout
  --deterministic-delay-ms <milliseconds>
  --help
`;
