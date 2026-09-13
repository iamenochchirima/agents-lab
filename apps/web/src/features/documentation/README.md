# Documentation feature

The documentation feature is a separate application shell, not a page inside the
main workspace shell. `DocumentationLayout` owns the docs header and the connection
back to the lab. `DocumentationView` owns the searchable document navigation and
reading column for Markdown from the repository's generated build-time catalog.
Mermaid blocks are rendered as diagrams.

Keep document content in the repository's Markdown files rather than embedding prose
in frontend modules. `documentSource.ts` joins generated document metadata with the
generated content payload only for routes that render Markdown. The application
sidebar lives in `app/layouts/MainLayout.tsx` and `app/navigation/MainSidebar.tsx`;
this feature owns the separate documentation layout and its navigation.
