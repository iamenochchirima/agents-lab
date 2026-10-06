import type { ExplorerGraph } from '../types';

/** Source-grounded snapshot; audit ledger records item-level limits. */
export const wakuGraph: ExplorerGraph = {
  "id": "waku",
  "name": "Waku Agent",
  "repository": "https://github.com/ShenSeanChen/waku-agent",
  "commit": "24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01",
  "description": "Local-first Python assistant: gateway → assembled working memory → sequential model/tool loop, optional triage/gather graphs, durable memory and operator evidence.",
  "scope": "Local harness, optional adapters, graph workflows and separate hosted deployment surfaces. Static source study; illustrative traces assume outcomes and do not execute Waku.",
  "limitations": [
    "Surface architecture anchors owners and contracts; external service internals, individual dashboard rendering controls and individual eval cases are collapsed.",
    "Graph triage and experimental delegation are optional, off by default; terminal/browser/cron experimental tools are explicit stubs.",
    "No default token-aware compaction, durable iteration replay, internal heartbeat or centralized approval/sandbox system is represented because plain runtime does not implement these.",
    "Consolidation runs synchronously in respond at this snapshot despite architecture prose describing asynchronous work.",
    "Browser restart/rebuild restores session identifiers but does not automatically hydrate in-memory history; explicit Session.switch does.",
    "Hosted code is separately licensed Elastic License 2.0, not shipped in PyPI; this map reads architecture without copying implementation or brand assets.",
    "Trace steps listing parallel nodes do not establish temporal order. Outcomes are assumptions, not observed runs.",
    "Item audit distinguishes verified surface contracts from collapsed adapter/deployment internals needing deeper review. Settings toggle save does not rebuild an existing browser singleton. See research audit ledger."
  ],
  "groups": [
    {
      "id": "entry",
      "label": "Entry points & gateways",
      "summary": "CLI, browser, voice and configured messaging adapters enter the same Waku harness."
    },
    {
      "id": "assembly",
      "label": "Assembly & configuration",
      "summary": "Build settings, database, clients, memory, tools and session; gateway instances have different lifetimes."
    },
    {
      "id": "browser",
      "label": "Browser session lifecycle",
      "summary": "The dashboard owns a locked singleton and persisted conversation identifiers."
    },
    {
      "id": "turn",
      "label": "Turn orchestration",
      "summary": "Waku.respond owns tracing, optional routing, normal loop execution and post-loop persistence."
    },
    {
      "id": "prompt",
      "label": "Working memory assembly",
      "summary": "Persona, local clock, gated memories, matched skills and a sliding transcript window."
    },
    {
      "id": "memory",
      "label": "Memory retrieval & stores",
      "summary": "Semantic, episodic and procedural memory are distinct; remote backends are optional."
    },
    {
      "id": "loop",
      "label": "Model ↔ tools loop",
      "summary": "Sequential provider iterations; tool results return to the model until natural exit or iteration limit."
    },
    {
      "id": "provider",
      "label": "Provider adaptation",
      "summary": "TOML provider rows resolve clients/models; OpenAI adapters retain the loop’s Anthropic-shaped interface."
    },
    {
      "id": "tools",
      "label": "Tools & side effects",
      "summary": "Default local actions, optional external adapters and experimental capabilities have different write boundaries."
    },
    {
      "id": "mcp",
      "label": "MCP & coding delegation",
      "summary": "Optional MCP connections and pi subprocess delegation extend the tool registry."
    },
    {
      "id": "persist",
      "label": "Persistence & consolidation",
      "summary": "Completed exchanges enter SQLite; due batches produce durable facts, episodes and file mirrors."
    },
    {
      "id": "graphs",
      "label": "Optional graph execution",
      "summary": "Triage wraps the same full loop; gather has parallel scans, a join and a proposal-only branch."
    },
    {
      "id": "ops",
      "label": "Observability, settings & evaluation",
      "summary": "Runtime evidence, operator changes and offline/live evaluation are distinct activities."
    },
    {
      "id": "hosted",
      "label": "Hosted deployment boundary",
      "summary": "Separate Elastic License 2.0 services surround stock Waku tenant dashboards; absent from PyPI."
    }
  ],
  "nodes": [
    {
      "id": "main",
      "label": "waku.__main__.main",
      "kind": "component",
      "groupId": "entry",
      "source": [
        {
          "file": "waku/__main__.py",
          "line": 38,
          "symbol": "main"
        }
      ],
      "summary": "CLI dispatcher selects chat, dashboard, voice, messaging, brief, gather or connection/skill administration."
    },
    {
      "id": "cli",
      "label": "gateway.cli.main",
      "kind": "component",
      "groupId": "entry",
      "source": [
        {
          "file": "waku/gateway/cli.py",
          "line": 55,
          "symbol": "main"
        }
      ],
      "summary": "Default terminal gateway constructs Waku, reads text and prints responses."
    },
    {
      "id": "http",
      "label": "dashboard.Handler",
      "kind": "component",
      "groupId": "entry",
      "source": [
        {
          "file": "waku/ops/dashboard.py",
          "line": 906,
          "symbol": "Handler"
        }
      ],
      "summary": "ThreadingHTTPServer exposes static dashboard, JSON APIs and server-sent event chat streams.",
      "notes": "Local dashboard uses HTTP/SSE and polling, not WebSocket chat."
    },
    {
      "id": "sse",
      "label": "Handler.do_POST / chat stream",
      "kind": "component",
      "groupId": "entry",
      "source": [
        {
          "file": "waku/ops/dashboard.py",
          "line": 1017,
          "symbol": "do_POST"
        }
      ],
      "summary": "POST /api/chat/stream parses a message and emits harness events plus a terminal done event.",
      "failures": "Empty message emits done error; provider/runtime exceptions become readable done errors. Browser disconnect is swallowed and does not cancel the running turn."
    },
    {
      "id": "chat",
      "label": "dashboard.chat_stream",
      "kind": "component",
      "groupId": "entry",
      "source": [
        {
          "file": "waku/ops/dashboard.py",
          "line": 85,
          "symbol": "chat_stream"
        }
      ],
      "summary": "Slash commands select explicit workflows; otherwise acquire the browser agent lock and call respond with streaming.",
      "inputs": "Message text and event emitter.",
      "outputs": "Text/tool/gate/graph events and final reply metadata."
    },
    {
      "id": "telegram",
      "label": "Telegram handle",
      "kind": "component",
      "groupId": "entry",
      "source": [
        {
          "file": "waku/gateway/telegram.py",
          "line": 52,
          "symbol": "_build_app"
        }
      ],
      "summary": "Optional Telegram polling checks allowed IDs and forwards text through GatewayAgentRunner."
    },
    {
      "id": "discord",
      "label": "Discord on_message",
      "kind": "component",
      "groupId": "entry",
      "source": [
        {
          "file": "waku/gateway/discord.py",
          "line": 137,
          "symbol": "_build_client"
        }
      ],
      "summary": "Optional Discord gateway filters messages, mention/DM posture and hourly turn budget before invoking the runner."
    },
    {
      "id": "whatsapp",
      "label": "WhatsApp webhook handler",
      "kind": "component",
      "groupId": "entry",
      "source": [
        {
          "file": "waku/gateway/whatsapp.py",
          "line": 123,
          "symbol": "_build_handler"
        }
      ],
      "summary": "Optional signed webhook integration receives WhatsApp text and delivers replies through Meta Cloud API.",
      "notes": "One locked Waku/session whatsapp serves admitted webhook senders. HTTP200 is written before model work; no message-ID deduplication is implemented here. Exceptions after ACK do not imply Meta retries or rolled-back effects."
    },
    {
      "id": "voice",
      "label": "Voice wake loop",
      "kind": "component",
      "groupId": "entry",
      "source": [
        {
          "file": "waku/gateway/voice.py",
          "line": 228,
          "symbol": "wake_loop"
        }
      ],
      "summary": "Optional local speech pipeline listens for wake word, transcribes command, responds and speaks reply."
    },
    {
      "id": "ears",
      "label": "Ears.transcribe",
      "kind": "component",
      "groupId": "entry",
      "source": [
        {
          "file": "waku/gateway/voice.py",
          "line": 58,
          "symbol": "transcribe"
        }
      ],
      "summary": "Whisper-based speech recognition converts recorded audio to text; optional voice dependency."
    },
    {
      "id": "mouth",
      "label": "Mouth.speak",
      "kind": "component",
      "groupId": "entry",
      "source": [
        {
          "file": "waku/gateway/voice.py",
          "line": 140,
          "symbol": "speak"
        }
      ],
      "summary": "Kokoro when available or platform speech renders assistant reply to audio."
    },
    {
      "id": "runner",
      "label": "GatewayAgentRunner",
      "kind": "component",
      "groupId": "entry",
      "source": [
        {
          "file": "waku/gateway/runner.py",
          "line": 34,
          "symbol": "GatewayAgentRunner"
        }
      ],
      "summary": "Messaging runner owns one executor worker, lazily constructs its Waku instance and serializes turns on that worker.",
      "notes": "A source-level gateway session is not an independently spawned agent per message."
    },
    {
      "id": "deliver",
      "label": "run_gateway_turn",
      "kind": "component",
      "groupId": "entry",
      "source": [
        {
          "file": "waku/gateway/runner.py",
          "line": 110,
          "symbol": "run_gateway_turn"
        }
      ],
      "summary": "Run the turn then send reply; runner records handling or delivery errors separately.",
      "failures": "A successful tool side effect is not rolled back when reply delivery fails."
    },
    {
      "id": "supervisor",
      "label": "GatewaySupervisor.reconcile",
      "kind": "component",
      "groupId": "entry",
      "source": [
        {
          "file": "waku/gateway/supervisor.py",
          "line": 61,
          "symbol": "reconcile"
        }
      ],
      "summary": "Reconciles configured messaging gateway handles using configuration fingerprints; starts, stops or retains handles.",
      "conditions": "Only configured optional integrations are started."
    },
    {
      "id": "brief",
      "label": "ops.brief.main",
      "kind": "component",
      "groupId": "entry",
      "source": [
        {
          "file": "waku/ops/brief.py",
          "line": 22,
          "symbol": "main"
        }
      ],
      "summary": "Runs a fixed briefing prompt through ordinary Waku.respond and saves a dated outbox reply.",
      "notes": "Scheduling requires external cron. No implemented autonomous heartbeat or internal cron scheduler."
    },
    {
      "id": "settings",
      "label": "Settings / load_settings",
      "kind": "component",
      "groupId": "assembly",
      "source": [
        {
          "file": "waku/config.py",
          "line": 130,
          "symbol": "Settings"
        },
        {
          "file": "waku/config.py",
          "line": 239,
          "symbol": "load_settings"
        }
      ],
      "summary": "Constructs Settings from field defaults and already-loaded environment; model IDs are resolved later by get_client.",
      "outputs": "Settings used to construct the harness.",
      "notes": "Defaults: anthropic, max_iterations=10, max_tokens=8192, history_turns=12, consolidate_every=6, retrieval_top_k=4; graph/experimental/Apple/GitHub switches off."
    },
    {
      "id": "home",
      "label": "resolve_home",
      "kind": "decision",
      "groupId": "assembly",
      "source": [
        {
          "file": "waku/config.py",
          "line": 58,
          "symbol": "resolve_home"
        }
      ],
      "summary": "Selects WAKU_HOME override, legacy working-directory .waku or user ~/.waku according to explicit precedence.",
      "conditions": "Legacy cwd/.waku is used only when its state.db exists and user ~/.waku/state.db does not; WAKU_HOME overrides both."
    },
    {
      "id": "waku",
      "label": "Waku.__init__",
      "kind": "component",
      "groupId": "assembly",
      "source": [
        {
          "file": "waku/app.py",
          "line": 20,
          "symbol": "__init__"
        }
      ],
      "summary": "Builds settings/home, SQLite connection and model client; then Memory, registry/MCP bridge, Session and Tracer.",
      "notes": "Memory is assembled before tools because memory-admin tools receive that facade. Waku object survives across gateway turns; prompt is rebuilt per turn."
    },
    {
      "id": "db",
      "label": "db.connect / migrations",
      "kind": "store",
      "groupId": "assembly",
      "source": [
        {
          "file": "waku/db.py",
          "line": 111,
          "symbol": "connect"
        }
      ],
      "summary": "Opens state.db, creates schema and applies additive migrations for facts, episodes, calendar events and chat metadata."
    },
    {
      "id": "memory-init",
      "label": "Memory.__init__",
      "kind": "component",
      "groupId": "assembly",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 59,
          "symbol": "__init__"
        }
      ],
      "summary": "Selects semantic and episodic stores and loads bundled/home skills; remote remember callable is wired later."
    },
    {
      "id": "registry-build",
      "label": "build_registry",
      "kind": "component",
      "groupId": "assembly",
      "source": [
        {
          "file": "waku/tools/__init__.py",
          "line": 14,
          "symbol": "build_registry"
        }
      ],
      "summary": "Registers five default tools, memory administration when wired, opt-in Apple/GitHub/experimental tools and configured MCP tools."
    },
    {
      "id": "session",
      "label": "Session",
      "kind": "component",
      "groupId": "assembly",
      "source": [
        {
          "file": "waku/runtime/session.py",
          "line": 54,
          "symbol": "Session"
        }
      ],
      "summary": "Holds an in-memory history and session_id; builds system prompt and persists completed exchanges through Memory."
    },
    {
      "id": "close",
      "label": "Waku.close",
      "kind": "state",
      "groupId": "assembly",
      "source": [
        {
          "file": "waku/app.py",
          "line": 40,
          "symbol": "close"
        }
      ],
      "summary": "Closes the MCP bridge when replacing or retiring an agent; gateway runner separately closes owned SQLite connections."
    },
    {
      "id": "singleton",
      "label": "browser_agent.get_agent",
      "kind": "component",
      "groupId": "browser",
      "source": [
        {
          "file": "waku/ops/browser_agent.py",
          "line": 83,
          "symbol": "get_agent"
        }
      ],
      "summary": "Lazily builds one browser Waku using a cross-thread SQLite connection; all tabs share the locked agent.",
      "notes": "On restart this restores a recent session identifier, but does not call Session.switch to hydrate history."
    },
    {
      "id": "resume",
      "label": "resume_or_new_session",
      "kind": "decision",
      "groupId": "browser",
      "source": [
        {
          "file": "waku/ops/browser_agent.py",
          "line": 58,
          "symbol": "resume_or_new_session"
        }
      ],
      "summary": "Finds latest dashboard-source thread and reuses its identifier if fresh; otherwise creates dated ID.",
      "conditions": "Idle window defaults to 60 minutes; nonpositive value disables age cutoff."
    },
    {
      "id": "rotate",
      "label": "maybe_rotate_session",
      "kind": "decision",
      "groupId": "browser",
      "source": [
        {
          "file": "waku/ops/browser_agent.py",
          "line": 100,
          "symbol": "maybe_rotate_session"
        }
      ],
      "summary": "An idle conversation starts a fresh dated thread, clearing in-memory history while retaining old database rows."
    },
    {
      "id": "session-action",
      "label": "dashboard.session_action",
      "kind": "component",
      "groupId": "browser",
      "source": [
        {
          "file": "waku/ops/dashboard.py",
          "line": 745,
          "symbol": "session_action"
        }
      ],
      "summary": "Dashboard new/switch/history actions create or select a thread, or read persisted chat rows."
    },
    {
      "id": "switch",
      "label": "Session.switch",
      "kind": "component",
      "groupId": "browser",
      "source": [
        {
          "file": "waku/runtime/session.py",
          "line": 118,
          "symbol": "switch"
        }
      ],
      "summary": "Loads the selected thread’s last history_turns exchanges from Memory.session_history.",
      "inputs": "Explicit session_id.",
      "outputs": "Hydrated in-memory user/assistant tail."
    },
    {
      "id": "rebuild",
      "label": "browser_agent.rebuild",
      "kind": "component",
      "groupId": "browser",
      "source": [
        {
          "file": "waku/ops/browser_agent.py",
          "line": 128,
          "symbol": "rebuild"
        }
      ],
      "summary": "Settings changes build a fresh harness, preserve conversation identifier, replace singleton and close old MCP bridge.",
      "failures": "Construction failure retains old agent.",
      "notes": "Copies session_id, not history; do not imply automatic transcript hydration during rebuild."
    },
    {
      "id": "respond",
      "label": "Waku.respond",
      "kind": "component",
      "groupId": "turn",
      "source": [
        {
          "file": "waku/app.py",
          "line": 46,
          "symbol": "respond"
        }
      ],
      "summary": "One turn composes observers, starts trace, optionally invokes graph, runs full turn as fallback, records metadata and persists results.",
      "failures": "Consolidation or export exceptions can interrupt reply return and trace completion after the completed exchange has already been persisted."
    },
    {
      "id": "observe",
      "label": "compose / captured metadata",
      "kind": "component",
      "groupId": "turn",
      "source": [
        {
          "file": "waku/ops/tracing.py",
          "line": 161,
          "symbol": "compose"
        }
      ],
      "summary": "Fans events out to UI observer, Tracer and Waku metadata collector.",
      "failures": "Observers are called synchronously without per-observer exception isolation."
    },
    {
      "id": "graph-enabled",
      "label": "graph_workflows decision",
      "kind": "decision",
      "groupId": "turn",
      "source": [
        {
          "file": "waku/app.py",
          "line": 46,
          "symbol": "respond"
        }
      ],
      "summary": "Selects optional triage graph only when Settings.graph_workflows is true.",
      "conditions": "Off by default. Graph exception or missing answer triggers ordinary full turn."
    },
    {
      "id": "full",
      "label": "Waku._run_full_turn",
      "kind": "component",
      "groupId": "turn",
      "source": [
        {
          "file": "waku/app.py",
          "line": 118,
          "symbol": "_run_full_turn"
        }
      ],
      "summary": "Builds system prompt, selects history window plus user message, and calls unchanged run_loop."
    },
    {
      "id": "build-system",
      "label": "Session.build_system",
      "kind": "component",
      "groupId": "prompt",
      "source": [
        {
          "file": "waku/runtime/session.py",
          "line": 64,
          "symbol": "build_system"
        }
      ],
      "summary": "Combines SOUL.md, clock/timezone, model/provider identity, gated memory context and matched skill bodies."
    },
    {
      "id": "soul",
      "label": "load_soul / SOUL.md",
      "kind": "store",
      "groupId": "prompt",
      "source": [
        {
          "file": "waku/runtime/session.py",
          "line": 45,
          "symbol": "load_soul"
        }
      ],
      "summary": "Creates default persona file if absent and reads editable SOUL.md on each full turn."
    },
    {
      "id": "clock",
      "label": "Clock and model identity",
      "kind": "state",
      "groupId": "prompt",
      "source": [
        {
          "file": "waku/runtime/session.py",
          "line": 64,
          "symbol": "build_system"
        }
      ],
      "summary": "Prompt includes local aware datetime and configured full-model/provider identity."
    },
    {
      "id": "history-window",
      "label": "history_turns sliding window",
      "kind": "state",
      "groupId": "prompt",
      "source": [
        {
          "file": "waku/app.py",
          "line": 118,
          "symbol": "_run_full_turn"
        }
      ],
      "summary": "For positive history_turns, the last history_turns × 2 user/assistant rows plus new message enter the request.",
      "notes": "Default history_turns=12 bounds history by windowing; zero selects all history because Python [-0:] starts at zero. This is not token-aware compaction. No built-in provider overflow recovery or summary compactor in the plain loop."
    },
    {
      "id": "gated-retrieve",
      "label": "Memory.gated_retrieve",
      "kind": "component",
      "groupId": "memory",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 107,
          "symbol": "gated_retrieve"
        }
      ],
      "summary": "Gate decision precedes semantic search; optional slot gate filters facts, then episodic results are appended."
    },
    {
      "id": "retrieval-gate",
      "label": "should_retrieve",
      "kind": "decision",
      "groupId": "memory",
      "source": [
        {
          "file": "waku/memory/retrieval_gate.py",
          "line": 36,
          "symbol": "should_retrieve"
        }
      ],
      "summary": "Small model produces retrieve/query/reason JSON for current message.",
      "failures": "Exception or no JSON retrieves using original message; failed retrieval itself is not caught here."
    },
    {
      "id": "fact-select",
      "label": "Memory._make_fact_store",
      "kind": "decision",
      "groupId": "memory",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 75,
          "symbol": "_make_fact_store"
        }
      ],
      "summary": "Selects SQLite default or optional Supabase, Mem0, Zep or LangMem FactStore adapters."
    },
    {
      "id": "facts",
      "label": "SqliteFactStore",
      "kind": "store",
      "groupId": "memory",
      "source": [
        {
          "file": "waku/memory/semantic/store.py",
          "line": 67,
          "symbol": "SqliteFactStore"
        }
      ],
      "summary": "Local facts are keyword-searchable through FTS5 and support add/update/delete and pending sync tracking."
    },
    {
      "id": "remote-facts",
      "label": "Optional FactStore adapters",
      "kind": "external",
      "groupId": "memory",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 75,
          "symbol": "_make_fact_store"
        }
      ],
      "summary": "Configured remote semantic adapters replace local fact-store calls; require their own configuration and optional dependencies.",
      "notes": "Export markdown still queries local SQLite facts, so mirror is not asserted to include all remote backend content."
    },
    {
      "id": "slot",
      "label": "slot_gate.select",
      "kind": "decision",
      "groupId": "memory",
      "source": [
        {
          "file": "waku/memory/slot_gate.py",
          "line": 66,
          "symbol": "select"
        }
      ],
      "summary": "Optional Jev scores retrieved facts and keeps those meeting threshold.",
      "conditions": "WAKU_SLOT_GATE=jev and nonempty TYPESAFE_API_KEY; default select threshold0.5 unless configured.",
      "failures": "Caught scoring/answer errors return baseline facts. Other failures outside that scoring catch are not claimed impossible."
    },
    {
      "id": "episodes",
      "label": "SqliteEpisodeStore",
      "kind": "store",
      "groupId": "memory",
      "source": [
        {
          "file": "waku/memory/episodic/store.py",
          "line": 16,
          "symbol": "SqliteEpisodeStore"
        }
      ],
      "summary": "Default dated episode store supports search, add and management.",
      "notes": "FTS ranking then date recency for nonempty query; empty tokenized query returns most recent episodes."
    },
    {
      "id": "notion",
      "label": "NotionEpisodeStore",
      "kind": "external",
      "groupId": "memory",
      "source": [
        {
          "file": "waku/memory/episodic/notion_store.py",
          "line": 39,
          "symbol": "NotionEpisodeStore"
        }
      ],
      "summary": "Optional Notion-backed episodic store is selected instead of SQLite."
    },
    {
      "id": "skills",
      "label": "SkillLoader.match",
      "kind": "component",
      "groupId": "memory",
      "source": [
        {
          "file": "waku/memory/procedural/loader.py",
          "line": 77,
          "symbol": "match"
        }
      ],
      "summary": "Refresh reads/validates SKILL.md bodies; match scores ASCII keyword overlap in name/description, needs overlap≥2, returns at most two skills.",
      "notes": "File signatures trigger reload after edits. All bodies are held after refresh; only matched bodies enter the prompt."
    },
    {
      "id": "skill-install",
      "label": "Skill installer / exporter",
      "kind": "component",
      "groupId": "memory",
      "source": [
        {
          "file": "waku/memory/procedural/installer.py",
          "line": 28,
          "symbol": "install"
        }
      ],
      "summary": "CLI installs a skill into home skills; exporter carries skill resources to another agent.",
      "notes": "Administrative capability, not automatic memory retrieval."
    },
    {
      "id": "loop",
      "label": "run_loop",
      "kind": "component",
      "groupId": "loop",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "summary": "Reason → append assistant blocks → run requested tools sequentially → append tool results → repeat.",
      "notes": "Tools run whenever tool_use blocks exist, even if provider stop_reason is max_tokens. Prompt instruction once-per-tool is not enforced by loop."
    },
    {
      "id": "stream-choice",
      "label": "Streaming capability decision",
      "kind": "decision",
      "groupId": "loop",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "summary": "At loop entry, chooses streaming when requested and client.messages.stream exists; that capability decision is reused for all iterations."
    },
    {
      "id": "stream",
      "label": "messages.stream / text deltas",
      "kind": "state",
      "groupId": "loop",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "summary": "Emits incremental text to observer and retrieves final message from stream.",
      "failures": "Provider 4xx rethrows immediately; other streaming errors fall back to one nonstreaming create call."
    },
    {
      "id": "create",
      "label": "messages.create",
      "kind": "state",
      "groupId": "loop",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "summary": "Invokes configured provider with model/system/messages/current tool schemas/max_tokens."
    },
    {
      "id": "response",
      "label": "Assistant response appended",
      "kind": "state",
      "groupId": "loop",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "summary": "Usage/stop_reason event emitted; assistant response blocks appended to request-local messages."
    },
    {
      "id": "tool-decision",
      "label": "Any tool_use blocks?",
      "kind": "decision",
      "groupId": "loop",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "summary": "No tool calls returns concatenated text. Tool calls enter sequential execution regardless of stop_reason string."
    },
    {
      "id": "tool-results",
      "label": "Tool result blocks",
      "kind": "state",
      "groupId": "loop",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "summary": "Each output is tied to tool_use_id, then all result blocks appended as user content for next iteration."
    },
    {
      "id": "limit",
      "label": "Maximum iterations",
      "kind": "decision",
      "groupId": "loop",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "summary": "After configured iteration count, returns an explicit unfinished-task reply.",
      "notes": "This is not token-budget admission, retry policy or durable workflow resume."
    },
    {
      "id": "reply",
      "label": "LoopResult",
      "kind": "state",
      "groupId": "loop",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 53,
          "symbol": "LoopResult"
        }
      ],
      "summary": "Carries reply, collected tool activity and iteration count to turn finalization."
    },
    {
      "id": "providers",
      "label": "Provider registry / providers.toml",
      "kind": "component",
      "groupId": "provider",
      "source": [
        {
          "file": "waku/loop/models.py",
          "line": 122,
          "symbol": "_registry"
        }
      ],
      "summary": "Parses TOML provider definitions including endpoints, default models, visibility and credential scoping."
    },
    {
      "id": "client",
      "label": "get_client",
      "kind": "component",
      "groupId": "provider",
      "source": [
        {
          "file": "waku/loop/models.py",
          "line": 279,
          "symbol": "get_client"
        }
      ],
      "summary": "Validates provider/visibility/key, resolves model pair and endpoint, constructs Anthropic SDK or OpenAICompatClient.",
      "failures": "Unknown/unconfigured provider or invalid key produces SystemExit; SDK network calls have configured timeout default120s.",
      "outputs": "Configured Anthropic SDK or OpenAICompatClient; network calls occur later through messages create/stream."
    },
    {
      "id": "compat",
      "label": "OpenAICompatClient",
      "kind": "component",
      "groupId": "provider",
      "source": [
        {
          "file": "waku/loop/models.py",
          "line": 336,
          "symbol": "OpenAICompatClient"
        }
      ],
      "summary": "Exposes Messages-like create/stream while converting Anthropic-shaped messages/tools to OpenAI wire format."
    },
    {
      "id": "convert",
      "label": "_to_openai",
      "kind": "component",
      "groupId": "provider",
      "source": [
        {
          "file": "waku/loop/models.py",
          "line": 348,
          "symbol": "_to_openai"
        }
      ],
      "summary": "Converts system, text, tool requests and tool results into Chat Completions request parameters."
    },
    {
      "id": "compat-call",
      "label": "OpenAICompatClient._call",
      "kind": "component",
      "groupId": "provider",
      "source": [
        {
          "file": "waku/loop/models.py",
          "line": 394,
          "symbol": "_call"
        }
      ],
      "summary": "Calls OpenAI Chat Completions and handles specific unsupported parameter compatibility fallback."
    },
    {
      "id": "model-api",
      "label": "Model API",
      "kind": "external",
      "groupId": "provider",
      "source": [
        {
          "file": "waku/loop/models.py",
          "line": 279,
          "symbol": "get_client"
        }
      ],
      "summary": "Configured provider endpoint supplies full-model, small-model and optional adapter API calls.",
      "notes": "Graph traces are illustrative; this Studio explorer never invokes providers."
    },
    {
      "id": "schemas",
      "label": "ToolRegistry.schemas",
      "kind": "component",
      "groupId": "tools",
      "source": [
        {
          "file": "waku/tools/registry.py",
          "line": 44,
          "symbol": "schemas"
        }
      ],
      "summary": "Returns every registered tool’s API schema in each loop provider request."
    },
    {
      "id": "execute",
      "label": "ToolRegistry.execute",
      "kind": "component",
      "groupId": "tools",
      "source": [
        {
          "file": "waku/tools/registry.py",
          "line": 47,
          "symbol": "execute"
        }
      ],
      "summary": "Finds tool by name and invokes Python callable with arguments; optionally forwards observer.",
      "failures": "Unknown name and caught tool exception become text returned to model.",
      "notes": "No centralized approval queue, JSON-schema validator or tool sandbox is implemented here. Persona instructions are not enforced access controls."
    },
    {
      "id": "calendar",
      "label": "create_event",
      "kind": "component",
      "groupId": "tools",
      "source": [
        {
          "file": "waku/tools/calendar.py",
          "line": 410,
          "symbol": "create_event"
        }
      ],
      "summary": "Checks required arguments, defaults end time, deduplicates title/start, commits SQLite then writes ICS and optional external mirrors.",
      "failures": "Local commit precedes ICS/external writes; failures can leave partially completed artifacts."
    },
    {
      "id": "ics",
      "label": "calendar.ics / calendar_events",
      "kind": "store",
      "groupId": "tools",
      "source": [
        {
          "file": "waku/tools/calendar.py",
          "line": 35,
          "symbol": "_write_ics"
        }
      ],
      "summary": "Local event table plus appended ICS file are calendar artifacts; table title/start check prevents common duplicate booking."
    },
    {
      "id": "calendar-read",
      "label": "list_events",
      "kind": "component",
      "groupId": "tools",
      "source": [
        {
          "file": "waku/tools/calendar.py",
          "line": 531,
          "symbol": "list_events"
        }
      ],
      "summary": "Reads local SQLite events plus connected Google Calendar, labeling actual consulted sources; does not read Apple calendar through this tool.",
      "notes": "Google sign-in determines read access independently of google_calendar write-through switch. Optional Apple reader is a separate registered Apple tool."
    },
    {
      "id": "google",
      "label": "Google Calendar adapter",
      "kind": "external",
      "groupId": "tools",
      "source": [
        {
          "file": "waku/tools/calendar.py",
          "line": 296,
          "symbol": "sync_to_google_calendar"
        }
      ],
      "summary": "Optional write-through target for local created events; Google auth/setup is separate."
    },
    {
      "id": "apple",
      "label": "Apple tools / AppleScript",
      "kind": "external",
      "groupId": "tools",
      "source": [
        {
          "file": "waku/tools/apple.py",
          "line": 260,
          "symbol": "make_tools"
        }
      ],
      "summary": "Optional Calendar/Mail/Reminders/Notes adapters interact with macOS applications and Automation permissions."
    },
    {
      "id": "note",
      "label": "save_note",
      "kind": "component",
      "groupId": "tools",
      "source": [
        {
          "file": "waku/tools/notes.py",
          "line": 15,
          "symbol": "make_tool"
        }
      ],
      "summary": "Default note tool writes a fact to local SQLite."
    },
    {
      "id": "message",
      "label": "send_message",
      "kind": "component",
      "groupId": "tools",
      "source": [
        {
          "file": "waku/tools/messages.py",
          "line": 16,
          "symbol": "make_tool"
        }
      ],
      "summary": "Default messaging tool drafts into local outbox; it does not send to a real recipient."
    },
    {
      "id": "search",
      "label": "search_web",
      "kind": "component",
      "groupId": "tools",
      "source": [
        {
          "file": "waku/tools/search.py",
          "line": 61,
          "symbol": "make_tool"
        }
      ],
      "summary": "Web search defaults to DuckDuckGo HTML; configured Tavily supplies optional richer search results."
    },
    {
      "id": "github",
      "label": "GitHub gh tool",
      "kind": "external",
      "groupId": "tools",
      "source": [
        {
          "file": "waku/tools/github.py",
          "line": 178,
          "symbol": "make_tool"
        }
      ],
      "summary": "Optional read-only GitHub tool uses gh CLI authentication; gather can use helper without registering model tool."
    },
    {
      "id": "manage",
      "label": "manage_memory",
      "kind": "component",
      "groupId": "tools",
      "source": [
        {
          "file": "waku/tools/memory_admin.py",
          "line": 29,
          "symbol": "manage_memory"
        }
      ],
      "summary": "Searches facts/episodes, updates facts only, and deletes either through configured stores; episode search filters recent list results.",
      "conditions": "action search/update/delete; episode update is rejected."
    },
    {
      "id": "update-soul",
      "label": "update_soul",
      "kind": "component",
      "groupId": "tools",
      "source": [
        {
          "file": "waku/tools/memory_admin.py",
          "line": 88,
          "symbol": "update_soul"
        }
      ],
      "summary": "Persists an added standing rule to SOUL.md.",
      "notes": "Checks existing SOUL.md length against 8000 before appending; a long new rule can exceed that size. Takes effect in a later full-turn prompt."
    },
    {
      "id": "create-skill",
      "label": "create_skill",
      "kind": "component",
      "groupId": "tools",
      "source": [
        {
          "file": "waku/tools/memory_admin.py",
          "line": 119,
          "symbol": "create_skill"
        }
      ],
      "summary": "Creates persistent SKILL.md under home skills and refreshes loader.",
      "notes": "User agreement is model-facing description/persona instruction, not an enforced approval gate.",
      "conditions": "Valid slug, absent built-in/user destination and parseable frontmatter.",
      "failures": "Invalid name, duplicate skill or invalid frontmatter returns explanatory text; registry catches filesystem errors."
    },
    {
      "id": "stubs",
      "label": "Experimental skeleton tools",
      "kind": "component",
      "groupId": "tools",
      "source": [
        {
          "file": "waku/tools/experimental.py",
          "line": 329,
          "symbol": "make_tools"
        }
      ],
      "summary": "run_command, browse_web and schedule_task explicitly return coming-soon text.",
      "conditions": "Only registered with experimental flag; these are not functioning terminal/browser/scheduler capabilities."
    },
    {
      "id": "mcp",
      "label": "MCPBridge.start",
      "kind": "component",
      "groupId": "mcp",
      "source": [
        {
          "file": "waku/tools/mcp_client.py",
          "line": 129,
          "symbol": "start"
        }
      ],
      "summary": "Configured home/mcp.json starts bridge loop and discovers namespaced tools from connected servers.",
      "conditions": "Only when config exists and optional MCP extra available."
    },
    {
      "id": "transport",
      "label": "MCPBridge._open_streams",
      "kind": "component",
      "groupId": "mcp",
      "source": [
        {
          "file": "waku/tools/mcp_client.py",
          "line": 155,
          "symbol": "_open_streams"
        }
      ],
      "summary": "Selects stdio subprocess or remote transport and configured authentication."
    },
    {
      "id": "mcp-call",
      "label": "MCPBridge.call",
      "kind": "component",
      "groupId": "mcp",
      "source": [
        {
          "file": "waku/tools/mcp_client.py",
          "line": 293,
          "symbol": "call"
        }
      ],
      "summary": "Schedules async server call on bridge event loop; adapter result becomes registry tool output."
    },
    {
      "id": "remember",
      "label": "remember_via",
      "kind": "component",
      "groupId": "mcp",
      "source": [
        {
          "file": "waku/tools/waku_memory.py",
          "line": 34,
          "symbol": "remember_via"
        }
      ],
      "summary": "Returns callable for connected waku_memory MCP memory.remember; absent server gives no remote send."
    },
    {
      "id": "delegate",
      "label": "delegate_task",
      "kind": "component",
      "groupId": "mcp",
      "source": [
        {
          "file": "waku/tools/experimental.py",
          "line": 194,
          "symbol": "delegate_task"
        }
      ],
      "summary": "Experimental coding delegation checks pi installation, workdir, provider mapping and timeout; launches pi headless.",
      "conditions": "Experimental flag enabled; pi executable available. Existing cwd and scratch workspace have different completion behavior."
    },
    {
      "id": "pi",
      "label": "pi subprocess",
      "kind": "external",
      "groupId": "mcp",
      "source": [
        {
          "file": "waku/tools/experimental.py",
          "line": 101,
          "symbol": "_run_pi_json"
        }
      ],
      "summary": "Runs external coding specialist in JSON mode when supported, relays curated events and collects token usage.",
      "failures": "Deadline kills process; older pi falls back to captured print-mode text."
    },
    {
      "id": "workspace",
      "label": "Workspace / autorun / manifest",
      "kind": "store",
      "groupId": "mcp",
      "source": [
        {
          "file": "waku/tools/workspace.py",
          "line": 81,
          "symbol": "autorun"
        }
      ],
      "summary": "Repo-less delegation creates dated work folder, preserves transcript and files, selects generated entrypoint for autorun and writes manifest.",
      "notes": "Existing user cwd is not autorun or relocated. This is not a general sandbox guarantee."
    },
    {
      "id": "exchange",
      "label": "Session.add_exchange",
      "kind": "component",
      "groupId": "persist",
      "source": [
        {
          "file": "waku/runtime/session.py",
          "line": 91,
          "symbol": "add_exchange"
        }
      ],
      "summary": "Appends user/reply to history; folds tool activity into assistant record, then calls log_chat."
    },
    {
      "id": "chat-log",
      "label": "Memory.log_chat / chat_log",
      "kind": "store",
      "groupId": "persist",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 131,
          "symbol": "log_chat"
        }
      ],
      "summary": "Commits two completed exchange rows with session/source and assistant metadata.",
      "notes": "Plain loop does not persist each provider/tool iteration as resumable chat state; traces retain events."
    },
    {
      "id": "due",
      "label": "Consolidation threshold",
      "kind": "decision",
      "groupId": "persist",
      "source": [
        {
          "file": "waku/memory/consolidation.py",
          "line": 86,
          "symbol": "kept_if_due"
        }
      ],
      "summary": "Reads all unconsolidated chat rows across sessions; needs every_n × 2 rows before summarization.",
      "notes": "Called synchronously inside respond after exchange persistence; contrary to architecture prose describing it as asynchronous."
    },
    {
      "id": "summarize",
      "label": "Consolidation small-model call",
      "kind": "component",
      "groupId": "persist",
      "source": [
        {
          "file": "waku/memory/consolidation.py",
          "line": 86,
          "symbol": "kept_if_due"
        }
      ],
      "summary": "Small model extracts durable facts, optional episode and company_research scope from unconsolidated log.",
      "failures": "API exceptions or no parseable JSON return no facts and leave chat rows unconsolidated; truncation alone is not checked."
    },
    {
      "id": "keep",
      "label": "slot_gate.keep",
      "kind": "decision",
      "groupId": "persist",
      "source": [
        {
          "file": "waku/memory/slot_gate.py",
          "line": 83,
          "symbol": "keep"
        }
      ],
      "summary": "Optional Jev filters proposed facts for future usefulness; disabled/failure retains baseline proposals.",
      "conditions": "Same opt-in gate; default WAKU_KEEP_GATE_MIN=1.0, configurable independently of retrieval threshold."
    },
    {
      "id": "commit-memory",
      "label": "Consolidation store updates",
      "kind": "component",
      "groupId": "persist",
      "source": [
        {
          "file": "waku/memory/consolidation.py",
          "line": 86,
          "symbol": "kept_if_due"
        }
      ],
      "summary": "Writes kept facts and episode, optionally sends remote remembers, then marks sampled chat rows consolidated.",
      "failures": "Stores commit independently. A later store failure can leave facts persisted with chats unconsolidated, allowing duplicate facts on a later batch.",
      "notes": "Fact/episode stores may commit each operation; selected chat rows are marked consolidated at the end. Mid-write failure can retain partial durable writes and unconsolidated chats."
    },
    {
      "id": "sync",
      "label": "Pending Waku Memory sends",
      "kind": "state",
      "groupId": "persist",
      "source": [
        {
          "file": "waku/memory/consolidation.py",
          "line": 86,
          "symbol": "kept_if_due"
        }
      ],
      "summary": "SQLite tracks unsynced facts and scope; due batch retries pending sends before new facts.",
      "failures": "First failed send prevents further sends in batch; local facts retained. Non-SQLite stores do not track retries.",
      "conditions": "Due consolidation batch; remote remember configured. Durable pending tracking requires SqliteFactStore.",
      "notes": "Retry pending rows before summary. After first failed send, reachable=false suppresses remaining sends. Successful remote send then crash before mark_synced may be retried; no exactly-once guarantee."
    },
    {
      "id": "mirror",
      "label": "Memory.export_markdown",
      "kind": "store",
      "groupId": "persist",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 188,
          "symbol": "export_markdown"
        }
      ],
      "summary": "Regenerates human-readable MEMORY.md and per-fact memory/id.md from local SQLite rows after turn."
    },
    {
      "id": "graph-engine",
      "label": "run_graph",
      "kind": "component",
      "groupId": "graphs",
      "source": [
        {
          "file": "waku/graph/engine.py",
          "line": 106,
          "symbol": "run_graph"
        }
      ],
      "summary": "Schedules dependency-ready waves, runs independent nodes in ThreadPoolExecutor and merges outputs in wave order.",
      "failures": "Node-function exceptions become state.errors and optional on_error jumps. Router/observer exceptions and GraphStateCollision can propagate; max_steps and max_visits bound scheduling.",
      "notes": "Parallel nodes receive shallow state snapshots; nested values can still be shared. Output merges are deterministic in submitted wave order."
    },
    {
      "id": "triage",
      "label": "build_triage_graph",
      "kind": "component",
      "groupId": "graphs",
      "source": [
        {
          "file": "waku/graph/workflows/triage.py",
          "line": 89,
          "symbol": "build_triage_graph"
        }
      ],
      "summary": "START fans out to classify and check_calendar; gather barrier routes quick_reply or full_agent."
    },
    {
      "id": "classify",
      "label": "triage classify_message",
      "kind": "decision",
      "groupId": "graphs",
      "source": [
        {
          "file": "waku/graph/workflows/triage.py",
          "line": 52,
          "symbol": "classify_message"
        }
      ],
      "summary": "Small-model classification chooses quick/full.",
      "failures": "Malformed JSON or provider failure chooses full."
    },
    {
      "id": "check-calendar",
      "label": "triage todays_events",
      "kind": "component",
      "groupId": "graphs",
      "source": [
        {
          "file": "waku/graph/workflows/triage.py",
          "line": 73,
          "symbol": "todays_events"
        }
      ],
      "summary": "Reads today’s titles from local calendar.ics concurrently with classifier."
    },
    {
      "id": "join",
      "label": "triage gather barrier",
      "kind": "state",
      "groupId": "graphs",
      "source": [
        {
          "file": "waku/graph/workflows/triage.py",
          "line": 89,
          "symbol": "build_triage_graph"
        }
      ],
      "summary": "Waits for classification and calendar static dependencies; code key_router selects next node."
    },
    {
      "id": "quick",
      "label": "quick_reply",
      "kind": "component",
      "groupId": "graphs",
      "source": [
        {
          "file": "waku/app.py",
          "line": 154,
          "symbol": "quick_reply"
        }
      ],
      "summary": "Small model answers using quick prompt with calendar and message; no tools, full prompt or memory retrieval.",
      "outputs": "Reply wrapped as LoopResult with iterations=1."
    },
    {
      "id": "fallback",
      "label": "Graph fallback to full turn",
      "kind": "decision",
      "groupId": "graphs",
      "source": [
        {
          "file": "waku/app.py",
          "line": 46,
          "symbol": "respond"
        }
      ],
      "summary": "Graph exception or no answer returns control to same full-turn method.",
      "notes": "Do not infer transactional rollback: side effects already performed by a failed graph node may survive fallback."
    },
    {
      "id": "commands",
      "label": "Slash command workflow registry",
      "kind": "component",
      "groupId": "graphs",
      "source": [
        {
          "file": "waku/ops/commands.py",
          "line": 85,
          "symbol": "parse"
        }
      ],
      "summary": "Parses slash command text; execution resolves discoverable workflow/binder pairs or returns an unknown-command response."
    },
    {
      "id": "gather",
      "label": "build_gather_graph",
      "kind": "component",
      "groupId": "graphs",
      "source": [
        {
          "file": "waku/graph/workflows/gather.py",
          "line": 111,
          "symbol": "build_gather_graph"
        }
      ],
      "summary": "Proposal-only graph runs four independent scans then synthesizes; count-based router chooses draft or quiet."
    },
    {
      "id": "scans",
      "label": "Gather parallel scans",
      "kind": "component",
      "groupId": "graphs",
      "source": [
        {
          "file": "waku/graph/workflows/gather.py",
          "line": 111,
          "symbol": "build_gather_graph"
        }
      ],
      "summary": "scan_github, scan_web, scan_calendar, scan_memory write disjoint prefixed keys.",
      "failures": "Each scan uses _safe returning honest fallback so join can complete."
    },
    {
      "id": "synthesis",
      "label": "Gather synthesize / barrier",
      "kind": "component",
      "groupId": "graphs",
      "source": [
        {
          "file": "waku/ops/gather.py",
          "line": 106,
          "symbol": "_synthesize"
        }
      ],
      "summary": "One model call receives gathered data without tool schemas; synthesizes a proposed digest."
    },
    {
      "id": "action",
      "label": "needs_action",
      "kind": "decision",
      "groupId": "graphs",
      "source": [
        {
          "file": "waku/graph/workflows/gather.py",
          "line": 97,
          "symbol": "needs_action"
        }
      ],
      "summary": "Code routes propose when PR/issue/event counts nonzero; otherwise quiet END."
    },
    {
      "id": "draft",
      "label": "Gather draft_digest",
      "kind": "store",
      "groupId": "graphs",
      "source": [
        {
          "file": "waku/ops/gather.py",
          "line": 118,
          "symbol": "_draft"
        }
      ],
      "summary": "Writes markdown proposal to local outbox, not external actions or messages."
    },
    {
      "id": "tracer",
      "label": "Tracer",
      "kind": "component",
      "groupId": "ops",
      "source": [
        {
          "file": "waku/ops/tracing.py",
          "line": 57,
          "symbol": "Tracer"
        }
      ],
      "summary": "Records turn markers and non-text harness events to JSONL; llm events also append usage. Optional OTel records event spans.",
      "notes": "Streaming text deltas are deliberately skipped; turn_end is written only after successful respond completion.",
      "failures": "Invalid existing trace encoding or file write errors propagate through observer/turn calls; compose does not isolate failures."
    },
    {
      "id": "trace-files",
      "label": "traces/*.jsonl",
      "kind": "store",
      "groupId": "ops",
      "source": [
        {
          "file": "waku/ops/tracing.py",
          "line": 90,
          "symbol": "_write"
        }
      ],
      "summary": "Appends timestamped JSONL records using UTF-8, validating existing trace encoding once; nonserializable details use str conversion."
    },
    {
      "id": "usage",
      "label": "usage.jsonl spend ledger",
      "kind": "store",
      "groupId": "ops",
      "source": [
        {
          "file": "waku/ops/tracing.py",
          "line": 103,
          "symbol": "_record_usage"
        }
      ],
      "summary": "Records usage emitted through loop llm events; delegation appends subagent usage to same ledger.",
      "notes": "Small-model gate/classification/consolidation create calls do not emit run_loop llm events, so ledger is not asserted to capture every API request."
    },
    {
      "id": "otel",
      "label": "Optional OTel exporter",
      "kind": "external",
      "groupId": "ops",
      "source": [
        {
          "file": "waku/ops/tracing.py",
          "line": 68,
          "symbol": "_init_otel"
        }
      ],
      "summary": "Configured endpoint enables SDK instrumentation/export; absence/dependency errors leave local JSONL path."
    },
    {
      "id": "collect",
      "label": "Dashboard collect / events_since",
      "kind": "component",
      "groupId": "ops",
      "source": [
        {
          "file": "waku/ops/dashboard.py",
          "line": 280,
          "symbol": "collect"
        }
      ],
      "summary": "Reads stores, artifacts, usage/eval reports and trace history for dashboard views."
    },
    {
      "id": "integration",
      "label": "Integration registry / apply",
      "kind": "component",
      "groupId": "ops",
      "source": [
        {
          "file": "waku/integrations.py",
          "line": 643,
          "symbol": "apply_integration"
        }
      ],
      "summary": "Validates/probes connection changes, writes configuration, then rebuilds agent or reconciles gateway according to integration reload mode.",
      "failures": "Failed probe can offer force; failed reload restores configuration/environment and records integration error. Gateway rollback triggers reconcile again."
    },
    {
      "id": "setting-api",
      "label": "Settings API / provider switch",
      "kind": "component",
      "groupId": "ops",
      "source": [
        {
          "file": "waku/ops/settings_api.py",
          "line": 102,
          "symbol": "apply_settings"
        }
      ],
      "summary": "Writes experimental and graph-workflow toggles to dotenv/environment; does not rebuild an already-created browser Waku.",
      "notes": "An existing singleton retains its prior Settings. A later successful integration/provider rebuild or server restart constructs new settings.",
      "outputs": "Updated environment/settings_info; no automatic live-agent replacement."
    },
    {
      "id": "arena",
      "label": "Compare arena / compare_stream",
      "kind": "component",
      "groupId": "ops",
      "source": [
        {
          "file": "waku/ops/arena.py",
          "line": 35,
          "symbol": "compare_stream"
        }
      ],
      "summary": "Explicit comparison races construct one Waku per model in separate temporary home directories and stream structural events.",
      "notes": "Apple calendar can opt into real external writes; inherited environment can enable other optional integrations. Separate memory/judgment arenas remain coverage gaps, not claimed internals of compare_stream."
    },
    {
      "id": "gate",
      "label": "Release gate",
      "kind": "component",
      "groupId": "ops",
      "source": [
        {
          "file": "waku/ops/release_gate.py",
          "line": 62,
          "symbol": "main"
        }
      ],
      "summary": "Runs deterministic pytest suite first; runs judge suite only when active provider credentials exist, writes report and exits nonzero on suite failure.",
      "notes": "No configured key produces judge=skipped and gate-open exit; release gate does not always require scored judge evidence. No suites were executed for this audit."
    },
    {
      "id": "host-gateway",
      "label": "hosted.gateway.Gateway",
      "kind": "component",
      "groupId": "hosted",
      "source": [
        {
          "file": "hosted/gateway/app.py",
          "line": 200,
          "symbol": "Gateway"
        }
      ],
      "summary": "Separate hosted front door authenticates sessions, routes tenant hosts and applies route policy before forwarding."
    },
    {
      "id": "identity",
      "label": "JwksVerifier",
      "kind": "component",
      "groupId": "hosted",
      "source": [
        {
          "file": "hosted/gateway/identity.py",
          "line": 75,
          "symbol": "JwksVerifier"
        }
      ],
      "summary": "Verifies hosted identity tokens using asymmetric JWKS; operator services own auth configuration."
    },
    {
      "id": "launcher",
      "label": "Launcher / tenant provisioning",
      "kind": "component",
      "groupId": "hosted",
      "source": [
        {
          "file": "hosted/gateway/launch.py",
          "line": 59,
          "symbol": "Launcher"
        }
      ],
      "summary": "Hosted launch ensures eligible tenant runtime through spawner and quota/capacity controls."
    },
    {
      "id": "docker",
      "label": "DockerRuntime",
      "kind": "component",
      "groupId": "hosted",
      "source": [
        {
          "file": "hosted/spawner/docker.py",
          "line": 192,
          "symbol": "DockerRuntime"
        }
      ],
      "summary": "Spawner manages tenant containers, persistent home volumes and resource constraints; local harness never imports hosted services."
    },
    {
      "id": "forward",
      "label": "ContainerForwarder",
      "kind": "component",
      "groupId": "hosted",
      "source": [
        {
          "file": "hosted/gateway/forward.py",
          "line": 168,
          "symbol": "ContainerForwarder"
        }
      ],
      "summary": "Forwards allowed authenticated requests to tenant dashboard, preserving streaming response behavior."
    },
    {
      "id": "tenant",
      "label": "Stock Waku tenant dashboard",
      "kind": "external",
      "groupId": "hosted",
      "source": [
        {
          "file": "hosted/gateway/forward.py",
          "line": 168,
          "symbol": "ContainerForwarder"
        }
      ],
      "summary": "Each tenant runs stock waku.dashboard with private home; hosted deployment wraps same harness rather than replacing loop."
    },
    {
      "id": "meter",
      "label": "MeteringProxy",
      "kind": "component",
      "groupId": "hosted",
      "source": [
        {
          "file": "hosted/proxy/app.py",
          "line": 113,
          "symbol": "MeteringProxy"
        }
      ],
      "summary": "Platform provider calls authenticate tenant key, validate request, meter usage and relay upstream response."
    },
    {
      "id": "admit",
      "label": "Proxy admit",
      "kind": "decision",
      "groupId": "hosted",
      "source": [
        {
          "file": "hosted/proxy/admission.py",
          "line": 82,
          "symbol": "admit"
        }
      ],
      "summary": "Validates allowed model, token ceiling and supported content/request keys before metered upstream call."
    },
    {
      "id": "ledger",
      "label": "Hosted Ledger",
      "kind": "store",
      "groupId": "hosted",
      "source": [
        {
          "file": "hosted/proxy/ledger.py",
          "line": 72,
          "symbol": "Ledger"
        }
      ],
      "summary": "Separate ledger.db records platform spend/credits; differs from tenant usage.jsonl."
    },
    {
      "id": "upstream",
      "label": "AnthropicUpstream",
      "kind": "external",
      "groupId": "hosted",
      "source": [
        {
          "file": "hosted/proxy/upstream.py",
          "line": 23,
          "symbol": "AnthropicUpstream"
        }
      ],
      "summary": "Platform proxy supplies upstream credential; tenant container holds scoped platform token rather than operator model key."
    }
  ],
  "edges": [
    {
      "id": "main-cli-0",
      "to": "cli",
      "kind": "call",
      "label": "default chat",
      "source": [
        {
          "file": "waku/__main__.py",
          "line": 38,
          "symbol": "main"
        }
      ],
      "from": "main"
    },
    {
      "id": "main-http-1",
      "to": "http",
      "kind": "call",
      "label": "dashboard command",
      "source": [
        {
          "file": "waku/__main__.py",
          "line": 38,
          "symbol": "main"
        }
      ],
      "from": "main"
    },
    {
      "id": "main-voice-2",
      "to": "voice",
      "kind": "call",
      "label": "voice command",
      "source": [
        {
          "file": "waku/__main__.py",
          "line": 38,
          "symbol": "main"
        }
      ],
      "from": "main"
    },
    {
      "id": "main-telegram-3",
      "to": "telegram",
      "kind": "call",
      "label": "telegram command",
      "source": [
        {
          "file": "waku/__main__.py",
          "line": 38,
          "symbol": "main"
        }
      ],
      "from": "main"
    },
    {
      "id": "main-discord-4",
      "to": "discord",
      "kind": "call",
      "label": "discord command",
      "source": [
        {
          "file": "waku/__main__.py",
          "line": 38,
          "symbol": "main"
        }
      ],
      "from": "main"
    },
    {
      "id": "main-whatsapp-5",
      "to": "whatsapp",
      "kind": "call",
      "label": "whatsapp command",
      "source": [
        {
          "file": "waku/__main__.py",
          "line": 38,
          "symbol": "main"
        }
      ],
      "from": "main"
    },
    {
      "id": "main-brief-6",
      "to": "brief",
      "kind": "call",
      "label": "brief command",
      "source": [
        {
          "file": "waku/__main__.py",
          "line": 38,
          "symbol": "main"
        }
      ],
      "from": "main"
    },
    {
      "id": "main-gather-7",
      "to": "gather",
      "kind": "call",
      "label": "gather command",
      "source": [
        {
          "file": "waku/__main__.py",
          "line": 38,
          "symbol": "main"
        }
      ],
      "from": "main"
    },
    {
      "id": "cli-waku-8",
      "to": "waku",
      "kind": "call",
      "label": "construct",
      "source": [
        {
          "file": "waku/gateway/cli.py",
          "line": 55,
          "symbol": "main"
        }
      ],
      "from": "cli"
    },
    {
      "id": "cli-respond-9",
      "to": "respond",
      "kind": "call",
      "label": "input turn",
      "source": [
        {
          "file": "waku/gateway/cli.py",
          "line": 55,
          "symbol": "main"
        }
      ],
      "from": "cli"
    },
    {
      "id": "http-sse-10",
      "to": "sse",
      "kind": "call",
      "label": "chat stream route",
      "source": [
        {
          "file": "waku/ops/dashboard.py",
          "line": 906,
          "symbol": "Handler"
        }
      ],
      "from": "http"
    },
    {
      "id": "sse-chat-11",
      "to": "chat",
      "kind": "call",
      "label": "emit events",
      "source": [
        {
          "file": "waku/ops/dashboard.py",
          "line": 1017,
          "symbol": "do_POST"
        }
      ],
      "from": "sse"
    },
    {
      "id": "chat-commands-12",
      "to": "commands",
      "kind": "call",
      "label": "parse slash command",
      "source": [
        {
          "file": "waku/ops/dashboard.py",
          "line": 85,
          "symbol": "chat_stream"
        }
      ],
      "from": "chat"
    },
    {
      "id": "chat-singleton-13",
      "to": "singleton",
      "kind": "call",
      "label": "under agent_lock",
      "source": [
        {
          "file": "waku/ops/dashboard.py",
          "line": 85,
          "symbol": "chat_stream"
        }
      ],
      "from": "chat"
    },
    {
      "id": "chat-rotate-14",
      "to": "rotate",
      "kind": "call",
      "label": "idle check",
      "source": [
        {
          "file": "waku/ops/dashboard.py",
          "line": 85,
          "symbol": "chat_stream"
        }
      ],
      "from": "chat"
    },
    {
      "id": "chat-respond-15",
      "to": "respond",
      "kind": "call",
      "label": "streaming turn",
      "source": [
        {
          "file": "waku/ops/dashboard.py",
          "line": 85,
          "symbol": "chat_stream"
        }
      ],
      "from": "chat"
    },
    {
      "id": "telegram-runner-16",
      "to": "runner",
      "kind": "call",
      "label": "filtered input",
      "source": [
        {
          "file": "waku/gateway/telegram.py",
          "line": 52,
          "symbol": "_build_app"
        }
      ],
      "from": "telegram"
    },
    {
      "id": "discord-runner-17",
      "to": "runner",
      "kind": "call",
      "label": "admitted message",
      "source": [
        {
          "file": "waku/gateway/discord.py",
          "line": 137,
          "symbol": "_build_client"
        }
      ],
      "from": "discord"
    },
    {
      "id": "voice-ears-18",
      "to": "ears",
      "kind": "call",
      "label": "transcribe speech",
      "source": [
        {
          "file": "waku/gateway/voice.py",
          "line": 228,
          "symbol": "wake_loop"
        }
      ],
      "from": "voice"
    },
    {
      "id": "voice-respond-19",
      "to": "respond",
      "kind": "call",
      "label": "spoken input",
      "source": [
        {
          "file": "waku/gateway/voice.py",
          "line": 228,
          "symbol": "wake_loop"
        }
      ],
      "from": "voice"
    },
    {
      "id": "voice-mouth-20",
      "to": "mouth",
      "kind": "call",
      "label": "speak result",
      "source": [
        {
          "file": "waku/gateway/voice.py",
          "line": 228,
          "symbol": "wake_loop"
        }
      ],
      "from": "voice"
    },
    {
      "id": "runner-waku-21",
      "to": "waku",
      "kind": "call",
      "label": "lazy construction",
      "source": [
        {
          "file": "waku/gateway/runner.py",
          "line": 34,
          "symbol": "GatewayAgentRunner"
        }
      ],
      "from": "runner"
    },
    {
      "id": "runner-respond-22",
      "to": "respond",
      "kind": "call",
      "label": "serialized worker call",
      "source": [
        {
          "file": "waku/gateway/runner.py",
          "line": 34,
          "symbol": "GatewayAgentRunner"
        }
      ],
      "from": "runner"
    },
    {
      "id": "deliver-runner-23",
      "to": "runner",
      "kind": "call",
      "label": "run turn",
      "source": [
        {
          "file": "waku/gateway/runner.py",
          "line": 110,
          "symbol": "run_gateway_turn"
        }
      ],
      "from": "deliver"
    },
    {
      "id": "brief-respond-24",
      "to": "respond",
      "kind": "call",
      "label": "fixed briefing prompt",
      "source": [
        {
          "file": "waku/ops/brief.py",
          "line": 22,
          "symbol": "main"
        }
      ],
      "from": "brief"
    },
    {
      "id": "waku-settings-25",
      "to": "settings",
      "kind": "call",
      "label": "load if absent",
      "source": [
        {
          "file": "waku/app.py",
          "line": 20,
          "symbol": "__init__"
        }
      ],
      "from": "waku"
    },
    {
      "id": "settings-home-26",
      "to": "home",
      "kind": "call",
      "label": "resolve state root",
      "source": [
        {
          "file": "waku/config.py",
          "line": 239,
          "symbol": "load_settings"
        }
      ],
      "from": "settings"
    },
    {
      "id": "waku-db-27",
      "to": "db",
      "kind": "call",
      "label": "open if absent",
      "source": [
        {
          "file": "waku/app.py",
          "line": 20,
          "symbol": "__init__"
        }
      ],
      "from": "waku"
    },
    {
      "id": "waku-client-28",
      "to": "client",
      "kind": "call",
      "label": "build if absent",
      "source": [
        {
          "file": "waku/app.py",
          "line": 20,
          "symbol": "__init__"
        }
      ],
      "from": "waku"
    },
    {
      "id": "waku-memory-init-29",
      "to": "memory-init",
      "kind": "call",
      "label": "build memory first",
      "source": [
        {
          "file": "waku/app.py",
          "line": 20,
          "symbol": "__init__"
        }
      ],
      "from": "waku"
    },
    {
      "id": "waku-registry-build-30",
      "to": "registry-build",
      "kind": "call",
      "label": "register capabilities",
      "source": [
        {
          "file": "waku/app.py",
          "line": 20,
          "symbol": "__init__"
        }
      ],
      "from": "waku"
    },
    {
      "id": "waku-session-31",
      "to": "session",
      "kind": "call",
      "label": "construct",
      "source": [
        {
          "file": "waku/app.py",
          "line": 20,
          "symbol": "__init__"
        }
      ],
      "from": "waku"
    },
    {
      "id": "waku-tracer-32",
      "to": "tracer",
      "kind": "call",
      "label": "construct",
      "source": [
        {
          "file": "waku/app.py",
          "line": 20,
          "symbol": "__init__"
        }
      ],
      "from": "waku"
    },
    {
      "id": "registry-build-mcp-33",
      "to": "mcp",
      "kind": "call",
      "label": "optional server configuration",
      "source": [
        {
          "file": "waku/tools/__init__.py",
          "line": 14,
          "symbol": "build_registry"
        }
      ],
      "from": "registry-build",
      "condition": "home/mcp.json exists; optional MCP extra import succeeds"
    },
    {
      "id": "memory-init-fact-select-34",
      "to": "fact-select",
      "kind": "call",
      "label": "select fact backend",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 59,
          "symbol": "__init__"
        }
      ],
      "from": "memory-init"
    },
    {
      "id": "fact-select-facts-35",
      "to": "facts",
      "kind": "data",
      "label": "default SQLite",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 75,
          "symbol": "_make_fact_store"
        }
      ],
      "from": "fact-select"
    },
    {
      "id": "fact-select-remote-facts-36",
      "to": "remote-facts",
      "kind": "call",
      "label": "configured optional backend",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 75,
          "symbol": "_make_fact_store"
        }
      ],
      "from": "fact-select"
    },
    {
      "id": "memory-init-episodes-37",
      "to": "episodes",
      "kind": "call",
      "label": "default episodes",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 99,
          "symbol": "_make_episode_store"
        }
      ],
      "from": "memory-init",
      "condition": "episodic_store=sqlite/default"
    },
    {
      "id": "memory-init-notion-38",
      "to": "notion",
      "kind": "call",
      "label": "episodic_store=notion",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 99,
          "symbol": "_make_episode_store"
        }
      ],
      "from": "memory-init",
      "condition": "episodic_store=notion"
    },
    {
      "id": "memory-init-skills-39",
      "to": "skills",
      "kind": "call",
      "label": "construct SkillLoader and refresh files",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 69,
          "symbol": "self.skills = SkillLoader"
        }
      ],
      "from": "memory-init"
    },
    {
      "id": "singleton-resume-40",
      "to": "resume",
      "kind": "call",
      "label": "choose recent identifier",
      "source": [
        {
          "file": "waku/ops/browser_agent.py",
          "line": 83,
          "symbol": "get_agent"
        }
      ],
      "from": "singleton"
    },
    {
      "id": "singleton-waku-41",
      "to": "waku",
      "kind": "call",
      "label": "construct singleton",
      "source": [
        {
          "file": "waku/ops/browser_agent.py",
          "line": 83,
          "symbol": "get_agent"
        }
      ],
      "from": "singleton"
    },
    {
      "id": "resume-chat-log-42",
      "to": "chat-log",
      "kind": "data",
      "label": "read recent thread",
      "source": [
        {
          "file": "waku/ops/browser_agent.py",
          "line": 58,
          "symbol": "resume_or_new_session"
        }
      ],
      "from": "resume"
    },
    {
      "id": "rotate-session-43",
      "to": "session",
      "kind": "call",
      "label": "start_new clears history",
      "source": [
        {
          "file": "waku/ops/browser_agent.py",
          "line": 100,
          "symbol": "maybe_rotate_session"
        }
      ],
      "from": "rotate"
    },
    {
      "id": "session-action-switch-44",
      "to": "switch",
      "kind": "call",
      "label": "selected conversation",
      "source": [
        {
          "file": "waku/ops/dashboard.py",
          "line": 745,
          "symbol": "session_action"
        }
      ],
      "from": "session-action"
    },
    {
      "id": "switch-chat-log-45",
      "to": "chat-log",
      "kind": "data",
      "label": "read thread tail",
      "source": [
        {
          "file": "waku/runtime/session.py",
          "line": 118,
          "symbol": "switch"
        }
      ],
      "from": "switch"
    },
    {
      "id": "rebuild-waku-46",
      "to": "waku",
      "kind": "call",
      "label": "build fresh instance",
      "source": [
        {
          "file": "waku/ops/browser_agent.py",
          "line": 128,
          "symbol": "rebuild"
        }
      ],
      "from": "rebuild"
    },
    {
      "id": "rebuild-close-47",
      "to": "close",
      "kind": "call",
      "label": "close replaced MCP resources",
      "source": [
        {
          "file": "waku/ops/browser_agent.py",
          "line": 128,
          "symbol": "rebuild"
        }
      ],
      "from": "rebuild"
    },
    {
      "id": "respond-observe-48",
      "to": "observe",
      "kind": "call",
      "label": "compose event observers",
      "source": [
        {
          "file": "waku/app.py",
          "line": 46,
          "symbol": "respond"
        }
      ],
      "from": "respond"
    },
    {
      "id": "respond-tracer-49",
      "to": "tracer",
      "kind": "call",
      "label": "turn context",
      "source": [
        {
          "file": "waku/app.py",
          "line": 46,
          "symbol": "respond"
        }
      ],
      "from": "respond"
    },
    {
      "id": "respond-graph-enabled-50",
      "to": "graph-enabled",
      "kind": "transition",
      "label": "check flag",
      "source": [
        {
          "file": "waku/app.py",
          "line": 46,
          "symbol": "respond"
        }
      ],
      "from": "respond"
    },
    {
      "id": "graph-enabled-triage-51",
      "to": "triage",
      "kind": "transition",
      "label": "enabled",
      "source": [
        {
          "file": "waku/app.py",
          "line": 142,
          "symbol": "_respond_via_graph"
        }
      ],
      "condition": "enabled",
      "from": "graph-enabled"
    },
    {
      "id": "graph-enabled-full-52",
      "to": "full",
      "kind": "transition",
      "label": "disabled",
      "source": [
        {
          "file": "waku/app.py",
          "line": 46,
          "symbol": "respond"
        }
      ],
      "condition": "disabled",
      "from": "graph-enabled"
    },
    {
      "id": "respond-fallback-53",
      "to": "fallback",
      "kind": "transition",
      "label": "exception or no graph answer",
      "source": [
        {
          "file": "waku/app.py",
          "line": 46,
          "symbol": "respond"
        }
      ],
      "from": "respond"
    },
    {
      "id": "fallback-full-54",
      "to": "full",
      "kind": "transition",
      "label": "run classic turn",
      "source": [
        {
          "file": "waku/app.py",
          "line": 46,
          "symbol": "respond"
        }
      ],
      "from": "fallback"
    },
    {
      "id": "full-build-system-55",
      "to": "build-system",
      "kind": "call",
      "label": "assemble prompt",
      "source": [
        {
          "file": "waku/app.py",
          "line": 118,
          "symbol": "_run_full_turn"
        }
      ],
      "from": "full"
    },
    {
      "id": "full-history-window-56",
      "to": "history-window",
      "kind": "transition",
      "label": "select transcript tail",
      "source": [
        {
          "file": "waku/app.py",
          "line": 118,
          "symbol": "_run_full_turn"
        }
      ],
      "from": "full"
    },
    {
      "id": "full-loop-57",
      "to": "loop",
      "kind": "call",
      "label": "run configured loop",
      "source": [
        {
          "file": "waku/app.py",
          "line": 118,
          "symbol": "_run_full_turn"
        }
      ],
      "from": "full"
    },
    {
      "id": "build-system-soul-58",
      "to": "soul",
      "kind": "data",
      "label": "read persona",
      "source": [
        {
          "file": "waku/runtime/session.py",
          "line": 64,
          "symbol": "build_system"
        }
      ],
      "from": "build-system"
    },
    {
      "id": "build-system-clock-59",
      "to": "clock",
      "kind": "transition",
      "label": "add clock/identity",
      "source": [
        {
          "file": "waku/runtime/session.py",
          "line": 64,
          "symbol": "build_system"
        }
      ],
      "from": "build-system"
    },
    {
      "id": "build-system-gated-retrieve-60",
      "to": "gated-retrieve",
      "kind": "call",
      "label": "request relevant memory",
      "source": [
        {
          "file": "waku/runtime/session.py",
          "line": 64,
          "symbol": "build_system"
        }
      ],
      "from": "build-system"
    },
    {
      "id": "build-system-skills-61",
      "to": "skills",
      "kind": "call",
      "label": "match procedural instructions",
      "source": [
        {
          "file": "waku/runtime/session.py",
          "line": 64,
          "symbol": "build_system"
        }
      ],
      "from": "build-system"
    },
    {
      "id": "gated-retrieve-retrieval-gate-62",
      "to": "retrieval-gate",
      "kind": "call",
      "label": "judge relevance",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 107,
          "symbol": "gated_retrieve"
        }
      ],
      "from": "gated-retrieve"
    },
    {
      "id": "gated-retrieve-facts-63",
      "to": "facts",
      "kind": "data",
      "label": "search query if retrieve",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 107,
          "symbol": "gated_retrieve"
        }
      ],
      "from": "gated-retrieve",
      "condition": "Retrieval gate chooses retrieve; corresponding configured backend is active"
    },
    {
      "id": "gated-retrieve-remote-facts-64",
      "to": "remote-facts",
      "kind": "call",
      "label": "configured FactStore search",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 107,
          "symbol": "gated_retrieve"
        }
      ],
      "from": "gated-retrieve",
      "condition": "Retrieval gate chooses retrieve; corresponding configured backend is active"
    },
    {
      "id": "gated-retrieve-slot-65",
      "to": "slot",
      "kind": "call",
      "label": "filter retrieved facts",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 107,
          "symbol": "gated_retrieve"
        }
      ],
      "from": "gated-retrieve",
      "condition": "Retrieval gate chooses retrieve; corresponding configured backend is active"
    },
    {
      "id": "gated-retrieve-episodes-66",
      "to": "episodes",
      "kind": "data",
      "label": "search top3 episodes",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 107,
          "symbol": "gated_retrieve"
        }
      ],
      "from": "gated-retrieve",
      "condition": "Retrieval gate chooses retrieve; corresponding configured backend is active"
    },
    {
      "id": "gated-retrieve-notion-67",
      "to": "notion",
      "kind": "call",
      "label": "configured episode search",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 107,
          "symbol": "gated_retrieve"
        }
      ],
      "from": "gated-retrieve",
      "condition": "Retrieval gate chooses retrieve; corresponding configured backend is active"
    },
    {
      "id": "loop-stream-choice-68",
      "to": "stream-choice",
      "kind": "transition",
      "label": "determine stream capability at loop entry",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 79,
          "symbol": "can_stream = stream and hasattr"
        }
      ],
      "from": "loop"
    },
    {
      "id": "stream-choice-stream-69",
      "to": "stream",
      "kind": "transition",
      "label": "stream requested/capable",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "from": "stream-choice"
    },
    {
      "id": "stream-choice-create-70",
      "to": "create",
      "kind": "transition",
      "label": "otherwise",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "from": "stream-choice"
    },
    {
      "id": "stream-create-71",
      "to": "create",
      "kind": "transition",
      "label": "non-4xx streaming failure",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "condition": "non-4xx streaming failure",
      "from": "stream"
    },
    {
      "id": "stream-response-72",
      "to": "response",
      "kind": "transition",
      "label": "final stream message",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "from": "stream"
    },
    {
      "id": "create-response-73",
      "to": "response",
      "kind": "transition",
      "label": "provider message",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "from": "create"
    },
    {
      "id": "response-tool-decision-74",
      "to": "tool-decision",
      "kind": "transition",
      "label": "inspect tool_use blocks",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "from": "response"
    },
    {
      "id": "tool-decision-reply-75",
      "to": "reply",
      "kind": "transition",
      "label": "no tool calls",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "condition": "no tool calls",
      "from": "tool-decision"
    },
    {
      "id": "tool-decision-execute-76",
      "to": "execute",
      "kind": "transition",
      "label": "tool calls present",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "condition": "tool calls present",
      "from": "tool-decision"
    },
    {
      "id": "execute-tool-results-77",
      "to": "tool-results",
      "kind": "transition",
      "label": "output/error as text",
      "source": [
        {
          "file": "waku/tools/registry.py",
          "line": 47,
          "symbol": "execute"
        }
      ],
      "from": "execute",
      "condition": "Requested tool name is registered; optional registration must have occurred"
    },
    {
      "id": "tool-results-loop-78",
      "to": "loop",
      "kind": "transition",
      "label": "append results; next iteration",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "from": "tool-results"
    },
    {
      "id": "loop-limit-79",
      "to": "limit",
      "kind": "transition",
      "label": "iteration cap exhausted",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "from": "loop"
    },
    {
      "id": "limit-reply-80",
      "to": "reply",
      "kind": "transition",
      "label": "unfinished reply",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "from": "limit"
    },
    {
      "id": "create-schemas-81",
      "to": "schemas",
      "kind": "call",
      "label": "current registered schemas",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "from": "create"
    },
    {
      "id": "stream-schemas-82",
      "to": "schemas",
      "kind": "call",
      "label": "current registered schemas",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "from": "stream"
    },
    {
      "id": "client-providers-83",
      "to": "providers",
      "kind": "data",
      "label": "lookup already-loaded provider row",
      "source": [
        {
          "file": "waku/loop/models.py",
          "line": 282,
          "symbol": "provider = PROVIDERS.get(settings.provider)"
        }
      ],
      "from": "client"
    },
    {
      "id": "client-compat-84",
      "to": "compat",
      "kind": "call",
      "label": "OpenAI wire provider",
      "source": [
        {
          "file": "waku/loop/models.py",
          "line": 279,
          "symbol": "get_client"
        }
      ],
      "from": "client",
      "condition": "Provider.kind is not anthropic"
    },
    {
      "id": "client-model-api-85",
      "to": "model-api",
      "kind": "data",
      "label": "configure Anthropic endpoint/client",
      "source": [
        {
          "file": "waku/loop/models.py",
          "line": 332,
          "symbol": "return anthropic.Anthropic(**kwargs)"
        }
      ],
      "from": "client",
      "condition": "Provider.kind is anthropic"
    },
    {
      "id": "compat-convert-86",
      "to": "convert",
      "kind": "call",
      "label": "convert request",
      "source": [
        {
          "file": "waku/loop/models.py",
          "line": 336,
          "symbol": "OpenAICompatClient"
        }
      ],
      "from": "compat"
    },
    {
      "id": "compat-compat-call-87",
      "to": "compat-call",
      "kind": "call",
      "label": "send create/stream",
      "source": [
        {
          "file": "waku/loop/models.py",
          "line": 336,
          "symbol": "OpenAICompatClient"
        }
      ],
      "from": "compat"
    },
    {
      "id": "compat-call-model-api-88",
      "to": "model-api",
      "kind": "call",
      "label": "Chat Completions endpoint",
      "source": [
        {
          "file": "waku/loop/models.py",
          "line": 394,
          "symbol": "_call"
        }
      ],
      "from": "compat-call"
    },
    {
      "id": "execute-calendar-89",
      "to": "calendar",
      "kind": "call",
      "label": "create_event",
      "source": [
        {
          "file": "waku/tools/registry.py",
          "line": 47,
          "symbol": "execute"
        }
      ],
      "from": "execute",
      "condition": "Requested tool name is registered; optional registration must have occurred"
    },
    {
      "id": "execute-calendar-read-90",
      "to": "calendar-read",
      "kind": "call",
      "label": "list_events",
      "source": [
        {
          "file": "waku/tools/registry.py",
          "line": 47,
          "symbol": "execute"
        }
      ],
      "from": "execute",
      "condition": "Requested tool name is registered; optional registration must have occurred"
    },
    {
      "id": "execute-note-91",
      "to": "note",
      "kind": "call",
      "label": "save_note",
      "source": [
        {
          "file": "waku/tools/registry.py",
          "line": 47,
          "symbol": "execute"
        }
      ],
      "from": "execute",
      "condition": "Requested tool name is registered; optional registration must have occurred"
    },
    {
      "id": "execute-message-92",
      "to": "message",
      "kind": "call",
      "label": "send_message",
      "source": [
        {
          "file": "waku/tools/registry.py",
          "line": 47,
          "symbol": "execute"
        }
      ],
      "from": "execute",
      "condition": "Requested tool name is registered; optional registration must have occurred"
    },
    {
      "id": "execute-search-93",
      "to": "search",
      "kind": "call",
      "label": "search_web",
      "source": [
        {
          "file": "waku/tools/registry.py",
          "line": 47,
          "symbol": "execute"
        }
      ],
      "from": "execute",
      "condition": "Requested tool name is registered; optional registration must have occurred"
    },
    {
      "id": "execute-manage-94",
      "to": "manage",
      "kind": "call",
      "label": "manage_memory",
      "source": [
        {
          "file": "waku/tools/registry.py",
          "line": 47,
          "symbol": "execute"
        }
      ],
      "from": "execute",
      "condition": "Requested tool name is registered; optional registration must have occurred"
    },
    {
      "id": "execute-update-soul-95",
      "to": "update-soul",
      "kind": "call",
      "label": "update_soul",
      "source": [
        {
          "file": "waku/tools/registry.py",
          "line": 47,
          "symbol": "execute"
        }
      ],
      "from": "execute",
      "condition": "Requested tool name is registered; optional registration must have occurred"
    },
    {
      "id": "execute-create-skill-96",
      "to": "create-skill",
      "kind": "call",
      "label": "create_skill",
      "source": [
        {
          "file": "waku/tools/registry.py",
          "line": 47,
          "symbol": "execute"
        }
      ],
      "from": "execute",
      "condition": "Requested tool name is registered; optional registration must have occurred"
    },
    {
      "id": "execute-apple-97",
      "to": "apple",
      "kind": "call",
      "label": "opt-in Apple tools",
      "source": [
        {
          "file": "waku/tools/registry.py",
          "line": 47,
          "symbol": "execute"
        }
      ],
      "from": "execute",
      "condition": "Requested tool name is registered; optional registration must have occurred"
    },
    {
      "id": "execute-github-98",
      "to": "github",
      "kind": "call",
      "label": "opt-in github tool",
      "source": [
        {
          "file": "waku/tools/registry.py",
          "line": 47,
          "symbol": "execute"
        }
      ],
      "from": "execute",
      "condition": "Requested tool name is registered; optional registration must have occurred"
    },
    {
      "id": "execute-delegate-99",
      "to": "delegate",
      "kind": "call",
      "label": "experimental delegate_task",
      "source": [
        {
          "file": "waku/tools/registry.py",
          "line": 47,
          "symbol": "execute"
        }
      ],
      "from": "execute",
      "condition": "Requested tool name is registered; optional registration must have occurred"
    },
    {
      "id": "execute-stubs-100",
      "to": "stubs",
      "kind": "call",
      "label": "experimental skeleton tools",
      "source": [
        {
          "file": "waku/tools/registry.py",
          "line": 47,
          "symbol": "execute"
        }
      ],
      "from": "execute",
      "condition": "Requested tool name is registered; optional registration must have occurred"
    },
    {
      "id": "execute-mcp-call-101",
      "to": "mcp-call",
      "kind": "call",
      "label": "namespaced MCP tool",
      "source": [
        {
          "file": "waku/tools/registry.py",
          "line": 47,
          "symbol": "execute"
        }
      ],
      "from": "execute",
      "condition": "Requested tool name is registered; optional registration must have occurred"
    },
    {
      "id": "calendar-ics-102",
      "to": "ics",
      "kind": "data",
      "label": "commit table; write ICS",
      "source": [
        {
          "file": "waku/tools/calendar.py",
          "line": 410,
          "symbol": "create_event"
        }
      ],
      "from": "calendar"
    },
    {
      "id": "calendar-google-103",
      "to": "google",
      "kind": "call",
      "label": "optional mirror",
      "source": [
        {
          "file": "waku/tools/calendar.py",
          "line": 410,
          "symbol": "create_event"
        }
      ],
      "from": "calendar",
      "condition": "google_calendar enabled; local commit and ICS write already succeeded"
    },
    {
      "id": "calendar-read-ics-104",
      "to": "ics",
      "kind": "data",
      "label": "read local events",
      "source": [
        {
          "file": "waku/tools/calendar.py",
          "line": 531,
          "symbol": "list_events"
        }
      ],
      "from": "calendar-read"
    },
    {
      "id": "note-facts-105",
      "to": "facts",
      "kind": "data",
      "label": "insert note fact",
      "source": [
        {
          "file": "waku/tools/notes.py",
          "line": 15,
          "symbol": "make_tool"
        }
      ],
      "from": "note"
    },
    {
      "id": "manage-facts-106",
      "to": "facts",
      "kind": "data",
      "label": "fact operations",
      "source": [
        {
          "file": "waku/tools/memory_admin.py",
          "line": 29,
          "symbol": "manage_memory"
        }
      ],
      "from": "manage"
    },
    {
      "id": "manage-episodes-107",
      "to": "episodes",
      "kind": "data",
      "label": "episode operations",
      "source": [
        {
          "file": "waku/tools/memory_admin.py",
          "line": 29,
          "symbol": "manage_memory"
        }
      ],
      "from": "manage"
    },
    {
      "id": "update-soul-soul-108",
      "to": "soul",
      "kind": "data",
      "label": "persist rule",
      "source": [
        {
          "file": "waku/tools/memory_admin.py",
          "line": 88,
          "symbol": "update_soul"
        }
      ],
      "from": "update-soul"
    },
    {
      "id": "create-skill-skills-109",
      "to": "skills",
      "kind": "call",
      "label": "write skill; reload",
      "source": [
        {
          "file": "waku/tools/memory_admin.py",
          "line": 119,
          "symbol": "create_skill"
        }
      ],
      "from": "create-skill"
    },
    {
      "id": "mcp-transport-110",
      "to": "transport",
      "kind": "call",
      "label": "open configured transports",
      "source": [
        {
          "file": "waku/tools/mcp_client.py",
          "line": 234,
          "symbol": "read, write = await self._open_streams(spec)"
        }
      ],
      "from": "mcp",
      "condition": "Configured server being connected through _connect_one"
    },
    {
      "id": "mcp-schemas-111",
      "to": "schemas",
      "kind": "data",
      "label": "discovered tools registered as schemas",
      "source": [
        {
          "file": "waku/tools/__init__.py",
          "line": 14,
          "symbol": "build_registry"
        }
      ],
      "from": "mcp"
    },
    {
      "id": "mcp-call-transport-112",
      "to": "transport",
      "kind": "data",
      "label": "use existing connected session transport",
      "source": [
        {
          "file": "waku/tools/mcp_client.py",
          "line": 304,
          "symbol": "result = await session.call_tool(tool, args)"
        }
      ],
      "from": "mcp-call"
    },
    {
      "id": "waku-remember-113",
      "to": "remember",
      "kind": "call",
      "label": "wire consolidation sender",
      "source": [
        {
          "file": "waku/app.py",
          "line": 20,
          "symbol": "__init__"
        }
      ],
      "from": "waku"
    },
    {
      "id": "delegate-pi-114",
      "to": "pi",
      "kind": "call",
      "label": "launch specialist",
      "source": [
        {
          "file": "waku/tools/experimental.py",
          "line": 194,
          "symbol": "delegate_task"
        }
      ],
      "from": "delegate"
    },
    {
      "id": "delegate-workspace-115",
      "to": "workspace",
      "kind": "call",
      "label": "scratch completion artifacts",
      "source": [
        {
          "file": "waku/tools/experimental.py",
          "line": 194,
          "symbol": "delegate_task"
        }
      ],
      "from": "delegate"
    },
    {
      "id": "respond-exchange-116",
      "to": "exchange",
      "kind": "call",
      "label": "record completed result",
      "source": [
        {
          "file": "waku/app.py",
          "line": 46,
          "symbol": "respond"
        }
      ],
      "from": "respond"
    },
    {
      "id": "exchange-chat-log-117",
      "to": "chat-log",
      "kind": "data",
      "label": "commit two rows",
      "source": [
        {
          "file": "waku/runtime/session.py",
          "line": 91,
          "symbol": "add_exchange"
        }
      ],
      "from": "exchange"
    },
    {
      "id": "respond-due-118",
      "to": "due",
      "kind": "call",
      "label": "maybe_consolidate synchronously",
      "source": [
        {
          "file": "waku/app.py",
          "line": 46,
          "symbol": "respond"
        }
      ],
      "from": "respond",
      "condition": "Completed result persisted; maybe_consolidate invokes due check synchronously"
    },
    {
      "id": "due-chat-log-119",
      "to": "chat-log",
      "kind": "data",
      "label": "read unconsolidated rows",
      "source": [
        {
          "file": "waku/memory/consolidation.py",
          "line": 86,
          "symbol": "kept_if_due"
        }
      ],
      "from": "due"
    },
    {
      "id": "due-summarize-120",
      "to": "summarize",
      "kind": "transition",
      "label": "threshold met",
      "source": [
        {
          "file": "waku/memory/consolidation.py",
          "line": 86,
          "symbol": "kept_if_due"
        }
      ],
      "condition": "threshold met",
      "from": "due"
    },
    {
      "id": "summarize-keep-121",
      "to": "keep",
      "kind": "transition",
      "label": "filter proposed facts",
      "source": [
        {
          "file": "waku/memory/consolidation.py",
          "line": 86,
          "symbol": "kept_if_due"
        }
      ],
      "from": "summarize"
    },
    {
      "id": "summarize-commit-memory-122",
      "to": "commit-memory",
      "kind": "transition",
      "label": "keep/episode updates",
      "source": [
        {
          "file": "waku/memory/consolidation.py",
          "line": 86,
          "symbol": "kept_if_due"
        }
      ],
      "from": "summarize"
    },
    {
      "id": "commit-memory-facts-123",
      "to": "facts",
      "kind": "data",
      "label": "write facts",
      "source": [
        {
          "file": "waku/memory/consolidation.py",
          "line": 86,
          "symbol": "kept_if_due"
        }
      ],
      "from": "commit-memory"
    },
    {
      "id": "commit-memory-episodes-124",
      "to": "episodes",
      "kind": "data",
      "label": "write episode",
      "source": [
        {
          "file": "waku/memory/consolidation.py",
          "line": 86,
          "symbol": "kept_if_due"
        }
      ],
      "from": "commit-memory"
    },
    {
      "id": "commit-memory-chat-log-125",
      "to": "chat-log",
      "kind": "data",
      "label": "mark selected rows consolidated",
      "source": [
        {
          "file": "waku/memory/consolidation.py",
          "line": 86,
          "symbol": "kept_if_due"
        }
      ],
      "from": "commit-memory"
    },
    {
      "id": "commit-memory-sync-126",
      "to": "sync",
      "kind": "transition",
      "label": "send kept facts; pending tracking",
      "source": [
        {
          "file": "waku/memory/consolidation.py",
          "line": 86,
          "symbol": "kept_if_due"
        }
      ],
      "from": "commit-memory"
    },
    {
      "id": "sync-remember-127",
      "to": "remember",
      "kind": "call",
      "label": "remote memory.remember",
      "source": [
        {
          "file": "waku/memory/consolidation.py",
          "line": 86,
          "symbol": "kept_if_due"
        }
      ],
      "from": "sync"
    },
    {
      "id": "respond-mirror-128",
      "to": "mirror",
      "kind": "data",
      "label": "export after consolidation",
      "source": [
        {
          "file": "waku/app.py",
          "line": 46,
          "symbol": "respond"
        }
      ],
      "from": "respond"
    },
    {
      "id": "mirror-facts-129",
      "to": "facts",
      "kind": "data",
      "label": "read local rows",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 188,
          "symbol": "export_markdown"
        }
      ],
      "from": "mirror"
    },
    {
      "id": "mirror-episodes-130",
      "to": "episodes",
      "kind": "data",
      "label": "read local rows",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 188,
          "symbol": "export_markdown"
        }
      ],
      "from": "mirror"
    },
    {
      "id": "triage-graph-engine-131",
      "to": "graph-engine",
      "kind": "call",
      "label": "execute graph",
      "source": [
        {
          "file": "waku/app.py",
          "line": 142,
          "symbol": "_respond_via_graph"
        }
      ],
      "from": "triage"
    },
    {
      "id": "triage-classify-132",
      "to": "classify",
      "kind": "transition",
      "label": "START branch",
      "source": [
        {
          "file": "waku/graph/workflows/triage.py",
          "line": 108,
          "symbol": "build_triage_graph topology"
        }
      ],
      "from": "triage",
      "condition": "graph_workflows enabled; dependency wave ready"
    },
    {
      "id": "triage-check-calendar-133",
      "to": "check-calendar",
      "kind": "transition",
      "label": "parallel START branch",
      "source": [
        {
          "file": "waku/graph/workflows/triage.py",
          "line": 108,
          "symbol": "build_triage_graph topology"
        }
      ],
      "from": "triage",
      "condition": "graph_workflows enabled; dependency wave ready"
    },
    {
      "id": "classify-join-134",
      "to": "join",
      "kind": "transition",
      "label": "classification dependency",
      "source": [
        {
          "file": "waku/graph/workflows/triage.py",
          "line": 108,
          "symbol": "build_triage_graph topology"
        }
      ],
      "from": "classify",
      "condition": "graph_workflows enabled; dependency wave ready"
    },
    {
      "id": "check-calendar-join-135",
      "to": "join",
      "kind": "transition",
      "label": "calendar dependency",
      "source": [
        {
          "file": "waku/graph/workflows/triage.py",
          "line": 108,
          "symbol": "build_triage_graph topology"
        }
      ],
      "from": "check-calendar",
      "condition": "graph_workflows enabled; dependency wave ready"
    },
    {
      "id": "join-quick-136",
      "to": "quick",
      "kind": "transition",
      "label": "route=quick",
      "source": [
        {
          "file": "waku/graph/workflows/triage.py",
          "line": 89,
          "symbol": "build_triage_graph"
        }
      ],
      "condition": "route=quick",
      "from": "join"
    },
    {
      "id": "join-full-137",
      "to": "full",
      "kind": "transition",
      "label": "route=full",
      "source": [
        {
          "file": "waku/graph/workflows/triage.py",
          "line": 89,
          "symbol": "build_triage_graph"
        }
      ],
      "condition": "route=full",
      "from": "join"
    },
    {
      "id": "quick-reply-138",
      "to": "reply",
      "kind": "transition",
      "label": "outer graph caller wraps quick text in LoopResult",
      "source": [
        {
          "file": "waku/app.py",
          "line": 175,
          "symbol": "LoopResult"
        }
      ],
      "from": "quick"
    },
    {
      "id": "commands-gather-139",
      "to": "gather",
      "kind": "call",
      "label": "known gather workflow",
      "source": [
        {
          "file": "waku/ops/commands.py",
          "line": 98,
          "symbol": "run"
        }
      ],
      "from": "commands",
      "condition": "Known command gather with available binder"
    },
    {
      "id": "gather-graph-engine-140",
      "to": "graph-engine",
      "kind": "call",
      "label": "bound gather runner executes declared topology",
      "source": [
        {
          "file": "waku/ops/gather.py",
          "line": 159,
          "symbol": "run_graph"
        }
      ],
      "from": "gather"
    },
    {
      "id": "gather-scans-141",
      "to": "scans",
      "kind": "transition",
      "label": "START fan-out",
      "source": [
        {
          "file": "waku/graph/workflows/gather.py",
          "line": 137,
          "symbol": "build_gather_graph topology"
        }
      ],
      "from": "gather",
      "condition": "Four independent START branches share wave"
    },
    {
      "id": "scans-synthesis-142",
      "to": "synthesis",
      "kind": "transition",
      "label": "all four dependencies complete",
      "source": [
        {
          "file": "waku/graph/workflows/gather.py",
          "line": 137,
          "symbol": "build_gather_graph topology"
        }
      ],
      "from": "scans",
      "condition": "Explicit gather run; synthesis waits all four dependency outputs"
    },
    {
      "id": "synthesis-action-143",
      "to": "action",
      "kind": "call",
      "label": "counts router",
      "source": [
        {
          "file": "waku/graph/workflows/gather.py",
          "line": 111,
          "symbol": "build_gather_graph"
        }
      ],
      "from": "synthesis"
    },
    {
      "id": "action-draft-144",
      "to": "draft",
      "kind": "transition",
      "label": "propose",
      "source": [
        {
          "file": "waku/graph/workflows/gather.py",
          "line": 111,
          "symbol": "build_gather_graph"
        }
      ],
      "condition": "propose",
      "from": "action"
    },
    {
      "id": "tracer-trace-files-145",
      "to": "trace-files",
      "kind": "data",
      "label": "append events",
      "source": [
        {
          "file": "waku/ops/tracing.py",
          "line": 57,
          "symbol": "Tracer"
        }
      ],
      "from": "tracer"
    },
    {
      "id": "tracer-usage-146",
      "to": "usage",
      "kind": "data",
      "label": "loop usage events",
      "source": [
        {
          "file": "waku/ops/tracing.py",
          "line": 57,
          "symbol": "Tracer"
        }
      ],
      "from": "tracer"
    },
    {
      "id": "tracer-otel-147",
      "to": "otel",
      "kind": "call",
      "label": "configured export",
      "source": [
        {
          "file": "waku/ops/tracing.py",
          "line": 57,
          "symbol": "Tracer"
        }
      ],
      "from": "tracer"
    },
    {
      "id": "collect-trace-files-148",
      "to": "trace-files",
      "kind": "data",
      "label": "read evidence",
      "source": [
        {
          "file": "waku/ops/dashboard.py",
          "line": 280,
          "symbol": "collect"
        }
      ],
      "from": "collect"
    },
    {
      "id": "collect-db-149",
      "to": "db",
      "kind": "data",
      "label": "read tables",
      "source": [
        {
          "file": "waku/ops/dashboard.py",
          "line": 280,
          "symbol": "collect"
        }
      ],
      "from": "collect"
    },
    {
      "id": "collect-usage-150",
      "to": "usage",
      "kind": "data",
      "label": "read spend",
      "source": [
        {
          "file": "waku/ops/dashboard.py",
          "line": 280,
          "symbol": "collect"
        }
      ],
      "from": "collect"
    },
    {
      "id": "setting-api-rebuild-151",
      "to": "rebuild",
      "kind": "call",
      "label": "rebuild after integration configuration",
      "source": [
        {
          "file": "waku/integrations.py",
          "line": 697,
          "symbol": "if error := browser_agent.rebuild():"
        }
      ],
      "from": "integration",
      "condition": "Successful integration change with ReloadMode.AGENT"
    },
    {
      "id": "host-gateway-identity-152",
      "to": "identity",
      "kind": "call",
      "label": "verify identity",
      "source": [
        {
          "file": "hosted/gateway/app.py",
          "line": 200,
          "symbol": "Gateway"
        }
      ],
      "from": "host-gateway"
    },
    {
      "id": "host-gateway-launcher-153",
      "to": "launcher",
      "kind": "call",
      "label": "ensure tenant",
      "source": [
        {
          "file": "hosted/gateway/app.py",
          "line": 200,
          "symbol": "Gateway"
        }
      ],
      "from": "host-gateway"
    },
    {
      "id": "host-gateway-forward-154",
      "to": "forward",
      "kind": "call",
      "label": "route approved request",
      "source": [
        {
          "file": "hosted/gateway/app.py",
          "line": 200,
          "symbol": "Gateway"
        }
      ],
      "from": "host-gateway"
    },
    {
      "id": "forward-tenant-155",
      "to": "tenant",
      "kind": "call",
      "label": "dashboard request",
      "source": [
        {
          "file": "hosted/gateway/forward.py",
          "line": 168,
          "symbol": "ContainerForwarder"
        }
      ],
      "from": "forward"
    },
    {
      "id": "meter-admit-156",
      "to": "admit",
      "kind": "call",
      "label": "validate payload",
      "source": [
        {
          "file": "hosted/proxy/app.py",
          "line": 113,
          "symbol": "MeteringProxy"
        }
      ],
      "from": "meter"
    },
    {
      "id": "meter-ledger-157",
      "to": "ledger",
      "kind": "data",
      "label": "authorize/meter spend",
      "source": [
        {
          "file": "hosted/proxy/app.py",
          "line": 113,
          "symbol": "MeteringProxy"
        }
      ],
      "from": "meter"
    },
    {
      "id": "meter-upstream-158",
      "to": "upstream",
      "kind": "call",
      "label": "platform API relay",
      "source": [
        {
          "file": "hosted/proxy/app.py",
          "line": 113,
          "symbol": "MeteringProxy"
        }
      ],
      "from": "meter"
    },
    {
      "id": "supervisor-telegram-159",
      "to": "telegram",
      "kind": "call",
      "label": "start/stop configured handle",
      "source": [
        {
          "file": "waku/gateway/supervisor.py",
          "line": 79,
          "symbol": "handle = self._starters[key]()"
        }
      ],
      "from": "supervisor",
      "condition": "Configured gateway and new/changed fingerprint"
    },
    {
      "id": "supervisor-discord-160",
      "to": "discord",
      "kind": "call",
      "label": "start/stop configured handle",
      "source": [
        {
          "file": "waku/gateway/supervisor.py",
          "line": 79,
          "symbol": "handle = self._starters[key]()"
        }
      ],
      "from": "supervisor",
      "condition": "Configured gateway and new/changed fingerprint"
    },
    {
      "id": "supervisor-whatsapp-161",
      "to": "whatsapp",
      "kind": "call",
      "label": "start/stop configured handle",
      "source": [
        {
          "file": "waku/gateway/supervisor.py",
          "line": 79,
          "symbol": "handle = self._starters[key]()"
        }
      ],
      "from": "supervisor",
      "condition": "Configured gateway and new/changed fingerprint"
    },
    {
      "id": "launcher-docker-162",
      "to": "docker",
      "kind": "call",
      "label": "collapsed SpawnerClient→spawner→DockerRuntime seam",
      "source": [
        {
          "file": "hosted/gateway/launch.py",
          "line": 59,
          "symbol": "Launcher"
        }
      ],
      "from": "launcher",
      "condition": "Hosted deployment spawner implementation selected"
    },
    {
      "id": "tenant-meter-163",
      "to": "meter",
      "kind": "data",
      "label": "configured platform provider",
      "source": [
        {
          "file": "waku/loop/models.py",
          "line": 279,
          "symbol": "get_client"
        }
      ],
      "from": "tenant",
      "condition": "Tenant configured provider waku-platform; own-key providers bypass metering proxy"
    },
    {
      "id": "arena-waku-164",
      "to": "waku",
      "kind": "call",
      "label": "independent race harness",
      "source": [
        {
          "file": "waku/ops/arena.py",
          "line": 35,
          "symbol": "compare_stream"
        }
      ],
      "from": "arena"
    },
    {
      "id": "delegate-usage-165",
      "to": "usage",
      "kind": "data",
      "label": "append subagent token usage",
      "source": [
        {
          "file": "waku/tools/experimental.py",
          "line": 86,
          "symbol": "_record_subagent_usage"
        }
      ],
      "from": "delegate"
    },
    {
      "id": "respond-reply-166",
      "to": "reply",
      "kind": "transition",
      "label": "return after persistence/exports",
      "source": [
        {
          "file": "waku/app.py",
          "line": 46,
          "symbol": "respond"
        }
      ],
      "from": "respond"
    },
    {
      "id": "whatsapp-waku-167",
      "to": "waku",
      "kind": "call",
      "label": "construct shared locked webhook agent",
      "source": [
        {
          "file": "waku/gateway/whatsapp.py",
          "line": 123,
          "symbol": "_build_handler"
        }
      ],
      "from": "whatsapp"
    },
    {
      "id": "whatsapp-respond-168",
      "to": "respond",
      "kind": "call",
      "label": "signature/sender-filtered webhook message",
      "source": [
        {
          "file": "waku/gateway/whatsapp.py",
          "line": 123,
          "symbol": "_build_handler"
        }
      ],
      "from": "whatsapp"
    },
    {
      "id": "telegram-deliver-169",
      "to": "deliver",
      "kind": "call",
      "label": "run and send permitted text",
      "source": [
        {
          "file": "waku/gateway/telegram.py",
          "line": 52,
          "symbol": "_build_app"
        }
      ],
      "from": "telegram"
    },
    {
      "id": "discord-deliver-170",
      "to": "deliver",
      "kind": "call",
      "label": "run and send admitted text",
      "source": [
        {
          "file": "waku/gateway/discord.py",
          "line": 137,
          "symbol": "_build_client"
        }
      ],
      "from": "discord"
    },
    {
      "id": "http-supervisor-171",
      "to": "supervisor",
      "kind": "call",
      "label": "dashboard startup reconciles gateways",
      "source": [
        {
          "file": "waku/ops/dashboard.py",
          "line": 1268,
          "symbol": "supervisor.reconcile()"
        }
      ],
      "from": "http"
    },
    {
      "id": "loop-observe-172",
      "to": "observe",
      "kind": "data",
      "label": "llm/text/tool events",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 59,
          "symbol": "run_loop"
        }
      ],
      "from": "loop"
    },
    {
      "id": "gated-retrieve-observe-173",
      "to": "observe",
      "kind": "data",
      "label": "gate/slot verdicts",
      "source": [
        {
          "file": "waku/memory/__init__.py",
          "line": 107,
          "symbol": "gated_retrieve"
        }
      ],
      "from": "gated-retrieve"
    },
    {
      "id": "graph-engine-observe-174",
      "to": "observe",
      "kind": "data",
      "label": "graph/node/route events",
      "source": [
        {
          "file": "waku/graph/engine.py",
          "line": 106,
          "symbol": "run_graph"
        }
      ],
      "from": "graph-engine"
    },
    {
      "id": "observe-tracer-175",
      "to": "tracer",
      "kind": "data",
      "label": "forward events",
      "source": [
        {
          "file": "waku/app.py",
          "line": 46,
          "symbol": "respond"
        }
      ],
      "from": "observe"
    },
    {
      "id": "remember-mcp-call-176",
      "to": "mcp-call",
      "kind": "call",
      "label": "memory.remember with scope",
      "source": [
        {
          "file": "waku/tools/waku_memory.py",
          "line": 34,
          "symbol": "remember_via"
        }
      ],
      "from": "remember",
      "condition": "Configured connected Waku Memory server discovered by remember_via"
    },
    {
      "id": "main-skill-install-audit",
      "from": "main",
      "to": "skill-install",
      "label": "explicit skill install/export administration",
      "kind": "transition",
      "source": [
        {
          "file": "waku/__main__.py",
          "line": 85,
          "symbol": "elif args[0] == \"skill\""
        }
      ],
      "condition": "Arguments match skill install or export"
    },
    {
      "id": "settings-field-home-audit",
      "from": "settings",
      "to": "home",
      "label": "Settings.home default factory invokes resolve_home",
      "kind": "data",
      "source": [
        {
          "file": "waku/config.py",
          "line": 150,
          "symbol": "home: Path = field(default_factory=lambda: resolve_home().path)"
        }
      ]
    },
    {
      "id": "integration-supervisor-audit",
      "from": "integration",
      "to": "supervisor",
      "label": "reconcile changed gateway configuration",
      "kind": "call",
      "source": [
        {
          "file": "waku/integrations.py",
          "line": 700,
          "symbol": "statuses = _gateway_reloader({key})"
        }
      ],
      "condition": "ReloadMode.GATEWAY and registered reloader"
    },
    {
      "id": "rebuild-switch-gap-audit",
      "from": "rebuild",
      "to": "session",
      "label": "preserve identifier only; history starts empty",
      "kind": "data",
      "source": [
        {
          "file": "waku/ops/browser_agent.py",
          "line": 152,
          "symbol": "fresh.session.session_id = ("
        }
      ]
    },
    {
      "id": "quick-model-api-audit",
      "from": "quick",
      "to": "model-api",
      "label": "small-model quick call",
      "kind": "call",
      "source": [
        {
          "file": "waku/app.py",
          "line": 157,
          "symbol": "self.client.messages.create"
        }
      ],
      "condition": "Triage quick branch"
    },
    {
      "id": "gate-model-api-audit",
      "from": "retrieval-gate",
      "to": "model-api",
      "label": "small-model retrieval decision",
      "kind": "call",
      "source": [
        {
          "file": "waku/memory/retrieval_gate.py",
          "line": 42,
          "symbol": "response = client.messages.create("
        }
      ]
    },
    {
      "id": "summary-model-api-audit",
      "from": "summarize",
      "to": "model-api",
      "label": "small-model batch extraction",
      "kind": "call",
      "source": [
        {
          "file": "waku/memory/consolidation.py",
          "line": 121,
          "symbol": "response = client.messages.create("
        }
      ]
    },
    {
      "id": "classify-model-api-audit",
      "from": "classify",
      "to": "model-api",
      "label": "small-model route classification",
      "kind": "call",
      "source": [
        {
          "file": "waku/graph/workflows/triage.py",
          "line": 56,
          "symbol": "response = client.messages.create("
        }
      ]
    },
    {
      "id": "gather-model-api-audit",
      "from": "synthesis",
      "to": "model-api",
      "label": "tool-free digest generation",
      "kind": "call",
      "source": [
        {
          "file": "waku/ops/gather.py",
          "line": 112,
          "symbol": "resp = waku.client.messages.create("
        }
      ]
    },
    {
      "id": "calendar-apple-mirror-audit",
      "from": "calendar",
      "to": "apple",
      "label": "optional dedicated Apple Calendar mirror",
      "kind": "call",
      "source": [
        {
          "file": "waku/tools/calendar.py",
          "line": 446,
          "symbol": "where += \" \" + sync_to_apple_calendar"
        }
      ],
      "condition": "apple_calendar enabled; distinct from registering apple_tools"
    },
    {
      "id": "persist-pending-sync-audit",
      "from": "due",
      "to": "sync",
      "label": "retry pending tracked facts before summary",
      "kind": "transition",
      "source": [
        {
          "file": "waku/memory/consolidation.py",
          "line": 113,
          "symbol": "for fact in facts.unsynced():"
        }
      ],
      "condition": "Threshold met, remember configured, SqliteFactStore"
    },
    {
      "id": "summarize-remote-store-audit",
      "from": "commit-memory",
      "to": "remote-facts",
      "label": "configured fact store writes",
      "kind": "call",
      "source": [
        {
          "file": "waku/memory/consolidation.py",
          "line": 155,
          "symbol": "facts.add(fact[\"subject\"], fact[\"content\"], source=\"consolidation\")"
        }
      ],
      "condition": "Non-SQLite fact backend selected"
    },
    {
      "id": "create-client-audit",
      "from": "create",
      "to": "client",
      "kind": "data",
      "label": "uses configured client.messages interface",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 104,
          "symbol": "response = client.messages.create("
        }
      ]
    },
    {
      "id": "stream-client-audit",
      "from": "stream",
      "to": "client",
      "kind": "data",
      "label": "uses configured client.messages interface",
      "source": [
        {
          "file": "waku/loop/agent.py",
          "line": 88,
          "symbol": "with client.messages.stream("
        }
      ]
    }
  ],
  "traces": [
    {
      "id": "normal",
      "label": "Browser reply · memory skipped",
      "description": "Illustrative path: graph flag off, gate chooses skip, provider returns text, consolidation not due.",
      "steps": [
        {
          "nodeId": "sse",
          "detail": "A nonempty message enters HTTP/SSE."
        },
        {
          "nodeId": "chat",
          "detail": "Acquire browser agent lock."
        },
        {
          "nodeId": "singleton",
          "detail": "Reuse or lazily construct browser agent."
        },
        {
          "nodeId": "rotate",
          "detail": "Assume thread is fresh; retain identifier."
        },
        {
          "nodeId": "respond",
          "detail": "Begin trace and compose observers."
        },
        {
          "nodeId": "graph-enabled",
          "detail": "Flag off: take full turn."
        },
        {
          "nodeId": "full",
          "detail": "Assemble ordinary loop input."
        },
        {
          "nodeId": "build-system",
          "detail": "Read persona, clock and identity."
        },
        {
          "nodeId": "retrieval-gate",
          "detail": "Assume gate chooses skip."
        },
        {
          "nodeId": "skills",
          "detail": "Include any matching skills independently of gate."
        },
        {
          "nodeId": "history-window",
          "detail": "Keep configured recent tail."
        },
        {
          "nodeId": "loop",
          "detail": "First provider iteration."
        },
        {
          "nodeId": "schemas",
          "detail": "Current registered schemas enter provider request; assume streaming-capable client."
        },
        {
          "nodeId": "stream",
          "detail": "Emit assumed provider text deltas."
        },
        {
          "nodeId": "response",
          "detail": "Append final assistant response."
        },
        {
          "nodeId": "tool-decision",
          "detail": "No tool_use blocks."
        },
        {
          "nodeId": "reply",
          "detail": "Construct LoopResult."
        },
        {
          "nodeId": "exchange",
          "detail": "Fold record into session history."
        },
        {
          "nodeId": "chat-log",
          "detail": "Commit exchange metadata."
        },
        {
          "nodeId": "due",
          "detail": "Assume insufficient unconsolidated rows."
        },
        {
          "nodeId": "mirror",
          "detail": "Refresh local memory views."
        },
        {
          "nodeId": "tracer",
          "detail": "Write turn_end."
        },
        {
          "nodeId": "chat",
          "detail": "Emit done result to browser."
        }
      ]
    },
    {
      "id": "calendar-tool",
      "label": "Tool round · local calendar",
      "description": "Illustrative path: retrieved facts exist, create_event valid and not duplicate, next iteration returns answer.",
      "steps": [
        {
          "nodeId": "full",
          "detail": "Prepare full turn."
        },
        {
          "nodeId": "retrieval-gate",
          "detail": "Assume retrieve with a generated query."
        },
        {
          "nodeId": "facts",
          "detail": "Search local facts."
        },
        {
          "nodeId": "slot",
          "detail": "Default disabled: retain retrieved facts."
        },
        {
          "nodeId": "episodes",
          "detail": "Add relevant episodes."
        },
        {
          "nodeId": "history-window",
          "detail": "Bound prior transcript."
        },
        {
          "nodeId": "create",
          "detail": "Assume nonstreaming provider request."
        },
        {
          "nodeId": "tool-decision",
          "detail": "Provider asks create_event."
        },
        {
          "nodeId": "execute",
          "detail": "Dispatch callable; no approval queue."
        },
        {
          "nodeId": "calendar",
          "detail": "Validate then deduplicate title/start."
        },
        {
          "nodeId": "ics",
          "detail": "Commit local row then append ICS."
        },
        {
          "nodeId": "tool-results",
          "detail": "Return artifact location to model."
        },
        {
          "nodeId": "loop",
          "detail": "Next model iteration."
        },
        {
          "nodeId": "tool-decision",
          "detail": "Assume no further tools."
        },
        {
          "nodeId": "exchange",
          "detail": "Record reply and tools-used history line."
        },
        {
          "nodeId": "chat-log",
          "detail": "Commit completed exchange."
        }
      ]
    },
    {
      "id": "quick",
      "label": "Optional triage · quick branch",
      "description": "Illustrative graph enabled: classifier returns quick and calendar read succeeds. Parallel scan steps are displayed serially for inspection, not implying execution order.",
      "steps": [
        {
          "nodeId": "respond",
          "detail": "Enter optional graph route."
        },
        {
          "nodeId": "triage",
          "detail": "Construct triage topology."
        },
        {
          "nodeId": "graph-engine",
          "detail": "Run START wave with two independent nodes."
        },
        {
          "nodeId": "classify",
          "detail": "Assume quick classification."
        },
        {
          "nodeId": "check-calendar",
          "detail": "Read local ICS concurrently with classifier."
        },
        {
          "nodeId": "join",
          "detail": "Wait for both outputs; code router chooses quick."
        },
        {
          "nodeId": "quick",
          "detail": "Small-model answer without full memory/tool prompt."
        },
        {
          "nodeId": "reply",
          "detail": "Wrap graph reply."
        },
        {
          "nodeId": "exchange",
          "detail": "Persist the completed quick exchange."
        },
        {
          "nodeId": "due",
          "detail": "Consolidation still considered."
        },
        {
          "nodeId": "mirror",
          "detail": "Export local memory views."
        }
      ]
    },
    {
      "id": "consolidate",
      "label": "Due batch · remote remember failure",
      "description": "Illustrative SQLite facts + connected Waku Memory: threshold met, no old pending-send failure, valid summary, then first new-fact remote send fails but local fact remains.",
      "steps": [
        {
          "nodeId": "exchange",
          "detail": "Completed turn appended."
        },
        {
          "nodeId": "chat-log",
          "detail": "Commit rows across the selected conversation."
        },
        {
          "nodeId": "due",
          "detail": "Read all sessions’ unconsolidated rows; threshold met."
        },
        {
          "nodeId": "sync",
          "detail": "Check prior pending facts first; assume none or all prior sends succeed, so new sends remain reachable."
        },
        {
          "nodeId": "summarize",
          "detail": "Assume valid fact/episode JSON."
        },
        {
          "nodeId": "keep",
          "detail": "Default gate off: keep proposed facts."
        },
        {
          "nodeId": "commit-memory",
          "detail": "Insert kept fact locally; per-fact remote send follows, and optional episode write follows the entire fact loop."
        },
        {
          "nodeId": "remember",
          "detail": "Assume remote memory.remember fails."
        },
        {
          "nodeId": "sync",
          "detail": "Leave pending state and stop further remote sends this batch."
        },
        {
          "nodeId": "chat-log",
          "detail": "Mark sampled chats consolidated after local writes."
        },
        {
          "nodeId": "mirror",
          "detail": "Regenerate local markdown files."
        }
      ]
    },
    {
      "id": "gather",
      "label": "Gather · parallel proposal",
      "description": "Illustrative explicit /gather with a nonzero PR count. Scans share one parallel wave; their listed order is explanatory.",
      "steps": [
        {
          "nodeId": "chat",
          "detail": "Recognize explicit command."
        },
        {
          "nodeId": "commands",
          "detail": "Resolve registered gather runner."
        },
        {
          "nodeId": "gather",
          "detail": "Construct proposal-only graph."
        },
        {
          "nodeId": "graph-engine",
          "detail": "Launch four independent scans."
        },
        {
          "nodeId": "scans",
          "detail": "Collect GitHub, web, calendar and memory; failures become fallback data."
        },
        {
          "nodeId": "synthesis",
          "detail": "Wait for four dependencies then make one tool-free synthesis call."
        },
        {
          "nodeId": "action",
          "detail": "Assume PR count nonzero: propose."
        },
        {
          "nodeId": "draft",
          "detail": "Write markdown outbox artifact; no merge/send tools."
        },
        {
          "nodeId": "chat",
          "detail": "Emit workflow result."
        }
      ]
    },
    {
      "id": "delegate",
      "label": "Experimental pi delegation",
      "description": "Illustrative experimental flag enabled and pi installed; scratch coding task launches JSON-mode specialist.",
      "steps": [
        {
          "nodeId": "registry-build",
          "detail": "Opt in to experimental tool schemas."
        },
        {
          "nodeId": "tool-decision",
          "detail": "Assume model requests delegate_task."
        },
        {
          "nodeId": "execute",
          "detail": "Forward notify to long-running tool."
        },
        {
          "nodeId": "delegate",
          "detail": "Create scratch workdir; map provider and project resources."
        },
        {
          "nodeId": "pi",
          "detail": "Read curated JSON events to assumed successful completion before deadline; older builds use text mode."
        },
        {
          "nodeId": "usage",
          "detail": "Append observed subagent usage."
        },
        {
          "nodeId": "workspace",
          "detail": "Preserve transcript/files, optionally autorun entrypoint and write manifest."
        },
        {
          "nodeId": "tool-results",
          "detail": "Feed summary and execution output into parent loop."
        },
        {
          "nodeId": "loop",
          "detail": "Parent model reasons over result."
        }
      ]
    }
  ]
};
