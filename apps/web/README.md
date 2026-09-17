# Web application

This is the React, TypeScript, and Vite interface for Agent Harness Lab.

The first UI slice is a small application shell with a persistent sidebar:

- Overview, which describes the current planning state without fabricating run data.
- Coverage, an expandable implementation map across platforms, layered compositions, harness variants, environments, infrastructure, capabilities, scenarios, and experiments.
- Runs, Experiments, Platforms, and Scenarios, each with an honest initial empty state.
- Docs, rendered from Markdown files stored in the repository with conventional document navigation.

The Docs item is pinned to the bottom of the application sidebar. It navigates to the
documentation view, which has its own document navigation. The two sidebars are
separate because one navigates the product and the other navigates written project
material. Architecture and repository mapping are reached from the overview and docs.

Routes use the browser history API, so these are real paths rather than hash routes:

```text
/                         application overview
/coverage                 interactive harness coverage document
/runs                     run workspace
/architecture             architecture explorer
/repository               repository map
/settings                 application appearance settings
/docs                     documentation home
/docs/architecture/...    individual Markdown document
```

`src/routes/router.tsx` composes the route tree. `app/layouts/` owns the two layout
shells, `app/navigation/` owns application navigation, and each feature owns its page
entry point and view components. Route-level lazy loading keeps new feature areas
isolated as the UI grows.

The coverage page is backed by typed repository data in `src/features/coverage/`.
It derives status from completed checklist gates and linked evidence; an omitted
assessment is displayed as not assessed. The page is read-only so coverage claims
remain ordinary, reviewable source changes.

The styling foundation follows the dashboard's Tailwind and shadcn-compatible setup.
Tailwind utilities use the CSS variables defined in `src/app/theme/theme.css`, while
the theme and preference modules apply light/dark mode, accent, density, and motion
settings at the document root. IBM Plex Sans Variable is the current interface font
and IBM Plex Mono is used for code and technical values; both are bundled locally.
Settings are available at `/settings`.

The Temporal runner calls the Fastify API through `VITE_AGENTLAB_API_URL`. It
defaults to `http://127.0.0.1:4318` for local development. The browser never
receives a provider credential.

Platform runner and Compare pages use the shared `features/models/ModelPicker`.
It searches the server's OpenRouter catalog through `GET /api/models`; the selected
model ID is sent with a run, while the OpenRouter key remains in the server and
platform process environments.

The web application remains a consumer of laboratory data and documentation. It does
not execute harness logic or become a second metrics implementation. When deployed
behind a static web server, the server must serve `index.html` for these application
paths so the browser router can resolve them.

Run `pnpm install` from the repository root and then `pnpm run dev` from this directory. The development command
generates a temporary document catalog before starting Vite. The generated catalog is
ignored because the Markdown files remain the source of truth.
