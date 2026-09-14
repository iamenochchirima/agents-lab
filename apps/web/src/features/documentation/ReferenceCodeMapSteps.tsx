interface MentalModelStep {
  files: readonly string[];
  title: string;
}

const stepsByDocument: Record<string, readonly MentalModelStep[]> = {
  "docs/architecture/agent-harness-lab.md": [
    { title: "Channel and agent-run entry", files: ["channel or CLI adapter", "gateway adapter", "cron adapter", "platform variant runtime"] },
    { title: "Session and workspace state", files: ["session store", "workspace manager", "run identity", "platform-specific state or checkpoint adapter"] },
    { title: "Agent identity and behavior", files: ["SOUL.md", "system instructions", "agent definition", "identity configuration"] },
    { title: "Workspace instructions and procedures", files: ["AGENTS.md", "skills/", "workspace conventions", "dynamic capability loader"] },
    { title: "Memory and conversation context", files: ["session transcript", "memory strategy", "retrieval adapter", "scenario state"] },
    { title: "Tool and capability context", files: ["tool strategy", "tool schemas", "permission policy", "environment adapter"] },
    { title: "Assemble model context", files: ["context builder", "context budget", "compaction strategy", "model request adapter"] },
    { title: "Execution loop and model response", files: ["platform variant runtime", "model adapter", "stream handler", "termination rules"] },
    { title: "Policy and action", files: ["environment adapter", "permission policy", "approval boundary", "idempotency boundary", "external integration adapter"] },
    { title: "Tool results, checkpoints, and recovery", files: ["tool or subagent dispatcher", "platform checkpoint or workflow state", "retry policy", "failure-injection hook", "resumption contract"] },
    { title: "Native telemetry and result delivery", files: ["native platform telemetry adapter", "result delivery adapter", "logs", "artifacts"] },
    { title: "Lab evidence and run record", files: ["server/src/control-plane/observability/", "lab/runs/<run-id>/events.jsonl", "lab/runs/<run-id>/metrics.json", "lab/runs/<run-id>/result.json", "lab/runs/<run-id>/artifacts/"] },
  ],
  "docs/research/harness-code-maps/hermes.md": [
    { title: "Entry surfaces and facade", files: ["run_agent.py", "gateway/", "tui_gateway/", "apps/desktop/", "agent/turn_facade.py"] },
    { title: "Turn admission and lifecycle", files: ["agent/turn_facade.py", "agent/turn_facade_lease.py", "agent/interrupt_*.py", "agent/client_lifecycle.py"] },
    { title: "Turn context", files: ["agent/turn_context.py", "agent/session_persistence.py", "agent/memory_manager.py", "agent/runtime_cwd.py"] },
    { title: "Conversation loop", files: ["agent/conversation_loop.py", "agent/iteration_budget.py", "agent/turn_api_call.py", "agent/turn_recovery.py", "agent/turn_retry_state.py"] },
    { title: "Request assembly", files: ["agent/turn_request_assembly.py", "agent/turn_context.py::build_api_messages", "agent/message_sanitization.py", "agent/prompt_caching.py"] },
    { title: "Provider call", files: ["agent/provider_registry.py", "agent/transports/", "agent/turn_api_call.py", "agent/provider_projection.py"] },
    { title: "Tool round and dispatch", files: ["agent/turn_tool_round.py", "agent/tool_executor.py", "model_tools.py", "toolsets.py", "tools/registry.py"] },
    { title: "Tools and environments", files: ["tools/", "tools/environments/", "plugins/", "agent/tool_guardrails.py", "agent/secret_scope.py"] },
    { title: "Compaction", files: ["agent/context_compressor.py", "agent/conversation_compression.py", "agent/turn_context_compaction.py", "agent/context_engine.py"] },
    { title: "Persistence and evidence", files: ["agent/session_persistence.py", "hermes_state.py", "trajectory.py", "agent/monitoring/", "hermes_logging.py"] },
  ],
  "docs/research/harness-code-maps/waku.md": [
    { title: "Input and composition", files: ["waku/app.py", "waku/gateway/cli.py", "waku/gateway/runner.py", "waku/config.py", "waku/db.py"] },
    { title: "System prompt and identity", files: ["waku/runtime/session.py", "$WAKU_HOME/SOUL.md", "waku/memory/retrieval_gate.py", "waku/memory/procedural/"] },
    { title: "Working history", files: ["waku/runtime/session.py::Session.history", "waku/app.py::_run_full_turn", "waku/memory/__init__.py::session_history"] },
    { title: "Model and tool loop", files: ["waku/loop/agent.py", "waku/loop/models.py", "waku/tools/registry.py"] },
    { title: "Tool implementations", files: ["waku/tools/__init__.py", "waku/tools/calendar.py", "waku/tools/messages.py", "waku/tools/workspace.py", "waku/tools/mcp_*.py"] },
    { title: "Durable memory and post-turn work", files: ["waku/memory/__init__.py", "waku/memory/semantic/", "waku/memory/episodic/", "waku/memory/consolidation.py", "$WAKU_HOME/MEMORY.md"] },
    { title: "Trace and operations", files: ["waku/ops/tracing.py", "waku/ops/show_trace.py", "waku/ops/dashboard.py", "$WAKU_HOME/traces/"] },
    { title: "Optional graph route", files: ["waku/graph/", "waku/app.py::_respond_via_graph", "waku/graph/workflows/triage.py"] },
  ],
  "docs/research/harness-code-maps/openclaw.md": [
    { title: "Input and turn preparation", files: ["src/gateway/", "src/cron/", "src/agents/sessions/", "docs/gateway/config-agents/"] },
    { title: "Workspace identity and instructions", files: ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "BOOTSTRAP.md", "src/agents/sessions/"] },
    { title: "Harness selection", files: ["src/agents/harness/selection-decision.ts", "src/agents/harness/selection.ts", "src/agents/harness/registry.ts", "src/agents/harness/policy.ts"] },
    { title: "Built-in orchestration", files: ["src/agents/embedded-agent-runner/run.ts", "run-orchestrator.ts", "lanes.ts", "resource-loader.ts"] },
    { title: "Logical turn and fallback", files: ["src/agents/embedded-agent-runner/run-entry.ts", "src/agents/model-fallback-runner.ts", "src/agents/harness/context-engine-logical-turn.ts"] },
    { title: "Attempt loop and recovery", files: ["src/agents/embedded-agent-runner/run-loop.ts", "run/retry-budget.ts", "run/attempt-recovery.ts", "run/compaction-runtime.ts", "run/run-settlement.ts"] },
    { title: "Tool controls and execution", files: ["src/agents/agent-tools*.ts", "src/agents/agent-tools.before-tool-call.approval.ts", "src/agents/harness/tool-surface-bridge.ts"] },
    { title: "Transcript, compaction, and memory", files: ["src/agents/embedded-agent-runner/history.ts", "src/agents/embedded-agent-runner/compact*.ts", "src/memory/", "src/memory-host-sdk/"] },
    { title: "Delivery and runtime evidence", files: ["src/agents/embedded-agent-runner/delivery-evidence.ts", "active-run-projections.ts", "src/gateway/", "src/agents/sessions/"] },
    { title: "Alternative executor", files: ["src/agents/harness/", "docs/plugins/sdk-agent-harness/", "registered agent-harness plugins"] },
  ],
};

export function ReferenceCodeMapSteps({ documentId }: { documentId: string }) {
  const steps = stepsByDocument[documentId];
  if (!steps) return null;

  return (
    <section className="reference-code-map-steps" aria-label="Files by mental-model step">
      <div className="reference-code-map-steps-heading">
        <h2>Files by mental-model step</h2>
        <p>Each group follows a box or handoff in the diagram. Files can appear more than once when they cross a boundary.</p>
      </div>
      <div className="reference-code-map-step-list">
        {steps.map((step) => (
          <details className="reference-code-map-step" key={step.title}>
            <summary>
              <span>{step.title}</span>
              <small>{step.files.length} paths</small>
            </summary>
            <ul>
              {step.files.map((file) => <li key={file}><code>{file}</code></li>)}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}
