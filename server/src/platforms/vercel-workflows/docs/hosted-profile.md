# Hosted profile

The bounded baseline is local-only. A hosted Vercel profile is not marked complete
by this change because the repository does not yet own a Vercel project, deployment
credentials, or a reproducible hosted smoke-test environment.

The official deployment shape is a generated standalone Workflow bundle exposed at
`/.well-known/workflow/v1/flow` plus the generated webhook route and manifest. The
Vercel deployment must use the same `workflow` SDK version as the build and must
provide the hosted World expected by that deployment profile.

Before enabling a hosted profile, verify:

- the build output and `workflow` package version in a disposable Vercel project;
- native deployment and workflow run IDs are captured without credentials;
- retries, cancellation, suspension/resumption, retention, and restart behaviour;
- the hosted result can be collected after the client process exits;
- rollback to the previous deployment leaves already accepted runs inspectable.

References:

- [Vercel Workflow repository](https://github.com/vercel/workflow)
- [Fastify integration guide](https://github.com/vercel/workflow/blob/main/docs/content/docs/v5/getting-started/fastify.mdx)
- [Vite integration guide](https://github.com/vercel/workflow/blob/main/docs/content/docs/v5/getting-started/vite.mdx)
- [Workflow testing guide](https://github.com/vercel/workflow/blob/main/docs/content/docs/v5/testing/index.mdx)
- [Local World README](https://github.com/vercel/workflow/blob/main/packages/world-local/README.md)
- [Vercel deployment overview](https://vercel.com/docs/deployments/overview)
