import { loadConfig } from "../config/config.js";
import { loadLocalEnvironment } from "../config/local-env.js";
import { safeErrorMessage, ComputerNativeError } from "../runtime/errors.js";
import { openChatApplication } from "../runtime/application.js";
import { HELP_TEXT, parseArgs } from "./args.js";
import { runDoctor } from "./doctor.js";
import { TerminalUi } from "./tui.js";

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(HELP_TEXT);
      return 0;
    }
    const config = loadConfig(options, await loadLocalEnvironment());
    if (options.command === "doctor") {
      return (await runDoctor(config, process.stdout)) ? 0 : 1;
    }
    const application = await openChatApplication(config, options.sessionId);
    try {
      const recovered = await application.recoverInterruptedTurns();
      for (const result of recovered) {
        process.stdout.write(`Recovered interrupted turn ${result.turnId}. No model request was retried.\n`);
      }
      await application.maintainMemoryEvidence?.();
      const ui = new TerminalUi(application, process.stdout, Boolean(process.stdin.isTTY && process.stdout.isTTY), config.openRouterApiKey ? [config.openRouterApiKey] : []);
      if (options.message !== undefined) {
        const result = await ui.runSingle(options.message);
        return result.status === "completed" ? 0 : 1;
      }
      await ui.runInteractive(process.stdin);
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
