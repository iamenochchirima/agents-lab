# Computer Native follow-on queue

This is a planning queue, not an active implementation plan. The completed workspace
and filesystem category is archived in [Computer Native workspace and filesystem
capability](completed/computer-native-workspace-filesystem.md).

After that category reaches its completion gate, the next Computer Native components are:

1. **Shell and process execution** — completed in
   [Computer Native process execution](completed/computer-native-process-execution.md).
   - Approved command execution, working-directory policy, environment redaction,
     timeouts, output limits, cancellation, and process-result evidence.

2. **Browser interaction** — completed in
   [Computer Native browser interaction](completed/computer-native-browser-interaction.md).
   - Explicit browser/session ownership, navigation and interaction approval, page-content
     limits, download handling, credential boundaries, and browser-run evidence.

3. **Memory**
   - Explicit memory stores, read/write approval boundaries, provenance, retention,
     deletion, retrieval limits, and memory-operation evidence.

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
