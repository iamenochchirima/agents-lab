# Application

Owns create, start, cancel, observe, and complete run use cases. It coordinates ports
without knowing Fastify, a database, or a platform's internal runtime.

`RunEvidenceStore.writeEvalReport(runId, report)` retains a schema-v1 case report
at `artifacts/eval.json`, limited to 256 KiB. The report records the suite and
grader versions, case, trial, verdict, expected and observed assertions, synthetic
fixture captures, source revision, dirty state, runtime versions, and timestamps.
Configuration remains in each run's immutable `config.json`.

Reports belong to an existing run. Correlated runs must exist and share its
platform and variant; B03 turns must also share a session. Repeating the same
write succeeds, while different content conflicts. Credential-shaped fields use
the ordinary evidence sanitizer. Report reads validate the supported schema and
size; the allowlisted file reader exposes only `artifacts/eval.json`, alongside
the existing evidence files. Missing reports return null from `readEvalReport`.
Unsupported versions, malformed reports, incompatible run references, and
oversized reports fail explicitly. Real provider prompt captures do not belong
in this synthetic baseline report.
