# Give native agents tools and skills

The default example package configuration supplies procedural skills. Normal
platform chats automatically receive tools and skill-discovery tools from enabled,
available packages, plus the built-in calculator. You do not select a capability
profile or activate a skill before chatting. Optional document tools connect through
an external MCP provider; the Lab runtime does not manage an agent filesystem.
Agents on Mastra, LangGraph, Temporal and Restate receive the shared tool declarations
through native adapters. Source execution uses the control plane's authenticated
capability host.

Follow [local development setup](local-development.md) first. Start the platform
service or worker you intend to use. Free-model runs require an OpenRouter
credential in server-owned configuration and a currently available zero-priced
model. Paid models are outside unattended evaluation use.

For CRUD operations against an upstream notes application, follow
[the Memos connection guide](memos-notes.md). Once enabled, its tools appear in
normal platform chats; create, update and delete actions still require review.

## Load the example

From the repository root:

```sh
AGENTLAB_CAPABILITY_PACKAGES="$PWD/server/capability-packages/example.json" \
  pnpm --filter @agent-harness-lab/lab-server run dev
```

The example includes `task-procedures` only and starts without external services.
To enable the optional document acceptance workflow, start the separate provider:

```sh
export AGENTLAB_DOCUMENT_PROVIDER_TOKEN=fictional-local-fixture-token
export AGENTLAB_DOCUMENT_PROVIDER_AUTHORIZATION="Bearer $AGENTLAB_DOCUMENT_PROVIDER_TOKEN"
pnpm --filter @agent-harness-lab/lab-server dev:document-service
```

Load `server/capability-packages/acceptance.json` instead of `example.json`, with
that Authorization environment variable available to the control plane. The MCP
adapter injects the admitted session identity into a trusted request header.
The provider owns template copies under `lab/runs/.document-provider/<session-id>`.
Follow-ups retain those files; models cannot choose another session or host root.
Start the release service below as well for the complete acceptance configuration.

Inspect the available profiles and safe package summaries:

```sh
curl http://127.0.0.1:4318/api/capabilities
curl http://127.0.0.1:4318/api/capability-packages
```

Native processes in the local checkout use the default host URL and private key
path. For a different deployment, configure both the control plane and workers:

```sh
export AGENTLAB_CAPABILITY_HOST_URL=http://127.0.0.1:4318
export AGENTLAB_CAPABILITY_HOST_KEY_FILE=/absolute/private/path/capability-host.key
```

The host creates the private key file. Make that same file available to authorized
workers; do not copy its value into a run, browser setting or committed config.

## Run a useful task

With the optional provider configured, open a platform's Chat and choose a free
model from the available model catalog. The enabled package tools are supplied
automatically. Approve scoped writes through the normal capability approval
control. The model can then discover and use:

| Tools | Purpose |
| --- | --- |
| `task-workspace_list_files` | Inspect available workspace entries |
| `task-workspace_read_file` | Read text with line bounds and its complete digest |
| `task-workspace_search_files` | Search literal text across bounded workspace files |
| `task-workspace_write_file` | Create output files or replace them with the expected digest |
| `task-workspace_patch_file` | Apply one unambiguous edit to a previously read output |
| `task-procedures_list_skills` | Discover procedural names and descriptions |
| `task-procedures_load_skill` | Load the chosen instructions and resource index |
| `task-procedures_read_skill_resource` | Read a specific reference, script or asset |

Ask:

```text
Use the evidence-report procedure to investigate Cedar's launch readiness.
Read the task documents and create artifacts/cedar-report.md with the approved
date, unresolved dependency and next action. Cite source paths and lines.
Read the saved file to verify it.
```

Then send a correction in the same session:

```text
Revise the report to distinguish the proposed date from the approved date.
Keep the evidence and add the specific action needed before declaring readiness.
```

The session retains loaded skill instructions and UTF-8 references for follow-ups,
including when ordinary conversation history is compacted. Repeating the same
load does not duplicate context. Changed package content requires a new session;
the previous procedure is not silently rewritten. Each retained activation is
limited to 64 KiB and participates in the normal safe context budget.

