# Studio HTTP contract

This package contains JSON-safe schemas shared by `apps/studio-api` and
`apps/web`. It is separate from `agent-protocol` and module packages so the
browser cannot accidentally acquire runtime, storage, or provider dependencies.

The HTTP contract includes health, chat evidence, and Context comparison records.
The chat evidence version is `6`: it adds `window` as a Context omission reason
while leaving existing chat routes and payload fields unchanged. The Context
comparison endpoints use their own version `1`.

`StudioContextExperimentRequest` and `isStudioContextExperimentRequest` define the
only accepted fixed case, UUID comparison key, and bounded window setting.
`StudioContextExperimentResponse` and `isStudioContextExperimentResponse` define
the exact two strategy records, fixed controls, normal chat evidence, terminal
states, and timestamps. `StudioContextExperimentError` and
`isStudioContextExperimentError` define its path-free error shape.

The runtime validators reject unknown fields and mismatched strategy configuration.
They verify that the window value matches `changedVariable`, that the baseline and
window identities are the registered pair, and that completed run evidence changes
only the Context component from the shared reference assembly. These contracts
describe data crossing the browser/API boundary; module selection and execution
remain server-side.

```sh
pnpm --filter @agent-harness-lab/studio-http-contract typecheck
pnpm --filter @agent-harness-lab/studio-http-contract test
```
