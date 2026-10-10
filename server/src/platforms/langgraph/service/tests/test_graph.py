import json
import socket
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Thread
from unittest.mock import patch

import pytest

from langgraph.checkpoint.sqlite import SqliteSaver

from variants.baseline import graph as graph_module
from variants.baseline.graph import (
    ContextOverflowError,
    ModelConfig,
    ProviderError,
    ToolCall,
    build_baseline_graph,
    complete_openrouter,
    complete_openrouter_response,
    parse_openrouter_response,
    CancellationError,
    OutcomeUnknownError,
)


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
    assert not any(kind.startswith("Eval") for kind, _ in events)

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


def test_slow_success_fixture_waits_without_becoming_a_timeout() -> None:
    events: list[tuple[str, dict]] = []
    with SqliteSaver.from_conn_string(":memory:") as checkpointer:
        graph = build_baseline_graph(
            ModelConfig(provider="fake", model="fake-slow-success", api_key=None, timeout_ms=500),
            lambda kind, payload: events.append((kind, payload)),
            lambda: False,
            "run-slow-success-test",
            2,
            checkpointer,
        )
        snapshot = graph.invoke(
            {"prompt": "wait briefly", "system_instruction": "answer", "output": "", "attempt_count": 0},
            {"configurable": {"thread_id": "thread-slow-success-test"}, "run_id": "run-slow-success-test"},
        )

    assert snapshot["output"] == "Fake delayed response: wait briefly"
    assert any(kind == "ModelRequested" for kind, _ in events)


def test_context_overflow_fixture_is_explicit() -> None:
    with SqliteSaver.from_conn_string(":memory:") as checkpointer:
        graph = build_baseline_graph(
            ModelConfig(provider="fake", model="fake-context-overflow", api_key=None, timeout_ms=500),
            lambda _kind, _payload: None,
            lambda: False,
            "run-context-overflow-test",
            1,
            checkpointer,
        )
        with pytest.raises(ContextOverflowError, match="context is too large"):
            graph.invoke(
                {"prompt": "overflow", "system_instruction": "answer", "output": "", "attempt_count": 0},
                {"configurable": {"thread_id": "thread-context-overflow-test"}, "run_id": "run-context-overflow-test"},
            )


def test_tool_turn_uses_a_real_tool_node_and_returns_the_tool_result() -> None:
    events: list[tuple[str, dict]] = []
    with SqliteSaver.from_conn_string(":memory:") as checkpointer:
        graph = build_baseline_graph(
            ModelConfig(provider="fake", model="fake-tool-call", api_key=None, timeout_ms=5_000),
            lambda kind, payload: events.append((kind, payload)),
            lambda: False,
            "run-tool-test",
            2,
            checkpointer,
            tool_names=["calculator"],
            max_rounds=3,
            max_calls=2,
        )
        parts = list(
            graph.stream(
                {"prompt": "Calculate 17 plus 25.", "system_instruction": "Use tools when needed.", "output": "", "attempt_count": 0},
                {"configurable": {"thread_id": "thread-tool-test"}, "run_id": "run-tool-test"},
                stream_mode=["updates", "checkpoints", "tasks"],
                version="v2",
            )
        )
        snapshot = graph.get_state({"configurable": {"thread_id": "thread-tool-test"}})

    assert any(part["type"] == "checkpoints" for part in parts)
    assert snapshot.values["output"] == 'The calculator returned {"value":42}.'
    assert [kind for kind, _ in events if kind == "ModelRequested"] == ["ModelRequested", "ModelRequested"]
    assert [kind for kind, _ in events if kind == "ToolCallRequested"] == ["ToolCallRequested"]
    assert any(kind == "ToolCallValidated" for kind, _ in events)
    completed = next(payload for kind, payload in events if kind == "ToolExecutionCompleted")
    assert completed["resultBytes"] == len('{"value":42}'.encode("utf-8"))


