"""The LangGraph baseline graph used by the Lab's conformance workload.

The graph keeps the platform-native model and tool nodes visible. SQLite stores
the LangGraph checkpoint, while the service owns the platform event record. The
Tools are projected from the admitted frozen catalog. Hosted extensions execute
through the authenticated capability boundary; legacy direct callers retain the
original bounded built-ins.
"""

from __future__ import annotations

import base64
import re
import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, TypedDict
from urllib import error as urllib_error
from urllib import request as urllib_request

from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime
from langgraph.types import RetryPolicy, interrupt

from .hosted_tools import catalog_tools, validate_arguments, execute_hosted, prepare_hosted, project_model_content


EventEmitter = Callable[[str, dict[str, Any]], None]
EVAL_MODELS = {"fake-eval-completion", "fake-eval-tool", "fake-eval-context", "fake-eval-loop", "fake-eval-behaviour"}
MAX_RESPONSE_BYTES = 1_048_576
MAX_OUTPUT_CHARS = 100_000
MAX_TOOL_CALLS_PER_RESPONSE = 32
MAX_TOOL_CALL_ID_CHARS = 128
MAX_TOOL_NAME_CHARS = 64
MAX_TOOL_ARGUMENT_BYTES = 512
MAX_TOOL_RESULT_BYTES = 256
MAX_MCP_RESPONSE_BYTES = 256 * 1024
MAX_MCP_TOOL_COUNT = 64
MAX_MCP_DESCRIPTION_CHARS = 8_192
MAX_MCP_SCHEMA_BYTES = 32_768


class GraphState(TypedDict, total=False):
    prompt: str
    system_instruction: str
    messages: list[dict[str, Any]]
    output: str
    model_provider: str
    model_name: str
    node: str
    attempt_count: int
    round_count: int
    tool_call_count: int
    pending_tool_calls: list[dict[str, Any]]
    usage: dict[str, int | None]
    review_decisions: dict[str, str]
    # The shared context revision that produced `messages`. A higher revision
    # must replace the native checkpoint transcript before the next model node;
    # otherwise a provider-overflow recovery would compact the Lab snapshot but
    # silently continue using the old LangGraph history.
    context_compaction_revision: int


class LangGraphModelError(Exception):
    failure_kind = "provider"
    code = "LANGGRAPH_MODEL_FAILED"
    retryable = False


class RetryablePreDispatchError(LangGraphModelError):
    failure_kind = "pre_dispatch"
    code = "LANGGRAPH_PRE_DISPATCH_RETRY"
    retryable = True


class PreDispatchError(LangGraphModelError):
    failure_kind = "pre_dispatch"
    code = "LANGGRAPH_PRE_DISPATCH_FAILED"


class ProviderError(LangGraphModelError):
    failure_kind = "provider"
    code = "LANGGRAPH_PROVIDER_FAILED"


class ContextOverflowError(ProviderError):
    code = "LANGGRAPH_CONTEXT_OVERFLOW"


class OutcomeUnknownError(LangGraphModelError):
    failure_kind = "outcome_unknown"
    code = "LANGGRAPH_OUTCOME_UNKNOWN"


class TimeoutError(LangGraphModelError):
    failure_kind = "timeout"
    code = "LANGGRAPH_MODEL_TIMEOUT"


class CancellationError(LangGraphModelError):
    failure_kind = "cancelled"
    code = "LANGGRAPH_CANCELLED"


class ConfigurationError(LangGraphModelError):
    failure_kind = "configuration"
    code = "LANGGRAPH_MODEL_CONFIGURATION"


class ResponseTooLargeError(ProviderError):
    code = "LANGGRAPH_RESPONSE_TOO_LARGE"


@dataclass(frozen=True)
class ModelConfig:
    provider: str
    model: str
    api_key: str | None
    timeout_ms: int
    base_url: str = "https://openrouter.ai/api/v1"


@dataclass(frozen=True)
class ToolCall:
    tool_call_id: str
    name: str
    arguments: Any


@dataclass(frozen=True)
class ModelResponse:
    output: str | None
    tool_calls: list[ToolCall]
    usage: dict[str, int | None]


@dataclass(frozen=True)
class ToolExecution:
    content: str
    connection: dict[str, Any] | None = None
    status: str = "completed"
    error_code: str | None = None
    error_message: str | None = None
    duration_ms: int = 0
    attempt_count: int = 1
    rich_result: dict[str, Any] | None = None


CALCULATOR_DEFINITION: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "calculator",
        "description": "Perform one basic arithmetic operation on two finite numbers.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "required": ["operation", "left", "right"],
            "properties": {
                "operation": {"type": "string", "enum": ["add", "subtract", "multiply", "divide"]},
                "left": {"type": "number"},
                "right": {"type": "number"},
            },
        },
    },
}

FIXTURE_LOOKUP_DEFINITION: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "fixture_lookup",
        "description": "Read one value from the bounded local provider fixture.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "required": ["key"],
            "properties": {"key": {"type": "string", "minLength": 1, "maxLength": 64}},
        },
    },
}

FIXTURE_WRITE_DEFINITION: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "fixture_write",
        "description": "Write one value to the bounded local provider fixture after approval.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "required": ["key", "value"],
            "properties": {"key": {"type": "string", "minLength": 1, "maxLength": 64}, "value": {"type": "string", "maxLength": 512}},
        },
    },
}

MCP_FIXTURE_LOOKUP_DEFINITION: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "mcp_fixture_lookup",
        "description": "Read one value through the selected local MCP server.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "required": ["key"],
            "properties": {"key": {"type": "string", "minLength": 1, "maxLength": 64}},
        },
    },
}


