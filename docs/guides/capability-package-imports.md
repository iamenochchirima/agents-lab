# Import skills and plugin bundles

Capability installations belong to the integration host. Imported instructions
grant no tools or credentials. Installation returns disabled source definitions;
an administrator separately connects accounts and selects capabilities in a
profile. Imported scripts remain inspectable resources and are never run by the
installer.

## Standard skill archives

Upload a ZIP containing a standard skill directory with its `SKILL.md`, references,
assets and scripts. A single skill's `SKILL.md` may also sit at the ZIP root. Give
the import an explicit package ID and exact semantic version. The skill's
frontmatter name must match its directory, as required by the existing Lab skill
loader. A wrapper directory such as the one in a GitHub download is accepted.

The original resources remain beside their skill. Catalog discovery exposes names
and descriptions; full procedures and resources load progressively. Explicit
profile selection can activate a chosen skill before the model's first decision.

## Lab plugin format

A plugin ZIP has `lab-plugin.json` at its root:

```json
{
  "schemaVersion": 1,
  "id": "notes-kit",
  "version": "1.0.0",
  "skills": "skills",
  "packages": [
    {
      "id": "notes-kit-provider",
      "version": "1.0.0",
      "source": "mcp",
      "endpoint": "https://notes.example/mcp",
      "connectionRef": "notes-kit-account"
    }
  ],
  "connections": [
    {
      "ref": "notes-kit-account",
      "displayName": "Notes account",
      "provider": "Notes",
      "owner": "local-workspace",
      "resource": "https://notes.example/mcp",
      "scopes": [],
      "enabled": false,
      "auth": { "kind": "anonymous" }
    }
  ],
  "dependencies": [],
  "requiredSecrets": [
    {
      "name": "notes-token",
      "description": "Enter the provider token separately when connecting notes."
    }
  ]
}
```

Place skills under `skills/<skill-name>/SKILL.md`. The `packages` array contains
MCP or HTTP source templates using the Lab package schema. Template IDs and
connection references start with the plugin ID followed by a hyphen. A source
can name only a connection template declared in the same bundle. Connection
templates are disabled, anonymous and owned by the local workspace. MCP endpoints
match their connection resource; HTTP base URLs use the same origin. Templates
cannot carry credential values or enable themselves. Required secrets declare
only names and descriptions. Administrators fill them through connection setup,
never an imported manifest.

Installation prepares the declared connections alongside tools and skills.
Updating a bundle preserves an already configured account with the same reference;
it must not replace that account's authentication with the anonymous template.

Dependencies declare exact installation IDs and versions. Import fails when a
dependency is missing, has another version, creates a cycle or when an update
would break an installed dependent. There is no automatic dependency download.
Preview lists the manifest, file inventory, skill metadata and required secrets.

The first Lab format does not execute installation hooks, package manager
commands or shell scripts. Claude Code, Codex, Pi and OpenCode plugin manifests
are not silently reinterpreted as Lab plugins. Unsupported fields fail explicitly.

## Pinned repository import

Repository imports require a credential-free HTTPS URL and a full 40- or 64-digit
commit hash. An optional relative subdirectory selects a package inside that
commit. HTTP is permitted only for explicit loopback development servers. Git
file and SSH transports, embedded passwords, query parameters and branch names
are rejected.

The host fetches the pinned commit into staging and uses `git archive` to inspect
its files. Hooks, global Git configuration, interactive authentication and inherited
backend credentials and HTTP redirects are disabled. Git must be installed on the backend. Each Git
operation has a 60-second timeout; temporary repository data is removed afterward.
Private-repository authentication and isolated disk quotas are not implemented by
this importer. Git's own network stack does not use the integration adapter's DNS
pinning. Use administrator-approved repository origins; this importer is not an
isolated fetch service for untrusted arbitrary repositories.

## Limits and installation lifecycle

ZIP import accepts stored or deflated entries, with at most 8 MiB compressed,
16 MiB expanded, 1,024 entries and 256 KiB per file. It validates central and local
headers, entry checksums, bounded expansion, UTF-8 filenames and relative paths.
Encryption, ZIP64, multi-disk archives, symbolic links, special files and traversal
paths are rejected. Runtime skill discovery applies its own depth and metadata
limits after extraction.

The host installs content beneath its SHA-256 digest, with read-only files.
Reinstalling identical content is reusable. Reusing an exact ID/version for
different content is rejected; publish a new version instead. Origin, manifest and
digest remain in the immutable installation's `.lab-installation.json`. A
successful update gets a separate digest directory. Removing an installation
from active configuration does not delete content needed by earlier runs.
Publication of package definitions belongs to the management repository, after
content preparation succeeds.

These controls prevent archive extraction and accidental execution hazards.
They do not establish that imported instructions are trustworthy. Inspect the
preview before attaching a skill or tools to an agent.
