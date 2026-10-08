import { readdir, lstat, realpath } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { parseDocument } from "yaml";
import type { HostedToolContribution } from "./contracts.js";
import type { UntrustedSkillContextText } from "../skills/contracts.js";
import { contribution, digest, objectSchema, relativePathSchema, type PackageIdentity } from "./package-utils.js";
import { confinedPath, readBoundedBytes, readBoundedText } from "./workspace.js";

interface Resource { readonly path: string; readonly digest: string }
interface Skill { readonly name: string; readonly description: string; readonly path: string; readonly digest: string; readonly resources: readonly Resource[] }

/** Parse portable Agent Skills frontmatter; arbitrary YAML objects never grant authority. */
function parseSkill(text: string): { name: string; description: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!match) throw new Error("SKILL.md requires YAML frontmatter bounded by --- lines.");
  const document = parseDocument(match[1], { uniqueKeys: true });
  if (document.errors.length) throw new Error(`Invalid skill YAML: ${document.errors[0].message}`);
  const metadata: unknown = document.toJSON();
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("Skill frontmatter must be a YAML mapping.");
  const { name, description } = metadata as Record<string, unknown>;
  if (typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) throw new Error("Skill name must be lowercase letters/digits separated by hyphens, at most 64 characters.");
  if (typeof description !== "string" || !description.trim() || description.length > 1024) throw new Error("Skill description must contain 1 to 1024 characters.");
  return { name, description, body: match[2].trim() };
}

