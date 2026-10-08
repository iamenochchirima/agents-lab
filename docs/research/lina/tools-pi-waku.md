# Tools, connections, packages and skills in Pi and Waku

## Scope and evidence

Static source audit on 2026-10-07, using Pi `a276dabe57911253350bffb93cb7d7aff6a73261` and Waku `24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01`. Pi was inspected from its existing isolated bare Git repository; Waku through `git show` at the pinned revision, rather than the sibling checkout's newer HEAD. Official GitHub pages were also opened. No real accounts, credentials, model calls, server connections or upstream tests were exercised. Source assertions describe these revisions, not every version of either product. Current MCP specification requirements are covered separately in the synthesis report; these implementations are not evidence of conformance to every current requirement.

A significant correction: **Pi at this revision has built-in MCP support**, implemented as a built-in coding-agent extension and a dedicated MCP client package. Older descriptions that Pi only supports MCP through third-party extensions do not describe this source revision. An installed replacement extension can still supersede built-in session MCP support. Waku has its own optional native MCP bridge.

## Responsibility map

| Responsibility | Pi | Waku |
| --- | --- | --- |
| Tool declaration and executable implementation | Agent tool definitions; coding-agent extension registry | `Tool` plus `ToolRegistry` |
| Remote MCP connection | Built-in MCP extension and `packages/mcp` | Optional `MCPBridge` using Python MCP SDK |
| Model-provider credentials | Core `AuthStorage` | Model client configuration, separate from connector credentials |
| Remote connector credentials | MCP OAuth store or configured headers | MCP per-server token store or environment bearer key; connector-specific auth for Google/gh |
| Package/plugin contribution | Packages distribute executable extensions, skills, prompts and themes | Fixed built-in factories and opt-in modules; no comparable general plugin runtime found in reviewed path |
| Skill routing | Advertise metadata; model reads body or explicit skill command | Deterministic keyword match; inject matched bodies |
| Tool batch | Parallel default with sequential override | Sequential loop |

Sources: [Pi agent](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/agent/src/agent.ts), [Pi provider auth](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/auth-storage.ts), [Pi MCP runtime](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/extensions/mcp/runtime.ts), [Waku registry assembly](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/__init__.py), [Waku registry](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/registry.py).

## Pi: connections and authentication

Pi distinguishes user configuration from project configuration, and project trust gates project MCP configuration and package loading. Stdio uses executable, argument vector, environment and working directory; remote connections use Streamable HTTP and headers/OAuth. Legacy SSE is explicitly rejected. Startup connects enabled servers in the background; direct tools receive a bounded first-prompt wait, while indirect discovery waits when needed. Invalid entries are isolated rather than preventing every server from connecting.

The runtime exposes `connecting`, `connected`, `disconnected`, `needs-auth`, `failed` and `closed`. A dropped connection becomes disconnected and reconnects lazily on a later request. Tool-list-change notifications refresh declarations; stale tools become unreachable. Startup discovery and reconnect are therefore connection lifecycle operations, distinct from running a side-effecting tool.

