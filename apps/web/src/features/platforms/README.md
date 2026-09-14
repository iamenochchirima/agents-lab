# Platforms

The platform workspace is the main place to prepare one concrete agent run. Each
platform uses `platformCatalog.ts` rather than page-local data.

`PlatformWorkspaceLayout.tsx` owns the platform rail and resolves the selected platform
once. `PlatformRunnerPage.tsx` owns the task surface and compact run controls. It
receives the selected platform through outlet context. `CompareRunModal.tsx` owns the
in-context multi-platform selection flow; it deliberately has no execution behavior.

The runner view collects configuration only. It must not simulate execution, run state,
or metrics before a real runner exists. Environment, infrastructure, and variant choices
stay compact because they affect a run but should not displace the task itself.
