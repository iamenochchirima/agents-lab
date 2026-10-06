# Waku graph semantic audit

Pinned source: `24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01`. Audit is read-only source analysis; no Waku runtime, providers, tools, evals or test suites executed.

## Meaning of statuses

`verified` means the displayed surface contract was checked against implementation/callers; it does not verify all internals, deployment behavior or external APIs. `corrected` means the prior surface item changed following source review. `needs-deeper-review` identifies an aggregate whose bounded seam is checked but whose broad internals remain insufficiently modeled. Every original graph item is accounted for below; new relationships are recorded separately.

Reviewed original inventory: 124 nodes, 177 edges and 6 traces. Final inventory: 124 nodes, 191 edges and 6 traces.

## Corrections and topology gaps

- `settings`: load_settings constructs Settings; model pair resolution actually belongs to get_client. Before: {"summary": "Loads settings, environment and provider model defaults; home resolution determines all local state paths.", "source": [{"file": "waku/config.py", "line": 239, "symbol": "load_settings"}]}. After: {"summary": "Constructs Settings from field defaults and already-loaded environment; model IDs are resolved later by get_client.", "source": [{"file": "waku/config.py", "line": 130, "symbol": "Settings"}, {"file": "waku/config.py", "line": 239, "symbol": "load_settings"}]}.
- `home`: Exact legacy precedence includes both database existence predicates. Before: {"conditions": null}. After: {"conditions": "Legacy cwd/.waku is used only when its state.db exists and user ~/.waku/state.db does not; WAKU_HOME overrides both."}.
- `setting-api`: Inspected entire apply_settings and HTTP caller: neither rebuilds current agent. Before: {"summary": "Validates settings updates and rebuilds browser agent when required.", "notes": null, "outputs": null}. After: {"summary": "Writes experimental and graph-workflow toggles to dotenv/environment; does not rebuild an already-created browser Waku.", "notes": "An existing singleton retains its prior Settings. A later successful integration/provider rebuild or server restart constructs new settings.", "outputs": "Updated environment/settings_info; no automatic live-agent replacement."}.
- `integration`: ReloadMode branch owns rebuild/reconciliation and rollback, not settings_api. Before: {"summary": "Operator configures optional connections; registry reports configuration and runtime status.", "failures": null}. After: {"summary": "Validates/probes connection changes, writes configuration, then rebuilds agent or reconciles gateway according to integration reload mode.", "failures": "Failed probe can offer force; failed reload restores configuration/environment and records integration error. Gateway rollback triggers reconcile again."}.
- `skills`: Keyword matching reads bodies at refresh, not lazy disk body reads at match. Before: {"summary": "Loads SKILL.md files from bundled and home skills directories; matches current message and returns instructions.", "notes": null}. After: {"summary": "Refresh reads/validates SKILL.md bodies; match scores ASCII keyword overlap in name/description, needs overlap≥2, returns at most two skills.", "notes": "File signatures trigger reload after edits. All bodies are held after refresh; only matched bodies enter the prompt."}.
- `manage`: Tool does not implement episode updates or generic list action. Before: {"summary": "Lists, updates or deletes semantic/episodic records through configured stores.", "conditions": null}. After: {"summary": "Searches facts/episodes, updates facts only, and deletes either through configured stores; episode search filters recent list results.", "conditions": "action search/update/delete; episode update is rejected."}.
- `update-soul`: Append behavior includes current-size guard, not a strict post-append ceiling. Before: {"notes": null}. After: {"notes": "Checks existing SOUL.md length against 8000 before appending; a long new rule can exceed that size. Takes effect in a later full-turn prompt."}.
- `create-skill`: Implementation checks names/content but not user agreement. Before: {"conditions": null, "failures": null, "notes": "Persona requests user agreement; registry itself does not enforce a separate approval state."}. After: {"conditions": "Valid slug, absent built-in/user destination and parseable frontmatter.", "failures": "Invalid name, duplicate skill or invalid frontmatter returns explanatory text; registry catches filesystem errors.", "notes": "User agreement is model-facing description/persona instruction, not an enforced approval gate."}.
- `arena`: Node represented three different arenas but its owner is only compare_stream. Before: {"label": "Compare / memory / judgment arenas", "summary": "Explicit operator races use separate harness configurations and isolated experiment homes; not ordinary chat routing.", "notes": null}. After: {"label": "Compare arena / compare_stream", "summary": "Explicit comparison races construct one Waku per model in separate temporary home directories and stream structural events.", "notes": "Apple calendar can opt into real external writes; inherited environment can enable other optional integrations. Separate memory/judgment arenas remain coverage gaps, not claimed internals of compare_stream."}.
- `tracer`: Tracer drops token deltas and can fail writes; not every observer event is persisted. Before: {"summary": "Records turn start/events/end to daily JSONL; optional OTel exports instrumented events.", "notes": null, "failures": null}. After: {"summary": "Records turn markers and non-text harness events to JSONL; llm events also append usage. Optional OTel records event spans.", "notes": "Streaming text deltas are deliberately skipped; turn_end is written only after successful respond completion.", "failures": "Invalid existing trace encoding or file write errors propagate through observer/turn calls; compose does not isolate failures."}.
- `trace-files`: Event persistence excludes streaming text and serializes unsupported objects as strings. Before: {"summary": "Append runtime events and JSON-serializable event data for local inspection."}. After: {"summary": "Appends timestamped JSONL records using UTF-8, validating existing trace encoding once; nonserializable details use str conversion."}.
- `client`: Constructing client is not a network invocation. Before: {"outputs": null}. After: {"outputs": "Configured Anthropic SDK or OpenAICompatClient; network calls occur later through messages create/stream."}.
- `sync`: Pending sends are threshold-gated; two-pass order can stop sends. Before: {"conditions": null, "notes": null}. After: {"conditions": "Due consolidation batch; remote remember configured. Durable pending tracking requires SqliteFactStore.", "notes": "Retry pending rows before summary. After first failed send, reachable=false suppresses remaining sends. Successful remote send then crash before mark_synced may be retried; no exactly-once guarantee."}.
- `commit-memory`: Store commits are per-operation, not one atomic batch. Before: {"notes": null}. After: {"notes": "Fact/episode stores may commit each operation; selected chat rows are marked consolidated at the end. Mid-write failure can retain partial durable writes and unconsolidated chats."}.
- `loop`: There is no special stop_reason truncation-tool guard. Before: {"notes": null}. After: {"notes": "Tools run whenever tool_use blocks exist, even if provider stop_reason is max_tokens. Prompt instruction once-per-tool is not enforced by loop."}.
- `stream-choice`: Capability computed once per loop entry rather than on each iteration. Before: {"summary": "Streams only when requested and client.messages.stream exists; otherwise makes ordinary create call."}. After: {"summary": "At loop entry, chooses streaming when requested and client.messages.stream exists; that capability decision is reused for all iterations."}.
- `whatsapp`: Intake ACK timing and shared state distinct from Telegram runner. Before: {"notes": null}. After: {"notes": "One locked Waku/session whatsapp serves admitted webhook senders. HTTP200 is written before model work; no message-ID deduplication is implemented here. Exceptions after ACK do not imply Meta retries or rolled-back effects."}.
- `episodes`: Empty normalized query uses recency fallback, not no results. Before: {"notes": null}. After: {"notes": "FTS ranking then date recency for nonempty query; empty tokenized query returns most recent episodes."}.
- `slot`: Correct explicit thresholds and enabled branch. Before: {"conditions": "WAKU_SLOT_GATE=jev and Typesafe configuration required; disabled by default.", "failures": "Scoring failure keeps baseline facts."}. After: {"conditions": "WAKU_SLOT_GATE=jev and nonempty TYPESAFE_API_KEY; default select threshold0.5 unless configured.", "failures": "Caught scoring/answer errors return baseline facts. Other failures outside that scoring catch are not claimed impossible."}.
- `keep`: Write threshold is distinct from retrieval threshold. Before: {"conditions": null}. After: {"conditions": "Same opt-in gate; default WAKU_KEEP_GATE_MIN=1.0, configurable independently of retrieval threshold."}.
- `graph-engine`: Node failures are caught, but router/collision/observer failures are not universally caught. Before: {"failures": "Node errors enter state.errors; on_error can jump. Parallel writes to same key raise GraphStateCollision. max_steps/max_visits bound execution.", "notes": null}. After: {"failures": "Node-function exceptions become state.errors and optional on_error jumps. Router/observer exceptions and GraphStateCollision can propagate; max_steps and max_visits bound scheduling.", "notes": "Parallel nodes receive shallow state snapshots; nested values can still be shared. Output merges are deterministic in submitted wave order."}.
- `waku-db-27`: Waku actually invokes connect; data construction was labeled only data. Before: {"kind": "data"}. After: {"kind": "call"}.
- `memory-init-episodes-37`: Episode backend selection is delegated to _make_episode_store. Before: {"kind": "data", "source": [{"file": "waku/memory/__init__.py", "line": 59, "symbol": "__init__"}], "condition": null}. After: {"kind": "call", "source": [{"file": "waku/memory/__init__.py", "line": 99, "symbol": "_make_episode_store"}], "condition": "episodic_store=sqlite/default"}.
- `memory-init-notion-38`: Episode backend selection is delegated to _make_episode_store. Before: {"kind": "call", "source": [{"file": "waku/memory/__init__.py", "line": 59, "symbol": "__init__"}], "condition": null}. After: {"kind": "call", "source": [{"file": "waku/memory/__init__.py", "line": 99, "symbol": "_make_episode_store"}], "condition": "episodic_store=notion"}.
- `memory-init-skills-39`: Memory constructs SkillLoader; match happens at prompt assembly. Before: {"label": "load bundled/home skills", "source": [{"file": "waku/memory/__init__.py", "line": 59, "symbol": "__init__"}]}. After: {"label": "construct SkillLoader and refresh files", "source": [{"file": "waku/memory/__init__.py", "line": 69, "symbol": "self.skills = SkillLoader"}]}.
- `respond-graph-enabled-50`: This is an intra-function phase/topology relationship, not a call to a separately named implementation. Before: {"kind": "call"}. After: {"kind": "transition"}.
- `respond-fallback-53`: This is an intra-function phase/topology relationship, not a call to a separately named implementation. Before: {"kind": "call"}. After: {"kind": "transition"}.
- `full-history-window-56`: This is an intra-function phase/topology relationship, not a call to a separately named implementation. Before: {"kind": "call"}. After: {"kind": "transition"}.
- `build-system-clock-59`: This is an intra-function phase/topology relationship, not a call to a separately named implementation. Before: {"kind": "call"}. After: {"kind": "transition"}.
- `loop-stream-choice-68`: can_stream computed before iteration loop, not anew each iteration. Before: {"label": "each iteration", "kind": "transition", "source": [{"file": "waku/loop/agent.py", "line": 59, "symbol": "run_loop"}]}. After: {"label": "determine stream capability at loop entry", "kind": "transition", "source": [{"file": "waku/loop/agent.py", "line": 79, "symbol": "can_stream = stream and hasattr"}]}.
- `stream-response-72`: This is an intra-function phase/topology relationship, not a call to a separately named implementation. Before: {"kind": "call"}. After: {"kind": "transition"}.
- `create-response-73`: This is an intra-function phase/topology relationship, not a call to a separately named implementation. Before: {"kind": "call"}. After: {"kind": "transition"}.
- `response-tool-decision-74`: This is an intra-function phase/topology relationship, not a call to a separately named implementation. Before: {"kind": "call"}. After: {"kind": "transition"}.
- `execute-tool-results-77`: This is an intra-function phase/topology relationship, not a call to a separately named implementation. Before: {"kind": "call"}. After: {"kind": "transition"}.
- `loop-limit-79`: This is an intra-function phase/topology relationship, not a call to a separately named implementation. Before: {"kind": "call"}. After: {"kind": "transition"}.
- `client-providers-83`: get_client looks up already-loaded PROVIDERS; it does not invoke _registry on each request. Before: {"kind": "call", "label": "lookup provider row", "source": [{"file": "waku/loop/models.py", "line": 279, "symbol": "get_client"}]}. After: {"kind": "data", "label": "lookup already-loaded provider row", "source": [{"file": "waku/loop/models.py", "line": 282, "symbol": "provider = PROVIDERS.get(settings.provider)"}]}.
- `client-model-api-85`: get_client constructs SDK endpoint; network request occurs in loop. Before: {"kind": "call", "label": "Anthropic SDK endpoint", "condition": null, "source": [{"file": "waku/loop/models.py", "line": 279, "symbol": "get_client"}]}. After: {"kind": "data", "label": "configure Anthropic endpoint/client", "condition": "Provider.kind is anthropic", "source": [{"file": "waku/loop/models.py", "line": 332, "symbol": "return anthropic.Anthropic(**kwargs)"}]}.
- `mcp-call-transport-112`: call invokes _acall→session.call_tool; it does not reopen streams. Before: {"kind": "call", "label": "server call", "source": [{"file": "waku/tools/mcp_client.py", "line": 293, "symbol": "call"}]}. After: {"kind": "data", "label": "use existing connected session transport", "source": [{"file": "waku/tools/mcp_client.py", "line": 304, "symbol": "result = await session.call_tool(tool, args)"}]}.
- `due-summarize-120`: This is an intra-function phase/topology relationship, not a call to a separately named implementation. Before: {"kind": "call"}. After: {"kind": "transition"}.
- `summarize-keep-121`: This is an intra-function phase/topology relationship, not a call to a separately named implementation. Before: {"kind": "call"}. After: {"kind": "transition"}.
- `summarize-commit-memory-122`: This is an intra-function phase/topology relationship, not a call to a separately named implementation. Before: {"kind": "call"}. After: {"kind": "transition"}.
- `commit-memory-sync-126`: This is an intra-function phase/topology relationship, not a call to a separately named implementation. Before: {"kind": "call"}. After: {"kind": "transition"}.
- `triage-classify-132`: Graph builder declares dependencies; engine owns node execution. Before: {"kind": "call", "condition": null, "source": [{"file": "waku/graph/workflows/triage.py", "line": 89, "symbol": "build_triage_graph"}]}. After: {"kind": "transition", "condition": "graph_workflows enabled; dependency wave ready", "source": [{"file": "waku/graph/workflows/triage.py", "line": 108, "symbol": "build_triage_graph topology"}]}.
- `triage-check-calendar-133`: Graph builder declares dependencies; engine owns node execution. Before: {"kind": "call", "condition": null, "source": [{"file": "waku/graph/workflows/triage.py", "line": 89, "symbol": "build_triage_graph"}]}. After: {"kind": "transition", "condition": "graph_workflows enabled; dependency wave ready", "source": [{"file": "waku/graph/workflows/triage.py", "line": 108, "symbol": "build_triage_graph topology"}]}.
- `classify-join-134`: Graph builder declares dependencies; engine owns node execution. Before: {"kind": "call", "condition": null, "source": [{"file": "waku/graph/workflows/triage.py", "line": 89, "symbol": "build_triage_graph"}]}. After: {"kind": "transition", "condition": "graph_workflows enabled; dependency wave ready", "source": [{"file": "waku/graph/workflows/triage.py", "line": 108, "symbol": "build_triage_graph topology"}]}.
- `check-calendar-join-135`: Graph builder declares dependencies; engine owns node execution. Before: {"kind": "call", "condition": null, "source": [{"file": "waku/graph/workflows/triage.py", "line": 89, "symbol": "build_triage_graph"}]}. After: {"kind": "transition", "condition": "graph_workflows enabled; dependency wave ready", "source": [{"file": "waku/graph/workflows/triage.py", "line": 108, "symbol": "build_triage_graph topology"}]}.
- `commands-gather-139`: parse is not workflow invocation; commands.run resolves discovered binder. Before: {"source": [{"file": "waku/ops/commands.py", "line": 85, "symbol": "parse"}], "condition": null}. After: {"source": [{"file": "waku/ops/commands.py", "line": 98, "symbol": "run"}], "condition": "Known command gather with available binder"}.
- `gather-graph-engine-140`: Pure graph builder returns graph; bound run_gather invokes run_graph. Before: {"source": [{"file": "waku/graph/workflows/gather.py", "line": 111, "symbol": "build_gather_graph"}], "label": "run explicit workflow"}. After: {"source": [{"file": "waku/ops/gather.py", "line": 159, "symbol": "run_graph"}], "label": "bound gather runner executes declared topology"}.
- `gather-scans-141`: Pure builder declares parallel branch/join edges, not synchronous scan calls. Before: {"kind": "call", "source": [{"file": "waku/graph/workflows/gather.py", "line": 111, "symbol": "build_gather_graph"}], "condition": null}. After: {"kind": "transition", "source": [{"file": "waku/graph/workflows/gather.py", "line": 137, "symbol": "build_gather_graph topology"}], "condition": "Four independent START branches share wave"}.
- `scans-synthesis-142`: Pure builder declares parallel branch/join edges, not synchronous scan calls. Before: {"kind": "call", "source": [{"file": "waku/graph/workflows/gather.py", "line": 111, "symbol": "build_gather_graph"}], "condition": null}. After: {"kind": "transition", "source": [{"file": "waku/graph/workflows/gather.py", "line": 137, "symbol": "build_gather_graph topology"}], "condition": "Explicit gather run; synthesis waits all four dependency outputs"}.
- `setting-api-rebuild-151`: apply_settings has no rebuild call; integration ReloadMode.AGENT actually invokes it. Before: {"from_": null, "source": [{"file": "waku/ops/settings_api.py", "line": 102, "symbol": "apply_settings"}], "condition": null, "label": "apply live configuration"}. After: {"from_": "integration", "source": [{"file": "waku/integrations.py", "line": 697, "symbol": "if error := browser_agent.rebuild():"}], "condition": "Successful integration change with ReloadMode.AGENT", "label": "rebuild after integration configuration"}.
- `supervisor-telegram-159`: reconcile synchronously calls the selected starter/stop; handle owns background thread. Before: {"kind": "background", "condition": null, "source": [{"file": "waku/gateway/supervisor.py", "line": 61, "symbol": "reconcile"}]}. After: {"kind": "call", "condition": "Configured gateway and new/changed fingerprint", "source": [{"file": "waku/gateway/supervisor.py", "line": 79, "symbol": "handle = self._starters[key]()"}]}.
- `supervisor-discord-160`: reconcile synchronously calls the selected starter/stop; handle owns background thread. Before: {"kind": "background", "condition": null, "source": [{"file": "waku/gateway/supervisor.py", "line": 61, "symbol": "reconcile"}]}. After: {"kind": "call", "condition": "Configured gateway and new/changed fingerprint", "source": [{"file": "waku/gateway/supervisor.py", "line": 79, "symbol": "handle = self._starters[key]()"}]}.
- `supervisor-whatsapp-161`: reconcile synchronously calls the selected starter/stop; handle owns background thread. Before: {"kind": "background", "condition": null, "source": [{"file": "waku/gateway/supervisor.py", "line": 61, "symbol": "reconcile"}]}. After: {"kind": "call", "condition": "Configured gateway and new/changed fingerprint", "source": [{"file": "waku/gateway/supervisor.py", "line": 79, "symbol": "handle = self._starters[key]()"}]}.
- `http-supervisor-171`: Dashboard startup synchronously calls reconcile; gateway implementations may start background handles. Before: {"kind": "background", "source": [{"file": "waku/ops/dashboard.py", "line": 1232, "symbol": "main"}]}. After: {"kind": "call", "source": [{"file": "waku/ops/dashboard.py", "line": 1268, "symbol": "supervisor.reconcile()"}]}.

