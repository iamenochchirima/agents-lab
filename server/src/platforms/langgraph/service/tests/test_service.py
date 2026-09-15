import sqlite3
import time
from pathlib import Path

from fastapi.testclient import TestClient

from service.app import create_app
from service.config import ServiceConfig
from service.store import SQLiteRunStore


def make_client(tmp_path: Path) -> TestClient:
    return TestClient(
        create_app(
            ServiceConfig(
                state_dir=tmp_path,
                default_timeout_ms=500,
            )
        )
    )


def start_payload(run_id: str, model: str = "fake-success") -> dict:
    return {
        "runId": run_id,
        "prompt": "Explain a checkpoint in one sentence.",
        "systemInstruction": "Answer directly.",
        "model": {"provider": "fake", "model": model},
        "graph": "baseline",
        "threadId": run_id,
        "durability": "sqlite-sync",
        "maxAttempts": 2,
        "timeoutMs": 500,
    }


def wait_for_terminal(client: TestClient, execution_id: str) -> dict:
    for _ in range(100):
        response = client.get(f"/v1/runs/{execution_id}")
        assert response.status_code == 200
        inspection = response.json()
        if inspection["status"] in {"completed", "failed", "cancelled", "unknown"}:
            return inspection
        time.sleep(0.01)
    raise AssertionError("LangGraph service did not reach a terminal state.")


def test_service_runs_fake_graph_and_exposes_checkpoint_evidence(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        started = client.post("/v1/runs", json=start_payload("run-service-success"))
        assert started.status_code == 202
        assert started.json()["executionId"] == "langgraph:run-service-success"

        inspection = wait_for_terminal(client, "langgraph:run-service-success")
        assert inspection["status"] == "completed"
        assert inspection["result"]["output"].startswith("Fake response:")
        assert inspection["checkpoint"]["count"] >= 2
        assert any(event["kind"] == "ModelRequested" for event in inspection["events"])
        assert inspection["metrics"]["modelCallCount"] == 1

    with sqlite3.connect(tmp_path / "langgraph.sqlite") as connection:
        checkpoint_count = connection.execute("SELECT COUNT(*) FROM checkpoints").fetchone()[0]
    assert checkpoint_count >= 2


def test_service_start_is_idempotent_and_conflicts_are_rejected(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        first = client.post("/v1/runs", json=start_payload("run-idempotent"))
        second = client.post("/v1/runs", json=start_payload("run-idempotent"))
        assert first.status_code == second.status_code == 202
        assert second.json()["idempotent"] is True

        conflict = start_payload("run-idempotent")
        conflict["prompt"] = "A different immutable prompt."
        response = client.post("/v1/runs", json=conflict)
        assert response.status_code == 409


def test_service_cancellation_is_cooperative_and_not_fabricated(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        started = client.post("/v1/runs", json=start_payload("run-cancel", "fake-cancel"))
        assert started.status_code == 202
        cancelled = client.post(
            "/v1/runs/langgraph:run-cancel/cancel",
            json={"reason": "test cancellation"},
        )
        assert cancelled.status_code == 200
        assert cancelled.json()["accepted"] is True
        inspection = wait_for_terminal(client, "langgraph:run-cancel")
        assert inspection["status"] == "cancelled"
        assert inspection["result"]["error"]["failureKind"] == "cancelled"


def test_service_rejects_unknown_fields_and_marks_restart_unknown(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        invalid = start_payload("run-invalid")
        invalid["apiKey"] = "must not cross the seam"
        assert client.post("/v1/runs", json=invalid).status_code == 422

    store = SQLiteRunStore(tmp_path / "restart.sqlite")
    request = {
        "execution_id": "langgraph:run-restart",
        "run_id": "run-restart",
        "thread_id": "run-restart",
        "request_fingerprint": "fingerprint",
        "prompt_hash": "hash",
        "graph": "baseline",
        "provider": "fake",
        "model": "fake-delay",
    }
    store.create_or_get(request)
    store.update_status("langgraph:run-restart", "running", started_at="2026-09-15T10:00:00Z")
    store.mark_incomplete_unknown("SERVICE_RESTARTED", "restart")
    record = store.get("langgraph:run-restart")
    assert record["status"] == "unknown"
    assert store.events("langgraph:run-restart")[-1]["kind"] == "RunReconciliationRequired"
    store.close()
