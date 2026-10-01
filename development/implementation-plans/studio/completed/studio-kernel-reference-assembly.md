# Studio kernel and first reference assembly

**Created:** `2026-09-25`

**Status:** Complete, 2026-09-26

## Purpose

Build the first general Studio assembly from one selected baseline implementation
for each of the twelve module areas. Keep every module independently buildable and
usable through its package contract; the kernel supplies assembly, lifecycle,
capability checks, and evidence without taking ownership of module behavior.

This is one fixed reference assembly and a small set of controlled scenarios. It is
not a dynamic plugin installer, a claim that every possible combination is
compatible, or a comparison of alternative implementations. The completed
[remaining module baselines](studio-remaining-module-baselines.md) provide the
standalone starting point.

## Pre-plan baseline

The existing Studio chat calls `runTextTurn` directly from two build-time reference
assemblies. The calculator path composed Input, Memory, Context, Control, Model
Interface, Tool Use, Safety, and Execution Environment. It did not connect
Planning, Computer Use, Output Actions, or Observability, and its records were
transient. This section describes the state before this plan's implementation.

The baseline contracts expose specific integration gaps that this plan must resolve
before claiming a complete assembly:

| Boundary | Current state | Work this plan must address |
| --- | --- | --- |
| Planning and Control | Planning proposes a plan, but Control has no plan input or planning port. The kernel currently does not construct a Planner. | Specify who consumes a proposal, when replanning occurs, and how Control retains execution and termination ownership. A proposal must affect execution or evidence; it must not be called and discarded. |
| Computer Use and the environment | Computer Use expects an observe/perform capability. Execution Environment exposes scoped sessions and capability invocations. Control currently exposes tool execution only. | Specify the adapter or contract change that routes proposed computer actions through Safety and the selected scoped environment, then returns observations to Control and Context. |
| Safety and side effects | The Safety contract has tool, environment, output, and memory checkpoint kinds, but the current allowlist implementation allows only configured pure tool calls. | Define the first assembly's explicit policy for computer actions, final output, and Memory writes. Keep deny-by-default behavior and make denied or unavailable decisions visible. |
| Output and the chat host | Output Actions prepares text and calls an injected sink; the current kernel returns final text directly and has no sink integration. | Define how a final response is approved, delivered, surfaced to the HTTP caller, and represented when delivery is rejected or uncertain. |
| Observability and run lifecycle | The recorder accepts host-created IDs, timestamps, and sequences. The kernel returns transient evidence but creates no `AgentEvent`s. | Define event ownership and ordering, append/flush handling, partial-run evidence, and the run artifact projection. |
| Assembly loading | The reference package uses fixed imports and records component metadata, but it is not a general assembly resolver. | Define a versioned descriptor and a static registry for known implementations, validate compatibility before side effects, and record exact package, implementation, and configuration identities. |

## Scope

- Map the twelve role contracts and document the order and data passed across each
  boundary. Extend a role contract only when a concrete first assembly needs the
  missing behavior; preserve the role-specific method and lifecycle.
- Implement a small kernel assembly path that resolves the selected package exports,
  validates declared requirements, creates run-scoped dependencies, propagates
  cancellation, closes environment resources, and preserves partial evidence.
- Assemble one versioned selection for Input, Context, Planning, Memory, Tool Use,
  Computer Use, Control, Execution Environment, Output Actions, Safety, Model
  Interface, and Observability. Record each package version, implementation
  identity/version, and configuration.
- Use a static allowlist of implementations compiled into the Studio packages for
  this first version. A descriptor chooses among known constructors; it cannot
  import an arbitrary package, execute contributed code, or load a network plugin.
- Keep the current browser boundary: `apps/web` uses the Studio HTTP contract. The
  API host invokes the assembly and returns a safe run projection; the browser never
  constructs or imports module implementations.
- Preserve each module's independent checks and add kernel and assembly checks for
  interactions that standalone checks cannot cover.

## Controlled first-cycle scenarios

Use deterministic model behavior and controlled local capabilities so the evidence
shows module interactions without making a claim about model quality or production
computer access.

1. **Text response:** exercise Input, Memory recall/write within a session, Context,
   Planning, Control, Model Interface, Safety-approved Output Actions, and durable
   Observability.
2. **Tool action:** exercise a validated Tool Use call, Safety decision, scoped
   Execution Environment invocation, correlated result through Context and Control,
   final output, and evidence.
3. **Computer action:** exercise a proposed computer action through Safety, Computer
   Use, and a controlled fixture capability backed by a scoped Execution Environment
   session; return before/after observations and verification to the rest of the
   cycle.

These can be separate scenarios using the same versioned module assembly. A module
may be selected but not invoked in a scenario whose task does not need that role.
Where an implementation cannot participate in the cycle without becoming a no-op,
record that as a contract gap and resolve it before declaring assembly acceptance.

## Implementation sequence

1. **Resolve the interaction contracts.** Specify Planning-to-Control exchange,
   computer-action dispatch and environment adaptation, Safety checkpoints for all
   enabled effects, Output Action sink semantics, Memory scope/write policy, and
   event creation/ordering. Record any contract changes with their reasons and
   failure behavior before wiring them.
