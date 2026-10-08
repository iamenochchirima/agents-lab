"""Focused extension checks: a new tool traverses the real graph and host boundary."""
import base64
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

import pytest
from langgraph.checkpoint.sqlite import SqliteSaver

from variants.baseline.graph import ModelConfig, build_baseline_graph
from variants.baseline.hosted_tools import catalog_tools, validate_arguments


def descriptor():
    return {"definition": {"schemaVersion": 1, "name": "catalog_document_read", "description": "Read a supplied document.",
        "inputSchema": {"type": "object", "additionalProperties": False, "required": ["document"], "properties": {"document": {"type": "string", "minLength": 1}}},
        "riskClass": "read", "executionKind": "connection", "limits": {"maxArgumentBytes": 1024, "maxResultBytes": 4096, "timeoutMs": 2000}},
        "source": {"id": "documents", "version": "1.0.0", "digest": "b" * 64}, "execution": {"kind": "hosted", "key": "documents/read"}, "failurePolicy": "feedback"}


def test_catalog_does_not_silently_drop_tools_and_validates_full_schema():
    value = descriptor()
    snapshot = {"schemaVersion": 1, "revision": "a" * 64, "tools": [value]}
    assert list(catalog_tools(snapshot, [value["definition"]["name"]])) == [value["definition"]["name"]]
    with pytest.raises(ValueError, match="absent"):
        catalog_tools(snapshot, ["missing_tool"])
    assert validate_arguments(value, {"document": "alpha"}) is None
    assert validate_arguments(value, {"document": "alpha", "unexpected": True})[0] == "INVALID_ARGUMENTS"


def test_new_hosted_tool_runs_in_native_graph_without_name_switch(tmp_path: Path):
    requests = []
    class Host(BaseHTTPRequestHandler):
        def do_POST(self):
            assert self.path == "/internal/capabilities/execute"
            assert self.headers["Authorization"] == "Bearer " + "f" * 64
            requests.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            output = json.dumps({"status": "completed", "content": "actual document result", "error": None, "durationMs": 1, "attemptCount": 1}).encode()
            self.send_response(200); self.end_headers(); self.wfile.write(output)
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), Host)
    thread = Thread(target=server.serve_forever, daemon=True); thread.start()
    key_file = tmp_path / "host.key"; key_file.write_text("f" * 64)
    value = descriptor()
    directive = base64.urlsafe_b64encode(json.dumps({"action": "tool", "toolName": value["definition"]["name"], "input": {"document": "alpha"}, "output": "finished"}).encode()).decode().rstrip("=")
    events = []
    try:
        with SqliteSaver.from_conn_string(str(tmp_path / "graph.sqlite")) as checkpoint:
            graph = build_baseline_graph(ModelConfig("fake", "fake-eval-behaviour", None, 5000), lambda kind, payload: events.append((kind, payload)), lambda: False,
                "run-hosted", 1, checkpoint, tool_names=[value["definition"]["name"]], tool_catalog={"schemaVersion": 1, "revision": "a" * 64, "tools": [value]},
                capability_host_url=f"http://127.0.0.1:{server.server_port}", capability_host_key_file=str(key_file))
            result = graph.invoke({"prompt": f"[eval-behaviour:{directive}]", "system_instruction": "use tools"}, {"configurable": {"thread_id": "hosted-test"}})
        assert result["output"] == "Tool feedback: actual document result"
        assert len(requests) == 1
        assert requests[0]["catalogRevision"] == "a" * 64
        assert requests[0]["call"]["arguments"] == {"document": "alpha"}
        assert any(kind == "ToolExecutionCompleted" and payload["toolName"] == value["definition"]["name"] for kind, payload in events)
    finally:
        server.shutdown(); server.server_close(); thread.join()


def test_interrupted_hosted_write_preserves_unknown_without_redispatch(tmp_path: Path):
    from threading import Event
    from variants.baseline.hosted_tools import execute_hosted
    seen = Event()
    release = Event()
    calls = []
    class Host(BaseHTTPRequestHandler):
        def do_POST(self):
            calls.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            seen.set()
            release.wait(2)
            try:
                self.send_response(200); self.end_headers()
                self.wfile.write(b'{"status":"completed","content":"written"}')
            except BrokenPipeError:
                pass
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), Host)
    thread = Thread(target=server.serve_forever, daemon=True); thread.start()
    key_file = tmp_path / "host.key"; key_file.write_text("f" * 64)
    value = descriptor(); value["definition"]["riskClass"] = "write"
    try:
        result = execute_hosted(value, "a" * 64, {"document": "alpha"}, run_id="run", turn_id="turn", tool_call_id="call", round_number=1,
            is_cancelled=seen.is_set, endpoint=f"http://127.0.0.1:{server.server_port}", key_file=str(key_file))
        assert result["status"] == "unknown"
        assert result["error"]["code"] == "TOOL_UNKNOWN"
        assert len(calls) == 1
    finally:
        release.set(); server.shutdown(); server.server_close(); thread.join()


def test_registered_tool_decoder_uses_declared_argument_limit():
    from variants.baseline.graph import parse_openrouter_response, ProviderError
    arguments = {"document": "x" * 600}
    body = {"choices": [{"message": {"content": None, "tool_calls": [{"id": "call", "function": {"name": "catalog_document_read", "arguments": json.dumps(arguments)}}]}}]}
    with pytest.raises(ProviderError, match="larger"):
        parse_openrouter_response(body, ["catalog_document_read"])
    result = parse_openrouter_response(body, ["catalog_document_read"], {"catalog_document_read": 1024})
    assert result.tool_calls[0].arguments == arguments


def test_text_projection_preserves_json_and_resources_without_claiming_image_perception():
    from variants.baseline.hosted_tools import project_model_content
    result = {"content": "raw source envelope", "structuredContent": {"owner": "Avery"},
              "contentBlocks": [{"type": "text", "text": "Saved."},
                                {"type": "image", "data": "fictional-image", "mimeType": "image/png"},
                                {"type": "resource", "resource": {"uri": "fixture:report", "text": "Report evidence."}}]}
    projected, unsupported = project_model_content(result)
    assert "Saved." in projected and "Report evidence." in projected
    assert '"owner":"Avery"' in projected
    assert "Unsupported tool content retained in evidence: image" in projected
    assert "fictional-image" not in projected
    assert unsupported == ["image"]
    assert result["contentBlocks"][1]["data"] == "fictional-image"
    assert project_model_content({"content": "raw source envelope", "structuredContent": {"owner": "Avery"}}) == ("raw source envelope\n{\"owner\":\"Avery\"}", [])
    assert project_model_content({"content": "legacy text"}) == ("legacy text", [])