def test_connected_tool_turn_uses_the_selected_fixture_tool_node() -> None:
    events: list[tuple[str, dict]] = []
    with SqliteSaver.from_conn_string(":memory:") as checkpointer:
        graph = build_baseline_graph(
            ModelConfig(provider="fake", model="fake-connected-tool", api_key=None, timeout_ms=5_000),
            lambda kind, payload: events.append((kind, payload)),
            lambda: False,
            "run-connected-tool-test",
            2,
            checkpointer,
            tool_names=["fixture_lookup"],
            max_rounds=3,
            max_calls=2,
        )
        snapshot = graph.invoke(
            {"prompt": "Read the alpha fixture.", "system_instruction": "Use the selected connection.", "output": "", "attempt_count": 0},
            {"configurable": {"thread_id": "thread-connected-tool-test"}, "run_id": "run-connected-tool-test"},
        )

    assert snapshot["output"] == 'The local fixture returned {"key":"alpha","value":"local fixture alpha"}.'
    assert [kind for kind, _ in events if kind == "ModelRequested"] == ["ModelRequested", "ModelRequested"]
    assert [payload["toolName"] for kind, payload in events if kind == "ToolExecutionCompleted"] == ["fixture_lookup"]


def test_connected_tool_turn_crosses_the_local_http_boundary() -> None:
    requests: list[dict] = []

    class FixtureHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append(body)
            response = {
                "providerRequestId": f"python-fixture:{body['requestId']}",
                "statusCode": 200,
                "body": {"key": "alpha", "value": "local fixture alpha"},
            }
            encoded = json.dumps(response).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        events: list[tuple[str, dict]] = []
        with SqliteSaver.from_conn_string(":memory:") as checkpointer:
            graph = build_baseline_graph(
                ModelConfig(provider="fake", model="fake-connected-tool", api_key=None, timeout_ms=5_000),
                lambda kind, payload: events.append((kind, payload)),
                lambda: False,
                "run-connected-http",
                2,
                checkpointer,
                tool_names=["fixture_lookup"],
                connection_bindings=[{"toolName": "fixture_lookup", "connectionRef": "conn_local_fixture", "operations": ["lookup"]}],
                connection_url=f"http://127.0.0.1:{server.server_port}",
                turn_id="turn-connected-http",
                max_rounds=3,
                max_calls=2,
            )
            snapshot = graph.invoke(
                {"prompt": "Read the alpha fixture.", "system_instruction": "Use the selected connection.", "output": "", "attempt_count": 0},
                {"configurable": {"thread_id": "thread-connected-http"}, "run_id": "run-connected-http"},
            )

        assert snapshot["output"] == 'The local fixture returned {"key":"alpha","value":"local fixture alpha"}.'
        assert requests[0]["operation"] == "fixture.lookup"
        completed = next(payload for kind, payload in events if kind == "ToolExecutionCompleted")
        assert completed["connection"]["status"] == "completed"
        assert completed["connection"]["providerRequestIds"] == ["python-fixture:run-connected-http:turn-connected-http:call-fixture-lookup-1"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_mcp_tool_turn_crosses_the_native_streamable_http_boundary() -> None:
    requests: list[dict] = []

    class McpHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append(body)
            method = body.get("method")
            if method == "notifications/initialized":
                self.send_response(202)
                self.end_headers()
                return
            if method == "initialize":
                result = {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "agentlab-local-mcp", "version": "1.0.0"},
                }
            elif method == "tools/list":
                result = {"tools": [{
                    "name": "fixture.lookup",
                    "description": "Read fixture data",
                    "inputSchema": {"type": "object", "properties": {"key": {"type": "string"}}},
                    "_meta": {"agentlabVersion": "1.0.0"},
                }]}
            elif method == "tools/call":
                result = {
                    "structuredContent": {"key": "alpha", "value": "local fixture alpha"},
                    "content": [{"type": "text", "text": '{"key":"alpha","value":"local fixture alpha"}'}],
                    "isError": False,
                }
            else:
                result = {}
            response = {"jsonrpc": "2.0", "id": body.get("id"), "result": result}
            encoded = json.dumps(response).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), McpHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        events: list[tuple[str, dict]] = []
        with SqliteSaver.from_conn_string(":memory:") as checkpointer:
            graph = build_baseline_graph(
                ModelConfig(provider="fake", model="fake-mcp-connected-tool", api_key=None, timeout_ms=5_000),
                lambda kind, payload: events.append((kind, payload)),
                lambda: False,
                "run-mcp-http",
                2,
                checkpointer,
                tool_names=["mcp_fixture_lookup"],
                connection_bindings=[{
                    "toolName": "mcp_fixture_lookup",
                    "connectionRef": "conn_local_mcp_fixture",
                    "operations": ["lookup"],
                    "mcp": {
                        "endpointRef": "local-fixture-mcp",
                        "serverName": "agentlab-local-mcp",
                        "protocolVersion": "2025-06-18",
                        "toolName": "fixture.lookup",
                        "toolVersion": "1.0.0",
                    },
                }],
                connection_url=f"http://127.0.0.1:{server.server_port}",
                turn_id="turn-mcp-http",
                max_rounds=3,
                max_calls=2,
            )
            snapshot = graph.invoke(
                {"prompt": "Read the alpha fixture through MCP.", "system_instruction": "Use the selected MCP connection.", "output": "", "attempt_count": 0},
                {"configurable": {"thread_id": "thread-mcp-http"}, "run_id": "run-mcp-http"},
            )

            checkpoint = graph.get_state({"configurable": {"thread_id": "thread-mcp-http"}})
            assert checkpoint.values["output"] == snapshot["output"]
            assert any(message["role"] == "tool" for message in checkpoint.values["messages"])

            resumed_graph = build_baseline_graph(
                ModelConfig(provider="fake", model="fake-mcp-connected-tool", api_key=None, timeout_ms=5_000),
                lambda kind, payload: events.append((kind, payload)),
                lambda: False,
                "run-mcp-http-resumed",
                2,
                checkpointer,
                tool_names=["mcp_fixture_lookup"],
                connection_bindings=[{
                    "toolName": "mcp_fixture_lookup",
                    "connectionRef": "conn_local_mcp_fixture",
                    "operations": ["lookup"],
                    "mcp": {
                        "endpointRef": "local-fixture-mcp",
                        "serverName": "agentlab-local-mcp",
                        "protocolVersion": "2025-06-18",
                        "toolName": "fixture.lookup",
                        "toolVersion": "1.0.0",
                    },
                }],
                connection_url=f"http://127.0.0.1:{server.server_port}",
                turn_id="turn-mcp-http-resumed",
                max_rounds=3,
                max_calls=2,
            )
            resumed = resumed_graph.invoke(
                {"prompt": "Continue from the MCP checkpoint.", "system_instruction": "Use the selected MCP connection."},
                {"configurable": {"thread_id": "thread-mcp-http"}, "run_id": "run-mcp-http-resumed"},
            )
            assert resumed["output"] == snapshot["output"]
            assert [request["method"] for request in requests] == ["initialize", "notifications/initialized", "tools/list", "tools/call"]

        assert snapshot["output"] == 'The local MCP fixture returned {"key":"alpha","value":"local fixture alpha"}.'
        assert [request["method"] for request in requests] == ["initialize", "notifications/initialized", "tools/list", "tools/call"]
        completed = next(payload for kind, payload in events if kind == "ToolExecutionCompleted")
        assert completed["connection"]["providerRequestIds"] == ["mcp-http:run-mcp-http:turn-mcp-http:call-mcp-fixture-lookup-1"]
        assert completed["connection"]["mcp"]["phase"] == "invocation"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_mcp_discovery_failure_is_a_native_tool_failure_not_an_unknown_outcome() -> None:
    events: list[tuple[str, dict]] = []
    with SqliteSaver.from_conn_string(":memory:") as checkpointer:
        graph = build_baseline_graph(
            ModelConfig(provider="fake", model="fake-mcp-connected-tool", api_key=None, timeout_ms=100),
            lambda kind, payload: events.append((kind, payload)),
            lambda: False,
            "run-mcp-failure",
            2,
            checkpointer,
            tool_names=["mcp_fixture_lookup"],
            connection_bindings=[{
                "toolName": "mcp_fixture_lookup",
                "connectionRef": "conn_local_mcp_fixture",
                "operations": ["lookup"],
                "mcp": {
                    "endpointRef": "local-fixture-mcp",
                    "serverName": "agentlab-local-mcp",
                    "protocolVersion": "2025-06-18",
                    "toolName": "fixture.lookup",
                    "toolVersion": "1.0.0",
                },
            }],
            connection_url="http://127.0.0.1:1",
            turn_id="turn-mcp-failure",
            max_rounds=3,
            max_calls=2,
        )
        result = graph.invoke(
            {"prompt": "Read the unavailable MCP fixture.", "system_instruction": "Use the selected MCP connection.", "output": "", "attempt_count": 0},
            {"configurable": {"thread_id": "thread-mcp-failure"}, "run_id": "run-mcp-failure"},
        )
        feedback = [message for message in result["messages"] if message.get("role") == "tool"]
        assert len(feedback) == 1
        assert feedback[0]["tool_call_id"] == "call-mcp-fixture-lookup-1"
        assert json.loads(feedback[0]["content"])["code"] == "MCP_DISCOVERY_FAILED"
        assert "MCP_DISCOVERY_FAILED" in result["output"]


    failed = next(payload for kind, payload in events if kind == "ToolExecutionFailed")
    assert failed["code"] == "MCP_DISCOVERY_FAILED"
    assert failed["connection"]["status"] == "failed"
    assert failed["connection"]["errorCode"] == "MCP_DISCOVERY_FAILED"
    assert not any(kind == "ToolExecutionUnknown" for kind, _ in events)


