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

test("launcher replaces only a matching owned worker tree and preserves siblings and other configurations", async t => {
  if (!existsSync("/proc/self/environ")) { t.skip("Ownership inspection requires Linux /proc; other systems leave workers untouched"); return; }
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  // Derive the actual repository from the launcher path, including compiled tests.
  const { dirname, resolve } = await import("node:path");
  const repository = resolve(dirname(launcher), "..");
  const configuration = {
    AGENTLAB_LAUNCHER_INSTANCE: `${repository}:fixture:${process.pid}`,
    AGENTLAB_LAUNCHER_WORKER_OWNER: `${repository}/temporal-worker-v1`,
    AGENTLAB_TEMPORAL_ENDPOINT: "fixture:7233", AGENTLAB_TEMPORAL_NAMESPACE: "fixture",
    AGENTLAB_TEMPORAL_TASK_QUEUE: "fixture-selected", AGENTLAB_RUN_ROOT: "/tmp/fixture-runs",
    AGENTLAB_CONTEXT_ROOT: "/tmp/fixture-context", AGENTLAB_CAPABILITY_HOST_URL: "http://fixture:4322",
  };
  const processes: ReturnType<typeof spawn>[] = [];
  const start = (overrides: Record<string, string> = {}, watcher = false) => {
    const script = watcher
      ? `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)',process.argv[1]],{stdio:'ignore'}); console.log(child.pid); setInterval(()=>{},1000);`
      : "setInterval(()=>{},1000)";
    const child = spawn(process.execPath, ["-e", script, `${repository}/worker-entry.ts`], { env: { ...process.env, ...configuration, ...overrides }, stdio: ["ignore", "pipe", "pipe"] });
    processes.push(child); return child;
  };
  t.after(() => { for (const child of processes) child.kill("SIGTERM"); });
  const owned = start({}, true);
  const [buffer] = await once(owned.stdout!, "data");
  const descendant = Number(buffer.toString().trim());
  t.after(() => { try { process.kill(descendant, "SIGTERM"); } catch {} });
  const unrelated = start({ AGENTLAB_LAUNCHER_INSTANCE: "", AGENTLAB_LAUNCHER_WORKER_OWNER: "", AGENTLAB_TEMPORAL_TASK_QUEUE: "unrelated" });
  const preserved = Object.keys(configuration).filter(key => !["AGENTLAB_LAUNCHER_INSTANCE", "AGENTLAB_LAUNCHER_WORKER_OWNER"].includes(key)).map(key => start({ [key]: "different" }));
  const unmarkedSelected = start({ AGENTLAB_LAUNCHER_INSTANCE: "", AGENTLAB_LAUNCHER_WORKER_OWNER: "" });
  assert.throws(() => execFileSync("bash", ["-c", `
source "$1" --help >/dev/null
pgrep() { if [[ "$1" == -f ]]; then printf '%s\\n' "$FIXTURE_PID"; else command pgrep "$@"; fi; }
stop_existing_lab_workers
`, "unmarked-worker-test", launcher], { env: { ...process.env, ...configuration, FIXTURE_PID: String(unmarkedSelected.pid) }, encoding: "utf8", stdio: "pipe" }), /before starting a duplicate/);
  assert.doesNotThrow(() => process.kill(unmarkedSelected.pid!, 0));
  const pids = [owned.pid!, descendant, unrelated.pid!, ...preserved.map(child => child.pid!)];
  // Limit candidate discovery to these disposable fixtures. No real worker can
  // enter the cleanup function during this test; descendant lookup stays real.
  const output = execFileSync("bash", ["-c", `
source "$1" --help >/dev/null
pgrep() { if [[ "$1" == -f ]]; then printf '%s\\n' $FIXTURE_PIDS; else command pgrep "$@"; fi; }
worker_matches_selected_configuration 999999999 && exit 99
stop_existing_lab_workers
`, "agentlab-owned-worker-test", launcher], { env: { ...process.env, ...configuration, FIXTURE_PIDS: pids.join(" ") }, encoding: "utf8" });
  assert.match(output, /Stopping matching launcher-owned Temporal worker tree/);
  await once(owned, "exit");
  for (const child of [unrelated, ...preserved]) assert.doesNotThrow(() => process.kill(child.pid!, 0), "Different identity and process-group siblings must survive");
});

test("port replacement includes the owned watcher and leaves an unmarked listener untouched", async t => {
  if (!existsSync("/proc/self/environ")) { t.skip("Requires Linux /proc"); return; }
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const { dirname, resolve } = await import("node:path");
  const repository = resolve(dirname(launcher), "..");
  const children: ReturnType<typeof spawn>[] = [];
  const descendants: number[] = [];
  t.after(() => { for (const child of children) child.kill("SIGTERM"); for (const pid of descendants) { try { process.kill(pid, "SIGTERM"); } catch {} } });
  const start = async (marked: boolean) => {
    const script = `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e',"const net=require('node:net');const s=net.createServer();s.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({pid:process.pid,port:s.address().port})));",process.argv[1]],{stdio:['ignore','pipe','ignore']});child.stdout.pipe(process.stdout);setInterval(()=>{},1000);`;
    const child = spawn(process.execPath, ["-e", script, `${repository}/fixture-service.ts`], { env: { ...process.env, AGENTLAB_LAUNCHER_INSTANCE: marked ? `${repository}:listener-fixture:${process.pid}` : "" }, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    const [buffer] = await once(child.stdout!, "data");
    const listener = JSON.parse(buffer.toString()); descendants.push(listener.pid);
    return { child, ...listener };
  };
  const owned = await start(true), unknown = await start(false);
  execFileSync("bash", ["-c", `source "$1" --help >/dev/null; stop_existing_lab_processes fixture "$2"`, "owned-listener", launcher, String(owned.port)], { encoding: "utf8" });
  await once(owned.child, "exit");
  assert.throws(() => execFileSync("bash", ["-c", `source "$1" --help >/dev/null; stop_existing_lab_processes fixture "$2"`, "unknown-listener", launcher, String(unknown.port)], { encoding: "utf8", stdio: "pipe" }), /launcher ownership is unknown or unreadable/);
  assert.doesNotThrow(() => process.kill(unknown.child.pid!, 0));
  assert.doesNotThrow(() => process.kill(unknown.pid, 0));
});
