# Routes

Defines the web application's route composition and route-level loading. The router
is created once in `router.tsx` and passed to React Router's provider at startup.

Route declarations should point to feature page modules rather than contain feature
logic. Layout routes own page chrome and expose nested outlets to their children.
Route-level `lazy` boundaries keep feature code out of the initial bundle, while the
route error boundary gives failed lazy loads and loader errors a deliberate UI.

`/platforms/:platformId` is a nested platform workspace route. Its layout resolves one
typed platform descriptor and provides it to focused child views. `/compare` builds a
shared comparison configuration across registered platforms.

`paths.ts` is the small public-path contract used by navigation and feature links.
Keep route-specific document paths in the documentation feature because they depend
on the generated document catalog.

`/studio/hermes` lazily loads the Hermes agent flow simulation within the shared
application shell. Its source model is browser-local; it requires no agent backend.

`/studio/explorers` indexes source-based agent studies. `/studio/openclaw`,
`/studio/pi` and `/studio/waku` lazily load the shared system explorer with
repository-specific graph data. These routes do not invoke the Studio API or
execute the studied harnesses.

`/studio/comparison` lazily loads the manual four-agent comparison page in the
main shell. Entries are manual study notes saved through the Studio API in SQLite, separate from experiment records.

`/studio/lina` lazily loads the Lina architecture workspace. It authors a design
document through the local Studio API, without executing an agent.
