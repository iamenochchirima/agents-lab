# models

Owns this variant's provider and model wiring.

Explicit `fake-eval-completion`, `fake-eval-tool`, `fake-eval-context`, and
`fake-eval-loop` fixtures support the four-case development eval. The native model
node emits `EvalModelObserved` with its actual messages and returned calls.
The native tool node emits `EvalToolObserved` with actual dispatch results.
Ordinary fake fixtures and real providers emit neither observation.
These fixtures measure request assembly and execution, not model reasoning.
The loop fixture repeatedly requests calculator work until native limits stop it.
