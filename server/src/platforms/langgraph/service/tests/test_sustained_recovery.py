"""Recovery proves native checkpoint safety, rather than replaying HTTP input."""

import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from langgraph.checkpoint.sqlite import SqliteSaver

from protocol.models import StartRunRequest
from service.store import SQLiteRunStore
from service.tests.test_service import make_client, start_payload, wait_for_terminal
from variants.baseline.graph import ConfigurationError, ModelConfig, build_baseline_graph


def sustained_request(run_id: str, *, expired: bool = False) -> StartRunRequest:
    return StartRunRequest.model_validate({**start_payload(run_id, "fake-tool-call"), "execution": {
        "schemaVersion": 1, "mode": "sustained", "modelTimeoutMs": 500,
        "deadlineAt": (datetime.now(timezone.utc) + timedelta(seconds=-1 if expired else 30)).isoformat(),
    }})


def retain_checkpoint(path: Path, request: StartRunRequest, *, pending: dict | None = None, cancelled: bool = False) -> None:
    store = SQLiteRunStore(path / "langgraph.sqlite")
    execution_id = f"langgraph:{request.run_id}"
    store.create_or_get({**request.model_dump(), "native_request": request.model_dump(by_alias=True),
        "execution_id": execution_id, "request_fingerprint": "retained-fixture", "provider": request.model.provider,
        "model": request.model.model, "prompt_hash": hashlib.sha256(request.prompt.encode()).hexdigest()})
    store.update_status(execution_id, "running", started_at="2026-10-10T10:00:00Z")
    store.update_attempt_count(execution_id, 1)
    store.set_pending_operation(execution_id, pending)
    if cancelled:
        store.request_cancel(execution_id, "Retained cancellation")
    store.close()
    with SqliteSaver.from_conn_string(str(path / "langgraph.sqlite")) as saver:
        graph = build_baseline_graph(model=ModelConfig("fake", "fake-tool-call", None, 500), emit=lambda *_: None,
            is_cancelled=lambda: False, run_id=request.run_id, max_attempts=2, checkpointer=saver)
        graph.update_state({"configurable": {"thread_id": request.thread_id}}, {
            "execution_run_id": request.run_id, "prompt": request.prompt, "system_instruction": request.system_instruction,
            "messages": [{"role": "system", "content": request.system_instruction}, {"role": "user", "content": request.prompt},
                {"role": "assistant", "content": None, "tool_calls": [{"id": "original-call", "name": "calculator", "arguments": {"operation": "add", "left": 17, "right": 25}}]}],
            "round_count": 1, "attempt_count": 1, "tool_call_count": 0,
            "pending_tool_calls": [{"id": "original-call", "name": "calculator", "arguments": {"operation": "add", "left": 17, "right": 25}}],
            "usage": {"inputTokens": None, "outputTokens": None, "totalTokens": None},
        }, as_node="model")


def test_safe_checkpoint_recovers_original_call_and_counters(tmp_path: Path) -> None:
    request = sustained_request("safe-restart")
    retain_checkpoint(tmp_path, request)
    with make_client(tmp_path) as client:
        inspection = wait_for_terminal(client, "langgraph:safe-restart")
        assert inspection["status"] == "completed"
        recovered = [event for event in inspection["events"] if event["kind"] == "RunRecovered"]
        assert len(recovered) == 1
        assert recovered[0]["payload"]["threadId"] == request.thread_id
        tools = [event for event in inspection["events"] if event["kind"] == "ToolExecutionStarted"]
        assert [event["payload"]["toolCallId"] for event in tools] == ["original-call"]
        # Recovery starts after the first model checkpoint, so no fresh prompt
        # inference or reset to round one is permitted.
        models = [event for event in inspection["events"] if event["kind"] == "ModelRequested"]
        assert [event["payload"]["round"] for event in models] == [2]
        assert inspection["result"]["attemptCount"] == 1
        assert inspection["result"]["startedAt"] == "2026-10-10T10:00:00Z"


@pytest.mark.parametrize("pending", [
    {"kind": "model", "round": 2, "requestSent": True},
    {"kind": "tool", "round": 1, "toolCallId": "original-call", "callCount": 1},
    {"kind": "context", "compactionRevision": 1},
])
def test_uncheckpointed_effect_or_summary_requires_reconciliation(tmp_path: Path, pending: dict) -> None:
    request = sustained_request("unsafe-restart")
    retain_checkpoint(tmp_path, request, pending=pending)
    with make_client(tmp_path) as client:
        inspection = wait_for_terminal(client, "langgraph:unsafe-restart")
        assert inspection["status"] == "unknown"
        assert inspection["result"]["error"]["code"] == "LANGGRAPH_RECOVERY_RECONCILIATION_REQUIRED"
        assert not any(event["kind"] in {"ModelRequested", "ToolExecutionStarted", "RunRecovered"} for event in inspection["events"])
        diagnostics = client.get("/v1/recovery/diagnostics").json()
        assert diagnostics["status"] == "attention"
        owned = next(run for run in diagnostics["ownedRuns"] if run["runId"] == request.run_id)
        assert owned["eligible"] is False
        assert owned["reason"] == "reconciliation_required"
        assert owned["checkpointId"] is not None


