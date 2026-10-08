import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { PackageInstaller } from "../../src/capabilities/management/installations.js";
import type { ManagedInstallationRecord } from "../../src/capabilities/management/records.js";
import { ConnectionManager } from "../../src/capabilities/integrations/connections.js";

const skill = "---\nname: notes-check\ndescription: Inspect notes before changing them.\n---\nRead references/guide.md and inspect the connected tools.\n";
const manifest = { schemaVersion: 1, id: "notes-plugin", version: "1.0.0", skills: "skills", requiredSecrets: [{ name: "notes-token", description: "Token entered separately when connecting notes." }] };
function bundle(extra: Record<string, unknown> = {}): Buffer {
  return zip({ "lab-plugin.json": JSON.stringify({ ...manifest, ...extra }), "skills/notes-check/SKILL.md": skill, "skills/notes-check/references/guide.md": "Preserve existing note facts." });
}

test("preview/install preserves standard skills and reference files with immutable digest/version", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lab-installations-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const installer = new PackageInstaller(root);
  const preview = await installer.previewZip(bundle());
  assert.equal(preview.skills[0].name, "notes-check");
  assert.deepEqual(await readdir(root), []);
  const installed = await installer.installZip(bundle());
  assert.equal(installed.installation.digest, preview.digest);
  assert.equal(installed.packages[0].enabled, false);
  assert.equal(await readFile(join(installed.installation.root, "skills/notes-check/references/guide.md"), "utf8"), "Preserve existing note facts.");
  const repeated = await installer.installZip(bundle(), [installed.installation]);
  assert.equal(repeated.installation.root, installed.installation.root);
  const changed = zip({ "lab-plugin.json": JSON.stringify(manifest), "skills/notes-check/SKILL.md": skill + "changed" });
  await assert.rejects(installer.installZip(changed, [installed.installation]), /different content/);
  const updated = await installer.installZip(bundle({ version: "1.1.0" }), [installed.installation]);
  assert.notEqual(updated.installation.root, installed.installation.root);
  assert.equal(await readFile(join(installed.installation.root, "skills/notes-check/SKILL.md"), "utf8"), skill);
});

test("bare SKILL.md upload uses explicit package identity and never executes resources", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lab-installations-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const installer = new PackageInstaller(root);
  const archive = zip({ "SKILL.md": skill, "references/guide.md": "Reference text", "scripts/example.sh": "exit 99" });
  await assert.rejects(installer.previewZip(archive), /explicit package ID/);
  const prepared = await installer.installZip(archive, [], { id: "notes-procedure", version: "1.0.0" });
  assert.equal(prepared.preview.skills[0].name, "notes-check");
  assert.equal(await readFile(join(prepared.installation.root, "skills/notes-check/scripts/example.sh"), "utf8"), "exit 99");
});

test("full plugin bundles prepare disabled connections, tools and skills without account authority", async t => {
  const root = await mkdtemp(join(tmpdir(), "lab-full-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const installer = new PackageInstaller(root);
  const connection = { ref: "conn_notes-plugin-account", displayName: "Notes account", provider: "Notes", owner: "local-workspace", resource: "https://notes.example/mcp", scopes: [], enabled: false, auth: { kind: "anonymous" as const } };
  const pkg = { id: "notes-plugin-provider", version: "1.0.0", source: "mcp", endpoint: connection.resource, connectionRef: connection.ref };
  const prepared = await installer.installZip(bundle({ connections: [connection], packages: [pkg] }));
  assert.deepEqual(prepared.connections, [connection]);
  assert.deepEqual(prepared.installation.connectionRefs, [connection.ref]);
  assert.equal(prepared.packages.length, 2);
  assert.ok(prepared.packages.every(pkg => pkg.enabled === false));
  assert.equal(prepared.preview.skills[0].name, "notes-check");
  const manager = await ConnectionManager.create(prepared.connections);
  const summary = await manager.summary(connection.ref);
  assert.equal(summary.status, "unavailable");
  assert.match(summary.reason ?? "", /disabled/);
  await assert.rejects(installer.previewZip(bundle({ connections: [{ ...connection, ref: "notes-plugin-account" }], packages: [] })), /namespaced/);
  await assert.rejects(installer.previewZip(bundle({ connections: [{ ...connection, auth: { kind: "stored", credentialRef: "credential_untrusted" } }], packages: [pkg] })), /anonymous templates/);
  await assert.rejects(installer.previewZip(bundle({ packages: [pkg] })), /unknown/);
  await assert.rejects(installer.previewZip(bundle({ connections: [connection], packages: [{ ...pkg, endpoint: "https://another.example/mcp" }] })), /match/);
});

test("archives reject traversal, symlinks, expansion bombs and unsupported hook manifests", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lab-installations-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const installer = new PackageInstaller(root);
  await assert.rejects(installer.previewZip(zip({ "../escape": "bad" })), /unsafe/);
  await assert.rejects(installer.previewZip(zip({ "link": "target" }, true)), /links/);
  await assert.rejects(installer.previewZip(zip({ "bomb": "a".repeat(250_000) })), /unbounded/);
  await assert.rejects(installer.previewZip(bundle({ hooks: ["run.sh"] })), /hooks/);
  await assert.rejects(installer.importGit({ url: "file:///tmp/repository", commit: "main" }), /pinned commit/);
  assert.deepEqual(await readdir(root), []);
});

test("exact dependency locks reject missing versions and cycles", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lab-installations-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const installer = new PackageInstaller(root);
  const dependency: ManagedInstallationRecord = { id: "other", version: "1.0.0", digest: "a".repeat(64), root: "/unused", packageIds: [], dependencies: [], installedAt: new Date().toISOString() };
  const archive = bundle({ dependencies: [{ id: "other", version: "1.0.0" }] });
  await assert.rejects(installer.previewZip(archive), /missing/);
  await installer.previewZip(archive, [dependency]);
  await assert.rejects(installer.previewZip(archive, [{ ...dependency, version: "2.0.0" }]), /exact version/);
  await assert.rejects(installer.previewZip(archive, [{ ...dependency, dependencies: [{ id: "notes-plugin", version: "1.0.0" }] }]), /cycle/);
});

