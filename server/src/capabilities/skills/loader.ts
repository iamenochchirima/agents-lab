import { createHash } from "node:crypto";
import { open, readdir } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_SKILL_LOADER_LIMITS,
  SKILL_SCHEMA_VERSION,
  type LoadedSkill,
  type SkillAllowlistEntry,
  type SkillLoadResult,
  type SkillLoaderLimits,
  type SkillLoaderOptions,
  SkillLoaderError,
  type SkillManifest,
  type SkillManifestInput,
  type SkillMatch,
  type SkillPackage,
  type SkillPackageLocation,
  type SkillProvenance,
  type SkillSelection,
} from "./contracts.js";

const SKILL_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const DIGEST = /^[a-f0-9]{64}$/;
const SOURCE_REF = /^[^\u0000\r\n]{1,512}$/;
const MAX_STRING_BYTES = 8 * 1024;
const MANIFEST_KEYS = new Set(["schemaVersion", "id", "version", "name", "description", "risk", "tags", "match", "expectedDigest"]);
const MATCH_KEYS = new Set(["tags", "phrases"]);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

type ValidatedSkillPackage = Omit<SkillPackage, "manifest"> & {
  readonly manifest: SkillManifest;
};

export class SkillLoader {
  readonly #allowlist: ReadonlyMap<string, ReadonlySet<string>>;
  readonly #limits: SkillLoaderLimits;

  constructor(options: SkillLoaderOptions) {
    this.#limits = normalizeLimits(options.limits);
    this.#allowlist = normalizeAllowlist(options.allowlist);
  }

