import type { ConnectionRecord } from "./managementApi";

export type ConnectorAccess = "read" | "read_write";

export interface GuidedConnectorPreset {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly category: string;
  readonly resource: string;
  readonly issuer: string;
  readonly description: string;
  readonly readOnlyAvailable: boolean;
  readonly readAccessLabel: string;
  readonly writeAccessLabel: string;
  readonly accessNote?: string;
  readonly baseScopes: readonly string[];
  readonly writeScopes: readonly string[];
  readonly documentationUrl: string;
}

/**
 * Services in this catalog have a hosted Streamable HTTP MCP endpoint and
 * OAuth metadata that supports client registration by the Lab. Their actual
 * tool definitions are always discovered from the provider after authorization.
 */
export const guidedConnectorCatalog: readonly GuidedConnectorPreset[] = [
  {
    id: "notion",
    name: "Notion",
    provider: "Notion",
    category: "Notes and documents",
    resource: "https://mcp.notion.com/mcp",
    issuer: "https://mcp.notion.com",
    description: "Search and work with pages and databases in your Notion workspace.",
    readOnlyAvailable: false,
    readAccessLabel: "Read-only",
    writeAccessLabel: "Notion workspace access",
    accessNote: "Notion uses one default OAuth scope for its MCP connection. Review the access request on Notion's consent page. Each write action still needs your review in the Lab.",
    baseScopes: ["default"],
    writeScopes: [],
    documentationUrl: "https://www.notion.com/help/notion-mcp",
  },
  {
    id: "linear",
    name: "Linear",
    provider: "Linear",
    category: "Project management",
    resource: "https://mcp.linear.app/mcp",
    issuer: "https://mcp.linear.app",
    description: "Connect your workspace to find and update issues, projects, and comments.",
    readOnlyAvailable: false,
    readAccessLabel: "Read-only",
    writeAccessLabel: "Read and write access",
    accessNote: "The hosted endpoint asks for both read and write scopes. Linear documents read-only options, but the Lab currently follows this endpoint's request. Each write action still needs your review.",
    baseScopes: ["read", "write"],
    writeScopes: [],
    documentationUrl: "https://linear.app/docs/mcp",
  },
  {
    id: "atlassian-rovo",
    name: "Atlassian Rovo",
    provider: "Atlassian",
    category: "Jira and Confluence",
    resource: "https://mcp.atlassian.com/v2/mcp",
    issuer: "https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3",
    description: "Search Jira and Confluence, with optional permission to create and edit content.",
    readOnlyAvailable: true,
    readAccessLabel: "Read-only",
    writeAccessLabel: "Read and make changes",
    baseScopes: [
      "read:me",
      "read:account",
      "offline_access",
      "read:jira:agent-interface",
      "search:jira:agent-interface",
      "read:confluence:agent-interface",
      "search:confluence:agent-interface",
      "search:rovo:agent-interface",
      "search:code:agent-interface",
    ],
    writeScopes: ["write:jira:agent-interface", "write:confluence:agent-interface"],
    documentationUrl: "https://developer.atlassian.com/cloud/rovo-mcp/guides/getting-started/",
  },
];

export function scopesForConnector(preset: GuidedConnectorPreset, access: ConnectorAccess): string[] {
  return [...new Set([...preset.baseScopes, ...(access === "read_write" ? preset.writeScopes : [])])];
}

export function connectionForConnector(
  preset: GuidedConnectorPreset,
  access: ConnectorAccess,
  ref: string,
  displayName: string,
  origin: string,
): ConnectionRecord {
  return {
    ref,
    displayName,
    provider: preset.provider,
    owner: "local-workspace",
    resource: preset.resource,
    scopes: scopesForConnector(preset, access),
    enabled: true,
    auth: {
      kind: "oauth",
      clientId: "auto",
      redirectUri: `${origin}/api/management/connections/${ref}/callback`,
      issuer: preset.issuer,
      discovery: { kind: "mcp", allowedIssuers: [preset.issuer] },
    },
  };
}
