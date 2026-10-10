import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sourceLauncher = fileURLToPath(new URL("../../../scripts/run_local_stack.sh", import.meta.url));
const launcher = existsSync(sourceLauncher) ? sourceLauncher
  : fileURLToPath(new URL("../../../../scripts/run_local_stack.sh", import.meta.url));

function exportedEndpoints(overrides: NodeJS.ProcessEnv = {}): string[] {
  const environment = { ...process.env };
  for (const name of ["AGENTLAB_API_PORT", "AGENTLAB_API_HOST", "AGENTLAB_CAPABILITY_HOST_URL", "AGENTLAB_API_PROXY_TARGET"]) delete environment[name];
  // Help defines launcher configuration without starting or replacing services.
  const result = execFileSync("bash", ["-c", `
source "$1" --help >/dev/null
printf '%s\\n' "$AGENTLAB_CAPABILITY_HOST_URL" "$AGENTLAB_API_PROXY_TARGET"
`, "agentlab-config-check", launcher], { env: { ...environment, ...overrides }, encoding: "utf8" });
  return result.trim().split("\n");
}

test("launcher exports the same native host and browser proxy for default and custom API ports", () => {
  assert.deepEqual(exportedEndpoints(), ["http://127.0.0.1:4318", "http://127.0.0.1:4318"]);
  assert.deepEqual(exportedEndpoints({ AGENTLAB_API_PORT: "4319" }), ["http://127.0.0.1:4319", "http://127.0.0.1:4319"]);
  assert.deepEqual(exportedEndpoints({ AGENTLAB_API_HOST: "0.0.0.0", AGENTLAB_API_PORT: "4321" }), ["http://127.0.0.1:4321", "http://127.0.0.1:4321"]);
  assert.deepEqual(exportedEndpoints({ AGENTLAB_CAPABILITY_HOST_URL: "http://worker-host:4500", AGENTLAB_API_PROXY_TARGET: "http://browser-host:4501" }), ["http://worker-host:4500", "http://browser-host:4501"]);
});
