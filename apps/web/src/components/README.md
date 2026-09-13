# Shared frontend components

Shared presentation modules belong here only when more than one feature needs the same behaviour.

The `ui/` directory contains shadcn-compatible primitives. These primitives should
stay generic and consume the Tailwind token names mapped to the application's CSS
variables. Feature-specific composition belongs in the feature that owns it.

A feature-specific view should remain inside its feature.
