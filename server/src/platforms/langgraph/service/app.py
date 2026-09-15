"""FastAPI application for the platform-local LangGraph baseline."""

from __future__ import annotations

import asyncio
import hashlib
import importlib.metadata
import os
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from langgraph.checkpoint.sqlite import SqliteSaver

from protocol.models import (
    CancelRunRequest,
    CancelRunResponse,
    HealthResponse,
    RunInspection,
    StartRunRequest,
    StartRunResponse,
    WireCheckpoint,
    WireEvent,
    WireMetrics,
    WireResult,
    WireTrajectory,
    WireTrajectoryPhase,
)
from service.config import ServiceConfig, python_version
from service.store import RunConflictError, RunNotFoundError, SQLiteRunStore, canonical_json, now_iso
from variants.baseline.graph import (
    CancellationError,
    LangGraphModelError,
    ModelConfig,
    OutcomeUnknownError,
    build_baseline_graph,
)


SERVICE_PACKAGE_VERSION = "0.1.0"


class LangGraphService:
    def __init__(self, config: ServiceConfig) -> None:
        self.config = config
        self.store = SQLiteRunStore(config.database_path)
        self.active_tasks: dict[str, asyncio.Task[None]] = {}
        self.cancel_events: dict[str, threading.Event] = {}
        self._lock = asyncio.Lock()

    async def start_run(self, request: StartRunRequest) -> tuple[dict[str, Any], bool]:
        request_data = request.model_dump(by_alias=False)
        execution_id = f"langgraph:{request.run_id}"
        request_data["execution_id"] = execution_id
        request_data["request_fingerprint"] = fingerprint(request_data)
        request_data["prompt_hash"] = hashlib.sha256(request.prompt.encode()).hexdigest()
        request_data["provider"] = request.model.provider
        request_data["model"] = request.model.model
        record, created = self.store.create_or_get(request_data)
        if created:
            self.store.append_event(execution_id, "RunCreated", {"graph": request.graph, "threadId": request.thread_id})
            cancel_event = threading.Event()
            self.cancel_events[execution_id] = cancel_event
            self.active_tasks[execution_id] = asyncio.create_task(self._execute(request, cancel_event))
        return record, created

    async def cancel_run(self, execution_id: str, reason: str) -> tuple[dict[str, Any], bool]:
        record, accepted = self.store.request_cancel(execution_id, reason)
        if accepted:
            cancel_event = self.cancel_events.get(execution_id)
            if cancel_event:
                cancel_event.set()
        return self.store.get(execution_id), accepted

    async def shutdown(self) -> None:
        for event in self.cancel_events.values():
            event.set()
        self.store.mark_incomplete_unknown("SERVICE_SHUTDOWN", "The LangGraph service stopped before a terminal result was recorded.")
        for task in self.active_tasks.values():
            if not task.done():
                task.cancel()
        self.store.close()

    async def _execute(self, request: StartRunRequest, cancel_event: threading.Event) -> None:
        execution_id = f"langgraph:{request.run_id}"
        try:
            await asyncio.to_thread(self._execute_sync, request, cancel_event)
        finally:
            self.active_tasks.pop(execution_id, None)
            self.cancel_events.pop(execution_id, None)

    def _execute_sync(self, request: StartRunRequest, cancel_event: threading.Event) -> None:
        execution_id = f"langgraph:{request.run_id}"
        started_at = now_iso()
        self.store.update_status(execution_id, "running", started_at=started_at)
        self.store.append_event(execution_id, "PlatformExecutionStarted", {"graph": request.graph, "threadId": request.thread_id})
        attempt_count = 0
        started_clock = time.monotonic()

        def emit(kind: str, payload: dict[str, Any]) -> None:
            nonlocal attempt_count
            if isinstance(payload.get("attempt"), int):
                attempt_count = max(attempt_count, int(payload["attempt"]))
                self.store.update_attempt_count(execution_id, attempt_count)
            self.store.append_event(execution_id, kind, payload)

        model = ModelConfig(
            provider=request.model.provider,
            model=request.model.model,
            api_key=os.environ.get("OPENROUTER_API_KEY"),
            timeout_ms=request.timeout_ms,
        )
        status = "completed"
        output: str | None = None
        error: dict[str, Any] | None = None
        usage = {"inputTokens": None, "outputTokens": None, "totalTokens": None}
        try:
            with SqliteSaver.from_conn_string(str(self.config.database_path)) as checkpointer:
                graph = build_baseline_graph(
                    model=model,
                    emit=emit,
                    is_cancelled=cancel_event.is_set,
                    run_id=request.run_id,
                    max_attempts=request.max_attempts,
                    checkpointer=checkpointer,
                )
                graph_config = {
                    "configurable": {"thread_id": request.thread_id},
                    "run_id": request.run_id,
                }
                for part in graph.stream(
                    {"prompt": request.prompt, "system_instruction": request.system_instruction, "output": "", "attempt_count": 0},
                    graph_config,
                    stream_mode=["updates", "checkpoints", "tasks"],
                    version="v2",
                ):
                    self._record_stream_part(execution_id, request.run_id, part)
                snapshot = graph.get_state(graph_config)
                output = snapshot.values.get("output") if isinstance(snapshot.values, dict) else None
                attempt_count = max(attempt_count, int(snapshot.values.get("attempt_count", 0)))
                self.store.update_attempt_count(execution_id, attempt_count)
                self.store.append_event(execution_id, "RunCompleted", {"outputCharacters": len(output or "")})
        except LangGraphModelError as exc:
            status = "cancelled" if isinstance(exc, CancellationError) else "unknown" if isinstance(exc, OutcomeUnknownError) else "failed"
            error = {
                "code": exc.code,
                "message": str(exc),
                "failureKind": exc.failure_kind,
                "retryable": bool(exc.retryable),
            }
            self.store.append_event(
                execution_id,
                "RunCancelled" if status == "cancelled" else "RunReconciliationRequired" if status == "unknown" else "RunFailed",
                {"code": exc.code, "failureKind": exc.failure_kind, "retryable": bool(exc.retryable)},
            )
        except Exception as exc:  # pragma: no cover - defensive process boundary
            status = "unknown" if cancel_event.is_set() else "failed"
            error = {
                "code": "LANGGRAPH_SERVICE_EXCEPTION",
                "message": "The LangGraph graph terminated unexpectedly." if status == "failed" else "The graph outcome is unknown after cancellation.",
                "failureKind": "internal" if status == "failed" else "outcome_unknown",
                "retryable": False,
            }
            self.store.append_event(execution_id, "RunFailed" if status == "failed" else "RunReconciliationRequired", {"code": error["code"]})
        finally:
            self.store.finish(
                execution_id,
                status=status,
                finished_at=now_iso(),
                output=output,
                error=error,
                attempt_count=attempt_count,
                usage=usage,
            )
            self.store.append_event(
                execution_id,
                "PlatformExecutionFinished",
                {"status": status, "durationMs": round((time.monotonic() - started_clock) * 1000)},
            )

    def _record_stream_part(self, execution_id: str, run_id: str, part: Any) -> None:
        if not isinstance(part, dict):
            return
        part_type = part.get("type")
        data = part.get("data")
        if part_type == "checkpoints" and isinstance(data, dict):
            config = data.get("config")
            configurable = config.get("configurable") if isinstance(config, dict) else None
            checkpoint_id = configurable.get("checkpoint_id") if isinstance(configurable, dict) else None
            metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
            step = metadata.get("step") if isinstance(metadata.get("step"), int) else None
            tasks = data.get("tasks") if isinstance(data.get("tasks"), list) else []
            self.store.update_checkpoint(execution_id, checkpoint_id, step, len(tasks))
            self.store.append_event(
                execution_id,
                "CheckpointWritten",
                {"checkpointId": checkpoint_id, "step": step, "next": _safe_node_names(data.get("next")), "pendingWrites": len(tasks)},
            )
        elif part_type == "updates" and isinstance(data, dict):
            for node, update in data.items():
                self.store.append_event(
                    execution_id,
                    "GraphStepCompleted",
                    {"node": str(node), "outputCharacters": _output_characters(update)},
                )
        elif part_type == "tasks" and isinstance(data, dict) and data.get("error"):
            error = data["error"]
            self.store.append_event(
                execution_id,
                "GraphStepFailed",
                {"node": str(data.get("name", "unknown")), "errorType": type(error).__name__},
            )

    def inspection(self, execution_id: str) -> RunInspection:
        record = self.store.get(execution_id)
        events = self.store.events(execution_id)
        result = _wire_result(record)
        status = record["status"]
        return RunInspection(
            execution_id=execution_id,
            run_id=record["run_id"],
            thread_id=record["thread_id"],
            graph=record["graph"],
            status=status,
            checkpoint=WireCheckpoint(
                checkpoint_id=record["checkpoint_id"],
                step=record["checkpoint_step"],
                count=record["checkpoint_count"],
                pending_writes=record["pending_writes"],
            ),
            events=[WireEvent.model_validate(event) for event in events],
            result=result,
            trajectory=_trajectory(record, events),
            metrics=_metrics(record, events),
        )

    def health(self) -> HealthResponse:
        writable = self.config.state_dir.exists() and os.access(self.config.state_dir, os.W_OK)
        try:
            langgraph_version = importlib.metadata.version("langgraph")
        except importlib.metadata.PackageNotFoundError:
            langgraph_version = "unavailable"
        return HealthResponse(
            service_version=SERVICE_PACKAGE_VERSION,
            langgraph_version=langgraph_version,
            python_version=python_version(),
            status="ready" if writable else "unavailable",
            checkpoint_path=str(self.config.database_path),
            checkpoint_path_writable=writable,
            message="LangGraph SQLite service is ready." if writable else "The checkpoint directory is not writable.",
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = getattr(app.state, "config", ServiceConfig.from_environment())
    service = LangGraphService(config)
    service.store.mark_incomplete_unknown(
        "SERVICE_RESTARTED",
        "The LangGraph service restarted before a terminal result was recorded.",
    )
    app.state.service = service
    try:
        yield
    finally:
        await service.shutdown()


def create_app(config: ServiceConfig | None = None) -> FastAPI:
    app = FastAPI(title="Agent Harness Lab LangGraph service", version=SERVICE_PACKAGE_VERSION, lifespan=lifespan)
    app.state.config = config or ServiceConfig.from_environment()

    @app.get("/health", response_model=HealthResponse)
    async def health(request: Request) -> HealthResponse:
        return request.app.state.service.health()

    @app.post("/v1/runs", response_model=StartRunResponse, status_code=202)
    async def start_run(request: Request, body: StartRunRequest) -> StartRunResponse:
        try:
            record, idempotent = await request.app.state.service.start_run(body)
        except RunConflictError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return StartRunResponse(
            execution_id=record["execution_id"],
            run_id=record["run_id"],
            thread_id=record["thread_id"],
            graph=record["graph"],
            status=record["status"],
            idempotent=not idempotent,
        )

    @app.get("/v1/runs/{execution_id}", response_model=RunInspection)
    async def inspect_run(request: Request, execution_id: str) -> RunInspection:
        try:
            return request.app.state.service.inspection(execution_id)
        except RunNotFoundError as exc:
            raise HTTPException(status_code=404, detail="LangGraph execution not found.") from exc

    @app.post("/v1/runs/{execution_id}/cancel", response_model=CancelRunResponse)
    async def cancel_run(request: Request, execution_id: str, body: CancelRunRequest) -> CancelRunResponse:
        try:
            record, accepted = await request.app.state.service.cancel_run(execution_id, body.reason)
        except RunNotFoundError as exc:
            raise HTTPException(status_code=404, detail="LangGraph execution not found.") from exc
        return CancelRunResponse(
            execution_id=execution_id,
            status=record["status"],
            accepted=accepted,
            already_terminal=not accepted,
            message="Cancellation requested." if accepted else f"Execution is already {record['status']}.",
        )

    return app


app = create_app()


def fingerprint(request: dict[str, Any]) -> str:
    immutable = {
        key: request[key]
        for key in ("run_id", "prompt", "system_instruction", "model", "graph", "thread_id", "durability", "max_attempts", "timeout_ms")
    }
    return hashlib.sha256(canonical_json(immutable).encode()).hexdigest()


def _wire_result(record: dict[str, Any]) -> WireResult | None:
    if record["status"] not in {"completed", "failed", "cancelled", "unknown"}:
        return None
    return WireResult(
        status=record["status"],
        run_id=record["run_id"],
        started_at=record["started_at"],
        finished_at=record["finished_at"],
        output=record["output"],
        error=record["error"],
        attempt_count=record["attempt_count"],
        usage=record["usage"],
    )


def _trajectory(record: dict[str, Any], events: list[dict[str, Any]]) -> WireTrajectory:
    started = next((event["occurredAt"] for event in events if event["kind"] == "PlatformExecutionStarted"), record["started_at"] or record["created_at"])
    finished = record["finished_at"]
    return WireTrajectory(phases=[WireTrajectoryPhase(name="graph", started_at=started, finished_at=finished)])


def _metrics(record: dict[str, Any], events: list[dict[str, Any]]) -> WireMetrics:
    started = record["started_at"]
    finished = record["finished_at"]
    duration = None
    if started and finished:
        duration = max(0, int((datetime.fromisoformat(finished.replace("Z", "+00:00")) - datetime.fromisoformat(started.replace("Z", "+00:00"))).total_seconds() * 1000))
    return WireMetrics(
        model_call_count=sum(1 for event in events if event["kind"] == "ModelRequested"),
        model_attempt_count=record["attempt_count"],
        checkpoint_count=record["checkpoint_count"],
        duration_ms=duration,
        input_tokens=record["usage"].get("inputTokens"),
        output_tokens=record["usage"].get("outputTokens"),
        total_tokens=record["usage"].get("totalTokens"),
    )


def _safe_node_names(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if isinstance(item, str)]


def _output_characters(value: Any) -> int:
    if not isinstance(value, dict):
        return 0
    output = value.get("output")
    return len(output) if isinstance(output, str) else 0
