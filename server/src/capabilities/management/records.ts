import type { McpSourceOptions, HttpSourceOptions } from "../extensions/connected-sources.js";
import type { ToolRiskClass, ToolApprovalMode } from "../tools/contracts.js";

/** Administrative metadata contains references to credentials, never their values. */
export interface ManagedConnectionRecord {
  ref: string; displayName: string; provider: string; owner: "local-workspace";
  resource: string; scopes: string[]; enabled: boolean;
  auth: { kind: "anonymous" } | { kind: "static"; headersEnv: Record<string, string> }
    | { kind: "stored"; credentialRef: string }
    | { kind: "oauth"; clientId: string; redirectUri: string; clientMetadataUrl?: string; clientSecretEnv?: string; clientSecretRef?: string; tokenCredentialRef?: string;
        issuer?: string; authorizationEndpoint?: string; tokenEndpoint?: string; revocationEndpoint?: string;
        discovery?: { kind: "mcp"; allowedIssuers: string[]; protectedResourceMetadataUrl?: string } };
}
type Identity = { id: string; version: string; displayName?: string; enabled?: boolean; installationRef?: string };
export type ManagedPackageRecord = Identity & (
  | { source: "mcp"; endpoint: string; protocolVersion?: string; connectionRef?: string; trustedContext?: "session"; tools?: McpSourceOptions["tools"] }
  | { source: "http"; baseUrl: string; connectionRef?: string; operations: HttpSourceOptions["operations"] }
  | { source: "skills"; root: string }
  | { source: "stdio"; command: string; args: string[]; cwd?: string; envRefs?: Record<string, string>; envCredentialRefs?: Record<string, string>; protocolVersion?: string; tools?: McpSourceOptions["tools"] }
);
export interface ManagedProfileRecord {
  id: string; version: string; displayName: string; description?: string; packages: string[];
  tools?: { packageId?: string; name: string; enabled: boolean; riskClass: ToolRiskClass; approvalMode: ToolApprovalMode }[];
  skills?: string[];
}
export interface ManagedInstallationRecord { id: string; version: string; digest: string; root: string; packageIds: string[]; dependencies: { id: string; version: string }[]; installedAt: string }
/** A staged operation records intent before external work, without publishing partial configuration. */
export interface ManagedOperationRecord { id: string; kind: "install" | "remove" | "connect"; status: "staged" | "committed" | "abandoned"; resourceRef: string; startedAt: string; generation?: number }
export interface ManagedState {
  schemaVersion: 1; revision: number; connections: ManagedConnectionRecord[]; packages: ManagedPackageRecord[];
  profiles: ManagedProfileRecord[]; installations: ManagedInstallationRecord[]; operations: ManagedOperationRecord[];
}
export const MAX_MANAGED_STATE_BYTES = 2 * 1024 * 1024;
export function emptyManagedState(): ManagedState { return { schemaVersion: 1, revision: 0, connections: [], packages: [], profiles: [], installations: [], operations: [] }; }
const idPattern = /^[a-z][a-z0-9_-]{0,63}$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
function fail(message: string): never { throw new Error(`Invalid managed capability record: ${message}.`); }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected an object"); return value as Record<string, unknown>; }
function keys(value: Record<string, unknown>, allowed: string[]): void { if (Object.keys(value).some(key => !allowed.includes(key))) fail("unsupported field"); }
function text(value: unknown, max = 1024): asserts value is string { if (typeof value !== "string" || !value.length || value.length > max || /[\x00-\x1f]/.test(value)) fail("invalid bounded text"); }
function id(value: unknown): asserts value is string { text(value, 64); if (!idPattern.test(value)) fail("invalid identifier"); }
function version(value: unknown): void { text(value, 100); if (!versionPattern.test(value)) fail("exact semantic version required"); }
function url(value: unknown): void { text(value, 2048); let parsed: URL; try { parsed = new URL(value); } catch { fail("invalid HTTP URL"); } if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) fail("HTTP URL may not contain credentials or a fragment"); }
function array(value: unknown, max = 128): unknown[] { if (!Array.isArray(value) || value.length > max) fail("invalid bounded array"); return value; }
function strings(value: unknown, max = 128): string[] { const result = array(value, max); result.forEach(item => text(item, 256)); if (new Set(result).size !== result.length) fail("duplicate selection"); return result as string[]; }
function unique(values: unknown[], field: string): void { const ids = values.map(value => record(value)[field]); if (new Set(ids).size !== ids.length) fail("duplicate identifier"); }
function mapping(value: unknown, environment: boolean): void { const entries = Object.entries(record(value)); if (entries.length > 32) fail("too many credential references"); for (const [name, ref] of entries) { if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(name)) fail("invalid header name"); text(ref, 128); if (environment ? !/^[A-Z][A-Z0-9_]{0,127}$/.test(ref) : !idPattern.test(ref)) fail("invalid credential reference"); } }
function toolSelections(value: unknown): void {
  const selections = array(value); unique(selections, "name");
  for (const entry of selections) { const item = record(entry); keys(item, ["remoteName", "name", "riskClass", "limits", "approvalMode", "effectContract"]); text(item.remoteName, 128); text(item.name, 128); if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(item.name)) fail("invalid tool name"); risk(item.riskClass); if (item.approvalMode !== undefined) approval(item.approvalMode); if (item.limits !== undefined) { const limits = record(item.limits); keys(limits, ["timeoutMs", "maxArgumentBytes", "maxResultBytes"]); for (const val of Object.values(limits)) if (!Number.isSafeInteger(val) || Number(val) < 1 || Number(val) > 16 * 1024 * 1024) fail("invalid tool limit"); } if (item.effectContract !== undefined) { const contract = record(item.effectContract); keys(contract, ["rejectionErrorCodes"]); strings(contract.rejectionErrorCodes, 32); } }
}
function risk(value: unknown): void { if (!["pure", "read", "write", "external"].includes(String(value))) fail("invalid risk class"); }
function approval(value: unknown): void { if (!["automatic", "tool_grant", "invocation"].includes(String(value))) fail("invalid approval mode"); }
function path(value: unknown): void { text(value, 2048); if (value.includes("\0")) fail("invalid storage path"); }
function json(value: unknown, depth = 0): void {
  if (depth > 32) fail("JSON nesting exceeds limit");
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
  if (Array.isArray(value)) { for (const item of value) json(item, depth + 1); return; }
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) { for (const item of Object.values(value)) json(item, depth + 1); return; }
  fail("non-JSON metadata");
}
function stringMapping(value: unknown): void { const mapping = record(value); if (Object.keys(mapping).length > 64) fail("too many argument mappings"); for (const [key, argument] of Object.entries(mapping)) { text(key, 128); text(argument, 128); } }
function operationExtras(op: Record<string, unknown>): void {
  if (op.limits !== undefined) { const limits = record(op.limits); keys(limits, ["timeoutMs", "maxArgumentBytes", "maxResultBytes"]); for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 16 * 1024 * 1024) fail("invalid operation limit"); }
  if (op.bindings !== undefined) { const bindings = record(op.bindings); keys(bindings, ["path", "query", "headers", "body"]); for (const value of Object.values(bindings)) stringMapping(value); }
  if (op.requestEncoding !== undefined && !["json", "form"].includes(String(op.requestEncoding))) fail("invalid request encoding");
  if (op.idempotency !== undefined) { const value = record(op.idempotency); keys(value, ["header"]); text(value.header, 128); }
  if (op.pagination !== undefined) { const value = record(op.pagination); keys(value, ["cursorArgument", "cursorQuery", "nextCursorPath"]); text(value.cursorArgument, 128); text(value.cursorQuery, 128); strings(value.nextCursorPath, 16); }
  if (op.responseMapping !== undefined) { const value = record(op.responseMapping); keys(value, ["valuePath", "requestIdHeader"]); if (value.valuePath !== undefined) strings(value.valuePath, 16); if (value.requestIdHeader !== undefined) text(value.requestIdHeader, 128); }
  if (op.effectContract !== undefined) { const value = record(op.effectContract); keys(value, ["rejectionStatusCodes", "successConfirmsEffect"]); if (value.successConfirmsEffect !== undefined && typeof value.successConfirmsEffect !== "boolean") fail("invalid effect confirmation"); if (value.rejectionStatusCodes !== undefined) { const codes = array(value.rejectionStatusCodes, 32); if (new Set(codes).size !== codes.length || codes.some(code => !Number.isSafeInteger(code) || Number(code) < 400 || Number(code) > 599)) fail("invalid rejection status codes"); } }
}

