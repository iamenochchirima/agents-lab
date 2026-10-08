import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { gradeExtension, type ExtensionInput } from "../../evals/extension-contracts.js";

const identity = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const ceiling = 256 * 1024;
/** Read only the named, bounded native acceptance envelopes. Raw provider payloads
 * remain in run evidence; this projection never follows arbitrary source references.
 */
export async function readExtensionEvidence(runsRoot: string, secrets: readonly string[] = []) {
  const root = resolve(runsRoot), index = join(root, ".review-proof");
  const envelopes: { invocationId: string; completedAt: string; revision: string | null; metadata: Record<string, unknown>; reports: ReturnType<typeof gradeExtension>[] }[] = [];
  const issues: string[] = [];
  let scanTruncated = false;
  try {
    const info = await lstat(index);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Extension evidence index must be a real directory.");
    const realRoot = await realpath(root), realIndex = await realpath(index);
    if (!inside(realRoot, realIndex)) throw new Error("Extension evidence index escaped the run root.");
    const directory = await opendir(index);
    let scanned = 0;
    for await (const entry of directory) {
      if (++scanned > 200) { scanTruncated = true; break; }
      if (!entry.isDirectory() || !identity.test(entry.name)) continue;
      const path = join(index, entry.name, "extensions.json");
      try {
        const parent = await lstat(join(index, entry.name));
        if (!parent.isDirectory() || parent.isSymbolicLink() || !inside(realIndex, await realpath(path))) continue;
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size > ceiling) throw new Error("Invalid extension evidence size.");
          const buffer = Buffer.alloc(ceiling + 1);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          if (bytesRead > ceiling) throw new Error("Extension evidence grew beyond its limit.");
          const value: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
          if (!record(value) || value.schemaVersion !== 1 || value.mode !== "scripted-native" || !record(value.metadata) || !validDate(value.metadata.completedAt) || !Array.isArray(value.reports) || value.reports.length > 32) throw new Error("Incomplete or invalid native extension envelope.");
          const seen = new Set<string>();
          const reports = value.reports.map((item: unknown) => {
            if (!record(item)) throw new Error("Invalid extension report.");
            const projected = gradeExtension(item as unknown as ExtensionInput);
            if (projected.verdict !== item.verdict || JSON.stringify(projected.missingChecks) !== JSON.stringify(item.missingChecks)) throw new Error("Extension verdict does not match retained assertions.");
            const key = `${projected.platform}:${projected.caseId}`;
            if (seen.has(key)) throw new Error("Duplicate extension report identity."); seen.add(key);
            return { ...projected, deployment: sanitize(projected.deployment, secrets), reason: sanitize(projected.reason, secrets), observations: projected.observations.map(observation => ({...observation, sources: observation.sources.map(source => sanitize(source, secrets))})) };
          });
          envelopes.push({invocationId: entry.name, completedAt: String(value.metadata.completedAt), revision: typeof value.metadata.revision === "string" && /^[a-f0-9]{40}$/.test(value.metadata.revision) ? value.metadata.revision : null, metadata: sanitizeMetadata(value.metadata, secrets) as Record<string, unknown>, reports});
        } finally { await handle.close(); }
      } catch (error) {
        if (!hasCode(error, "ENOENT")) issues.push(`${entry.name}: extension evidence is incomplete, malformed or unavailable.`);
      }
    }
  } catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
  envelopes.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  return { envelopes, issues, scanTruncated };
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function validDate(value: unknown): boolean { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function inside(root: string, path: string): boolean { const difference = relative(root, path); return difference !== ".." && !difference.startsWith("../") && !difference.startsWith("/"); }
function hasCode(error: unknown, code: string): boolean { return record(error) && error.code === code; }
function sanitize(value: string, secrets: readonly string[]): string { let result = value.slice(0, 4096); for (const secret of secrets.filter(Boolean)) result = result.split(secret).join("[REDACTED]"); return result; }

/** Envelope controls and SDK versions are provenance; preserve them beside checks. */
function sanitizeMetadata(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return sanitize(value, secrets);
  if (Array.isArray(value)) return value.map(item => sanitizeMetadata(item, secrets));
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeMetadata(item, secrets)]));
  return value;
}
