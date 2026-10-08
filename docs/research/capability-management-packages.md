# Capability management: skills and plugin packages

Research date: 2026-10-08. This note informs the frontend capability-management plan. It records current implementation facts separately from proposed changes. No package installer or execution host was implemented during this research.

## What established agents do

### Portable skills

A standard skill is a directory containing `SKILL.md`, with required `name` and `description` frontmatter. Optional `references/`, `assets/`, and `scripts/` directories carry additional material. Clients expose metadata first, load instructions when a skill activates, and read resources as needed. The specification leaves script-language support to each agent implementation. `allowed-tools` is experimental, so importers must state how they interpret it. The standard has optional compatibility and metadata fields; it does not require a package version or prescribe a plugin dependency resolver. [Agent Skills specification](https://agentskills.io/specification)

### Claude Code

Claude Code bundles skills, MCP definitions, hooks and other components under plugin identity. Its manifest supports version and dependency declarations, namespaces components, and validates component paths against the plugin root. A plugin can declare configuration fields that users fill in when enabling it. Non-sensitive settings go into ordinary settings; sensitive values go into the platform's secure credential store. Sensitive substitutions in skill instructions become placeholders. Install directories and persistent plugin data have different lifecycles. These are useful patterns for the Lab, rather than a reason to adopt Claude's entire executable plugin API. [Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference)

### Pi

Pi packages group extensions, skills, prompts and themes. Installation supports npm, Git and local paths; versioned npm specifications and Git tags or commits are pinned. Packages can declare runtime dependencies, while host-provided modules belong in peer dependencies. Package filters narrow which declared resources load. Pi explicitly identifies executable extensions and skills that instruct models to run programs as trust concerns, and resolves project trust before loading project packages. It also gives packages stable identities to avoid loading equivalent declarations twice. [Pi package documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md)

### OpenCode

OpenCode plugins are executable JavaScript or TypeScript functions. They can add tools and subscribe to lifecycle events. Configured npm plugins and dependencies are installed through Bun and cached; local plugins use project or global directories. Its plugin context includes a shell API. This demonstrates that a code plugin is a different execution boundary from an imported skill or declarative MCP connection. Copying this model into a backend API process would confer executable access that a schema validator alone cannot contain. The last sentence is our architectural interpretation. [OpenCode plugin documentation](https://opencode.ai/docs/plugins/)

These examples establish recurring patterns, not a survey proving universal industry practice.

## What the Lab already has

| Existing component | Observed behavior | Gap for frontend management |
| --- | --- | --- |
| [Extension skill loader](../../server/src/capabilities/extensions/skills.ts) | Parses standard YAML frontmatter, requires matching directory names, confines resources, rejects symlinks, bounds reads, and verifies instruction/resource digests. Generates list/load/resource tools. Scripts are readable resources and never executed. | Import/staging, compatibility reporting, stored installation identity, per-profile skill selection and uninstall lifecycle. |
| [Package loader](../../server/src/capabilities/extensions/packages.ts) | Accepts exact package versions and skills/MCP/HTTP sources from trusted server JSON; composes profiles by whole package; rejects native workspace packages. | Browser input needs a validated management service before it reaches admission. Mutable records, dependency bundles, individual tool policy and durable publication are missing. |
| [Plugin manifest validator](../../server/src/capabilities/plugins/manifest.ts) | Validates allowlisted `local_builtin` identities, capability declarations, permissions and resource-limit metadata. Its contract explicitly excludes loading or executing modules. | It is not a third-party bundle installer. Manifest limits are not an operating-system sandbox or measured execution guarantees. |
| [Legacy skill loader](../../server/src/capabilities/skills/loader.ts) | Uses Lab-specific `skill.json` plus `SKILL.md`, allowlisted versions and digests. | Avoid making this format a prerequisite for standard Agent Skills import. |

Internal package storage is infrastructure. It does not require adding filesystem tools to native agent runtimes.

## Recommended implementation decisions

The following are proposals informed by the sources and code inspection.

1. Separate installed assets, configured connections, and profile activation. Installing a plugin records available components; enabling it attaches selected components to an agent. Neither action should silently approve tool writes or connect external accounts.
2. Store immutable package revisions with declared identity/version, source URL or upload provenance, resolved Git commit when applicable, content digest, compatibility results and component inventory. Keep writable application state outside installed revisions. A changed digest under the same declared version is a distinct revision.
3. Start with a documented Lab declarative bundle format containing standard skills, MCP/HTTP connection templates, required configuration fields and dependencies. Templates reference connection slots and opaque credential identifiers. They never carry actual tokens or claim authority.
4. Permit frontend upload of skill directories as bounded archives and plugin bundles. Stage and inspect before activation. Reject escaping paths, symlinks, duplicate identities and excessive expansion. Display unsupported requirements before users attach a skill. Preserve license, compatibility and metadata fields even when the runtime does not interpret them.
5. Resolve declared dependencies to exact installed revisions. Reject missing dependencies, cycles and incompatible versions before publishing. First scope can require exact versions, avoiding an unneeded general package-registry resolver. A preview must include transitive components and required connections. Uninstall reports dependent profiles/plugins and does not silently break them.
6. Treat skill `allowed-tools` as a compatibility declaration, never permission granted by imported text. Tool access and approval remain application-owned profile policy. Preserve progressive loading and the existing untrusted skill-context projection.
7. Distinguish credential field declarations from values. Sensitive fields use masked input and server-side secret storage; frontend reads return only configured status and references. Inject secrets solely into the selected connection or managed process, never skill instructions, generic plugin metadata or run evidence. Existing credential-storage research should choose the concrete provider and ownership model.
8. Retain active runs' admitted package digests and catalogs. Updates publish a new revision for future admissions; they do not rewrite old run manifests. Revocation and disconnection are separate operational controls and can stop future calls even when a historical snapshot is retained.
9. Support executable requirements through a separate managed execution host when implemented. A skill script and an MCP stdio server both need explicit runtime, environment, network and secret grants. Archive import must not run installation hooks. Do not dynamically import uploaded code into the API or add native agent filesystem access.

## Delivery scope and practical validation

The first frontend delivery should install declarative bundles and standard skills, configure HTTP MCP connections, save connection credentials, select individual tools/skills in profiles, and publish changes without a restart. Imported executable hooks, npm lifecycle scripts and skill script execution must show as unsupported until their execution host exists. Managed stdio can then use that host while retaining the same profile and credential contracts.

Use a few meaningful checks: import one ordinary skill with a reference, reject an escaping archive entry, install a two-bundle dependency chain and reject one missing/cyclic dependency, enable only selected components, update a revision without changing an existing run, and confirm secret values never appear in API reads or run records. The browser acceptance path should connect Memos, import a notes procedure, attach both to a profile, and demonstrate discovery/selection without restarting the API. Real-model execution is a separate explicitly scoped acceptance step.

## Remaining choices for the implementation plan

- First import sources: uploaded archive immediately; Git repository import with pinned commit is useful but adds acquisition and network policy.
- Compatibility adapters: accepting Claude/Pi metadata can reduce repackaging, but executable hooks cannot be claimed compatible until supported. Document supported components and reject unsupported ones explicitly.
- Package version policy: exact dependencies initially; semver ranges later only if concrete packages need them.
- Credential scope: connection owner and workspace membership must be explicit before shared or multi-user deployment. Desktop keychain patterns are examples, not a backend tenant-isolation design.
