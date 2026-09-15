# Platforms

The platform workspace is the main place to prepare one concrete agent run. Each
platform uses `platformCatalog.ts` rather than page-local data.

`PlatformWorkspaceLayout.tsx` owns the platform rail and resolves the selected platform
once. `PlatformRunnerPage.tsx` owns the task surface and compact run controls. It
receives the selected platform through outlet context. `CompareRunModal.tsx` owns the
in-context multi-platform selection flow; it deliberately has no execution behavior.

The Temporal baseline is the first runnable path. `platformApi.ts` is the only browser
module that knows the server endpoints, and `RunStatusPanel.tsx` renders the
server-derived lifecycle and evidence summary. The browser never connects to a
platform service or reads the local run directory. Other platform actions remain
unavailable until a runner and contract exist. Platform-native execution references
are displayed through the generic `executionReference` field rather than a
Temporal-specific response shape.
