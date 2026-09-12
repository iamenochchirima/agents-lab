# Vercel infrastructure

This directory contains optional infrastructure definitions and documentation for
Vercel services used by Agent Harness Lab experiments.

Potential concerns include:

- AI Gateway configuration and provider routing.
- Vercel Sandbox configuration and lifecycle.
- Vercel Workflow or other durable execution services.
- Deployment configuration and runtime settings.
- Authentication, credentials, quotas, costs, and resource limits.
- Service startup, cleanup, persistence, and failure behaviour.

The Vercel AI SDK implementation belongs under
`platforms/vercel-ai-sdk/`. Keep platform behaviour separate from the hosted services
that support a particular experiment. Do not require Vercel infrastructure for local
experiments that use the AI SDK with a direct model provider.

When infrastructure is added, document the exact service, account or project setup,
runtime versions, required environment variables, external-state implications, and
the local or CI fallback when the service is unavailable. Never commit credentials.