  /**
   * Validates and selects already-read packages. This is useful for built-in
   * or test fixtures while preserving the same validation as filesystem loads.
   */
  load(packages: readonly SkillPackage[], selection: SkillSelection = {}): SkillLoadResult {
    validateSelection(selection, this.#limits);
    if (packages.length > this.#limits.maxSkillsPerLoad) {
      throw new SkillLoaderError("SKILL_LIMIT_EXCEEDED", `Skill package count exceeds ${this.#limits.maxSkillsPerLoad}.`);
    }

    const candidates: ValidatedSkillPackage[] = [];
    const seenIds = new Set<string>();
    let totalBodyBytes = 0;

    for (const candidate of packages) {
      const id = candidate?.manifest?.id;
      if (typeof id !== "string" || !SKILL_ID.test(id)) {
        throw new SkillLoaderError("INVALID_SKILL_ID", `Invalid skill ID: ${String(id)}.`);
      }
      if (!this.#allowlist.has(id)) continue;

      const normalized = normalizePackage(candidate, this.#limits);
      if (!isAllowlisted(this.#allowlist, normalized.manifest.id, normalized.manifest.version)) {
        throw new SkillLoaderError(
          "SKILL_NOT_ALLOWLISTED",
          `Skill ${normalized.manifest.id}@${normalized.manifest.version} is not allowlisted.`,
        );
      }
      if (seenIds.has(normalized.manifest.id)) {
        throw new SkillLoaderError("DUPLICATE_SKILL_ID", `Duplicate skill ID: ${normalized.manifest.id}.`);
      }
      seenIds.add(normalized.manifest.id);
      totalBodyBytes += byteLength(normalized.body);
      if (totalBodyBytes > this.#limits.maxTotalBodyBytes) {
        throw new SkillLoaderError("SKILL_TOO_LARGE", `Selected skill bodies exceed ${this.#limits.maxTotalBodyBytes} bytes.`);
      }
      candidates.push(normalized);
    }

    const selected = candidates
      .filter((candidate) => matchesSelection(candidate.manifest, selection))
      .sort((left, right) => compareStrings(left.manifest.id, right.manifest.id))
      .map((candidate) => freezeLoadedSkill(candidate));

    return Object.freeze({
      selected: Object.freeze(selected),
      candidates: candidates.length,
      totalBodyBytes,
    });
  }

  /**
   * Discovers packages as root/<id>/<version>/skill.json and SKILL.md.
   * Unallowlisted directories are ignored before their contents are parsed.
   */
  async loadFromRoots(roots: readonly string[], selection: SkillSelection = {}): Promise<SkillLoadResult> {
    validateRoots(roots);
    const locations: SkillPackageLocation[] = [];

    for (const root of [...roots].sort(compareStrings)) {
      const rootEntries = await readDirectories(root);
      for (const id of rootEntries.sort(compareStrings)) {
        if (!this.#allowlist.has(id)) continue;
        const versions = await readDirectories(path.join(root, id));
        for (const version of versions.sort(compareStrings)) {
          if (isAllowlisted(this.#allowlist, id, version)) {
            locations.push({ root, id, version });
          }
        }
      }
    }

    if (locations.length > this.#limits.maxSkillsPerLoad) {
      throw new SkillLoaderError("SKILL_LIMIT_EXCEEDED", `Skill package count exceeds ${this.#limits.maxSkillsPerLoad}.`);
    }

    const packages: SkillPackage[] = [];
    for (const location of locations) {
      packages.push(await readFilesystemPackage(location, this.#limits));
    }
    return this.load(packages, selection);
  }

  get limits(): SkillLoaderLimits {
    return this.#limits;
  }
}

export function computeSkillDigest(manifest: SkillManifestInput, body: string): string {
  if (typeof body !== "string") {
    throw new SkillLoaderError("INVALID_SKILL_MANIFEST", "Skill body must be text.");
  }
  const normalized = normalizeManifest(manifest, DEFAULT_SKILL_LOADER_LIMITS);
  const payload = JSON.stringify({
    schemaVersion: normalized.schemaVersion,
    id: normalized.id,
    version: normalized.version,
    name: normalized.name,
    description: normalized.description,
    risk: normalized.risk,
    tags: normalized.tags ?? [],
    match: normalized.match ?? { tags: [], phrases: [] },
    body,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function normalizePackage(candidate: SkillPackage, limits: SkillLoaderLimits): ValidatedSkillPackage {
  if (!candidate || typeof candidate !== "object") {
    throw new SkillLoaderError("INVALID_SKILL_MANIFEST", "Skill package must be an object.");
  }
  const manifestBytes = serializedByteLength(candidate.manifest, "skill manifest");
  if (manifestBytes > limits.maxManifestBytes) {
    throw new SkillLoaderError("SKILL_TOO_LARGE", `Skill manifest exceeds ${limits.maxManifestBytes} bytes.`);
  }
  const manifest = normalizeManifest(candidate.manifest, limits);
  if (typeof candidate.body !== "string") {
    throw new SkillLoaderError("INVALID_SKILL_MANIFEST", `Skill ${manifest.id} body must be text.`);
  }
  const bodyBytes = byteLength(candidate.body);
  if (bodyBytes > limits.maxBodyBytes) {
    throw new SkillLoaderError("SKILL_TOO_LARGE", `Skill ${manifest.id} body exceeds ${limits.maxBodyBytes} bytes.`);
  }
  if (!candidate.provenance || (candidate.provenance.sourceKind !== "filesystem" && candidate.provenance.sourceKind !== "memory") || !SOURCE_REF.test(candidate.provenance.sourceRef)) {
    throw new SkillLoaderError("INVALID_SKILL_PROVENANCE", `Skill ${manifest.id} has invalid provenance.`);
  }

  const digest = computeSkillDigest(manifest, candidate.body);
  if (manifest.expectedDigest !== undefined && manifest.expectedDigest !== digest) {
    throw new SkillLoaderError("SKILL_DIGEST_MISMATCH", `Skill ${manifest.id}@${manifest.version} digest does not match its declared digest.`);
  }

  const normalizedManifest: SkillManifest = {
    schemaVersion: SKILL_SCHEMA_VERSION,
    id: manifest.id,
    version: manifest.version,
    name: manifest.name,
    description: manifest.description,
    risk: manifest.risk,
    ...(manifest.tags ? { tags: manifest.tags } : {}),
    ...(manifest.match ? { match: manifest.match } : {}),
    provenance: Object.freeze({
      sourceKind: candidate.provenance.sourceKind,
      sourceRef: candidate.provenance.sourceRef,
      digest,
    }),
  };

  return {
    manifest: normalizedManifest,
    body: candidate.body,
    provenance: candidate.provenance,
  };
}

function normalizeManifest(input: SkillManifestInput, limits: SkillLoaderLimits): SkillManifestInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SkillLoaderError("INVALID_SKILL_MANIFEST", "Skill manifest must be a JSON object.");
  }
  const record = input as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!MANIFEST_KEYS.has(key)) {
      throw new SkillLoaderError("INVALID_SKILL_MANIFEST", `Unknown skill manifest field: ${key}.`);
    }
  }
  if (record.schemaVersion !== SKILL_SCHEMA_VERSION) {
    throw new SkillLoaderError("INVALID_SKILL_MANIFEST", "Skill manifest schemaVersion must be 1.");
  }
  if (typeof record.id !== "string" || !SKILL_ID.test(record.id)) {
    throw new SkillLoaderError("INVALID_SKILL_ID", `Invalid skill ID: ${String(record.id)}.`);
  }
  if (typeof record.version !== "string" || !SEMVER.test(record.version)) {
    throw new SkillLoaderError("INVALID_SKILL_VERSION", `Invalid skill version for ${record.id}.`);
  }
  const name = boundedText(record.name, "name", limits.maxManifestBytes);
  const description = boundedText(record.description, "description", limits.maxManifestBytes);
  if (record.risk !== "context-only") {
    throw new SkillLoaderError("INVALID_SKILL_MANIFEST", `Skill ${record.id} must declare risk=context-only.`);
  }
  const tags = normalizeLabels(record.tags, "tags", limits.maxTags, record.id);
  const match = normalizeMatch(record.match, limits, record.id);
  let expectedDigest: string | undefined;
  if (record.expectedDigest !== undefined) {
    if (typeof record.expectedDigest !== "string" || !DIGEST.test(record.expectedDigest)) {
      throw new SkillLoaderError("INVALID_SKILL_MANIFEST", `Skill ${record.id} has an invalid expectedDigest.`);
    }
    expectedDigest = record.expectedDigest;
  }
  return {
    schemaVersion: SKILL_SCHEMA_VERSION,
    id: record.id,
    version: record.version,
    name,
    description,
    risk: "context-only",
    ...(tags ? { tags } : {}),
    ...(match ? { match } : {}),
    ...(expectedDigest ? { expectedDigest } : {}),
  };
}

function normalizeMatch(value: unknown, limits: SkillLoaderLimits, id: string): SkillMatch | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SkillLoaderError("INVALID_SKILL_MANIFEST", `Skill ${id} match must be an object.`);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!MATCH_KEYS.has(key)) {
      throw new SkillLoaderError("INVALID_SKILL_MANIFEST", `Unknown skill match field: ${key}.`);
    }
  }
  const tags = normalizeLabels(record.tags, "match.tags", limits.maxTags, id);
  const phrases = normalizeLabels(record.phrases, "match.phrases", limits.maxPhrases, id);
  if (!tags && !phrases) return undefined;
  return Object.freeze({
    ...(tags ? { tags } : {}),
    ...(phrases ? { phrases } : {}),
  });
}

function normalizeLabels(value: unknown, field: string, maxItems: number, id: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new SkillLoaderError("INVALID_SKILL_MANIFEST", `Skill ${id} ${field} must contain at most ${maxItems} labels.`);
  }
  const labels = value.map((item) => {
    if (typeof item !== "string" || item.length === 0 || item.length > 128 || byteLength(item) > MAX_STRING_BYTES) {
      throw new SkillLoaderError("INVALID_SKILL_MANIFEST", `Skill ${id} ${field} contains invalid text.`);
    }
    const normalized = item.trim().toLocaleLowerCase("en-US");
    if (normalized.length === 0) {
      throw new SkillLoaderError("INVALID_SKILL_MANIFEST", `Skill ${id} ${field} contains empty text.`);
    }
    return normalized;
  });
  if (new Set(labels).size !== labels.length) {
    throw new SkillLoaderError("INVALID_SKILL_MANIFEST", `Skill ${id} ${field} contains duplicates.`);
  }
  return Object.freeze([...labels].sort(compareStrings));
}

function boundedText(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || byteLength(value) > Math.min(maxBytes, MAX_STRING_BYTES)) {
    throw new SkillLoaderError("INVALID_SKILL_MANIFEST", `Skill manifest ${field} must be bounded text.`);
  }
  return value;
}

function normalizeAllowlist(entries: readonly SkillAllowlistEntry[]): ReadonlyMap<string, ReadonlySet<string>> {
  if (!Array.isArray(entries)) throw new SkillLoaderError("INVALID_ALLOWLIST", "Skill allowlist must be an array.");
  const result = new Map<string, ReadonlySet<string>>();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== "string" || !SKILL_ID.test(entry.id) || !Array.isArray(entry.versions) || entry.versions.length === 0) {
      throw new SkillLoaderError("INVALID_ALLOWLIST", "Each allowlist entry requires a valid ID and at least one version.");
    }
    if (result.has(entry.id)) throw new SkillLoaderError("INVALID_ALLOWLIST", `Duplicate allowlist ID: ${entry.id}.`);
    const versions = new Set<string>();
    for (const version of entry.versions) {
      if (typeof version !== "string" || !SEMVER.test(version) || versions.has(version)) {
        throw new SkillLoaderError("INVALID_ALLOWLIST", `Invalid or duplicate allowlisted version for ${entry.id}.`);
      }
      versions.add(version);
    }
    result.set(entry.id, versions);
  }
  return result;
}

