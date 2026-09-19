# Restate baseline source and repository audit

**Audit date:** 2026-09-19T21:40:44+02:00  
**Scope:** The Restate baseline completion plan and its local implementation boundary.  
**Method:** Current first-party Restate documentation, the installed repository packages,
and the existing Restate adapter were compared. This note records implementation constraints;
it is not evidence that the Lab already satisfies them.

## Source-backed constraints

- The TypeScript service path requires a current Node.js runtime; the official service guide
  currently states Node.js 22 or newer. See [TypeScript services](https://docs.restate.dev/develop/ts/services).
- External and non-deterministic work must be isolated in durable `ctx.run` steps so that
  Restate can journal and replay the step result. See [durable steps](https://docs.restate.dev/develop/ts/durable-steps).
- Restate workflows are keyed executions. A workflow key is an identity boundary, not a
  replacement for the Lab's session and turn IDs. See the workflow section of the
  [TypeScript services guide](https://docs.restate.dev/develop/ts/services) and the
  [TypeScript invocation client](https://docs.restate.dev/services/invocation/clients/typescript-sdk).
- Errors are retryable by default unless the service configures a different policy. The
  baseline must set bounded retry behaviour rather than inheriting an unbounded default.
  See [error handling](https://docs.restate.dev/guides/error-handling).
- Invocation cancellation and deletion are separate administrative operations. The Lab must
  record cancellation requested versus cancellation observed, rather than claiming an
  immediate kill. See [cancel an invocation](https://docs.restate.dev/admin-api/invocation/cancel-an-invocation).
- Restate exposes service and invocation introspection. The adapter may use those native
  views for reconciliation, but native details must remain behind the platform boundary.
  See [service introspection](https://docs.restate.dev/services/introspection).
- Local server configuration and installation are separate from the TypeScript service.
  The plan must document the exact server binary/profile, readiness checks, ports, and
  persistent data directory. See [server configuration](https://docs.restate.dev/references/server-config)
  and [installation](https://docs.restate.dev/installation).

## Repository findings

- The installed baseline was previously verified around `restate-server 1.7.10`,
  `@restatedev/restate-sdk 1.17.0`, and `@restatedev/restate-sdk-clients 1.17.0`.
  The implementation plan treats these as pins to verify, not as an excuse to skip a
  compatibility check.
- The native local profile is the required path. Docker is optional and must not be a
  completion prerequisite.
- The common server owns normalized `lab/runs/` evidence. The Restate service must not
  write those records directly.
- The existing runner is run-oriented. One chat turn maps to one Lab run and one Restate
  workflow key; multiple turns share a Lab session but receive distinct run/workflow
  identities. A future Restate Virtual Object session model is a separate experiment.
- The existing browser and native integration work already covers stable client-turn retry,
  two-turn session continuity, context display foundations, duplicate workflow submission,
  cancellation, and a no-Docker direct runner path. Those are verified foundations, not the
  end-to-end completion gate.

## Required implementation consequences

1. Do not treat a durable Restate workflow as proof that an OpenRouter request ran exactly
   once. A provider call that may have succeeded before a lost response must be represented
   as unknown or recovery-required unless the provider call is independently idempotent.
2. Put model and tool calls behind named durable steps and preserve native replay facts in
   evidence. A replayed step result must not be mistaken for a second provider call.
3. Test service replacement, Lab-server replacement, and Restate restart with isolated
   persistent data and deterministic fixtures before relying on a live provider.
4. Keep context admission, compaction, and settlement in the shared ContextService while
   carrying model-specific context limits through the Restate manifest and evidence.
5. Treat readiness, native status, normalized run status, and provider outcome as different
   observations. Do not collapse them into a single generic `failed` or `completed` value.

## Official references

- [TypeScript services](https://docs.restate.dev/develop/ts/services)
- [Durable steps](https://docs.restate.dev/develop/ts/durable-steps)
- [Error handling](https://docs.restate.dev/guides/error-handling)
- [Cancel an invocation](https://docs.restate.dev/admin-api/invocation/cancel-an-invocation)
- [TypeScript invocation clients](https://docs.restate.dev/services/invocation/clients/typescript-sdk)
- [Service introspection](https://docs.restate.dev/services/introspection)
- [Server configuration](https://docs.restate.dev/references/server-config)
- [Installation](https://docs.restate.dev/installation)
