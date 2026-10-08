# Agent capability awareness and discovery

Status: proposed, implementation not started. Research and repository audit: [agent capability awareness](../../../../docs/research/agent-capability-awareness.md).

## Goal and boundaries

Make agents understand and use their configured tools, connections and skills from catalog data. The frontend, model context, callable schemas and execution permissions must describe the same admitted configuration. This applies to the native Temporal, Restate, Mastra and LangGraph baselines without replacing their orchestration.

Use existing adapters, grants, approval policies and skill loaders. General backend agents remain the target. Filesystem and shell capabilities are optional connected environments, never implicit runtime access. Keep credentials, private transport configuration and host paths out of model inventories and public run evidence.

This is one implementation milestone with separate reviewable commits. Complete the eager path first; deferred discovery is the second part of the same milestone, with explicit exposure controls and acceptance evidence. Do not add unrelated hardening, provider migrations or role-specific agents.

## 1. Resolved inventory and configuration

- [ ] Add a versioned capability inventory derived from profile resolution: source/package IDs, revisions, enabled tools, exact schema references, approval requirements and skill metadata.
- [ ] Separate installed, authorized, active, deferred and unavailable states. Record health observations with timestamps rather than implying configuration availability proves live health.
- [ ] Preserve namespaced tool identifiers and dispatch bindings when servers use duplicate operation names.
- [ ] Add an agent configuration path that combines enabled connections, tools and skills without task-specific role templates. Keep Local safe as an explicit fixture choice.
- [ ] Make enabling a connector's tools an explicit, simple frontend action; do not silently grant every installed service to every agent.
- [ ] Retain immutable run snapshots and define existing-session adoption: keep the admitted configuration until an explicit refresh/new chat, recording any supported refresh as a new configuration revision.

Minimal check: a catalog fixture with two sources, a disabled tool, a write approval and a skill yields the same admitted inventory for the UI and dispatch; excluded tools cannot become callable.

Commit: `feat(capabilities): snapshot resolved agent capability inventories`.

## 2. Generated model context and skills

- [ ] Build concise context from the admitted inventory: enabled service descriptions, how to inspect capabilities, skill names/descriptions and limitations.
- [ ] Keep this generated section separate from persisted user/system instructions and include it in context budgeting.
- [ ] Treat connector descriptions and skill text as capability data; do not promote imported instructions into permission authority.
- [ ] Reuse existing list/load/resource skill operations; include all enabled skills in the metadata index, with bodies loaded only when needed.
- [ ] Preserve loaded skills and the admitted capability revision through compaction and session continuation.
- [ ] Expose an inspection operation returning the run's authorized inventory plus separately observed live availability. Do not expose credentials or ungranted operation definitions.

Minimal check: generated context matches the snapshot, contains no credentials, and session continuation retains user instruction identity and active skill context.

Commit: `feat(context): generate agent capability and skill awareness`.

## 3. Native exposure and discovery

- [ ] Continue declaring all authorized tools eagerly for small catalogs, using their exact input schemas.
- [ ] Add explicit eager/deferred exposure settings and record estimated schema cost. Keep the threshold configurable; choose defaults from measurements rather than a universal tool-count claim.
- [ ] Add bounded search over the admitted, authorized catalog with stable IDs and descriptive results. Search cannot change grants or bypass approvals.
- [ ] Activate discovered definitions before the next model request, making the real tool callable with its recorded schema and binding.
- [ ] Integrate declaration updates with each native adapter. Temporal network work stays in Activities; Restate updates respect replay; LangGraph state/checkpoints retain active definitions; Mastra uses its native tool integration.
- [ ] Persist search/activation events and the active set so resume/replay reproduces model exposure. Activation itself is idempotent metadata work, not execution of the discovered operation.
- [ ] Fail clearly when a recorded schema is unavailable or live authorization is revoked; do not silently replace it with a refreshed schema.

Minimal checks: one shared authorized-search/activation contract and one focused native projection/continuation check per adapter. Verify the next request declares the loaded schema, not merely a prose tool name. Verify deferred writes still require their configured approval.

Commits: shared discovery contract, then native adapter integration in sensible platform chunks. Keep each chunk usable and record any adapter still pending.

## 4. Frontend clarity and retained evidence

- [ ] Show capabilities enabled for this chat separately from all installed workspace connections.
- [ ] Display the admitted revision, enabled tools and skills with progressive disclosure. Keep technical identifiers in details.
- [ ] Offer clear enable/configure actions and explain when a new chat or explicit configuration refresh is needed.
- [ ] Show discovery, skill activation and tool execution distinctly in run inspection.
- [ ] Keep connection failures visible without replacing failed lists with misleading zero counts.

Minimal check: one browser path connecting/enabling a service, opening a new chat and comparing the capability summary with the recorded run configuration. Continue the same chat once to confirm its snapshot remains stable.

Commit: `feat(web): align chat capability views with admitted configuration`.

## 5. Real model acceptance and documentation

- [ ] Use a currently available free, tool-capable model and record its exact provider/model ID and parameters. No paid fallback without the user's instruction.
- [ ] Run the same compact scenario on the four native baselines with matching grants and tools. Keep provider errors and model mistakes separate from harness failures.
- [ ] Ask: "What connected services, tools and skills can you use in this chat?" Compare the answer with the admitted inventory; do not grade stylistic wording.
- [ ] Ask: "Create a temporary note titled capability-awareness-check with body first version, read it, change its body to second version, read it again, then delete only that note." Confirm real CRUD effects and approval handling from service responses.
- [ ] Exercise deferred discovery with the same note scenario using deferred notes tools. Confirm search leads to actual declarations and execution.
- [ ] Ask a procedure task that requires one enabled skill; confirm the model loads its instructions before acting. A skill name mentioned in an answer is not activation evidence.
- [ ] Check one disconnected-service response and one unauthorized-operation attempt. Retain honest failures without repeating trials merely to obtain a pass.
- [ ] Save configuration, model requests/declarations, discovery/activation events, tool results and outcome evidence. Redact credentials and use disposable notes containing no personal data.
- [ ] Update architecture and capability-management guides to describe generated context, exposure, configuration adoption and current limitations.

Run narrow checks and the affected server/web builds once after integration. Expand testing only when failures or changes require it. Do not create a large adversarial suite in this milestone. These acceptance checks establish observed behaviour for the recorded cases, not universal model reliability.

Commit: `docs(evals): record capability awareness acceptance and usage`.

## Expected result

A contributor adds an MCP connector, enables its tools and relevant skills for an agent, and starts a chat. The model receives an accurate generated capability overview and executable tool schemas. With a larger catalog it discovers authorized tools and activates their real definitions. The same behaviour works through each native platform; existing runs retain their recorded configuration and evidence. No connector name is hardcoded into the agent prompt, and no native filesystem environment is required.
