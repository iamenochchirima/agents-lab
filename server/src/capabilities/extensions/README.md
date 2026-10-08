# Extensible capability execution

This module loads trusted capability packages, freezes the selected tool catalog
and executes source operations behind an authenticated host. Native agent loops
still own model decisions and tool sequencing. Adding a configured tool or skill
does not require adding another tool-name branch to those loops.

Start with the [usage guide](../../../../docs/guides/capability-packages.md),
[architecture](../../../../docs/architecture/extensible-capabilities.md) and
[source research](../../../../docs/research/extensible-agent-capabilities.md).
The [example package configuration](../../../capability-packages/example.json)
provides five workspace tools and three skill tools.

| File | Responsibility |
| --- | --- |
| `packages.ts` | Validate server-owned JSON configuration and compose explicit package profiles |
| `workspace.ts` | List/read/search task data and write/patch scoped output files; optionally clone a bounded template per session |
| `skills.ts` | Parse portable YAML frontmatter, list metadata and load selected instructions/resources with digest checks |
| `connected-sources.ts` | Discover configured MCP tools or bind explicit HTTP operations and retain rich results |
| `contracts.ts` | Serializable descriptor, snapshot and host-call records |
| `schema.ts` | JSON Schema validation without argument coercion or network reference loading |
| `projection.ts` | Declarations and validation for native orchestration code; no external I/O |
| `runtime.ts` | Execute built-ins locally or call the authenticated host from the native I/O boundary |
| `host.ts` | Recheck admitted authority/source identity, reserve call identities and retain execution receipts |

The host reads the retained run manifest rather than trusting runtime declarations.
A completed receipt with the same fingerprint replays its result. A changed call
under the same identity is rejected. A pending receipt after interruption returns
unknown and is not redispatched. This bounds duplicate execution; it does not
establish exactly-once effects across an arbitrary external service.

Tools retain their admitted schemas, package identities, bindings, limits and
failure policies. Known read failures can provide corrective model feedback.
Unknown effects stop execution. Skills add instructions and resources, not grants.
Scripts in skill packages are readable resources, not automatically executable code.
Loaded instructions and UTF-8 references persist through the context session's
activation hook. Repeated identical loads deduplicate; changed active identities
require a new session. Follow-up snapshots and compaction retain that context
without promoting it to a higher-priority instruction role. Binary assets stay
in tool evidence. Activation adds no authority or capability grants.

The package loader supports trusted local workspace/skill directories and configured
MCP/HTTP sources. It does not load arbitrary JavaScript/Python extension modules or
install packages from a marketplace. Path confinement is an application check,
not an operating-system sandbox.

Before package admission succeeds, the loader owns discovered source connections.
If a later package or composed profile is invalid, it closes earlier source
sessions, deduplicating callbacks shared by multiple tools. After successful
admission, the capability host owns shutdown cleanup. Legacy MCP session deletion
is best effort; cleanup cannot guarantee that a remote server released its state.

Dependencies are purposeful: `ajv` validates general tool JSON Schema; `yaml`
parses Agent Skills frontmatter including block descriptions and metadata.
LangGraph uses pinned `jsonschema` for its equivalent Python declaration checks.
Standard-library JSON and line parsing do not provide these contracts. Validators
do not coerce arguments or fetch remote schema references; `format` annotations
remain descriptive.
