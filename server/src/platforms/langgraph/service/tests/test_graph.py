from pathlib import Path
from unittest.mock import patch

import pytest

from langgraph.checkpoint.sqlite import SqliteSaver

from variants.baseline import graph as graph_module
from variants.baseline.graph import ModelConfig, ProviderError, build_baseline_graph, complete_openrouter


def test_baseline_graph_uses_real_langgraph_and_persists_checkpoint(tmp_path: Path) -> None:
    events: list[tuple[str, dict]] = []
    database = tmp_path / "checkpoints.sqlite"

    with SqliteSaver.from_conn_string(str(database)) as checkpointer:
        graph = build_baseline_graph(
            ModelConfig(provider="fake", model="fake-success", api_key=None, timeout_ms=5_000),
            lambda kind, payload: events.append((kind, payload)),
            lambda: False,
            "run-graph-test",
            2,
            checkpointer,
        )
        parts = list(
            graph.stream(
                {"prompt": "hello", "system_instruction": "answer", "output": "", "attempt_count": 0},
                {"configurable": {"thread_id": "thread-graph-test"}, "run_id": "run-graph-test"},
                stream_mode=["updates", "checkpoints", "tasks"],
                version="v2",
            )
        )
        snapshot = graph.get_state({"configurable": {"thread_id": "thread-graph-test"}})

    assert any(part["type"] == "checkpoints" for part in parts)
    assert snapshot.values["output"] == "Fake response: hello"
    assert snapshot.values["model_provider"] == "fake"
    assert snapshot.values["model_name"] == "fake-success"
    assert snapshot.values["usage"] == {"inputTokens": None, "outputTokens": None, "totalTokens": None}
    assert any(kind == "ModelRequested" for kind, _ in events)

    with SqliteSaver.from_conn_string(str(database)) as reopened:
        assert reopened.get_tuple({"configurable": {"thread_id": "thread-graph-test"}}) is not None


def test_pre_dispatch_retry_is_bounded_and_observable() -> None:
    events: list[tuple[str, dict]] = []
    with SqliteSaver.from_conn_string(":memory:") as checkpointer:
        graph = build_baseline_graph(
            ModelConfig(provider="fake", model="fake-pre-dispatch-retry", api_key=None, timeout_ms=5_000),
            lambda kind, payload: events.append((kind, payload)),
            lambda: False,
            "run-retry-test",
            2,
            checkpointer,
        )
        list(
            graph.stream(
                {"prompt": "retry", "system_instruction": "answer", "output": "", "attempt_count": 0},
                {"configurable": {"thread_id": "thread-retry-test"}, "run_id": "run-retry-test"},
                stream_mode=["updates", "checkpoints", "tasks"],
                version="v2",
            )
        )

    requests = [payload for kind, payload in events if kind == "ModelRequested"]
    assert [payload["attempt"] for payload in requests] == [1, 2]


class _FakeProviderResponse:
    def __init__(self, body: bytes) -> None:
        self.body = body

    def __enter__(self) -> "_FakeProviderResponse":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self, _size: int) -> bytes:
        body, self.body = self.body, b""
        return body


def _openrouter_model() -> ModelConfig:
    return ModelConfig(
        provider="openrouter",
        model="openai/test-model",
        api_key="test-openrouter-secret",
        timeout_ms=5_000,
    )


def _openrouter_state() -> graph_module.GraphState:
    return {"prompt": "hello", "system_instruction": "answer directly"}


def test_openrouter_response_is_parsed_at_the_provider_boundary() -> None:
    response_body = b'{"id":"provider-1","choices":[{"message":{"content":"hello from OpenRouter"}}],"usage":{"prompt_tokens":4,"completion_tokens":5,"total_tokens":9}}'
    with patch.object(graph_module.urllib_request, "urlopen", return_value=_FakeProviderResponse(response_body)) as urlopen:
        output, usage = complete_openrouter(_openrouter_model(), _openrouter_state(), lambda: False)

    assert output == "hello from OpenRouter"
    assert usage == {"inputTokens": 4, "outputTokens": 5, "totalTokens": 9}
    request = urlopen.call_args.args[0]
    assert request.full_url.endswith("/chat/completions")
    assert b"test-openrouter-secret" not in request.data


def test_openrouter_response_is_rejected_before_unbounded_state_growth() -> None:
    oversized = b"x" * (graph_module.MAX_RESPONSE_BYTES + 1)
    with patch.object(graph_module.urllib_request, "urlopen", return_value=_FakeProviderResponse(oversized)):
        with pytest.raises(ProviderError, match="larger than the configured safety limit") as error:
            complete_openrouter(_openrouter_model(), _openrouter_state(), lambda: False)

    assert error.value.code == "LANGGRAPH_RESPONSE_TOO_LARGE"
