import { runBehaviourEvals } from "./behaviour.js";

runBehaviourEvals(process.argv.slice(2).filter(arg => arg !== "--"))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
