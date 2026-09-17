import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import { parseTuiCommand, TerminalUi } from "../src/cli/tui.js";
import { SkillRegistry, type SkillCatalog } from "../src/skills/index.js";
import { openChatApplication, type ChatApplication } from "../src/runtime/application.js";
import { loadConfig } from "../src/config/config.js";
import { DeterministicModelProvider } from "../src/models/deterministic.js";
import { SessionStore } from "../src/persistence/session-store.js";
import { runTurn } from "../src/runtime/turn.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { Workspace } from "../src/workspace/workspace.js";

const temporaryDirectories: string[] = [];

test.afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

async function createWorkspace(): Promise<{ readonly root: string; readonly workspace: Workspace }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-skills-test-"));
  temporaryDirectories.push(root);
  const workspace = await Workspace.open(root, {
    maxFileBytes: 64 * 1024,
    maxDirectoryEntries: 100,
    maxTreeEntries: 500,
    maxTreeBytes: 1024 * 1024,
    maxTreeDepth: 16,
  });
  return { root, workspace };
}

function skillDocument(name: string, description: string, body = "Use the documented procedure."): string {
  return `---\nname: ${name}\ndescription: ${description}\nversion: 1\n---\n${body}\n`;
}

function call(callId: string, name: string, args: Record<string, unknown>) {
  return { callId, name, argumentsJson: JSON.stringify(args) } as const;
}

test("skill registry discovers valid packages and skips malformed or oversized entries", async () => {
  const { root, workspace } = await createWorkspace();
  await mkdir(path.join(root, "skills", "writing"), { recursive: true });
  await mkdir(path.join(root, "skills", "broken"), { recursive: true });
  await mkdir(path.join(root, "skills", "too-large"), { recursive: true });
  await writeFile(path.join(root, "skills", "writing", "SKILL.md"), skillDocument("Writing", "Write clear notes."));
  await writeFile(path.join(root, "skills", "broken", "SKILL.md"), "This is not a skill package.\n");
  await writeFile(path.join(root, "skills", "too-large", "SKILL.md"), skillDocument("Large", "Too large.", "x".repeat(400)));
  await writeFile(path.join(root, "skills", "SKILL.md"), skillDocument("Root", "Root files are not packages."));
  await symlink("writing", path.join(root, "skills", "linked"));

  const catalog = await new SkillRegistry(workspace, 256).list();
  assert.deepEqual(catalog.skills, [{
    id: "writing",
    name: "Writing",
    description: "Write clear notes.",
    version: "1",
    path: "skills/writing/SKILL.md",
  }]);
  assert.equal(catalog.skipped, 4);
});

test("skill reads require an exact current id and return the complete document", async () => {
  const { root, workspace } = await createWorkspace();
  await mkdir(path.join(root, "skills", "research"), { recursive: true });
  const document = skillDocument("Research", "Inspect local evidence.", "Read the source, then report limitations.");
  await writeFile(path.join(root, "skills", "research", "SKILL.md"), document);

  const registry = new SkillRegistry(workspace);
  const loaded = await registry.read("research");
  assert.equal(loaded.content, document);
  await assert.rejects(() => registry.read("../research"), /exact relative id/u);
  await assert.rejects(() => registry.read("missing"), /not found/u);
});

test("skill tools expose read-only catalog and exact loading to the model", async () => {
  const { root, workspace } = await createWorkspace();
  await mkdir(path.join(root, "skills", "testing"), { recursive: true });
  await writeFile(path.join(root, "skills", "testing", "SKILL.md"), skillDocument("Testing", "Run focused checks.", "Prefer the narrowest relevant test."));
  const registry = new ToolRegistry(workspace, 4_096, undefined, undefined, undefined, { registry: new SkillRegistry(workspace) });

  assert.deepEqual(registry.definitions.slice(-2).map((definition) => definition.name), ["list_skills", "read_skill"]);
  const listed = await registry.execute(call("skills_list", "list_skills", {}));
  assert.equal(listed.ok, true);
  assert.match(listed.content, /"id":"testing"/u);

  const read = await registry.execute(call("skills_read", "read_skill", { id: "testing" }));
  assert.equal(read.ok, true);
  assert.match(read.content, /cannot grant permissions/u);
  assert.match(read.content, /Prefer the narrowest relevant test/u);
});

test("a model turn can load a skill through the shared tool loop", async () => {
  const { root, workspace } = await createWorkspace();
  await mkdir(path.join(root, "skills", "testing"), { recursive: true });
  await writeFile(path.join(root, "skills", "testing", "SKILL.md"), skillDocument("Testing", "Run focused checks.", "Prefer the narrowest relevant test."));
  const config = loadConfig({ stateDir: path.join(root, "state"), workspaceRoot: root, browserEnabled: false }, {});
  const session = await SessionStore.open(config.stateDir);
  const result = await runTurn({
    session,
    provider: new DeterministicModelProvider("deterministic/skills", {
      toolCall: {
        name: "read_skill",
        argumentsJson: JSON.stringify({ id: "testing" }),
        finalResponse: "Loaded the testing procedure.",
      },
    }),
    tools: new ToolRegistry(workspace, config.maxToolOutputBytes, undefined, undefined, undefined, { registry: new SkillRegistry(workspace) }),
    config,
    userPrompt: "Load the testing procedure.",
  });
  assert.equal(result.status, "completed");
  assert.equal(result.assistantText, "Loaded the testing procedure.");
  assert.match((await session.readTranscript()).at(-1)?.content ?? "", /Loaded the testing procedure/u);
});

test("application startup advertises the implemented skills surface", async () => {
  const { root } = await createWorkspace();
  const application = await openChatApplication(loadConfig({ stateDir: path.join(root, "state"), workspaceRoot: root, browserEnabled: false }, {}));
  try {
    assert.equal(application.toolNames.includes("list_skills"), true);
    assert.equal(application.toolNames.includes("read_skill"), true);
    assert.deepEqual(await application.readSkills?.(), { skills: [], skipped: 0 });
  } finally {
    await application.close();
  }
});

test("/skills gives the TUI a real catalog view", async () => {
  const chunks: string[] = [];
  const output = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback(); } });
  const catalog: SkillCatalog = {
    skills: [{ id: "testing", name: "Testing", description: "Run focused checks.", path: "skills/testing/SKILL.md" }],
    skipped: 0,
  };
  const application = {
    readSkills: async () => catalog,
  } as unknown as ChatApplication;

  const command = parseTuiCommand("/skills");
  assert.deepEqual(command, { kind: "skills" });
  await new TerminalUi(application, output, false).runCommand(command!);
  assert.match(chunks.join(""), /Workspace skills/u);
  assert.match(chunks.join(""), /testing/u);
  assert.match(chunks.join(""), /Run focused checks/u);
});