def build_baseline_graph(
    model: ModelConfig,
    emit: EventEmitter,
    is_cancelled: Callable[[], bool],
    run_id: str,
    max_attempts: int,
    checkpointer: Any,
    tool_names: list[str] | None = None,
    approved_tool_names: list[str] | None = None,
    connection_bindings: list[dict[str, Any]] | None = None,
    connection_url: str = "in-process://conn_local_fixture",
    turn_id: str | None = None,
    max_rounds: int = 6,
    max_calls: int = 8,
    live_eval: bool = False,
    live_eval_experiment: str | None = None,
    tool_catalog: dict[str, Any] | None = None,
    capability_host_url: str = "http://127.0.0.1:4318",
    capability_host_key_file: str = "lab/runs/.capability-host.key",
):
    enabled_tools = list(tool_names if tool_names is not None else ["calculator"])
    selected_catalog = catalog_tools(tool_catalog, enabled_tools)
    if tool_catalog is None and any(name not in {"calculator", "fixture_lookup", "fixture_write", "mcp_fixture_lookup"} for name in enabled_tools):
        raise ValueError("A non-builtin tool requires an admitted frozen catalog.")
    approved_tools = [name for name in (approved_tool_names or []) if name in enabled_tools]
    effective_connection_bindings = connection_bindings if connection_bindings is not None else [
        {"toolName": "fixture_lookup", "connectionRef": "conn_local_fixture", "operations": ["lookup"]},
        {"toolName": "fixture_write", "connectionRef": "conn_local_fixture", "operations": ["write"]},
    ]

    def call_model(state: GraphState, runtime: Runtime[Any]) -> GraphState:
        execution_info = runtime.execution_info
        attempt = execution_info.node_attempt
        round_number = int(state.get("round_count", 0)) + 1
        if round_number > max_rounds:
            raise ProviderError("The LangGraph baseline reached its model round limit.")
        messages = list(state.get("messages", [])) or initial_messages(state)
        emit(
            "GraphStepStarted",
            {"node": "model", "round": round_number, "attempt": attempt, "taskId": execution_info.task_id, "runId": run_id},
        )
        emit(
            "ModelRequested",
            {
                "node": "model",
                "round": round_number,
                "attempt": attempt,
                "provider": model.provider,
                "model": model.model,
                "toolCount": len(enabled_tools),
                "requestSent": model.provider == "openrouter" or not model.model.startswith("fake-pre-dispatch"),
            },
        )
        request_state = {**state, "messages": messages, "_live_eval": live_eval, "_live_eval_experiment": live_eval_experiment, "_tool_catalog": selected_catalog}
        try:
            response = complete_model(model, request_state, attempt, is_cancelled, enabled_tools, approved_tools)
        except Exception as exc:
            if model.provider == "fake" and model.model == "fake-eval-behaviour":
                emit("EvalModelObserved", {"round": round_number, "attempt": attempt, "observation": {
                    "messages": [{"role": message["role"], "content": message.get("content") or ""} for message in messages],
                    "systemInstruction": state.get("system_instruction", ""), "toolCalls": [], "errorCode": getattr(exc, "code", type(exc).__name__),
                    "faultKind": request_state.get("_behaviour_fault_kind")}})
            if live_eval and request_state.get("_live_eval_observation"):
                emit("EvalModelObserved", {"round": round_number, "attempt": attempt,
                     "observation": {**request_state["_live_eval_observation"], "errorCode": getattr(exc, "code", "LANGGRAPH_PROVIDER_ERROR")}})
            raise
        if live_eval and request_state.get("_live_eval_observation"):
            emit("EvalModelObserved", {"round": round_number, "attempt": attempt, "observation": request_state["_live_eval_observation"]})
        if model.provider == "fake" and model.model in EVAL_MODELS:
            # Capture only explicit synthetic fixtures at the actual model node.
            emit("EvalModelObserved", {
                "round": round_number, "attempt": attempt,
                "observation": {
                    "systemInstruction": state.get("system_instruction", ""),
                    "messages": [
                        {"role": message["role"], "content": message.get("content") or "",
                         **({"toolCallId": message["tool_call_id"]} if "tool_call_id" in message else {}),
                         **({"toolCalls": [{"toolCallId": call["id"], "name": call["name"], "arguments": call["arguments"]}
                                           for call in message["tool_calls"]]} if message.get("tool_calls") else {})}
                        for message in messages
                    ],
                    "toolCalls": [{"toolCallId": call.tool_call_id, "name": call.name, "arguments": call.arguments}
                                  for call in response.tool_calls],
                },
            })
        assistant: dict[str, Any] = {"role": "assistant", "content": response.output}
        if response.tool_calls:
            assistant["tool_calls"] = [
                {"id": call.tool_call_id, "name": call.name, "arguments": call.arguments}
                for call in response.tool_calls
            ]
        next_messages = messages + [assistant]
        emit(
            "ModelResponse",
            {
                "node": "model",
                "round": round_number,
                "attempt": attempt,
                "outputCharacters": len(response.output or ""),
                "toolCallCount": len(response.tool_calls),
                "usage": response.usage,
            },
        )
        if not response.output and not response.tool_calls:
            raise ProviderError("The model returned neither text nor a tool call.")
        return {
            "messages": next_messages,
            "output": response.output or "",
            "model_provider": model.provider,
            "model_name": model.model,
            "node": "model",
            "attempt_count": attempt,
            "round_count": round_number,
            "pending_tool_calls": [
                {"id": call.tool_call_id, "name": call.name, "arguments": call.arguments}
                for call in response.tool_calls
            ],
            "usage": response.usage,
        }

    def review_tools(state: GraphState) -> GraphState:
        # This dedicated node may replay on resume. Preparation is idempotent,
        # and no effect or model inference occurs before/inside interrupt().
        decisions: dict[str, str] = {}
        for raw in state.get("pending_tool_calls", []):
            descriptor = selected_catalog.get(raw["name"])
            if not descriptor or descriptor["definition"].get("approvalMode") != "invocation":
                continue
            call = ToolCall(str(raw["id"]), str(raw["name"]), raw.get("arguments"))
            if validate_catalog_call(call, descriptor, approved_tools, state.get("round_count", 0)):
                continue
            if is_cancelled():
                raise CancellationError("Cancellation was requested before action review.")
            review = prepare_hosted(descriptor, tool_catalog["revision"], call.arguments,
                run_id=run_id, turn_id=turn_id or f"{run_id}:turn:1", tool_call_id=call.tool_call_id,
                round_number=state.get("round_count", 0), is_cancelled=is_cancelled,
                endpoint=capability_host_url, key_file=capability_host_key_file)
            if review is None:
                raise ConfigurationError("Invocation review was required but the host returned no proposal.")
            if review["status"] in {"approved", "dispatching", "completed"}:
                decisions[call.tool_call_id] = "approved"
                continue
            if review["status"] in {"denied", "cancelled"}:
                decisions[call.tool_call_id] = "denied"
                continue
            while True:
                emit("InvocationReviewPending", {"requestId": review["requestId"], "toolCallId": call.tool_call_id, "revision": review["revision"]})
                resumed = interrupt(review)
                if not isinstance(resumed, dict) or resumed.get("kind") != "invocation_review" or resumed.get("requestId") != review["requestId"] or resumed.get("toolCallId") != call.tool_call_id or resumed.get("decision") not in {"approved", "denied", "renewed"}:
                    raise ConfigurationError("The resumed decision does not match this pending invocation.")
                if resumed["decision"] == "renewed":
                    renewed = prepare_hosted(descriptor, tool_catalog["revision"], call.arguments,
                        run_id=run_id, turn_id=turn_id or f"{run_id}:turn:1", tool_call_id=call.tool_call_id,
                        round_number=state.get("round_count", 0), is_cancelled=is_cancelled,
                        endpoint=capability_host_url, key_file=capability_host_key_file)
                    # Older renewal values replay as the node reexecutes. The
                    # host's current revision cannot move backwards; no effect
                    # or inference occurs while replay advances interruptions.
                    if not renewed or renewed["requestId"] != review["requestId"] or renewed["revision"] < resumed.get("revision", 0) or renewed["status"] != "pending":
                        raise ConfigurationError("The renewed proposal does not match this waiting action.")
                    emit("InvocationReviewRenewed", {"requestId": renewed["requestId"], "revision": resumed["revision"], "toolCallId": call.tool_call_id})
                    review = renewed
                    continue
                if resumed.get("revision") != review["revision"]:
                    raise ConfigurationError("The resumed decision targets an outdated proposal revision.")
                decisions[call.tool_call_id] = resumed["decision"]
                break
        return {"review_decisions": decisions}

    def execute_tools(state: GraphState, runtime: Runtime[Any]) -> GraphState:
        del runtime
        messages = list(state.get("messages", []))
        calls = list(state.get("pending_tool_calls", []))
        call_count = int(state.get("tool_call_count", 0))
        for raw_call in calls:
            call = ToolCall(
                tool_call_id=str(raw_call.get("id", "")),
                name=str(raw_call.get("name", "")),
                arguments=raw_call.get("arguments"),
            )
            call_count += 1
            payload = {
                "node": "tools",
                "round": state.get("round_count", 0),
                "attempt": state.get("attempt_count", 0),
                "toolCallId": _bounded_text(call.tool_call_id, MAX_TOOL_CALL_ID_CHARS),
                "toolName": _bounded_text(call.name, MAX_TOOL_NAME_CHARS),
                "argumentBytes": _json_bytes(call.arguments),
            }
            emit("ToolCallRequested", payload)
            if call_count > max_calls:
                message = "The LangGraph baseline reached its tool-call limit."
                emit("ToolCallRejected", {**payload, "code": "TOOL_CALL_LIMIT_EXCEEDED", "message": message})
                raise ProviderError(message)
            descriptor = selected_catalog.get(call.name)
            if descriptor is not None:
                validation_error = validate_catalog_call(call, descriptor, approved_tools, state.get("round_count", 0))
            else:
                validation_error = validate_tool_call(call, enabled_tools, approved_tools, state.get("round_count", 0))
            if validation_error:
                emit("ToolCallRejected", {**payload, "code": validation_error[0], "message": validation_error[1]})
                messages.append(tool_message(call, _tool_error(validation_error[0], validation_error[1])))
                continue
            emit("ToolCallValidated", payload)
            if state.get("review_decisions", {}).get(call.tool_call_id) == "denied":
                emit("ToolCallRejected", {**payload, "code": "INVOCATION_DENIED", "message": "This exact action was denied during review."})
                messages.append(tool_message(call, _tool_error("INVOCATION_DENIED", "This exact action was denied. No source operation was dispatched.")))
                continue
            emit("ToolExecutionStarted", payload)
            try:
                if descriptor is not None and descriptor["execution"]["kind"] == "hosted":
                    host_result = execute_hosted(descriptor, tool_catalog["revision"], call.arguments,
                        run_id=run_id, turn_id=turn_id or f"{run_id}:turn:1", tool_call_id=call.tool_call_id,
                        round_number=state.get("round_count", 0), is_cancelled=is_cancelled,
                        endpoint=capability_host_url, key_file=capability_host_key_file)
                    host_error = host_result.get("error") or {}
                    model_content, unsupported_content = project_model_content(host_result)
                    result = ToolExecution(model_content, status=host_result["status"],
                        error_code=host_error.get("code"), error_message=host_error.get("message"), connection=host_result.get("connection"),
                        duration_ms=host_result.get("durationMs", 0), attempt_count=host_result.get("attemptCount", 1), rich_result={**{key: host_result[key] for key in ("effect", "presentation", "contentBlocks", "structuredContent") if key in host_result}, "modelProjection": {"mode": "text", "unsupportedContent": unsupported_content}})
                else:
                    result = execute_tool(
                        call.name,
                        call.arguments,
                        connection_url=connection_url,
                        connection_bindings=effective_connection_bindings,
                        run_id=run_id,
                        turn_id=turn_id or f"{run_id}:turn:1",
                        tool_call_id=call.tool_call_id,
                        is_cancelled=is_cancelled,
                        timeout_ms=model.timeout_ms,
                    )
            except OutcomeUnknownError:
                raise
            except CancellationError:
                raise
            except Exception as exc:
                message = _bounded_text(str(exc), 512)
                emit("ToolExecutionFailed", {**payload, "code": "TOOL_EXECUTION_FAILED", "message": message})
                raise ProviderError("The selected tool failed.") from exc
            if live_eval or (model.provider == "fake" and model.model in EVAL_MODELS):
                emit("EvalToolObserved", {
                    "toolCallId": call.tool_call_id, "name": call.name, "arguments": call.arguments,
                    "round": state.get("round_count", 0), "status": result.status, "output": result.content,
                })
            if result.status != "completed":
                event_kind = "ToolExecutionUnknown" if result.status == "unknown" else "ToolExecutionCancelled" if result.status in {"cancelled", "timed_out"} else "ToolExecutionFailed"
                emit(event_kind, {
                    **payload,
                    "status": result.status,
                    "durationMs": result.duration_ms,
                    "attemptCount": result.attempt_count,
                    "code": result.error_code or "TOOL_EXECUTION_FAILED",
                    "message": result.error_message or "The selected tool did not complete.",
                    **({"connection": result.connection} if result.connection else {}),
                    **(result.rich_result or {}),
                })
                if result.status == "unknown":
                    raise OutcomeUnknownError("The selected connection write outcome is unknown.")
                failure_policy = descriptor.get("failurePolicy", "terminal") if descriptor else ("feedback" if call.name in {"fixture_lookup", "mcp_fixture_lookup"} else "terminal")
                if failure_policy == "feedback" and result.status == "failed":
                    messages.append(tool_message(call, result.content))
                    continue
                if result.status in {"cancelled", "timed_out"}:
                    raise CancellationError("The selected tool was cancelled or exceeded its deadline.")
                raise ProviderError("The selected tool failed.")
            emit("ToolExecutionCompleted", {
                **payload,
                "status": "completed",
                "durationMs": result.duration_ms,
                "attemptCount": result.attempt_count,
                "resultBytes": _utf8_bytes(result.content),
                **({"connection": result.connection} if result.connection else {}),
                    **(result.rich_result or {}),
            })
            messages.append(tool_message(call, result.content))
        return {"messages": messages, "pending_tool_calls": [], "tool_call_count": call_count}

    def retry_on(exception: BaseException) -> bool:
        return isinstance(exception, RetryablePreDispatchError)

    def route_after_model(state: GraphState) -> str:
        return "tools" if state.get("pending_tool_calls") else END

    builder = StateGraph(GraphState)
    builder.add_node(
        "model",
        call_model,
        retry_policy=RetryPolicy(max_attempts=1 if live_eval else max_attempts, jitter=False, retry_on=retry_on),
    )
    builder.add_node("approval", review_tools)
    builder.add_node("tools", execute_tools)
    builder.add_edge(START, "model")
    builder.add_conditional_edges("model", route_after_model, {"tools": "approval", END: END})
    builder.add_edge("approval", "tools")
    builder.add_edge("tools", "model")
    return builder.compile(checkpointer=checkpointer)


