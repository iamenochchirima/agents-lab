# Hosted MCP quick-connect catalog research

Checked 2026-10-09. This research answers which services can appear in the
guided **Connectors → Add** catalog without asking the user to enter a server
URL or create an OAuth app themselves.

## What “ready to connect” means here

A candidate needs an official hosted MCP endpoint, OAuth authorization, and
metadata that the current Lab connection manager can use: an explicitly pinned
issuer, PKCE S256, a dynamic client registration endpoint, and a token endpoint
authentication method supported by the Lab (`none` or `client_secret_post`).
The provider must also permit clients like this Lab to register. OAuth alone is
not enough: some providers require the user to create an app, and some expose
DCR metadata while still limiting registrations to approved clients.

For the candidates below, I made read-only HTTP GET requests to the MCP endpoint
and its OAuth protected-resource and authorization-server metadata, then ran
the Lab's existing OAuth metadata discovery against the proposed endpoint,
issuer and scope set. I did **not** POST to a registration endpoint, start an
OAuth consent flow, or call account tools. Those actions either create provider
state or use a real account. Therefore these entries are metadata-compatible
and ready for the first user-initiated connection attempt; successful client
registration and a real tool call remain to be confirmed by connecting an
account.

## Guided catalog

| Service | Hosted MCP endpoint | What it is useful for | Notes for the first connection | Official provider documentation |
| --- | --- | --- | --- | --- |
| Notion | `https://mcp.notion.com/mcp` | Pages, databases and workspace search | Uses Notion's default MCP scope. | [Notion MCP](https://www.notion.com/help/notion-mcp) |
| Linear | `https://mcp.linear.app/mcp` | Issues, projects and comments | The default endpoint requests `read` and `write`; its docs describe read-only options, but this Lab entry follows the current endpoint challenge. | [Linear MCP](https://linear.app/docs/mcp) |
| Atlassian Rovo | `https://mcp.atlassian.com/v2/mcp` | Jira and Confluence search and updates | Starts with read scopes; write scopes are optional. | [Rovo MCP setup](https://developer.atlassian.com/cloud/rovo-mcp/guides/getting-started/) |
| monday.com | `https://mcp.monday.com/mcp` | Boards, items and work tracking | DCR is documented. A workspace admin may need to approve a new client and callback. | [monday.com MCP DCR](https://developer.monday.com/api-reference/docs/mcp-dynamic-client-registration) |
| Miro | `https://mcp.miro.com/` | Read and update team whiteboards | DCR and `boards:read` / `boards:write` are documented. User chooses a team; Enterprise administrators can restrict use. | [Miro MCP](https://developers.miro.com/docs/miro-mcp) · [connection guide](https://developers.miro.com/docs/connecting-to-miro-mcp) |
| Intercom | `https://mcp.intercom.com/mcp` | Support conversations and customer records | The general server is documented for US-hosted workspaces; the observed OAuth challenge requests `mcp` and `operator`. | [Intercom MCP](https://developers.intercom.com/docs/guides/mcp) |
| PostHog | `https://mcp.posthog.com/mcp` | Product analytics, queries, dashboards, flags and errors | OAuth routes to the account's region. AI-powered tools can incur PostHog AI spend if enabled in the workspace. | [PostHog MCP](https://posthog.com/docs/model-context-protocol) |
| New Relic (US) | `https://mcp.newrelic.com/mcp/` | Observability and telemetry investigation | The catalog entry is for the US region and requests read-only observability scopes. EU and Japan endpoints need additional catalog entries. | [New Relic MCP setup](https://docs.newrelic.com/docs/agentic-ai/mcp/setup/) |
| Cloudflare | `https://mcp.cloudflare.com/mcp` | Cloudflare accounts, DNS, Workers, R2 and security services | OAuth metadata advertises DCR and the service's authorization page lets users select account permissions. | [Cloudflare MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) |
| Cloudflare Observability | `https://observability.mcp.cloudflare.com/mcp` | Cloudflare logs and application analytics | Separate, focused endpoint from the broad Cloudflare API server; uses OAuth. | [Cloudflare MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) |
| Railway | `https://mcp.railway.com` | Projects, services and deployments | OAuth requires `workspace:member`; access follows the signed-in member's workspace permissions. | [Railway MCP](https://docs.railway.com/ai/mcp-server) |
| Supabase | `https://mcp.supabase.com/mcp` | Supabase projects, database and backend operations | The hosted OAuth flow selects the account/projects; metadata advertises DCR and a supported token method. | [Supabase MCP](https://supabase.com/docs/guides/ai-tools/mcp) · [MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication) |
| GitLab.com | `https://gitlab.com/api/v4/mcp` | GitLab project and repository workflows | GitLab.com MCP is beta. DCR can be disabled by an administrator; self-managed hosts are outside this fixed catalog entry. | [GitLab MCP server](https://docs.gitlab.com/user/model_context_protocol/mcp_server/) |
| Stripe | `https://mcp.stripe.com` | Stripe account and payments workflows | The server uses an `mcp` OAuth scope; inspect Stripe's consent page and keep write tools under review. | [Stripe MCP](https://docs.stripe.com/mcp) |
| WordPress.com | `https://public-api.wordpress.com/wpcom/v2/mcp/v1` | Sites, posts, comments and media | DCR and PKCE are supported. Plan eligibility applies, and WordPress uses content scopes that do not cleanly distinguish read from write. | [WordPress.com MCP](https://developer.wordpress.com/docs/mcp/) · [custom-client guide](https://developer.wordpress.com/docs/mcp/connect-custom-mcp-client/) |

The catalog selects trusted provider endpoints and issuers, not a fixed tool
list. After a user connects an account, the Lab discovers that server's current
tools; the user can then select tools and set their approval behavior. Provider
scopes, the account's own permissions, and the Lab's per-tool approvals are
separate controls. Do not treat one as a replacement for another.

## Good candidates that are not ready in this adapter

| Service | Why it is not in the guided catalog yet | Source |
| --- | --- | --- |
| Google Calendar | Google currently requires Workspace Developer Preview access, Google Cloud API setup and a manually created OAuth client. Its issuer metadata also has a trailing-slash mismatch with the resource metadata that the current exact-issuer check rejects. | [Google Calendar MCP setup](https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server) |
| Dropbox | It advertises DCR, but Dropbox limits registrations to a trusted MCP-client list and says new clients must request support. Agent Harness Lab is not listed. | [Dropbox MCP setup](https://help.dropbox.com/integrations/connect-dropbox-mcp-server?fallback=true) |
| Vercel | It advertises OAuth/DCR but says only reviewed and approved AI clients can connect; the Lab is not listed as approved. | [Vercel MCP](https://vercel.com/docs/agent-resources/vercel-mcp) |
| Figma | Its remote MCP service restricts clients to Figma's MCP Catalog and directs developers of new clients to a waitlist. | [Figma MCP introduction](https://developers.figma.com/docs/figma-mcp-server/) · [Figma MCP Catalog](https://www.figma.com/mcp-catalog/) |
| Airtable | Its server advertises DCR, but the protected-resource metadata names the host root while the MCP endpoint is `/mcp`; the Lab currently requires those resource identifiers to match and starts discovery with GET, which the endpoint does not accept. | [Airtable MCP server](https://support.airtable.com/articles/9897799762-using-the-airtable-mcp-server) |
| GitHub | The official remote MCP host guide requires a registered OAuth/GitHub app and says DCR is not supported. | [GitHub MCP host integration](https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md) |
| Asana and HubSpot | Their official connection guides require users to create an OAuth app and provide client credentials. | [Asana MCP OAuth](https://developers.asana.com/docs/connecting-mcp-clients-to-asanas-v2-server) · [HubSpot MCP setup](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server) |
| Slack | The official setup requires a Slack app's client ID and secret. | [Slack MCP server](https://docs.slack.dev/ai/slack-mcp-server) |
| Sentry | The live authorization metadata advertised a registration endpoint in this check, while the reviewed published setup/source guidance was not conclusive about general third-party DCR. Keep it out until a provider registration is verified. | [Sentry MCP](https://mcp.sentry.dev/) · [Sentry OAuth documentation](https://docs.sentry.io/api/auth/) |

## What this says about the adapter

The current connection layer is already useful for the providers with standard
remote MCP OAuth metadata. It does not need a separate tool implementation per
provider: each catalog entry supplies a trusted endpoint, issuer and initial
scope set, then the shared MCP adapter handles OAuth and tool discovery.

The main current boundary is the provider's OAuth registration and policy,
followed by exact resource/issuer metadata assumptions. Adding Google Calendar
would need a Google-specific OAuth client and issuer normalization or adapter;
adding Airtable needs the resource identity and initial challenge handling to
accept its documented endpoint behavior. Provider allowlists, such as Dropbox,
Vercel and Figma, cannot be fixed by changing catalog data alone.

## Sources and verification limits

Provider documentation above is primary-source documentation. The live
protected-resource and authorization-server metadata is served from each
provider's own endpoints and can change over time. The check covered metadata
discovery and compatibility with the Lab's current helper only. It did not test
provider-side DCR acceptance, account consent, tool discovery after consent,
or real read/write actions. First real connections should be tested through the
normal UI with a personal account, then tool definitions and write approvals
reviewed before using them for other work.
