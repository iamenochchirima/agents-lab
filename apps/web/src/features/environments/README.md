# Environments

`environmentCatalog.ts` defines the initial environment profiles and their isolation,
workspace, network, resource-control, lifecycle, and platform-compatibility facts.
`EnvironmentPages.tsx` renders the global catalogue and each profile route.

An environment describes where an agent works. It does not describe the services needed
to operate a platform such as Temporal or Restate. Provisioning adapters will connect to
these views later; until then the UI must show a planned profile, not fake health data.