@pytest.mark.parametrize("cancelled,expired,expected", [(True, False, "cancelled"), (False, True, "failed")])
def test_recovery_keeps_cancellation_and_absolute_deadline(tmp_path: Path, cancelled: bool, expired: bool, expected: str) -> None:
    request = sustained_request("stopped-restart", expired=expired)
    retain_checkpoint(tmp_path, request, cancelled=cancelled)
    with make_client(tmp_path) as client:
        inspection = wait_for_terminal(client, "langgraph:stopped-restart")
        assert inspection["status"] == expected
        assert not any(event["kind"] == "ToolExecutionStarted" for event in inspection["events"])


def test_local_service_rejects_second_execution_owner(tmp_path: Path) -> None:
    with make_client(tmp_path):
        with pytest.raises(RuntimeError, match="Another LangGraph service owns"):
            with make_client(tmp_path):
                pass


def test_deadline_cancels_active_model_with_timeout_evidence(tmp_path: Path) -> None:
    request = sustained_request("deadline-active")
    payload = request.model_dump(by_alias=True)
    payload["model"]["model"] = "fake-cancel"
    payload["execution"]["deadlineAt"] = (datetime.now(timezone.utc) + timedelta(milliseconds=100)).isoformat()
    with make_client(tmp_path) as client:
        assert client.post("/v1/runs", json=payload).status_code == 202
        inspection = wait_for_terminal(client, "langgraph:deadline-active")
        assert inspection["status"] == "failed"
        assert inspection["result"]["error"]["code"] == "EXECUTION_DEADLINE_EXCEEDED"


def test_terminal_model_checkpoint_projects_without_provider_replay(tmp_path: Path) -> None:
    request = sustained_request("terminal-restart")
    retain_checkpoint(tmp_path, request, pending={"kind": "model", "round": 1})
    with SqliteSaver.from_conn_string(str(tmp_path / "langgraph.sqlite")) as saver:
        graph = build_baseline_graph(model=ModelConfig("fake", "fake-tool-call", None, 500), emit=lambda *_: None,
            is_cancelled=lambda: False, run_id=request.run_id, max_attempts=2, checkpointer=saver)
        graph.update_state({"configurable": {"thread_id": request.thread_id}},
            {"pending_tool_calls": [], "output": "Retained final answer"}, as_node="model")
    with make_client(tmp_path) as client:
        inspection = wait_for_terminal(client, "langgraph:terminal-restart")
        assert inspection["status"] == "completed"
        assert inspection["result"]["output"] == "Retained final answer"
        assert not any(event["kind"] == "ModelRequested" for event in inspection["events"])


def test_compaction_keeps_user_instructions_and_complete_tool_pairs(tmp_path: Path) -> None:
    events = []
    instruction = {"role": "system", "content": "Immutable skill and instruction"}
    user = {"role": "user", "content": "Finish the original task"}
    call = {"role": "assistant", "content": None, "tool_calls": [{"id": "old", "name": "calculator", "arguments": {"operation": "add", "left": 1, "right": 2}}]}
    result = {"role": "tool", "tool_call_id": "old", "content": "x" * 12000}
    with SqliteSaver.from_conn_string(str(tmp_path / "graph.sqlite")) as saver:
        graph = build_baseline_graph(model=ModelConfig("fake", "fake-success", None, 500),
            emit=lambda kind, payload: events.append((kind, payload)), is_cancelled=lambda: False,
            run_id="compact", max_attempts=1, checkpointer=saver, context_window_tokens=8500)
        output = graph.invoke({"messages": [instruction, user, call, result], "prompt": user["content"],
            "system_instruction": instruction["content"], "round_count": 0, "context_compaction_revision": 0},
            {"configurable": {"thread_id": "compact"}}, durability="sync")
        assert instruction in output["messages"] and user in output["messages"]
        assert call not in output["messages"] and result not in output["messages"]
        assert output["working_compaction_revision"] == 1
        assert output["context_compaction_revision"] == 0
        assert [payload["sourceMessageIndices"] for kind, payload in events if kind == "ContextCompacted"] == [[2, 3]]
        assert not any(message.get("role") == "tool" for message in output["messages"])


def test_exhausted_unpaired_context_fails_before_summary_or_agent_dispatch(tmp_path: Path) -> None:
    events = []
    with SqliteSaver.from_conn_string(str(tmp_path / "graph.sqlite")) as saver:
        graph = build_baseline_graph(model=ModelConfig("fake", "fake-success", None, 500),
            emit=lambda kind, payload: events.append((kind, payload)), is_cancelled=lambda: False,
            run_id="unpaired", max_attempts=1, checkpointer=saver, context_window_tokens=8500)
        with pytest.raises(ConfigurationError, match="no complete tool group"):
            graph.invoke({"messages": [{"role": "system", "content": "Immutable"}, {"role": "user", "content": "Active task"},
                {"role": "assistant", "tool_calls": [{"id": "missing", "name": "calculator", "arguments": {}}], "content": "x" * 14000}],
                "prompt": "Active task", "system_instruction": "Immutable"}, {"configurable": {"thread_id": "unpaired"}}, durability="sync")
        assert not any(kind == "ModelRequested" for kind, _ in events)
