import pytest
from pydantic import ValidationError

from protocol.models import StartRunRequest, thread_id_for_session


def valid_request() -> dict:
    return {
        "protocolVersion": 1,
        "runId": "run-protocol",
        "prompt": "hello",
        "systemInstruction": "answer directly",
        "model": {"provider": "fake", "model": "fake-success"},
        "graph": "baseline",
        "threadId": "run-protocol",
        "durability": "sqlite-sync",
        "maxAttempts": 2,
        "timeoutMs": 30000,
    }


def test_protocol_accepts_the_frozen_baseline_request() -> None:
    request = StartRunRequest.model_validate(valid_request())
    assert request.run_id == request.thread_id


def test_protocol_accepts_context_identity_and_bounded_tool_policy() -> None:
    request = valid_request()
    request["context"] = {"sessionId": "session-conformance", "turnId": "turn-1", "snapshotId": "snapshot-1"}
    request["sessionId"] = "session-conformance"
    request["threadId"] = thread_id_for_session("session-conformance")
    request["tools"] = {"enabledNames": ["calculator"], "maxRounds": 6, "maxCalls": 8}
    parsed = StartRunRequest.model_validate(request)
    assert parsed.context is not None
    assert parsed.context.session_id == "session-conformance"
    assert parsed.context.snapshot_id == "snapshot-1"
    assert parsed.tools is not None
    assert parsed.tools.enabled_names == ["calculator"]


def test_protocol_requires_client_turns_to_use_the_session_thread() -> None:
    request = valid_request()
    request["sessionId"] = "session-conformance"
    request["clientTurnId"] = "turn-1"
    request["threadId"] = thread_id_for_session("session-conformance")
    parsed = StartRunRequest.model_validate(request)
    assert parsed.thread_id == thread_id_for_session("session-conformance")

    request["threadId"] = "run-protocol"
    with pytest.raises(ValidationError, match="threadId"):
        StartRunRequest.model_validate(request)


@pytest.mark.parametrize(
    "tools",
    [
        {"enabledNames": ["calculator", "calculator"]},
        {"enabledNames": ["Calculator"]},
        {"enabledNames": ["calculator"], "maxRounds": 0},
        {"enabledNames": ["calculator"], "maxCalls": 65},
    ],
)
def test_protocol_rejects_invalid_tool_policy(tools: dict) -> None:
    request = valid_request()
    request["tools"] = tools
    with pytest.raises(ValidationError):
        StartRunRequest.model_validate(request)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("protocolVersion", 2),
        ("runId", "../unsafe"),
        ("threadId", "another-thread"),
        ("model", {"provider": "unsupported", "model": "x"}),
        ("apiKey", "must-not-cross-the-seam"),
    ],
)
def test_protocol_rejects_incompatible_or_secret_fields(field: str, value: object) -> None:
    request = valid_request()
    request[field] = value
    with pytest.raises(ValidationError):
        StartRunRequest.model_validate(request)


def test_protocol_rejects_oversized_prompt() -> None:
    request = valid_request()
    request["prompt"] = "x" * 20_001
    with pytest.raises(ValidationError):
        StartRunRequest.model_validate(request)