function normalizeLimits(input: Partial<SkillLoaderLimits> | undefined): SkillLoaderLimits {
  const limits = { ...DEFAULT_SKILL_LOADER_LIMITS, ...(input ?? {}) };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new SkillLoaderError("INVALID_ALLOWLIST", `Skill loader limit ${name} must be a positive integer.`);
    }
  }
  return Object.freeze(limits);
}

function validateSelection(selection: SkillSelection, limits: SkillLoaderLimits): void {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
    throw new SkillLoaderError("INVALID_SKILL_SELECTION", "Skill selection must be an object.");
  }
  const ids = selection.ids;
  if (ids !== undefined) {
    if (!Array.isArray(ids) || ids.length > limits.maxSkillsPerLoad || ids.some((id) => typeof id !== "string" || !SKILL_ID.test(id)) || new Set(ids).size !== ids.length) {
      throw new SkillLoaderError("INVALID_SKILL_SELECTION", "Skill selection IDs must be unique valid IDs.");
    }
  }
  if (selection.tags !== undefined) {
    if (!Array.isArray(selection.tags) || selection.tags.length > limits.maxTags || selection.tags.some((tag) => typeof tag !== "string" || tag.trim().length === 0) || new Set(selection.tags.map((tag) => tag.trim().toLocaleLowerCase("en-US"))).size !== selection.tags.length) {
      throw new SkillLoaderError("INVALID_SKILL_SELECTION", "Skill selection tags must be unique non-empty text.");
    }
  }
  if (selection.text !== undefined && (typeof selection.text !== "string" || byteLength(selection.text) > limits.maxTextBytes)) {
    throw new SkillLoaderError("INVALID_SKILL_SELECTION", `Skill selection text exceeds ${limits.maxTextBytes} bytes.`);
  }
}

