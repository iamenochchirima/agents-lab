from pathlib import Path

from langgraph.checkpoint.sqlite import SqliteSaver

from variants.baseline.graph import ModelConfig, build_baseline_graph


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
