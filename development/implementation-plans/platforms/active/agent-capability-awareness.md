# Agent capability awareness and discovery

Status: in progress. The eager capability-awareness path is implemented across the four baseline adapters; real-model acceptance remains. Research and repository audit: [agent capability awareness](../../../../docs/research/agent-capability-awareness.md).

## Goal and boundaries

Make agents understand and use their configured tools, connections and skills from catalog data. The frontend, model context, callable schemas and execution permissions must describe the same admitted configuration. This applies to the native Temporal, Restate, Mastra and LangGraph baselines without replacing their orchestration.

Use existing adapters, grants, approval policies and skill loaders. General backend agents remain the target. Filesystem and shell capabilities are optional connected environments, never implicit runtime access. Keep credentials, private transport configuration and host paths out of model inventories and public run evidence.

This milestone first makes each run's existing admitted tools and skills legible to its model. Existing adapters already send executable schemas, so a connector can join a selected profile without a connector-specific runtime change. Keep eager declarations while catalogs remain manageable. Deferred search is a follow-up only when measured schema size or tool-selection failures show a need; do not build it speculatively. Do not add unrelated hardening, provider migrations or role-specific agents.

## 1. Resolved inventory and configuration

- [x] Add a versioned inventory derived from profile resolution: selected source/package IDs and versions, enabled tool names, risk and approval modes, skill metadata, and the exact callable tool-catalog revision.
- [x] Keep installed workspace services distinct from tools admitted to a run. Only authorized, active tools enter the model inventory; unselected connections do not become callable or get advertised.
- [x] Preserve namespaced tool identifiers and dispatch bindings when servers use duplicate operation names.
- [x] Reuse the existing profile configuration path to combine enabled connections, tools and skills without task-specific role templates. Keep Local safe as an explicit fixture choice.
- [x] Enabling a connector's tools remains an explicit profile choice; installed services are not silently granted to every agent.
- [x] Retain immutable run snapshots. A new run admits the current profile/catalog; an existing run keeps its recorded configuration.

Minimal check: a catalog fixture with two sources, a disabled tool, a write approval and a skill yields the same admitted inventory for the UI and dispatch; excluded tools cannot become callable.

Commit: `feat(capabilities): snapshot resolved agent capability inventories`.

## 2. Generated model context and skills

- [x] Build concise generated context from the admitted inventory: source IDs, enabled tools, risk/approval state, available skills and activation status. Exact tool descriptions and schemas remain in callable declarations; skill descriptions remain in existing skill discovery tools.
- [x] Keep generated context separate from persisted user/system instructions and include it in context budgeting.
- [x] Keep imported skill instructions out of authority decisions; the generated inventory contains bounded metadata, not imported procedure text.
- [x] Reuse existing list/load/resource skill operations; skill bodies load only when needed or explicitly selected.
- [x] Preserve the capability revision with the run and context snapshot; context snapshots survive compaction and session continuation.
- [x] Expose the admitted inventory in the chat run details. Live connector health remains a separate observation from model authority.

Minimal check: generated context matches the snapshot, contains no credentials, and session continuation retains user instruction identity and active skill context.

Commit: `feat(context): generate agent capability and skill awareness`.

## 3. Native exposure and deferred discovery

- [x] Declare every tool authorized by the selected profile eagerly, using its exact admitted schema.
- [ ] Measure actual schema-token cost and tool-selection quality before introducing eager/deferred settings. Current catalogs have not shown a measured need for a search round trip.
- [ ] If measurements justify it, add bounded search over only the admitted catalog. Search must not change grants or bypass approvals.
- [ ] If deferred tools are introduced, activate the exact recorded definition before the next model request; returning only a tool name or schema as prose is insufficient.
- [ ] Implement deferred declaration updates per native adapter only after the measured need is established. Preserve Temporal Activity, Restate replay, LangGraph checkpoint and Mastra SDK semantics.
- [ ] If deferred discovery is introduced, persist search/activation and active-set events so resumption reproduces model exposure.
- [ ] If deferred discovery is introduced, fail clearly when the recorded schema is unavailable or live authorization is revoked; never silently substitute a refreshed schema.