function matchesSelection(manifest: SkillManifest, selection: SkillSelection): boolean {
  const hasIds = Boolean(selection.ids?.length);
  const hasTags = Boolean(selection.tags?.length);
  const hasText = Boolean(selection.text?.trim());
  if (!hasIds && !hasTags && !hasText) return true;
  if (hasIds && selection.ids?.includes(manifest.id)) return true;
  if (hasTags) {
    const tags = new Set([...(manifest.tags ?? []), ...(manifest.match?.tags ?? [])]);
    if (selection.tags?.some((tag) => tags.has(tag.trim().toLocaleLowerCase("en-US")))) return true;
  }
  if (hasText) {
    const text = normalizeSearchText(selection.text ?? "");
    if (manifest.match?.phrases?.some((phrase) => text.includes(normalizeSearchText(phrase)))) return true;
  }
  return false;
}

async function readFilesystemPackage(location: SkillPackageLocation, limits: SkillLoaderLimits): Promise<SkillPackage> {
  const packageDir = path.join(location.root, location.id, location.version);
  const manifestPath = path.join(packageDir, "skill.json");
  const bodyPath = path.join(packageDir, "SKILL.md");
  const [manifestText, body] = await Promise.all([
    readBoundedUtf8(manifestPath, limits.maxManifestBytes),
    readBoundedUtf8(bodyPath, limits.maxBodyBytes),
  ]);
  let manifest: SkillManifestInput;
  try {
    manifest = JSON.parse(manifestText) as SkillManifestInput;
  } catch {
    throw new SkillLoaderError("INVALID_SKILL_MANIFEST", `Skill manifest is not valid JSON: ${manifestPath}.`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new SkillLoaderError("INVALID_SKILL_MANIFEST", `Skill manifest must be a JSON object: ${manifestPath}.`);
  }
  if (manifest.id !== location.id || manifest.version !== location.version) {
    throw new SkillLoaderError("INVALID_SKILL_MANIFEST", `Skill manifest identity does not match its package path: ${packageDir}.`);
  }
  return {
    manifest,
    body,
    provenance: {
      sourceKind: "filesystem",
      sourceRef: packageDir,
    },
  };
}

async function readDirectories(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { encoding: "utf8", withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => entry.name);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw error;
  }
}

