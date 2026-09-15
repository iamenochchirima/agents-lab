import pytest
from pydantic import ValidationError

from protocol.models import StartRunRequest


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