- Additional `gate` correction: prior summary implied both suites; actual main skips judge without credentials and still opens gate.
- Additional `calendar-read` correction: connected sources are local SQLite and Google only; Apple is a separate optional tool.
- Consolidation trace now states episode persistence follows the fact/send loop.

## Nodes

| ID | Status | Evidence | Source-based rationale / remaining limit |
| --- | --- | --- | --- |
| `main` | verified | `waku/__main__.py:38` | CLI dispatcher selects chat, dashboard, voice, messaging, brief, gather or connection/skill administration. |
| `cli` | verified | `waku/gateway/cli.py:55` | Default terminal gateway constructs Waku, reads text and prints responses. |
| `http` | verified | `waku/ops/dashboard.py:906` | ThreadingHTTPServer exposes static dashboard, JSON APIs and server-sent event chat streams. |
| `sse` | verified | `waku/ops/dashboard.py:1017` | Handler.do_POST writes SSE headers, invokes chat_stream and converts raised error to done; broken write does not cancel work. |
| `chat` | verified | `waku/ops/dashboard.py:85` | Slash commands select explicit workflows; otherwise acquire the browser agent lock and call respond with streaming. |
| `telegram` | verified | `waku/gateway/telegram.py:52` | Optional Telegram polling checks allowed IDs and forwards text through GatewayAgentRunner. |
| `discord` | verified | `waku/gateway/discord.py:137` | Optional Discord gateway filters messages, mention/DM posture and hourly turn budget before invoking the runner. |
| `whatsapp` | corrected | `waku/gateway/whatsapp.py:123` | Optional signed webhook integration receives WhatsApp text and delivers replies through Meta Cloud API. |
| `voice` | verified | `waku/gateway/voice.py:228` | Optional local speech pipeline listens for wake word, transcribes command, responds and speaks reply. |
| `ears` | verified | `waku/gateway/voice.py:58` | Whisper-based speech recognition converts recorded audio to text; optional voice dependency. |
| `mouth` | verified | `waku/gateway/voice.py:140` | Kokoro when available or platform speech renders assistant reply to audio. |
| `runner` | verified | `waku/gateway/runner.py:34` | Messaging runner owns one executor worker, lazily constructs its Waku instance and serializes turns on that worker. |
| `deliver` | verified | `waku/gateway/runner.py:110` | Run the turn then send reply; runner records handling or delivery errors separately. |
| `supervisor` | verified | `waku/gateway/supervisor.py:61` | Reconciles configured messaging gateway handles using configuration fingerprints; starts, stops or retains handles. |
| `brief` | verified | `waku/ops/brief.py:22` | Runs a fixed briefing prompt through ordinary Waku.respond and saves a dated outbox reply. |
| `settings` | corrected | `waku/config.py:130`, `waku/config.py:239` | Constructs Settings from field defaults and already-loaded environment; model IDs are resolved later by get_client. |
| `home` | corrected | `waku/config.py:58` | Selects WAKU_HOME override, legacy working-directory .waku or user ~/.waku according to explicit precedence. |
| `waku` | verified | `waku/app.py:20` | Builds settings/home, SQLite connection and model client; then Memory, registry/MCP bridge, Session and Tracer. |
| `db` | verified | `waku/db.py:111` | Opens state.db, creates schema and applies additive migrations for facts, episodes, calendar events and chat metadata. |
| `memory-init` | verified | `waku/memory/__init__.py:59` | Selects semantic and episodic stores and loads bundled/home skills; remote remember callable is wired later. |
| `registry-build` | verified | `waku/tools/__init__.py:14` | Registers five default tools, memory administration when wired, opt-in Apple/GitHub/experimental tools and configured MCP tools. |
| `session` | verified | `waku/runtime/session.py:54` | Holds an in-memory history and session_id; builds system prompt and persists completed exchanges through Memory. |
| `close` | verified | `waku/app.py:40` | Closes the MCP bridge when replacing or retiring an agent; gateway runner separately closes owned SQLite connections. |
| `singleton` | verified | `waku/ops/browser_agent.py:83` | Lazily builds one browser Waku using a cross-thread SQLite connection; all tabs share the locked agent. |
| `resume` | verified | `waku/ops/browser_agent.py:58` | resume_or_new_session checks dashboard source and age but only returns ID; get_agent does not call switch. |
| `rotate` | verified | `waku/ops/browser_agent.py:100` | An idle conversation starts a fresh dated thread, clearing in-memory history while retaining old database rows. |
| `session-action` | verified | `waku/ops/dashboard.py:745` | Dashboard new/switch/history actions create or select a thread, or read persisted chat rows. |
| `switch` | verified | `waku/runtime/session.py:118` | Loads the selected thread’s last history_turns exchanges from Memory.session_history. |
| `rebuild` | verified | `waku/ops/browser_agent.py:128` | Settings changes build a fresh harness, preserve conversation identifier, replace singleton and close old MCP bridge. |
| `respond` | verified | `waku/app.py:46` | Inspected complete method: trace→graph/full→add_exchange→maybe_consolidate→export_markdown→end_turn→return. |
| `observe` | verified | `waku/ops/tracing.py:161` | Fans events out to UI observer, Tracer and Waku metadata collector. |
| `graph-enabled` | verified | `waku/app.py:46` | Selects optional triage graph only when Settings.graph_workflows is true. |
| `full` | verified | `waku/app.py:118` | _run_full_turn calls build_system, slices history[-history_turns*2:], appends new user and invokes run_loop. |
| `build-system` | verified | `waku/runtime/session.py:64` | Combines SOUL.md, clock/timezone, model/provider identity, gated memory context and matched skill bodies. |
| `soul` | verified | `waku/runtime/session.py:45` | Creates default persona file if absent and reads editable SOUL.md on each full turn. |
| `clock` | verified | `waku/runtime/session.py:64` | Prompt includes local aware datetime and configured full-model/provider identity. |
| `history-window` | verified | `waku/app.py:118` | For positive history_turns, the last history_turns × 2 user/assistant rows plus new message enter the request. |
| `gated-retrieve` | verified | `waku/memory/__init__.py:107` | Gate decision precedes semantic search; optional slot gate filters facts, then episodic results are appended. |
| `retrieval-gate` | verified | `waku/memory/retrieval_gate.py:36` | Small model produces retrieve/query/reason JSON for current message. |
| `fact-select` | verified | `waku/memory/__init__.py:75` | Selects SQLite default or optional Supabase, Mem0, Zep or LangMem FactStore adapters. |
| `facts` | verified | `waku/memory/semantic/store.py:67` | Local facts are keyword-searchable through FTS5 and support add/update/delete and pending sync tracking. |
| `remote-facts` | needs-deeper-review | `waku/memory/__init__.py:75` | Selector and interface seam checked; individual Supabase/Mem0/Zep/LangMem network CRUD implementations and eventual consistency require separate node audit. |
| `slot` | corrected | `waku/memory/slot_gate.py:66` | Optional Jev scores retrieved facts and keeps those meeting threshold. |
| `episodes` | corrected | `waku/memory/episodic/store.py:16` | Default dated episode store supports search, add and management. |
| `notion` | needs-deeper-review | `waku/memory/episodic/notion_store.py:39` | Selector checked; Notion pagination/retry/id mapping contracts remain collapsed. |
| `skills` | corrected | `waku/memory/procedural/loader.py:77` | Refresh reads/validates SKILL.md bodies; match scores ASCII keyword overlap in name/description, needs overlap≥2, returns at most two skills. |
| `skill-install` | needs-deeper-review | `waku/memory/procedural/installer.py:28` | Installer body reviewed; exporter and path-safety variants remain combined and need a separate owner node. |
| `loop` | corrected | `waku/loop/agent.py:59` | Reason → append assistant blocks → run requested tools sequentially → append tool results → repeat. |
| `stream-choice` | corrected | `waku/loop/agent.py:59` | At loop entry, chooses streaming when requested and client.messages.stream exists; that capability decision is reused for all iterations. |
| `stream` | verified | `waku/loop/agent.py:59` | Emits incremental text to observer and retrieves final message from stream. |
| `create` | verified | `waku/loop/agent.py:59` | Invokes configured provider with model/system/messages/current tool schemas/max_tokens. |
| `response` | verified | `waku/loop/agent.py:59` | Usage/stop_reason event emitted; assistant response blocks appended to request-local messages. |
| `tool-decision` | verified | `waku/loop/agent.py:59` | No tool calls returns concatenated text. Tool calls enter sequential execution regardless of stop_reason string. |
| `tool-results` | verified | `waku/loop/agent.py:59` | Each output is tied to tool_use_id, then all result blocks appended as user content for next iteration. |
| `limit` | verified | `waku/loop/agent.py:59` | After configured iteration count, returns an explicit unfinished-task reply. |
| `reply` | verified | `waku/loop/agent.py:53` | LoopResult is a dataclass result created before iterations and returned on no-tools/cap; no active component callback. |
| `providers` | verified | `waku/loop/models.py:122` | Parses TOML provider definitions including endpoints, default models, visibility and credential scoping. |
| `client` | corrected | `waku/loop/models.py:279` | Validates provider/visibility/key, resolves model pair and endpoint, constructs Anthropic SDK or OpenAICompatClient. |
| `compat` | verified | `waku/loop/models.py:336` | Exposes Messages-like create/stream while converting Anthropic-shaped messages/tools to OpenAI wire format. |
| `convert` | verified | `waku/loop/models.py:348` | Converts system, text, tool requests and tool results into Chat Completions request parameters. |
| `compat-call` | verified | `waku/loop/models.py:394` | Calls OpenAI Chat Completions and handles specific unsupported parameter compatibility fallback. |
| `model-api` | verified | `waku/loop/models.py:279` | Configured provider endpoint supplies full-model, small-model and optional adapter API calls. |
| `schemas` | verified | `waku/tools/registry.py:44` | Returns every registered tool’s API schema in each loop provider request. |
| `execute` | verified | `waku/tools/registry.py:47` | Finds tool by name and invokes Python callable with arguments; optionally forwards observer. |
| `calendar` | verified | `waku/tools/calendar.py:410` | Checks required arguments, defaults end time, deduplicates title/start, commits SQLite then writes ICS and optional external mirrors. |
| `ics` | verified | `waku/tools/calendar.py:35` | Local event table plus appended ICS file are calendar artifacts; table title/start check prevents common duplicate booking. |
| `calendar-read` | corrected | `waku/tools/calendar.py:531` | Combines local events with available connected calendar sources into readable tool output. |
| `google` | needs-deeper-review | `waku/tools/calendar.py:296` | Calendar caller/mirror ordering checked; OAuth/reconciliation and remote failure/idempotency internals not fully covered. |
| `apple` | needs-deeper-review | `waku/tools/apple.py:260` | Registration and dedicated calendar mirror checked; individual Mail/Notes/Reminders AppleScript contracts remain collapsed. |
| `note` | verified | `waku/tools/notes.py:15` | Default note tool writes a fact to local SQLite. |
| `message` | verified | `waku/tools/messages.py:16` | Default messaging tool drafts into local outbox; it does not send to a real recipient. |
| `search` | verified | `waku/tools/search.py:61` | Web search defaults to DuckDuckGo HTML; configured Tavily supplies optional richer search results. |
| `github` | needs-deeper-review | `waku/tools/github.py:178` | Registry/gather caller checked; gh command shapes and failure parsing remain collapsed. |
| `manage` | corrected | `waku/tools/memory_admin.py:29` | Searches facts/episodes, updates facts only, and deletes either through configured stores; episode search filters recent list results. |
| `update-soul` | corrected | `waku/tools/memory_admin.py:88` | Persists an added standing rule to SOUL.md. |
| `create-skill` | corrected | `waku/tools/memory_admin.py:119` | Creates persistent SKILL.md under home skills and refreshes loader. |
| `stubs` | verified | `waku/tools/experimental.py:329` | run_command, browse_web and schedule_task explicitly return coming-soon text. |
| `mcp` | verified | `waku/tools/mcp_client.py:129` | start returns model-safe Tool wrappers after _connect_all; build_registry registers them and attaches bridge. |
| `transport` | verified | `waku/tools/mcp_client.py:155` | Selects stdio subprocess or remote transport and configured authentication. |
| `mcp-call` | verified | `waku/tools/mcp_client.py:293` | Schedules async server call on bridge event loop; adapter result becomes registry tool output. |
| `remember` | verified | `waku/tools/waku_memory.py:34` | Returns callable for connected waku_memory MCP memory.remember; absent server gives no remote send. |
| `delegate` | verified | `waku/tools/experimental.py:194` | Experimental coding delegation checks pi installation, workdir, provider mapping and timeout; launches pi headless. |
| `pi` | verified | `waku/tools/experimental.py:101` | _run_pi_json starts readers, uses queue deadline, kills child at timeout; caller returns before transcript writes on timeout. |
| `workspace` | verified | `waku/tools/workspace.py:81` | Repo-less delegation creates dated work folder, preserves transcript and files, selects generated entrypoint for autorun and writes manifest. |
| `exchange` | verified | `waku/runtime/session.py:91` | Appends user/reply to history; folds tool activity into assistant record, then calls log_chat. |
| `chat-log` | verified | `waku/memory/__init__.py:131` | Commits two completed exchange rows with session/source and assistant metadata. |
| `due` | verified | `waku/memory/consolidation.py:86` | kept_if_due checks all unconsolidated rows before pending retry or provider request; caller Memory.maybe_consolidate is synchronous. |
| `summarize` | verified | `waku/memory/consolidation.py:86` | Small model extracts durable facts, optional episode and company_research scope from unconsolidated log. |
| `keep` | corrected | `waku/memory/slot_gate.py:83` | Optional Jev filters proposed facts for future usefulness; disabled/failure retains baseline proposals. |
| `commit-memory` | corrected | `waku/memory/consolidation.py:86` | Writes kept facts and episode, optionally sends remote remembers, then marks sampled chat rows consolidated. |
| `sync` | corrected | `waku/memory/consolidation.py:86` | SQLite tracks unsynced facts and scope; due batch retries pending sends before new facts. |
| `mirror` | verified | `waku/memory/__init__.py:188` | export_markdown reads raw local tables; export_fact_files updates numeric filenames and removes only stale numeric fact files. |
| `graph-engine` | corrected | `waku/graph/engine.py:106` | Schedules dependency-ready waves, runs independent nodes in ThreadPoolExecutor and merges outputs in wave order. |
| `triage` | verified | `waku/graph/workflows/triage.py:89` | START fans out to classify and check_calendar; gather barrier routes quick_reply or full_agent. |
| `classify` | verified | `waku/graph/workflows/triage.py:52` | Small-model classification chooses quick/full. |
| `check-calendar` | verified | `waku/graph/workflows/triage.py:73` | Reads today’s titles from local calendar.ics concurrently with classifier. |
| `join` | verified | `waku/graph/workflows/triage.py:89` | Waits for classification and calendar static dependencies; code key_router selects next node. |
| `quick` | verified | `waku/app.py:154` | Closure invokes client.messages.create with small_model and max_tokens600; _respond_via_graph wraps returned text. |
| `fallback` | verified | `waku/app.py:46` | Graph exception or no answer returns control to same full-turn method. |
| `commands` | verified | `waku/ops/commands.py:85` | Parses slash command text; execution resolves discoverable workflow/binder pairs or returns an unknown-command response. |
| `gather` | verified | `waku/graph/workflows/gather.py:111` | Proposal-only graph runs four independent scans then synthesizes; count-based router chooses draft or quiet. |
| `scans` | verified | `waku/graph/workflows/gather.py:111` | Pure gather builder declares four START edges, distinct SCAN_KEYS, _safe wrappers and dependency join. |
| `synthesis` | verified | `waku/ops/gather.py:106` | One model call receives gathered data without tool schemas; synthesizes a proposed digest. |
| `action` | verified | `waku/graph/workflows/gather.py:97` | Code routes propose when PR/issue/event counts nonzero; otherwise quiet END. |
| `draft` | verified | `waku/ops/gather.py:118` | _draft resolves outbox/destination containment then writes dated markdown; builder only routes here for nonzero counts. |
| `tracer` | corrected | `waku/ops/tracing.py:57` | Records turn markers and non-text harness events to JSONL; llm events also append usage. Optional OTel records event spans. |
| `trace-files` | corrected | `waku/ops/tracing.py:90` | Appends timestamped JSONL records using UTF-8, validating existing trace encoding once; nonserializable details use str conversion. |
| `usage` | verified | `waku/ops/tracing.py:103` | Records usage emitted through loop llm events; delegation appends subagent usage to same ledger. |
| `otel` | needs-deeper-review | `waku/ops/tracing.py:68` | Initialization/event owner checked; exporter shutdown/flush failure handling and actual remote delivery unverified. |
| `collect` | verified | `waku/ops/dashboard.py:280` | Reads stores, artifacts, usage/eval reports and trace history for dashboard views. |
| `integration` | corrected | `waku/integrations.py:643` | Validates/probes connection changes, writes configuration, then rebuilds agent or reconciles gateway according to integration reload mode. |
| `setting-api` | corrected | `waku/ops/settings_api.py:102` | Writes experimental and graph-workflow toggles to dotenv/environment; does not rebuild an already-created browser Waku. |
| `arena` | corrected | `waku/ops/arena.py:35` | Explicit comparison races construct one Waku per model in separate temporary home directories and stream structural events. |
| `gate` | corrected | `waku/ops/release_gate.py:62` | Complete main/run/report bodies checked: deterministic failure closes gate; judge runs only with configured key. No key records skipped and still opens gate. Suite-specific thresholds are delegated to eval cases. |
| `host-gateway` | verified | `hosted/gateway/app.py:200` | Separate hosted front door authenticates sessions, routes tenant hosts and applies route policy before forwarding. |
| `identity` | needs-deeper-review | `hosted/gateway/identity.py:75` | Hosted caller offloads verifier to thread; full JWKS refresh/rotation/token checks remain separate audit. |
| `launcher` | verified | `hosted/gateway/launch.py:59` | Hosted launch ensures eligible tenant runtime through spawner and quota/capacity controls. |
| `docker` | needs-deeper-review | `hosted/spawner/docker.py:192` | Spawner seam/constructor checked; all Docker provisioning/quota/firewall/restore branches not covered. |
| `forward` | verified | `hosted/gateway/forward.py:168` | Forwards allowed authenticated requests to tenant dashboard, preserving streaming response behavior. |
| `tenant` | verified | `hosted/gateway/forward.py:168` | Each tenant runs stock waku.dashboard with private home; hosted deployment wraps same harness rather than replacing loop. |
| `meter` | verified | `hosted/proxy/app.py:113` | Platform provider calls authenticate tenant key, validate request, meter usage and relay upstream response. |
| `admit` | verified | `hosted/proxy/admission.py:82` | Validates allowed model, token ceiling and supported content/request keys before metered upstream call. |
| `ledger` | needs-deeper-review | `hosted/proxy/ledger.py:72` | Metering caller reservation/settlement checked; ledger transaction concurrency/schema requires focused audit. |
| `upstream` | needs-deeper-review | `hosted/proxy/upstream.py:23` | Proxy count/send callers and credential ownership checked; provider streaming cancellation/settlement internals remain collapsed. |

