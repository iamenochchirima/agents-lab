# Readiness of the remaining execution platforms

This records the pre-implementation investigation. For the implemented four-case
[development command and current limits](../../lab/experiments/agent-harness-baseline/development-evals.md),
see the [implementation handoff](../../development/implementation-plans/platforms/active/agent-harness-baseline-evals.md).

Audit date: 2026-10-07. Scope: DBOS, Inngest, Trigger.dev, Hatchet,
Vercel Workflows, AWS Step Functions, and the LangGraph/Temporal composition.
This is source and test inspection, not a fresh native acceptance result. No
services were started, no provider calls were made, and no live runs were
cancelled or modified. Versions below are repository pins, not claims about
the latest upstream release. Existing user changes were preserved.

## Main finding

The six platform baselines implement genuine platform execution boundaries,
but each currently performs a single model request. Their OpenRouter adapters
send a system message and a user prompt and read assistant text. They do not
implement model-selected tool calls, tool feedback, or multi-turn context.
They are useful lifecycle baselines. They cannot yet establish the Lab's
[agent acceptance contract](../../lab/scenarios/platform-agent-conformance/eval-cases.md).

The common [RunService](../../server/src/control-plane/application/run-service.ts)
also excludes these variants from `CONTEXT_CAPABLE_VARIANTS`. Shared context
storage elsewhere in the repository therefore does not imply context support
on these execution paths. The native
[capability matrix](../../server/integration-tests/platform-capability-matrix.test.ts)
exercises Temporal, Restate, LangGraph, and Mastra, not these six.

## Implementation and available validation

| Variant | Actual implementation and repository pin | Existing native validation | Prerequisites and scope |
| --- | --- | --- | --- |
| DBOS baseline | Official DBOS workflow with model request in `runStep`, PostgreSQL state, stable workflow ID and input hash. SDK 4.27.6. [Workflow](../../server/src/platforms/dbos/variants/baseline/workflow.ts), [runner](../../server/src/platforms/dbos/runner-adapter/dbos-runner.ts). | Opt-in [integration test](../../server/integration-tests/dbos-baseline.test.ts) covers fake success, failure, retry, duplicate, adapter reconstruction, cancellation, and outage. The OpenRouter unit test replaces `DBOS.runStep` and fetch. It verifies wiring, not PostgreSQL checkpoint/replay. | Real PostgreSQL and DBOS host. Default database port 55432, service 9092. No in-memory fallback. Adapter reconstruction is not a worker crash at an external acknowledgement boundary. |
| Inngest baseline | Official event/function SDK and durable model step, local JSON projection, stable event ID. SDK 4.20.0, documented CLI 1.44.0. [Service](../../server/src/platforms/inngest/service/platform-service.ts), [store](../../server/src/platforms/inngest/variants/baseline/store.ts). | Opt-in [integration test](../../server/integration-tests/inngest-baseline.test.ts) runs real Dev Server success, failure, retry, and asynchronous cancellation. Store tests cover reload and conflicts. Service tests use injected clients/step execution and provider fetch. | Function service 9091 and Dev Server 8288. Local projection persistence does not establish hosted execution durability. Documentation explicitly defers tools and multi-turn sessions. |
| Trigger.dev baseline | Official registered task, two outer task attempts, task AbortSignal, optional OpenRouter. SDK and CLI 4.5.14. [Task](../../server/src/platforms/trigger-dev/variants/baseline/execution/task.ts), [runner](../../server/src/platforms/trigger-dev/runner-adapter/trigger-dev-runner.ts). | Opt-in [integration test](../../server/integration-tests/trigger-dev-baseline.test.ts) checks a genuine scheduler/worker success and normalized evidence. Adapter tests inject the Trigger client. OpenRouter task tests call the handler with mocked fetch. | Trigger server or Cloud development project, development credentials, and separate local worker. Cloud execution is external even when task code runs locally. The local development guide explicitly leaves real integration acceptance pending credentials. |
| Hatchet baseline | Official task with task retry/timeouts, status idempotency, native inspection, embedded or remote worker. SDK 1.33.1, engine constant v0.106.5. [Task](../../server/src/platforms/hatchet/variants/baseline/execution/task.ts), [runner](../../server/src/platforms/hatchet/runner-adapter/hatchet-runner.ts). | Opt-in [embedded integration](../../server/integration-tests/hatchet-baseline.test.ts) covers success, failure, retry, timeout, cancellation, native identity and evidence. Task/adapter unit tests inject model fetch and client. SDK probe establishes API availability, not engine health. | Embedded profile downloads a native engine and uses bundled Postgres/cache. It needs no account or Docker but still starts real infrastructure. Remote profile requires API, gRPC, token, and active worker advertising the exact task. |
| Vercel Workflows baseline | Official compiled workflow/step, local World, durable pending/accepted admission ledger. `workflow` and builders 5.0.0-beta.52, local World 5.0.0-beta.45. [Workflow](../../server/src/platforms/vercel-workflows/variants/baseline/execution/workflow.ts), [step](../../server/src/platforms/vercel-workflows/variants/baseline/execution/model-step.ts). | [Local service integration](../../server/tests/platforms/vercel-workflows/service.integration.test.ts) executes real local World success/failure, duplicate/conflict, cancellation, unresolved admission and service restart. It skips when platform dependencies are absent. Its OpenRouter case replaces fetch. | Platform-local SDK install, generated workflow bundle, HTTP service 9094 and isolated data directory. Local World observations do not establish managed Vercel retention or deployment recovery. Hosted profile is separate. |
| AWS Step Functions baseline | Standard execution with one Activity worker and ASL retry/timeout. AWS SDK 3.1132.0. [ASL](../../server/src/platforms/aws-step-functions/variants/baseline/execution/state-machine.ts), [worker](../../server/src/platforms/aws-step-functions/service/activity-worker.ts). | Opt-in [emulator integration](../../server/integration-tests/aws-step-functions-baseline.test.ts) covers success, retry, failure, cancellation, reconstruction, timeout and unavailable endpoint. Unit tests inject AWS API. No inspected hosted acceptance gate. | Step Functions Local 18083 and platform service 9093, or explicit hosted resource ARNs and IAM. Emulator image in the guide is unpinned. More importantly, this runner is absent from shared [server bootstrap](../../server/src/control-plane/bootstrap/server.ts) and the planned registry list, so platform-local existence does not mean frontend execution is wired. |

