"""Strict Pydantic models for the LangGraph service wire protocol.

The TypeScript adapter validates the same JSON shape independently. Keeping the
protocol local to the platform prevents LangGraph or Pydantic types from leaking
into the common server runner seam.
"""

from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from . import PROTOCOL_VERSION


class ProtocolModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=lambda name: "".join(
            word.capitalize() if index else word
            for index, word in enumerate(name.split("_"))
        ),
        populate_by_name=True,
        extra="forbid",
        frozen=True,
    )


Provider = Literal["fake", "openrouter"]
PlatformStatus = Literal["queued", "running", "suspended", "completed", "failed", "cancelled", "unknown"]
FailureKind = Literal[
    "configuration",
    "pre_dispatch",
    "provider",
    "timeout",
    "cancelled",
    "outcome_unknown",
    "internal",
    "reconciliation",
]


class ModelSelection(ProtocolModel):
    provider: Provider
    model: str = Field(min_length=1, max_length=200)


class ContextSelection(ProtocolModel):
    session_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
    turn_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    # Optional for direct service callers that still exercise the legacy
    # transcript bridge. Lab server requests always provide the shared snapshot.
    snapshot_id: str | None = Field(default=None, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    # These immutable facts let the service reject a stale or mismatched snapshot
    # without copying the prepared message list across the process boundary.
    compaction_revision: int | None = Field(default=None, ge=0)
    context_window_tokens: int | None = Field(default=None, ge=1)


def thread_id_for_session(session_id: str) -> str:
    """Map a Lab session to a bounded, non-path-like LangGraph thread identity."""

    digest = hashlib.sha256(session_id.encode("utf-8")).hexdigest()[:32]
    return f"langgraph:baseline:{digest}"


class ToolConfiguration(ProtocolModel):
    enabled_names: list[str] = Field(default_factory=list, max_length=32)
    approved_names: list[str] = Field(default_factory=list, max_length=32)
    max_rounds: int = Field(default=6, ge=1, le=32)
    max_calls: int = Field(default=8, ge=1, le=64)

    @model_validator(mode="after")
    def validate_names(self) -> "ToolConfiguration":
        if len(set(self.enabled_names)) != len(self.enabled_names):
            raise ValueError("enabledNames must not contain duplicate tool names.")
        for name in self.enabled_names:
            if not name or not name.isascii() or not name[0].islower() or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789_-" for character in name):
                raise ValueError("Tool names must use lowercase letters, numbers, hyphens, or underscores.")
        if not set(self.approved_names).issubset(set(self.enabled_names)):
            raise ValueError("approvedNames must be a subset of enabledNames.")
        if len(set(self.approved_names)) != len(self.approved_names):
            raise ValueError("approvedNames must not contain duplicates.")
        for name in self.approved_names:
            if not name or not name.isascii() or not name[0].islower() or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789_-" for character in name):
                raise ValueError("Approved tool names must use lowercase letters, numbers, hyphens, or underscores.")
        return self


class McpConnectionBinding(ProtocolModel):
    endpoint_ref: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    server_name: str = Field(min_length=1, max_length=128)
    protocol_version: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    tool_name: str = Field(min_length=1, max_length=128)
    tool_version: str = Field(pattern=r"^\d+\.\d+\.\d+$")


class ConnectionBinding(ProtocolModel):
    tool_name: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    connection_ref: str = Field(min_length=1, max_length=128, pattern=r"^conn_[A-Za-z0-9][A-Za-z0-9._:-]{0,122}$")
    operations: list[str] = Field(min_length=1, max_length=32)
    mcp: McpConnectionBinding | None = None

    @model_validator(mode="after")
    def validate_operations(self) -> "ConnectionBinding":
        if any(not operation.isascii() or not operation or not operation[0].islower() or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789_.:-" for character in operation) for operation in self.operations):
            raise ValueError("Connection operations must use lowercase letters, numbers, dots, underscores, hyphens, or colons.")
        if len(set(self.operations)) != len(self.operations):
            raise ValueError("Connection operations must not contain duplicates.")
        return self


class ToolCatalogSnapshot(ProtocolModel):
    schema_version: Literal[1]
    revision: str = Field(min_length=1, max_length=128)
    tools: list[dict[str, Any]] = Field(max_length=128)


class ExecutionPolicy(ProtocolModel):
    schema_version: Literal[1]
    mode: Literal["sustained"]
    deadline_at: str
    model_timeout_ms: int = Field(ge=100, le=300_000)

    @model_validator(mode="after")
    def validate_deadline(self) -> "ExecutionPolicy":
        deadline = datetime.fromisoformat(self.deadline_at.replace("Z", "+00:00"))
        if deadline.tzinfo is None:
            raise ValueError("deadlineAt must contain a timezone.")
        return self


class StartRunRequest(ProtocolModel):
    # Only synthetic live evals opt into bounded request evidence and free routing.
    live_eval: bool = False
    live_eval_experiment: Literal["agent-harness-live", "agent-capabilities-live"] | None = None
    protocol_version: Literal[PROTOCOL_VERSION] = Field(default=PROTOCOL_VERSION)
    run_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    session_id: str | None = Field(default=None, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
    client_turn_id: str | None = Field(default=None, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    prompt: str = Field(min_length=1, max_length=20_000)
    system_instruction: str = Field(min_length=1, max_length=20_000)
    model: ModelSelection
    graph: Literal["baseline"] = "baseline"
    thread_id: str = Field(min_length=1, max_length=255, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    durability: Literal["sqlite-sync"] = "sqlite-sync"
    max_attempts: int = Field(default=2, ge=1, le=5)
    timeout_ms: int = Field(default=30_000, ge=100, le=300_000)
    context: ContextSelection | None = None
    tools: ToolConfiguration | None = None
    tool_catalog: ToolCatalogSnapshot | None = None
    connections: list[ConnectionBinding] = Field(default_factory=list, max_length=32)
    execution: ExecutionPolicy | None = None

    @model_validator(mode="after")
    def validate_connections(self) -> "StartRunRequest":
        tool_names = [binding.tool_name for binding in self.connections]
        if len(set(tool_names)) != len(tool_names):
            raise ValueError("Connection bindings must not contain duplicate tool names.")
        return self

    @model_validator(mode="after")
    def thread_matches_identity(self) -> "StartRunRequest":
        if self.client_turn_id is not None and self.session_id is None:
            raise ValueError("clientTurnId requires sessionId.")
        expected_thread_id = thread_id_for_session(self.session_id) if self.session_id else self.run_id
        if self.thread_id != expected_thread_id:
            raise ValueError("threadId does not match the LangGraph session identity.")
        if self.context is not None and self.session_id != self.context.session_id:
            raise ValueError("context.sessionId must match sessionId.")
        return self


class HealthResponse(ProtocolModel):
    protocol_version: Literal[PROTOCOL_VERSION] = PROTOCOL_VERSION
    service: Literal["langgraph"] = "langgraph"
    service_version: str
    langgraph_version: str
    python_version: str
    status: Literal["ready", "unavailable"]
    checkpoint_path: str
    checkpoint_path_writable: bool
    message: str


class OrphanCheckpointThread(ProtocolModel):
    thread_id: str = Field(min_length=1, max_length=255)
    checkpoint_count: int = Field(ge=1)
    latest_checkpoint_id: str | None = Field(default=None, max_length=255)


class UncheckpointedRun(ProtocolModel):
    execution_id: str = Field(min_length=1, max_length=255)
    run_id: str = Field(min_length=1, max_length=128)
    thread_id: str = Field(min_length=1, max_length=255)
    status: Literal["queued", "running", "unknown"]
    message: str = Field(min_length=1, max_length=500)


class OwnedRunRecovery(ProtocolModel):
    execution_id: str = Field(min_length=1, max_length=255)
    run_id: str = Field(min_length=1, max_length=128)
    thread_id: str = Field(min_length=1, max_length=255)
    checkpoint_id: str | None = Field(default=None, max_length=255)
    eligible: bool
    reason: Literal["safe_checkpoint", "waiting_review", "legacy_policy", "cancelled", "deadline_reached", "reconciliation_required"]


class RecoveryDiagnosticsResponse(ProtocolModel):
    protocol_version: Literal[PROTOCOL_VERSION] = PROTOCOL_VERSION
    status: Literal["clean", "attention"]
    limit: int = Field(ge=1, le=100)
    orphan_checkpoint_threads: list[OrphanCheckpointThread]
    orphan_write_count: int = Field(ge=0)
    uncheckpointed_runs: list[UncheckpointedRun]
    owned_runs: list[OwnedRunRecovery] = Field(default_factory=list, max_length=100)
    truncated: bool
    message: str = Field(min_length=1, max_length=500)


class ErrorResponse(ProtocolModel):
    code: str
    message: str
    failure_kind: FailureKind
    retryable: bool


class WireEvent(ProtocolModel):
    source: Literal["langgraph-service"] = "langgraph-service"
    source_sequence: int = Field(ge=1)
    kind: str = Field(min_length=1, max_length=100)
    run_id: str
    occurred_at: str
    payload: dict[str, Any]


class WireResult(ProtocolModel):
    status: PlatformStatus
    run_id: str
    started_at: str | None
    finished_at: str | None
    output: str | None
    error: ErrorResponse | None
    attempt_count: int = Field(ge=0)
    usage: dict[str, int | None]


class WireTrajectoryPhase(ProtocolModel):
    name: str
    started_at: str
    finished_at: str | None


class WireCheckpoint(ProtocolModel):
    checkpoint_id: str | None
    step: int | None
    count: int = Field(ge=0)
    pending_writes: int = Field(ge=0)


class WireTrajectory(ProtocolModel):
    phases: list[WireTrajectoryPhase]


class WireMetrics(ProtocolModel):
    model_call_count: int = Field(ge=0)
    model_attempt_count: int = Field(ge=0)
    checkpoint_count: int = Field(ge=0)
    duration_ms: int | None
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None
    tool_call_count: int = Field(default=0, ge=0)
    tool_attempt_count: int = Field(default=0, ge=0)


class RunInspection(ProtocolModel):
    protocol_version: Literal[PROTOCOL_VERSION] = PROTOCOL_VERSION
    execution_id: str
    run_id: str
    thread_id: str
    graph: Literal["baseline"]
    status: PlatformStatus
    checkpoint: WireCheckpoint
    events: list[WireEvent]
    result: WireResult | None
    trajectory: WireTrajectory
    metrics: WireMetrics


class StartRunResponse(ProtocolModel):
    protocol_version: Literal[PROTOCOL_VERSION] = PROTOCOL_VERSION
    execution_id: str
    run_id: str
    thread_id: str
    graph: Literal["baseline"]
    status: PlatformStatus
    idempotent: bool
    # Runtime identity is retained in the native execution reference so an
    # evidence record can be interpreted after the local environment changes.
    service_version: str | None = None
    langgraph_version: str | None = None
    python_version: str | None = None


class CancelRunRequest(ProtocolModel):
    reason: str = Field(default="Cancellation requested.", min_length=1, max_length=500)


class CancelRunResponse(ProtocolModel):
    protocol_version: Literal[PROTOCOL_VERSION] = PROTOCOL_VERSION
    execution_id: str
    status: PlatformStatus
    accepted: bool
    already_terminal: bool
    message: str


class ResumeRunRequest(ProtocolModel):
    kind: Literal["invocation_review"]
    request_id: str = Field(min_length=1, max_length=128)
    revision: int = Field(ge=1)
    decision_id: str = Field(min_length=1, max_length=128)
    tool_call_id: str = Field(min_length=1, max_length=128)
    decision: Literal["approved", "denied", "renewed"]
    reason: str | None = Field(default=None, max_length=512)
