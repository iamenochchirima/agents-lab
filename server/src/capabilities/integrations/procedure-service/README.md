# Optional connected procedure execution

This separate loopback service demonstrates how a skill requests execution without
putting a shell, interpreter or agent filesystem in a platform runtime. A skill
resource supplies a pinned JSON script. The agent calls the admitted MCP tool;
this provider reads saved business state and executes its declared arithmetic
and reporting steps. Reading the resource alone does not execute anything.

Start the controlled business service on port 9196, then start this provider:

```sh
export AGENTLAB_PROCEDURE_PROVIDER_TOKEN=fictional-connected-procedure-token
export AGENTLAB_PROCEDURE_PROVIDER_AUTHORIZATION="Bearer $AGENTLAB_PROCEDURE_PROVIDER_TOKEN"
pnpm --filter @agent-harness-lab/lab-server dev:procedure-service
```

Load `server/capability-packages/execution.json` in the control plane. It supplies
`business-summary-agent`, procedural skill tools and `procedures_execute` through
the generic MCP adapter. The provider listens at port 9198. Its credential remains
server-owned through `conn_procedures_local`, an operator-owned static connection
with the `procedures:execute-readonly` scope. Its stable binding and credentials
use the current ConnectionManager path. Revoke blocks further dispatch; reconnect
and catalog refresh require new admission. Source unavailability is reported
through the connection/catalog lifecycle, with no local execution fallback.
No native agent loop or skill-loader execution branch is needed.

An example task is:

```text
Use the adjustment-summary skill to calculate the saved net order amount for
namespace cap-my-trial. Read its script resource, execute it through the connected
procedure tool, and report the actual saved revision, net amount and script digest.
If execution is unavailable or denied, say so instead of claiming the script ran.
```

The provider pins `support-adjustment-summary` version 1.0.0 and its exact resource
digest at startup. It accepts only those script bytes. Its bounded interpreter
supports read_order, safe-integer subtract and report steps. The business endpoint
is operator-configured; the model cannot choose a URL, path, credentials or code.
Business replies are bounded to 32 KiB with a five-second deadline. The declaration
classifies this fixed read-only procedure as read risk. A different provider that
executes writes needs appropriate grants, action review and effect contracts.

This is a real connected execution fixture, not a general Python/JavaScript engine
or VM. No eval, shell, arbitrary program installation or native filesystem fallback
exists. General code execution can be supplied by another authorized connected
service with its own isolation contract, without changing the skill loader or
platform agent loops. The current fixture does not establish that broader support.

The focused integration check loads the skill, reads its resource, invokes the
configured MCP adapter and independently verifies the computed net amount from a
saved adjusted order. It checks that unselected tools are denied and altered/code
scripts fail. This is deterministic contract evidence, not a free-model observation
or claim of model competence. Existing business/document model trials are separate.

## Installation and lifecycle

This provider uses existing pinned Fastify/Node dependencies. No additional
interpreter, VM, agent dependency or executable plugin is installed. The default
Lab configuration does not start it. Stop it with the service process when no
longer needed; it keeps no execution queue or durable side effects. Its summary
is derived from current persistent order state owned by the business service.

The profile is declared for Mastra, LangGraph, Temporal and Restate baselines
through the ordinary package catalog. Other variants remain unsupported. The
connection manager resolves static credentials at dispatch and blocks revoked
authority. The contract test checks the current connection binding and revoke
behavior alongside actual execution. No additional real-model trial is claimed.