The model can discover the enabled skills and load the relevant instructions when
needed. Chat evidence records which skill instructions and references were actually
loaded; merely having a skill available does not claim it was used.

Inspect the actual model decisions, tool results and saved artifact. A successful
message without the expected file is not task completion. Provider failure is
recorded separately from source execution failure. A free model may need more
than one attempt; preserve failed trials instead of reporting only the best one.

## Run cross-platform workspace acceptance

With the control plane and selected native services ready:

```sh
pnpm --filter @agent-harness-lab/lab-server run eval:workspace -- \
  --api http://127.0.0.1:4318 \
  --platforms mastra,langgraph,temporal,restate \
  --model nvidia/nemotron-3.5-lightning:free
```

The default model is that exact Nemotron free ID. A fresh provider catalog must
confirm zero prices and tool support before admission. Provider fallback is
disabled, and each model call has a 2048-token output allowance under the separate
`agent-capabilities-live` experiment. Earlier `agent-harness-live` tasks retain
their 512-token controls. The driver submits
one multi-step task and one correction in the same session per platform. Select
a smaller comma-separated platform list when only those services are running.

Evidence is retained at
`lab/runs/.evals/capabilities-<uuid>/summary.json`, alongside the underlying native
run directories. Assertions inspect actual capability receipts for skill loading,
the referenced procedure, workspace reads, a saved report and verification reads.
The correction must read the report before editing and verify it afterward.
Content checks inspect the real artifact. Provider/runtime errors and failed
assertions remain in the report; the command exits unsuccessfully if any platform
does not meet those checks. This is a bounded integration observation, not a
statistical comparison of model quality.

## Run workspace and service acceptance

The controlled service is a fictional release application with actual MCP reads,
HTTP updates and durable revisioned records. It requires no external account.
Start it before loading the acceptance package, because MCP discovery happens
during server startup:

```sh
pnpm --filter @agent-harness-lab/lab-server dev:capability-service
```

Configure the control plane with
`AGENTLAB_CAPABILITY_PACKAGES="$PWD/server/capability-packages/acceptance.json"`.
Set absolute `AGENTLAB_RUN_ROOT` and `AGENTLAB_CONTEXT_ROOT` paths consistently
for the control plane and workers; workers also need the same host URL and key.
The service listens on `127.0.0.1:9196` and persists controlled records under
`lab/runs/.service-task/`. An occupied port is an explicit startup failure.

```sh
pnpm --filter @agent-harness-lab/lab-server eval:capabilities -- \
  --api http://127.0.0.1:4318 \
  --platforms mastra,langgraph,temporal,restate \
  --tasks workspace,service
```

Service acceptance requires the agent to activate the release-coordination skill,
read the current revision through MCP, assign Morgan through the API, verify the
saved state through MCP, then apply and verify the correction to Avery. The driver
inspects native tool ordering and actual service state. It does not infer effects
from an assistant's final message. Each task receives a separate session/namespace.

Set `AGENTLAB_NATIVE_EXECUTION_TIMEOUT_MS=180000` on the control plane for Mastra
and LangGraph, and `AGENTLAB_TEMPORAL_ACTIVITY_TIMEOUT_MS=180000` for Temporal.
The driver has a 180-second observation deadline per turn. These workload settings
are recorded; they do not change existing baseline experiment controls.

Normal platform Chat gives the agent discovery and load tools for every skill in
enabled, available packages, so it can choose relevant instructions during the task.
Run Setup and comparison flows may still use an explicit profile and skill selection
when a controlled experiment needs a fixed inventory. Hosted packages are supported
on the four verified baseline variants; other variants show them as unavailable and
reject admission.

## Add another package

Copy the example JSON to a local configuration file and add a package entry.
Paths resolve against that configuration file. Every package requires a safe
`id`, exact semantic `version` and source. `skills` requires a directory containing named `SKILL.md`
packages. Legacy `workspace` sources are rejected with migration instructions;
use a connected MCP/API document provider instead. Explicit `profiles` select package IDs for a task.

For an MCP server:

