"""Actual SQLite graph interruption and service restart, with scripted decisions.

No model network call is made. The test retains the native graph/checkpoint and
isolates only the shared-host source transport and scripted model decision.
"""
import time
from pathlib import Path
from unittest.mock import patch
import pytest

from fastapi.testclient import TestClient
from variants.baseline.graph import ModelResponse, ToolCall, empty_usage
from service.app import create_app
from service.config import ServiceConfig


@pytest.mark.parametrize("final_decision", ["approved", "denied"])
def test_pending_review_survives_service_restart_and_resumes_without_reinference(tmp_path: Path, final_decision: str):
    key = tmp_path / "host.key"
    key.write_text("a" * 64)
    config = ServiceConfig(state_dir=tmp_path / "native", capability_host_key_file=key)
    calls = {"model": 0, "effects": 0}
    review = {"schemaVersion": 1, "requestId": "review-call-a", "revision": 1,
              "runId": "run-review", "status": "pending", "call": {"toolCallId": "call-a", "name": "business_adjust"}}

    def model(*args):
        calls["model"] += 1
        if calls["model"] == 1:
            return ModelResponse(None, [ToolCall("call-a", "business_adjust", {"amount": 500})], empty_usage())
        return ModelResponse("Verified adjustment.", [], empty_usage())

    def execute(*args, **kwargs):
        calls["effects"] += 1
        return {"status": "completed", "content": '{"saved":500}', "durationMs": 1, "attemptCount": 1, "error": None,
                "effect": {"state": "confirmed", "evidence": "fixture applied"}, "presentation": {"mode": "text", "unsupportedContent": []}, "structuredContent": {"saved": 500}}

    payload = {"runId": "run-review", "threadId": "run-review", "prompt": "Adjust.", "systemInstruction": "Use tools.", "model": {"provider": "fake", "model": "fake-success"},
               "tools": {"enabledNames": ["business_adjust"], "approvedNames": [], "maxRounds": 6, "maxCalls": 8},
               "toolCatalog": {"schemaVersion": 1, "revision": "catalog-review", "tools": [{"definition": {"schemaVersion": 1, "name": "business_adjust", "description": "Adjust fixture.", "riskClass": "write", "executionKind": "connection", "approvalMode": "invocation", "inputSchema": {"type": "object", "properties": {"amount": {"type": "integer"}}, "required": ["amount"], "additionalProperties": False}, "limits": {"maxArgumentBytes": 1024, "maxResultBytes": 4096, "timeoutMs": 5000}}, "source": {"id": "business", "version": "1.0.0", "digest": "fixture"}, "execution": {"kind": "hosted", "key": "business:adjust"}, "failurePolicy": "feedback"}]}}
    endpoint = "/v1/runs/langgraph:run-review"
    with patch("variants.baseline.graph.complete_model", side_effect=model), patch("variants.baseline.graph.prepare_hosted", return_value=review), patch("variants.baseline.graph.execute_hosted", side_effect=execute):
        with TestClient(create_app(config)) as client:
            assert client.post("/v1/runs", json=payload).status_code == 202
            for _ in range(100):
                inspection = client.get(endpoint).json()
                if inspection["status"] == "suspended":
                    break
                time.sleep(.01)
            assert inspection["status"] == "suspended"
            assert inspection["result"] is None
            assert calls == {"model": 1, "effects": 0}
        # Shutdown/restart preserves the suspended row and actual graph checkpoint.
        with TestClient(create_app(config)) as client:
            assert client.get(endpoint).json()["status"] == "suspended"
            decision = {"kind": "invocation_review", "requestId": "review-call-a", "revision": 1, "decisionId": "decision-a", "toolCallId": "call-a", "decision": final_decision}
            assert client.post(endpoint + "/resume", json=decision).status_code == 401
            wrong = {**decision, "toolCallId": "other"}
            headers = {"authorization": "Bearer " + "a" * 64}
            assert client.post(endpoint + "/resume", json=wrong, headers=headers).status_code == 409
            for revision in (2, 3):
                review["revision"] = revision
                renewal = {**decision, "revision": revision, "decision": "renewed", "decisionId": f"renew-{revision}"}
                response = client.post(endpoint + "/resume", json=renewal, headers=headers)
                assert response.status_code == 200, response.text
                for _ in range(100):
                    inspection = client.get(endpoint).json()
                    renewed_events = [event for event in inspection["events"] if event["kind"] == "InvocationReviewRenewed" and event["payload"]["revision"] == revision]
                    if inspection["status"] == "suspended" and renewed_events:
                        break
                    time.sleep(.01)
                assert inspection["status"] == "suspended", inspection
                assert calls == {"model": 1, "effects": 0}
            decision["revision"] = 3
            response = client.post(endpoint + "/resume", json=decision, headers=headers)
            assert response.status_code == 200, response.text
            for _ in range(100):
                inspection = client.get(endpoint).json()
                if inspection["status"] in {"completed", "failed"}:
                    break
                time.sleep(.01)
            assert inspection["status"] == "completed", inspection
            assert calls == {"model": 2, "effects": 1 if final_decision == "approved" else 0}
            suspended_events = [event for event in inspection["events"] if event["kind"] == "RunSuspended"]
            assert [event["payload"]["revision"] for event in suspended_events] == [1, 2, 3]
            assert all(event["payload"]["checkpointId"] for event in suspended_events)
            assert len({(event["payload"]["requestId"], event["payload"]["revision"]) for event in suspended_events}) == 3
            resumed_events = [event for event in inspection["events"] if event["kind"] == "RunResumed"]
            assert len(resumed_events) == 3
            assert suspended_events[1]["sourceSequence"] > resumed_events[0]["sourceSequence"]
            assert suspended_events[2]["sourceSequence"] > resumed_events[1]["sourceSequence"]
            assert resumed_events[-1]["payload"]["decision"] == final_decision
            resumed_sequence = resumed_events[-1]["sourceSequence"]
            assert any(event["kind"] == "ModelRequested" and event["sourceSequence"] > resumed_sequence for event in inspection["events"])
            if final_decision == "approved":
                event = next(event for event in inspection["events"] if event["kind"] == "ToolExecutionCompleted")
                assert event["payload"]["effect"]["state"] == "confirmed"
                assert event["payload"]["structuredContent"] == {"saved": 500}
            else:
                assert any(event["kind"] == "ToolCallRejected" and event["payload"]["code"] == "INVOCATION_DENIED" for event in inspection["events"])
            assert client.post(endpoint + "/resume", json=decision, headers=headers).status_code == 409
