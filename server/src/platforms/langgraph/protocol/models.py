"""Strict Pydantic models for the LangGraph service wire protocol.

The TypeScript adapter validates the same JSON shape independently. Keeping the
protocol local to the platform prevents LangGraph or Pydantic types from leaking
into the common server runner seam.
"""

from __future__ import annotations

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
PlatformStatus = Literal["queued", "running", "completed", "failed", "cancelled", "unknown"]
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


class ToolConfiguration(ProtocolModel):
    enabled_names: list[str] = Field(default_factory=list, max_length=32)
    max_rounds: int = Field(default=6, ge=1, le=32)
    max_calls: int = Field(default=8, ge=1, le=64)

    @model_validator(mode="after")
    def validate_names(self) -> "ToolConfiguration":
        if len(set(self.enabled_names)) != len(self.enabled_names):
            raise ValueError("enabledNames must not contain duplicate tool names.")
        for name in self.enabled_names:
            if not name or not name.isascii() or not name[0].islower() or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789_-" for character in name):
                raise ValueError("Tool names must use lowercase letters, numbers, hyphens, or underscores.")
        return self


class StartRunRequest(ProtocolModel):
    protocol_version: Literal[PROTOCOL_VERSION] = Field(default=PROTOCOL_VERSION)
    run_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
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

    @model_validator(mode="after")
    def thread_matches_run(self) -> "StartRunRequest":
        if self.thread_id != self.run_id:
            raise ValueError("threadId must equal runId for the LangGraph baseline.")
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


class CancelRunRequest(ProtocolModel):
    reason: str = Field(default="Cancellation requested.", min_length=1, max_length=500)


class CancelRunResponse(ProtocolModel):
    protocol_version: Literal[PROTOCOL_VERSION] = PROTOCOL_VERSION
    execution_id: str
    status: PlatformStatus
    accepted: bool
    already_terminal: bool
    message: str