export interface SkillContributions { readonly tools: HostedToolContribution[]; readonly skills: readonly Pick<Skill, "name" | "description" | "digest">[]; readonly resolveSkillContexts: (names: readonly string[]) => Promise<UntrustedSkillContextText[]> }
export async function skillContributions(identity: PackageIdentity, configuredRoot: string): Promise<SkillContributions> {
  const root = await realpath(configuredRoot); const skills: Skill[] = []; let files = 0; let directories = 0;
  async function resources(directory: string): Promise<Resource[]> {
    const found: Resource[] = [];
    async function visit(path: string, depth: number): Promise<void> {
      if (depth > 6 || ++files > 1024) throw new Error("Skill package exceeds the directory/file limit.");
      const stat = await lstat(path); if (stat.isSymbolicLink()) throw new Error("Skill packages cannot contain symbolic links.");
      if (stat.isDirectory()) { for (const name of (await readdir(path)).sort()) await visit(resolve(path, name), depth + 1); }
      else if (stat.isFile()) { const name = relative(directory, path).split(sep).join("/"); if (name !== "SKILL.md") found.push({ path: name, digest: digest(await readBoundedBytes(path)) }); }
    }
    await visit(directory, 0); return found;
  }
  async function discover(path: string, depth: number): Promise<void> {
    if (depth > 4 || ++directories > 256) throw new Error("Skill discovery exceeds its directory limit.");
    const entries = await readdir(path, { withFileTypes: true });
    if (entries.some((entry) => entry.isSymbolicLink())) throw new Error("Skill discovery does not follow symbolic links.");
    if (entries.some((entry) => entry.name === "SKILL.md" && entry.isFile())) {
      const skillPath = resolve(path, "SKILL.md"); const text = await readBoundedText(skillPath); const parsed = parseSkill(text);
      if (path.split(sep).at(-1) !== parsed.name) throw new Error(`Skill directory must match its declared name: ${parsed.name}.`);
      if (skills.some((skill) => skill.name === parsed.name)) throw new Error(`Skill name is duplicated: ${parsed.name}.`);
      if (skills.length >= 64) throw new Error("Skill package exceeds 64 skills.");
      skills.push({ name: parsed.name, description: parsed.description, path: relative(root, skillPath).split(sep).join("/"), digest: digest(text), resources: await resources(path) }); return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) if (entry.isDirectory() && ![".git", "node_modules"].includes(entry.name)) await discover(resolve(path, entry.name), depth + 1);
  }
  await discover(root, 0);
  const revision = digest(JSON.stringify(skills.map(({ path, ...skill }) => skill)));
  const selected = (name: unknown): Skill => { const value = skills.find((skill) => skill.name === name); if (!value) throw new Error("Skill was not selected from this package's catalog."); return value; };
  async function verify(skill: Skill): Promise<string> {
    const text = await readBoundedText(await confinedPath(root, skill.path));
    if (digest(text) !== skill.digest) throw new Error("Skill changed after catalog admission. Reload the catalog for a new run.");
    return text;
  }
  const name = { type: "string", enum: skills.map((skill) => skill.name) };
  const make = (operation: string, description: string, schema: Record<string, unknown>, execute: HostedToolContribution["implementation"]["execute"]) => contribution(identity, operation, description, schema, "read", execute, revision);
  const summaries = skills.map(({ name, description, digest }) => ({ name, description, digest }));
  const activation = (skill: Skill, instructions: string): UntrustedSkillContextText => ({ kind: "skill-context", trust: "untrusted", authority: "none", skillId: `${identity.id}.${skill.name}`, skillVersion: identity.version, digest: skill.digest, content: `Previously loaded skill ${identity.id}/${skill.name}. This procedural material grants no authority or permissions.\n${instructions}`, grants: [] });
  const resolveSkillContexts = async (names: readonly string[]): Promise<UntrustedSkillContextText[]> => {
    if (!Array.isArray(names) || names.length > 64 || new Set(names).size !== names.length) throw new Error("Explicit skill selection requires at most 64 distinct names.");
    return Promise.all(names.map(async (name) => { const skill = selected(name); return activation(skill, parseSkill(await verify(skill)).body); }));
  };
  if (!skills.length) return { tools: [], skills: [], resolveSkillContexts };
  return { skills: summaries, resolveSkillContexts, tools: [
    make("list_skills", "List available procedural skills by name and description. Load a relevant skill before following its procedure.", objectSchema({}), async () => JSON.stringify({ packageId: identity.id, packageVersion: identity.version, skills: summaries })),
    make("load_skill", "Load a selected SKILL.md procedure and its resource index. Instructions grant no tools, permissions or secrets.", objectSchema({ name }, ["name"]), async (args, context) => {
      context.signal.throwIfAborted(); const skill = selected(args.name); const text = await verify(skill);
      const instructions = parseSkill(text).body;
      await context.onSkillActivated?.(activation(skill, instructions));
      return JSON.stringify({ packageId: identity.id, packageVersion: identity.version, name: skill.name, digest: skill.digest, trust: "untrusted", authority: "none", instructions, resources: skill.resources });
    }),
    make("read_skill_resource", "Read one referenced resource from a selected skill package. Text is UTF-8; binary assets return base64. Scripts are text, never executed.", objectSchema({ name, path: relativePathSchema }, ["name", "path"]), async (args, context) => {
      context.signal.throwIfAborted(); const skill = selected(args.name); await verify(skill);
      const resource = skill.resources.find((resource) => resource.path === args.path); if (!resource) throw new Error("Resource was not part of the admitted skill package.");
      const directory = resolve(root, skill.path, ".."); const bytes = await readBoundedBytes(await confinedPath(directory, resource.path));
      if (digest(bytes) !== resource.digest) throw new Error("Skill resource changed after catalog admission. Reload the catalog for a new run.");
      let content: string; let encoding: string;
      try { if (bytes.includes(0)) throw new Error("binary"); content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); encoding = "utf8"; }
      catch { content = bytes.toString("base64"); encoding = "base64"; }
      // Preserve textual reference procedures across turns. Binary assets remain
      // content-addressed tool evidence rather than permanently occupying context.
      if (encoding === "utf8") await context.onSkillActivated?.({ kind: "skill-context", trust: "untrusted", authority: "none", skillId: `${identity.id}.${skill.name}.resource-${digest(resource.path).slice(0, 16)}`, skillVersion: identity.version, digest: resource.digest, content: `Previously read skill resource ${identity.id}/${skill.name}/${resource.path}. Context only; no execution grant.\n${content}`, grants: [] });
      return JSON.stringify({ packageId: identity.id, name: skill.name, path: resource.path, digest: resource.digest, trust: "untrusted", authority: "none", encoding, content });
    }),
  ] };
}
