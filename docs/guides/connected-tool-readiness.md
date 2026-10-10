# Connected tool readiness

This checkpoint records observations on 2026-10-10. It distinguishes native
orchestration checks, real model decisions and frontend observation. A reachable
service does not establish that an agent will complete a task.

## What the native implementations demonstrated

| Baseline | Service reachable | Real model used both sources and loaded skill | Approved change and subsequent read observed | Native review and recovery checks | Full five-stage task |
| --- | --- | --- | --- | --- | --- |
| Temporal | Yes | Yes | Yes, assignment and correction | Six selected checks passed | Passed with Nemotron |
| LangGraph | Yes | Yes | Yes, assignment and correction | Included in the 14-check existing-platform suite | Passed with Cohere |
| Mastra | Yes | Yes | Yes, assignment and correction | Included in the 14-check existing-platform suite | Incomplete; Cohere queried the wrong record in the error stage |
| Restate | Yes | Yes | Yes, assignment and correction | Included in the 14-check existing-platform suite | Incomplete; Cohere verified the correction, then returned an empty final response |
| Vercel Workflows | Yes | Yes | Yes, assignment | Five actual local World/host checks passed | Incomplete; Cohere verified the assignment, then a final model request was rate-limited |

The sources were a fictional MCP dispatch board and a separately configured HTTP
handbook. The imported skill, tool names and schemas were scenario declarations;
platform loops and approval components did not require provider-specific edits.
Independent provider inspection checked saved state. All write review decisions in
these trials were scripted and restricted to disposable local fixture records.
They are not personal-account or human frontend evidence.

The native checks cover pending review reconstruction, revision renewal, approval,
denial and selected failure boundaries. Vercel also retained one provider attempt
and one effect under controlled lost acknowledgement. These checks do not prove
arbitrary crash recovery or exactly-once business actions. See each platform's
native semantics before choosing a deployment.

## Model controls and retained failures

The comparable first trial used `nvidia/nemotron-3.5-lightning:free` on all five
platforms. Temporal passed all stages. Other trials retained missing tool proposals,
missing verification calls or planning text without execution. They remain failed
observations even when the generated text claimed success.

The separate `google/gemma-4-31b-it:free` comparison was unavailable because of HTTP
429 responses before task execution. A third comparison used
`cohere/north-mini-code:free` on the four platforms still lacking full acceptance;
Temporal's successful trial was not repeated. Different models are separate
observations, not a same-model platform ranking.

Each trial retained a fresh zero-price catalog entry, exact model ID, output allowance
of 2048 tokens, disabled fallback, admitted tool and skill snapshots, runtime versions,
native identities, reviews, receipts and independently inspected provider state.
The common observation deadline was 180 seconds; actual per-platform timeouts are
recorded with the evidence. The pre-fix Vercel native model step retried rate-limited
requests four times through the Workflow SDK. That control difference is retained
in the original evidence rather than rewritten as fail-fast behavior.

Commit `69ef363` subsequently disabled model-step retries and retained safe provider
codes/categories as workflow results. Focused actual local World checks established
one dispatch for both rate-limit and transport failures. Transport uncertainty
requires reconciliation; a rate-limit result is reported as a provider failure.
Commit `e1568ea` keeps explicit confirmed effects separate from invalid result
presentation in chat. These fixes were not retroactively credited to live trials.

Evidence directories under ignored `lab/runs/.connected-proof/`:

- `connected-b527de87-5b0f-492e-ba68-e96285f90e87`: Nemotron comparison.
- `connected-94ccd090-5e0b-4756-8574-80c4d5f0ba7d`: unavailable Gemma comparison.
- `connected-01d0222c-3e1e-498a-8b81-46ce35308765`: Cohere comparison.

The [scenario and runnable driver instructions](../../lab/scenarios/connected-tools/README.md)
explain how to reproduce these observations. Original reports are retained;
supplemental ordered-verification audits check that a verification read follows the
mutation rather than accepting two reads performed before it.

## Frontend and remaining limits

Four browser fixture cases exercised approvals inside assistant turns, pending
refresh, denial, retained history and decision retries. Focused rendering checks
cover safe metadata and call-specific outcomes. A real-model frontend walkthrough
for the current controlled proposal is still pending. The browser control tool
rejected the local URL, so API inspection is not presented as visual evidence.

The control plane remained ready and Temporal executed tools while optional Hatchet
startup was unavailable. Native calls used the isolated API on port 4322, including
review preparation; workers did not silently use the default capability-host port.

Launcher ownership checks preserve workers using other queues/configurations and
unrelated process-group siblings. An actual isolated required-service failure
returned a nonzero exit status, named its retained log and cleared its owned
processes/ports while the existing APIs and pending-review worker stayed running.
The check exposed and fixed cleanup previously overwriting the failure status.
Automatic replacement requires readable Linux process ownership metadata;
older or manually started watchers require explicit stopping.

Inngest, DBOS, Hatchet, Trigger.dev, other variants and hosted deployments were not
validated in this phase. Personal connected-account mutations were not measured.
The [compatibility matrix](connected-tool-compatibility.md) describes implemented
adapter and authentication subsets. The [chat guide](connected-agent-tools.md)
describes shared tools and inline review usage.
