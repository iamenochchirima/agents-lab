"""Native persisted clarification and proposal supersession without network models."""
from unittest.mock import patch
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command
from variants.baseline.graph import ModelConfig, ModelResponse, ToolCall, build_baseline_graph, empty_usage


def descriptor():
    return {"definition": {"schemaVersion": 1, "name": "ask_user", "description": "Ask.", "riskClass": "pure", "executionKind": "in_process", "approvalMode": "automatic",
        "inputSchema": {"type": "object", "properties": {"question": {"type": "string"}}, "required": ["question"]},
        "limits": {"maxArgumentBytes": 32768, "maxResultBytes": 32768, "timeoutMs": 500}},
        "source": {"id": "agentlab/task-interaction", "version": "1.0.0", "digest": "a" * 64}, "execution": {"kind": "hosted", "key": "agentlab/task-interaction/ask_user"}, "failurePolicy": "feedback"}


def test_original_question_checkpoint_resumes_with_reply_and_protected_constraint(tmp_path):
    question = {"questionId": "a" * 64, "runId": "run", "turnId": "turn", "toolCallId": "ask", "question": "Which date?", "status": "pending"}
    answer = None
    calls = []
    def host(operation, payload):
        assert payload["runId"] == "run" and payload["turnId"] == "turn"
        if operation == "boundary": return []
        if operation == "question": return question
        assert payload["questionId"] == question["questionId"]
        return answer
    def model(_config, state, *_args):
        calls.append(state)
        if len(calls) == 1: return ModelResponse(None, [ToolCall("ask", "ask_user", {"question": "Which date?"})], empty_usage())
        assert any(message["role"] == "user" and "Friday" in message["content"] for message in state["messages"])
        return ModelResponse("Friday retained.", [], empty_usage())
    events = []
    options = dict(model=ModelConfig("fake", "fake-success", None, 500), emit=lambda kind, payload: events.append((kind, payload)), is_cancelled=lambda: False,
        run_id="run", turn_id="turn", max_attempts=1, tool_names=["ask_user"], tool_catalog={"schemaVersion": 1, "revision": "catalog", "tools": [descriptor()]}, interaction=host)
    config = {"configurable": {"thread_id": "original"}}; path = str(tmp_path / "graph.sqlite")
    with patch("variants.baseline.graph.complete_model", side_effect=model):
        with SqliteSaver.from_conn_string(path) as saver:
            graph = build_baseline_graph(**options, checkpointer=saver)
            graph.invoke({"prompt": "Keep original task", "system_instruction": "Immutable", "messages": [{"role": "user", "content": "Keep original task"}]}, config, durability="sync")
            snapshot = graph.get_state(config)
            assert snapshot.tasks[0].interrupts[0].value["questionId"] == question["questionId"]
            assert len(calls) == 1
        answer = {"inputId": "reply", "sequence": 1, "kind": "clarification_reply", "content": "Friday", "questionId": question["questionId"]}
        with SqliteSaver.from_conn_string(path) as saver:
            graph = build_baseline_graph(**options, checkpointer=saver)
            result = graph.invoke(Command(resume={"kind": "task_input", "runId": "run", "turnId": "turn", "inputId": "reply", "sequence": 1, "inputKind": "clarification_reply", "questionId": question["questionId"]}), config, durability="sync")
            assert result["round_count"] == 2 and result["tool_call_count"] == 1
            assert any("Friday" in text for text in result["live_constraints"])
            assert len([event for event in events if event[0] == "TaskInputConsumed"]) == 1


def test_steering_before_proposal_dispatch_supersedes_original_call(tmp_path):
    requests = []
    instruction = {"inputId": "steer", "sequence": 1, "kind": "steering", "content": "Do not ask; use Friday."}
    def host(operation, payload):
        assert operation == "boundary"
        return [instruction] if payload["boundaryId"] == "proposal:1" else []
    def model(_config, state, *_args):
        requests.append(state)
        if len(requests) == 1: return ModelResponse(None, [ToolCall("ask", "ask_user", {"question": "Date?"})], empty_usage())
        assert any("TASK_INPUT_SUPERSEDED" in (item.get("content") or "") for item in state["messages"])
        assert any("use Friday" in (item.get("content") or "") for item in state["messages"])
        return ModelResponse("Friday.", [], empty_usage())
    with patch("variants.baseline.graph.complete_model", side_effect=model), SqliteSaver.from_conn_string(str(tmp_path / "graph.sqlite")) as saver:
        graph = build_baseline_graph(ModelConfig("fake", "fake-success", None, 500), lambda *_: None, lambda: False, "run", 1, saver,
            tool_names=["ask_user"], tool_catalog={"schemaVersion": 1, "revision": "catalog", "tools": [descriptor()]}, interaction=host)
        result = graph.invoke({"prompt": "Date", "system_instruction": "Immutable", "messages": [{"role": "user", "content": "Date"}]}, {"configurable": {"thread_id": "original"}}, durability="sync")
        assert result["live_input_ids"] == ["steer"] and result.get("tool_call_count", 0) == 0


def test_steering_between_calls_closes_remaining_batch_before_user_instruction(tmp_path):
    instruction = {"inputId": "steer", "sequence": 1, "kind": "steering", "content": "Use Friday; stop old calculation batch."}
    def host(operation, payload):
        assert operation == "boundary"
        return [instruction] if payload["boundaryId"] == "dispatch:1:1" else []
    rounds = []
    def model(_config, state, *_args):
        rounds.append(state)
        if len(rounds) == 1:
            return ModelResponse(None, [ToolCall("first", "calculator", {"operation": "add", "left": 1, "right": 1}), ToolCall("second", "calculator", {"operation": "add", "left": 2, "right": 2})], empty_usage())
        messages = state["messages"]
        results = [item for item in messages if item["role"] == "tool"]
        assert [item["tool_call_id"] for item in results] == ["first", "second"]
        assert "TASK_INPUT_SUPERSEDED" in results[1]["content"]
        assert messages.index(results[1]) < next(index for index, item in enumerate(messages) if item["role"] == "user" and "Live task instruction" in item["content"])
        return ModelResponse("Friday.", [], empty_usage())
    calculator = descriptor()
    calculator["definition"] = {**calculator["definition"], "name": "calculator", "inputSchema": {"type": "object"}}
    calculator["source"]["id"] = "agentlab/builtin-tools"
    calculator["execution"] = {"kind": "builtin", "key": "calculator"}
    with patch("variants.baseline.graph.complete_model", side_effect=model), patch("variants.baseline.graph.execute_tool", wraps=__import__("variants.baseline.graph", fromlist=["execute_tool"]).execute_tool) as dispatched, SqliteSaver.from_conn_string(str(tmp_path / "graph.sqlite")) as saver:
        graph = build_baseline_graph(ModelConfig("fake", "fake-success", None, 500), lambda *_: None, lambda: False, "run", 1, saver,
            tool_names=["ask_user", "calculator"], tool_catalog={"schemaVersion": 1, "revision": "catalog", "tools": [descriptor(), calculator]}, interaction=host)
        result = graph.invoke({"prompt": "Calculate", "messages": [{"role": "user", "content": "Calculate"}]}, {"configurable": {"thread_id": "original"}}, durability="sync")
        assert result["live_input_ids"] == ["steer"]
        assert dispatched.call_count == 1 and result["tool_call_count"] == 1
