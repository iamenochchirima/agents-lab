import { loadConfig } from "../config/config.js";
import { loadLocalEnvironment } from "../config/local-env.js";
import { safeErrorMessage, AnesuError } from "../runtime/errors.js";
import { openChatApplication } from "../runtime/application.js";
import { SessionStore } from "../persistence/session-store.js";
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
    let ui: TerminalUi | undefined;
    const openSession = async (sessionId?: string) => {
      const opened = await openChatApplication(config, sessionId);
      try {
        const recovered = await opened.recoverInterruptedTurns();
        for (const result of recovered) {
          process.stdout.write(`Recovered interrupted turn ${result.turnId}. No model request was retried.\n`);
        }
        await opened.maintainMemoryEvidence?.();
        return opened;
      } catch (error) {
        await opened.close().catch(() => undefined);
        throw error;
      }
    };
    const application = await openSession(options.sessionId);
    try {
      ui = new TerminalUi(
        application,
        process.stdout,
        Boolean(process.stdin.isTTY && process.stdout.isTTY),
        [config.openRouterApiKey, config.computerOpenRouterApiKey].filter((value): value is string => Boolean(value)),
        options.message === undefined
          ? {
              listRecent: () => SessionStore.listRecentSessions(config.stateDir),
              open: openSession,
            }
          : undefined,
      );
      if (options.message !== undefined) {
        const result = await ui.runSingle(options.message);
        return result.status === "completed" ? 0 : 1;
      }
      await ui.runInteractive(process.stdin);
      return 0;
    } finally {
      if (ui) await ui.close();
      else await application.close();
    }
  } catch (error) {
    const message = safeErrorMessage(error);
    process.stderr.write(`${message}\n`);
    return error instanceof AnesuError && error.code === "invalid-input" ? 2 : 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().then((code) => {
    process.exitCode = code;
  });
}