## Relationships

| ID | Status | Evidence | Source-based rationale / remaining limit |
| --- | --- | --- | --- |
| `main-cli-0` | verified | `waku/__main__.py:38` | main → cli: default chat; call owner/seam checked. |
| `main-http-1` | verified | `waku/__main__.py:38` | main → http: dashboard command; call owner/seam checked. |
| `main-voice-2` | verified | `waku/__main__.py:38` | main → voice: voice command; call owner/seam checked. |
| `main-telegram-3` | verified | `waku/__main__.py:38` | main → telegram: telegram command; call owner/seam checked. |
| `main-discord-4` | verified | `waku/__main__.py:38` | main → discord: discord command; call owner/seam checked. |
| `main-whatsapp-5` | verified | `waku/__main__.py:38` | main → whatsapp: whatsapp command; call owner/seam checked. |
| `main-brief-6` | verified | `waku/__main__.py:38` | main → brief: brief command; call owner/seam checked. |
| `main-gather-7` | verified | `waku/__main__.py:38` | main → gather: gather command; call owner/seam checked. |
| `cli-waku-8` | verified | `waku/gateway/cli.py:55` | cli → waku: construct; call owner/seam checked. |
| `cli-respond-9` | verified | `waku/gateway/cli.py:55` | cli → respond: input turn; call owner/seam checked. |
| `http-sse-10` | verified | `waku/ops/dashboard.py:906` | http → sse: chat stream route; call owner/seam checked. |
| `sse-chat-11` | verified | `waku/ops/dashboard.py:1017` | sse → chat: emit events; call owner/seam checked. |
| `chat-commands-12` | verified | `waku/ops/dashboard.py:85` | chat → commands: parse slash command; call owner/seam checked. |
| `chat-singleton-13` | verified | `waku/ops/dashboard.py:85` | chat → singleton: under agent_lock; call owner/seam checked. |
| `chat-rotate-14` | verified | `waku/ops/dashboard.py:85` | chat → rotate: idle check; call owner/seam checked. |
| `chat-respond-15` | verified | `waku/ops/dashboard.py:85` | chat → respond: streaming turn; call owner/seam checked. |
| `telegram-runner-16` | verified | `waku/gateway/telegram.py:52` | telegram → runner: filtered input; call owner/seam checked. |
| `discord-runner-17` | verified | `waku/gateway/discord.py:137` | discord → runner: admitted message; call owner/seam checked. |
| `voice-ears-18` | verified | `waku/gateway/voice.py:228` | voice → ears: transcribe speech; call owner/seam checked. |
| `voice-respond-19` | verified | `waku/gateway/voice.py:228` | voice → respond: spoken input; call owner/seam checked. |
| `voice-mouth-20` | verified | `waku/gateway/voice.py:228` | voice → mouth: speak result; call owner/seam checked. |
| `runner-waku-21` | verified | `waku/gateway/runner.py:34` | runner → waku: lazy construction; call owner/seam checked. |
| `runner-respond-22` | verified | `waku/gateway/runner.py:34` | runner → respond: serialized worker call; call owner/seam checked. |
| `deliver-runner-23` | verified | `waku/gateway/runner.py:110` | deliver → runner: run turn; call owner/seam checked. |
| `brief-respond-24` | verified | `waku/ops/brief.py:22` | brief → respond: fixed briefing prompt; call owner/seam checked. |
| `waku-settings-25` | verified | `waku/app.py:20` | waku → settings: load if absent; call owner/seam checked. |
| `settings-home-26` | verified | `waku/config.py:239` | settings → home: resolve state root; call owner/seam checked. |
| `waku-db-27` | corrected | `waku/app.py:20` | Waku actually invokes connect; data construction was labeled only data. |
| `waku-client-28` | verified | `waku/app.py:20` | waku → client: build if absent; call owner/seam checked. |
| `waku-memory-init-29` | verified | `waku/app.py:20` | waku → memory-init: build memory first; call owner/seam checked. |
| `waku-registry-build-30` | verified | `waku/app.py:20` | waku → registry-build: register capabilities; call owner/seam checked. |
| `waku-session-31` | verified | `waku/app.py:20` | waku → session: construct; call owner/seam checked. |
| `waku-tracer-32` | verified | `waku/app.py:20` | waku → tracer: construct; call owner/seam checked. |
| `registry-build-mcp-33` | verified | `waku/tools/__init__.py:14` | registry-build reads home/mcp.json existence, constructs bridge and invokes start; ImportError is reported as missing optional extra. |
| `memory-init-fact-select-34` | verified | `waku/memory/__init__.py:59` | memory-init → fact-select: select fact backend; call owner/seam checked. |
| `fact-select-facts-35` | verified | `waku/memory/__init__.py:75` | fact-select → facts: default SQLite; data owner/seam checked. |
| `fact-select-remote-facts-36` | needs-deeper-review | `waku/memory/__init__.py:75` | fact-select → remote-facts: configured optional backend; call owner/seam checked. Collapsed adapter/deployment internals exceed this checked caller seam. |
| `memory-init-episodes-37` | corrected | `waku/memory/__init__.py:99` | Episode backend selection is delegated to _make_episode_store. Condition: episodic_store=sqlite/default. |
| `memory-init-notion-38` | corrected | `waku/memory/__init__.py:99` | Episode backend selection is delegated to _make_episode_store. Condition: episodic_store=notion. |
| `memory-init-skills-39` | corrected | `waku/memory/__init__.py:69` | Memory constructs SkillLoader; match happens at prompt assembly. |
| `singleton-resume-40` | verified | `waku/ops/browser_agent.py:83` | singleton → resume: choose recent identifier; call owner/seam checked. |
| `singleton-waku-41` | verified | `waku/ops/browser_agent.py:83` | singleton → waku: construct singleton; call owner/seam checked. |
| `resume-chat-log-42` | verified | `waku/ops/browser_agent.py:58` | resume → chat-log: read recent thread; data owner/seam checked. |
| `rotate-session-43` | verified | `waku/ops/browser_agent.py:100` | rotate → session: start_new clears history; call owner/seam checked. |
| `session-action-switch-44` | verified | `waku/ops/dashboard.py:745` | session-action → switch: selected conversation; call owner/seam checked. |
| `switch-chat-log-45` | verified | `waku/runtime/session.py:118` | switch → chat-log: read thread tail; data owner/seam checked. |
| `rebuild-waku-46` | verified | `waku/ops/browser_agent.py:128` | rebuild → waku: build fresh instance; call owner/seam checked. |
| `rebuild-close-47` | verified | `waku/ops/browser_agent.py:128` | rebuild → close: close replaced MCP resources; call owner/seam checked. |
| `respond-observe-48` | verified | `waku/app.py:46` | respond → observe: compose event observers; call owner/seam checked. |
| `respond-tracer-49` | verified | `waku/app.py:46` | respond → tracer: turn context; call owner/seam checked. |
| `respond-graph-enabled-50` | corrected | `waku/app.py:46` | This is an intra-function phase/topology relationship, not a call to a separately named implementation. |
| `graph-enabled-triage-51` | verified | `waku/app.py:142` | graph-enabled → triage: enabled; transition owner/seam checked. Condition: enabled. |
| `graph-enabled-full-52` | verified | `waku/app.py:46` | graph-enabled → full: disabled; transition owner/seam checked. Condition: disabled. |
| `respond-fallback-53` | corrected | `waku/app.py:46` | This is an intra-function phase/topology relationship, not a call to a separately named implementation. |
| `fallback-full-54` | verified | `waku/app.py:46` | fallback → full: run classic turn; transition owner/seam checked. |
| `full-build-system-55` | verified | `waku/app.py:118` | full → build-system: assemble prompt; call owner/seam checked. |
| `full-history-window-56` | corrected | `waku/app.py:118` | This is an intra-function phase/topology relationship, not a call to a separately named implementation. |
| `full-loop-57` | verified | `waku/app.py:118` | full → loop: run configured loop; call owner/seam checked. |
| `build-system-soul-58` | verified | `waku/runtime/session.py:64` | build-system → soul: read persona; data owner/seam checked. |
| `build-system-clock-59` | corrected | `waku/runtime/session.py:64` | This is an intra-function phase/topology relationship, not a call to a separately named implementation. |
| `build-system-gated-retrieve-60` | verified | `waku/runtime/session.py:64` | build-system → gated-retrieve: request relevant memory; call owner/seam checked. |
| `build-system-skills-61` | verified | `waku/runtime/session.py:64` | build-system → skills: match procedural instructions; call owner/seam checked. |
| `gated-retrieve-retrieval-gate-62` | verified | `waku/memory/__init__.py:107` | gated-retrieve → retrieval-gate: judge relevance; call owner/seam checked. |
| `gated-retrieve-facts-63` | verified | `waku/memory/__init__.py:107` | gated-retrieve → facts: search query if retrieve; data owner/seam checked. Condition: Retrieval gate chooses retrieve; corresponding configured backend is active. |
| `gated-retrieve-remote-facts-64` | needs-deeper-review | `waku/memory/__init__.py:107` | gated-retrieve → remote-facts: configured FactStore search; call owner/seam checked. Condition: Retrieval gate chooses retrieve; corresponding configured backend is active. Collapsed adapter/deployment internals exceed this checked caller seam. |
| `gated-retrieve-slot-65` | verified | `waku/memory/__init__.py:107` | gated-retrieve → slot: filter retrieved facts; call owner/seam checked. Condition: Retrieval gate chooses retrieve; corresponding configured backend is active. |
| `gated-retrieve-episodes-66` | verified | `waku/memory/__init__.py:107` | gated-retrieve → episodes: search top3 episodes; data owner/seam checked. Condition: Retrieval gate chooses retrieve; corresponding configured backend is active. |
| `gated-retrieve-notion-67` | needs-deeper-review | `waku/memory/__init__.py:107` | gated-retrieve → notion: configured episode search; call owner/seam checked. Condition: Retrieval gate chooses retrieve; corresponding configured backend is active. Collapsed adapter/deployment internals exceed this checked caller seam. |
| `loop-stream-choice-68` | corrected | `waku/loop/agent.py:79` | can_stream computed before iteration loop, not anew each iteration. |
| `stream-choice-stream-69` | verified | `waku/loop/agent.py:59` | stream-choice → stream: stream requested/capable; transition owner/seam checked. |
| `stream-choice-create-70` | verified | `waku/loop/agent.py:59` | stream-choice → create: otherwise; transition owner/seam checked. |
| `stream-create-71` | verified | `waku/loop/agent.py:59` | stream → create: non-4xx streaming failure; call owner/seam checked. Condition: non-4xx streaming failure. |
| `stream-response-72` | corrected | `waku/loop/agent.py:59` | This is an intra-function phase/topology relationship, not a call to a separately named implementation. |
| `create-response-73` | corrected | `waku/loop/agent.py:59` | This is an intra-function phase/topology relationship, not a call to a separately named implementation. |
| `response-tool-decision-74` | corrected | `waku/loop/agent.py:59` | This is an intra-function phase/topology relationship, not a call to a separately named implementation. |
| `tool-decision-reply-75` | verified | `waku/loop/agent.py:59` | tool-decision → reply: no tool calls; transition owner/seam checked. Condition: no tool calls. |
| `tool-decision-execute-76` | verified | `waku/loop/agent.py:59` | tool-decision → execute: tool calls present; transition owner/seam checked. Condition: tool calls present. |
| `execute-tool-results-77` | corrected | `waku/tools/registry.py:47` | This is an intra-function phase/topology relationship, not a call to a separately named implementation. Condition: Requested tool name is registered; optional registration must have occurred. |
| `tool-results-loop-78` | verified | `waku/loop/agent.py:59` | tool-results → loop: append results; next iteration; transition owner/seam checked. |
| `loop-limit-79` | corrected | `waku/loop/agent.py:59` | This is an intra-function phase/topology relationship, not a call to a separately named implementation. |
| `limit-reply-80` | verified | `waku/loop/agent.py:59` | limit → reply: unfinished reply; transition owner/seam checked. |
| `create-schemas-81` | verified | `waku/loop/agent.py:59` | create → schemas: current registered schemas; call owner/seam checked. |
| `stream-schemas-82` | verified | `waku/loop/agent.py:59` | stream → schemas: current registered schemas; call owner/seam checked. |
| `client-providers-83` | corrected | `waku/loop/models.py:282` | get_client looks up already-loaded PROVIDERS; it does not invoke _registry on each request. |
| `client-compat-84` | verified | `waku/loop/models.py:279` | client → compat: OpenAI wire provider; call owner/seam checked. Condition: Provider.kind is not anthropic. |
| `client-model-api-85` | corrected | `waku/loop/models.py:332` | get_client constructs SDK endpoint; network request occurs in loop. Condition: Provider.kind is anthropic. |
| `compat-convert-86` | verified | `waku/loop/models.py:336` | compat → convert: convert request; call owner/seam checked. |
| `compat-compat-call-87` | verified | `waku/loop/models.py:336` | compat → compat-call: send create/stream; call owner/seam checked. |
| `compat-call-model-api-88` | verified | `waku/loop/models.py:394` | compat-call → model-api: Chat Completions endpoint; call owner/seam checked. |
| `execute-calendar-89` | verified | `waku/tools/registry.py:47` | execute → calendar: create_event; call owner/seam checked. Condition: Requested tool name is registered; optional registration must have occurred. |
| `execute-calendar-read-90` | verified | `waku/tools/registry.py:47` | execute → calendar-read: list_events; call owner/seam checked. Condition: Requested tool name is registered; optional registration must have occurred. |
| `execute-note-91` | verified | `waku/tools/registry.py:47` | execute → note: save_note; call owner/seam checked. Condition: Requested tool name is registered; optional registration must have occurred. |
| `execute-message-92` | verified | `waku/tools/registry.py:47` | execute → message: send_message; call owner/seam checked. Condition: Requested tool name is registered; optional registration must have occurred. |
| `execute-search-93` | verified | `waku/tools/registry.py:47` | execute → search: search_web; call owner/seam checked. Condition: Requested tool name is registered; optional registration must have occurred. |
| `execute-manage-94` | verified | `waku/tools/registry.py:47` | execute → manage: manage_memory; call owner/seam checked. Condition: Requested tool name is registered; optional registration must have occurred. |
| `execute-update-soul-95` | verified | `waku/tools/registry.py:47` | execute → update-soul: update_soul; call owner/seam checked. Condition: Requested tool name is registered; optional registration must have occurred. |
| `execute-create-skill-96` | verified | `waku/tools/registry.py:47` | execute → create-skill: create_skill; call owner/seam checked. Condition: Requested tool name is registered; optional registration must have occurred. |
| `execute-apple-97` | needs-deeper-review | `waku/tools/registry.py:47` | execute → apple: opt-in Apple tools; call owner/seam checked. Condition: Requested tool name is registered; optional registration must have occurred. Collapsed adapter/deployment internals exceed this checked caller seam. |
| `execute-github-98` | needs-deeper-review | `waku/tools/registry.py:47` | execute → github: opt-in github tool; call owner/seam checked. Condition: Requested tool name is registered; optional registration must have occurred. Collapsed adapter/deployment internals exceed this checked caller seam. |
| `execute-delegate-99` | verified | `waku/tools/registry.py:47` | execute → delegate: experimental delegate_task; call owner/seam checked. Condition: Requested tool name is registered; optional registration must have occurred. |
| `execute-stubs-100` | verified | `waku/tools/registry.py:47` | execute → stubs: experimental skeleton tools; call owner/seam checked. Condition: Requested tool name is registered; optional registration must have occurred. |
| `execute-mcp-call-101` | verified | `waku/tools/registry.py:47` | execute → mcp-call: namespaced MCP tool; call owner/seam checked. Condition: Requested tool name is registered; optional registration must have occurred. |
| `calendar-ics-102` | verified | `waku/tools/calendar.py:410` | calendar → ics: commit table; write ICS; data owner/seam checked. |
| `calendar-google-103` | needs-deeper-review | `waku/tools/calendar.py:410` | calendar → google: optional mirror; call owner/seam checked. Condition: google_calendar enabled; local commit and ICS write already succeeded. Collapsed adapter/deployment internals exceed this checked caller seam. |
| `calendar-read-ics-104` | verified | `waku/tools/calendar.py:531` | calendar-read → ics: read local events; data owner/seam checked. |
| `note-facts-105` | verified | `waku/tools/notes.py:15` | note → facts: insert note fact; data owner/seam checked. |
| `manage-facts-106` | verified | `waku/tools/memory_admin.py:29` | manage → facts: fact operations; data owner/seam checked. |
| `manage-episodes-107` | verified | `waku/tools/memory_admin.py:29` | manage → episodes: episode operations; data owner/seam checked. |
| `update-soul-soul-108` | verified | `waku/tools/memory_admin.py:88` | update-soul → soul: persist rule; data owner/seam checked. |
| `create-skill-skills-109` | verified | `waku/tools/memory_admin.py:119` | create-skill → skills: write skill; reload; call owner/seam checked. |
| `mcp-transport-110` | verified | `waku/tools/mcp_client.py:234` | mcp → transport: open configured transports; call owner/seam checked. Condition: Configured server being connected through _connect_one. |
| `mcp-schemas-111` | verified | `waku/tools/__init__.py:14` | mcp → schemas: discovered tools registered as schemas; data owner/seam checked. |
| `mcp-call-transport-112` | corrected | `waku/tools/mcp_client.py:304` | call invokes _acall→session.call_tool; it does not reopen streams. |
| `waku-remember-113` | verified | `waku/app.py:20` | waku → remember: wire consolidation sender; call owner/seam checked. |
| `delegate-pi-114` | verified | `waku/tools/experimental.py:194` | delegate → pi: launch specialist; call owner/seam checked. |
| `delegate-workspace-115` | verified | `waku/tools/experimental.py:194` | delegate → workspace: scratch completion artifacts; call owner/seam checked. |
| `respond-exchange-116` | verified | `waku/app.py:46` | respond → exchange: record completed result; call owner/seam checked. |
| `exchange-chat-log-117` | verified | `waku/runtime/session.py:91` | exchange → chat-log: commit two rows; data owner/seam checked. |
| `respond-due-118` | verified | `waku/app.py:46` | respond → due: maybe_consolidate synchronously; call owner/seam checked. Condition: Completed result persisted; maybe_consolidate invokes due check synchronously. |
| `due-chat-log-119` | verified | `waku/memory/consolidation.py:86` | due → chat-log: read unconsolidated rows; data owner/seam checked. |
| `due-summarize-120` | corrected | `waku/memory/consolidation.py:86` | This is an intra-function phase/topology relationship, not a call to a separately named implementation. Condition: threshold met. |
| `summarize-keep-121` | corrected | `waku/memory/consolidation.py:86` | This is an intra-function phase/topology relationship, not a call to a separately named implementation. |
| `summarize-commit-memory-122` | corrected | `waku/memory/consolidation.py:86` | This is an intra-function phase/topology relationship, not a call to a separately named implementation. |
| `commit-memory-facts-123` | verified | `waku/memory/consolidation.py:86` | commit-memory → facts: write facts; data owner/seam checked. |
| `commit-memory-episodes-124` | verified | `waku/memory/consolidation.py:86` | commit-memory → episodes: write episode; data owner/seam checked. |
| `commit-memory-chat-log-125` | verified | `waku/memory/consolidation.py:86` | commit-memory → chat-log: mark selected rows consolidated; data owner/seam checked. |
| `commit-memory-sync-126` | corrected | `waku/memory/consolidation.py:86` | This is an intra-function phase/topology relationship, not a call to a separately named implementation. |
| `sync-remember-127` | verified | `waku/memory/consolidation.py:86` | sync → remember: remote memory.remember; call owner/seam checked. |
| `respond-mirror-128` | verified | `waku/app.py:46` | respond → mirror: export after consolidation; data owner/seam checked. |
| `mirror-facts-129` | verified | `waku/memory/__init__.py:188` | mirror → facts: read local rows; data owner/seam checked. |
| `mirror-episodes-130` | verified | `waku/memory/__init__.py:188` | mirror → episodes: read local rows; data owner/seam checked. |
| `triage-graph-engine-131` | verified | `waku/app.py:142` | triage → graph-engine: execute graph; call owner/seam checked. |
| `triage-classify-132` | corrected | `waku/graph/workflows/triage.py:108` | Graph builder declares dependencies; engine owns node execution. Condition: graph_workflows enabled; dependency wave ready. |
| `triage-check-calendar-133` | corrected | `waku/graph/workflows/triage.py:108` | Graph builder declares dependencies; engine owns node execution. Condition: graph_workflows enabled; dependency wave ready. |
| `classify-join-134` | corrected | `waku/graph/workflows/triage.py:108` | Graph builder declares dependencies; engine owns node execution. Condition: graph_workflows enabled; dependency wave ready. |
| `check-calendar-join-135` | corrected | `waku/graph/workflows/triage.py:108` | Graph builder declares dependencies; engine owns node execution. Condition: graph_workflows enabled; dependency wave ready. |
| `join-quick-136` | verified | `waku/graph/workflows/triage.py:89` | join → quick: route=quick; transition owner/seam checked. Condition: route=quick. |
| `join-full-137` | verified | `waku/graph/workflows/triage.py:89` | join → full: route=full; transition owner/seam checked. Condition: route=full. |
| `quick-reply-138` | corrected | `waku/app.py:175` | quick_reply returns text; _respond_via_graph wraps state.reply in LoopResult only when no full LoopResult exists. Transition, not a call from the nested closure. |
| `commands-gather-139` | corrected | `waku/ops/commands.py:98` | parse is not workflow invocation; commands.run resolves discovered binder. Condition: Known command gather with available binder. |
| `gather-graph-engine-140` | corrected | `waku/ops/gather.py:159` | Pure graph builder returns graph; bound run_gather invokes run_graph. |
| `gather-scans-141` | corrected | `waku/graph/workflows/gather.py:137` | Pure builder declares parallel branch/join edges, not synchronous scan calls. Condition: Four independent START branches share wave. |
| `scans-synthesis-142` | corrected | `waku/graph/workflows/gather.py:137` | Pure builder declares parallel branch/join edges, not synchronous scan calls. Condition: Explicit gather run; synthesis waits all four dependency outputs. |
| `synthesis-action-143` | verified | `waku/graph/workflows/gather.py:111` | synthesis → action: counts router; call owner/seam checked. |
| `action-draft-144` | verified | `waku/graph/workflows/gather.py:111` | action → draft: propose; transition owner/seam checked. Condition: propose. |
| `tracer-trace-files-145` | verified | `waku/ops/tracing.py:57` | tracer → trace-files: append events; data owner/seam checked. |
| `tracer-usage-146` | verified | `waku/ops/tracing.py:57` | tracer → usage: loop usage events; data owner/seam checked. |
| `tracer-otel-147` | needs-deeper-review | `waku/ops/tracing.py:57` | tracer → otel: configured export; call owner/seam checked. Collapsed adapter/deployment internals exceed this checked caller seam. |
| `collect-trace-files-148` | verified | `waku/ops/dashboard.py:280` | collect → trace-files: read evidence; data owner/seam checked. |
| `collect-db-149` | verified | `waku/ops/dashboard.py:280` | collect → db: read tables; data owner/seam checked. |
| `collect-usage-150` | verified | `waku/ops/dashboard.py:280` | collect → usage: read spend; data owner/seam checked. |
| `setting-api-rebuild-151` | corrected | `waku/integrations.py:697` | apply_settings has no rebuild call; integration ReloadMode.AGENT actually invokes it. Condition: Successful integration change with ReloadMode.AGENT. |
| `host-gateway-identity-152` | needs-deeper-review | `hosted/gateway/app.py:200` | host-gateway → identity: verify identity; call owner/seam checked. Collapsed adapter/deployment internals exceed this checked caller seam. |
| `host-gateway-launcher-153` | verified | `hosted/gateway/app.py:200` | host-gateway → launcher: ensure tenant; call owner/seam checked. |
| `host-gateway-forward-154` | verified | `hosted/gateway/app.py:200` | host-gateway → forward: route approved request; call owner/seam checked. |
| `forward-tenant-155` | verified | `hosted/gateway/forward.py:168` | forward → tenant: dashboard request; call owner/seam checked. |
| `meter-admit-156` | verified | `hosted/proxy/app.py:113` | meter → admit: validate payload; call owner/seam checked. |
| `meter-ledger-157` | needs-deeper-review | `hosted/proxy/app.py:113` | meter → ledger: authorize/meter spend; data owner/seam checked. Collapsed adapter/deployment internals exceed this checked caller seam. |
| `meter-upstream-158` | needs-deeper-review | `hosted/proxy/app.py:113` | meter → upstream: platform API relay; call owner/seam checked. Collapsed adapter/deployment internals exceed this checked caller seam. |
| `supervisor-telegram-159` | corrected | `waku/gateway/supervisor.py:79` | reconcile synchronously calls the selected starter/stop; handle owns background thread. Condition: Configured gateway and new/changed fingerprint. |
| `supervisor-discord-160` | corrected | `waku/gateway/supervisor.py:79` | reconcile synchronously calls the selected starter/stop; handle owns background thread. Condition: Configured gateway and new/changed fingerprint. |
| `supervisor-whatsapp-161` | corrected | `waku/gateway/supervisor.py:79` | reconcile synchronously calls the selected starter/stop; handle owns background thread. Condition: Configured gateway and new/changed fingerprint. |
| `launcher-docker-162` | needs-deeper-review | `hosted/gateway/launch.py:59` | launcher → docker: collapsed SpawnerClient→spawner→DockerRuntime seam; call owner/seam checked. Condition: Hosted deployment spawner implementation selected. Collapsed adapter/deployment internals exceed this checked caller seam. |
| `tenant-meter-163` | verified | `waku/loop/models.py:279` | tenant → meter: configured platform provider; data owner/seam checked. Condition: Tenant configured provider waku-platform; own-key providers bypass metering proxy. |
| `arena-waku-164` | verified | `waku/ops/arena.py:35` | arena → waku: independent race harness; call owner/seam checked. |
| `delegate-usage-165` | verified | `waku/tools/experimental.py:86` | delegate → usage: append subagent token usage; data owner/seam checked. |
| `respond-reply-166` | verified | `waku/app.py:46` | respond → reply: return after persistence/exports; transition owner/seam checked. |
| `whatsapp-waku-167` | verified | `waku/gateway/whatsapp.py:123` | whatsapp → waku: construct shared locked webhook agent; call owner/seam checked. |
| `whatsapp-respond-168` | verified | `waku/gateway/whatsapp.py:123` | whatsapp → respond: signature/sender-filtered webhook message; call owner/seam checked. |
| `telegram-deliver-169` | verified | `waku/gateway/telegram.py:52` | telegram → deliver: run and send permitted text; call owner/seam checked. |
| `discord-deliver-170` | verified | `waku/gateway/discord.py:137` | discord → deliver: run and send admitted text; call owner/seam checked. |
| `http-supervisor-171` | corrected | `waku/ops/dashboard.py:1268` | Dashboard startup synchronously calls reconcile; gateway implementations may start background handles. |
| `loop-observe-172` | verified | `waku/loop/agent.py:59` | loop → observe: llm/text/tool events; data owner/seam checked. |
| `gated-retrieve-observe-173` | verified | `waku/memory/__init__.py:107` | gated-retrieve → observe: gate/slot verdicts; data owner/seam checked. |
| `graph-engine-observe-174` | verified | `waku/graph/engine.py:106` | graph-engine → observe: graph/node/route events; data owner/seam checked. |
| `observe-tracer-175` | verified | `waku/app.py:46` | observe → tracer: forward events; data owner/seam checked. |
| `remember-mcp-call-176` | verified | `waku/tools/waku_memory.py:34` | remember → mcp-call: memory.remember with scope; call owner/seam checked. Condition: Configured connected Waku Memory server discovered by remember_via. |
| `main-skill-install-audit` | needs-deeper-review | `waku/__main__.py:85` | Added missing relationship: explicit skill install/export administration Condition: Arguments match skill install or export. Collapsed adapter/deployment internals exceed this checked caller seam. |
| `settings-field-home-audit` | verified | `waku/config.py:150` | Added missing relationship: Settings.home default factory invokes resolve_home |
| `integration-supervisor-audit` | verified | `waku/integrations.py:700` | Added missing relationship: reconcile changed gateway configuration Condition: ReloadMode.GATEWAY and registered reloader. |
| `rebuild-switch-gap-audit` | verified | `waku/ops/browser_agent.py:152` | Added missing relationship: preserve identifier only; history starts empty |
| `quick-model-api-audit` | verified | `waku/app.py:157` | Added missing relationship: small-model quick call Condition: Triage quick branch. |
| `gate-model-api-audit` | verified | `waku/memory/retrieval_gate.py:42` | Added missing relationship: small-model retrieval decision |
| `summary-model-api-audit` | verified | `waku/memory/consolidation.py:121` | Added missing relationship: small-model batch extraction |
| `classify-model-api-audit` | verified | `waku/graph/workflows/triage.py:56` | Added missing relationship: small-model route classification |
| `gather-model-api-audit` | verified | `waku/ops/gather.py:112` | Added missing relationship: tool-free digest generation |
| `calendar-apple-mirror-audit` | needs-deeper-review | `waku/tools/calendar.py:446` | Added missing relationship: optional dedicated Apple Calendar mirror Condition: apple_calendar enabled; distinct from registering apple_tools. Collapsed adapter/deployment internals exceed this checked caller seam. |
| `persist-pending-sync-audit` | verified | `waku/memory/consolidation.py:113` | Added missing relationship: retry pending tracked facts before summary Condition: Threshold met, remember configured, SqliteFactStore. |
| `summarize-remote-store-audit` | needs-deeper-review | `waku/memory/consolidation.py:155` | Added missing relationship: configured fact store writes Condition: Non-SQLite fact backend selected. Collapsed adapter/deployment internals exceed this checked caller seam. |
| `create-client-audit` | corrected | `waku/loop/agent.py:104` | Added explicit bound-client interface; runtime call uses previously constructed provider client, not get_client on each iteration. |
| `stream-client-audit` | corrected | `waku/loop/agent.py:88` | Added explicit bound-client interface; runtime call uses previously constructed provider client, not get_client on each iteration. |

