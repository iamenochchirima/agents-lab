import type { ArchitectureNode, ArchitectureEdge } from './hermesArchitecture';

/** Added source boundaries at the pinned Hermes revision. See the expansion study for
 * coverage and limits; positions are assigned by the architecture map, not execution. */
export const expansionGroups: readonly { id: string; label: string }[] = [
  {
    "id": "admission",
    "label": "Turn admission \u00b7 ownership and liveness"
  },
  {
    "id": "environment",
    "label": "Execution environment \u00b7 terminal lifecycle"
  },
  {
    "id": "gw-host",
    "label": "Gateway host \u00b7 adapters and recovery"
  },
  {
    "id": "gw-admission",
    "label": "Gateway ingress \u00b7 admission and pending input"
  },
  {
    "id": "gw-session",
    "label": "Gateway sessions \u00b7 route and turn ownership"
  },
  {
    "id": "gw-runtime",
    "label": "Gateway execution \u00b7 workers and streaming"
  },
  {
    "id": "gw-delivery",
    "label": "Gateway response \u00b7 delivery and cleanup"
  },
  {
    "id": "sched-trigger",
    "label": "Scheduling \u00b7 trigger and dispatch"
  },
  {
    "id": "sched-runtime",
    "label": "Scheduling \u00b7 execution and delivery"
  },
  {
    "id": "configuration",
    "label": "Configuration \u00b7 model routes and credentials"
  },
  {
    "id": "resources",
    "label": "Resource discovery \u00b7 tools and prompt inputs"
  },
  {
    "id": "sessions",
    "label": "Session management \u00b7 restore and user controls"
  },
  {
    "id": "rt-provider",
    "label": "Provider attempts \u00b7 streaming and recovery"
  },
  {
    "id": "tool-dispatch",
    "label": "Tool policy \u00b7 scheduling and publication"
  },
  {
    "id": "memory-provider",
    "label": "Memory providers \u00b7 recall and writes"
  },
  {
    "id": "compact-pipeline",
    "label": "Default compressor \u00b7 candidate stages"
  }
];
export const expansionNodes: readonly Omit<ArchitectureNode, 'x' | 'y' | 'flowIds' | 'reviewStatus'>[] = [
  {
    "id": "lease-admit",
    "label": "admit_durable_turn_lease",
    "kind": "decision",
    "groupId": "admission",
    "summary": "With an eligible SQLite store, waits for a holder-qualified session lease. Missing/disabled storage bypasses this boundary; interrupted or expired waits return early.",
    "source": [
      {
        "file": "agent/turn_facade_lease.py",
        "line": 237,
        "symbol": "admit_durable_turn_lease"
      }
    ]
  },
  {
    "id": "lease-reload",
    "label": "Transcript reload after contention",
    "kind": "state",
    "groupId": "admission",
    "summary": "After admission, resolves resume identity and reloads stored messages only when contention made prior history potentially stale; preserves carried unpersisted input.",
    "source": [
      {
        "file": "agent/turn_facade_lease.py",
        "line": 295,
        "symbol": "admit_durable_turn_lease \u00b7 post-admission reload"
      }
    ]
  },
  {
    "id": "lease-carry",
    "label": "carry_unadmitted_user_message",
    "kind": "state",
    "groupId": "admission",
    "summary": "A soft interrupt while waiting can carry never-admitted user input in returned in-memory history for the next turn. Hard stop cancels that input.",
    "source": [
      {
        "file": "agent/turn_facade_lease.py",
        "line": 341,
        "symbol": "carry_unadmitted_user_message"
      }
    ]
  },
  {
    "id": "lease-owner",
    "label": "DurableTurnLease",
    "kind": "state",
    "groupId": "admission",
    "summary": "Retains admitted holder identity and active-turn state; starts renewal and eligible liveness polling at turn entry.",
    "source": [
      {
        "file": "agent/turn_facade_lease.py",
        "line": 27,
        "symbol": "DurableTurnLease"
      },
      {
        "file": "agent/turn_facade_lease.py",
        "line": 72,
        "symbol": "start"
      }
    ]
  },
  {
    "id": "lease-renew",
    "label": "refresh_tick",
    "kind": "decision",
    "groupId": "admission",
    "summary": "Holder-qualified renewal failure or exception interrupts an active turn; a stopped lease cannot interrupt the next turn.",
    "source": [
      {
        "file": "agent/turn_facade_lease.py",
        "line": 182,
        "symbol": "refresh_tick"
      }
    ]
  },
  {
    "id": "lease-watchdog",
    "label": "TurnLivenessWatchdog._tick",
    "kind": "decision",
    "groupId": "admission",
    "summary": "Configured polling samples actual progress; stalled observations require generation revalidation before hard cancellation and withdrawal of lease renewal.",
    "source": [
      {
        "file": "agent/turn_liveness.py",
        "line": 123,
        "symbol": "TurnLivenessWatchdog._tick"
      },
      {
        "file": "agent/turn_facade_lease.py",
        "line": 131,
        "symbol": "commit_liveness_abort"
      }
    ]
  },
  {
    "id": "lease-timers",
    "label": "PeriodicScheduler",
    "kind": "component",
    "groupId": "admission",
    "summary": "One timer scheduler dispatches each due callback on a worker; callback handles cancel renewal and watchdog work. Callback execution is process-local.",
    "source": [
      {
        "file": "agent/periodic_scheduler.py",
        "line": 63,
        "symbol": "PeriodicScheduler"
      },
      {
        "file": "agent/periodic_scheduler.py",
        "line": 88,
        "symbol": "_dispatch"
      }
    ]
  },
  {
    "id": "lease-cleanup",
    "label": "Stop / cancel timers / clear / release",
    "kind": "state",
    "groupId": "admission",
    "summary": "Facade deactivates renewal, cancels and waits boundedly on handles, clears its own interrupt, then releases its admitted row; this is guarded finally cleanup.",
    "source": [
      {
        "file": "agent/turn_facade.py",
        "line": 197,
        "symbol": "run_conversation \u00b7 lease cleanup"
      },
      {
        "file": "agent/turn_facade_lease.py",
        "line": 96,
        "symbol": "join_threads"
      },
      {
        "file": "agent/turn_facade_lease.py",
        "line": 164,
        "symbol": "clear_interrupt"
      }
    ]
  },
  {
    "id": "lease-scopes",
    "label": "Relay and accounting scopes",
    "kind": "state",
    "groupId": "admission",
    "summary": "Facade acquires relay conversation/turn ownership and binds accounting and interrupt context around runtime execution. These scopes are distinct from SQLite admission.",
    "source": [
      {
        "file": "agent/turn_facade.py",
        "line": 105,
        "symbol": "run_conversation \u00b7 acquire_conversation"
      },
      {
        "file": "agent/turn_facade.py",
        "line": 133,
        "symbol": "run_conversation \u00b7 context scopes"
      }
    ]
  },
  {
    "id": "env-terminal",
    "label": "terminal_tool \u00b7 execution plan",
    "kind": "component",
    "groupId": "environment",
    "summary": "Selected terminal calls prepare an execution plan before acquiring a task environment; per-command working directory is distinct from persisted session cwd.",
    "source": [
      {
        "file": "tools/terminal_tool.py",
        "line": 1407,
        "symbol": "terminal_tool \u00b7 _plan_execution"
      }
    ]
  },
  {
    "id": "env-acquire",
    "label": "_acquire_env \u00b7 lazy task environment",
    "kind": "component",
    "groupId": "environment",
    "summary": "Reuses a cached environment or creates the configured backend under a per-task creation lock, then publishes it to the cache. Creating prompt hints does not create this environment.",
    "source": [
      {
        "file": "tools/terminal_tool.py",
        "line": 1182,
        "symbol": "_acquire_env"
      }
    ]
  },
  {
    "id": "gw-runner",
    "label": "GatewayRunner \u00b7 host controller",
    "kind": "component",
    "groupId": "gw-host",
    "summary": "Composes authorization, ingress, turn, adapter, startup and shutdown owners; initializes shared session/runtime state. This host is separate from CLIChatTurnMixin.",
    "source": [
      {
        "file": "gateway/run.py",
        "line": 3377,
        "symbol": "GatewayRunner"
      }
    ]
  },
  {
    "id": "gw-startup",
    "label": "GatewayStartupMixin.start",
    "kind": "component",
    "groupId": "gw-host",
    "summary": "Recovers previous run, warms prerequisites, connects configured primary/secondary adapters and gates inbound while startup restoration is active.",
    "source": [
      {
        "file": "gateway/run_startup.py",
        "line": 1585,
        "symbol": "_start_impl"
      }
    ]
  },
  {
    "id": "gw-adapters",
    "label": "Adapter factory + handler wiring",
    "kind": "component",
    "groupId": "gw-host",
    "summary": "Instantiates registered platform adapter classes and installs message, busy-session, fatal-error and platform-event callbacks. Each concrete adapter owns its transport implementation.",
    "source": [
      {
        "file": "gateway/run_adapters.py",
        "line": 1317,
        "symbol": "_wire_adapter_handlers"
      }
    ]
  },
  {
    "id": "gw-profile-route",
    "label": "Profile canonicalization",
    "kind": "decision",
    "groupId": "gw-host",
    "summary": "Canonicalizes SessionSource against served profile identity; an explicit unserved profile route fails closed. Profile-scoped handler wrappers preserve task-local routing.",
    "source": [
      {
        "file": "gateway/run_adapters.py",
        "line": 1648,
        "symbol": "_canonicalize"
      }
    ]
  },
  {
    "id": "gw-ingress",
    "label": "BasePlatformAdapter.handle_message",
    "kind": "component",
    "groupId": "gw-admission",
    "summary": "Consumes normalized MessageEvent, resolves routing identity, checks active adapter guard, and starts processing or dispatches busy input. This is adapter admission rather than agent execution.",
    "source": [
      {
        "file": "gateway/platforms/base.py",
        "line": 4039,
        "symbol": "handle_message"
      }
    ]
  },
  {
    "id": "gw-background-turn",
    "label": "Adapter session processing task",
    "kind": "state",
    "groupId": "gw-admission",
    "summary": "Installs guard before task spawn; background processing calls the installed gateway handler, handles presentation/delivery and clears or hands off the guard in cleanup.",
    "source": [
      {
        "file": "gateway/platforms/base.py",
        "line": 4563,
        "symbol": "_process_message_background"
      }
    ]
  },
  {
    "id": "gw-admit",
    "label": "Ingress authorization + hooks",
    "kind": "decision",
    "groupId": "gw-admission",
    "summary": "Resets inherited session variables, validates routed identity, filters ignored Slack channels, queues startup-held external events, runs plugin dispatch hook and checks user authorization. Internal events bypass the external hook/auth branch.",
    "source": [
      {
        "file": "gateway/run_inbound.py",
        "line": 205,
        "symbol": "_hm_admit_event"
      }
    ]
  },
  {
    "id": "gw-command-busy",
    "label": "Commands / replies / busy input",
    "kind": "decision",
    "groupId": "gw-admission",
    "summary": "Emergency-stop gate, pending clarify/update replies, busy-session routing and idle commands can return without a new model turn. Busy input may steer, interrupt or queue depending policy.",
    "source": [
      {
        "file": "gateway/run_inbound.py",
        "line": 1323,
        "symbol": "_handle_message"
      }
    ]
  },
  {
    "id": "gw-active-claim",
    "label": "Active-session slot + generation",
    "kind": "state",
    "groupId": "gw-admission",
    "summary": "Claims runner concurrency slot and publishes pending-agent sentinel before awaits; records generation so displaced-turn cleanup cannot release a replacement.",
    "source": [
      {
        "file": "gateway/run_inbound.py",
        "line": 1387,
        "symbol": "_handle_message active slot claim"
      }
    ]
  },
  {
    "id": "gw-session-route",
    "label": "SessionStore \u00b7 route lookup/create",
    "kind": "store",
    "groupId": "gw-session",
    "summary": "Single-flight routing-key lookup recovers, creates or resets SessionEntry; tracks compression descendants and persists route transition. A routing key and resolved session ID are distinct.",
    "source": [
      {
        "file": "gateway/session.py",
        "line": 891,
        "symbol": "get_or_create_session"
      }
    ]
  },
  {
    "id": "gw-turn-lease",
    "label": "Resolved-session turn lease",
    "kind": "state",
    "groupId": "gw-session",
    "summary": "Serializes history load, agent execution and flush across routing keys sharing one resolved session ID. Timeout refuses the turn before transcript load; release is generation owned. Registry absence is an explicit no-op fallback in the helper.",
    "source": [
      {
        "file": "gateway/run_turn.py",
        "line": 605,
        "symbol": "_hmwa_acquire_turn_lease"
      }
    ]
  },
  {
    "id": "gw-active-marker",
    "label": "Durable active-turn marker",
    "kind": "store",
    "groupId": "gw-session",
    "summary": "Best-effort persisted active marker is installed after turn lease acquisition. CAS token cleanup belongs to its event; final delivery can hand recovery ownership to the delivery ledger.",
    "source": [
      {
        "file": "gateway/run_inbound.py",
        "line": 1801,
        "symbol": "_mark_durable_active_turn"
      }
    ]
  },
  {
    "id": "gw-prepare",
    "label": "History + pinned prompt + inbound enrichment",
    "kind": "component",
    "groupId": "gw-session",
    "summary": "Opens session, binds task-local tool context, pins context prompt, stages sidecar notes/auto-skills, acquires lease, loads transcript, applies session hygiene and enriches media/references. Unreadable history stops execution.",
    "source": [
      {
        "file": "gateway/run_turn.py",
        "line": 2045,
        "symbol": "_hmwa_prepare_turn"
      }
    ]
  },
  {
    "id": "gw-agent-cache",
    "label": "TurnRunner \u00b7 reuse or build AIAgent",
    "kind": "decision",
    "groupId": "gw-runtime",
    "summary": "Resolves runtime route and signature; validates cached agent/session compatibility or constructs a fresh agent, then rebinds callbacks for the current turn.",
    "source": [
      {
        "file": "gateway/run_turn_runner.py",
        "line": 1139,
        "symbol": "_resolve_turn_agent"
      }
    ]
  },
  {
    "id": "gw-turn-worker",
    "label": "Gateway turn worker + interruption",
    "kind": "component",
    "groupId": "gw-runtime",
    "summary": "Starts blocking TurnRunner.run_sync under copied context, while asynchronous tracking, streaming and interrupt monitoring tasks run. Await path watches activity; an interrupt does not imply the worker is already stopped.",
    "source": [
      {
        "file": "gateway/run_turn.py",
        "line": 3414,
        "symbol": "_run_agent_start_turn_worker"
      }
    ]
  },
  {
    "id": "gw-stream",
    "label": "Streaming / progress consumers",
    "kind": "component",
    "groupId": "gw-runtime",
    "summary": "Per-turn stream consumer and progress tasks deliver updates independently from the executor worker. Final streaming delivery is checked before deciding whether the outer adapter must send the final reply.",
    "source": [
      {
        "file": "gateway/run_turn.py",
        "line": 4267,
        "symbol": "_run_agent_inner"
      }
    ]
  },
  {
    "id": "gw-run-sync",
    "label": "TurnRunner.run_sync",
    "kind": "component",
    "groupId": "gw-runtime",
    "summary": "Selects agent, wires callbacks, prepares history/message and calls AIAgent.run_conversation through approval wrapper. Gateway entry reaches the shared agent turn facade; it does not enter CLI chat.",
    "source": [
      {
        "file": "gateway/run_turn_runner.py",
        "line": 1884,
        "symbol": "run_sync"
      }
    ]
  },
  {
    "id": "gw-transcript",
    "label": "Gateway transcript reconciliation",
    "kind": "component",
    "groupId": "gw-runtime",
    "summary": "Updates transcript/metadata after the agent. agent_persisted controls duplicate DB writes; overflow and early-failure paths have distinct persistence treatment.",
    "source": [
      {
        "file": "gateway/run_turn.py",
        "line": 1822,
        "symbol": "_hmwa_persist_turn_transcript"
      }
    ]
  },
  {
    "id": "gw-response",
    "label": "Response shaping + presentation policy",
    "kind": "component",
    "groupId": "gw-delivery",
    "summary": "Shapes response before transcript reconciliation: classifies silence/errors, applies reasoning/footer policy and post-turn hooks. After persistence, delivery policy returns remaining text or None when suppressed/streamed; queued follow-up can have delivered earlier.",
    "source": [
      {
        "file": "gateway/run_turn.py",
        "line": 1501,
        "symbol": "_hmwa_shape_agent_response"
      }
    ]
  },
  {
    "id": "gw-final-ledger",
    "label": "Final-text delivery obligation",
    "kind": "store",
    "groupId": "gw-delivery",
    "summary": "Records a final-text obligation before transport send, releases the active marker after ledger admission, then finalizes from SendResult. A refused send can leave recovery work; this is not an exactly-once delivery guarantee.",
    "source": [
      {
        "file": "gateway/platforms/base.py",
        "line": 4379,
        "symbol": "send_final_ledgered"
      }
    ]
  },
  {
    "id": "gw-send",
    "label": "Current transport send + retry",
    "kind": "component",
    "groupId": "gw-delivery",
    "summary": "Resolves current delivery adapter (which may have changed on reconnect), sends final text with retry, and handles media/local files separately. Final-text ledger does not establish identical guarantees for all attachments.",
    "source": [
      {
        "file": "gateway/platforms/base.py",
        "line": 3649,
        "symbol": "_send_with_retry"
      }
    ]
  },
  {
    "id": "gw-cleanup",
    "label": "Generation cleanup + pending-input drain",
    "kind": "component",
    "groupId": "gw-delivery",
    "summary": "Runner finally restores one-turn overrides and releases owned runner slot/lease. Adapter finally releases marker, stops typing, fires owned post-delivery callback and reconciles pending input/task guard.",
    "source": [
      {
        "file": "gateway/run_inbound.py",
        "line": 1418,
        "symbol": "_handle_message finally"
      }
    ]
  },
  {
    "id": "gw-restore",
    "label": "Startup resume / obligation redelivery",
    "kind": "component",
    "groupId": "gw-host",
    "summary": "Claims pending delivery obligations, redelivers through available adapter, schedules eligible interrupted-session resume and bounds startup restore before draining held inbound. Reply replay and model resume are different branches.",
    "source": [
      {
        "file": "gateway/run_startup.py",
        "line": 1485,
        "symbol": "_start_finish_wiring"
      }
    ]
  },
  {
    "id": "gw-async-watch",
    "label": "Async delegation completion watcher",
    "kind": "component",
    "groupId": "gw-runtime",
    "summary": "Idle watcher drains async-delegation receipts, sweeps orphaned completion ledgers and groups compatible completions. Process completions retain their per-process watchers.",
    "source": [
      {
        "file": "gateway/run_notifications.py",
        "line": 1875,
        "symbol": "_async_delegation_watcher"
      }
    ]
  },
  {
    "id": "gw-completion-wake",
    "label": "Claim + inject internal completion wake",
    "kind": "component",
    "groupId": "gw-admission",
    "summary": "Preflights route and durable completion claim, injects a synthetic internal message for push adapters or self-posts API-server path. Receipt acceptance means adapter admission, not completed model execution; crash after acceptance can replay.",
    "source": [
      {
        "file": "gateway/run_notifications.py",
        "line": 1569,
        "symbol": "_deliver_completion_notification"
      }
    ]
  },
  {
    "id": "gw-shutdown",
    "label": "Gateway drain / interrupt / teardown",
    "kind": "component",
    "groupId": "gw-host",
    "summary": "Shutdown begins draining, waits for active work, interrupts remaining work, finalizes agents/adapters and persists exit state. Cleanup has deadlines and ownership checks; process kill can skip finally.",
    "source": [
      {
        "file": "gateway/run_shutdown.py",
        "line": 2228,
        "symbol": "_stop_impl"
      }
    ]
  },
  {
    "id": "sched-provider",
    "label": "Cron trigger provider + supervised ticker",
    "kind": "component",
    "groupId": "sched-trigger",
    "summary": "Gateway resolves configured trigger provider with built-in fallback, starts supervised ticker and housekeeping. Built-in ticker receives profile/adapters and drain gate; external providers use the loopback API path.",
    "source": [
      {
        "file": "gateway/run.py",
        "line": 5694,
        "symbol": "_start_gateway_start_cron_and_housekeeping"
      }
    ]
  },
  {
    "id": "sched-tick",
    "label": "tick \u00b7 admission and file lock",
    "kind": "decision",
    "groupId": "sched-trigger",
    "summary": "Built-in tick holds retirement admission and file lock, checks stale-code/ESTOP/drain gates, scans due jobs and advances recurring schedules before submitting work. This occurs independently of user messages.",
    "source": [
      {
        "file": "cron/scheduler_tick.py",
        "line": 18,
        "symbol": "_tick_admitted"
      }
    ]
  },
  {
    "id": "sched-jobs",
    "label": "Persisted jobs + due occurrence scan",
    "kind": "store",
    "groupId": "sched-trigger",
    "summary": "Job store identifies due jobs; recurring next-run advance and one-shot run claims are different mechanisms. Detailed storage transaction/recovery semantics remain a separate audit.",
    "source": [
      {
        "file": "cron/jobs.py",
        "line": 2890,
        "symbol": "get_due_jobs"
      }
    ]
  },
  {
    "id": "sched-submit",
    "label": "In-flight guard + execution record + pool",
    "kind": "component",
    "groupId": "sched-trigger",
    "summary": "Registers in-process running job, creates execution attempt record before submission and copies context into persistent pool worker; dispatch errors record failure and release guards.",
    "source": [
      {
        "file": "cron/scheduler.py",
        "line": 4265,
        "symbol": "_submit_with_guard"
      }
    ]
  },
  {
    "id": "sched-fire",
    "label": "Durable fire claim / execution dispatch",
    "kind": "decision",
    "groupId": "sched-runtime",
    "summary": "Worker acquires persisted fire claim when execution actually starts and runs shared run_one_job body. Lost claim prevents starting or fences later side effects; in-process guard alone is insufficient.",
    "source": [
      {
        "file": "cron/scheduler.py",
        "line": 4250,
        "symbol": "_process_due_job"
      }
    ]
  },
  {
    "id": "sched-job",
    "label": "run_job \u00b7 prompt / runtime / ephemeral agent",
    "kind": "component",
    "groupId": "sched-runtime",
    "summary": "Builds job prompt, applies preflight/monitor/script gates, scopes job environment, resolves runtime/toolsets, opens session DB and constructs ephemeral AIAgent. no_agent jobs can return before construction.",
    "source": [
      {
        "file": "cron/scheduler.py",
        "line": 2552,
        "symbol": "run_job"
      }
    ]
  },
  {
    "id": "sched-watchdog",
    "label": "Cron agent worker + inactivity watchdog",
    "kind": "component",
    "groupId": "sched-runtime",
    "summary": "Runs shared agent turn on copied-context worker thread, monitors inactivity rather than total wall time, heartbeats one-shot claim and interrupts on cancellation/claim loss. A timed-out worker may finish later.",
    "source": [
      {
        "file": "cron/scheduler.py",
        "line": 1968,
        "symbol": "_run_agent_with_watchdog"
      }
    ]
  },
  {
    "id": "sched-delivery",
    "label": "Output / delivery fence / outcome ledger",
    "kind": "component",
    "groupId": "sched-runtime",
    "summary": "After run, saves output and composes conditional notification under fire-claim fences; live adapters or standalone/durable queue paths deliver. Records job/execution delivery outcome and tears down deferred agent only after delivery.",
    "source": [
      {
        "file": "cron/scheduler.py",
        "line": 3072,
        "symbol": "_save_compose_deliver"
      }
    ]
  },
  {
    "id": "sched-external-worker",
    "label": "Restart-safe external cron worker",
    "kind": "component",
    "groupId": "sched-runtime",
    "summary": "Managed systemd topology launches the job outside gateway process using transient scope or configured direct-subprocess fallback. Non-managed topology remains in-process. Durable execution ownership and queue delivery bridge workers to gateway; unknown worker outcome is not silently retried.",
    "source": [
      {
        "file": "cron/scheduler.py",
        "line": 3640,
        "symbol": "_launch_external_cron_worker"
      }
    ]
  },
  {
    "id": "cfg-cli-config",
    "label": "load_cli_config",
    "kind": "component",
    "groupId": "configuration",
    "summary": "CLI defaults merge the selected config file, expand environment references and apply managed overlay before mirroring selected values to tool environment variables. This is a distinct loader from the shared load_config API.",
    "source": [
      {
        "file": "hermes_cli/cli_config_load.py",
        "line": 258,
        "symbol": "load_cli_config"
      }
    ]
  },
  {
    "id": "cfg-model-route",
    "label": "_init_model_and_provider",
    "kind": "component",
    "groupId": "configuration",
    "summary": "Resolves launch model/provider, startup aliases and explicit endpoint/key intent. Runtime credentials remain lazy; resume records cannot override an explicit launch model.",
    "source": [
      {
        "file": "hermes_cli/cli_init_mixin.py",
        "line": 106,
        "symbol": "_init_model_and_provider"
      }
    ]
  },
  {
    "id": "cfg-run-controls",
    "label": "Turn limits + rules",
    "kind": "component",
    "groupId": "configuration",
    "summary": "Resolves iteration/time budgets, checkpoint controls and ignore-rules flags. Ignore-rules suppresses context files and memory passed to the main agent.",
    "source": [
      {
        "file": "hermes_cli/cli_init_mixin.py",
        "line": 199,
        "symbol": "_init_turn_limits"
      }
    ]
  },
  {
    "id": "cfg-request-policy",
    "label": "Prompt / reasoning / fallbacks",
    "kind": "component",
    "groupId": "configuration",
    "summary": "Resolves ephemeral prompt, prefill messages, model reasoning, service tier, provider routing controls and the ordered configured fallback chain.",
    "source": [
      {
        "file": "hermes_cli/cli_init_mixin.py",
        "line": 249,
        "symbol": "_init_prompt_and_reasoning"
      }
    ]
  },
  {
    "id": "cfg-credential-gate",
    "label": "_ensure_runtime_credentials",
    "kind": "decision",
    "groupId": "configuration",
    "summary": "Re-resolves credentials before use; validates endpoint/key shape, normalizes model and retires the old agent on changed credentials or routing. Returns false on unusable routes.",
    "source": [
      {
        "file": "hermes_cli/cli_agent_setup_mixin.py",
        "line": 232,
        "symbol": "_ensure_runtime_credentials"
      }
    ]
  },
  {
    "id": "cfg-provider-ladder",
    "label": "resolve_runtime_provider",
    "kind": "component",
    "groupId": "configuration",
    "summary": "Ordered lazy resolution covers configured aliases/custom endpoints, explicit credentials, pools, OAuth and environment/key providers. The app-server runtime overlay is applied after resolution. Provider-specific credential implementations are not expanded here.",
    "source": [
      {
        "file": "hermes_cli/runtime_provider.py",
        "line": 982,
        "symbol": "resolve_runtime_provider"
      }
    ]
  },
  {
    "id": "cfg-auth-fallback",
    "label": "_resolve_fallback_runtime",
    "kind": "decision",
    "groupId": "configuration",
    "summary": "On a primary AuthError, evaluates configured fallback routes and adopts the first usable runtime; non-auth failures return no fallback here. This startup auth fallback is separate from model-call error retries.",
    "source": [
      {
        "file": "hermes_cli/cli_agent_setup_mixin.py",
        "line": 364,
        "symbol": "_resolve_fallback_runtime"
      }
    ]
  },
  {
    "id": "cfg-client-factory",
    "label": "_build_client",
    "kind": "component",
    "groupId": "configuration",
    "summary": "Builds the main client for Anthropic Messages, MoA, Bedrock Converse or the OpenAI-family route, using provider/model timeout policy.",
    "source": [
      {
        "file": "agent/agent_init.py",
        "line": 1025,
        "symbol": "_build_client"
      }
    ]
  },
  {
    "id": "resource-plugin-discovery",
    "label": "discover_plugins",
    "kind": "component",
    "groupId": "resources",
    "summary": "Joins any background plugin discovery before requesting idempotent discovery/loading for the active home; loading failure in agent setup is logged and tool setup proceeds.",
    "source": [
      {
        "file": "hermes_cli/plugins.py",
        "line": 1824,
        "symbol": "discover_plugins"
      }
    ]
  },
  {
    "id": "resource-builtin-discovery",
    "label": "discover_builtin_tools",
    "kind": "component",
    "groupId": "resources",
    "summary": "Scans self-registering built-in modules with cached AST verdicts and imports eligible modules. This discovery runs at model_tools import; import failures are logged.",
    "source": [
      {
        "file": "tools/registry.py",
        "line": 96,
        "symbol": "discover_builtin_tools"
      }
    ]
  },
  {
    "id": "resource-mcp-readiness",
    "label": "MCP discovery readiness",
    "kind": "component",
    "groupId": "resources",
    "summary": "CLI starts configured MCP discovery if needed and gives registration a bounded wait before agent construction. Timeout is not a guarantee that every server registered.",
    "source": [
      {
        "file": "hermes_cli/mcp_startup.py",
        "line": 303,
        "symbol": "ensure_mcp_discovery_before_agent_build"
      }
    ]
  },
  {
    "id": "resource-tool-selection",
    "label": "_select_tool_names",
    "kind": "component",
    "groupId": "resources",
    "summary": "Expands enabled/composite toolsets, applies profile-role exclusions and subtracts disabled toolsets last. Selection precedes per-tool requirement checks.",
    "source": [
      {
        "file": "model_tools.py",
        "line": 315,
        "symbol": "_select_tool_names"
      }
    ]
  },
  {
    "id": "resource-schema-registry",
    "label": "ToolRegistry.get_definitions",
    "kind": "component",
    "groupId": "resources",
    "summary": "Reads registered entries, filters failed requirement probes and applies tool-owned dynamic schema overrides. Registration alone does not establish availability.",
    "source": [
      {
        "file": "tools/registry.py",
        "line": 843,
        "symbol": "ToolRegistry.get_definitions"
      }
    ]
  },
  {
    "id": "resource-schema-assembly",
    "label": "_compute_tool_definitions",
    "kind": "component",
    "groupId": "resources",
    "summary": "Applies dynamic cross-tool schema rewrites, sanitizes schema shapes and optionally defers large MCP/plugin surfaces behind tool search. Quiet-mode callers can reuse a bounded definitions cache.",
    "source": [
      {
        "file": "model_tools.py",
        "line": 506,
        "symbol": "_compute_tool_definitions"
      }
    ]
  },
  {
    "id": "resource-prompt-tiers",
    "label": "build_system_prompt_parts",
    "kind": "component",
    "groupId": "resources",
    "summary": "Assembles stable, context and volatile prompt tiers; the term volatile describes cache placement, not automatic per-turn rebuilding. Ephemeral prompt remains injected at request time.",
    "source": [
      {
        "file": "agent/system_prompt.py",
        "line": 734,
        "symbol": "build_system_prompt_parts"
      }
    ]
  },
  {
    "id": "resource-identity",
    "label": "SOUL / default identity",
    "kind": "component",
    "groupId": "resources",
    "summary": "Loads the agent-home SOUL identity when eligible, otherwise uses the default identity. Cron may keep identity while skipping project context.",
    "source": [
      {
        "file": "agent/system_prompt.py",
        "line": 544,
        "symbol": "_identity_parts"
      }
    ]
  },
  {
    "id": "resource-project-rules",
    "label": "build_context_files_prompt",
    "kind": "component",
    "groupId": "resources",
    "summary": "Selects the first nonempty project instruction family: Hermes files, AGENTS chain, CLAUDE, then Cursor rules. Caps and scans loaded text; profile SOUL is independent.",
    "source": [
      {
        "file": "agent/prompt_builder.py",
        "line": 1830,
        "symbol": "build_context_files_prompt"
      }
    ]
  },
  {
    "id": "resource-skills-index",
    "label": "build_skills_system_prompt",
    "kind": "component",
    "groupId": "resources",
    "summary": "Builds an available-skill index from scoped home, external and trusted project directories, with visibility gates and collision precedence. The index does not load every skill body.",
    "source": [
      {
        "file": "agent/prompt_builder.py",
        "line": 1359,
        "symbol": "build_skills_system_prompt"
      }
    ]
  },
  {
    "id": "resource-pinned-skills",
    "label": "skills.auto_load blocks",
    "kind": "component",
    "groupId": "resources",
    "summary": "Resolves configured pinned skill text once per agent lifecycle. Requires skill tool availability and eligible context-file policy; missing skills/errors are skipped.",
    "source": [
      {
        "file": "agent/system_prompt.py",
        "line": 317,
        "symbol": "_auto_load_parts"
      }
    ]
  },
  {
    "id": "resource-environment-hints",
    "label": "build_environment_hints",
    "kind": "component",
    "groupId": "resources",
    "summary": "Describes local host context for local tools or backend-owned state for remote tools, with embedder/WSL hints. Producing hints is separate from lazy execution-environment creation.",
    "source": [
      {
        "file": "agent/prompt_builder.py",
        "line": 1143,
        "symbol": "build_environment_hints"
      }
    ]
  },
  {
    "id": "session-store-open",
    "label": "_init_session_store",
    "kind": "component",
    "groupId": "sessions",
    "summary": "Acquires the shared SQLite registry handle early and runs opportunistic state/checkpoint maintenance. Store-open failure visibly disables transcript persistence for the run.",
    "source": [
      {
        "file": "hermes_cli/cli_init_mixin.py",
        "line": 322,
        "symbol": "_init_session_store"
      }
    ]
  },
  {
    "id": "session-resume-load",
    "label": "Resume history projections",
    "kind": "component",
    "groupId": "sessions",
    "summary": "Startup preload follows compressed continuation, enforces safe resume limits and loads model/display history projections. A late path handles agent construction without preload.",
    "source": [
      {
        "file": "hermes_cli/cli_agent_setup_mixin.py",
        "line": 774,
        "symbol": "_preload_resumed_session"
      }
    ]
  },
  {
    "id": "session-restore-metadata",
    "label": "_restore_session_state",
    "kind": "component",
    "groupId": "sessions",
    "summary": "Restores session cwd, approval-bypass state and model settings with launch-override rules; this restores session metadata rather than resuming an interrupted provider call.",
    "source": [
      {
        "file": "hermes_cli/cli_agent_setup_mixin.py",
        "line": 553,
        "symbol": "_restore_session_state"
      }
    ]
  },
  {
    "id": "session-switch",
    "label": "/resume \u00b7 switch active session",
    "kind": "component",
    "groupId": "sessions",
    "summary": "Resolves another session, ends the previous session, loads replay/display projections, reopens the target and retargets agent plus cwd/model/approval state.",
    "source": [
      {
        "file": "hermes_cli/cli_commands_mixin.py",
        "line": 1269,
        "symbol": "_handle_resume_command"
      }
    ]
  },
  {
    "id": "session-new",
    "label": "new_session",
    "kind": "component",
    "groupId": "sessions",
    "summary": "Best-effort flushes/ends the old session, rotates identity, clears history and session overrides, resets agent state, and sequences old-memory extraction before the provider session switch.",
    "source": [
      {
        "file": "hermes_cli/cli_session_mixin.py",
        "line": 495,
        "symbol": "new_session"
      }
    ]
  },
  {
    "id": "session-branch",
    "label": "/branch \u00b7 copy session",
    "kind": "component",
    "groupId": "sessions",
    "summary": "Refuses branching during an active run, creates a child before ending the parent and carries the exact prompt plus best-effort chunked transcript copy. A failed copy can leave a partial but usable branch.",
    "source": [
      {
        "file": "hermes_cli/cli_commands_mixin.py",
        "line": 1373,
        "symbol": "_handle_branch_command"
      }
    ]
  },
  {
    "id": "session-reset",
    "label": "reset_session_state",
    "kind": "component",
    "groupId": "sessions",
    "summary": "Resets usage/cost anchors and per-session workspace snapshot, transitions the context-engine lifecycle and rebinds its session-keyed state. It does not rebuild every tool or client.",
    "source": [
      {
        "file": "run_agent.py",
        "line": 413,
        "symbol": "AIAgent.reset_session_state"
      }
    ]
  },
  {
    "id": "session-rewind",
    "label": "/undo and /retry \u00b7 history rewind",
    "kind": "component",
    "groupId": "sessions",
    "summary": "Durable rewind succeeds before publishing shortened in-memory history when a store is bound. Undo invalidates the prompt and notifies memory; retry rejects unsafe non-text replay.",
    "source": [
      {
        "file": "hermes_cli/cli_session_mixin.py",
        "line": 703,
        "symbol": "_publish_truncated_history"
      }
    ]
  },
  {
    "id": "session-close",
    "label": "Persist before close",
    "kind": "component",
    "groupId": "sessions",
    "summary": "Attempts to flush live agent messages and pending CLI input before closing the session, sharing the staging/persistence lock. This cleanup is best effort, not guaranteed recovery after every crash.",
    "source": [
      {
        "file": "hermes_cli/cli_session_mixin.py",
        "line": 1049,
        "symbol": "_persist_active_session_before_close"
      }
    ]
  },
  {
    "id": "rt-attempt-request",
    "label": "build_api_request \u00b7 attempt payload",
    "kind": "component",
    "groupId": "rt-provider",
    "summary": "Reapplies current-provider reasoning/cache policy, strips rejected image input from the request copy, builds protocol kwargs and sanitizes outbound strings. Does not remove images from canonical history.",
    "source": [
      {
        "file": "agent/turn_api_request.py",
        "line": 93,
        "symbol": "build_api_request"
      }
    ]
  },
  {
    "id": "rt-request-middleware",
    "label": "LLM request middleware + pre-request hook",
    "kind": "component",
    "groupId": "rt-provider",
    "summary": "Request middleware can transform kwargs before pre_api_request observes the payload. MoA private prepared-request handshake is attached afterward only for a compatible live client.",
    "source": [
      {
        "file": "agent/turn_api_request.py",
        "line": 145,
        "symbol": "apply_llm_request_middleware"
      }
    ]
  },
  {
    "id": "rt-stream-choice",
    "label": "_should_stream",
    "kind": "decision",
    "groupId": "rt-provider",
    "summary": "Normally prefers streaming even with no display consumer for health checks; configured disablement, external-process/ACP routes and MoA without consumers select nonstream execution.",
    "source": [
      {
        "file": "agent/turn_api_call.py",
        "line": 47,
        "symbol": "_should_stream"
      }
    ]
  },
  {
    "id": "rt-execution-middleware",
    "label": "run_llm_execution_middleware",
    "kind": "component",
    "groupId": "rt-provider",
    "summary": "Wraps the transport callback and brackets model-request activity under the redirect lock. A response crossed by redirect is discarded and requests an outer-loop rebuild.",
    "source": [
      {
        "file": "agent/turn_api_call.py",
        "line": 133,
        "symbol": "run_llm_execution_middleware"
      }
    ]
  },
  {
    "id": "rt-stream-worker",
    "label": "_StreamingCall \u00b7 stream attempts",
    "kind": "component",
    "groupId": "rt-provider",
    "summary": "Owns stream attempt identity, protocol dispatch and connection cleanup. Includes a local transient retry budget and a separate stream_options compatibility retry before errors reach outer recovery. Child/cron direct-call mode runs transport inline while a separate monitor thread watches it.",
    "source": [
      {
        "file": "agent/chat_completion_helpers.py",
        "line": 3851,
        "symbol": "_StreamingCall._call"
      }
    ]
  },
  {
    "id": "rt-stream-monitor",
    "label": "StreamingWaitMonitor",
    "kind": "component",
    "groupId": "rt-provider",
    "summary": "A monitor watches chunk progress, emits activity and wait notices, kills stale attempts and aborts on interruption. It runs alongside the stream worker rather than after generation.",
    "source": [
      {
        "file": "agent/chat_completion_stream_monitor.py",
        "line": 59,
        "symbol": "StreamingWaitMonitor._monitor_loop"
      }
    ]
  },
  {
    "id": "rt-stream-error",
    "label": "_handle_stream_error \u00b7 delivery boundary",
    "kind": "decision",
    "groupId": "rt-provider",
    "summary": "Normally declines retry after visible partial delivery to avoid duplicated text. Eligible transient failures mid tool-call may reconnect before any tool execution; undelivered failures can retry and exhausted errors go to outer recovery.",
    "source": [
      {
        "file": "agent/chat_completion_helpers.py",
        "line": 3683,
        "symbol": "_StreamingCall._handle_stream_error"
      }
    ]
  },
  {
    "id": "rt-nonstream-worker",
    "label": "_NonStreamRequest",
    "kind": "component",
    "groupId": "rt-provider",
    "summary": "Owns nonstream client call, worker wait, timeout/watchdog and interruption handling. This path has no provider-delta display stream.",
    "source": [
      {
        "file": "agent/chat_completion_nonstream.py",
        "line": 7,
        "symbol": "_NonStreamRequest"
      }
    ]
  },
  {
    "id": "rt-error-classifier",
    "label": "classify_api_error + recovery routing",
    "kind": "decision",
    "groupId": "rt-provider",
    "summary": "Outer recovery first attempts request-specific repairs, then classifies errors, tries credential/format recovery, routes classified failures and overflow, and settles remaining retry or terminal outcomes.",
    "source": [
      {
        "file": "agent/turn_api_error.py",
        "line": 52,
        "symbol": "handle_api_error"
      }
    ]
  },
  {
    "id": "rt-credential-recovery",
    "label": "recover_after_classification",
    "kind": "component",
    "groupId": "rt-provider",
    "summary": "Eligible authentication, credential pool and response-format repairs can recover the current attempt. This is a conditional recovery branch, not a credential rotation on every retry.",
    "source": [
      {
        "file": "agent/turn_recovery.py",
        "line": 641,
        "symbol": "recover_after_classification"
      }
    ]
  },
  {
    "id": "rt-backoff",
    "label": "interruptible_backoff_sleep",
    "kind": "state",
    "groupId": "rt-provider",
    "summary": "Waits between eligible outer retries with interruption checks; cancellation can stop recovery rather than waiting through the entire backoff.",
    "source": [
      {
        "file": "agent/turn_recovery.py",
        "line": 1361,
        "symbol": "interruptible_backoff_sleep"
      }
    ]
  },
  {
    "id": "tool-plan",
    "label": "_plan_tool_batch_segments",
    "kind": "decision",
    "groupId": "tool-dispatch",
    "summary": "Reserves path scopes for parallel-safe calls, closes runs on overlapping writers or unsafe calls, and emits ordered parallel/sequential segments. Single-call runs demote to sequential.",
    "source": [
      {
        "file": "agent/tool_dispatch_helpers.py",
        "line": 198,
        "symbol": "_plan_tool_batch_segments"
      }
    ]
  },
  {
    "id": "tool-segments",
    "label": "execute_tool_calls_segmented",
    "kind": "component",
    "groupId": "tool-dispatch",
    "summary": "Runs segments in emission order with sequential barriers; result persistence failure stops later work. Individual segments skip finalization and the owner finalizes the complete batch once.",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 1898,
        "symbol": "execute_tool_calls_segmented"
      }
    ]
  },
  {
    "id": "tool-parse",
    "label": "_parse_tool_call",
    "kind": "decision",
    "groupId": "tool-dispatch",
    "summary": "Parses arguments, unwraps scoped Tool Search calls and records parse/scope errors before dispatch. An invalid call can produce synthetic feedback rather than a real tool invocation.",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 457,
        "symbol": "_parse_tool_call"
      }
    ]
  },
  {
    "id": "tool-middleware",
    "label": "Relay + tool execution middleware",
    "kind": "component",
    "groupId": "tool-dispatch",
    "summary": "Relay and request middleware may rewrite arguments before Hermes policy; execution middleware surrounds one authorized callback. The callback rejects repeated invocation within this execution.",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 753,
        "symbol": "_run_agent_tool_execution_middleware"
      }
    ]
  },
  {
    "id": "tool-policy",
    "label": "_dispatch_authorized_once",
    "kind": "decision",
    "groupId": "tool-dispatch",
    "summary": "Applies scope blocks, plugin pre-hooks, pruned-argument checks and before_call guardrails in that order before dispatch. Blocks generate feedback without executing the tool.",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 684,
        "symbol": "_dispatch_authorized_once"
      }
    ]
  },
  {
    "id": "tool-concurrent",
    "label": "_ConcurrentBatch \u00b7 daemon workers",
    "kind": "component",
    "groupId": "tool-dispatch",
    "summary": "Dispatches runnable slots on daemon workers with a start-order gate, serialized authorization waits and bounded interrupt-aware completion wait. Finishing workers may complete out of order.",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 1300,
        "symbol": "_ConcurrentBatch"
      }
    ]
  },
  {
    "id": "tool-sequential",
    "label": "Sequential worker / interactive inline",
    "kind": "component",
    "groupId": "tool-dispatch",
    "summary": "Ordinary sequential tools use an interrupt-polled worker deadline, excluding human approval wait. Never-parallel interactive tools run inline and own their own wait behavior.",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 893,
        "symbol": "_run_sequential_tool_execution_middleware"
      }
    ]
  },
  {
    "id": "tool-abandon",
    "label": "Timeout / interrupt abandonment",
    "kind": "state",
    "groupId": "tool-dispatch",
    "summary": "Cancels unstarted futures and signals tracked workers; non-cooperative running tools may outlive the wait. Synthetic timeout/cancel feedback does not prove that external effects were rolled back.",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 1414,
        "symbol": "_ConcurrentBatch.await_completion"
      }
    ]
  },
  {
    "id": "tool-inline-route",
    "label": "resolve_invoke_tool_executor",
    "kind": "decision",
    "groupId": "tool-dispatch",
    "summary": "Concurrent invocation resolves agent-owned inline tools first, then configured memory-provider tools, then remaining inline tools. Otherwise invocation falls through to the registry. Sequential dispatch retains its own inline handling.",
    "source": [
      {
        "file": "agent/inline_tool_executors.py",
        "line": 299,
        "symbol": "resolve_invoke_tool_executor"
      }
    ]
  },
  {
    "id": "tool-registry",
    "label": "model_tools.handle_function_call",
    "kind": "component",
    "groupId": "tool-dispatch",
    "summary": "Handles bridge catalog calls, connector routing, registry guards, hooks and implementation dispatch. Agent-loop tools must be handled by the agent owner rather than this registry.",
    "source": [
      {
        "file": "model_tools.py",
        "line": 876,
        "symbol": "handle_function_call"
      }
    ]
  },
  {
    "id": "tool-ordered-results",
    "label": "_append_batch_results",
    "kind": "state",
    "groupId": "tool-dispatch",
    "summary": "After concurrent wait, appends outcomes in original call order; prefers a real just-finished result over a synthetic timeout. Stops at the first failed transcript flush.",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 1515,
        "symbol": "_append_batch_results"
      }
    ]
  },
  {
    "id": "tool-result-shape",
    "label": "_commit_tool_result \u00b7 spill and presentation",
    "kind": "component",
    "groupId": "tool-dispatch",
    "summary": "Bounds/spills large text or multimodal text, adds file hints and model-compatible feedback. Completion projection follows append plus successful optional-store flush; this boundary does not deduplicate external effects.",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 1054,
        "symbol": "_commit_tool_result"
      }
    ]
  },
  {
    "id": "memory-provider-recall",
    "label": "_prefetch_provider \u00b7 bounded recall",
    "kind": "component",
    "groupId": "memory-provider",
    "summary": "Built-in recall is direct. External recall runs on a daemon thread with timeout; a still-running provider is skipped on later turns until it returns. Oversized returned context can spill.",
    "source": [
      {
        "file": "agent/memory_manager.py",
        "line": 457,
        "symbol": "_prefetch_provider"
      }
    ]
  },
  {
    "id": "memory-write-worker",
    "label": "_submit_background \u00b7 serialized writes",
    "kind": "component",
    "groupId": "memory-provider",
    "summary": "Creates a single daemon worker lazily, preserves caller context and tracks queued writes/reads. If worker allocation/submission fails outside shutdown, it can fall back inline; late shutdown work is rejected.",
    "source": [
      {
        "file": "agent/memory_manager.py",
        "line": 559,
        "symbol": "_submit_background"
      }
    ]
  },
  {
    "id": "memory-checkpoint",
    "label": "on_pre_compress \u00b7 checkpoint contract",
    "kind": "decision",
    "groupId": "memory-provider",
    "summary": "Supplies provider memory context and normalized evidence to eligible checkpoint versions. When checkpoint is required, provider failure or no successful supported provider aborts compression rather than silently proceeding.",
    "source": [
      {
        "file": "agent/memory_manager.py",
        "line": 731,
        "symbol": "on_pre_compress"
      }
    ]
  },
  {
    "id": "compact-timeout",
    "label": "_run_under_progress_timeout \u00b7 snapshot worker",
    "kind": "component",
    "groupId": "compact-pipeline",
    "summary": "Pooled compression uses a deep transcript snapshot, progress-aware timeout and a commit fence; a detached timed-out worker must not rewrite the caller live list.",
    "source": [
      {
        "file": "agent/compression_facade.py",
        "line": 123,
        "symbol": "_run_under_progress_timeout"
      }
    ]
  },
  {
    "id": "compact-prune",
    "label": "_prune_old_tool_results",
    "kind": "component",
    "groupId": "compact-pipeline",
    "summary": "Cheap first stage demotes eligible old tool result bodies on a copy while preserving tool-call arguments and protected regions; canonical unpruned history remains available for abort/no-op.",
    "source": [
      {
        "file": "agent/context_compressor.py",
        "line": 3336,
        "symbol": "_prune_old_tool_results"
      }
    ]
  },
  {
    "id": "compact-window",
    "label": "_compress_window \u00b7 protected head/tail",
    "kind": "decision",
    "groupId": "compact-pipeline",
    "summary": "Chooses a middle window after pruning, retaining protected head and token-budget tail. Empty/insufficient windows return without a summary request; handoff scan avoids resummarizing excluded handoff rows.",
    "source": [
      {
        "file": "agent/context_compressor.py",
        "line": 5294,
        "symbol": "_compress_window"
      }
    ]
  },
  {
    "id": "compact-aux-summary",
    "label": "_call_summary_llm \u00b7 auxiliary route",
    "kind": "component",
    "groupId": "compact-pipeline",
    "summary": "Auxiliary compression route generates structured summary under interrupt protection. Empty, refusal or length-truncated content is rejected; failure handling can retry a main route, abort or use bounded deterministic fallback according to caller conditions.",
    "source": [
      {
        "file": "agent/context_compressor.py",
        "line": 3949,
        "symbol": "_call_summary_llm"
      }
    ]
  },
  {
    "id": "compact-assemble",
    "label": "_assemble_compressed / _finalize_compressed",
    "kind": "component",
    "groupId": "compact-pipeline",
    "summary": "Assembles head, summary and tail; repairs orphan tool pairs, replays eligible in-flight user task, strips stale media/reasoning and persistence markers. Returns a candidate; durable host commit still requires its separate fence.",
    "source": [
      {
        "file": "agent/context_compressor.py",
        "line": 5668,
        "symbol": "_assemble_compressed"
      }
    ]
  }
];
export const expansionEdges: readonly ArchitectureEdge[] = [
  {
    "from": "turn-facade",
    "to": "lease-admit",
    "kind": "call",
    "label": "eligible store: acquire before runtime",
    "source": [
      {
        "file": "agent/turn_facade.py",
        "line": 82,
        "symbol": "admit_durable_turn_lease"
      }
    ],
    "id": "turn-facade:lease-admit:call"
  },
  {
    "from": "lease-admit",
    "to": "session-db",
    "kind": "call",
    "label": "conditional lease acquisition",
    "source": [
      {
        "file": "agent/turn_facade_lease.py",
        "line": 282,
        "symbol": "acquire_session_turn_lease"
      }
    ],
    "id": "lease-admit:session-db:call"
  },
  {
    "from": "lease-admit",
    "to": "lease-reload",
    "kind": "transition",
    "label": "admitted; reload only after contention",
    "source": [
      {
        "file": "agent/turn_facade_lease.py",
        "line": 295,
        "symbol": "admit_durable_turn_lease"
      }
    ],
    "id": "lease-admit:lease-reload:transition"
  },
  {
    "from": "lease-admit",
    "to": "lease-owner",
    "kind": "data",
    "label": "admitted holder; no lease on bypass",
    "source": [
      {
        "file": "agent/turn_facade_lease.py",
        "line": 333,
        "symbol": "admission.lease"
      }
    ],
    "id": "lease-admit:lease-owner:data"
  },
  {
    "from": "lease-admit",
    "to": "lease-carry",
    "kind": "transition",
    "label": "early interrupted admission result",
    "source": [
      {
        "file": "agent/turn_facade.py",
        "line": 86,
        "symbol": "carry_unadmitted_user_message"
      }
    ],
    "id": "lease-admit:lease-carry:transition"
  },
  {
    "from": "lease-carry",
    "to": "release",
    "kind": "transition",
    "label": "return early through facade finally",
    "source": [
      {
        "file": "agent/turn_facade.py",
        "line": 95,
        "symbol": "run_conversation \u00b7 early return"
      }
    ],
    "id": "lease-carry:release:transition"
  },
  {
    "from": "lease-reload",
    "to": "session-db",
    "kind": "call",
    "label": "resolve resume and read current transcript",
    "source": [
      {
        "file": "agent/turn_facade_lease.py",
        "line": 311,
        "symbol": "resolve_resume_session_id"
      }
    ],
    "id": "lease-reload:session-db:call"
  },
  {
    "from": "turn-facade",
    "to": "lease-owner",
    "kind": "call",
    "label": "start only when a lease was admitted",
    "source": [
      {
        "file": "agent/turn_facade.py",
        "line": 145,
        "symbol": "lease.start"
      }
    ],
    "id": "turn-facade:lease-owner:call"
  },
  {
    "from": "turn-facade",
    "to": "lease-scopes",
    "kind": "call",
    "label": "prepare relay and accounting ownership",
    "source": [
      {
        "file": "agent/turn_facade.py",
        "line": 105,
        "symbol": "acquire_conversation"
      }
    ],
    "id": "turn-facade:lease-scopes:call"
  },
  {
    "from": "lease-owner",
    "to": "lease-timers",
    "kind": "call",
    "label": "schedule refresh and optional watchdog",
    "source": [
      {
        "file": "agent/turn_facade_lease.py",
        "line": 81,
        "symbol": "start \u00b7 schedule"
      }
    ],
    "id": "lease-owner:lease-timers:call"
  },
  {
    "from": "lease-timers",
    "to": "lease-renew",
    "kind": "background",
    "label": "periodic renewal callback",
    "source": [
      {
        "file": "agent/turn_facade_lease.py",
        "line": 81,
        "symbol": "schedule refresh_tick"
      }
    ],
    "id": "lease-timers:lease-renew:background"
  },
  {
    "from": "lease-timers",
    "to": "lease-watchdog",
    "kind": "background",
    "label": "configured progress polling",
    "source": [
      {
        "file": "agent/turn_liveness.py",
        "line": 116,
        "symbol": "schedule"
      }
    ],
    "id": "lease-timers:lease-watchdog:background"
  },
  {
    "from": "lease-renew",
    "to": "session-db",
    "kind": "call",
    "label": "refresh admitted holder TTL",
    "source": [
      {
        "file": "agent/turn_facade_lease.py",
        "line": 194,
        "symbol": "refresh_session_turn_lease"
      }
    ],
    "id": "lease-renew:session-db:call"
  },
  {
    "from": "lease-watchdog",
    "to": "lease-owner",
    "kind": "call",
    "label": "revalidate generation and deactivate on committed abort",
    "source": [
      {
        "file": "agent/turn_liveness.py",
        "line": 138,
        "symbol": "_commit_abort / _deactivate_turn"
      }
    ],
    "id": "lease-watchdog:lease-owner:call"
  },
  {
    "from": "release",
    "to": "lease-cleanup",
    "kind": "call",
    "label": "when facade owns an admitted lease",
    "source": [
      {
        "file": "agent/turn_facade.py",
        "line": 197,
        "symbol": "lease cleanup"
      }
    ],
    "id": "release:lease-cleanup:call"
  },
  {
    "from": "lease-cleanup",
    "to": "lease-timers",
    "kind": "call",
    "label": "cancel timers; bounded wait",
    "source": [
      {
        "file": "agent/turn_facade_lease.py",
        "line": 96,
        "symbol": "join_threads"
      }
    ],
    "id": "lease-cleanup:lease-timers:call"
  },
  {
    "from": "lease-cleanup",
    "to": "session-db",
    "kind": "call",
    "label": "release original admitted row and holder",
    "source": [
      {
        "file": "agent/turn_facade_lease.py",
        "line": 102,
        "symbol": "release"
      }
    ],
    "id": "lease-cleanup:session-db:call"
  },
  {
    "from": "tool-environment",
    "to": "env-terminal",
    "kind": "data",
    "label": "terminal implementation is one configured environment consumer",
    "source": [
      {
        "file": "tools/terminal_tool.py",
        "line": 1383,
        "symbol": "terminal_tool"
      }
    ],
    "id": "tool-environment:env-terminal:data"
  },
  {
    "from": "env-terminal",
    "to": "env-acquire",
    "kind": "call",
    "label": "plan first, then acquire on tool invocation",
    "source": [
      {
        "file": "tools/terminal_tool.py",
        "line": 1410,
        "symbol": "_acquire_env"
      }
    ],
    "id": "env-terminal:env-acquire:call"
  },
  {
    "from": "env-acquire",
    "to": "tool-environment",
    "kind": "data",
    "label": "cached or newly created configured backend",
    "source": [
      {
        "file": "tools/terminal_tool.py",
        "line": 1211,
        "symbol": "_create_configured_env"
      }
    ],
    "id": "env-acquire:tool-environment:data"
  },
  {
    "from": "gw-runner",
    "to": "gw-startup",
    "kind": "call",
    "label": "start host services",
    "source": [
      {
        "file": "gateway/run_startup.py",
        "line": 1576,
        "symbol": "start"
      }
    ],
    "id": "gw-runner:gw-startup:call"
  },
  {
    "from": "gw-startup",
    "to": "gw-adapters",
    "kind": "call",
    "label": "build, wire and connect configured adapters",
    "source": [
      {
        "file": "gateway/run_startup.py",
        "line": 1161,
        "symbol": "_start_prefilter_platforms"
      }
    ],
    "id": "gw-startup:gw-adapters:call"
  },
  {
    "from": "gw-adapters",
    "to": "gw-ingress",
    "kind": "transition",
    "label": "concrete transport emits normalized MessageEvent",
    "source": [
      {
        "file": "gateway/run_adapters.py",
        "line": 1317,
        "symbol": "_wire_adapter_handlers"
      }
    ],
    "condition": "Platform-specific ingress implementation supplies events; this is registered callback topology.",
    "id": "gw-adapters:gw-ingress:transition"
  },
  {
    "from": "gw-ingress",
    "to": "gw-profile-route",
    "kind": "call",
    "label": "resolve canonical session identity",
    "source": [
      {
        "file": "gateway/platforms/base.py",
        "line": 4060,
        "symbol": "handle_message"
      }
    ],
    "condition": "Multiplex/profile route policy applies.",
    "id": "gw-ingress:gw-profile-route:call"
  },
  {
    "from": "gw-ingress",
    "to": "gw-background-turn",
    "kind": "background",
    "label": "guard before spawn",
    "source": [
      {
        "file": "gateway/platforms/base.py",
        "line": 3950,
        "symbol": "_start_session_processing"
      }
    ],
    "condition": "Session is idle and resolved route is accepted.",
    "id": "gw-ingress:gw-background-turn:background"
  },
  {
    "from": "gw-ingress",
    "to": "gw-command-busy",
    "kind": "transition",
    "label": "active-session command / busy handler",
    "source": [
      {
        "file": "gateway/platforms/base.py",
        "line": 4081,
        "symbol": "_handle_message_while_active"
      }
    ],
    "condition": "Existing adapter task owns the session guard; bypass replies can call handler inline.",
    "id": "gw-ingress:gw-command-busy:transition"
  },
  {
    "from": "gw-background-turn",
    "to": "gw-admit",
    "kind": "call",
    "label": "installed message handler",
    "source": [
      {
        "file": "gateway/platforms/base.py",
        "line": 4581,
        "symbol": "_process_message_background"
      }
    ],
    "id": "gw-background-turn:gw-admit:call"
  },
  {
    "from": "gw-admit",
    "to": "gw-command-busy",
    "kind": "transition",
    "label": "admitted event reaches intercepts",
    "source": [
      {
        "file": "gateway/run_inbound.py",
        "line": 1327,
        "symbol": "_handle_message"
      }
    ],
    "condition": "Admission returns event rather than drop/startup hold.",
    "id": "gw-admit:gw-command-busy:transition"
  },
  {
    "from": "gw-admit",
    "to": "gw-startup",
    "kind": "data",
    "label": "hold external ingress during restoration",
    "source": [
      {
        "file": "gateway/run_inbound.py",
        "line": 253,
        "symbol": "_hm_admit_event"
      }
    ],
    "condition": "Startup restore gate active; internal/replayed events exempt.",
    "id": "gw-admit:gw-startup:data"
  },
  {
    "from": "gw-command-busy",
    "to": "gw-active-claim",
    "kind": "transition",
    "label": "ordinary idle agent turn",
    "source": [
      {
        "file": "gateway/run_inbound.py",
        "line": 1387,
        "symbol": "_handle_message"
      }
    ],
    "condition": "Not declined, command-handled, already busy or externally draining; concurrency slot available.",
    "id": "gw-command-busy:gw-active-claim:transition"
  },
  {
    "from": "gw-active-claim",
    "to": "gw-session-route",
    "kind": "call",
    "label": "resolve route under sentinel guard",
    "source": [
      {
        "file": "gateway/run_turn.py",
        "line": 2155,
        "symbol": "_handle_message_with_agent"
      }
    ],
    "id": "gw-active-claim:gw-session-route:call"
  },
  {
    "from": "gw-session-route",
    "to": "gw-prepare",
    "kind": "data",
    "label": "resolved SessionEntry + session key",
    "source": [
      {
        "file": "gateway/run_turn.py",
        "line": 2159,
        "symbol": "_handle_message_with_agent"
      }
    ],
    "condition": "Session resolution succeeded.",
    "id": "gw-session-route:gw-prepare:data"
  },
  {
    "from": "gw-prepare",
    "to": "gw-turn-lease",
    "kind": "call",
    "label": "lease before transcript read",
    "source": [
      {
        "file": "gateway/run_turn.py",
        "line": 2086,
        "symbol": "_hmwa_prepare_turn"
      }
    ],
    "id": "gw-prepare:gw-turn-lease:call"
  },
  {
    "from": "gw-turn-lease",
    "to": "gw-active-marker",
    "kind": "transition",
    "label": "lease acquired; mark then read history",
    "source": [
      {
        "file": "gateway/run_turn.py",
        "line": 2090,
        "symbol": "_hmwa_prepare_turn"
      }
    ],
    "condition": "Lease timeout returns resend notice rather than proceeding.",
    "id": "gw-turn-lease:gw-active-marker:transition"
  },
  {
    "from": "gw-active-marker",
    "to": "gw-prepare",
    "kind": "transition",
    "label": "marker attempt then transcript / hygiene",
    "source": [
      {
        "file": "gateway/run_turn.py",
        "line": 2094,
        "symbol": "_hmwa_prepare_turn"
      }
    ],
    "condition": "Marker failure is logged; source does not abort solely for failed marker write.",
    "id": "gw-active-marker:gw-prepare:transition"
  },
  {
    "from": "gw-prepare",
    "to": "gw-turn-worker",
    "kind": "call",
    "label": "prepared turn enters _run_agent",
    "source": [
      {
        "file": "gateway/run_turn.py",
        "line": 2200,
        "symbol": "_handle_message_with_agent"
      }
    ],
    "condition": "History readable, inbound text accepted, heartbeat ownership current.",
    "id": "gw-prepare:gw-turn-worker:call"
  },
  {
    "from": "gw-turn-worker",
    "to": "gw-run-sync",
    "kind": "background",
    "label": "executor worker runs blocking turn",
    "source": [
      {
        "file": "gateway/run_turn.py",
        "line": 4345,
        "symbol": "_run_agent_inner"
      }
    ],
    "id": "gw-turn-worker:gw-run-sync:background"
  },
  {
    "from": "gw-turn-worker",
    "to": "gw-stream",
    "kind": "background",
    "label": "spawn streaming / tracking / interrupt tasks",
    "source": [
      {
        "file": "gateway/run_turn.py",
        "line": 4333,
        "symbol": "_run_agent_inner"
      }
    ],
    "id": "gw-turn-worker:gw-stream:background"
  },
  {
    "from": "gw-run-sync",
    "to": "gw-agent-cache",
    "kind": "call",
    "label": "reuse-compatible agent or fresh construction",
    "source": [
      {
        "file": "gateway/run_turn_runner.py",
        "line": 1940,
        "symbol": "run_sync"
      }
    ],
    "id": "gw-run-sync:gw-agent-cache:call"
  },
  {
    "from": "gw-agent-cache",
    "to": "init-agent",
    "kind": "transition",
    "label": "fresh AIAgent initializes shared agent components",
    "source": [
      {
        "file": "gateway/run_turn_runner.py",
        "line": 1109,
        "symbol": "_build_fresh_agent"
      }
    ],
    "condition": "Cache miss/incompatible agent; bridge denotes common initialization, not CLI _init_agent call.",
    "id": "gw-agent-cache:init-agent:transition"
  },
  {
    "from": "gw-run-sync",
    "to": "turn-facade",
    "kind": "call",
    "label": "agent.run_conversation",
    "source": [
      {
        "file": "gateway/run_turn_runner.py",
        "line": 1724,
        "symbol": "_run_conversation_with_approval"
      }
    ],
    "id": "gw-run-sync:turn-facade:call"
  },
  {
    "from": "gw-run-sync",
    "to": "gw-response",
    "kind": "data",
    "label": "result reaches response shaping",
    "source": [
      {
        "file": "gateway/run_turn.py",
        "line": 2232,
        "symbol": "_handle_message_with_agent"
      }
    ],
    "condition": "Executor result remains generation-owned; stale results are discarded before shaping.",
    "id": "gw-run-sync:gw-response:data"
  },
  {
    "from": "gw-transcript",
    "to": "session-db",
    "kind": "data",
    "label": "append/reconcile only when needed",
    "source": [
      {
        "file": "gateway/run_turn.py",
        "line": 1834,
        "symbol": "_hmwa_persist_turn_transcript"
      }
    ],
    "condition": "agent_persisted and error/overflow branches govern DB writes; SessionStore also maintains transcript representation.",
    "id": "gw-transcript:session-db:data"
  },
  {
    "from": "gw-response",
    "to": "gw-transcript",
    "kind": "transition",
    "label": "shaped response then transcript reconciliation",
    "source": [
      {
        "file": "gateway/run_turn.py",
        "line": 2255,
        "symbol": "_handle_message_with_agent"
      }
    ],
    "condition": "Orchestrator ordering: shaping, post-turn hooks and failure classification precede persistence, then delivery decision.",
    "id": "gw-response:gw-transcript:transition"
  },
  {
    "from": "gw-stream",
    "to": "gw-response",
    "kind": "data",
    "label": "confirmed streamed final affects outer send",
    "source": [
      {
        "file": "gateway/run_turn.py",
        "line": 4046,
        "symbol": "_run_agent_mark_streamed_delivery"
      }
    ],
    "condition": "Supported stream consumer confirms final delivery; preview alone is insufficient.",
    "id": "gw-stream:gw-response:data"
  },
  {
    "from": "gw-transcript",
    "to": "gw-final-ledger",
    "kind": "transition",
    "label": "persisted/reconciled turn then remaining final text",
    "source": [
      {
        "file": "gateway/run_turn.py",
        "line": 2261,
        "symbol": "_hmwa_deliver_turn_response"
      },
      {
        "file": "gateway/platforms/base.py",
        "line": 4411,
        "symbol": "_send_final_text"
      }
    ],
    "condition": "Nonempty final text remains and was not already delivered/suppressed; TTS/media differ.",
    "id": "gw-transcript:gw-final-ledger:transition"
  },
  {
    "from": "gw-final-ledger",
    "to": "gw-send",
    "kind": "call",
    "label": "obligation recorded before send retry",
    "source": [
      {
        "file": "gateway/platforms/base.py",
        "line": 4397,
        "symbol": "send_final_ledgered"
      }
    ],
    "id": "gw-final-ledger:gw-send:call"
  },
  {
    "from": "gw-send",
    "to": "gw-cleanup",
    "kind": "transition",
    "label": "SendResult or error; finally reconciles guard",
    "source": [
      {
        "file": "gateway/platforms/base.py",
        "line": 4666,
        "symbol": "_process_message_background"
      }
    ],
    "condition": "Cleanup runs on success, cancellation and exceptions; process kill can bypass it.",
    "id": "gw-send:gw-cleanup:transition"
  },
  {
    "from": "gw-cleanup",
    "to": "gw-ingress",
    "kind": "background",
    "label": "drain pending input as new processing task",
    "source": [
      {
        "file": "gateway/platforms/base.py",
        "line": 4651,
        "symbol": "_process_message_background"
      }
    ],
    "condition": "Pending input exists; drain task becomes guard owner.",
    "id": "gw-cleanup:gw-ingress:background"
  },
  {
    "from": "gw-startup",
    "to": "gw-restore",
    "kind": "call",
    "label": "restore obligations then eligible session resumes",
    "source": [
      {
        "file": "gateway/run_startup.py",
        "line": 1504,
        "symbol": "_start_finish_wiring"
      }
    ],
    "id": "gw-startup:gw-restore:call"
  },
  {
    "from": "gw-restore",
    "to": "gw-send",
    "kind": "transition",
    "label": "claim and resend stored obligation",
    "source": [
      {
        "file": "gateway/run_startup.py",
        "line": 422,
        "symbol": "_redeliver_claimed_obligations"
      }
    ],
    "condition": "Available routed adapter and eligible obligation; separate helper path from live _send_with_retry.",
    "id": "gw-restore:gw-send:transition"
  },
  {
    "from": "gw-restore",
    "to": "gw-ingress",
    "kind": "background",
    "label": "resume / release held inbound",
    "source": [
      {
        "file": "gateway/run_startup.py",
        "line": 575,
        "symbol": "_schedule_resume_pending_sessions"
      }
    ],
    "condition": "Eligible authorized resume candidate or held inbound; bounded restoration may defer incomplete work.",
    "id": "gw-restore:gw-ingress:background"
  },
  {
    "from": "gw-startup",
    "to": "gw-async-watch",
    "kind": "background",
    "label": "supervised idle completion consumer",
    "source": [
      {
        "file": "gateway/run_startup.py",
        "line": 1535,
        "symbol": "_start_spawn_background_watchers"
      }
    ],
    "id": "gw-startup:gw-async-watch:background"
  },
  {
    "from": "async-completion",
    "to": "gw-async-watch",
    "kind": "data",
    "label": "queued detached delegation completion",
    "source": [
      {
        "file": "gateway/run_notifications.py",
        "line": 1897,
        "symbol": "_async_delegation_watcher"
      }
    ],
    "condition": "Receipt type async_delegation; source execution itself is not replayed here.",
    "id": "async-completion:gw-async-watch:data"
  },
  {
    "from": "gw-async-watch",
    "to": "gw-completion-wake",
    "kind": "call",
    "label": "route compatible completion batch",
    "source": [
      {
        "file": "gateway/run_notifications.py",
        "line": 1919,
        "symbol": "_async_delegation_watcher"
      }
    ],
    "condition": "Group is deliverable and not deduplicated; refusals are requeued.",
    "id": "gw-async-watch:gw-completion-wake:call"
  },
  {
    "from": "gw-completion-wake",
    "to": "gw-ingress",
    "kind": "transition",
    "label": "internal event admitted through wake helper",
    "source": [
      {
        "file": "gateway/run_notifications.py",
        "line": 1340,
        "symbol": "_inject_watch_notification"
      }
    ],
    "condition": "Push-capable adapter; API-server alternate path self-posts instead.",
    "id": "gw-completion-wake:gw-ingress:transition"
  },
  {
    "from": "gw-runner",
    "to": "gw-shutdown",
    "kind": "call",
    "label": "stop host lifecycle",
    "source": [
      {
        "file": "gateway/run_shutdown.py",
        "line": 2266,
        "symbol": "stop"
      }
    ],
    "id": "gw-runner:gw-shutdown:call"
  },
  {
    "from": "gw-shutdown",
    "to": "gw-turn-worker",
    "kind": "call",
    "label": "interrupt / finalize remaining active work",
    "source": [
      {
        "file": "gateway/run_shutdown.py",
        "line": 1941,
        "symbol": "_stop_interrupt_remaining_work"
      }
    ],
    "condition": "Drain deadline leaves active work.",
    "id": "gw-shutdown:gw-turn-worker:call"
  },
  {
    "from": "gw-runner",
    "to": "sched-provider",
    "kind": "background",
    "label": "gateway host starts supervised cron service",
    "source": [
      {
        "file": "gateway/run.py",
        "line": 5694,
        "symbol": "_start_gateway_start_cron_and_housekeeping"
      }
    ],
    "condition": "Host bootstrap wiring, separate from user-message dispatch.",
    "id": "gw-runner:sched-provider:background"
  },
  {
    "from": "sched-provider",
    "to": "sched-tick",
    "kind": "background",
    "label": "built-in provider periodic tick",
    "source": [
      {
        "file": "cron/scheduler_provider.py",
        "line": 438,
        "symbol": "InProcessCronScheduler.start"
      }
    ],
    "condition": "Built-in provider selected; external provider has another trigger path.",
    "id": "sched-provider:sched-tick:background"
  },
  {
    "from": "sched-tick",
    "to": "sched-jobs",
    "kind": "call",
    "label": "get_due_jobs then advance recurring next_run",
    "source": [
      {
        "file": "cron/scheduler_tick.py",
        "line": 63,
        "symbol": "_tick_admitted"
      }
    ],
    "condition": "Retirement/lock/ESTOP/drain gates pass.",
    "id": "sched-tick:sched-jobs:call"
  },
  {
    "from": "sched-tick",
    "to": "sched-submit",
    "kind": "call",
    "label": "submit due jobs to persistent pool",
    "source": [
      {
        "file": "cron/scheduler_tick.py",
        "line": 101,
        "symbol": "_tick_admitted"
      }
    ],
    "condition": "Due jobs available; async tick counts submissions optimistically, not completed successes.",
    "id": "sched-tick:sched-submit:call"
  },
  {
    "from": "sched-submit",
    "to": "sched-fire",
    "kind": "background",
    "label": "worker invokes _process_due_job",
    "source": [
      {
        "file": "cron/scheduler.py",
        "line": 4332,
        "symbol": "_submit_with_guard"
      }
    ],
    "condition": "Execution record created, running guard acquired and pool submission succeeds.",
    "id": "sched-submit:sched-fire:background"
  },
  {
    "from": "sched-fire",
    "to": "sched-job",
    "kind": "call",
    "label": "run_one_job body runs job",
    "source": [
      {
        "file": "cron/scheduler.py",
        "line": 3392,
        "symbol": "_run_one_job_body"
      }
    ],
    "condition": "Durable fire claim owned and external handoff not selected; external worker re-enters shared body under execution ownership.",
    "id": "sched-fire:sched-job:call"
  },
  {
    "from": "sched-fire",
    "to": "sched-external-worker",
    "kind": "transition",
    "label": "optional restart-safe worker dispatch",
    "source": [
      {
        "file": "cron/scheduler.py",
        "line": 2818,
        "symbol": "run_one_job"
      }
    ],
    "condition": "Managed systemd topology selects external worker; outside managed topology the launch helper returns false and execution remains in process.",
    "id": "sched-fire:sched-external-worker:transition"
  },
  {
    "from": "sched-job",
    "to": "init-agent",
    "kind": "transition",
    "label": "construct ephemeral AIAgent",
    "source": [
      {
        "file": "cron/scheduler.py",
        "line": 2491,
        "symbol": "_construct_cron_agent"
      }
    ],
    "condition": "Prompt/preflight/no-agent gates permit agent run; common initialization bridge not CLI call.",
    "id": "sched-job:init-agent:transition"
  },
  {
    "from": "sched-job",
    "to": "sched-watchdog",
    "kind": "call",
    "label": "execute prepared prompt",
    "source": [
      {
        "file": "cron/scheduler.py",
        "line": 2613,
        "symbol": "run_job"
      }
    ],
    "condition": "Agent constructed; watchdog mode timeout 0 disables inactivity limit.",
    "id": "sched-job:sched-watchdog:call"
  },
  {
    "from": "sched-watchdog",
    "to": "turn-facade",
    "kind": "background",
    "label": "worker invokes shared agent.run_conversation",
    "source": [
      {
        "file": "cron/scheduler.py",
        "line": 2015,
        "symbol": "_run_agent_with_watchdog"
      }
    ],
    "id": "sched-watchdog:turn-facade:background"
  },
  {
    "from": "sched-job",
    "to": "sched-delivery",
    "kind": "data",
    "label": "output document + final response + outcome",
    "source": [
      {
        "file": "cron/scheduler.py",
        "line": 3425,
        "symbol": "_run_one_job_body"
      }
    ],
    "condition": "run_job returns; stale fire ownership suppresses side effects.",
    "id": "sched-job:sched-delivery:data"
  },
  {
    "from": "sched-external-worker",
    "to": "sched-delivery",
    "kind": "data",
    "label": "worker result / durable delivery queue",
    "source": [
      {
        "file": "cron/scheduler_delivery.py",
        "line": 1992,
        "symbol": "_deliver_result"
      }
    ],
    "condition": "External execution matches job execution ID and no live adapters; durable queue hands send to gateway.",
    "id": "sched-external-worker:sched-delivery:data"
  },
  {
    "from": "sched-delivery",
    "to": "gw-send",
    "kind": "transition",
    "label": "live adapters or durable gateway queue transport",
    "source": [
      {
        "file": "cron/scheduler_delivery.py",
        "line": 1976,
        "symbol": "_deliver_result"
      }
    ],
    "condition": "Configured target and non-silent notice; cron helpers differ from adapter final-text obligation bracket.",
    "id": "sched-delivery:gw-send:transition"
  },
  {
    "from": "gw-shutdown",
    "to": "sched-provider",
    "kind": "transition",
    "label": "host shutdown signals cron service stop",
    "source": [
      {
        "file": "gateway/run.py",
        "line": 5798,
        "symbol": "_start_gateway_shutdown_tail"
      }
    ],
    "condition": "Host-tail teardown relation; no claim of synchronous cancellation of every cron worker.",
    "id": "gw-shutdown:sched-provider:transition"
  },
  {
    "from": "cfg-cli-config",
    "to": "cfg-model-route",
    "kind": "data",
    "label": "CLI_CONFIG model settings",
    "source": [
      {
        "file": "hermes_cli/cli_init_mixin.py",
        "line": 106,
        "symbol": "_init_model_and_provider"
      }
    ],
    "id": "cfg-cli-config:cfg-model-route:data"
  },
  {
    "from": "cfg-cli-config",
    "to": "cfg-run-controls",
    "kind": "data",
    "label": "budgets / checkpoint / rule settings",
    "source": [
      {
        "file": "hermes_cli/cli_init_mixin.py",
        "line": 98,
        "symbol": "_init_model_routing"
      }
    ],
    "id": "cfg-cli-config:cfg-run-controls:data"
  },
  {
    "from": "cfg-cli-config",
    "to": "cfg-request-policy",
    "kind": "data",
    "label": "prompt and request policy",
    "source": [
      {
        "file": "hermes_cli/cli_init_mixin.py",
        "line": 249,
        "symbol": "_init_prompt_and_reasoning"
      }
    ],
    "id": "cfg-cli-config:cfg-request-policy:data"
  },
  {
    "from": "cfg-model-route",
    "to": "cfg-credential-gate",
    "kind": "data",
    "label": "requested model/provider and explicit credential intent",
    "source": [
      {
        "file": "hermes_cli/cli_agent_setup_mixin.py",
        "line": 232,
        "symbol": "_ensure_runtime_credentials"
      }
    ],
    "id": "cfg-model-route:cfg-credential-gate:data"
  },
  {
    "from": "cli-chat",
    "to": "cfg-credential-gate",
    "kind": "call",
    "label": "credential admission before agent use",
    "source": [
      {
        "file": "hermes_cli/cli_chat_turn_mixin.py",
        "line": 68,
        "symbol": "CLIChatTurnMixin.chat"
      }
    ],
    "id": "cli-chat:cfg-credential-gate:call"
  },
  {
    "from": "cfg-credential-gate",
    "to": "cfg-provider-ladder",
    "kind": "call",
    "label": "resolve primary runtime",
    "source": [
      {
        "file": "hermes_cli/cli_agent_setup_mixin.py",
        "line": 246,
        "symbol": "_ensure_runtime_credentials"
      }
    ],
    "id": "cfg-credential-gate:cfg-provider-ladder:call"
  },
  {
    "from": "cfg-credential-gate",
    "to": "cfg-auth-fallback",
    "kind": "call",
    "label": "resolve configured auth fallback",
    "source": [
      {
        "file": "hermes_cli/cli_agent_setup_mixin.py",
        "line": 252,
        "symbol": "_ensure_runtime_credentials"
      }
    ],
    "condition": "Primary runtime resolution raised; helper proceeds only for AuthError.",
    "id": "cfg-credential-gate:cfg-auth-fallback:call"
  },
  {
    "from": "cfg-auth-fallback",
    "to": "cfg-provider-ladder",
    "kind": "call",
    "label": "try fallback runtime",
    "source": [
      {
        "file": "hermes_cli/cli_agent_setup_mixin.py",
        "line": 389,
        "symbol": "_resolve_fallback_runtime"
      }
    ],
    "id": "cfg-auth-fallback:cfg-provider-ladder:call"
  },
  {
    "from": "cfg-credential-gate",
    "to": "init-agent",
    "kind": "data",
    "label": "resolved runtime; retire previous route when changed",
    "source": [
      {
        "file": "hermes_cli/cli_agent_setup_mixin.py",
        "line": 335,
        "symbol": "_ensure_runtime_credentials"
      }
    ],
    "condition": "Credentials usable; old agent is retired only when credentials/routing/model change.",
    "id": "cfg-credential-gate:init-agent:data"
  },
  {
    "from": "cfg-run-controls",
    "to": "init-agent",
    "kind": "data",
    "label": "run and context policy parameters",
    "source": [
      {
        "file": "hermes_cli/cli_agent_setup_mixin.py",
        "line": 675,
        "symbol": "_init_agent"
      }
    ],
    "id": "cfg-run-controls:init-agent:data"
  },
  {
    "from": "cfg-request-policy",
    "to": "init-agent",
    "kind": "data",
    "label": "ephemeral prompt / reasoning / routing / fallbacks",
    "source": [
      {
        "file": "hermes_cli/cli_agent_setup_mixin.py",
        "line": 680,
        "symbol": "_init_agent"
      }
    ],
    "id": "cfg-request-policy:init-agent:data"
  },
  {
    "from": "client-tools",
    "to": "cfg-client-factory",
    "kind": "call",
    "label": "construct client for wire mode",
    "source": [
      {
        "file": "agent/agent_init.py",
        "line": 2490,
        "symbol": "init_agent"
      }
    ],
    "id": "client-tools:cfg-client-factory:call"
  },
  {
    "from": "init-agent",
    "to": "resource-mcp-readiness",
    "kind": "call",
    "label": "bounded pre-construction discovery readiness",
    "source": [
      {
        "file": "hermes_cli/cli_agent_setup_mixin.py",
        "line": 643,
        "symbol": "_init_agent"
      }
    ],
    "id": "init-agent:resource-mcp-readiness:call"
  },
  {
    "from": "client-tools",
    "to": "resource-plugin-discovery",
    "kind": "call",
    "label": "discover profile plugins before tool snapshot",
    "source": [
      {
        "file": "agent/agent_init.py",
        "line": 1127,
        "symbol": "_load_tools"
      }
    ],
    "id": "client-tools:resource-plugin-discovery:call"
  },
  {
    "from": "resource-builtin-discovery",
    "to": "resource-schema-registry",
    "kind": "data",
    "label": "self-registering module imports",
    "source": [
      {
        "file": "tools/registry.py",
        "line": 137,
        "symbol": "discover_builtin_tools"
      }
    ],
    "id": "resource-builtin-discovery:resource-schema-registry:data"
  },
  {
    "from": "resource-plugin-discovery",
    "to": "resource-schema-registry",
    "kind": "data",
    "label": "loaded plugin registrations",
    "source": [
      {
        "file": "hermes_cli/plugins.py",
        "line": 1828,
        "symbol": "discover_plugins"
      }
    ],
    "id": "resource-plugin-discovery:resource-schema-registry:data"
  },
  {
    "from": "client-tools",
    "to": "resource-schema-assembly",
    "kind": "call",
    "label": "get definitions through cached/uncached pipeline",
    "source": [
      {
        "file": "agent/agent_init.py",
        "line": 1138,
        "symbol": "_load_tools"
      }
    ],
    "id": "client-tools:resource-schema-assembly:call"
  },
  {
    "from": "resource-schema-assembly",
    "to": "resource-tool-selection",
    "kind": "call",
    "label": "select requested tool names",
    "source": [
      {
        "file": "model_tools.py",
        "line": 509,
        "symbol": "_compute_tool_definitions"
      }
    ],
    "id": "resource-schema-assembly:resource-tool-selection:call"
  },
  {
    "from": "resource-schema-assembly",
    "to": "resource-schema-registry",
    "kind": "call",
    "label": "read gated registered definitions",
    "source": [
      {
        "file": "model_tools.py",
        "line": 515,
        "symbol": "_compute_tool_definitions"
      }
    ],
    "id": "resource-schema-assembly:resource-schema-registry:call"
  },
  {
    "from": "resource-schema-assembly",
    "to": "assemble",
    "kind": "data",
    "label": "agent tool definitions available to requests",
    "source": [
      {
        "file": "agent/agent_init.py",
        "line": 1149,
        "symbol": "_load_tools"
      }
    ],
    "id": "resource-schema-assembly:assemble:data"
  },
  {
    "from": "prompt",
    "to": "resource-prompt-tiers",
    "kind": "call",
    "label": "assemble uncached prompt when rebuild is required",
    "source": [
      {
        "file": "agent/system_prompt.py",
        "line": 804,
        "symbol": "build_system_prompt"
      }
    ],
    "id": "prompt:resource-prompt-tiers:call"
  },
  {
    "from": "resource-prompt-tiers",
    "to": "resource-identity",
    "kind": "call",
    "label": "identity tier",
    "source": [
      {
        "file": "agent/system_prompt.py",
        "line": 743,
        "symbol": "build_system_prompt_parts"
      }
    ],
    "id": "resource-prompt-tiers:resource-identity:call"
  },
  {
    "from": "resource-prompt-tiers",
    "to": "resource-pinned-skills",
    "kind": "call",
    "label": "pinned skill blocks",
    "source": [
      {
        "file": "agent/system_prompt.py",
        "line": 759,
        "symbol": "build_system_prompt_parts"
      }
    ],
    "id": "resource-prompt-tiers:resource-pinned-skills:call"
  },
  {
    "from": "resource-prompt-tiers",
    "to": "resource-environment-hints",
    "kind": "call",
    "label": "environment description",
    "source": [
      {
        "file": "agent/system_prompt.py",
        "line": 763,
        "symbol": "build_system_prompt_parts"
      }
    ],
    "id": "resource-prompt-tiers:resource-environment-hints:call"
  },
  {
    "from": "resource-prompt-tiers",
    "to": "resource-project-rules",
    "kind": "call",
    "label": "eligible project context",
    "source": [
      {
        "file": "agent/system_prompt.py",
        "line": 771,
        "symbol": "build_system_prompt_parts"
      }
    ],
    "id": "resource-prompt-tiers:resource-project-rules:call"
  },
  {
    "from": "resource-prompt-tiers",
    "to": "resource-skills-index",
    "kind": "call",
    "label": "eligible skills index through _skills_prompt",
    "source": [
      {
        "file": "agent/system_prompt.py",
        "line": 751,
        "symbol": "build_system_prompt_parts"
      }
    ],
    "condition": "Skills/context policy gates apply.",
    "id": "resource-prompt-tiers:resource-skills-index:call"
  },
  {
    "from": "resource-schema-assembly",
    "to": "resource-skills-index",
    "kind": "data",
    "label": "available tool capabilities gate skill index",
    "source": [
      {
        "file": "agent/system_prompt.py",
        "line": 301,
        "symbol": "_skills_prompt"
      }
    ],
    "id": "resource-schema-assembly:resource-skills-index:data"
  },
  {
    "from": "session-store-open",
    "to": "session-db",
    "kind": "data",
    "label": "shared registry handle or unavailable state",
    "source": [
      {
        "file": "hermes_cli/cli_init_mixin.py",
        "line": 331,
        "symbol": "_init_session_store"
      }
    ],
    "id": "session-store-open:session-db:data"
  },
  {
    "from": "session-store-open",
    "to": "session-resume-load",
    "kind": "data",
    "label": "store permits startup resume",
    "source": [
      {
        "file": "hermes_cli/cli_agent_setup_mixin.py",
        "line": 779,
        "symbol": "_preload_resumed_session"
      }
    ],
    "condition": "Resume requested and store available.",
    "id": "session-store-open:session-resume-load:data"
  },
  {
    "from": "session-resume-load",
    "to": "session-db",
    "kind": "call",
    "label": "read lineage and model/display projections",
    "source": [
      {
        "file": "hermes_cli/cli_agent_setup_mixin.py",
        "line": 796,
        "symbol": "_preload_resumed_session"
      }
    ],
    "id": "session-resume-load:session-db:call"
  },
  {
    "from": "session-resume-load",
    "to": "session-restore-metadata",
    "kind": "call",
    "label": "restore selected continuation metadata",
    "source": [
      {
        "file": "hermes_cli/cli_agent_setup_mixin.py",
        "line": 812,
        "symbol": "_preload_resumed_session"
      }
    ],
    "condition": "History restored.",
    "id": "session-resume-load:session-restore-metadata:call"
  },
  {
    "from": "init-agent",
    "to": "session-resume-load",
    "kind": "call",
    "label": "late resume fallback if preload did not load",
    "source": [
      {
        "file": "hermes_cli/cli_agent_setup_mixin.py",
        "line": 652,
        "symbol": "_init_agent"
      }
    ],
    "condition": "Resumed session has store and empty CLI history.",
    "id": "init-agent:session-resume-load:call"
  },
  {
    "from": "session-resume-load",
    "to": "stage-input",
    "kind": "data",
    "label": "prior conversation history for next turn",
    "source": [
      {
        "file": "hermes_cli/cli_agent_setup_mixin.py",
        "line": 803,
        "symbol": "_preload_resumed_session"
      }
    ],
    "id": "session-resume-load:stage-input:data"
  },
  {
    "from": "session-switch",
    "to": "session-db",
    "kind": "call",
    "label": "read target projections / reopen target",
    "source": [
      {
        "file": "hermes_cli/cli_commands_mixin.py",
        "line": 1306,
        "symbol": "_handle_resume_command"
      }
    ],
    "id": "session-switch:session-db:call"
  },
  {
    "from": "session-switch",
    "to": "session-reset",
    "kind": "call",
    "label": "retarget existing agent through _sync_agent_to_session",
    "source": [
      {
        "file": "hermes_cli/cli_commands_mixin.py",
        "line": 332,
        "symbol": "_sync_agent_to_session"
      }
    ],
    "id": "session-switch:session-reset:call"
  },
  {
    "from": "session-switch",
    "to": "session-restore-metadata",
    "kind": "transition",
    "label": "restore cwd / approval / model fields",
    "source": [
      {
        "file": "hermes_cli/cli_commands_mixin.py",
        "line": 1329,
        "symbol": "_handle_resume_command"
      }
    ],
    "id": "session-switch:session-restore-metadata:transition"
  },
  {
    "from": "session-new",
    "to": "session-db",
    "kind": "call",
    "label": "flush old session / end old / create new",
    "source": [
      {
        "file": "hermes_cli/cli_session_mixin.py",
        "line": 511,
        "symbol": "new_session"
      }
    ],
    "condition": "Store and old-session identity available; several writes are best effort.",
    "id": "session-new:session-db:call"
  },
  {
    "from": "session-new",
    "to": "session-reset",
    "kind": "call",
    "label": "reset existing agent state",
    "source": [
      {
        "file": "hermes_cli/cli_session_mixin.py",
        "line": 553,
        "symbol": "new_session"
      }
    ],
    "condition": "Agent already constructed.",
    "id": "session-new:session-reset:call"
  },
  {
    "from": "session-new",
    "to": "memory-manager",
    "kind": "background",
    "label": "serialized old extraction then session switch",
    "source": [
      {
        "file": "hermes_cli/cli_session_mixin.py",
        "line": 581,
        "symbol": "new_session"
      }
    ],
    "condition": "Memory manager with boundary snapshot; no snapshot switches inline.",
    "id": "session-new:memory-manager:background"
  },
  {
    "from": "session-branch",
    "to": "session-db",
    "kind": "call",
    "label": "create branch then best-effort history copy",
    "source": [
      {
        "file": "hermes_cli/cli_commands_mixin.py",
        "line": 1406,
        "symbol": "_handle_branch_command"
      }
    ],
    "condition": "Idle run, history and store required.",
    "id": "session-branch:session-db:call"
  },
  {
    "from": "session-branch",
    "to": "session-reset",
    "kind": "call",
    "label": "retarget agent via session synchronization",
    "source": [
      {
        "file": "hermes_cli/cli_commands_mixin.py",
        "line": 1436,
        "symbol": "_handle_branch_command"
      }
    ],
    "id": "session-branch:session-reset:call"
  },
  {
    "from": "session-reset",
    "to": "context-engine",
    "kind": "call",
    "label": "transition lifecycle and session rebind",
    "source": [
      {
        "file": "run_agent.py",
        "line": 445,
        "symbol": "reset_session_state"
      }
    ],
    "id": "session-reset:context-engine:call"
  },
  {
    "from": "session-rewind",
    "to": "session-db",
    "kind": "call",
    "label": "rewind_user_turn before publishing history",
    "source": [
      {
        "file": "hermes_cli/cli_session_mixin.py",
        "line": 800,
        "symbol": "undo_last"
      }
    ],
    "condition": "Store is bound; write failure stops publication.",
    "id": "session-rewind:session-db:call"
  },
  {
    "from": "session-rewind",
    "to": "prompt",
    "kind": "transition",
    "label": "invalidate after undo",
    "source": [
      {
        "file": "hermes_cli/cli_session_mixin.py",
        "line": 814,
        "symbol": "undo_last"
      }
    ],
    "condition": "Undo path; retry does not invalidate the prompt here.",
    "id": "session-rewind:prompt:transition"
  },
  {
    "from": "session-rewind",
    "to": "memory-manager",
    "kind": "call",
    "label": "on_session_switch with rewound=true",
    "source": [
      {
        "file": "hermes_cli/cli_session_mixin.py",
        "line": 818,
        "symbol": "undo_last"
      }
    ],
    "condition": "Undo path and memory manager available.",
    "id": "session-rewind:memory-manager:call"
  },
  {
    "from": "session-close",
    "to": "session-db",
    "kind": "data",
    "label": "best-effort final live-message flush",
    "source": [
      {
        "file": "hermes_cli/cli_session_mixin.py",
        "line": 1049,
        "symbol": "_persist_active_session_before_close"
      }
    ],
    "id": "session-close:session-db:data"
  },
  {
    "from": "provider-call",
    "to": "rt-attempt-request",
    "kind": "call",
    "label": "build attempt payload",
    "source": [
      {
        "file": "agent/turn_api_request.py",
        "line": 93,
        "symbol": "build_api_request"
      }
    ],
    "id": "provider-call:rt-attempt-request:call"
  },
  {
    "from": "rt-attempt-request",
    "to": "rt-request-middleware",
    "kind": "call",
    "label": "transform then observe request",
    "source": [
      {
        "file": "agent/turn_api_request.py",
        "line": 145,
        "symbol": "apply_llm_request_middleware"
      }
    ],
    "id": "rt-attempt-request:rt-request-middleware:call"
  },
  {
    "from": "provider-call",
    "to": "rt-stream-choice",
    "kind": "call",
    "label": "choose transport behavior",
    "source": [
      {
        "file": "agent/turn_api_call.py",
        "line": 87,
        "symbol": "perform_api_call"
      }
    ],
    "id": "provider-call:rt-stream-choice:call"
  },
  {
    "from": "provider-call",
    "to": "rt-execution-middleware",
    "kind": "call",
    "label": "execute middleware wrapper",
    "source": [
      {
        "file": "agent/turn_api_call.py",
        "line": 133,
        "symbol": "run_llm_execution_middleware"
      }
    ],
    "id": "provider-call:rt-execution-middleware:call"
  },
  {
    "from": "rt-stream-choice",
    "to": "rt-stream-worker",
    "kind": "transition",
    "label": "streaming eligible",
    "source": [
      {
        "file": "agent/turn_api_call.py",
        "line": 95,
        "symbol": "_perform_api_call"
      }
    ],
    "condition": "_should_stream returns true",
    "id": "rt-stream-choice:rt-stream-worker:transition"
  },
  {
    "from": "rt-stream-choice",
    "to": "rt-nonstream-worker",
    "kind": "transition",
    "label": "nonstream selected",
    "source": [
      {
        "file": "agent/turn_api_call.py",
        "line": 101,
        "symbol": "relay_llm.execute"
      }
    ],
    "condition": "_should_stream returns false",
    "id": "rt-stream-choice:rt-nonstream-worker:transition"
  },
  {
    "from": "rt-stream-worker",
    "to": "rt-stream-monitor",
    "kind": "background",
    "label": "monitor worker progress",
    "source": [
      {
        "file": "agent/chat_completion_helpers.py",
        "line": 2853,
        "symbol": "_StreamingCall"
      }
    ],
    "id": "rt-stream-worker:rt-stream-monitor:background"
  },
  {
    "from": "rt-stream-worker",
    "to": "rt-stream-error",
    "kind": "call",
    "label": "failed stream attempt",
    "source": [
      {
        "file": "agent/chat_completion_helpers.py",
        "line": 3873,
        "symbol": "_handle_stream_error"
      }
    ],
    "id": "rt-stream-worker:rt-stream-error:call"
  },
  {
    "from": "rt-stream-error",
    "to": "rt-stream-worker",
    "kind": "transition",
    "label": "eligible local retry",
    "source": [
      {
        "file": "agent/chat_completion_helpers.py",
        "line": 3683,
        "symbol": "_handle_stream_error"
      }
    ],
    "condition": "retry budget and delivery conditions permit",
    "id": "rt-stream-error:rt-stream-worker:transition"
  },
  {
    "from": "rt-stream-error",
    "to": "api-retry",
    "kind": "transition",
    "label": "exhausted / unhandled stream error",
    "source": [
      {
        "file": "agent/chat_completion_helpers.py",
        "line": 3773,
        "symbol": "result.error"
      }
    ],
    "condition": "error surfaced to outer loop",
    "id": "rt-stream-error:api-retry:transition"
  },
  {
    "from": "rt-stream-monitor",
    "to": "interrupt",
    "kind": "transition",
    "label": "interrupt abort signal",
    "source": [
      {
        "file": "agent/chat_completion_stream_monitor.py",
        "line": 88,
        "symbol": "_abort_for_interrupt"
      }
    ],
    "condition": "agent interrupt requested",
    "id": "rt-stream-monitor:interrupt:transition"
  },
  {
    "from": "api-retry",
    "to": "rt-error-classifier",
    "kind": "call",
    "label": "classify outer exception",
    "source": [
      {
        "file": "agent/turn_api_error.py",
        "line": 52,
        "symbol": "handle_api_error"
      }
    ],
    "id": "api-retry:rt-error-classifier:call"
  },
  {
    "from": "rt-error-classifier",
    "to": "rt-credential-recovery",
    "kind": "call",
    "label": "post-classification recovery",
    "source": [
      {
        "file": "agent/turn_api_error.py",
        "line": 132,
        "symbol": "recover_after_classification"
      }
    ],
    "id": "rt-error-classifier:rt-credential-recovery:call"
  },
  {
    "from": "rt-credential-recovery",
    "to": "provider-call",
    "kind": "transition",
    "label": "recovered: retry attempt",
    "source": [
      {
        "file": "agent/turn_api_error.py",
        "line": 137,
        "symbol": "ApiErrorVerdict"
      }
    ],
    "condition": "recovery succeeds",
    "id": "rt-credential-recovery:provider-call:transition"
  },
  {
    "from": "rt-error-classifier",
    "to": "overflow",
    "kind": "call",
    "label": "eligible overflow recovery",
    "source": [
      {
        "file": "agent/turn_api_error.py",
        "line": 187,
        "symbol": "recover_from_overflow"
      }
    ],
    "id": "rt-error-classifier:overflow:call"
  },
  {
    "from": "rt-error-classifier",
    "to": "rt-backoff",
    "kind": "call",
    "label": "eligible remaining retry",
    "source": [
      {
        "file": "agent/turn_api_error.py",
        "line": 253,
        "symbol": "settle_unrecovered_error"
      }
    ],
    "id": "rt-error-classifier:rt-backoff:call"
  },
  {
    "from": "rt-backoff",
    "to": "provider-call",
    "kind": "transition",
    "label": "wait complete: retry",
    "source": [
      {
        "file": "agent/turn_recovery.py",
        "line": 1361,
        "symbol": "interruptible_backoff_sleep"
      }
    ],
    "condition": "not interrupted; retry admitted",
    "id": "rt-backoff:provider-call:transition"
  },
  {
    "from": "rt-execution-middleware",
    "to": "iteration",
    "kind": "transition",
    "label": "discard crossed response; rebuild",
    "source": [
      {
        "file": "agent/turn_api_call.py",
        "line": 148,
        "symbol": "_redirect_crossed_response"
      }
    ],
    "condition": "pending redirect crosses response",
    "id": "rt-execution-middleware:iteration:transition"
  },
  {
    "from": "tool-executor",
    "to": "tool-plan",
    "kind": "call",
    "label": "multiple calls: plan scopes",
    "source": [
      {
        "file": "run_agent.py",
        "line": 1349,
        "symbol": "_plan_tool_batch_segments"
      }
    ],
    "condition": "more than one call",
    "id": "tool-executor:tool-plan:call"
  },
  {
    "from": "tool-executor",
    "to": "tool-segments",
    "kind": "call",
    "label": "mixed segments",
    "source": [
      {
        "file": "run_agent.py",
        "line": 1356,
        "symbol": "execute_tool_calls_segmented"
      }
    ],
    "condition": "more than one segment",
    "id": "tool-executor:tool-segments:call"
  },
  {
    "from": "tool-segments",
    "to": "tool-concurrent",
    "kind": "call",
    "label": "parallel segment",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 1914,
        "symbol": "run_segment"
      }
    ],
    "condition": "kind equals parallel",
    "id": "tool-segments:tool-concurrent:call"
  },
  {
    "from": "tool-segments",
    "to": "tool-sequential",
    "kind": "call",
    "label": "sequential segment",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 1914,
        "symbol": "run_segment"
      }
    ],
    "condition": "kind equals sequential",
    "id": "tool-segments:tool-sequential:call"
  },
  {
    "from": "tool-concurrent",
    "to": "tool-parse",
    "kind": "call",
    "label": "parse slots",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 1571,
        "symbol": "_parse_tool_call"
      }
    ],
    "id": "tool-concurrent:tool-parse:call"
  },
  {
    "from": "tool-concurrent",
    "to": "tool-middleware",
    "kind": "call",
    "label": "worker dispatch wrapper",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 1314,
        "symbol": "_dispatch_worker"
      }
    ],
    "id": "tool-concurrent:tool-middleware:call"
  },
  {
    "from": "tool-sequential",
    "to": "tool-middleware",
    "kind": "call",
    "label": "worker or interactive inline wrapper",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 893,
        "symbol": "_run_sequential_tool_execution_middleware"
      }
    ],
    "id": "tool-sequential:tool-middleware:call"
  },
  {
    "from": "tool-middleware",
    "to": "tool-policy",
    "kind": "call",
    "label": "one authorized callback",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 778,
        "symbol": "_authorized_dispatch"
      }
    ],
    "id": "tool-middleware:tool-policy:call"
  },
  {
    "from": "tool-policy",
    "to": "tool-results",
    "kind": "data",
    "label": "blocked synthetic feedback",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 730,
        "symbol": "_blocked_tool_result"
      }
    ],
    "condition": "scope/plugin/pruned argument/guardrail block",
    "id": "tool-policy:tool-results:data"
  },
  {
    "from": "tool-policy",
    "to": "tool-inline-route",
    "kind": "transition",
    "label": "admitted invocation dispatch",
    "source": [
      {
        "file": "agent/agent_runtime_helpers.py",
        "line": 2539,
        "symbol": "resolve_invoke_tool_executor"
      }
    ],
    "condition": "concurrent invoke_tool path",
    "id": "tool-policy:tool-inline-route:transition"
  },
  {
    "from": "tool-inline-route",
    "to": "tool-registry",
    "kind": "call",
    "label": "no inline owner",
    "source": [
      {
        "file": "agent/agent_runtime_helpers.py",
        "line": 2574,
        "symbol": "handle_function_call"
      }
    ],
    "condition": "inline executor is None",
    "id": "tool-inline-route:tool-registry:call"
  },
  {
    "from": "tool-inline-route",
    "to": "memory-manager",
    "kind": "call",
    "label": "provider owns tool name",
    "source": [
      {
        "file": "agent/inline_tool_executors.py",
        "line": 308,
        "symbol": "memory_manager.handle_tool_call"
      }
    ],
    "condition": "memory manager has tool",
    "id": "tool-inline-route:memory-manager:call"
  },
  {
    "from": "tool-registry",
    "to": "tool-environment",
    "kind": "call",
    "label": "configured implementation",
    "source": [
      {
        "file": "model_tools.py",
        "line": 876,
        "symbol": "handle_function_call"
      }
    ],
    "id": "tool-registry:tool-environment:call"
  },
  {
    "from": "tool-concurrent",
    "to": "tool-abandon",
    "kind": "transition",
    "label": "deadline or interrupt",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 1414,
        "symbol": "await_completion"
      }
    ],
    "condition": "unfinished workers and timeout/interrupt",
    "id": "tool-concurrent:tool-abandon:transition"
  },
  {
    "from": "tool-sequential",
    "to": "tool-abandon",
    "kind": "transition",
    "label": "poll timeout or interruption",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 947,
        "symbol": "_poll_sequential_future"
      }
    ],
    "condition": "worker not completed within wait/grace",
    "id": "tool-sequential:tool-abandon:transition"
  },
  {
    "from": "tool-concurrent",
    "to": "tool-ordered-results",
    "kind": "call",
    "label": "join wait then append slots",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 1515,
        "symbol": "_append_batch_results"
      }
    ],
    "id": "tool-concurrent:tool-ordered-results:call"
  },
  {
    "from": "tool-abandon",
    "to": "tool-ordered-results",
    "kind": "data",
    "label": "real or synthetic unfinished slots",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 1520,
        "symbol": "_unfinished_tool_result"
      }
    ],
    "condition": "concurrent batch",
    "id": "tool-abandon:tool-ordered-results:data"
  },
  {
    "from": "tool-ordered-results",
    "to": "tool-results",
    "kind": "call",
    "label": "commit each outcome",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 1537,
        "symbol": "_commit_tool_result"
      }
    ],
    "id": "tool-ordered-results:tool-results:call"
  },
  {
    "from": "tool-results",
    "to": "tool-result-shape",
    "kind": "call",
    "label": "shape feedback before flush",
    "source": [
      {
        "file": "agent/tool_executor.py",
        "line": 1113,
        "symbol": "maybe_persist_tool_result"
      }
    ],
    "id": "tool-results:tool-result-shape:call"
  },
  {
    "from": "memory-manager",
    "to": "memory-provider-recall",
    "kind": "call",
    "label": "prefetch each eligible provider",
    "source": [
      {
        "file": "agent/memory_manager.py",
        "line": 447,
        "symbol": "prefetch_all"
      }
    ],
    "id": "memory-manager:memory-provider-recall:call"
  },
  {
    "from": "memory-provider-recall",
    "to": "augment-input",
    "kind": "data",
    "label": "nonempty bounded recall",
    "source": [
      {
        "file": "agent/memory_manager.py",
        "line": 493,
        "symbol": "spill_if_oversized"
      }
    ],
    "condition": "provider completes; context returned",
    "id": "memory-provider-recall:augment-input:data"
  },
  {
    "from": "background",
    "to": "memory-write-worker",
    "kind": "background",
    "label": "enqueue completed-turn sync",
    "source": [
      {
        "file": "agent/memory_manager.py",
        "line": 533,
        "symbol": "sync_all"
      }
    ],
    "id": "background:memory-write-worker:background"
  },
  {
    "from": "summary",
    "to": "memory-checkpoint",
    "kind": "call",
    "label": "gather checkpoint context",
    "source": [
      {
        "file": "agent/conversation_compression.py",
        "line": 3928,
        "symbol": "_pre_compress_memory_context"
      }
    ],
    "id": "summary:memory-checkpoint:call"
  },
  {
    "from": "compact-timeout",
    "to": "compression-lease",
    "kind": "call",
    "label": "snapshot callback enters guarded compression",
    "source": [
      {
        "file": "agent/compression_facade.py",
        "line": 148,
        "symbol": "_snapshot_worker"
      }
    ],
    "condition": "configured pooled compression path",
    "id": "compact-timeout:compression-lease:call"
  },
  {
    "from": "summary",
    "to": "compact-prune",
    "kind": "call",
    "label": "default compressor first stage",
    "source": [
      {
        "file": "agent/context_compressor.py",
        "line": 5602,
        "symbol": "compress"
      }
    ],
    "condition": "ContextCompressor selected",
    "id": "summary:compact-prune:call"
  },
  {
    "from": "compact-prune",
    "to": "compact-window",
    "kind": "transition",
    "label": "choose from pruned copy",
    "source": [
      {
        "file": "agent/context_compressor.py",
        "line": 5610,
        "symbol": "_compress_window"
      }
    ],
    "id": "compact-prune:compact-window:transition"
  },
  {
    "from": "compact-window",
    "to": "compact-aux-summary",
    "kind": "transition",
    "label": "nonempty feasible window",
    "source": [
      {
        "file": "agent/context_compressor.py",
        "line": 5653,
        "symbol": "_summarize_window"
      }
    ],
    "condition": "not no-op and not deterministic feasibility skip",
    "id": "compact-window:compact-aux-summary:transition"
  },
  {
    "from": "compact-aux-summary",
    "to": "compact-assemble",
    "kind": "transition",
    "label": "accepted summary or permitted fallback",
    "source": [
      {
        "file": "agent/context_compressor.py",
        "line": 5665,
        "symbol": "_assemble_compressed"
      }
    ],
    "condition": "summary stage does not abort",
    "id": "compact-aux-summary:compact-assemble:transition"
  },
  {
    "from": "compact-window",
    "to": "compact-assemble",
    "kind": "transition",
    "label": "feasibility skip uses deterministic fallback",
    "source": [
      {
        "file": "agent/context_compressor.py",
        "line": 5661,
        "symbol": "_fallback_summary_for_window"
      }
    ],
    "condition": "feasibility skip and usable fallback",
    "id": "compact-window:compact-assemble:transition"
  },
  {
    "from": "compact-assemble",
    "to": "commit-fence",
    "kind": "data",
    "label": "candidate history, not durable commit",
    "source": [
      {
        "file": "agent/conversation_compression.py",
        "line": 3897,
        "symbol": "_run_summary_phase"
      }
    ],
    "id": "compact-assemble:commit-fence:data"
  },
  {
    "from": "rt-stream-error",
    "to": "response",
    "kind": "data",
    "label": "visible partial delivery returns continuation/terminal stub",
    "source": [
      {
        "file": "agent/chat_completion_helpers.py",
        "line": 4085,
        "symbol": "_StreamingCall.run"
      }
    ],
    "condition": "deltas were sent; _partial_stream_stub drops incomplete tool calls",
    "id": "rt-stream-error:response:data"
  }
];