def complete_model(
    model: ModelConfig,
    state: GraphState,
    attempt: int,
    is_cancelled: Callable[[], bool],
    tool_names: list[str] | None = None,
    approved_tool_names: list[str] | None = None,
) -> ModelResponse:
    if model.provider == "fake":
        return complete_fake(model.model, state, attempt, is_cancelled, model.timeout_ms)
    if model.provider == "openrouter":
        return complete_openrouter_response(model, state, is_cancelled, tool_names or [])
    raise ConfigurationError("The configured model provider is not supported by the LangGraph baseline.")


def complete_fake(
    model: str,
    state: GraphState | str,
    attempt: int,
    is_cancelled: Callable[[], bool],
    timeout_ms: int,
) -> ModelResponse:
    if is_cancelled():
        raise CancellationError("Cancellation was requested before the model call started.")
    messages = [] if isinstance(state, str) else state.get("messages", [])
    prompt = state if isinstance(state, str) else state.get("prompt", "")
    if model == "fake-eval-behaviour":
        match = re.search(r"\[eval-behaviour:([A-Za-z0-9_-]+)\]", prompt)
        if not match:
            raise ConfigurationError("A behaviour eval requires a bounded directive.")
        encoded = match.group(1)
        directive = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        action = directive.get("action")
        if action in {"provider-error", "malformed"}:
            if not isinstance(state, str):
                state["_behaviour_fault_kind"] = "malformed" if action == "malformed" else "provider"
            if action == "malformed":
                # Exercise the real provider decoder with a received invalid shape.
                return parse_openrouter_response({"choices": []}, ["calculator"])
            raise ProviderError("Controlled provider rejection.")
        if action == "slow":
            started = time.monotonic()
            delay = min(60_000, max(1, directive.get("delayMs", 10_000))) / 1000
            while time.monotonic() - started < delay:
                if is_cancelled():
                    raise CancellationError("The behaviour model observed cancellation.")
                if time.monotonic() - started >= timeout_ms / 1000:
                    raise TimeoutError("The behaviour model exceeded its native timeout.")
                time.sleep(0.02)
        feedback = next((message for message in reversed(messages) if message.get("role") == "tool" and message.get("tool_call_id") == "eval-behaviour-call-1"), None)
        if action == "tool" and feedback is None:
            return ModelResponse(None, [ToolCall("eval-behaviour-call-1", directive.get("toolName", "calculator"), directive.get("input", {}))], empty_usage())
        retained = "\n".join(re.sub(r"\[eval-behaviour:[A-Za-z0-9_-]+\]", "", str(message.get("content", ""))) for message in messages if message.get("role") == "user")
        output = (directive.get("marker") if directive.get("marker") and directive["marker"] in retained else "No retained marker.") if action == "context" else f"Tool feedback: {feedback['content']}" if action == "tool" else directive.get("text", "Behaviour eval completed.")
        return ModelResponse(output, [], empty_usage())
    if model in EVAL_MODELS:
        tool_results = [message for message in messages if message.get("role") == "tool"]
        if model == "fake-eval-loop" or (model == "fake-eval-tool" and not tool_results):
            return ModelResponse(None, [
                ToolCall(f"eval-calculator-{len(tool_results) + 1}", "calculator", {"operation": "add", "left": 17, "right": 25})
            ], empty_usage())
        if model == "fake-eval-tool":
            return ModelResponse(str(json.loads(tool_results[-1]["content"]).get("value", "Missing tool result.")), [], empty_usage())
        if model == "fake-eval-context":
            remembered = any(message.get("role") == "user" and "conformance-4318" in str(message.get("content", "")) for message in messages)
            output = "Stored the test value." if prompt.startswith("Remember") else "conformance-4318" if remembered else "The test value was not present in the context."
            return ModelResponse(output, [], empty_usage())
        return ModelResponse("Baseline eval completed.", [], empty_usage())
    if model == "fake-success":
        return ModelResponse(f"Fake response: {prompt}", [], empty_usage())
    if model == "fake-pre-dispatch-retry":
        if attempt == 1:
            raise RetryablePreDispatchError("The deterministic model failed before dispatch on its first attempt.")
        return ModelResponse(f"Fake response after retry: {prompt}", [], empty_usage())
    if model == "fake-pre-dispatch-failure":
        raise PreDispatchError("The deterministic model failed before dispatch.")
    if model == "fake-context-overflow" and "overflow" in prompt.lower():
        raise ContextOverflowError("The deterministic provider rejected the request because the context is too large.")
    if model == "fake-context-overflow":
        return ModelResponse(f"Fake response: {prompt}", [], empty_usage())
    if model == "fake-provider-failure":
        raise ProviderError("The deterministic model returned a provider failure.")
    if model == "fake-ambiguous":
        raise OutcomeUnknownError("The deterministic model simulates a lost acknowledgement after dispatch.")
    if model in {"fake-timeout", "fake-cancel", "fake-delay"}:
        deadline = time.monotonic() + timeout_ms / 1000
        while time.monotonic() < deadline:
            if is_cancelled():
                raise CancellationError("The deterministic model observed cancellation while waiting.")
            time.sleep(0.02)
        raise TimeoutError("The deterministic model exceeded the configured node timeout.")
    if model == "fake-slow-success":
        # This fixture creates a real observation window for restart tests while
        # retaining a deterministic successful result. It is deliberately
        # shorter than the node timeout and has no external side effect.
        deadline = time.monotonic() + min(2_500, max(100, timeout_ms // 4)) / 1000
        while time.monotonic() < deadline:
            if is_cancelled():
                raise CancellationError("The deterministic model observed cancellation while waiting.")
            time.sleep(0.02)
        return ModelResponse(f"Fake delayed response: {prompt}", [], empty_usage())
    if model == "fake-context":
        remembered = any("conformance-4318" in str(message.get("content", "")) for message in messages)
        if prompt.startswith("Remember"):
            return ModelResponse("Stored the test value.", [], empty_usage())
        return ModelResponse("conformance-4318" if remembered else "The test value was not present in the context.", [], empty_usage())
    if model == "fake-tool-call":
        tool_result = next((message for message in messages if message.get("role") == "tool"), None)
        if tool_result is None:
            return ModelResponse(
                None,
                [ToolCall("call-calculator-1", "calculator", {"operation": "add", "left": 17, "right": 25})],
                {"inputTokens": 12, "outputTokens": 8, "totalTokens": 20},
            )
        return ModelResponse(f"The calculator returned {tool_result.get('content', '')}.", [], empty_usage())
    if model == "fake-connected-tool":
        tool_result = next((message for message in messages if message.get("role") == "tool"), None)
        if tool_result is None:
            return ModelResponse(None, [ToolCall("call-fixture-lookup-1", "fixture_lookup", {"key": "alpha"})], empty_usage())
        return ModelResponse(f"The local fixture returned {tool_result.get('content', '')}.", [], empty_usage())
    if model == "fake-mcp-connected-tool":
        tool_result = next((message for message in messages if message.get("role") == "tool"), None)
        if tool_result is None:
            return ModelResponse(None, [ToolCall("call-mcp-fixture-lookup-1", "mcp_fixture_lookup", {"key": "alpha"})], empty_usage())
        return ModelResponse(f"The local MCP fixture returned {tool_result.get('content', '')}.", [], empty_usage())
    if model == "fake-connected-write":
        tool_result = next((message for message in messages if message.get("role") == "tool"), None)
        if tool_result is None:
            return ModelResponse(None, [ToolCall("call-fixture-write-1", "fixture_write", {"key": "alpha", "value": "updated"})], empty_usage())
        return ModelResponse(f"The local fixture write returned {tool_result.get('content', '')}.", [], empty_usage())
    raise ConfigurationError(f"Unknown fake model: {model}")


def complete_openrouter(
    model: ModelConfig,
    state: GraphState,
    is_cancelled: Callable[[], bool],
) -> tuple[str, dict[str, int | None]]:
    response = complete_openrouter_response(model, state, is_cancelled, [])
    if response.tool_calls:
        raise ProviderError("OpenRouter returned a tool call, but no tools were enabled for this request.")
    return response.output or "", response.usage


def complete_openrouter_response(
    model: ModelConfig,
    state: GraphState,
    is_cancelled: Callable[[], bool],
    tool_names: list[str],
) -> ModelResponse:
    if not model.api_key:
        raise ConfigurationError("OPENROUTER_API_KEY is required for the openrouter provider.")
    if is_cancelled():
        raise CancellationError("Cancellation was requested before the OpenRouter request.")

    messages = state.get("messages") or initial_messages(state)
    payload_data: dict[str, Any] = {"model": model.model, "messages": [to_openrouter_message(message) for message in messages]}
    selected_catalog = state.get("_tool_catalog") or {}
    if selected_catalog:
        definitions = [{"type": "function", "function": {
            "name": selected_catalog[name]["definition"]["name"],
            "description": selected_catalog[name]["definition"]["description"],
            "parameters": selected_catalog[name]["definition"]["inputSchema"],
        }} for name in tool_names]
    else:
        definitions = []
        if "calculator" in tool_names:
            definitions.append(CALCULATOR_DEFINITION)
        if "fixture_lookup" in tool_names:
            definitions.append(FIXTURE_LOOKUP_DEFINITION)
        if "fixture_write" in tool_names:
            definitions.append(FIXTURE_WRITE_DEFINITION)
        if "mcp_fixture_lookup" in tool_names:
            definitions.append(MCP_FIXTURE_LOOKUP_DEFINITION)
    if definitions:
        payload_data["tools"] = definitions
        payload_data["tool_choice"] = "auto"
    if state.get("_live_eval"):
        if model.model not in {"google/gemma-4-31b-it:free", "nvidia/nemotron-3.5-lightning:free", "cohere/north-mini-code:free"}:
            raise ConfigurationError("Live evals require an exact :free model ID.")
        payload_data["provider"] = {"require_parameters": True, "allow_fallbacks": False,
                                    "max_price": {"prompt": 0, "completion": 0, "request": 0, "image": 0}}
        experiment = state.get("_live_eval_experiment") or "agent-harness-live"
        if experiment not in {"agent-harness-live", "agent-capabilities-live"}:
            raise ConfigurationError("Unknown free evaluation experiment.")
        payload_data["max_tokens"] = 2048 if experiment == "agent-capabilities-live" else 512
        # This state copy is local to this call, never a persisted graph input.
        state["_live_eval_observation"] = {
            "systemInstruction": state.get("system_instruction", ""),
            "messages": [
                {"role": message["role"], "content": message.get("content") or "",
                 **({"toolCallId": message["tool_call_id"]} if "tool_call_id" in message else {}),
                 **({"toolCalls": [{"toolCallId": call["id"], "name": call["name"], "arguments": call["arguments"]}
                                   for call in message["tool_calls"]]} if message.get("tool_calls") else {})}
                for message in messages],
            "tools": definitions, "providerRequest": payload_data, "toolCalls": [],
        }
    payload = json.dumps(payload_data, separators=(",", ":")).encode()
    request = urllib_request.Request(
        f"{model.base_url.rstrip('/')}/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {model.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/agent-harness-lab",
            "X-Title": "Agent Harness Lab LangGraph baseline",
        },
        method="POST",
    )
    try:
        with urllib_request.urlopen(request, timeout=model.timeout_ms / 1000) as response:
            body = json.loads(read_bounded_response(response).decode("utf-8"))
    except urllib_error.HTTPError as exc:
        if exc.code in {400, 413} and _is_context_overflow_response(exc):
            raise ContextOverflowError("OpenRouter rejected the request because its context window was exceeded.") from exc
        if 400 <= exc.code < 500:
            raise ProviderError(f"OpenRouter rejected the request with HTTP {exc.code}.") from exc
        raise OutcomeUnknownError("OpenRouter returned an ambiguous server-side response.") from exc
    except ResponseTooLargeError:
        raise
    except json.JSONDecodeError as exc:
        raise ProviderError("OpenRouter returned an invalid JSON response.") from exc
    except (urllib_error.URLError, TimeoutError, OSError) as exc:
        raise OutcomeUnknownError("The OpenRouter response outcome could not be established.") from exc

    limits = {name: descriptor["definition"]["limits"]["maxArgumentBytes"] for name, descriptor in selected_catalog.items()}
    result = parse_openrouter_response(body, tool_names, limits or None)
    if state.get("_live_eval_observation"):
        state["_live_eval_observation"].update({
            "toolCalls": [{"toolCallId": call.tool_call_id, "name": call.name, "arguments": call.arguments} for call in result.tool_calls],
            "providerRequestId": body.get("id"), "providerModel": body.get("model"),
            "providerName": body.get("provider"), "output": result.output,
        })
    return result


def parse_openrouter_response(body: Any, tool_names: list[str], tool_argument_limits: dict[str, int] | None = None) -> ModelResponse:
    try:
        message = body["choices"][0]["message"]
        output = message.get("content")
        if output is not None and (not isinstance(output, str) or not output.strip()):
            raise TypeError
        if isinstance(output, str) and len(output) > MAX_OUTPUT_CHARS:
            raise ResponseTooLargeError("OpenRouter assistant output exceeded the configured safety limit.")
        raw_calls = message.get("tool_calls") or []
        if not isinstance(raw_calls, list) or len(raw_calls) > MAX_TOOL_CALLS_PER_RESPONSE:
            raise ProviderError("OpenRouter returned too many tool calls.")
        calls: list[ToolCall] = []
        for raw_call in raw_calls:
            function = raw_call["function"]
            call_id = raw_call["id"]
            name = function["name"]
            raw_arguments = function.get("arguments", "{}")
            arguments = json.loads(raw_arguments) if isinstance(raw_arguments, str) else raw_arguments
            if not isinstance(call_id, str) or not call_id or len(call_id) > MAX_TOOL_CALL_ID_CHARS:
                raise ProviderError("OpenRouter returned an invalid tool call ID.")
            if not isinstance(name, str) or len(name) > MAX_TOOL_NAME_CHARS:
                raise ProviderError("OpenRouter returned an invalid tool name.")
            declared_limit = (tool_argument_limits or {}).get(name, MAX_TOOL_ARGUMENT_BYTES)
            if _json_bytes(arguments) > min(MAX_RESPONSE_BYTES, declared_limit):
                raise ProviderError("OpenRouter returned tool arguments larger than the configured limit.")
            if name not in tool_names:
                raise ProviderError(f"OpenRouter requested a tool that is not enabled: {name}.")
            calls.append(ToolCall(call_id, name, arguments))
        if output is None and not calls:
            raise ProviderError("OpenRouter returned no text content or tool call.")
        usage = body.get("usage") or {}
        return ModelResponse(output, calls, {
            "inputTokens": _optional_int(usage.get("prompt_tokens")),
            "outputTokens": _optional_int(usage.get("completion_tokens")),
            "totalTokens": _optional_int(usage.get("total_tokens")),
        })
    except ResponseTooLargeError:
        raise
    except ProviderError:
        raise
    except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise OutcomeUnknownError("OpenRouter returned an invalid response shape.") from exc


def read_bounded_response(response: Any, max_bytes: int = MAX_RESPONSE_BYTES) -> bytes:
    chunks: list[bytes] = []
    total_bytes = 0
    while True:
        chunk = response.read(64 * 1024)
        if not chunk:
            break
        total_bytes += len(chunk)
        if total_bytes > max_bytes:
            raise ResponseTooLargeError("OpenRouter returned a response larger than the configured safety limit.")
        chunks.append(chunk)
    return b"".join(chunks)


def _parse_mcp_response(raw: bytes, content_type: str) -> Any:
    text = raw.decode("utf-8", errors="strict")
    if "text/event-stream" in content_type.lower():
        for event in text.split("\n\n"):
            data = "\n".join(line[5:].lstrip() for line in event.splitlines() if line.startswith("data:"))
            if data.strip():
                return json.loads(data)
        raise ValueError("MCP returned an empty event stream.")
    return json.loads(text)


def _mcp_endpoint(connection_url: str) -> str:
    base = connection_url.rstrip("/")
    return base if base.endswith("/mcp") else f"{base}/mcp"


def _mcp_request_id(run_id: str, turn_id: str, tool_call_id: str) -> str:
    return ":".join(_safe_id_part(part) for part in (run_id, turn_id, tool_call_id))


def _mcp_evidence(binding: dict[str, Any], phase: str) -> dict[str, Any]:
    return {
        "endpointRef": binding.get("endpointRef", binding.get("endpoint_ref")),
        "serverName": binding.get("serverName", binding.get("server_name", "")),
        "protocolVersion": binding.get("protocolVersion", binding.get("protocol_version", "")),
        "toolName": binding.get("toolName", binding.get("tool_name", "")),
        "toolVersion": binding.get("toolVersion", binding.get("tool_version", "")),
        "phase": phase,
    }


def _is_context_overflow_response(response: Any) -> bool:
    """Classify common provider overflow wording without persisting its body."""
    try:
        body = read_bounded_response(response).decode("utf-8", errors="replace").lower()
    except Exception:
        return False
    return any(
        phrase in body
        for phrase in (
            "context length",
            "context window",
            "maximum context",
            "prompt is too long",
            "too many tokens",
            "token limit",
        )
    )


def initial_messages(state: GraphState) -> list[dict[str, Any]]:
    return [
        {"role": "system", "content": state.get("system_instruction", "")},
        {"role": "user", "content": state.get("prompt", "")},
    ]


def to_openrouter_message(message: dict[str, Any]) -> dict[str, Any]:
    """Map internal graph messages to the chat-completions wire shape."""
    role = message.get("role")
    content = message.get("content")
    if role == "assistant":
        raw_calls = message.get("tool_calls")
        tool_calls = raw_calls if isinstance(raw_calls, list) else []
        return {
            "role": "assistant",
            "content": content,
            **({
                "tool_calls": [
                    {
                        "id": str(call.get("id", "")),
                        "type": "function",
                        "function": {
                            "name": str(call.get("name", "")),
                            "arguments": json.dumps(call.get("arguments"), separators=(",", ":")),
                        },
                    }
                    for call in tool_calls
                    if isinstance(call, dict)
                ],
            } if tool_calls else {}),
        }
    if role == "tool":
        return {
            "role": "tool",
            "tool_call_id": str(message.get("tool_call_id", "")),
            "name": str(message.get("name", "tool")),
            "content": content,
        }
    return {"role": "system" if role == "developer" else role, "content": content}


def validate_catalog_call(call: ToolCall, descriptor: dict[str, Any], approved_tools: list[str], round_number: int) -> tuple[str, str] | None:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", call.tool_call_id):
        return "INVALID_CALL_ID", "Tool call ID is missing or unsafe."
    if round_number < 1:
        return "INVALID_ROUND", "Tool call round must be positive."
    definition = descriptor["definition"]
    if definition.get("approvalMode") != "invocation" and definition["riskClass"] in {"external", "write"} and call.name not in approved_tools:
        return "APPROVAL_REQUIRED", "The selected tool requires an explicit approval."
    return validate_arguments(descriptor, call.arguments)


def validate_tool_call(call: ToolCall, enabled_tools: list[str], approved_tools: list[str], round_number: int) -> tuple[str, str] | None:
    if call.tool_call_id == "" or len(call.tool_call_id) > MAX_TOOL_CALL_ID_CHARS:
        return "INVALID_CALL_ID", "Tool call ID is missing or unsafe."
    if call.name not in enabled_tools:
        return "UNKNOWN_TOOL", f"Tool is not enabled: {call.name}"
    if call.name not in {"calculator", "fixture_lookup", "fixture_write", "mcp_fixture_lookup"}:
        return "UNKNOWN_TOOL", f"Tool is not registered: {call.name}"
    if call.name == "fixture_write" and call.name not in approved_tools:
        return "APPROVAL_REQUIRED", "Tool requires an explicit approval: fixture_write"
    if round_number < 1:
        return "INVALID_ROUND", "Tool call round must be positive."
    if _json_bytes(call.arguments) > MAX_TOOL_ARGUMENT_BYTES:
        return "ARGUMENTS_TOO_LARGE", "Arguments exceed the calculator input limit."
    if call.name == "fixture_lookup":
        if not isinstance(call.arguments, dict) or set(call.arguments) != {"key"} or not isinstance(call.arguments["key"], str) or not 1 <= len(call.arguments["key"]) <= 64:
            return "INVALID_ARGUMENTS", "Fixture lookup arguments must contain only a bounded key."
        return None
    if call.name == "fixture_write":
        if not isinstance(call.arguments, dict) or set(call.arguments) != {"key", "value"} or not isinstance(call.arguments["key"], str) or not isinstance(call.arguments["value"], str) or not 1 <= len(call.arguments["key"]) <= 64 or len(call.arguments["value"]) > 512:
            return "INVALID_ARGUMENTS", "Fixture write arguments must contain only bounded key and value strings."
        return None
    if call.name == "mcp_fixture_lookup":
        if not isinstance(call.arguments, dict) or set(call.arguments) != {"key"} or not isinstance(call.arguments["key"], str) or not 1 <= len(call.arguments["key"]) <= 64:
            return "INVALID_ARGUMENTS", "MCP fixture lookup arguments must contain only a bounded key."
        return None
    if not isinstance(call.arguments, dict) or set(call.arguments) != {"operation", "left", "right"}:
        return "INVALID_ARGUMENTS", "Calculator arguments must contain only operation, left, and right."
    operation = call.arguments["operation"]
    left = call.arguments["left"]
    right = call.arguments["right"]
    if operation not in {"add", "subtract", "multiply", "divide"}:
        return "INVALID_ARGUMENTS", "Calculator operation is not supported."
    if not isinstance(left, (int, float)) or isinstance(left, bool) or not isinstance(right, (int, float)) or isinstance(right, bool):
        return "INVALID_ARGUMENTS", "Calculator values must be finite numbers."
    if operation == "divide" and right == 0:
        return "INVALID_ARGUMENTS", "Calculator cannot divide by zero."
    return None


def execute_calculator(arguments: Any) -> str:
    operation = arguments["operation"]
    left = arguments["left"]
    right = arguments["right"]
    value = {"add": left + right, "subtract": left - right, "multiply": left * right, "divide": left / right}[operation]
    if not isinstance(value, (int, float)) or value != value or value in {float("inf"), float("-inf")}:
        raise ValueError("Calculator result is not finite.")
    result = json.dumps({"value": value}, separators=(",", ":"))
    if _utf8_bytes(result) > MAX_TOOL_RESULT_BYTES:
        raise ValueError("Calculator result exceeds the output limit.")
    return result


def execute_tool(
    name: str,
    arguments: Any,
    *,
    connection_url: str = "in-process://conn_local_fixture",
    connection_bindings: list[dict[str, Any]] | None = None,
    run_id: str = "run",
    turn_id: str = "turn",
    tool_call_id: str = "tool",
    is_cancelled: Callable[[], bool] | None = None,
    timeout_ms: int = 5_000,
) -> ToolExecution:
    if name == "calculator":
        return ToolExecution(execute_calculator(arguments))
    if name == "fixture_lookup":
        return execute_connection_tool(
            name,
            "fixture.lookup",
            arguments,
            read_only=True,
            connection_url=connection_url,
            connection_bindings=connection_bindings or [],
            run_id=run_id,
            turn_id=turn_id,
            tool_call_id=tool_call_id,
            is_cancelled=is_cancelled,
            timeout_ms=timeout_ms,
        )
    if name == "fixture_write":
        return execute_connection_tool(
            name,
            "fixture.write",
            arguments,
            read_only=False,
            connection_url=connection_url,
            connection_bindings=connection_bindings or [],
            run_id=run_id,
            turn_id=turn_id,
            tool_call_id=tool_call_id,
            is_cancelled=is_cancelled,
            timeout_ms=timeout_ms,
        )
    if name == "mcp_fixture_lookup":
        return execute_mcp_connection_tool(
            arguments,
            connection_url=connection_url,
            connection_bindings=connection_bindings or [],
            run_id=run_id,
            turn_id=turn_id,
            tool_call_id=tool_call_id,
            is_cancelled=is_cancelled,
            timeout_ms=timeout_ms,
        )
    raise ValueError(f"Unknown fixture tool: {name}")


def execute_mcp_connection_tool(
    arguments: Any,
    *,
    connection_url: str,
    connection_bindings: list[dict[str, Any]],
    run_id: str,
    turn_id: str,
    tool_call_id: str,
    is_cancelled: Callable[[], bool] | None,
    timeout_ms: int,
) -> ToolExecution:
    binding = next((candidate for candidate in connection_bindings if candidate.get("toolName", candidate.get("tool_name")) == "mcp_fixture_lookup"), None)
    mcp = binding.get("mcp") if isinstance(binding, dict) else None
    if (
        binding is None
        or binding.get("connectionRef", binding.get("connection_ref")) != "conn_local_mcp_fixture"
        or "lookup" not in binding.get("operations", [])
        or not isinstance(mcp, dict)
    ):
        return ToolExecution(
            _tool_error("CONNECTION_NOT_CONFIGURED", "The server-owned MCP binding is not available for mcp_fixture_lookup."),
            connection={
                "requestId": _mcp_request_id(run_id, turn_id, tool_call_id),
                "status": "failed",
                "attemptCount": 0,
                "providerRequestIds": [],
                "errorCode": "CONNECTION_NOT_CONFIGURED",
                "mcp": _mcp_evidence(mcp if isinstance(mcp, dict) else {}, "discovery"),
            },
            status="failed",
            error_code="CONNECTION_NOT_CONFIGURED",
            error_message="The server-owned MCP binding is not available.",
        )

    request_id = _mcp_request_id(run_id, turn_id, tool_call_id)
    try:
        client = _McpHttpClient(
            _mcp_endpoint(connection_url),
            mcp,
            timeout_ms=timeout_ms,
            is_cancelled=is_cancelled,
        )
        selected = client.discover()
    except CancellationError:
        raise
    except Exception as exc:
        message = _bounded_text(str(exc), 512)
        connection = {
            "requestId": request_id,
            "status": "failed",
            "attemptCount": 1,
            "providerRequestIds": [],
            "errorCode": "MCP_DISCOVERY_FAILED",
            "mcp": _mcp_evidence(mcp, "discovery"),
        }
        return ToolExecution(_tool_error("MCP_DISCOVERY_FAILED", message), connection=connection, status="failed", error_code="MCP_DISCOVERY_FAILED", error_message=message)

    try:
        output, provider_request_id = client.call(selected, arguments, request_id)
        connection = {
            "requestId": request_id,
            "status": "completed",
            "attemptCount": 1,
            "providerRequestIds": [provider_request_id],
            "errorCode": None,
            "mcp": _mcp_evidence(mcp, "invocation"),
        }
        content = json.dumps(output, separators=(",", ":"))
        if _utf8_bytes(content) > MAX_TOOL_RESULT_BYTES:
            message = "MCP tool result exceeds the configured output limit."
            connection["status"] = "failed"
            connection["errorCode"] = "MCP_RESULT_TOO_LARGE"
            return ToolExecution(_tool_error("MCP_RESULT_TOO_LARGE", message), connection=connection, status="failed", error_code="MCP_RESULT_TOO_LARGE", error_message=message)
        return ToolExecution(content, connection=connection)
    except CancellationError:
        raise
    except OutcomeUnknownError as exc:
        message = _bounded_text(str(exc), 512)
        connection = {
            "requestId": request_id,
            "status": "unknown",
            "attemptCount": 1,
            "providerRequestIds": [],
            "errorCode": "MCP_OUTCOME_UNKNOWN",
            "mcp": _mcp_evidence(mcp, "invocation"),
        }
        return ToolExecution(_tool_error("MCP_OUTCOME_UNKNOWN", message), connection=connection, status="unknown", error_code="MCP_OUTCOME_UNKNOWN", error_message=message)
    except Exception as exc:
        message = _bounded_text(str(exc), 512)
        connection = {
            "requestId": request_id,
            "status": "failed",
            "attemptCount": 1,
            "providerRequestIds": [],
            "errorCode": "MCP_CALL_FAILED",
            "mcp": _mcp_evidence(mcp, "invocation"),
        }
        return ToolExecution(_tool_error("MCP_CALL_FAILED", message), connection=connection, status="failed", error_code="MCP_CALL_FAILED", error_message=message)


class _McpHttpClient:
    def __init__(self, endpoint: str, binding: dict[str, Any], *, timeout_ms: int, is_cancelled: Callable[[], bool] | None) -> None:
        self.endpoint = endpoint
        self.binding = binding
        self.timeout = max(0.1, timeout_ms / 1000)
        self.is_cancelled = is_cancelled
        self.protocol_version = str(binding.get("protocolVersion", binding.get("protocol_version", "")))
        self.server_name = str(binding.get("serverName", binding.get("server_name", "")))
        self.tool_name = str(binding.get("toolName", binding.get("tool_name", "")))
        self.tool_version = str(binding.get("toolVersion", binding.get("tool_version", "")))
        self.request_sequence = 0

    def discover(self) -> dict[str, Any]:
        if self.protocol_version == "2025-06-18":
            initialized = self.request(
                "initialize",
                {
                    "protocolVersion": self.protocol_version,
                    "capabilities": {},
                    "clientInfo": {"name": "agent-harness-lab-langgraph", "version": "1.0.0"},
                },
                phase="discovery",
            )
            if initialized.get("protocolVersion") != self.protocol_version:
                raise ValueError("MCP protocol version does not match the selected capability.")
            server_info = initialized.get("serverInfo")
            if not isinstance(server_info, dict) or server_info.get("name") != self.server_name:
                raise ValueError("MCP server identity does not match the selected capability.")
            self.notification("notifications/initialized")

        result = self.request("tools/list", {}, phase="discovery")
        raw_tools = result.get("tools")
        if not isinstance(raw_tools, list) or len(raw_tools) > MAX_MCP_TOOL_COUNT:
            raise ValueError("MCP tools/list returned an invalid or oversized tool list.")
        tools: list[dict[str, Any]] = []
        for raw_tool in raw_tools:
            if not isinstance(raw_tool, dict):
                raise ValueError("MCP tools/list returned an invalid tool manifest.")
            name = raw_tool.get("name")
            description = raw_tool.get("description")
            input_schema = raw_tool.get("inputSchema")
            metadata = raw_tool.get("_meta")
            version = metadata.get("agentlabVersion", "1.0.0") if isinstance(metadata, dict) else "1.0.0"
            if not isinstance(name, str) or not name or len(name) > 128 or not isinstance(description, str) or len(description) > MAX_MCP_DESCRIPTION_CHARS or not isinstance(input_schema, dict):
                raise ValueError("MCP tools/list returned an invalid tool manifest.")
            if not isinstance(version, str) or not version or _utf8_bytes(json.dumps(input_schema, separators=(",", ":"))) > MAX_MCP_SCHEMA_BYTES:
                raise ValueError("MCP tool manifest is unbounded.")
            tools.append({"name": name, "version": version, "description": description, "inputSchema": input_schema})
        selected = next((tool for tool in tools if tool["name"] == self.tool_name and tool["version"] == self.tool_version), None)
        if selected is None:
            raise ValueError("The selected MCP tool was not returned by discovery.")
        return selected

    def call(self, tool: dict[str, Any], arguments: Any, request_id: str) -> tuple[dict[str, Any], str]:
        if tool["name"] != self.tool_name or tool["version"] != self.tool_version:
            raise ValueError("The MCP tool is not the server-owned selected tool.")
        result = self.request("tools/call", {"name": self.tool_name, "arguments": arguments}, phase="invocation", request_id=request_id)
        if result.get("isError") is True:
            raise ValueError("MCP tool returned an error.")
        structured = result.get("structuredContent")
        if isinstance(structured, dict):
            return structured, f"mcp-http:{request_id}"
        content = result.get("content")
        if not isinstance(content, list):
            raise ValueError("MCP tools/call returned no content.")
        text = "\n".join(item.get("text", "") for item in content if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str)).strip()
        if not text:
            raise ValueError("MCP tools/call returned no text content.")
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return {"text": text}, f"mcp-http:{request_id}"
        if not isinstance(parsed, dict):
            return {"text": text}, f"mcp-http:{request_id}"
        return parsed, f"mcp-http:{request_id}"

    def notification(self, method: str) -> None:
        self._check_cancelled()
        request = urllib_request.Request(
            self.endpoint,
            data=json.dumps({"jsonrpc": "2.0", "method": method}, separators=(",", ":")).encode("utf-8"),
            headers=self.headers(method),
            method="POST",
        )
        with urllib_request.urlopen(request, timeout=self.timeout) as response:
            response.read(64 * 1024)
            if response.status not in {200, 202}:
                raise ValueError(f"MCP notification failed with HTTP {response.status}.")

    def request(self, method: str, params: dict[str, Any], *, phase: str, request_id: str | None = None) -> dict[str, Any]:
        self._check_cancelled()
        self.request_sequence += 1
        message_id = request_id or f"langgraph-mcp-{self.request_sequence}"
        body = json.dumps({"jsonrpc": "2.0", "id": message_id, "method": method, "params": params}, separators=(",", ":")).encode("utf-8")
        request = urllib_request.Request(self.endpoint, data=body, headers=self.headers(method, params), method="POST")
        try:
            with urllib_request.urlopen(request, timeout=self.timeout) as response:
                raw = read_bounded_response(response, MAX_MCP_RESPONSE_BYTES)
                content_type = response.headers.get("Content-Type", "")
                # A blocking stdlib read cannot be interrupted by the graph's
                # cancellation callback. Cancellation wins if it was observed
                # before the response was handed back to the tool node.
                self._check_cancelled()
        except (urllib_error.URLError, TimeoutError, OSError) as exc:
            if phase == "invocation":
                raise OutcomeUnknownError("The MCP tool-call response outcome could not be established.") from exc
            raise
        parsed = _parse_mcp_response(raw, content_type)
        if not isinstance(parsed, dict) or parsed.get("jsonrpc") != "2.0":
            raise ValueError("MCP returned an invalid JSON-RPC envelope.")
        error = parsed.get("error")
        if isinstance(error, dict):
            raise ValueError(_bounded_text(str(error.get("message", "MCP request failed.")), 512))
        result = parsed.get("result")
        if not isinstance(result, dict):
            raise ValueError("MCP returned an invalid result.")
        return result

    def headers(self, method: str, params: dict[str, Any] | None = None) -> dict[str, str]:
        name = params.get("name") if isinstance(params, dict) and isinstance(params.get("name"), str) else None
        return {
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
            "MCP-Protocol-Version": self.protocol_version,
            "Mcp-Method": method,
            **({"Mcp-Name": name} if name else {}),
        }

    def _check_cancelled(self) -> None:
        if self.is_cancelled and self.is_cancelled():
            raise CancellationError("Cancellation was requested during the MCP call.")