async function readBoundedUtf8(filePath: string, maxBytes: number): Promise<string> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(filePath, "r");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new SkillLoaderError("SKILL_FILE_NOT_FOUND", `Skill file was not found: ${filePath}.`);
    throw error;
  }
  try {
    const initialStats = await handle.stat();
    if (!initialStats.isFile()) throw new SkillLoaderError("SKILL_NOT_A_FILE", `Skill path is not a regular file: ${filePath}.`);
    if (initialStats.size > maxBytes) throw new SkillLoaderError("SKILL_TOO_LARGE", `Skill file exceeds ${maxBytes} bytes: ${filePath}.`);
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(16 * 1024, maxBytes - total + 1));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      chunks.push(chunk.subarray(0, bytesRead));
      if (total > maxBytes) throw new SkillLoaderError("SKILL_TOO_LARGE", `Skill file exceeds ${maxBytes} bytes: ${filePath}.`);
    }
    try {
      return textDecoder.decode(Buffer.concat(chunks));
    } catch {
      throw new SkillLoaderError("INVALID_SKILL_ENCODING", `Skill file is not valid UTF-8: ${filePath}.`);
    }
  } finally {
    await handle.close();
  }
}

function validateRoots(roots: readonly string[]): void {
  if (!Array.isArray(roots) || roots.length === 0 || roots.some((root) => typeof root !== "string" || root.length === 0 || !path.isAbsolute(root))) {
    throw new SkillLoaderError("INVALID_SKILL_PROVENANCE", "Skill roots must be non-empty absolute paths.");
  }
  if (new Set(roots).size !== roots.length) throw new SkillLoaderError("INVALID_SKILL_PROVENANCE", "Skill roots must be unique.");
}

function freezeLoadedSkill(candidate: ValidatedSkillPackage): LoadedSkill {
  const provenance: SkillProvenance = Object.freeze({
    sourceKind: candidate.provenance.sourceKind,
    sourceRef: candidate.provenance.sourceRef,
    digest: candidate.manifest.provenance.digest,
  });
  const manifest = Object.freeze({
    ...candidate.manifest,
    provenance,
  });
  const context = Object.freeze({
    kind: "skill-context" as const,
    trust: "untrusted" as const,
    authority: "none" as const,
    skillId: manifest.id,
    skillVersion: manifest.version,
    digest: provenance.digest,
    content: candidate.body,
    grants: Object.freeze([]) as readonly [],
  });
  return Object.freeze({ manifest, body: candidate.body, context });
}

function isAllowlisted(allowlist: ReadonlyMap<string, ReadonlySet<string>>, id: string, version: string): boolean {
  return allowlist.get(id)?.has(version) ?? false;
}

function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function serializedByteLength(value: unknown, label: string): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new SkillLoaderError("INVALID_SKILL_MANIFEST", `${label} must be JSON-serializable.`);
  }
  if (serialized === undefined) {
    throw new SkillLoaderError("INVALID_SKILL_MANIFEST", `${label} must be JSON-serializable.`);
  }
  return byteLength(serialized);
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
