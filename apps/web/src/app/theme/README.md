# Theme system

The theme system is the web application's styling seam. Components consume CSS
variables such as `--surface`, `--text-1`, `--accent`, and `--border`; they should not
choose page-level colours directly.

`theme.tsx` owns the light, dark, and system mode. `preferences.ts` owns persisted
accent, density, and interface preferences and applies them to the document root.
Both modules tolerate unavailable browser storage and keep their state independent of
individual pages.

The bundled typefaces are also selected at this seam. The application uses IBM Plex
Sans Variable for interface text and IBM Plex Mono for code and technical values.
Fontsource packages are imported from `src/main.tsx`, so the app does not depend on a
third-party font CDN at runtime. Change `--font-sans` or `--font-mono` here when
testing another typography direction.

To add a visual tone, add an `AccentPreset` rather than changing colours in a page.
To add a new global preference, update the preference state, document-root mapping,
and the settings page together.