def test_mcp_cancellation_during_inflight_call_wins_before_tool_completion() -> None:
    request_seen = Event()
    cancel_requested = Event()

    class McpHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            method = body.get("method")
            if method == "notifications/initialized":
                self.send_response(202)
                self.end_headers()
                return
            if method == "initialize":
                result = {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "agentlab-local-mcp", "version": "1.0.0"},
                }
            elif method == "tools/list":
                result = {"tools": [{
                    "name": "fixture.lookup",
                    "description": "Read fixture data",
                    "inputSchema": {"type": "object"},
                    "_meta": {"agentlabVersion": "1.0.0"},
                }]}
            elif method == "tools/call":
                request_seen.set()
                time.sleep(0.1)
                result = {
                    "structuredContent": {"key": "alpha", "value": "local fixture alpha"},
                    "content": [{"type": "text", "text": '{"key":"alpha","value":"local fixture alpha"}'}],
                    "isError": False,
                }
            else:
                result = {}
            encoded = json.dumps({"jsonrpc": "2.0", "id": body.get("id"), "result": result}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), McpHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    cancel_thread = Thread(target=lambda: (request_seen.wait(2), cancel_requested.set()), daemon=True)
    cancel_thread.start()
    events: list[tuple[str, dict]] = []
    try:
        with SqliteSaver.from_conn_string(":memory:") as checkpointer:
            graph = build_baseline_graph(
                ModelConfig(provider="fake", model="fake-mcp-connected-tool", api_key=None, timeout_ms=5_000),
                lambda kind, payload: events.append((kind, payload)),
                cancel_requested.is_set,
                "run-mcp-cancel",
                2,
                checkpointer,
                tool_names=["mcp_fixture_lookup"],
                connection_bindings=[{
                    "toolName": "mcp_fixture_lookup",
                    "connectionRef": "conn_local_mcp_fixture",
                    "operations": ["lookup"],
                    "mcp": {
                        "endpointRef": "local-fixture-mcp",
                        "serverName": "agentlab-local-mcp",
                        "protocolVersion": "2025-06-18",
                        "toolName": "fixture.lookup",
                        "toolVersion": "1.0.0",
                    },
                }],
                connection_url=f"http://127.0.0.1:{server.server_port}",
                turn_id="turn-mcp-cancel",
                max_rounds=3,
                max_calls=2,
            )
            with pytest.raises(CancellationError):
                graph.invoke(
                    {"prompt": "Read the alpha fixture through MCP.", "system_instruction": "Use the selected MCP connection.", "output": "", "attempt_count": 0},
                    {"configurable": {"thread_id": "thread-mcp-cancel"}, "run_id": "run-mcp-cancel"},
                )
        assert any(kind == "ToolExecutionStarted" for kind, _ in events)
        assert not any(kind == "ToolExecutionCompleted" for kind, _ in events)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        cancel_thread.join(timeout=2)


