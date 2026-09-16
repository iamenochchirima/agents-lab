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
server endpoints. It checks the selected platform through the platform-specific health
endpoint rather than requiring every optional platform service to be available.
`RunStatusPanel.tsx` renders the server-derived lifecycle and evidence summary. The
browser never connects to a platform service or reads the local run directory.
Platform-native execution references are displayed through the generic
`executionReference` field rather than a platform-specific response shape. The selected
scenario, server profile, infrastructure, and experiment IDs are retained in the run
manifest so the UI configuration is inspectable and reproducible.

Run responses include a projection state. A stale projection is rendered as a
small status notice and retains the last server-readable run state; the browser
does not manufacture a terminal answer while the platform or evidence store is
unavailable.

`PlatformChatPage.tsx` is the browser-first conversation surface at
`/platforms/<platform>/chat`. It uses the same run API as the controlled run form,
keeps messages visible while a turn is polled, and exposes run activity and context
details through progressive disclosure. Temporal/baseline reuses its server-owned
session ID across turns and restores the model recorded by the active run. Once that
session exists, the model picker is fixed for the conversation; use New chat before
switching models. Other platforms remain honest single-turn surfaces until a
platform-specific context/session adapter exists; Chat does not concatenate browser
history into prompts as a substitute for real context handling.
