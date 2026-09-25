---
status: accepted
---

# Put Studio modules in a product tree with a separate API host

Studio-owned runtime code and role packages live under the top-level `studio/`
directory. Its browser application stays in `apps/web/`, and its HTTP host lives in
`apps/studio-api/`. The existing `server/` remains focused on the Platform Lab.
The web application communicates with Studio through JSON-safe HTTP contracts; it
does not import or execute agent modules.

This boundary lets module packages be developed and checked without starting either
the browser or Platform Lab server. The browser can still operate Studio through an
ordinary HTTP boundary. All code may remain in this monorepo initially; separate
repositories and processes can be considered when release, ownership, or isolation
needs justify them.

## Considered options

- **Keep Studio in `server/`:** rejected for the new modular implementation because
  it couples module development to the Platform Lab service package and makes the
  browser-facing Studio host share unrelated bootstrapping.
- **Put each module in a separate repository or service now:** rejected because
  independent package boundaries provide the needed development and testing seams
  without immediate release, deployment, and operations overhead.
- **Place Studio code under `studio/`, expose it through a separate API, and keep the
  browser client HTTP-only:** accepted because it provides independent ownership
  while retaining simple local development in one repository.

## Consequences

The workspace must include `studio/*` and `studio/modules/*`. Shared run semantics,
role-specific module contracts, and browser HTTP schemas remain separate packages.
The Studio API owns HTTP configuration and lifecycle; it must not import the Lab
server. The web app depends only on the client-safe HTTP contract. The existing
`server/src/studio/` implementation remains during transition; this decision does
not migrate its routes or stored data. A focused migration/removal plan must resolve
that legacy surface before claiming it has been retired. Older completed plans remain
historical evidence of the prior implementation.
