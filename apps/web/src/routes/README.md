# Routes

Defines the web application's route composition and route-level loading. The router
is created once in `router.tsx` and passed to React Router's provider at startup.

Route declarations should point to feature page modules rather than contain feature
logic. Layout routes own page chrome and expose nested outlets to their children.
Route-level `lazy` boundaries keep feature code out of the initial bundle, while the
route error boundary gives failed lazy loads and loader errors a deliberate UI.

`paths.ts` is the small public-path contract used by navigation and feature links.
Keep route-specific document paths in the documentation feature because they depend
on the generated document catalog.
