# Experiments

`experimentCatalog.ts` provides the initial experiment choices for the platform Run and
Compare and Chat configuration views. The fault choices describe future fault plans
and do not inject faults from the browser. **Free model capability trial** selects
the existing server-owned `agent-capabilities-live` controls: approved model IDs,
fresh zero-price catalog validation, zero-price routing with fallback disabled,
and a 2,048-token output allowance. Choose the model separately; an ineligible
selection is rejected rather than replaced. Selecting this mode does not run
the capability suite or assign a grade to an interactive conversation.

Experiment implementations, analyzers, and tests continue to belong under the
`lab/experiments/` directory.
