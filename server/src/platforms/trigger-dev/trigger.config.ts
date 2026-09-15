import { defineConfig } from "@trigger.dev/sdk";

/**
 * This is the configuration consumed by the official `trigger.dev dev`
 * command. The Lab server does not import it to decide whether Trigger is
 * reachable; that decision belongs to the runner adapter.
 */
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_agentlab",
  dirs: ["./variants/baseline/execution"],
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 2,
      minTimeoutInMs: 100,
      maxTimeoutInMs: 1_000,
      factor: 2,
      randomize: false,
    },
  },
  maxDuration: 60,
});
