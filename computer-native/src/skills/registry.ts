import path from "node:path";
import { WorkspaceAccessError } from "../runtime/errors.js";
import type { Workspace } from "../workspace/workspace.js";

const SKILLS_DIRECTORY = "skills";
const SKILL_FILE = "SKILL.md";
const DEFAULT_MAX_SKILL_BYTES = 32 * 1024;
const DEFAULT_MAX_SKILL_DEPTH = 4;
const DEFAULT_MAX_SKILLS = 64;
const MAX_SKILL_NAME_LENGTH = 100;
const MAX_SKILL_DESCRIPTION_LENGTH = 240;

export interface SkillSummary {
  /** Workspace-relative package directory, normalized with forward slashes. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  /** Workspace-relative SKILL.md path; never an absolute filesystem path. */
  readonly path: string;
}

export interface SkillCatalog {
  readonly skills: readonly SkillSummary[];
  readonly skipped: number;
}

export interface LoadedSkill {
  readonly summary: SkillSummary;
  /** The complete bounded SKILL.md, including its front matter. */
  readonly content: string;
}

interface SkillFrontMatter {
  readonly name: string;
  readonly description: string;
  readonly version?: string;
}

interface SkillCandidate {
  readonly summary: SkillSummary;
  readonly content: string;
}

function isMissing(error: unknown): boolean {
  let current: unknown = error;
  for (let attempt = 0; attempt < 4 && current !== undefined; attempt += 1) {
    if (typeof current === "object" && current !== null && "code" in current && current.code === "ENOENT") return true;
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

function normalizedPath(value: string): string {
  return value.replaceAll(path.sep, "/");
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseFrontMatter(content: string): SkillFrontMatter {
  const normalized = content.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    throw new WorkspaceAccessError("Skill SKILL.md must begin with YAML front matter.");
  }
  const closing = normalized.indexOf("\n---\n", 4);
  if (closing < 0) throw new WorkspaceAccessError("Skill SKILL.md has no closing front-matter delimiter.");

  const values = new Map<string, string>();
  for (const line of normalized.slice(4, closing).split("\n")) {
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) throw new WorkspaceAccessError("Skill front matter contains a malformed field.");
    const key = line.slice(0, separator).trim();
    const value = unquote(line.slice(separator + 1).trim());
    if (!/^[-A-Za-z0-9_]+$/u.test(key) || value.length === 0 || values.has(key)) {
      throw new WorkspaceAccessError("Skill front matter contains an invalid or duplicate field.");
    }
    values.set(key, value);
  }

  const name = values.get("name");
  const description = values.get("description");
  const version = values.get("version");
  if (!name || !description) throw new WorkspaceAccessError("Skill front matter requires name and description.");
  if (name.length > MAX_SKILL_NAME_LENGTH || description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    throw new WorkspaceAccessError("Skill name or description exceeds its bounded length.");
  }
  return { name, description, ...(version ? { version } : {}) };
}

export class SkillRegistry {
  private readonly maxBytes: number;

  constructor(
    private readonly workspace: Workspace,
    maxBytes = DEFAULT_MAX_SKILL_BYTES,
    private readonly maxDepth = DEFAULT_MAX_SKILL_DEPTH,
    private readonly maxSkills = DEFAULT_MAX_SKILLS,
  ) {
    this.maxBytes = Math.min(maxBytes, workspace.policy.limits.maxFileBytes);
    if (!Number.isInteger(this.maxBytes) || this.maxBytes <= 0) throw new WorkspaceAccessError("Skill size limit must be a positive integer.");
    if (!Number.isInteger(maxDepth) || maxDepth < 1) throw new WorkspaceAccessError("Skill discovery depth must be a positive integer.");
    if (!Number.isInteger(maxSkills) || maxSkills < 1) throw new WorkspaceAccessError("Skill catalog limit must be a positive integer.");
  }

  async list(): Promise<SkillCatalog> {
    const candidates = await this.scan();
    return {
      skills: candidates.map((candidate) => candidate.summary),
      skipped: candidates.skipped,
    };
  }

  async read(id: string): Promise<LoadedSkill> {
    if (typeof id !== "string" || id.trim().length === 0 || id.includes("\\") || path.isAbsolute(id) || id.split("/").some((part) => part === "" || part === "." || part === "..")) {
      throw new WorkspaceAccessError("Skill id must be an exact relative id returned by list_skills.");
    }
    const candidates = await this.scan();
    const candidate = candidates.find((entry) => entry.summary.id === id);
    if (!candidate) throw new WorkspaceAccessError(`Skill '${id}' was not found in the current workspace catalog.`);
    return candidate;
  }

  private async scan(): Promise<(SkillCandidate[] & { readonly skipped: number })> {
    const root = await this.workspace.stat(SKILLS_DIRECTORY).catch((error: unknown) => {
      if (isMissing(error)) return undefined;
      throw error;
    });
    if (!root) return Object.assign([], { skipped: 0 }) as SkillCandidate[] & { readonly skipped: number };
    if (root.kind !== "directory") throw new WorkspaceAccessError("Workspace skills path must be a regular directory.");

    const found: SkillCandidate[] = [];
    let skipped = 0;
    const seen = new Set<string>();
    const visit = async (relativeDirectory: string, depth: number): Promise<void> => {
      if (found.length >= this.maxSkills) return;
      if (depth > this.maxDepth) {
        skipped += 1;
        return;
      }
      let listing;
      try {
        listing = await this.workspace.listDirectory(relativeDirectory);
      } catch (error) {
        if (isMissing(error)) return;
        throw error;
      }
      for (const entry of listing.entries) {
        if (found.length >= this.maxSkills) {
          skipped += 1;
          break;
        }
        const entryPath = path.join(relativeDirectory, entry.name);
        if (entry.kind === "symlink") {
          skipped += 1;
          continue;
        }
        if (entry.name === SKILL_FILE) {
          if (entry.kind !== "file" || relativeDirectory === SKILLS_DIRECTORY) {
            skipped += 1;
            continue;
          }
          const id = normalizedPath(path.relative(SKILLS_DIRECTORY, relativeDirectory));
          if (seen.has(id)) {
            skipped += 1;
            continue;
          }
          try {
            const candidate = await this.loadCandidate(id, entryPath);
            seen.add(id);
            found.push(candidate);
          } catch {
            skipped += 1;
          }
          continue;
        }
        if (entry.kind === "directory") await visit(entryPath, depth + 1);
      }
    };
    await visit(SKILLS_DIRECTORY, 0);
    found.sort((left, right) => left.summary.id.localeCompare(right.summary.id));
    return Object.assign(found, { skipped }) as SkillCandidate[] & { readonly skipped: number };
  }

  private async loadCandidate(id: string, skillPath: string): Promise<SkillCandidate> {
    const metadata = await this.workspace.stat(skillPath);
    if (metadata.kind !== "file") throw new WorkspaceAccessError(`Skill '${id}' is not a regular file.`);
    if (metadata.sizeBytes > this.maxBytes) throw new WorkspaceAccessError(`Skill '${id}' exceeds the ${this.maxBytes}-byte size limit.`);
    const file = await this.workspace.readFile(skillPath);
    if (file.sizeBytes > this.maxBytes) throw new WorkspaceAccessError(`Skill '${id}' grew beyond the ${this.maxBytes}-byte size limit.`);
    const frontMatter = parseFrontMatter(file.content);
    return {
      summary: {
        id,
        name: frontMatter.name,
        description: frontMatter.description,
        ...(frontMatter.version ? { version: frontMatter.version } : {}),
        path: normalizedPath(skillPath),
      },
      content: file.content,
    };
  }
}
