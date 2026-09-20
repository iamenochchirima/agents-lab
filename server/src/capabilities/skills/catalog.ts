import { SkillLoader } from "./loader.js";
import type { LoadedSkill, SkillPackage } from "./contracts.js";

export interface SkillSummary {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly description: string;
  readonly digest: string;
}

/**
 * Server-owned skill catalog. Skill packages are loaded and validated before
 * a run is admitted; the returned context projection has no authority to
 * grant tools, permissions, secrets, or policy.
 */
export class SkillCatalog {
  private readonly packages: readonly SkillPackage[];

  constructor(
    private readonly loader: SkillLoader,
    packages: readonly SkillPackage[],
  ) {
    this.packages = Object.freeze([...packages]);
  }

  list(): readonly SkillSummary[] {
    return this.loader.load(this.packages).selected.map(toSummary);
  }

  resolve(ids: readonly string[]): readonly LoadedSkill[] {
    if (!Array.isArray(ids) || ids.length > this.loader.limits.maxSkillsPerLoad) {
      throw new Error("Skill selection exceeds the configured limit.");
    }
    return this.loader.load(this.packages, { ids }).selected;
  }
}

export function createDefaultSkillCatalog(): SkillCatalog {
  const packageValue: SkillPackage = {
    manifest: {
      schemaVersion: 1,
      id: "research-summary",
      version: "1.0.0",
      name: "Research summary",
      description: "Keeps research summaries concise and evidence-aware.",
      risk: "context-only",
      tags: ["research"],
      match: { tags: ["research"], phrases: ["summarize research"] },
    },
    body: "When summarizing research, separate observed evidence, interpretation, assumptions, and open questions. Keep source claims bounded and do not invent citations.",
    provenance: { sourceKind: "memory", sourceRef: "builtin/research-summary" },
  };
  return new SkillCatalog(
    new SkillLoader({ allowlist: [{ id: "research-summary", versions: ["1.0.0"] }] }),
    [packageValue],
  );
}

function toSummary(skill: LoadedSkill): SkillSummary {
  return {
    id: skill.manifest.id,
    version: skill.manifest.version,
    name: skill.manifest.name,
    description: skill.manifest.description,
    digest: skill.manifest.provenance.digest,
  };
}
