# Studio chat test slice

**Created:** `2026-09-25`
**Status:** Complete, 2026-09-25
**Owner:** Agent Harness Lab

## Purpose

Give contributors a small, browser-accessible way to exercise the first connected
Studio module assembly. A message entered in the Studio chat goes through the
server-hosted reference assembly, and the browser can inspect what Context actually
passed to the model interface.

This is an intentional early integration slice. It pulls a minimal Control and
deterministic Model Interface implementation forward so Input, Memory, and Context
can be exercised together in a real request/response loop before all twelve module
areas have baselines. It does not complete the remaining Stage 2 work or implement
the general kernel/experiment system.

## User-visible outcome

From the existing Studio page, a contributor can open a chat, submit text, receive a
clearly labeled deterministic replay response, and inspect the current turn's
component evidence. The browser calls Studio over HTTP. It does not load or execute
Studio module code.

## First fixed assembly

```text
Browser text
  → Studio API validates and assigns source identity/trust/time
  → Input normalizes it
  → Memory recalls session records and optionally stores this user message
  → Context assembles instructions, bounded prior turns, recalled Memory, and task
  → Control requests one model completion and delivers its final text
  → deterministic Replay Model Interface returns diagnostic text, no provider call
  → Studio API returns the response and turn evidence to the browser
```

The default Replay assembly is fixed in this slice. Each part remains in its own
package and is called through its role-specific contract. The API host owns HTTP
validation and session lifetime; it does not own module algorithms. A later fixed
Calculator scenario extends the chat with Tool Use, Safety, and Execution Environment;
it does not make every combination of implementations compatible.

## Contracts and responsibilities

- **Input:** receives raw text and host-assigned provenance; returns normalized task
  material.
- **Memory:** recalls candidates within one local session; writes a user message only
  when the contributor selects the per-message Memory option. It does not persist
  across process restart.
- **Context:** consumes normalized task material, prior user/assistant turns, and
  retrieved Memory candidates. It returns ordered model messages plus included and
  omitted source evidence. It owns bounded-history selection and does not own stored
  Memory records.
- **Control:** performs one bounded model turn through explicit kernel ports. No
  tools are offered by this assembly.
- **Model Interface:** receives the exact Context messages and returns a deterministic
  diagnostic response. It does not call an LLM or claim semantic task completion.
- **Kernel/reference assembly:** connects the modules and tracks per-turn lifecycle
  and exchange evidence. The fixed assembly is selected by code, not dynamically
  loaded from browser configuration.
- **Studio API:** validates the public JSON request, assigns untrusted user source
  metadata, scopes sessions, invokes the reference assembly, and returns a safe JSON
  projection.
- **Web UI:** owns the visible transcript and inspection disclosure; it never imports
  role-module packages.

## Evidence shown per turn

Return the concrete assembly, package versions, implementation identities,
configurations, run and turn identifiers,
Input normalization result, Memory recall/write receipts, exact ordered Context
messages, included/omitted sources and reasons, token count and basis, and the
Replay Model identity/result. This response is transient diagnostic evidence; this
slice does not create a durable `lab/runs/<run-id>/` record or benchmark metric.

## Limits and interpretation

- The deterministic reply exists to prove module wiring and model-request delivery;
  it says nothing about answer quality or model behavior.
- The default Replay assembly does not execute Planning, Tool Use, Computer Use, Execution
  Environment, Output Actions, Safety, or an Observability module.
- The HTTP response is the local output sink; do not label it as an Output Actions
  implementation.
- Memory is process-local and session-scoped. Clearing the chat closes that Memory
  session. Restarting the API loses all Memory state and server-side turn state.
- This is a fixed first assembly, not dynamic plugin loading, package distribution,
  compatibility negotiation, or separate service deployment.
- Do not expose fabricated metrics, tool activity, durable runs, or real-provider
  status in the UI.

## Completion checks

- [x] A contributor can start the API and web app using documented commands, then
      open the Studio chat from the existing Studio experience.
- [x] A sent message reaches Input through the API and produces a response through
      Control and Replay Model Interface.
- [x] Multiple turns are assembled into model messages in a documented order, with
      omitted history visible when the Context budget requires it.
- [x] The Memory checkbox controls whether the submitted user message is persisted
      in the in-memory Memory session; the receipt is shown.
- [x] The inspector shows which implementation packages ran and the exact messages
      passed to Replay.
- [x] The UI labels Replay and all unimplemented roles truthfully.
- [x] API input validation, session clearing, cancellation/shutdown behavior, and
      bounded server-side session retention are documented.
- [x] The existing Platform Lab chat and static Components preview keep their own
      behavior and ownership.
- [x] Relevant package/API/UI checks are recorded for review.

## Validation record

- Studio API typecheck, HTTP/API tests, and web production build passed.
- A headless Chrome run opened `/studio/chat`, ran the fixed calculator scenario,
  displayed both Context requests and correlated call/result evidence, showed Safety
  and environment evidence, and cleared the session with **New chat**.
- A user-provided browser screenshot shows `HI` returned a Replay response reporting
  two Context messages. This confirms the basic one-turn browser path.
- A fresh temporary API session confirmed that the next request received prior user
  and assistant turns and that an opted-in Memory write was recalled as a Context
  candidate. The test conversation was deleted afterward.
- API documentation covers validation, process-local sessions, eviction, cancellation,
  shutdown, and cleanup. API tests close the app after each run.

## Next work

The completed [deterministic tool round-trip slice](studio-tool-roundtrip.md)
adds a bounded action through Tool Use, Safety, and Execution Environment. Use the
working baseline to plan the remaining Studio role components and refine their
contracts before introducing alternatives.