def execute_connection_tool(
    tool_name: str,
    operation: str,
    arguments: Any,
    *,
    read_only: bool,
    connection_url: str,
    connection_bindings: list[dict[str, Any]],
    run_id: str,
    turn_id: str,
    tool_call_id: str,
    is_cancelled: Callable[[], bool] | None,
    timeout_ms: int,
) -> ToolExecution:
    binding = next((candidate for candidate in connection_bindings if candidate.get("toolName", candidate.get("tool_name")) == tool_name), None)
    if binding is None or binding.get("connectionRef", binding.get("connection_ref")) != "conn_local_fixture" or operation.removeprefix("fixture.") not in binding.get("operations", []):
        return ToolExecution(_tool_error("CONNECTION_NOT_CONFIGURED", f"The connection binding is not available for {tool_name}."), status="failed", error_code="CONNECTION_NOT_CONFIGURED", error_message="The connection binding is not available.")

    request_id = ":".join(_safe_id_part(part) for part in (run_id, turn_id, tool_call_id))
    if connection_url == "in-process://conn_local_fixture":
        if operation == "fixture.lookup":
            key = arguments["key"]
            output = {"key": key, "value": {"alpha": "local fixture alpha", "project": "Agent Harness Lab"}.get(key)}
        else:
            output = {"key": arguments["key"], "written": True}
        return ToolExecution(json.dumps(output, separators=(",", ":")), connection={
            "requestId": request_id,
            "status": "completed",
            "attemptCount": 1,
            "providerRequestIds": [f"local-inprocess:{request_id}"],
            "errorCode": None,
        })
    idempotency_key = None if read_only else request_id
    max_attempts = 3 if read_only else 1
    envelope = {
        "requestId": request_id,
        "operation": operation,
        "input": arguments,
        "idempotencyKey": idempotency_key,
    }
    request_body = json.dumps(envelope, separators=(",", ":")).encode("utf-8")
    attempts: list[dict[str, Any]] = []
    provider_request_ids: list[str] = []
    for attempt in range(1, max_attempts + 1):
        if is_cancelled and is_cancelled():
            raise CancellationError("Cancellation was requested before the connection call.")
        started = datetime.now(timezone.utc).isoformat()
        request = urllib_request.Request(
            f"{connection_url.rstrip('/')}/v1/connection",
            data=request_body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib_request.urlopen(request, timeout=max(0.1, timeout_ms / 1000)) as response:
                body = json.loads(read_bounded_response(response).decode("utf-8"))
            if not isinstance(body, dict) or not isinstance(body.get("providerRequestId"), str) or not isinstance(body.get("statusCode"), int) or not isinstance(body.get("body"), dict):
                raise ProviderError("The local connection returned an invalid response envelope.")
            provider_request_id = body["providerRequestId"]
            provider_request_ids.append(provider_request_id)
            status_code = body["statusCode"]
            successful = 200 <= status_code < 300
            retryable = read_only and status_code in {408, 425, 429, 500, 502, 503, 504}
            attempts.append({"requestId": request_id, "attempt": attempt, "status": "completed" if successful else "failed", "retryable": retryable, "providerRequestId": provider_request_id, "errorCode": None if successful else f"HTTP_{status_code}", "startedAt": started, "finishedAt": datetime.now(timezone.utc).isoformat()})
            if successful:
                connection = {"requestId": request_id, "status": "completed", "attemptCount": len(attempts), "providerRequestIds": provider_request_ids, "errorCode": None}
                return ToolExecution(json.dumps(body["body"], separators=(",", ":")), connection=connection)
            if not retryable or attempt == max_attempts:
                # Preserve actionable read feedback from the owned fixture. An
                # unsuccessful write keeps the original terminal error policy.
                detail = body["body"].get("error")
                message = _bounded_text(detail, 512) if read_only and isinstance(detail, str) and detail else f"The local connection failed with HTTP {status_code}."
                connection = {"requestId": request_id, "status": "failed", "attemptCount": len(attempts), "providerRequestIds": provider_request_ids, "errorCode": f"HTTP_{status_code}"}
                return ToolExecution(_tool_error(f"HTTP_{status_code}", message), connection=connection, status="failed", error_code=f"HTTP_{status_code}", error_message=message)
        except OutcomeUnknownError:
            raise
        except Exception as exc:
            if not read_only:
                connection = {"requestId": request_id, "status": "unknown", "attemptCount": len(attempts) + 1, "providerRequestIds": provider_request_ids, "errorCode": "CONNECTION_OUTCOME_UNKNOWN"}
                return ToolExecution(_tool_error("CONNECTION_OUTCOME_UNKNOWN", "The connection write acknowledgement was lost."), connection=connection, status="unknown", error_code="CONNECTION_OUTCOME_UNKNOWN", error_message="The connection write acknowledgement was lost.")
            if attempt == max_attempts:
                message = _bounded_text(str(exc), 512)
                connection = {"requestId": request_id, "status": "failed", "attemptCount": len(attempts) + 1, "providerRequestIds": provider_request_ids, "errorCode": "CONNECTION_FAILED"}
                return ToolExecution(_tool_error("CONNECTION_FAILED", message), connection=connection, status="failed", error_code="CONNECTION_FAILED", error_message=message)
    raise ProviderError("The local connection did not return a result.")


def _safe_id_part(value: str) -> str:
    normalized = "".join(character if character.isalnum() or character in "._-" else "_" for character in value)
    return normalized[:64] or "unknown"


def tool_message(call: ToolCall, content: str) -> dict[str, Any]:
    return {"role": "tool", "tool_call_id": call.tool_call_id, "name": call.name, "content": content}


def _tool_error(code: str, message: str) -> str:
    return json.dumps({"code": _bounded_text(code, 128), "error": _bounded_text(message, 512)}, separators=(",", ":"))


def empty_usage() -> dict[str, int | None]:
    return {"inputTokens": None, "outputTokens": None, "totalTokens": None}


def _optional_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def _json_bytes(value: Any) -> int:
    try:
        return len(json.dumps(value, separators=(",", ":"), ensure_ascii=True).encode("utf-8"))
    except (TypeError, ValueError):
        return MAX_TOOL_ARGUMENT_BYTES + 1


def _utf8_bytes(value: str) -> int:
    return len(value.encode("utf-8"))


def _bounded_text(value: str, maximum: int) -> str:
    return value[:maximum]
