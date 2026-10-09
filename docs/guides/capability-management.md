# Manage agent capabilities

Open the **Plugins** tab at the top of any platform workspace. This dedicated
page contains Connectors, Tools, Skills, Plugins and Profiles; the capability selector's
management link opens the same page. Connections, installed packages and profiles are
shared across the Lab's platform agents; their orchestration remains native.
Saving a supported integration requires no changes to a platform's agent loop
and no API restart.

## Local setup

The API stores managed configuration under `lab/state/capabilities` by default.
Set `AGENTLAB_CAPABILITY_STATE_ROOT` to change this infrastructure directory.
Only one API writer can own it at a time. State and credentials are local machine
data and must not be committed.

Configure `AGENTLAB_CREDENTIAL_KEY_HEX` with a private 32-byte hexadecimal key
before starting the API to save connection tokens, custom headers, OAuth secrets
or managed-process environment secrets. `AGENTLAB_CREDENTIAL_KEY_ID` defaults to
`primary`. Keep the encryption key outside the state directory and retain it for
restarts: losing it makes saved credentials unreadable. Without a configured key,
the UI disables credential entry; anonymous integrations remain available.

The local workspace opens capability management directly. No administrator token,
login or unlock step is required. The browser automatically establishes a local
session for request integrity; its cookie is HttpOnly and its CSRF value stays
in memory. Expiration and backend restarts renew the session automatically.
This is a single-user local workspace, not a hosted account system.

In development, Vite proxies browser `/api` requests to
`http://127.0.0.1:4318` by default. The browser stays on the frontend origin for
capability management, connections, model lookup, and platform/run requests. If
your API runs on another address, set `AGENTLAB_API_PROXY_TARGET` when starting
Vite. A deployed frontend needs an equivalent reverse proxy or an explicit API
URL and the allowed frontend origin.
Management requests are restricted to the local frontend. For a loopback
frontend, `localhost`, `127.0.0.1` and `[::1]` are accepted with the configured
scheme and port, so switching local hostnames does not break the UI. Other
origins and ports are not included. A hosted multi-user
deployment needs a separate authentication and authorization system.

If the capability service is unavailable, check that the Lab API is running at
the configured URL and choose **Try again**. A failed request does not mean the
saved connector list is empty. Local sessions renew automatically without a prompt.

Normal platform chats automatically receive tools from enabled, available shared
packages. A new chat captures that inventory; established runs keep the exact
capabilities admitted when they started. Controlled setup and comparison runs
can still select an explicit saved profile. A missing recorded profile is shown
as unavailable rather than silently switching to another selection.
Agent replies render Markdown lists, emphasis, links, code blocks and tables;
user messages retain their literal formatting.

## Connect an MCP server

The Connectors tab lists configured services as searchable cards. Click a card
to discover or refresh tools, edit the connection, or choose agent tools. Server
addresses and masked credential summaries are under **Connection details**;
disconnection and deletion are under **Disconnect or remove**. The Add dialog
starts with a name, server URL and authentication choice, with optional settings
behind **Advanced settings**.

1. Open **Connectors → Add** and enter a name and Streamable HTTP MCP
   URL, such as a local Memos instance's `/mcp` endpoint.
2. Choose no authentication, a personal access token, secret custom headers or
   OAuth. Credential inputs clear after submission, and the server stores only
   encrypted secret payloads plus references in configuration. When replacing a
   token, you can record its known expiration in local time; unknown expiration
   remains explicitly unknown. Safe summaries show presence, expiration and
   whether credentials are deployment-managed without revealing their values.
3. Save, open the connector card, then select **Discover tools**. Discovery validates the provider's
   advertised definitions; it does not grant permission based on its annotations.
4. Select **Choose tools**, enable the required tools, classify their effects and
   choose review on each action, approval before a run or automatic execution.
5. Attach the package to an agent profile in **Profiles**.

OAuth supports an existing client ID or `auto` registration discovery. Advanced
settings expose an optional client metadata URL, client secret and redirect URL.
Authorize the saved connection and return to refresh it. Provider support and
configuration determine which registration flow is available; entering a URL
does not guarantee that every MCP server's authentication is compatible.

Use **Refresh** after authentication or provider changes. **Disconnect** makes
the connection unavailable. Remove profile references and dependent packages
before deleting a connection. Saved credentials are bound to the owner,
connection and resource; changing a destination does not transfer an old token
to the new destination.

