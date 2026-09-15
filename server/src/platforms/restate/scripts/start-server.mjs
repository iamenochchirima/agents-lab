import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const platformRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(platformRoot, "../../../..");
const dataDirectory = resolve(
  process.env.AGENTLAB_RESTATE_DATA_DIR ?? join(repositoryRoot, "lab", "restate-native-data"),
);
const executable = join(platformRoot, "node_modules", ".bin", "restate-server");
const environment = {
  ...process.env,
  RESTATE_BIND_IP: process.env.RESTATE_BIND_IP ?? "127.0.0.1",
  RESTATE_ADMIN__BIND_ADDRESS: process.env.RESTATE_ADMIN__BIND_ADDRESS ?? "127.0.0.1:9070",
  RESTATE_INGRESS__BIND_ADDRESS: process.env.RESTATE_INGRESS__BIND_ADDRESS ?? "127.0.0.1:8080",
};

await mkdir(dataDirectory, { recursive: true });

const child = spawn(
  executable,
  ["--no-logo", "--node-name=agentlab-restate", "--base-dir", dataDirectory],
  { stdio: "inherit", env: environment },
);

const forwardSignal = (signal) => {
  if (child.exitCode === null) child.kill(signal);
};
process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("error", (error) => {
  console.error(`Unable to start Restate server: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