The [LangGraph/Temporal composition](../../server/src/platforms/compositions/langgraph-temporal/README.md)
is a documentation scaffold only. It has no inspected composed runner, concrete execution
implementation, ownership agreement, or acceptance test. Do not include it as
an implemented variant in a comparison.

## B01 through B12 coverage

"Partial" means relevant implementation or named test exists. It does not mean
all acceptance assertions pass. Native tests above are opt-in or dependency
conditional, so ordinary test success does not establish native acceptance.

| Case | All six variants | Required next evidence |
| --- | --- | --- |
| B01 prompt completion | Partial. Single prompt and terminal model response exist. | Capture actual model request/configuration through a scripted provider boundary and grade one canonical result from a retained native run. |
| B02 tool feedback | Absent. No model-selected tool dispatch loop. | Implement and observe calculator call, correlated call ID/result, and result in the following model request. |
| B03 context continuation | Absent. No context-capable registration or conversation model request. | Two actual turns through one session with captured request role ordering. |
| B04 session isolation | Absent at these native paths. | Interleaved sessions with marker and identity checks at model/tool boundaries. |
| B05 invalid tool input | Absent. No native tool invocation path. | Reject invalid calls before fixture execution, preserve rejection evidence. |
| B06 permission boundary | Absent. Common policy code does not establish policy use inside these tasks. | Disabled-tool and unapproved-write controls through the actual execution path. |
| B07 bounded execution | Partial only for scheduler/model deadlines and bounded native retries. No tool-call or loop budgets. | Document attempts versus dispatches, implement call/round limits, capture no dispatch after exhaustion and deadline outcome. |
| B08 failure propagation | Partial for fake/model/provider errors. No tool-error case. | Native provider rejection/malformed response/tool error, verified attempt counts and frozen retry policy. |
| B09 cancellation | Partial. Native cancellation mapping and tests exist, with different in-flight behavior. | Cancel after model dispatch; independently observe no later tool/model starts, terminal races, repeated cancellation and honest in-flight outcome. |
| B10 submission identity | Partial for stable Lab/native run identity. Session/client-turn admission absent. | Exact duplicate versus changed-content conflict using session/client-turn identity. Also audit Hatchet's status idempotency and Trigger content conflicts. |
| B11 evidence integrity | Partial. Structured events/result/trajectory/metrics and native references exist. | Grader cross-checks outcome, fixture state, ordering/deduplication, unknown usage, secret sentinels and attempt accounting. |
| B12 truthful uncertainty | Partial. Outage/ambiguous admission paths exist. | Validate unavailable-before-admission and acknowledgement-loss after dispatch through real platform paths, with no unsafe redispatch. |

## Concrete gaps to fix before extending the agent loop

