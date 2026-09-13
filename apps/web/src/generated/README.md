# Generated document catalog

`document-catalog.ts` and `document-content.ts` are generated from the repository's
Markdown files and file tree. The catalog contains metadata and the repository map;
the content module contains Markdown bodies and is loaded only by documentation
routes. This gives the web application a typed, build-time view of the documentation
without making the UI the source of truth.

Do not edit the generated TypeScript file by hand. From `apps/web`, run:

```bash
npm run generate:docs
```

The generated files are ignored by Git and are recreated by `npm run dev` and
`npm run build`.