test("Git imports inspect an exact commit through HTTP without checkout or hooks", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lab-git-import-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = join(root, "fixture"); await mkdir(repository);
  const git = (...args: string[]) => promisify(execFile)("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: repository,
    env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" } });
  await git("init", "--quiet");
  await writeFile(join(repository, "SKILL.md"), skill);
  await git("add", "SKILL.md"); await git("commit", "--quiet", "-m", "Fixture skill");
  const commit = (await git("rev-parse", "HEAD")).stdout.trim();
  const executable = join((await git("--exec-path")).stdout.trim(), "git-http-backend");
  const server = createServer((request, response) => {
    const url = new URL(request.url!, "http://localhost");
    const child = spawn(executable, [], { env: { PATH: process.env.PATH, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: "1", REQUEST_METHOD: request.method!,
      PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1), CONTENT_TYPE: request.headers["content-type"] ?? "", CONTENT_LENGTH: request.headers["content-length"] ?? "", SERVER_PROTOCOL: "HTTP/1.1" } });
    const output: Buffer[] = []; child.stdout.on("data", chunk => output.push(Buffer.from(chunk)));
    child.on("error", () => { response.statusCode = 500; response.end(); });
    child.on("close", () => {
      const bytes = Buffer.concat(output), boundary = bytes.indexOf("\r\n\r\n");
      if (boundary < 0) { response.statusCode = 500; response.end(); return; }
      for (const line of bytes.subarray(0, boundary).toString().split("\r\n")) {
        const colon = line.indexOf(":"); if (colon < 0) continue;
        const name = line.slice(0, colon), value = line.slice(colon + 1).trim();
        if (name.toLowerCase() === "status") response.statusCode = Number(value.slice(0, 3)); else response.setHeader(name, value);
      }
      response.end(bytes.subarray(boundary + 4));
    });
    request.pipe(child.stdin);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const port = (server.address() as { port: number }).port;
  const installer = new PackageInstaller(join(root, "installed"));
  const prepared = await installer.importGit({ url: `http://127.0.0.1:${port}/fixture/.git`, commit }, [], { id: "git-procedure", version: "1.0.0" });
  assert.equal(prepared.preview.skills[0].name, "notes-check");
  assert.equal(prepared.preview.origin.kind, "git");
  const provenance = JSON.parse(await readFile(join(prepared.installation.root, ".lab-installation.json"), "utf8"));
  assert.equal(provenance.origin.commit, commit);
  assert.deepEqual((await readdir(join(root, "installed"))).filter(name => name.startsWith(".git-")), []);
});

function zip(entries: Record<string, string>, symlink = false): Buffer {
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const path = Buffer.from(name), content = Buffer.from(value), compressed = deflateRawSync(content), checksum = crc32(content);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 8);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(content.length, 22); header.writeUInt16LE(path.length, 26);
    local.push(header, path, compressed);
    const index = Buffer.alloc(46); index.writeUInt32LE(0x02014b50); index.writeUInt16LE(0x0314, 4); index.writeUInt16LE(20, 6); index.writeUInt16LE(8, 10);
    index.writeUInt32LE(checksum, 16); index.writeUInt32LE(compressed.length, 20); index.writeUInt32LE(content.length, 24); index.writeUInt16LE(path.length, 28);
    index.writeUInt32LE(((symlink ? 0xa1ff : 0x81a4) << 16) >>> 0, 38); index.writeUInt32LE(offset, 42);
    central.push(index, path); offset += header.length + path.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
function crc32(bytes: Buffer): number { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