2. **Define assembly resolution and compatibility.** Add an explicit descriptor
   with one implementation and configuration per area. Check required capabilities,
   versions, and incompatible combinations before creating external effects. Keep
   the initial registry static and small.
3. **Connect the run lifecycle.** Adapt the role-specific contracts through the
   kernel. Control owns call ordering and termination; the kernel owns module
   construction, global bounds, cancellation, resource cleanup, and evidence
   publication. Side-effect adapters must preserve rejected and uncertain outcomes.
4. **Connect durable evidence and the API.** Have the kernel assign event IDs,
   strictly increasing sequences, timestamps, and source identities; write assembly
   configuration and run results beside the recorder's `events.jsonl`. Flush on
   terminal outcomes and retain an explicit partial/unknown result when persistence
   cannot be confirmed. Return only the safe projection required by the chat client.
5. **Run the controlled scenarios and review the seams.** Verify the three paths
   above, cancellation and failure paths, and that one component can be replaced by
   a contract-conforming test double without changing unrelated modules or the
   browser/API wire format. This checks the seam without shipping an alternative
   implementation.

## Acceptance

- [x] A versioned reference assembly selects and records one package, implementation
      identity/version, and configuration for all twelve areas.
- [x] The kernel validates the assembly before side effects and uses only public
      package contracts; no module imports another module's private source files.
- [x] Planning output is consumed by the execution path in a documented way; Control
      still owns the loop and termination decision.
- [x] Tool and computer actions pass through the applicable Safety check and scoped
      Execution Environment capability. Denied, unavailable, failed, and uncertain
      results are retained honestly.
- [x] Final output passes through Output Actions and its host sink, and the API
      distinguishes delivery from response generation.
- [x] Each run produces configuration/provenance, ordered events, and a result with
      terminal status. Partial evidence survives module errors, cancellation, and
      uncertain side effects; Observability receipts determine what is called durable.
- [x] The text, tool, and computer scenarios exercise the boundaries described
      above. Memory recall is demonstrated across turns within the documented
      lifetime of its selected implementation.
- [x] A contract-conforming test double replaces one selected module in a kernel
      composition check without adding a second shipped implementation.
- [x] The browser talks only to the Studio API. Existing Studio chat remains a
      deterministic local experiment and does not silently become a live-model path.
- [x] All changed packages pass their independent checks; kernel/assembly checks
      cover normal completion, denied actions, uncertainty, cancellation, and
      evidence failure. Documentation describes run and restart limits.

## Out of scope

- Alternative module implementations and comparative experiments.
- Live model providers, network access, or non-deterministic model output.
- A real browser or desktop driver; computer interactions use a controlled local
  environment fixture.
- A general run-management API or a broader browser evidence-inspection experience;
  this plan updates only the existing chat path if its assembly response needs it.
- Arbitrary plugin discovery/loading, cross-repository packaging, or package
  installation from the UI.
- Production multi-tenant deployment, authentication, distributed run storage, or
  cross-process Observability writers.

## Handoff

After the first assembly is runnable, review which boundaries stayed independent,
which contracts needed revision, and which run evidence is useful. Use those results
to prepare separate plans for module alternatives, broader run/API inspection, and
durable or remote environments. Do not infer that the reference assembly establishes
compatibility for combinations it has not run.

## Progress checkpoint

Completed in the current implementation pass:

- Planning's proposal is passed into Context as explicitly untrusted planning
  material. Control retains loop ownership and the reference Planner does not
  replan after actions.
- Computer actions use Tool Use validation, Safety evaluation, Computer Use, and a
  scoped Environment session. The fixture supports observe/click and records
  before/after verification.
- Safety now has separate explicit allowlists for Environment capabilities, output
  action kinds, and Memory write kinds. Output Actions delivers through the API's
  response-capture sink and its receipt is included in the run result.
- One static, versioned descriptor now selects exactly one package, implementation,
  and configuration for each of the twelve areas. Unknown, duplicate, missing, or
  altered selections are rejected before the constructors are resolved.
- Ordinary Replay, calculator, and computer requests use that same descriptor.
  The Model Interface baseline is owned by `module-model-interface`; its fixed
  scripts are local deterministic fixtures.
- The kernel assigns event IDs, sequence numbers, timestamps, and module sources.
  The Studio API writes config/result artifacts and the JSONL recorder reports
  append and flush acknowledgements. The browser sees status and receipts, not
  filesystem paths.
- API tests exercise text, calculator, computer, and same-session Memory recall.
  Kernel tests exercise Context replacement, computer success/denial/uncertainty,
  output delivery uncertainty, cancellation status, cleanup failure evidence, event
  ownership/order, and recorder uncertainty.

Validation completed: all twelve module package test commands passed; the kernel
suite passed 21 tests; the static assembly suite passed 3; and the Studio API suite
passed 8. The browser app typecheck and generated documentation check passed, as did
the frozen offline workspace install and `git diff --check`. The local `studio`
stack served both `/studio/chat` and the API; a live text turn returned all twelve
components and durable event evidence. A kernel cancellation is stored as
`cancelled`, with partial evidence, rather than being mislabeled `failed`.

Events are currently persisted after the terminal path is known, not streamed during
an active run; abrupt process failure can therefore leave a config without a
terminal result. The fixed deterministic model and in-process Memory/environment
remain local reference fixtures, with the restart and capability limits described
above and in the package docs.
