# Capability package examples

`example.json` is trusted server configuration. It contributes real workspace
tools and a procedural skill package. Paths resolve against this config file.
The example enables `isolateSessions`, which clones its bounded template once
into `stateRoot/<session-id>`. Follow-up turns in the same host-admitted session
keep that clone; other sessions get separate files. The default is false for
packages intended to work in an existing configured workspace. Session identity
comes from the admitted run, never a model argument. Templates reject links and
special files and are limited to 256 files, 256 directories and 10 MiB. Clones
use a recorded template/package revision and atomic directory publication.
Generated reports do not belong in source control.

Workspace contributions list, read and search files, then create and patch
output files within `writeDirectories`. Editing an existing file requires the
digest returned by `read_file`. Writes require an explicit capability approval.
Path checks reject traversal and symbolic links; these checks are application
confinement, not an operating-system sandbox.

The skill package contributes metadata listing, procedure loading and referenced
resource reading. The model chooses when to load the procedure. `SKILL.md` uses
the Agent Skills YAML format. Resource digests freeze the admitted package;
changed files require a new catalog load. Scripts are readable resources and
are never executed automatically. Binary resources return bounded base64.
The direct `yaml` dependency parses portable block descriptions and metadata;
the standard library does not provide a YAML parser.

To add tools without native loop edits, add another configured package.
Supported sources are `workspace`, `skills`, `mcp` and `http`. Workspace and
skill packages require `id`, exact `version` and `root`. MCP packages require
a trusted `endpoint` and may declare selected remote tools with aliases and
risk classes. HTTP packages require a trusted `baseUrl` and explicit operation
definitions with method, path, input schema, description and risk class.
See the connection source adapter's contracts for these fields.

Remote packages can use `headersEnv`, mapping a header name to an environment
variable containing its complete value. For example, an `Authorization`
reference contains the complete `Bearer ...` header value. Credentials stay
inside configured closures and never enter tool declarations, package summaries
or run snapshots. Endpoints, roots and configuration are server-owned; model
arguments cannot change them.

Each package gets an individual capability profile. The config's optional
`profiles` array defines trusted compositions with `id`, `version` and a list of
package IDs. The example's `workspace-agent` profile explicitly selects both
workspace tools and procedures. A composition retains each tool package's exact
version in its grants. Discovery does not authorize an operation. Adding
arbitrary executable plugin code is not supported by this loader.
