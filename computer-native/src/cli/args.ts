import type { DeterministicBehavior, ProviderName } from "../runtime/contracts.js";
import { ComputerNativeError } from "../runtime/errors.js";

export interface CliOptions {
  readonly command: "chat";
  readonly stateDir?: string;
  readonly sessionId?: string;
  readonly provider?: ProviderName;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly deterministicBehavior?: DeterministicBehavior;
  readonly deterministicDelayMs?: number;
  readonly message?: string;
  readonly help: boolean;
}

function nextValue(args: readonly string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new ComputerNativeError("invalid-input", `${name} requires a value.`);
  return value;
}

function integer(value: string, name: string, allowZero = false): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
    throw new ComputerNativeError("invalid-input", `${name} must be a ${allowZero ? "non-negative" : "positive"} integer.`);
  }
  return parsed;
}

export function parseArgs(args: readonly string[]): CliOptions {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return { command: "chat", help: true };
  }
  if (args[0] !== "chat") throw new ComputerNativeError("invalid-input", `Unknown command '${args[0]}'. Use 'computer-native chat'.`);
  const result: {
    command: "chat";
    stateDir?: string;
    sessionId?: string;
    provider?: ProviderName;
    model?: string;
    timeoutMs?: number;
    deterministicBehavior?: DeterministicBehavior;
    deterministicDelayMs?: number;
    message?: string;
    help: boolean;
  } = { command: "chat", help: false };
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
        if (value !== "deterministic" && value !== "openrouter") throw new ComputerNativeError("invalid-input", "--provider must be deterministic or openrouter.");
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
      case "--deterministic-behavior": {
        const value = nextValue(args, index, "--deterministic-behavior");
        index += 1;
        if (value !== "success" && value !== "failure" && value !== "timeout") {
          throw new ComputerNativeError("invalid-input", "--deterministic-behavior must be success, failure, or timeout.");
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
        throw new ComputerNativeError("invalid-input", `Unknown option '${argument}'.`);
    }
  }
  return result;
}

export const HELP_TEXT = `Usage: computer-native chat [options]

Start a local Computer Native terminal session. Without --message, the command
reads messages interactively. The deterministic local provider is the default and never uses
the network.

Options:
  --message <text>           Run one non-interactive turn
  --state-dir <path>         Durable state directory
  --session <id>             Resume an existing session
  --provider <deterministic|openrouter>
  --model <provider/model>   Model identifier
  --timeout-ms <milliseconds>
  --deterministic-behavior <mode>
                             success, failure, or timeout
  --deterministic-delay-ms <milliseconds>
  --help
`;