Network policy permits supported public destinations and local loopback services.
Private network hosts require the explicit comma-separated
`AGENTLAB_CAPABILITY_PRIVATE_HOSTS` deployment allowlist. Redirects and resolved
addresses are checked by the integration host. Do not expand that allowlist merely
to suppress an error from an unknown destination.

## Import skills and install bundles

In **Skills**, upload a ZIP containing a standard `SKILL.md` directory and its
resources, or select a Git repository at an exact commit. Supply an explicit
package ID and semantic version, preview the discovered skills, then install.
A single skill archive can have `SKILL.md` at its root; a collection can contain
one named directory per skill. Expand an installed skill and choose **Inspect instructions and files** to read
its actual `SKILL.md` and list its resource paths. Skill scripts remain resources
and are not executed by installation or the native agents.

In **Plugins**, import a Lab bundle with `lab-plugin.json`. It declares an exact
ID/version, packages, optional skill root, dependencies and required secrets.
Preview shows connection templates and required account credentials as well as
content and dependencies. Bounded archive extraction is checked before publication. This is a Lab declarative bundle format; foreign executable plugin
hooks are not silently accepted.

```json
{
  "schemaVersion": 1,
  "id": "meeting-skills",
  "version": "1.0.0",
  "skills": "skills",
  "dependencies": []
}
```

For this example, place skills under `skills/<skill-name>/SKILL.md` beside the
manifest. Installed packages initially remain disabled. Inspect them, supply any
needed connection credentials, then choose **Enable package** and add them to a
profile. Edit imported connection templates to authorize their accounts, or
rebind an MCP package to another saved connection in **Choose tools**. Installation
does not automatically give an agent authority.

## HTTP APIs and managed stdio

**Connections → Add an HTTP API integration** accepts explicit operation
definitions with methods, paths, schemas, risk and approval settings. It uses the
shared HTTP adapter rather than adding app-specific behavior to an agent runtime.

**Plugins → Managed stdio server** starts a server through the managed process
host. Provision the runtime and provider executable on the backend first, pin
the provider version, then provide that trusted executable and argument array.
Arguments are not a shell command; this form does not install npm packages or
execute plugin installation hooks. Optional environment credentials use separate variable/password
fields and are encrypted with a binding to this package and variable. The host
supplies its working directory under the capability state root. It does not give
the agent a native shell or filesystem tool. Existing managed server cards expose
**Choose tools** for tool selection and approval, and **Edit server** for command,
arguments and secret replacement. Editing preserves the package identity, bumps
its version and reuses saved secret references unless replaced.

The process host manages lifecycle and is not a sandbox. Process compatibility,
resource limits and administrator approval still apply.
Unavailable sources are reported as unavailable; a saved package is not proof of
a working transport or successful tool call.

## Compose a profile and run

Choose packages in **Profiles**, select tools and their approval rules, and choose
which available skills should be preloaded. Save the profile, select it on the
platform and start a run. **Duplicate** opens a new profile draft retaining its
packages, tools, approvals and skills, with a distinct name and version `1.0.0`;
saving it leaves the original profile unchanged. Both the capability catalog and profile selector refresh
without restarting the API.

Configuration writes check the current revision. If another edit wins first,
reload and review your changes before resubmitting. New runs use the published
generation. Existing runs retain admitted tool definitions and implementations;
credential revocation and connection authority changes still apply to them.
Keeping an old implementation is not permission to bypass current revocation.

To verify a connection with a real agent, use disposable resources: create one,
read it, update a specified field while preserving other content, then delete only
that resource and verify its absence. Inspect the run's tool calls and provider
readbacks rather than treating an agent's completion message as proof.

## Credential maintenance

Credential key rotation is an offline maintenance operation. Stop the API, supply
both old and new keys through `AGENTLAB_CREDENTIAL_KEYRING_JSON`, and run:

```sh
pnpm --filter @agent-harness-lab/lab-server exec tsx \
  src/capabilities/management/rotate-credentials.ts \
  ../../lab/state/capabilities/credentials new-key-id
```

The keyring maps key IDs to 64-character hexadecimal keys. Set the deployment's
current `AGENTLAB_CREDENTIAL_KEY_ID` to the new key before restarting. Retain the
old key until rotation and restart have succeeded; do not manually rewrite
encrypted credential records. Keep backups of keys separate from state backups.
