# Application modules

Owns frontend startup, layouts, navigation, global providers, and
application-wide configuration. Route composition lives beside it in `routes/` so
the startup entry point stays small and the layouts do not become route registries.

Feature behaviour belongs in the features directory. Layouts provide route outlets;
they should not contain feature data or page-specific rendering.