def test_mcp_lost_response_is_unknown_and_not_a_completed_tool_result() -> None:
    class McpHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            method = body.get("method")
            if method == "notifications/initialized":
                self.send_response(202)
                self.end_headers()
                return
            if method == "initialize":
                result = {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "agentlab-local-mcp", "version": "1.0.0"},
                }
            elif method == "tools/list":
                result = {"tools": [{
                    "name": "fixture.lookup",
                    "description": "Read fixture data",
                    "inputSchema": {"type": "object"},
                    "_meta": {"agentlabVersion": "1.0.0"},
                }]}
            elif method == "tools/call":
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
                return
            else:
                result = {}
            encoded = json.dumps({"jsonrpc": "2.0", "id": body.get("id"), "result": result}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), McpHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    events: list[tuple[str, dict]] = []
    try:
        with SqliteSaver.from_conn_string(":memory:") as checkpointer:
            graph = build_baseline_graph(
                ModelConfig(provider="fake", model="fake-mcp-connected-tool", api_key=None, timeout_ms=5_000),
                lambda kind, payload: events.append((kind, payload)),
                lambda: False,
                "run-mcp-unknown",
                2,
                checkpointer,
                tool_names=["mcp_fixture_lookup"],
                connection_bindings=[{
                    "toolName": "mcp_fixture_lookup",
                    "connectionRef": "conn_local_mcp_fixture",
                    "operations": ["lookup"],
                    "mcp": {
                        "endpointRef": "local-fixture-mcp",
                        "serverName": "agentlab-local-mcp",
                        "protocolVersion": "2025-06-18",
                        "toolName": "fixture.lookup",
                        "toolVersion": "1.0.0",
                    },
                }],
                connection_url=f"http://127.0.0.1:{server.server_port}",
                turn_id="turn-mcp-unknown",
                max_rounds=3,
                max_calls=2,
            )
            with pytest.raises(OutcomeUnknownError):
                graph.invoke(
                    {"prompt": "Read the alpha fixture through MCP.", "system_instruction": "Use the selected MCP connection.", "output": "", "attempt_count": 0},
                    {"configurable": {"thread_id": "thread-mcp-unknown"}, "run_id": "run-mcp-unknown"},
                )
        unknown = next(payload for kind, payload in events if kind == "ToolExecutionUnknown")
        assert unknown["connection"]["status"] == "unknown"
        assert unknown["connection"]["attemptCount"] == 1
        assert not any(kind == "ToolExecutionCompleted" for kind, _ in events)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_write_fixture_requires_approval_and_executes_after_approval() -> None:
    with SqliteSaver.from_conn_string(":memory:") as checkpointer:
        denied_graph = build_baseline_graph(
            ModelConfig(provider="fake", model="fake-connected-write", api_key=None, timeout_ms=5_000),
            lambda _kind, _payload: None,
            lambda: False,
            "run-write-denied",
            2,
            checkpointer,
            tool_names=["fixture_write"],
            max_rounds=2,
            max_calls=1,
        )
        denied = denied_graph.invoke(
            {"prompt": "Write the fixture.", "system_instruction": "Use the selected connection.", "output": "", "attempt_count": 0},
            {"configurable": {"thread_id": "thread-write-denied"}, "run_id": "run-write-denied"},
        )
        assert denied["output"] == "The local fixture write returned {\"code\":\"APPROVAL_REQUIRED\",\"error\":\"Tool requires an explicit approval: fixture_write\"}."

    with SqliteSaver.from_conn_string(":memory:") as checkpointer:
        approved_graph = build_baseline_graph(
            ModelConfig(provider="fake", model="fake-connected-write", api_key=None, timeout_ms=5_000),
            lambda _kind, _payload: None,
            lambda: False,
            "run-write-approved",
            2,
            checkpointer,
            tool_names=["fixture_write"],
            approved_tool_names=["fixture_write"],
            max_rounds=2,
            max_calls=1,
        )
        approved = approved_graph.invoke(
            {"prompt": "Write the fixture.", "system_instruction": "Use the selected connection.", "output": "", "attempt_count": 0},
            {"configurable": {"thread_id": "thread-write-approved"}, "run_id": "run-write-approved"},
        )
        assert approved["output"] == "The local fixture write returned {\"key\":\"alpha\",\"written\":true}."


