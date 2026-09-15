# Platforms

The platform workspace is the main place to prepare one concrete agent run. Each
platform uses `platformCatalog.ts` rather than page-local data.

`PlatformWorkspaceLayout.tsx` owns the platform rail and resolves the selected platform
once. `PlatformRunnerPage.tsx` owns the task surface and compact run controls. It
receives the selected platform through outlet context. `CompareRunModal.tsx` owns the
in-context multi-platform selection and starts one generic run per selected baseline.
Each result is polled through the same run API as a single-platform run.

`platformCatalog.ts` is the source of truth for which baselines are ready to appear in
the run and compare flows. `platformApi.ts` is the only browser module that knows the
server endpoints, and `RunStatusPanel.tsx` renders the server-derived lifecycle and
evidence summary. The browser never connects to a platform service or reads the local
run directory. Platform-native execution references are displayed through the generic
`executionReference` field rather than a platform-specific response shape. The selected
scenario, server profile, infrastructure, and experiment IDs are retained in the run
manifest so the UI configuration is inspectable and reproducible.
