import readline from "node:readline";
import { loadConfig } from "../config/config.js";
import { loadLocalEnvironment } from "../config/local-env.js";
import { safeErrorMessage, ComputerNativeError } from "../runtime/errors.js";
import type { TurnResult } from "../runtime/contracts.js";
import type { ChatApplication } from "../runtime/application.js";
import { openChatApplication } from "../runtime/application.js";
import { HELP_TEXT, parseArgs } from "./args.js";

function outputResult(result: TurnResult, write: (text: string) => void): void {
  if (result.status === "completed") {
    write("\nReady for your next message.\n");
    return;
  }
  write(`\nModel request ${result.status}: ${result.error?.message ?? "The turn did not complete."}\n`);
  if (result.status !== "interrupted") write("The message was recorded. No assistant response was committed.\n");
}

async function runOne(
  application: ChatApplication,
  message: string,
  write: (text: string) => void,
  signal?: AbortSignal,
): Promise<TurnResult> {
  write("You\n");
  write(`${message.trim()}\n\nAgent\n`);
  const result = await application.runTurn(message, signal, write);
  outputResult(result, write);
  return result;
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(HELP_TEXT);
      return 0;
    }
    const config = loadConfig(options, await loadLocalEnvironment());
    const application = await openChatApplication(config, options.sessionId);
    try {
      const recovered = await application.recoverInterruptedTurns();
      for (const result of recovered) {
        process.stdout.write(`Recovered interrupted turn ${result.turnId}. No model request was retried.\n`);
      }
      process.stdout.write(`Computer Native · session ${application.sessionId} · model ${application.modelLabel}\n\n`);
      if (options.message !== undefined) {
        const result = await runOne(application, options.message, (text) => process.stdout.write(text));
        return result.status === "completed" ? 0 : 1;
      }

      const input = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY) });
      let activeController: AbortController | undefined;
      let interrupted = false;
      const onInterrupt = () => {
        if (activeController) {
          interrupted = true;
          activeController.abort("cancelled");
        } else {
          input.close();
        }
      };
      process.on("SIGINT", onInterrupt);
      input.on("SIGINT", onInterrupt);
      try {
        for await (const line of input) {
          const message = line.trim();
          if (message === "" && !activeController) continue;
          if (message === "exit" || message === "quit") break;
          activeController = new AbortController();
          await runOne(application, message, (text) => process.stdout.write(text), activeController.signal);
          activeController = undefined;
          if (interrupted) break;
        }
      } finally {
        process.off("SIGINT", onInterrupt);
        input.off("SIGINT", onInterrupt);
        input.close();
      }
      return 0;
    } finally {
      await application.close();
    }
  } catch (error) {
    const message = safeErrorMessage(error);
    process.stderr.write(`${message}\n`);
    return error instanceof ComputerNativeError && error.code === "invalid-input" ? 2 : 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().then((code) => {
    process.exitCode = code;
  });
}