def test_tool_call_is_rejected_when_the_tool_is_not_enabled() -> None:
    with pytest.raises(ProviderError, match="not enabled"):
        parse_openrouter_response(
            {
                "choices": [{
                    "message": {
                        "content": None,
                        "tool_calls": [{
                            "id": "call-1",
                            "function": {
                                "name": "calculator",
                                "arguments": '{"operation":"add","left":17,"right":25}',
                            },
                        }],
                    },
                }],
            },
            [],
        )


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

    def close(self) -> None:
        return None


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
    assert json.loads(request.data)["model"] == "openai/test-model"
    assert b"test-openrouter-secret" not in request.data


def test_openrouter_response_is_rejected_before_unbounded_state_growth() -> None:
    oversized = b"x" * (graph_module.MAX_RESPONSE_BYTES + 1)
    with patch.object(graph_module.urllib_request, "urlopen", return_value=_FakeProviderResponse(oversized)):
        with pytest.raises(ProviderError, match="larger than the configured safety limit") as error:
            complete_openrouter(_openrouter_model(), _openrouter_state(), lambda: False)

    assert error.value.code == "LANGGRAPH_RESPONSE_TOO_LARGE"


def test_openrouter_context_overflow_is_classified_without_exposing_provider_body() -> None:
    provider_body = b'{"error":{"message":"maximum context length exceeded: private diagnostic"}}'
    http_error = graph_module.urllib_error.HTTPError(
        "https://router.test/chat/completions",
        400,
        "Bad Request",
        {},
        _FakeProviderResponse(provider_body),
    )
    with patch.object(graph_module.urllib_request, "urlopen", side_effect=http_error):
        with pytest.raises(ContextOverflowError, match="context window was exceeded") as error:
            complete_openrouter(_openrouter_model(), _openrouter_state(), lambda: False)

    assert error.value.code == "LANGGRAPH_CONTEXT_OVERFLOW"
    assert "private diagnostic" not in str(error.value)