Sources: [MCP configuration and lifecycle](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/docs/mcp.md), [connection owner](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/extensions/mcp/runtime.ts#L154-L469).

MCP OAuth credentials belong to the normalized server namespace **and URL**, separate from model-provider login. The auth store supports migration from older URL-only keys, coordinated refresh within the process and cross-process refresh locks when configured, and shutdown waiting for refresh completion. This matters when rotating refresh tokens: parallel tool calls must not each independently consume the same refresh token.

The pinned official guide describes protected-resource/authorization-server discovery, browser authorization, dynamic registration, configured client IDs where registration is unavailable, and client-ID-metadata-document support. Login is explicit; a normal connection that needs consent exposes `needs-auth` rather than silently opening a browser during a tool call. Configured authorization headers take precedence over OAuth selection. Logout removes stored credentials. Callback and token handling belong to the harness credential service; credentials never need to enter the model-facing tool schema.

Sources: [OAuth store and flow owner](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/extensions/mcp/oauth.ts), [protocol authorization flow](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/mcp/src/oauth/flow.ts), [separate provider credential owner](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/auth-storage.ts).

The runtime retries transient connection setup errors, and retries eligible read-only resource requests. It deliberately does not replay tool calls after a generic transient HTTP error because they may already have run. One narrow exception in `withClient` handles an MCP session-expired response: reconnect and replay once, based on the implementation's interpretation that an unknown session request did not execute. Lina should document any such replay guarantee against the protocol and adapter, rather than generalize this exception to arbitrary network failure.

Source: [request retry classification](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/extensions/mcp/runtime.ts#L285-L314).

## Pi: registry, adapters and exposure

The MCP adapter preserves the server's wire tool name while producing a model-compatible public name. Configuration naming rules reject namespace collisions; tool-name normalization can add hash suffixes for collisions. Tool definitions carry input/output schemas, namespaces and available server annotations. The executable adapter obtains the live client and invokes the wire name, forwarding cancellation, timeout and progress. Server annotations are available to permission extensions, but they are server-provided hints, not proof that an operation is safe.

The adapter retains the complete MCP `CallToolResult` for script consumption, including `content`, `structuredContent` and `isError`, and creates a model-visible representation separately. Large text can be truncated with a full-output file reference; non-text blocks are handled explicitly. Direct calls report `isError` as an error while codemode scripts can inspect the result. This separation is more useful than flattening everything into a success-looking string.

Source: [MCP declaration, invocation and result adapter](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/extensions/mcp/tools.ts).

Pi supports direct, deferred, codemode and hidden exposure. Deferred tools can be loaded by tool search; codemode calls registered tools from scripts without declaring every tool to the model. Registered availability, active model declarations and actual permission are distinct states. Resources are exposed through separate list/read tools; templates and pagination are not treated as executable tools. MCP Apps rendering is absent in the inspected CLI support. These exposure policies are genuine alternatives for Lina to compare, not prerequisites for basic MCP connectivity.

Sources: [MCP registration and exposure owner](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/extensions/mcp/index.ts), [resource tools](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/extensions/mcp/resources.ts), [deferred search](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/extensions/tool-search/tool.ts).

## Pi: extensions, package lifecycle and skills

A Pi package is a distribution unit containing extensions, skills, prompt templates or themes. Packages can come from npm, Git or local directories; manifests under the `pi` key declare contributions. Versioned npm specifications, tags and commit references remain pinned rather than automatically moving with upstream. The package manager resolves sources, installs dependencies and prevents duplicate package identity; project declarations are gated by trust. Loading extension code is execution in the host process, not a sandbox guarantee.

Extensions register tools, MCP servers, providers, commands and event hooks. Session-scoped resources start at session startup or when needed and close through idempotent shutdown handlers. Reload replaces runtime state, so code must not continue using the old runtime. Extensions can register/unregister MCP connections for the current session; file configuration takes precedence. Hook failures are visible, and a `tool_call` hook failure blocks execution. Nested tool calls pass through the same validation and hook pipeline, carry parent-child call IDs, and reach their caller rather than becoming standalone model transcript results.

Sources: [package resolution and installation](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/package-manager.ts), [package contract](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/docs/packages.md), [extension runner](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/extensions/runner.ts), [extension lifecycle and nested calls](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/docs/extensions.md).

Skills are instructions and supporting resources, not automatically executable registrations. Pi scans skill locations, validates metadata, advertises name/description/path and loads the body when the model reads it or the user invokes `/skill:name`. `disable-model-invocation` restricts automatic selection. Resources and scripts resolve relative to the skill directory; running a script still uses an executable tool. Package distribution can include skills without an extension. Duplicate skill names keep the first discovered definition with diagnostics. Trust review includes scripts and references, not only the Markdown body.

Sources: [skill discovery implementation](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/skills.ts), [skill usage and resources](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/docs/skills.md).

## Pi: execution and parallelism

The agent defaults to parallel tool execution. A global sequential mode or **any tool in the batch marked sequential** serializes the whole batch. Parallel preparation validates and runs before-call hooks in order, then launches eligible executions with `Promise.all`. Individual completion events can arrive in completion order; final tool result messages are emitted in the original call order. Exceptions, unknown tools, validation failures and blocked calls become per-call error outcomes. After-call hooks finalize outcomes.

Cancellation is checked during preparation and before launch, and the signal reaches tool implementations. This is cooperative cancellation; it does not prove that a remote effect was undone. The inspected scheduler has no explicit resource-conflict graph or bounded concurrency limiter in this batch function. A sequential flag is a coarse conflict control, not dependency inference.

Sources: [parallel default](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/agent/src/agent.ts#L228-L253), [batch preparation, scheduling and result ordering](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/agent/src/agent-loop.ts#L508-L790), [execution/finalization hooks](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/agent/src/agent-loop.ts#L797-L900).

## Waku: connector ownership and auth

Waku registry assembly adds built-ins and optional Apple, GitHub, experimental and MCP integrations. MCP is enabled by a home-directory `mcp.json` plus the optional SDK dependency. The bridge holds async sessions on a dedicated asyncio thread and uses a shared async exit stack; synchronous tools submit coroutines with `run_coroutine_threadsafe`. Stdio launches a child process; Streamable HTTP connects to a remote endpoint. Entries cannot name both URL and command.

Remote MCP auth is either `auth_env`, whose named environment value becomes a bearer header, or `oauth: true`; naming both is refused. A missing named key is a configuration error, not silent anonymous fallback. OAuth hands an SDK provider to the HTTP client. The provider performs protocol discovery/authorization; Waku supplies browser opening, loopback callback, and file storage. Files retain tokens and client registration, one per sanitized server name, using write-then-rename and mode 0600. It does not encrypt the token file. The store key does not bind the URL, so Lina should avoid inheriting this weaker identity rule when endpoints/accounts can change.

The callback uses a fixed loopback port and serialized sign-in assumptions. The bridge extends startup timeout for first consent and reconnects once if a previously absent token was just created. This is an auth-setup retry, not a tool effect retry. It is a desktop pattern; a hosted/multiuser harness needs its own callback, account/session ownership and credential isolation.

Sources: [registry assembly](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/__init__.py), [transport bridge and authentication selection](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/mcp_client.py), [OAuth browser callback and file store](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/mcp_oauth.py).

Waku also demonstrates why connector auth cannot be a single MCP-only mechanism. Google Calendar uses a separate installed-app OAuth flow, cached user token and refresh, with read-only events scope; ordinary reads do not open consent. GitHub uses a tightly constructed allowlist of `gh` CLI commands and delegates credential ownership to that CLI. Apple tools delegate authorization to platform consent. These authenticate downstream services through different adapters; none should reuse model-provider credentials. The Google token write shown in this revision is plain file writing without the MCP store's explicit mode/atomic-write discipline.

Sources: [Google auth and refresh](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/google_calendar.py), [gh adapter and allowlist](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/github.py), [Apple platform adapter](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/apple.py).

## Waku: registry, outcomes and skills

MCP setup calls initialize then lists tools. Registry entries map model-safe public names to closures retaining original server/tool names and input schemas. The name sanitizer replaces disallowed characters and truncates long prefixes; the registry dictionary overwrites duplicate names. No collision disambiguation or schema validator was found in this simple registry. JSON schemas are declared to the model, but `execute` directly invokes the Python function and catches exceptions. Lina should not equate declaration with local validation.

The ordinary agent loop executes each returned `tool_use` sequentially, preserving IDs in result records. The async transport bridge does not make that loop parallel. Errors become text. The MCP adapter flattens text content, substitutes a non-text placeholder and does not preserve `structuredContent` or `isError` as structured outcomes. A timed-out `future.result(timeout)` is caught, but the pending future is not explicitly cancelled in that handler; a timeout therefore does not prove remote execution stopped. The reviewed bridge lists tools during startup and has no explicit list-change refresh/reconnect scheduler analogous to Pi's. One failed server is skipped with a warning; close attempts cleanup and stops the event-loop thread.

Sources: [declaration and synchronous dispatch](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/registry.py), [sequential tool result loop](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/loop/agent.py#L117-L138), [name mapping, calls and cleanup](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/mcp_client.py).

Waku procedural skills use repository and user directories. The loader rescans when file modification signatures change, matches keyword overlap against name/description and selects at most two by default. Selected bodies are inserted into procedural context. This is deterministic routing rather than Pi's model-driven body loading. The loader parses bodies during inventory refresh; its conceptual progressive disclosure refers to prompt inclusion, not exclusively lazy filesystem reads. References are described as on-demand, but there is no dedicated referenced-resource activation runtime in this loader. No general plugin installation/loading/hook API comparable to Pi packages/extensions was identified in the inspected Waku registry and loader; the repository's unrelated lab plugin generator is not evidence of that capability.

Sources: [skill parsing, matching and reload](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/memory/procedural/loader.py), [skill injection](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/memory/__init__.py).

## Implications for Lina

These are recommendations derived from the source, not behavior already implemented in Lina.

1. Keep capability registration and connection lifecycle separate from model-call execution. Register built-ins, plugin contributions and MCP tools through one stable registry boundary, with source identity, version, wire name, schema and adapter reference.
2. Keep provider auth, connector credential ownership and per-call authorization separate. Use credential references in configuration and inspectable status; secrets stay in an account-scoped store. Bind grants to endpoint, authorization issuer, client/account and scopes. Coordinate refresh across concurrent calls.
3. Build transport adapters for local functions/subprocesses, MCP stdio and MCP HTTP. Add service-specific API/CLI adapters only when concrete connectors require them. Authentication capability is supplied to the adapter, not carried in model arguments.
4. Support parallel independent calls as the baseline, retaining exact per-call outcome identity and stable transcript joins. Declare conservative sequential/conflict metadata; adapters expose limits. Call launch, cancellation request and confirmed completion are distinct events.
5. Preserve protocol result blocks, structured data, error flags and artifact references. Model-visible truncation is a projection with provenance, not destruction of the only result record.
6. Track connection states, changed tool catalogs and unavailable capabilities explicitly. A registered name does not guarantee a live connection or permission. On reconnect, invalidate or version stale registry entries.
7. Never blindly retry effects after uncertain transport failure. Distinguish setup/discovery reads, server-rejected unexecuted requests and potentially completed effects. Reconciliation/idempotency support is adapter-specific.
8. Treat packages as distribution and executable extensions as runtime code. Record provenance/pinned versions, registration ownership, unload/reload and idempotent cleanup. Skills contribute context and resources; using scripts still passes normal tool controls.

## Requirements versus useful comparisons

| Baseline engineering requirement | Credible experiment variable |
| --- | --- |
| Correct auth/account binding and refresh coordination | No experiment that intentionally weakens identity binding |
| Input validation, name collision handling and call/result identity | Optional bounded argument-repair policy with invalid-input controls |
| Parallel independent calls; explicit conflicts and cancellation semantics | Concurrency cap; coarse whole-batch serialization versus selective conflict groups |
| Rich protocol outcomes retained with provenance | Model-visible raw versus structured/excerpted results |
| Catalog lifecycle and unavailable-state handling | Eager connections versus demand-triggered connections with cold/warm controls |
| Registry/exposure/authorization kept distinct | Direct declarations versus deferred search versus codemode access |
| Trusted package loading and cleanup ownership | Tool granularity and extension packaging, holding behavior constant |
| Skill resource origin and normal tool execution rules | Model selection versus deterministic match versus explicit activation |

Compare latency together with correctness, auth-interaction counts, unavailable-tool errors, schema token cost, completion reliability and retained result fidelity. Hold tool behavior, catalogs, service state, model and task constant; separate cold startup/auth from warm execution. Cancellation and timeout experiments need deterministic side-effect fixtures so a fast-looking failure cannot conceal work that continues remotely. This audit establishes architecture options; it does not establish performance superiority.