/** Validate persisted input before publication or use. JSON size also bounds schemas and nested metadata. */
export function validateManagedState(value: unknown): asserts value is ManagedState {
  json(value);
  let bytes: string; try { bytes = JSON.stringify(value); } catch { fail("not JSON serializable"); } if (!bytes || Buffer.byteLength(bytes) > MAX_MANAGED_STATE_BYTES) fail("state exceeds size limit");
  const state = record(value); keys(state, ["schemaVersion", "revision", "connections", "packages", "profiles", "installations", "operations"]);
  if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || Number(state.revision) < 0) fail("invalid schema version or revision");
  const connections = array(state.connections, 64), packages = array(state.packages, 128), profiles = array(state.profiles, 128), installations = array(state.installations, 128), operations = array(state.operations, 256);
  unique(connections, "ref"); unique(packages, "id"); unique(profiles, "id"); unique(installations, "id"); unique(operations, "id");
  for (const value of connections) {
    const c = record(value); keys(c, ["ref", "displayName", "provider", "owner", "resource", "scopes", "enabled", "auth"]); id(c.ref); text(c.displayName, 160); text(c.provider, 160); if (c.owner !== "local-workspace" || typeof c.enabled !== "boolean") fail("invalid connection owner or enabled state"); url(c.resource); strings(c.scopes, 64);
    const auth = record(c.auth);
    if (auth.kind === "anonymous") keys(auth, ["kind"]);
    else if (auth.kind === "static") { keys(auth, ["kind", "headersEnv"]); mapping(auth.headersEnv, true); }
    else if (auth.kind === "stored") { keys(auth, ["kind", "credentialRef"]); id(auth.credentialRef); }
    else if (auth.kind === "oauth") { keys(auth, ["kind", "clientId", "redirectUri", "clientMetadataUrl", "clientSecretEnv", "clientSecretRef", "tokenCredentialRef", "issuer", "authorizationEndpoint", "tokenEndpoint", "revocationEndpoint", "discovery"]); text(auth.clientId, 512); url(auth.redirectUri); for (const field of ["issuer", "authorizationEndpoint", "tokenEndpoint", "revocationEndpoint", "clientMetadataUrl"]) if (auth[field] !== undefined) url(auth[field]); for (const field of ["clientSecretRef", "tokenCredentialRef"]) if (auth[field] !== undefined) id(auth[field]); if (auth.clientSecretEnv !== undefined && (typeof auth.clientSecretEnv !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/.test(auth.clientSecretEnv))) fail("invalid secret environment reference"); if (auth.clientSecretEnv && auth.clientSecretRef) fail("ambiguous client secret reference"); if (auth.discovery !== undefined) { const d = record(auth.discovery); keys(d, ["kind", "allowedIssuers", "protectedResourceMetadataUrl"]); if (d.kind !== "mcp") fail("invalid OAuth discovery kind"); strings(d.allowedIssuers, 16).forEach(url); if (d.protectedResourceMetadataUrl !== undefined) url(d.protectedResourceMetadataUrl); } }
    else fail("unsupported authentication kind");
  }
  const refs = new Set(connections.map(c => record(c).ref));
  for (const value of packages) {
    const p = record(value); id(p.id); version(p.version); if (p.displayName !== undefined) text(p.displayName, 160); if (p.enabled !== undefined && typeof p.enabled !== "boolean") fail("invalid package enabled state"); if (p.installationRef !== undefined) id(p.installationRef);
    const common = ["id", "version", "displayName", "enabled", "installationRef", "source"];
    if (p.source === "mcp") { keys(p, [...common, "endpoint", "protocolVersion", "connectionRef", "trustedContext", "tools"]); url(p.endpoint); if (p.protocolVersion !== undefined) text(p.protocolVersion, 32); if (p.trustedContext !== undefined && p.trustedContext !== "session") fail("invalid trusted context"); if (p.tools !== undefined) toolSelections(p.tools); }
    else if (p.source === "http") { keys(p, [...common, "baseUrl", "connectionRef", "operations"]); url(p.baseUrl); for (const op of array(p.operations)) { const o = record(op); keys(o, ["name", "method", "path", "inputSchema", "outputSchema", "description", "riskClass", "limits", "approvalMode", "bindings", "requestEncoding", "idempotency", "pagination", "responseMapping", "effectContract"]); text(o.name, 128); text(o.description, 8192); text(o.path, 2048); if (!String(o.path).startsWith("/") || String(o.path).startsWith("//") || !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(o.method))) fail("invalid HTTP operation"); record(o.inputSchema); if (o.outputSchema !== undefined) record(o.outputSchema); risk(o.riskClass); if (o.approvalMode !== undefined) approval(o.approvalMode); operationExtras(o); } unique(array(p.operations), "name"); }
    else if (p.source === "skills") { keys(p, [...common, "root"]); path(p.root); }
    else if (p.source === "stdio") { keys(p, [...common, "command", "args", "cwd", "envRefs", "envCredentialRefs", "protocolVersion", "tools"]); path(p.command); array(p.args, 64).forEach(arg => { if (typeof arg !== "string" || arg.length > 2048 || arg.includes("\0")) fail("invalid process argument"); }); if (p.cwd !== undefined) path(p.cwd); if (p.envRefs !== undefined) { const env = record(p.envRefs); if (Object.keys(env).length > 32) fail("too many process environment references"); for (const [name, ref] of Object.entries(env)) if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(name) || typeof ref !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/.test(ref)) fail("invalid process environment reference"); } if (p.envCredentialRefs !== undefined) { const env = record(p.envCredentialRefs); if (Object.keys(env).length > 32) fail("too many process credential references"); for (const [name, ref] of Object.entries(env)) if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(name) || typeof ref !== "string" || !idPattern.test(ref)) fail("invalid process credential reference"); } if (p.tools !== undefined) toolSelections(p.tools); }
    else fail("unsupported package source");
    if (p.connectionRef !== undefined && !refs.has(p.connectionRef)) fail("package connection is unknown");
  }
  const packageIds = new Set(packages.map(p => record(p).id));
  for (const value of profiles) { const p = record(value); keys(p, ["id", "version", "displayName", "description", "packages", "tools", "skills"]); id(p.id); version(p.version); text(p.displayName, 160); if (p.description !== undefined) text(p.description, 4096); if (strings(p.packages).some(ref => !packageIds.has(ref))) fail("profile package is unknown"); if (p.skills !== undefined) strings(p.skills, 64); if (p.tools !== undefined) { const selections = array(p.tools); unique(selections, "name"); for (const value of selections) { const t = record(value); keys(t, ["packageId", "name", "enabled", "riskClass", "approvalMode"]); if (t.packageId !== undefined && !packageIds.has(t.packageId)) fail("tool package is unknown"); text(t.name, 128); if (typeof t.enabled !== "boolean") fail("invalid tool selection"); risk(t.riskClass); approval(t.approvalMode); } } }
  for (const value of installations) { const i = record(value); keys(i, ["id", "version", "digest", "root", "packageIds", "dependencies", "installedAt"]); id(i.id); version(i.version); text(i.digest, 128); path(i.root); strings(i.packageIds); for (const value of array(i.dependencies, 64)) { const d = record(value); keys(d, ["id", "version"]); id(d.id); version(d.version); } if (typeof i.installedAt !== "string" || !Number.isFinite(Date.parse(i.installedAt))) fail("invalid installation timestamp"); }
  for (const value of operations) { const o = record(value); keys(o, ["id", "kind", "status", "resourceRef", "startedAt", "generation"]); id(o.id); id(o.resourceRef); if (!["install", "remove", "connect"].includes(String(o.kind)) || !["staged", "committed", "abandoned"].includes(String(o.status))) fail("invalid operation lifecycle"); if (typeof o.startedAt !== "string" || !Number.isFinite(Date.parse(o.startedAt))) fail("invalid operation timestamp"); if (o.generation !== undefined && (!Number.isSafeInteger(o.generation) || Number(o.generation) < 0)) fail("invalid operation generation"); }
}