def test_openrouter_tool_call_mapping_is_bounded_and_does_not_include_the_secret() -> None:
    response_body = b'{"id":"provider-tool-1","choices":[{"message":{"content":null,"tool_calls":[{"id":"call-1","type":"function","function":{"name":"calculator","arguments":"{\\"operation\\":\\"add\\",\\"left\\":17,\\"right\\":25}"}}]}}],"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}'
    with patch.object(graph_module.urllib_request, "urlopen", return_value=_FakeProviderResponse(response_body)) as urlopen:
        response = complete_openrouter_response(_openrouter_model(), _openrouter_state(), lambda: False, ["calculator"])

    assert response.output is None
    assert response.tool_calls == [ToolCall("call-1", "calculator", {"operation": "add", "left": 17, "right": 25})]
    request = urlopen.call_args.args[0]
    request_body = json.loads(request.data)
    assert request_body["tools"][0]["function"]["name"] == "calculator"
    assert request_body["tool_choice"] == "auto"
    assert b"test-openrouter-secret" not in request.data


def test_openrouter_maps_internal_tool_messages_to_chat_completion_messages() -> None:
    response_body = b'{"choices":[{"message":{"content":"The result is 42."}}]}'
    state = {
        "messages": [
            {"role": "system", "content": "Answer directly."},
            {"role": "user", "content": "Calculate 17 plus 25."},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [{"id": "call-1", "name": "calculator", "arguments": {"operation": "add", "left": 17, "right": 25}}],
            },
            {"role": "tool", "tool_call_id": "call-1", "name": "calculator", "content": '{"value":42}'},
        ],
    }
    with patch.object(graph_module.urllib_request, "urlopen", return_value=_FakeProviderResponse(response_body)) as urlopen:
        complete_openrouter_response(_openrouter_model(), state, lambda: False, ["calculator"])

    request_body = json.loads(urlopen.call_args.args[0].data)
    assert request_body["messages"][2] == {
        "role": "assistant",
        "content": None,
        "tool_calls": [{
            "id": "call-1",
            "type": "function",
            "function": {"name": "calculator", "arguments": '{"operation":"add","left":17,"right":25}'},
        }],
    }
    assert request_body["messages"][3] == {
        "role": "tool",
        "tool_call_id": "call-1",
        "name": "calculator",
        "content": '{"value":42}',
    }


