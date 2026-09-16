# Computer Native follow-on queue

This is a planning queue, not an active implementation plan. The completed workspace
and filesystem category is archived in [Computer Native workspace and filesystem
capability](completed/computer-native-workspace-filesystem.md).

The current maturity status and the full list of remaining product gaps are tracked in
[Computer Native production-readiness gaps](active/computer-native-production-readiness-gaps.md).
The completed plans below record slice completion only. They do not mean that Computer
Native is production-ready.

The next Computer Native components after the completed workspace and filesystem
category are:

1. **Shell and process execution** — completed in
   [Computer Native process execution](completed/computer-native-process-execution.md).
   - Approved command execution, working-directory policy, environment redaction,
     timeouts, output limits, cancellation, and process-result evidence.

2. **Browser interaction** — completed in
   [Computer Native browser interaction](completed/computer-native-browser-interaction.md).
   - Explicit browser/session ownership, navigation and interaction approval, page-content
     limits, download handling, credential boundaries, and browser-run evidence.

3. **Memory** — the first memory foundation slice is complete in
   [Computer Native memory](completed/computer-native-memory.md).
   - Compact user and durable stores, dated working notes, bounded retrieval, explicit
     mutation approval, provenance, retention, deletion, recovery, and memory-operation
     evidence were delivered in that slice. The remaining mature retrieval, compaction,
     privacy, migration, and lifecycle work is tracked in the production-readiness gaps
     document.

4. **Skills**
   - Skill discovery, instruction loading, trust and scope policy, versioning, isolation,
     lifecycle, and skill-use evidence.

5. **Plugins**
   - Plugin discovery, manifest and capability policy, dependency boundaries, lifecycle,
     failure isolation, permissions, and plugin-specific evidence.

6. **External integrations**
   - Provider/API connectors, credential handling, request limits, retries, idempotency,
     webhook or callback handling, failure recovery, and external-operation evidence.

Each follow-on component requires its own implementation plan before work starts. Its plan
must define the boundary, approval and security model, persistence and recovery semantics,
tests, documentation, and a completion gate before the next component begins.
