# models

Owns this variant's provider and model wiring.


The explicit `fake-eval-completion`, `fake-eval-tool`, `fake-eval-context`, and
`fake-eval-loop` fixtures support the four-case baseline eval. They retain the
actual mapped request as a synthetic-only observation in the model result. The
native loop publishes `EvalModelObserved` with the request and returned tool
calls, and `EvalToolObserved` with each actual dispatch result. Ordinary fake
fixtures and real providers emit neither capture. These observations exercise
request assembly and tool feedback; they do not measure model reasoning quality.
The loop fixture keeps requesting calculator calls so the native call and round
limits determine its terminal result.