@pytest.mark.parametrize("fixture,max_calls,max_rounds,expected", [
    ("fake-eval-completion", 8, 6, "Baseline eval completed."),
    ("fake-eval-tool", 2, 4, "42"),
    ("fake-eval-context", 8, 6, "conformance-4318"),
    ("fake-eval-loop", 1, 4, None),
    ("fake-eval-loop", 8, 1, None),
])
def test_development_eval_captures_native_requests_and_dispatches(fixture: str, max_calls: int, max_rounds: int, expected: str | None) -> None:
    events: list[tuple[str, dict]] = []
    messages = [{"role": "system", "content": "Recorded instruction."}, {"role": "user", "content": "Answer the task."}]
    if fixture == "fake-eval-context":
        messages = [messages[0], {"role": "user", "content": "Remember conformance-4318."},
                    {"role": "assistant", "content": "Stored the test value."}, messages[-1]]
    with SqliteSaver.from_conn_string(":memory:") as checkpointer:
        graph = build_baseline_graph(
            ModelConfig(provider="fake", model=fixture, api_key=None, timeout_ms=5_000),
            lambda kind, payload: events.append((kind, payload)), lambda: False,
            "run-eval-test", 1, checkpointer, max_calls=max_calls, max_rounds=max_rounds,
        )
        initial = {"prompt": "Answer the task.", "system_instruction": "Recorded instruction.", "messages": messages}
        config = {"configurable": {"thread_id": "thread-eval-test"}, "run_id": "run-eval-test"}
        if expected is None:
            with pytest.raises(ProviderError, match="limit"):
                graph.invoke(initial, config)
        else:
            assert graph.invoke(initial, config)["output"] == expected
    requests = [payload for kind, payload in events if kind == "EvalModelObserved"]
    assert requests[0]["observation"]["messages"] == messages
    assert len(requests) <= max_rounds
    tools = [payload for kind, payload in events if kind == "EvalToolObserved"]
    assert len(tools) <= max_calls
    if fixture == "fake-eval-tool":
        assert tools[0]["output"] == '{"value":42}'
        result = next(message for message in requests[1]["observation"]["messages"] if message["role"] == "tool")
        assert result["toolCallId"] == tools[0]["toolCallId"]
        assert result["content"] == tools[0]["output"]


@pytest.mark.parametrize("experiment, allowance", [("agent-harness-live", 512), ("agent-capabilities-live", 2048)])
@pytest.mark.parametrize("model_id", ["google/gemma-4-31b-it:free", "nvidia/nemotron-3.5-lightning:free", "cohere/north-mini-code:free", "nvidia/nemotron-3-ultra-550b-a55b:free"])
def test_live_openrouter_records_actual_mapping_and_zero_price_controls(experiment: str, allowance: int, model_id: str) -> None:
    requests: list[dict] = []
    state = {**_openrouter_state(), "_live_eval": True, "_live_eval_experiment": experiment}
    model = ModelConfig(provider="openrouter", model=model_id, api_key="test-secret", timeout_ms=5000)
    body = json.dumps({"id": "provider1", "model": "actual-model", "provider": "actual-provider", "choices": [{"message": {"content": None, "tool_calls": [{"id": "call1", "function": {"name": "calculator", "arguments": '{"operation":"add","left":17,"right":25}'}}]}}]}).encode()

    def transport(request, **_kwargs):
        requests.append(json.loads(request.data))
        return _FakeProviderResponse(body)

    with patch.object(graph_module.urllib_request, "urlopen", side_effect=transport):
        response = complete_openrouter_response(model, state, lambda: False, ["calculator"])
    sent = requests[0]
    assert sent["model"] == model.model
    assert sent["max_tokens"] == allowance
    assert sent["provider"] == {"require_parameters": True, "allow_fallbacks": False, "max_price": {"prompt": 0, "completion": 0, "request": 0, "image": 0}}
    receipt = state["_live_eval_observation"]
    assert receipt["providerRequest"] == sent
    assert receipt["toolCalls"][0]["arguments"] == {"operation": "add", "left": 17, "right": 25}
    assert receipt["providerRequestId"] == "provider1"
    assert receipt["providerModel"] == "actual-model"
    assert receipt["providerName"] == "actual-provider"
    assert response.tool_calls[0].tool_call_id == "call1"
    assert "test-secret" not in json.dumps(receipt)


