"""FastAPI application for the platform-local LangGraph baseline."""

from __future__ import annotations

import asyncio
import fcntl
import hashlib
import importlib.metadata
import json
import os
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from fastapi import FastAPI, HTTPException, Query, Request
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command
from variants.baseline.hosted_tools import host_key
import secrets

from protocol.models import (
    ResumeRunRequest,
    TaskInputResumeRequest,
    CancelRunRequest,
    CancelRunResponse,
    HealthResponse,
    RunInspection,
    RecoveryDiagnosticsResponse,
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
    ConfigurationError,
    LangGraphModelError,
    ModelConfig,
    OutcomeUnknownError,
    ExecutionDeadlineError,
    build_baseline_graph,
)


SERVICE_PACKAGE_VERSION = "0.1.0"


class LangGraphService:
    def __init__(self, config: ServiceConfig) -> None:
        self.config = config
        config.state_dir.mkdir(parents=True, exist_ok=True)
        self._owner_lock = (config.state_dir / ".execution-owner.lock").open("a")
        try:
            fcntl.flock(self._owner_lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self._owner_lock.close()
            raise RuntimeError("Another LangGraph service owns this local state directory.") from None
        self.store = SQLiteRunStore(config.database_path)
        self.active_tasks: dict[str, asyncio.Task[None]] = {}
        self.cancel_events: dict[str, threading.Event] = {}
        self.deadline_tasks: dict[str, asyncio.Task[None]] = {}
        self._lock = asyncio.Lock()

    async def start_run(self, request: StartRunRequest) -> tuple[dict[str, Any], bool]:
        request_data = request.model_dump(by_alias=False)
        request_data["native_request"] = request.model_dump(by_alias=True)
        execution_id = f"langgraph:{request.run_id}"
        request_data["execution_id"] = execution_id
        request_data["request_fingerprint"] = fingerprint(request_data)
        request_data["prompt_hash"] = hashlib.sha256(request.prompt.encode()).hexdigest()
        request_data["provider"] = request.model.provider
        request_data["model"] = request.model.model
        request_data["session_id"] = request.session_id
        request_data["turn_id"] = request.context.turn_id if request.context else None
        request_data["client_turn_id"] = request.client_turn_id
        record, created = self.store.create_or_get(request_data)
        if created:
            self.store.append_event(execution_id, "RunCreated", {"graph": request.graph, "threadId": request.thread_id})
            cancel_event = threading.Event()
            self.cancel_events[execution_id] = cancel_event
            self.active_tasks[execution_id] = asyncio.create_task(self._execute(request, cancel_event))
            self._watch_deadline(request)
        return record, created

    def _watch_deadline(self, request: StartRunRequest) -> None:
        if request.execution is None:
            return
        execution_id = f"langgraph:{request.run_id}"
        if execution_id not in self.deadline_tasks:
            self.deadline_tasks[execution_id] = asyncio.create_task(self._expire_run(request))

    async def _expire_run(self, request: StartRunRequest) -> None:
        execution_id = f"langgraph:{request.run_id}"
        await asyncio.sleep(max(0, execution_remaining_ms(request)) / 1000)
        record = self.store.get(execution_id)
        if record["status"] == "suspended":
            self._finish_deadline(record)
        elif record["status"] in {"queued", "running"}:
            event = self.cancel_events.get(execution_id)
            if event:
                event.set()

    def _finish_deadline(self, record: dict[str, Any]) -> None:
        self.store.finish(record["execution_id"], status="failed", finished_at=now_iso(), output=None,
            error={"code": "EXECUTION_DEADLINE_EXCEEDED", "message": "The retained execution deadline was reached.", "failureKind": "timeout", "retryable": False},
            attempt_count=record["attempt_count"], usage=record["usage"])
        self.store.append_event(record["execution_id"], "RunFailed", {"code": "EXECUTION_DEADLINE_EXCEEDED", "failureKind": "timeout"})

    async def recover_runs(self) -> None:
        """Resume only proven safe native checkpoints under the original owner."""
        for record in self.store.active_runs():
            execution_id = record["execution_id"]
            try:
                request = StartRunRequest.model_validate(json.loads(record["request_json"]))
            except (TypeError, ValueError):
                continue  # Legacy admissions retain the conservative unknown policy.
            if request.execution is None:
                continue
            if record["status"] == "suspended":
                if record["cancel_requested"]:
                    await self.cancel_run(execution_id, record["cancel_reason"] or "Retained cancellation")
                elif execution_remaining_ms(request) <= 0:
                    self._finish_deadline(record)
                else:
                    self._watch_deadline(request)
                continue
            with SqliteSaver.from_conn_string(str(self.config.database_path)) as saver:
                native = saver.get_tuple({"configurable": {"thread_id": request.thread_id}})
            values = native.checkpoint.get("channel_values", {}) if native else {}
            operation = json.loads(record["pending_operation_json"]) if record.get("pending_operation_json") else None
            safe = values.get("execution_run_id") == request.run_id and checkpoint_contains_operation(values, operation)
            if not safe:
                self.store.finish(execution_id, status="unknown", finished_at=now_iso(), output=None,
                    error={"code": "LANGGRAPH_RECOVERY_RECONCILIATION_REQUIRED", "message": "No safe owned checkpoint proves the interrupted operation. Reconcile before resuming.", "failureKind": "outcome_unknown", "retryable": False},
                    attempt_count=record["attempt_count"], usage=record["usage"])
                self.store.append_event(execution_id, "RunReconciliationRequired", {"reason": "unresolved_native_boundary", "operation": operation})
                continue
            if record["cancel_requested"]:
                self.store.finish(execution_id, status="cancelled", finished_at=now_iso(), output=None,
                    error={"code": "LANGGRAPH_CANCELLED", "message": record["cancel_reason"] or "Cancellation retained before recovery.", "failureKind": "cancelled", "retryable": False},
                    attempt_count=record["attempt_count"], usage=record["usage"])
                self.store.append_event(execution_id, "RunCancelled", {"reason": "persisted_cancellation"})
                continue
            if execution_remaining_ms(request) <= 0:
                self._finish_deadline(record)
                continue
            self.store.set_pending_operation(execution_id, None)
            self.store.append_event(execution_id, "RunRecovered", {"threadId": request.thread_id, "checkpointId": native.config["configurable"]["checkpoint_id"]})
            cancel_event = threading.Event()
            self.cancel_events[execution_id] = cancel_event
            self.active_tasks[execution_id] = asyncio.create_task(self._execute(request, cancel_event, recovery=True))
            self._watch_deadline(request)

    async def cancel_run(self, execution_id: str, reason: str) -> tuple[dict[str, Any], bool]:
        record, accepted = self.store.request_cancel(execution_id, reason)
        if accepted:
            cancel_event = self.cancel_events.get(execution_id)
            if cancel_event:
                cancel_event.set()
            if record["status"] == "suspended":
                self.store.finish(execution_id, status="cancelled", finished_at=now_iso(), output=None,
                    error={"code": "LANGGRAPH_CANCELLED", "message": reason, "failureKind": "cancelled", "retryable": False},
                    attempt_count=record["attempt_count"], usage=record["usage"])
                self.store.append_event(execution_id, "RunCancelled", {"reason": reason})
        return self.store.get(execution_id), accepted

    async def resume_run(self, execution_id: str, resume: ResumeRunRequest | TaskInputResumeRequest) -> dict[str, Any]:
        async with self._lock:
            record = self.store.get(execution_id)
            if isinstance(resume, TaskInputResumeRequest) and record["status"] in {"queued", "running"}:
                if not record.get("request_json"):
                    raise RunConflictError("This execution has no retained input admission.")
                admitted = json.loads(record["request_json"])
                turn = (admitted.get("context") or {}).get("turnId") or f'{record["run_id"]}:turn:1'
                if resume.run_id != record["run_id"] or resume.turn_id != turn or record["cancel_requested"]:
                    raise RunConflictError("Task input targets another or cancelled execution.")
                return record  # The active native graph fetches retained content at its next gate.
            if record["status"] != "suspended" or record["cancel_requested"]:
                raise RunConflictError("Only an uncancelled suspended invocation can resume.")
            if not record.get("request_json"):
                raise RunConflictError("This retained execution has no recoverable admission request.")
            request = StartRunRequest.model_validate(json.loads(record["request_json"]))
            with SqliteSaver.from_conn_string(str(self.config.database_path)) as checkpointer:
                # Read the exact native interrupt without reconstructing inference.
                pending = checkpointer.get_tuple({"configurable": {"thread_id": request.thread_id}})
                interrupts = [value for _, channel, value in pending.pending_writes if channel == "__interrupt__"] if pending else []
                reviews = [item.value for values in interrupts for item in (values if isinstance(values, (list, tuple)) else [values]) if hasattr(item, "value")]
                if isinstance(resume, TaskInputResumeRequest):
                    turn_id = request.context.turn_id if request.context else f"{request.run_id}:turn:1"
                    if resume.run_id != request.run_id or resume.turn_id != turn_id or not any(
                        resume.input_kind == "steering" or (value.get("kind") == "clarification" and value.get("questionId") == resume.question_id) for value in reviews):
                        raise RunConflictError("Task input does not match the original native wait.")
                else:
                    if not any(review.get("requestId") == resume.request_id and (review.get("revision") + 1 == resume.revision if resume.decision == "renewed" else review.get("revision") == resume.revision) and review.get("call", {}).get("toolCallId") == resume.tool_call_id for review in reviews):
                        raise RunConflictError("The resume identity does not match the checkpoint's pending invocation.")
            previous_task = self.active_tasks.get(execution_id)
            if previous_task is not None and not previous_task.done():
                await previous_task
            cancel_event = threading.Event()
            self.cancel_events[execution_id] = cancel_event
            self.store.update_status(execution_id, "running")
            self.store.append_event(execution_id, "RunResumed", resume.model_dump(by_alias=True))
            self.active_tasks[execution_id] = asyncio.create_task(self._execute(request, cancel_event, resume.model_dump(by_alias=True)))
            return self.store.get(execution_id)

    async def shutdown(self) -> None:
        for task in self.deadline_tasks.values():
            task.cancel()
        for event in self.cancel_events.values():
            event.set()
        active_tasks = [task for task in self.active_tasks.values() if not task.done()]
        if active_tasks:
            await asyncio.wait(active_tasks, timeout=2.0)
        self.store.mark_incomplete_unknown(
            "SERVICE_SHUTDOWN",
            "The LangGraph service stopped before a terminal result was recorded.",
        )
        # asyncio.to_thread cannot interrupt its worker. Keep SQLite open while
        # a worker drains so it cannot raise a closed-connection error or
        # overwrite the persisted unknown outcome.
        if all(task.done() for task in active_tasks):
            self.store.close()
            self._owner_lock.close()

    async def _execute(self, request: StartRunRequest, cancel_event: threading.Event, resume: dict[str, Any] | None = None, recovery: bool = False) -> None:
        execution_id = f"langgraph:{request.run_id}"
        try:
            await asyncio.to_thread(self._execute_sync, request, cancel_event, resume, recovery)
        finally:
            self.active_tasks.pop(execution_id, None)
            self.cancel_events.pop(execution_id, None)

    def _execute_sync(self, request: StartRunRequest, cancel_event: threading.Event, resume: dict[str, Any] | None = None, recovery: bool = False) -> None:
        execution_id = f"langgraph:{request.run_id}"
        started_at = now_iso()
        self.store.update_status(execution_id, "running", started_at=started_at)
        self.store.append_event(execution_id, "PlatformExecutionStarted", {"graph": request.graph, "threadId": request.thread_id})
        attempt_count = self.store.get(execution_id)["attempt_count"]
        started_clock = time.monotonic()

        def emit(kind: str, payload: dict[str, Any]) -> None:
            nonlocal attempt_count
            if isinstance(payload.get("attempt"), int):
                attempt_count = max(attempt_count, int(payload["attempt"]))
                self.store.update_attempt_count(execution_id, attempt_count)
            if kind in {"ModelRequested", "ToolExecutionStarted"}:
                self.store.set_pending_operation(execution_id, {"kind": "tool" if kind == "ToolExecutionStarted" else "context" if payload.get("node") == "context" else "model", **payload})
            self.store.append_event(execution_id, kind, payload)

        model = ModelConfig(
            provider=request.model.provider,
            model=request.model.model,
            api_key=os.environ.get("OPENROUTER_API_KEY"),
            timeout_ms=min(request.execution.model_timeout_ms if request.execution else request.timeout_ms, max(1, execution_remaining_ms(request))),
            base_url=os.environ.get("AGENTLAB_OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        )
        status = "completed"
        output: str | None = None
        error: dict[str, Any] | None = None
        usage = {"inputTokens": None, "outputTokens": None, "totalTokens": None}
        try:
            if execution_remaining_ms(request) <= 0:
                raise ExecutionDeadlineError("The retained execution deadline was reached.")
            initial_messages = load_context_messages(self.config.context_root, request, emit) if resume is None and not recovery else []
            tool_configuration = request.tools
            with SqliteSaver.from_conn_string(str(self.config.database_path)) as checkpointer:
                graph = build_baseline_graph(
                    model=model,
                    live_eval=request.live_eval,
                    live_eval_experiment=request.live_eval_experiment,
                    emit=emit,
                    is_cancelled=lambda: cancel_event.is_set() or self.store.cancellation_requested(execution_id)[0],
                    run_id=request.run_id,
                    max_attempts=request.max_attempts,
                    checkpointer=checkpointer,
                    tool_names=list(tool_configuration.enabled_names) if tool_configuration else None,
                    approved_tool_names=list(tool_configuration.approved_names) if tool_configuration else None,
                    connection_bindings=[binding.model_dump(by_alias=False) for binding in request.connections],
                    connection_url=self.config.local_fixture_url,
                    tool_catalog=request.tool_catalog.model_dump(by_alias=True) if request.tool_catalog else None,
                    capability_host_url=self.config.capability_host_url,
                    capability_host_key_file=str(self.config.capability_host_key_file),
                    turn_id=request.context.turn_id if request.context else f"{request.run_id}:turn:1",
                    max_rounds=tool_configuration.max_rounds if tool_configuration else 6,
                    max_calls=tool_configuration.max_calls if tool_configuration else 8,
                    execution_deadline_reached=lambda: execution_remaining_ms(request) <= 0,
                    context_window_tokens=request.context.context_window_tokens if request.context else None,
                )
                graph_config = {
                    "configurable": {"thread_id": request.thread_id},
                    "run_id": request.run_id,
                }
                checkpoint = graph.get_state(graph_config)
                graph_input = None if recovery else Command(resume=resume) if resume is not None else {**graph_input_for_turn(request, initial_messages, checkpoint, emit), "execution_run_id": request.run_id, "working_compaction_revision": 0}
                for part in graph.stream(
                    graph_input,
                    graph_config,
                    stream_mode=["updates", "checkpoints", "tasks"],
                    version="v2",
                    durability="sync",
                ):
                    self._record_stream_part(execution_id, request.run_id, part)
                snapshot = graph.get_state(graph_config)
                if any(task.interrupts for task in snapshot.tasks):
                    status = "suspended"
                    self.store.update_status(execution_id, "suspended")
                    # The deadline timer can fire while the worker transitions
                    # into suspension. Recheck after committing the wait so a
                    # timer that observed 'running' cannot leave it parked.
                    if execution_remaining_ms(request) <= 0:
                        self._finish_deadline(self.store.get(execution_id))
                        return
                    if cancel_event.is_set() or self.store.cancellation_requested(execution_id)[0]:
                        raise CancellationError("Cancellation retained before review suspension.")
                    pending = next(item.value for task in snapshot.tasks for item in task.interrupts)
                    self.store.append_event(execution_id, "RunSuspended", {"reason": "clarification" if pending.get("kind") == "clarification" else "invocation_review",
                        "questionId": pending.get("questionId"), "question": pending.get("question"), "threadId": request.thread_id,
                        "checkpointId": snapshot.config.get("configurable", {}).get("checkpoint_id"),
                        "requestId": pending.get("requestId"), "revision": pending.get("revision"),
                        "toolCallId": pending.get("call", {}).get("toolCallId") or pending.get("toolCallId")})
                    return
                output = snapshot.values.get("output") if isinstance(snapshot.values, dict) else None
                attempt_count = max(attempt_count, int(snapshot.values.get("attempt_count", 0)))
                snapshot_usage = snapshot.values.get("usage") if isinstance(snapshot.values, dict) else None
                if isinstance(snapshot_usage, dict):
                    usage = {
                        key: value if isinstance(value, int) and not isinstance(value, bool) else None
                        for key, value in snapshot_usage.items()
                        if key in {"inputTokens", "outputTokens", "totalTokens"}
                    }
                    usage = {
                        key: usage.get(key)
                        for key in ("inputTokens", "outputTokens", "totalTokens")
                    }
                self.store.update_attempt_count(execution_id, attempt_count)
                self.store.append_event(execution_id, "RunCompleted", {"outputCharacters": len(output or "")})
        except LangGraphModelError as exc:
            if isinstance(exc, CancellationError) and execution_remaining_ms(request) <= 0:
                exc = ExecutionDeadlineError("The retained execution deadline was reached.")
            status = "cancelled" if isinstance(exc, CancellationError) else "unknown" if isinstance(exc, OutcomeUnknownError) else "failed"
            error = {
                "code": exc.code,
                "message": str(exc),
                "failureKind": exc.failure_kind,
                "retryable": bool(exc.retryable),
            }
            if self.store.get(execution_id)["status"] in {"queued", "running", "suspended"}:
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
            if self.store.get(execution_id)["status"] in {"queued", "running", "suspended"}:
                self.store.append_event(execution_id, "RunFailed" if status == "failed" else "RunReconciliationRequired", {"code": error["code"]})
        finally:
            finished = False if status == "suspended" else self.store.finish(
                execution_id,
                status=status,
                finished_at=now_iso(),
                output=output,
                error=error,
                attempt_count=attempt_count,
                usage=usage,
            )
            if finished:
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

    def recovery_eligibility(self, record: dict[str, Any]) -> dict[str, Any]:
        """Read-only safety snapshot. It never adopts or schedules graph state."""
        view = {"executionId": record["execution_id"], "runId": record["run_id"], "threadId": record["thread_id"],
                "checkpointId": record["checkpoint_id"], "eligible": False, "reason": "reconciliation_required"}
        try:
            request = StartRunRequest.model_validate(json.loads(record["request_json"]))
            if request.execution is None:
                return {**view, "reason": "legacy_policy"}
            with SqliteSaver.from_conn_string(str(self.config.database_path)) as saver:
                native = saver.get_tuple({"configurable": {"thread_id": request.thread_id}})
            if native:
                view["checkpointId"] = native.config["configurable"]["checkpoint_id"]
            if record["status"] == "unknown":
                return view
            values = native.checkpoint.get("channel_values", {}) if native else {}
            operation = json.loads(record["pending_operation_json"]) if record.get("pending_operation_json") else None
            if values.get("execution_run_id") != request.run_id or not checkpoint_contains_operation(values, operation):
                return view
            if record["cancel_requested"]:
                return {**view, "reason": "cancelled"}
            if execution_remaining_ms(request) <= 0:
                return {**view, "reason": "deadline_reached"}
            if record["status"] == "suspended":
                return {**view, "reason": "waiting_review"}
            return {**view, "eligible": True, "reason": "safe_checkpoint"}
        except (TypeError, ValueError, KeyError):
            return view

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
    await service.recover_runs()
    service.store.mark_incomplete_unknown(
        "SERVICE_RESTARTED",
        "The LangGraph service restarted before a terminal result was recorded.",
        legacy_only=True,
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
        runtime = request.app.state.service.health()
        return StartRunResponse(
            execution_id=record["execution_id"],
            run_id=record["run_id"],
            thread_id=record["thread_id"],
            graph=record["graph"],
            status=record["status"],
            idempotent=not idempotent,
            service_version=runtime.service_version,
            langgraph_version=runtime.langgraph_version,
            python_version=runtime.python_version,
        )

    @app.get("/v1/runs/{execution_id}", response_model=RunInspection)
    async def inspect_run(request: Request, execution_id: str) -> RunInspection:
        try:
            return request.app.state.service.inspection(execution_id)
        except RunNotFoundError as exc:
            raise HTTPException(status_code=404, detail="LangGraph execution not found.") from exc

    @app.get("/v1/recovery/diagnostics", response_model=RecoveryDiagnosticsResponse)
    async def recovery_diagnostics(
        request: Request,
        limit: int = Query(default=100, ge=1, le=100),
    ) -> RecoveryDiagnosticsResponse:
        diagnostics = request.app.state.service.store.recovery_diagnostics(limit)
        records = request.app.state.service.store.recovery_runs(limit + 1)
        owned_runs = [request.app.state.service.recovery_eligibility(record) for record in records[:limit]]
        diagnostics["truncated"] = diagnostics["truncated"] or len(records) > limit
        has_attention = bool(
            diagnostics["orphanCheckpointThreads"]
            or diagnostics["orphanWriteCount"]
            or diagnostics["uncheckpointedRuns"]
            or any(record["status"] == "unknown" for record in records[:limit])
        )
        return RecoveryDiagnosticsResponse(
            status="attention" if has_attention else "clean",
            limit=limit,
            owned_runs=owned_runs,
            message=(
                "Recovery diagnostics found state without a complete ownership chain."
                if has_attention
                else "No orphan checkpoint or uncheckpointed run state was found."
            ),
            **diagnostics,
        )

    @app.post("/v1/runs/{execution_id}/resume")
    async def resume_run(request: Request, execution_id: str, body: ResumeRunRequest | TaskInputResumeRequest):
        service = request.app.state.service
        try:
            expected = "Bearer " + host_key(str(service.config.capability_host_key_file))
        except (OSError, ValueError):
            raise HTTPException(status_code=503, detail="Native resume credential is unavailable.")
        if not secrets.compare_digest(request.headers.get("authorization", ""), expected):
            raise HTTPException(status_code=401, detail="Native resume requires the trusted capability host credential.")
        try:
            await service.resume_run(execution_id, body)
            return service.inspection(execution_id)
        except RunNotFoundError as exc:
            raise HTTPException(status_code=404, detail="LangGraph execution not found.") from exc
        except RunConflictError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

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
        key: request.get(key)
        for key in (
            "run_id",
            "live_eval",
            "session_id",
            "client_turn_id",
            "prompt",
            "system_instruction",
            "model",
            "graph",
            "thread_id",
            "durability",
            "max_attempts",
            "timeout_ms",
            "context",
            "tools",
        )
    }
    return hashlib.sha256(canonical_json(immutable).encode()).hexdigest()


def execution_remaining_ms(request: StartRunRequest) -> int:
    if request.execution is None:
        return 2**31 - 1
    deadline = datetime.fromisoformat(request.execution.deadline_at.replace("Z", "+00:00"))
    return int((deadline - datetime.now(timezone.utc)).total_seconds() * 1000)


def checkpoint_contains_operation(values: dict[str, Any], operation: dict[str, Any] | None) -> bool:
    """A receipt alone is insufficient; graph state must contain the operation."""
    if operation is None:
        return True
    if operation["kind"] == "model":
        return values.get("round_count", 0) >= operation.get("round", 1)
    if operation["kind"] == "context":
        return values.get("working_compaction_revision", 0) >= operation.get("compactionRevision", 1)
    return values.get("round_count", 0) >= operation.get("round", 1) and values.get("tool_call_count", 0) >= operation.get("callCount", 1) and any(
        message.get("role") == "tool" and message.get("tool_call_id") == operation.get("toolCallId")
        for message in values.get("messages", []))


def graph_input_for_turn(
    request: StartRunRequest,
    initial_messages: list[dict[str, Any]],
    checkpoint: Any,
    emit: Callable[[str, dict[str, Any]], None],
) -> dict[str, Any]:
    """Build one turn's graph input from the existing native thread when present.

    LangGraph checkpoint state is the native short-term transcript for this service.
    A later turn must not replace it with a fresh context snapshot or replay the
    previous user message. Per-turn counters are reset while the message history is
    carried forward explicitly so the graph's state contract remains inspectable.
    """

    values = getattr(checkpoint, "values", None)
    previous_messages = values.get("messages") if isinstance(values, dict) else None
    stored_context_revision = values.get("context_compaction_revision", 0) if isinstance(values, dict) else 0
    if not isinstance(stored_context_revision, int) or isinstance(stored_context_revision, bool) or stored_context_revision < 0:
        stored_context_revision = 0
    requested_context_revision = (
        request.context.compaction_revision
        if request.context is not None and request.context.compaction_revision is not None
        else None
    )
    if not isinstance(previous_messages, list) or not values.get("output"):
        return {
            "prompt": request.prompt,
            "system_instruction": request.system_instruction,
            "messages": initial_messages,
            "output": "",
            "model_provider": request.model.provider,
            "model_name": request.model.model,
            "node": "",
            "attempt_count": 0,
            "round_count": 0,
            "tool_call_count": 0,
            "pending_tool_calls": [],
            "usage": {"inputTokens": None, "outputTokens": None, "totalTokens": None},
            "context_compaction_revision": requested_context_revision or 0,
        }

    if requested_context_revision is not None and requested_context_revision < stored_context_revision:
        raise ConfigurationError("The LangGraph context compaction revision moved backwards.")

    messages = [message for message in previous_messages if isinstance(message, dict)]
    checkpoint_config = getattr(checkpoint, "config", {})
    configurable = checkpoint_config.get("configurable") if isinstance(checkpoint_config, dict) else {}
    checkpoint_id = configurable.get("checkpoint_id") if isinstance(configurable, dict) else None
    if requested_context_revision is not None and requested_context_revision > stored_context_revision:
        # A compacted shared snapshot is a deliberate replacement for the
        # previous native transcript. Keeping the old checkpoint messages here
        # would defeat compaction and can re-trigger the same provider overflow.
        emit(
            "CheckpointContextReplaced",
            {
                "source": "shared-context-snapshot",
                "checkpointId": checkpoint_id if isinstance(checkpoint_id, str) else None,
                "previousCompactionRevision": stored_context_revision,
                "compactionRevision": requested_context_revision,
                "messageCount": len(initial_messages),
            },
        )
        return {
            "prompt": request.prompt,
            "system_instruction": request.system_instruction,
            "messages": initial_messages,
            "output": "",
            "model_provider": request.model.provider,
            "model_name": request.model.model,
            "node": "",
            "attempt_count": 0,
            "round_count": 0,
            "tool_call_count": 0,
            "pending_tool_calls": [],
            "usage": {"inputTokens": None, "outputTokens": None, "totalTokens": None},
            "context_compaction_revision": requested_context_revision,
        }

    if not any(message.get("role") == "user" and message.get("content") == request.prompt for message in messages[-1:]):
        messages.append({"role": "user", "content": request.prompt})
    emit(
        "CheckpointLoaded",
        {
            "source": "langgraph-checkpoint",
            "checkpointId": checkpoint_id if isinstance(checkpoint_id, str) else None,
            "messageCount": len(messages),
            "previousOutputCharacters": len(str(values.get("output", ""))),
        },
    )
    return {
        "prompt": request.prompt,
        "system_instruction": request.system_instruction,
        "messages": messages,
        "output": "",
        "model_provider": request.model.provider,
        "model_name": request.model.model,
        "node": "",
        "attempt_count": 0,
        "round_count": 0,
        "tool_call_count": 0,
        "pending_tool_calls": [],
        "usage": {"inputTokens": None, "outputTokens": None, "totalTokens": None},
        "context_compaction_revision": requested_context_revision if requested_context_revision is not None else stored_context_revision,
    }


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
        tool_call_count=sum(1 for event in events if event["kind"] == "ToolCallRequested"),
        tool_attempt_count=sum(1 for event in events if event["kind"] == "ToolExecutionStarted"),
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


def load_context_messages(
    context_root: Path,
    request: StartRunRequest,
    emit: Callable[[str, dict[str, Any]], None],
) -> list[dict[str, Any]]:
    """Load the Lab-prepared snapshot for this turn.

    The TypeScript runner prepares the snapshot before dispatch. LangGraph reads
    that immutable record and keeps its native graph checkpoint as separate
    execution state. A missing snapshot ID retains a deliberately explicit
    transcript fallback for direct platform-service tests and older local
    callers; the Lab server path never uses that fallback.
    """
    messages: list[dict[str, Any]] = [{"role": "system", "content": request.system_instruction}]
    if request.context is None:
        return messages + [{"role": "user", "content": request.prompt}]

    emit("ContextPreparationStarted", {"sessionId": request.context.session_id, "turnId": request.context.turn_id})
    session_id = request.context.session_id
    if request.context.snapshot_id:
        return load_context_snapshot(context_root, request, emit)
    transcript_path = (context_root / session_id / "transcript.jsonl").resolve()
    expected_root = context_root.resolve()
    if expected_root not in transcript_path.parents:
        raise ConfigurationError("The LangGraph context path escaped the configured context root.")
    try:
        transcript = transcript_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ConfigurationError("The LangGraph context transcript could not be read.") from exc
    if len(transcript.encode("utf-8")) > 10 * 1024 * 1024:
        raise ConfigurationError("The LangGraph context transcript exceeds the configured safety limit.")
    for line_number, line in enumerate(transcript.splitlines(), start=1):
        try:
            message = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ConfigurationError(f"The LangGraph context transcript is invalid at line {line_number}.") from exc
        if not isinstance(message, dict) or not isinstance(message.get("role"), str) or not isinstance(message.get("content"), str):
            raise ConfigurationError(f"The LangGraph context transcript has an invalid message at line {line_number}.")
        role = message["role"]
        if role == "developer":
            role = "system"
        if role not in {"system", "user", "assistant", "tool"}:
            raise ConfigurationError(f"The LangGraph context transcript has an unsupported role at line {line_number}.")
        if len(message["content"]) > 100_000:
            raise ConfigurationError(f"The LangGraph context message is too large at line {line_number}.")
        native_message: dict[str, Any] = {"role": role, "content": message["content"]}
        metadata = message.get("metadata")
        if role == "tool" and isinstance(metadata, dict):
            if isinstance(metadata.get("toolCallId"), str):
                native_message["tool_call_id"] = metadata["toolCallId"]
            if isinstance(metadata.get("toolName"), str):
                native_message["name"] = metadata["toolName"]
        messages.append(native_message)
    if not any(message.get("role") == "user" and message.get("content") == request.prompt for message in messages):
        messages.append({"role": "user", "content": request.prompt})
    emit("ContextPrepared", {
        "sessionId": session_id,
        "turnId": request.context.turn_id,
        "contextSource": "canonical-transcript",
        "messageCount": len(messages),
        "snapshotId": None,
        "quality": "estimated",
    })
    return messages


def load_context_snapshot(
    context_root: Path,
    request: StartRunRequest,
    emit: Callable[[str, dict[str, Any]], None],
) -> list[dict[str, Any]]:
    assert request.context is not None and request.context.snapshot_id is not None
    session_id = request.context.session_id
    snapshot_id = request.context.snapshot_id
    snapshot_path = (context_root / session_id / "snapshots" / f"{snapshot_id}.json").resolve()
    expected_root = context_root.resolve()
    if expected_root not in snapshot_path.parents:
        raise ConfigurationError("The LangGraph context snapshot path escaped the configured context root.")
    try:
        snapshot_text = snapshot_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ConfigurationError("The shared LangGraph context snapshot could not be read.") from exc
    if len(snapshot_text.encode("utf-8")) > 10 * 1024 * 1024:
        raise ConfigurationError("The shared LangGraph context snapshot exceeds the configured safety limit.")
    try:
        snapshot = json.loads(snapshot_text)
    except json.JSONDecodeError as exc:
        raise ConfigurationError("The shared LangGraph context snapshot is not valid JSON.") from exc
    if not isinstance(snapshot, dict):
        raise ConfigurationError("The shared LangGraph context snapshot is not an object.")
    if snapshot.get("snapshotId") != snapshot_id or snapshot.get("sessionId") != session_id:
        raise ConfigurationError("The shared LangGraph context snapshot identity does not match the request.")
    if request.context.compaction_revision is not None and request.context.compaction_revision != snapshot.get("compactionRevision"):
        raise ConfigurationError("The shared LangGraph context snapshot compaction revision does not match the request.")
    raw_messages = snapshot.get("messages")
    if not isinstance(raw_messages, list):
        raise ConfigurationError("The shared LangGraph context snapshot has no message list.")
    messages = [native_context_message(message, index) for index, message in enumerate(raw_messages, start=1)]
    if not any(message.get("role") == "user" and message.get("content") == request.prompt for message in messages):
        raise ConfigurationError("The shared LangGraph context snapshot does not contain the admitted user turn.")
    budget = snapshot.get("budget") if isinstance(snapshot.get("budget"), dict) else {}
    if request.context.context_window_tokens is not None and request.context.context_window_tokens != budget.get("contextWindowTokens"):
        raise ConfigurationError("The shared LangGraph context window does not match the request.")
    compaction = snapshot.get("compaction")
    emit(
        "ContextRecoveryPrepared" if is_provider_overflow_compaction(compaction) else "ContextPrepared",
        {
            "sessionId": session_id,
            "turnId": request.context.turn_id,
            "contextSource": "shared-snapshot",
            "messageCount": len(messages),
            "snapshotId": snapshot_id,
            "sessionRevision": snapshot.get("sessionRevision"),
            "compactionRevision": snapshot.get("compactionRevision"),
            "inputTokens": budget.get("inputTokens"),
            "remainingTokens": budget.get("remainingTokens"),
            "remainingPercent": budget.get("remainingPercent"),
            "pressure": budget.get("pressure"),
            "quality": budget.get("quality", "unknown"),
            "compacted": compaction is not None,
        },
    )
    return messages


def is_provider_overflow_compaction(value: Any) -> bool:
    """Identify the one recovery snapshot that follows a provider rejection."""

    return isinstance(value, dict) and value.get("trigger") == "provider_overflow"


def native_context_message(message: Any, line_number: int) -> dict[str, Any]:
    if not isinstance(message, dict) or not isinstance(message.get("role"), str) or not isinstance(message.get("content"), str):
        raise ConfigurationError(f"The shared LangGraph context snapshot has an invalid message at index {line_number}.")
    role = message["role"]
    if role == "developer":
        role = "system"
    if role not in {"system", "user", "assistant", "tool"}:
        raise ConfigurationError(f"The shared LangGraph context snapshot has an unsupported role at index {line_number}.")
    content = message["content"]
    if len(content) > 100_000:
        raise ConfigurationError(f"The shared LangGraph context message is too large at index {line_number}.")
    native_message: dict[str, Any] = {"role": role, "content": content}
    metadata = message.get("metadata")
    if role == "tool" and isinstance(metadata, dict):
        if isinstance(metadata.get("toolCallId"), str):
            native_message["tool_call_id"] = metadata["toolCallId"]
        if isinstance(metadata.get("toolName"), str):
            native_message["name"] = metadata["toolName"]
    return native_message