Minimal checks: one shared authorized-search/activation contract and one focused native projection/continuation check per adapter. Verify the next request declares the loaded schema, not merely a prose tool name. Verify deferred writes still require their configured approval.

Deferred follow-up: a measured catalog-size/selection study, then shared discovery and native adapter chunks only if that evidence supports the added loop complexity.

## 4. Frontend clarity and retained evidence

- [x] Show capabilities enabled for this chat separately from all installed workspace connections.
- [x] Display the admitted profile, tool-catalog revision, enabled tools and skills with progressive disclosure.
- [x] Reuse profile selection and the Plugins capability-management view for enable/configure actions.
- [x] Show loaded skills and tool execution in run inspection; discovery events remain a future feature because deferred discovery is not implemented.
- [x] Keep connection failures visible without replacing failed lists with misleading zero counts.

Minimal check: one browser path connecting/enabling a service, opening a new chat and comparing the capability summary with the recorded run configuration. Continue the same chat once to confirm its snapshot remains stable.

Commit: `feat(web): align chat capability views with admitted configuration`.

## 5. Real model acceptance and documentation

- [ ] Use a currently available free, tool-capable model and record its exact provider/model ID and parameters. No paid fallback without the user's instruction.
- [ ] Run the same compact capability-awareness scenario on the four native baselines with matching grants and tools. Keep provider errors and model mistakes separate from harness failures.
- [ ] Ask: "What services, tools and skills are enabled for you in this chat?" Compare the answer with the admitted inventory; do not grade stylistic wording.
- [ ] Ask: "Create a temporary note titled capability-awareness-check with body first version, read it, change its body to second version, read it again, then delete only that note." Confirm real CRUD effects and approval handling from service responses.
- [ ] Defer search/activation evaluation until catalog measurements justify implementing deferred tool exposure.
- [ ] Ask a procedure task that requires one enabled skill; confirm the model loads its instructions before acting. A skill name mentioned in an answer is not activation evidence.
- [ ] Check one disconnected-service response and one unauthorized-operation attempt. Retain honest failures without repeating trials merely to obtain a pass.
- [ ] Save configuration, model requests/declarations, discovery/activation events, tool results and outcome evidence. Redact credentials and use disposable notes containing no personal data.
- [ ] Update architecture and capability-management guides to describe generated context, exposure, configuration adoption and current limitations.

Run narrow checks and the affected server/web builds once after integration. Expand testing only when failures or changes require it. Do not create a large adversarial suite in this milestone. These acceptance checks establish observed behaviour for the recorded cases, not universal model reliability.

Commit: `docs(evals): record capability awareness acceptance and usage`.

## Implementation progress

The first implementation slice adds the server-derived inventory to each admitted run and injects a bounded generated message into the model's prepared context. Temporal, Restate, Mastra and LangGraph pass the same immutable inventory into their native context preparation. The exact callable schemas are still supplied through each platform's existing tool declaration path. The run details view displays the same inventory, including the profile and tool-catalog revision. No connector name or tool list is hardcoded into the baseline system instruction.

Before the real-model acceptance phase, verify the implementation with narrow server and frontend checks, then record the exact free model, configuration, results and any platform availability limits here. The existing `local-safe` profile is a fixture choice; a connected service appears to a model only after its tools are selected in the active profile.

### Validation record

- Server and web typechecks pass; the server build passes.
- Focused suites pass: capability catalog (8), context service (3), run service (22), HTTP API (16), Temporal adapter projection (1), Restate runner (15), and Mastra runner (14).
- The LangGraph Python test file passes syntax parsing, but `pytest` is unavailable in this environment. LangGraph and Mastra workflow integration tests that bind local mock servers are blocked by `listen EPERM`; the non-listener Mastra runner tests pass.
- A real-model run and visual browser verification are still pending. No paid-model fallback has been used.

## Expected result

A contributor adds an MCP connector, enables its tools and relevant skills in a profile, and starts a chat. The model receives a generated overview of the admitted tools, approval requirements and available skills alongside executable tool schemas. The chat details show the same run snapshot. The same eager behaviour works through each native platform, and existing runs retain their recorded configuration and evidence. A deferred search loop remains an evidence-triggered follow-up, not an assumption. No connector name is hardcoded into the agent prompt, and no native filesystem environment is required.