def test_live_openrouter_refuses_paid_model_before_transport_and_retains_failed_request() -> None:
    with patch.object(graph_module.urllib_request, "urlopen") as transport:
        with pytest.raises(graph_module.ConfigurationError):
            complete_openrouter_response(_openrouter_model(), {**_openrouter_state(), "_live_eval": True}, lambda: False, [])
        transport.assert_not_called()
    state = {**_openrouter_state(), "_live_eval": True}
    model = ModelConfig(provider="openrouter", model="google/gemma-4-31b-it:free", api_key="test-secret", timeout_ms=5000)
    with patch.object(graph_module.urllib_request, "urlopen", side_effect=graph_module.urllib_error.URLError("lost response")) as transport:
        with pytest.raises(OutcomeUnknownError):
            complete_openrouter_response(model, state, lambda: False, ["calculator"])
        assert transport.call_count == 1
    assert state["_live_eval_observation"]["providerRequest"]["model"] == model.model


def test_behaviour_fixture_requires_correlated_feedback_and_observes_native_deadline() -> None:
    import base64
    directive = lambda value: "[eval-behaviour:" + base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=") + "]"
    prompt = directive({"action": "tool", "toolName": "calculator", "input": {"left": "invalid"}})
    state = {"prompt": prompt, "messages": [{"role": "user", "content": prompt}]}
    first = graph_module.complete_fake("fake-eval-behaviour", state, 1, lambda: False, 500)
    assert first.output is None
    assert first.tool_calls[0].arguments == {"left": "invalid"}
    state["messages"].append({"role": "tool", "tool_call_id": "eval-behaviour-call-1", "content": '{"code":"INVALID_INPUT"}'})
    second = graph_module.complete_fake("fake-eval-behaviour", state, 1, lambda: False, 500)
    assert second.output == 'Tool feedback: {"code":"INVALID_INPUT"}'
    with pytest.raises(graph_module.TimeoutError, match="native timeout"):
        graph_module.complete_fake("fake-eval-behaviour", {"prompt": directive({"action": "slow", "delayMs": 100})}, 1, lambda: False, 10)
    malformed = {"prompt": directive({"action": "malformed"})}
    with pytest.raises(OutcomeUnknownError, match="invalid response shape"):
        graph_module.complete_fake("fake-eval-behaviour", malformed, 1, lambda: False, 500)
    assert malformed["_behaviour_fault_kind"] == "malformed"


def test_failed_connection_read_preserves_actionable_feedback_without_retrying_or_completing() -> None:
    response_body = json.dumps({"providerRequestId": "local-fault-1", "statusCode": 400,
                                "body": {"error": "This record moved. Read the alternate project record."}}).encode()
    with patch.object(graph_module.urllib_request, "urlopen", return_value=_FakeProviderResponse(response_body)) as transport:
        result = graph_module.execute_connection_tool(
            "fixture_lookup", "fixture.lookup", {"key": "project"}, read_only=True,
            connection_url="http://owned-fixture.test", connection_bindings=[{"toolName": "fixture_lookup", "connectionRef": "conn_local_fixture", "operations": ["lookup"]}],
            run_id="read-error-probe", turn_id="turn-1", tool_call_id="call-1", is_cancelled=lambda: False, timeout_ms=500,
        )
    assert result.status == "failed"
    assert result.error_code == "HTTP_400"
    assert json.loads(result.content)["error"] == "This record moved. Read the alternate project record."
    assert result.connection["attemptCount"] == 1
    assert transport.call_count == 1