```json
{
  "id": "reference-service",
  "version": "1.0.0",
  "source": "mcp",
  "endpoint": "http://127.0.0.1:9000/mcp",
  "protocolVersion": "2025-11-25",
  "tools": [
    { "remoteName": "documents.search", "name": "reference_search", "riskClass": "read" }
  ]
}
```

The remote tool must actually exist in discovery. Its schema comes from the
server; the trusted configuration selects its alias and risk. Omit `tools` only
when intentionally discovering the full inventory; those tools default to the
conservative external risk and still require approval.

For a direct HTTP operation:

```json
{
  "id": "reference-api",
  "version": "1.0.0",
  "source": "http",
  "baseUrl": "http://127.0.0.1:9000",
  "operations": [
    {
      "name": "reference_search_http",
      "method": "GET",
      "path": "/documents/search",
      "description": "Search the configured reference collection.",
      "riskClass": "read",
      "inputSchema": {
        "type": "object",
        "properties": { "query": { "type": "string", "minLength": 1 } },
        "required": ["query"],
        "additionalProperties": false
      }
    }
  ]
}
```

These entries are configuration examples, not running services. Supply a real
service with that contract before loading them. Optional `headersEnv` maps
header names to environment variables containing complete values, such as an
Authorization header value. Keep credentials out of the JSON file.

Restart the control plane with the new configuration for new admissions. Existing
runs retain their catalog revision; changed bindings require a new run. No native
agent loop edits are needed for another operation using these source kinds.

## Diagnose and clean up

An unavailable host usually means a worker cannot reach the configured URL or
read the private key. Changed skill or MCP definitions require catalog reload.
The external document provider creates missing parent directories within the configured writable
scope. An edit conflict requires reading the current file and using its new digest.
Unapproved writes remain denied even if a skill says to perform them.

Unknown effects require inspecting the retained call receipt and actual target
state before deciding recovery. Do not blindly retry a write with a new call ID.
Run evidence lives under `lab/runs/<run-id>/`; source receipts live under its
`artifacts/capability-calls/` directory. Keep evidence you want to compare. Remove
generated session directories only when those sessions are no longer needed.

See [architecture and lifecycle limits](../architecture/extensible-capabilities.md).
Path confinement does not provide an operating-system sandbox. The skill loader
does not execute scripts, and arbitrary plugin installation is unsupported.
Authorized connected execution is a separate tool capability.

Skill names and applicability descriptions are included in the frozen load-skill
argument declaration before the first model decision. Procedure bodies remain
unloaded until explicitly selected or requested through the skill tool. Metadata
is bounded to 16 KiB per package; larger catalogs require separate packages.

## Request connected script execution

The optional `execution.json` profile demonstrates this boundary with a real
[procedure provider](../../server/src/capabilities/integrations/procedure-service/README.md).
The adjustment-summary skill directs the agent to read its script resource and
submit the exact content and digest to `procedures_execute`. That external provider
reads the saved order and executes bounded arithmetic/report steps. Tool selection
and permissions remain ordinary admitted connected capabilities. No shell or
filesystem management is added to the skill loader or platform runtimes.

This configured fixture supports its pinned declarative script only. General
Python/JavaScript execution needs a separately configured provider and is not
implied by the presence of a script resource. If execution is absent or denied,
the agent should report that limitation instead of claiming it ran the script.

For provider-documented MCP rejections that occur before an effect, configure an
explicit tool contract, for example:

```json
{
  "remoteName": "task-workspace_patch_file",
  "name": "task-workspace_patch_file",
  "riskClass": "write",
  "effectContract": {
    "rejectionErrorCodes": ["DOCUMENT_PATCH_MATCH", "DOCUMENT_DIGEST_CONFLICT"]
  }
}
```

Only `isError: true` plus a configured `structuredContent.error.code` establishes
that rejection. The contract is frozen into source identity and applies to new
admissions. Generic write failures and lost acknowledgements remain unknown; a
provider message or annotation alone cannot authorize a repeated write. The
[document provider contract](../../server/src/capabilities/integrations/document-service/README.md)
lists the verified checks and their boundaries.
