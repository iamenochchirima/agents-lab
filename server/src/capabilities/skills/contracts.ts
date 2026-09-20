export const SKILL_SCHEMA_VERSION = 1 as const;

export const DEFAULT_SKILL_LOADER_LIMITS = Object.freeze({
  maxManifestBytes: 16 * 1024,
  maxBodyBytes: 64 * 1024,
  maxTotalBodyBytes: 512 * 1024,
  maxSkillsPerLoad: 64,
  maxTags: 32,
  maxPhrases: 32,
  maxTextBytes: 8 * 1024,
} as const);

export type SkillRisk = "context-only";
export type SkillSourceKind = "filesystem" | "memory";

export interface SkillMatch {
  readonly tags?: readonly string[];
  readonly phrases?: readonly string[];
}

/**
 * Metadata read from skill.json. Source and digest are supplied by the loader,
 * not trusted from the skill body or package metadata.
 */
export interface SkillManifestInput {
  readonly schemaVersion: typeof SKILL_SCHEMA_VERSION;
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly description: string;
  readonly risk: SkillRisk;
  readonly tags?: readonly string[];
  readonly match?: SkillMatch;
  /** Optional digest supplied by a trusted package index. */
  readonly expectedDigest?: string;
}

export interface SkillProvenance {
  readonly sourceKind: SkillSourceKind;
  readonly sourceRef: string;
  readonly digest: string;
}

export interface SkillPackage {
  readonly manifest: SkillManifestInput;
  readonly body: string;
  readonly provenance: {
    readonly sourceKind: SkillSourceKind;
    readonly sourceRef: string;
  };
}

export interface SkillManifest extends Omit<SkillManifestInput, "expectedDigest"> {
  readonly provenance: SkillProvenance;
}

/**
 * The only projection of a skill intended for model context. Its type makes
 * the security boundary visible: skill text has no grants or authority.
 */
export interface UntrustedSkillContextText {
  readonly kind: "skill-context";
  readonly trust: "untrusted";
  readonly authority: "none";
  readonly skillId: string;
  readonly skillVersion: string;
  readonly digest: string;
  readonly content: string;
  readonly grants: readonly [];
}

export interface LoadedSkill {
  readonly manifest: SkillManifest;
  readonly body: string;
  readonly context: UntrustedSkillContextText;
}

export interface SkillAllowlistEntry {
  readonly id: string;
  readonly versions: readonly string[];
}

export interface SkillLoaderLimits {
  readonly maxManifestBytes: number;
  readonly maxBodyBytes: number;
  readonly maxTotalBodyBytes: number;
  readonly maxSkillsPerLoad: number;
  readonly maxTags: number;
  readonly maxPhrases: number;
  readonly maxTextBytes: number;
}

export interface SkillLoaderOptions {
  readonly allowlist: readonly SkillAllowlistEntry[];
  readonly limits?: Partial<SkillLoaderLimits>;
}

export interface SkillSelection {
  /** Exact IDs. IDs, tags, and text are independent matching criteria. */
  readonly ids?: readonly string[];
  /** A skill matches when any requested tag matches its declared tags. */
  readonly tags?: readonly string[];
  /** A skill matches when any declared phrase occurs in this text. */
  readonly text?: string;
}

export interface SkillLoadResult {
  readonly selected: readonly LoadedSkill[];
  readonly candidates: number;
  readonly totalBodyBytes: number;
}

export interface SkillPackageLocation {
  readonly root: string;
  readonly id: string;
  readonly version: string;
}

export type SkillLoaderErrorCode =
  | "INVALID_ALLOWLIST"
  | "INVALID_SKILL_ID"
  | "INVALID_SKILL_VERSION"
  | "INVALID_SKILL_MANIFEST"
  | "INVALID_SKILL_PROVENANCE"
  | "SKILL_NOT_ALLOWLISTED"
  | "DUPLICATE_SKILL_ID"
  | "SKILL_FILE_NOT_FOUND"
  | "SKILL_NOT_A_FILE"
  | "SKILL_TOO_LARGE"
  | "INVALID_SKILL_ENCODING"
  | "SKILL_DIGEST_MISMATCH"
  | "INVALID_SKILL_SELECTION"
  | "SKILL_LIMIT_EXCEEDED";

export class SkillLoaderError extends Error {
  readonly code: SkillLoaderErrorCode;

  constructor(code: SkillLoaderErrorCode, message: string) {
    super(message);
    this.name = "SkillLoaderError";
    this.code = code;
  }
}
