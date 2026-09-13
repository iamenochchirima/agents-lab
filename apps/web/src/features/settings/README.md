# Settings feature

The settings feature is the user-facing adapter for the global theme and preference
modules. It owns controls for theme mode, accent, density, reduced motion, and live
indicators. It does not define tokens or persistence rules. Those remain in
`app/theme/` so every route receives the same behaviour.