1. Retry policy around ambiguity differs materially. Trigger's
   [OpenRouter adapter](../../server/src/platforms/trigger-dev/variants/baseline/execution/openrouter.ts)
   throws `TriggerBaselineTaskError` for transport ambiguity; the registered task
   allows two attempts and has no inspected error-specific retry exclusion.
   Preserve uncertainty, but also prevent the scheduler from blindly repeating
   an ambiguous side-effecting model/tool request. Vercel's adapter explicitly
   makes transport failures retryable and the durable step throws to invoke
   retries. AWS's OpenRouter adapter marks timeout/transport failures after
   `requestSent: true` retryable; ASL also retries `States.Timeout`. These policies
   need frozen contracts and dispatch-count tests before introducing writes.
   They are particularly relevant to B12 and X02. A retryable failure label is
   not evidence that the external action did not happen.
2. Evidence accounting has visible inconsistencies. Trigger's fake task output
   uses `attemptCount = ctx.attempt.number` but sets
   `metrics.modelAttemptCount: 1` even on retry. DBOS
   `failureAttemptCount()` hardcodes 2 for `DBOSMaxStepRetriesError` although the
   input maximum is configurable. Add focused failure/retry assertions before
   using these metrics in comparative reports.
3. Native run deduplication is not B10 session-turn identity. Hatchet uses
   `strategy: "status"` and `expression: "input.runId"`; its collision branch
   adopts an existing run without checking the changed request's content.
   Trigger similarly uses a stable run ID key, but does not inspect changed
   input on collision. A common turn ledger may provide the public contract,
   but it must be tested through every registered variant rather than assuming
   native deduplication has the same semantics.
4. AWS cancellation stops native execution but the model runner takes no
   cancellation signal from `StopExecution`. In-flight worker calls can continue
   until model timeout; worker shutdown only aborts polling. Document and test
   this before enabling tools, so a cancelled projection cannot hide later effects.
5. AWS's OpenRouter JSON read and assistant output are unbounded in the inspected
   adapter, unlike the other five bounded-response adapters. Add response/output
   limits before making it a general user-run provider path.
6. Repair documentation drift. Trigger's variant README still describes no
   external provider even though task/OpenRouter code exists. Inngest's local
   guide says shared registration is still future work although bootstrap
   registers it. Historical completion plans and these stale statements should
   not decide current readiness.
7. Declare unsupported capabilities at admission. These runners' inspected
   validation methods do not reject configured tools, and their native inputs
   omit tool capability resolution. Common capability selection alone can
   therefore look configured without an execution path. Reject unsupported
   combinations explicitly and drive frontend choices from variant support.
   `RunService` already rejects session requests outside the context-capable set;
   tools need an equally clear contract.

The completed
[platform completion wave](../../development/implementation-plans/platforms/completed/platform-completion-wave.md)
explicitly excludes native sessions for every platform, Trigger infrastructure,
and AWS validation. Its recorded completion is a historical scope statement,
not a current all-platform B01 through B12 pass.

## Recommended sequence and safe eval gates

Start lifecycle evals now as isolated scripted diagnostics once the exact service
profile is healthy. Limit the claim to B01 and selected B07 through B12 assertions.
Use fake/scripted provider responses, fresh native state, disposable fixtures and
retained evidence; mark skips and infrastructure failures separately. This does
not require waiting for all six to become full agents.

Implement one complete model/tool/context loop on an already context-capable
priority variant first, with captured model requests and independent fixture
checks for B01 through B12. Then port the same behavioral contract into each
remaining platform's existing native task/workflow boundary. Do not build a
second generic orchestration framework to hide platform semantics. Keep model
requests and external actions in each platform's appropriate step/activity;
record replay and cancellation behavior alongside normalized evidence.

Extend these six one at a time. Vercel local World or DBOS are practical initial
ports because their admission and durable-step boundaries are small and explicit.
The choice depends on available local dependencies, not a presumed platform
winner. Hatchet is also testable locally but its embedded engine and status
idempotency need their own controls. Inngest's cancellation and deduplication
window require event-specific evidence. Trigger Cloud and hosted AWS should have
separate deployment profiles, cost bounds and cleanup procedures. Wire AWS into
the frontend/control plane only after its registration and readiness contract is
explicit.

Run live M01 through M04 only after the corresponding scripted core paths pass
through the selected native deployment. Use a fixed model/configuration and
finite dispatch/time budgets. Live prompts about writes must target disposable
fixtures; no real tickets, payments or account changes are needed. A failed
scripted core case blocks a capability comparison, but should still be retained
as diagnostic evidence. Optional X01 through X05 need capability-specific
fixtures and should follow the shared core. They do not delay prompt lifecycle
diagnostics and should never be inferred from the platform brand.
