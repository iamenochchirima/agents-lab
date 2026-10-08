/** Browser administration uses a same-origin, short-lived cookie session.
 * The unlock token and CSRF value are held in memory, never browser storage.
 */
export type Risk = "pure" | "read" | "write" | "external";
export type Approval = "automatic" | "tool_grant" | "invocation";
export interface SafeCredentialSummary { present: boolean; kind?: string; expiresAt?: string | null; expirySource?: "user" | "provider" | null; externallyManaged?: boolean }
export interface ConnectionRecord {
  ref: string; displayName: string; provider: string; owner: "local-workspace"; resource: string; scopes: string[]; enabled: boolean;
  auth: { kind: "anonymous" } | { kind: "stored"; credentialRef: string } | { kind: "static"; headersEnv: Record<string, string> }
    | { kind: "oauth"; clientId: string; redirectUri: string; clientMetadataUrl?: string; issuer?: string; authorizationEndpoint?: string; tokenEndpoint?: string; discovery?: { kind: "mcp"; allowedIssuers: string[] } };
  status?: string; reason?: string | null; credential?: SafeCredentialSummary; clientCredential?: SafeCredentialSummary;
}
export interface ToolSelection { remoteName: string; name: string; riskClass: Risk; approvalMode?: Approval }
export interface ToolManifest { name: string; description?: string; inputSchema?: Record<string, unknown> }
export interface PackageRecord {
  id: string; version: string; displayName?: string; enabled?: boolean; source: "mcp" | "http" | "skills" | "stdio";
  connectionRef?: string; endpoint?: string; baseUrl?: string; root?: string; protocolVersion?: string;
  tools?: ToolSelection[]; envCredentialRefs?: Record<string, string>; operations?: Record<string, unknown>[]; command?: string; args?: string[];
  skills?: { name: string; description?: string }[];
}
export interface ProfileRecord { id: string; version: string; displayName: string; description?: string; packages: string[]; tools?: { packageId?: string; name: string; enabled: boolean; riskClass: Risk; approvalMode: Approval }[]; skills?: string[] }
export interface InstallationRecord { id: string; version: string; digest: string; root: string; packageIds: string[]; dependencies: { id: string; version: string }[]; installedAt: string }
export interface ManagementState {
  revision: number; connections: ConnectionRecord[]; packages: PackageRecord[]; profiles: ProfileRecord[]; installations: InstallationRecord[];
  credentialStorageAvailable: boolean; discovery?: Record<string, ToolManifest[]>;
  packageSkills?: Record<string, { name: string; description?: string }[]>;
  skillsByPackage?: Record<string, { id?: string; name: string; description?: string }[]>;
  capabilitiesByPackage?: Record<string, { name: string; description?: string; riskClass: Risk; approvalMode?: Approval }[]>;
  stdioAvailable?: boolean;
}
export type CredentialInput = { kind: "personal-access-token"; token: string; expiresAt?: string; expirySource?: "user" | "provider" } | { kind: "static-headers"; headers: Record<string, string> } | { kind: "oauth-client"; clientId: string; clientSecret: string };
export interface Session { csrfToken: string; owner: string; expiresAt: string }
export interface SkillInspection { name: string; description: string; content: string; files: string[] }
export interface InstallInput { archiveBase64?: string; repositoryUrl?: string; commit?: string; id?: string; version?: string }
export interface InstallationPreview { id?: string; version?: string; kind?: string; connections?: ConnectionRecord[]; packages?: { id: string; source?: string }[]; dependencies?: { id: string; version: string }[]; skills?: { name: string; description?: string }[]; warnings?: string[]; [key: string]: unknown }
let csrfToken: string | null = null;
export class ManagementApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "ManagementApiError"; }
}
async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/management${path}`, { method, credentials: "same-origin", headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(csrfToken && method !== "GET" ? { "X-Agentlab-Csrf": csrfToken } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) csrfToken = null;
    const message = result && typeof result === "object" && "message" in result && typeof result.message === "string" ? result.message : result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : response.status === 409 ? "Configuration changed. Reload and try again." : response.status === 401 ? "Unlock capability management to continue." : "Capability management request failed.";
    throw new ManagementApiError(message, response.status);
  }
  return result as T;
}
export async function getManagementSession(): Promise<Session> { const session = await request<Session>("/session"); csrfToken = session.csrfToken; return session; }
export async function unlockManagement(token: string): Promise<Session> { const session = await request<Session>("/session", "POST", { token }); csrfToken = session.csrfToken; return session; }
export function getManagementState(): Promise<ManagementState> { return request("/state"); }
export function getSkillInspection(packageId: string, name: string): Promise<SkillInspection> { return request(`/packages/${encodeURIComponent(packageId)}/skills/${encodeURIComponent(name)}`); }
export function saveConnection(expectedRevision: number, connection: ConnectionRecord, credential?: CredentialInput): Promise<ManagementState> { return request("/connections", "POST", { expectedRevision, connection, ...(credential ? { credential } : {}) }); }
export function deleteConnection(ref: string, expectedRevision: number): Promise<ManagementState> { return request(`/connections/${encodeURIComponent(ref)}`, "DELETE", { expectedRevision }); }
export function connectionAction(ref: string, action: "discover" | "connect" | "refresh" | "revoke", expectedRevision: number): Promise<{ state: ManagementState; authorizationUrl?: string; tools?: ToolManifest[] }> { return request(`/connections/${encodeURIComponent(ref)}/${action}`, "POST", { expectedRevision }); }
export function savePackage(expectedRevision: number, capabilityPackage: PackageRecord, environment?: Record<string, string>): Promise<ManagementState> { return request("/packages", "POST", { expectedRevision, package: capabilityPackage, ...(environment ? { environment } : {}) }); }
export function deletePackage(id: string, expectedRevision: number): Promise<ManagementState> { return request(`/packages/${encodeURIComponent(id)}`, "DELETE", { expectedRevision }); }
export function saveProfile(expectedRevision: number, profile: ProfileRecord): Promise<ManagementState> { return request("/profiles", "POST", { expectedRevision, profile }); }
export function deleteProfile(id: string, expectedRevision: number): Promise<ManagementState> { return request(`/profiles/${encodeURIComponent(id)}`, "DELETE", { expectedRevision }); }
export function previewInstallation(input: InstallInput): Promise<InstallationPreview> { return request("/installations/preview", "POST", input); }
export function installPackage(expectedRevision: number, input: InstallInput): Promise<ManagementState> { return request("/installations", "POST", { expectedRevision, ...input }); }
export function deleteInstallation(id: string, expectedRevision: number): Promise<ManagementState> { return request(`/installations/${encodeURIComponent(id)}`, "DELETE", { expectedRevision }); }
