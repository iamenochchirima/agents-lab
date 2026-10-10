# Connected tool readiness

This checkpoint records observations on 2026-10-10. It distinguishes native
orchestration checks, real model decisions and frontend observation. A reachable
service does not establish that an agent will complete a task.

## What the native implementations demonstrated

| Baseline | Service reachable | Real model used both sources and loaded skill | Approved change and subsequent read observed | Native review and recovery checks | Full five-stage task |
| --- | --- | --- | --- | --- | --- |
| Temporal | Yes | Yes | Yes, assignment and correction | Six selected checks passed | Passed with Nemotron |
| LangGraph | Yes | Yes | Yes, assignment and correction | Included in the 14-check existing-platform suite | Passed with Cohere |
| Mastra | Yes | Yes | Yes, assignment and correction | Included in the 14-check existing-platform suite | Required behaviors observed; missing-record stage corrected in a separate Cohere continuation |
| Restate | Yes | Yes | Yes, assignment and correction | Included in the 14-check existing-platform suite | Required behaviors observed across trials and explicit continuations; original correction/error failures retained |
| Vercel Workflows | Yes | Yes | Yes, assignment and correction | Five actual local World/host checks passed | Required behaviors observed; original final-request rate limit retained separately from continuation |

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

Corrective continuations reuse the exact source model and session, independently
check current provider state and never replay confirmed mutations. They establish
remaining behaviors, not an initial full-workflow pass. Only Temporal and LangGraph
passed all five stages in an initial trial.

Commit `4eb9841` requires durable receipt fingerprints to match the exact declared
namespace/key and structured returned state, with verification after the effect or
denial. Supplemental audits retained original reports and downgraded a Restate error
that requested `release` rather than `missing`. A subsequent error-only observation
requested the exact missing key and passed without changing provider state. Vercel's
extra typo read is retained; its final verification read targets the correct record.
Some model denial prose invents a policy or permission cause. The enforced denial and
saved state are verified; narrative accuracy is not established by that behavior check.

Additional evidence directories:

- `connected-2959e6f4-a4df-4ae2-af8d-b2f50dd11076`: Restate denial continuation; original wrong-key error retained and downgraded by audit.
- `connected-a59365be-c56a-4edd-927c-98f95f930a76`: Mastra error and Vercel correction/denial/error continuations.
- `connected-360f8f68-92e2-47e3-94d7-bb852f8a64d3`: exact missing-key Restate corrective observation.

## Frontend and remaining limits

Four browser fixture cases exercised approvals inside assistant turns, pending
refresh, denial, retained history and decision retries. Direct supported in-app
browser access subsequently recovered. The actual free-model Temporal chat was
verified through pending refresh, approval, a read-only next turn, keyboard denial
and retained history. Independent provider inspection confirmed one saved change
and no change after denial. The user also reported approving the earlier proposal
inside chat; its retained decision and post-mutation read corroborate that report.

Existing real-model review histories were inspected in the actual frontend on all
five platforms. Cards appear inside the owning assistant article, outside the
configuration sidebar. Non-Temporal decisions were scripted fixture decisions in
these runs; inspecting their histories does not claim fresh human clicks on every
platform. Evidence: `.connected-proof/browser-direct-20261010` and
`.connected-proof/manual-chat-20261010`.

A 390px browser check exposed conversation grid overflow; commit `5dfdd3a` bounded
the grid column and wrapped bubble text. The same conversation was rechecked with
no chat/card horizontal overflow, alongside a 1280px check. Keyboard decisions and
focus-restoration policy checks passed; native focus edge cases were not exhaustively
measured. Failure details render allowlisted phase/code/category records, with a
safe generic fallback for unclassified adapter errors and confirmed effects shown
separately. Arbitrary SDK cause messages, provider bodies and secret paths are excluded.

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