## Traces

| ID | Status | Evidence | Ordering and assumptions checked |
| --- | --- | --- | --- |
| `normal` | corrected | `waku/ops/dashboard.py:1017`, `waku/ops/dashboard.py:85`, `waku/ops/browser_agent.py:83`, `waku/ops/browser_agent.py:100`, `waku/app.py:46`, `waku/app.py:118`, `waku/runtime/session.py:64`, `waku/memory/retrieval_gate.py:36`, `waku/memory/procedural/loader.py:77`, `waku/loop/agent.py:59`, `waku/tools/registry.py:44`, `waku/loop/agent.py:53`, `waku/runtime/session.py:91`, `waku/memory/__init__.py:131`, `waku/memory/consolidation.py:86`, `waku/memory/__init__.py:188`, `waku/ops/tracing.py:57` | Added schemas before streaming; loop capability assumed explicitly. |
| `calendar-tool` | verified | `waku/app.py:118`, `waku/memory/retrieval_gate.py:36`, `waku/memory/semantic/store.py:67`, `waku/memory/slot_gate.py:66`, `waku/memory/episodic/store.py:16`, `waku/loop/agent.py:59`, `waku/tools/registry.py:47`, `waku/tools/calendar.py:410`, `waku/tools/calendar.py:35`, `waku/runtime/session.py:91`, `waku/memory/__init__.py:131` | Illustrative path: retrieved facts exist, create_event valid and not duplicate, next iteration returns answer. |
| `quick` | verified | `waku/app.py:46`, `waku/graph/workflows/triage.py:89`, `waku/graph/engine.py:106`, `waku/graph/workflows/triage.py:52`, `waku/graph/workflows/triage.py:73`, `waku/app.py:154`, `waku/loop/agent.py:53`, `waku/runtime/session.py:91`, `waku/memory/consolidation.py:86`, `waku/memory/__init__.py:188` | Illustrative graph enabled: classifier returns quick and calendar read succeeds. Parallel scan steps are displayed serially for inspection, not implying execution order. Parallel node inspection steps do not assert temporal order. |
| `consolidate` | corrected | `waku/runtime/session.py:91`, `waku/memory/__init__.py:131`, `waku/memory/consolidation.py:86`, `waku/memory/slot_gate.py:83`, `waku/tools/waku_memory.py:34`, `waku/memory/__init__.py:188` | Old assumption allowed a pending failure before later new remote send, which code suppresses; now pending pass succeeds. |
| `gather` | verified | `waku/ops/dashboard.py:85`, `waku/ops/commands.py:85`, `waku/graph/workflows/gather.py:111`, `waku/graph/engine.py:106`, `waku/ops/gather.py:106`, `waku/graph/workflows/gather.py:97`, `waku/ops/gather.py:118` | Illustrative explicit /gather with a nonzero PR count. Scans share one parallel wave; their listed order is explanatory. Parallel node inspection steps do not assert temporal order. |
| `delegate` | corrected | `waku/tools/__init__.py:14`, `waku/loop/agent.py:59`, `waku/tools/registry.py:47`, `waku/tools/experimental.py:194`, `waku/tools/experimental.py:101`, `waku/ops/tracing.py:103`, `waku/tools/workspace.py:81` | Explicitly restrict transcript/workspace continuation to successful JSON-mode launch; timeout returns before those artifacts. |

## Coverage gaps and risks retained

- Optional adapter internals are explicitly marked for deeper review rather than blanket-verified. Hosted identity/ledger/Docker services are source-study boundaries, not tested deployment assurances.
- Graph misses individual compare/memory/judgment arena implementations, full provider streaming conversion, MCP OAuth consent and each Apple tool. These are not ordinary stages of every user message.
- Graph factory declarations are transitions/dependencies; actual calls occur in bound runner and graph engine. Primitive phase nodes reuse one function owner and do not imply an extra implementation layer.
- Local memory may commit partial consolidation output before later failure; remote remember retries can duplicate after lost acknowledgement. No transaction/exactly-once claim is made.
- A graph fallback can repeat earlier effects; tool exception-as-text and gateway delivery errors do not roll back completed operations.
- Settings toggle save does not refresh existing browser Settings, and compare temporary homes do not automatically isolate inherited external integrations.
- Source anchors for conceptual aggregates can point to the binding/selection owner; the inspector must not imply that a selector implements the external service.

## Static audit checks

Checked graph ID uniqueness and relationship endpoints while writing the artifact. Source snippets, complete relevant owner bodies and explicit caller/topology declarations were read; source-line existence alone was not treated as semantic verification. No application tests or harness evaluation were run.
