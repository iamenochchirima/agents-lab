"""The LangGraph baseline graph used by the Lab's conformance workload.

The graph keeps the platform-native model and tool nodes visible. SQLite stores
the LangGraph checkpoint, while the service owns the platform event record. The
calculator is the only enabled tool in this slice. Its implementation mirrors
the provider-neutral pure-tool contract and has no filesystem, network, or
subprocess access.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Callable, TypedDict
from urllib import error as urllib_error
from urllib import request as urllib_request

from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime
from langgraph.types import RetryPolicy


EventEmitter = Callable[[str, dict[str, Any]], None]
MAX_RESPONSE_BYTES = 1_048_576
MAX_OUTPUT_CHARS = 100_000
MAX_TOOL_CALLS_PER_RESPONSE = 32
MAX_TOOL_CALL_ID_CHARS = 128
MAX_TOOL_NAME_CHARS = 64
MAX_TOOL_ARGUMENT_BYTES = 512
MAX_TOOL_RESULT_BYTES = 256


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


def build_baseline_graph(
    model: ModelConfig,
    emit: EventEmitter,
    is_cancelled: Callable[[], bool],
    run_id: str,
    max_attempts: int,
    checkpointer: Any,
    tool_names: list[str] | None = None,
    max_rounds: int = 6,
    max_calls: int = 8,
):
    enabled_tools = [name for name in (tool_names if tool_names is not None else ["calculator"]) if name == "calculator"]

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
        response = complete_model(model, {**state, "messages": messages}, attempt, is_cancelled, enabled_tools)
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
            validation_error = validate_calculator_call(call, enabled_tools, state.get("round_count", 0))
            if validation_error:
                emit("ToolCallRejected", {**payload, "code": validation_error[0], "message": validation_error[1]})
                messages.append(tool_message(call, _tool_error(validation_error[0], validation_error[1])))
                continue
            emit("ToolCallValidated", payload)
            emit("ToolExecutionStarted", payload)
            try:
                result = execute_calculator(call.arguments)
            except Exception as exc:
                message = _bounded_text(str(exc), 512)
                emit("ToolExecutionFailed", {**payload, "code": "TOOL_EXECUTION_FAILED", "message": message})
                raise ProviderError("The calculator tool failed.") from exc
            emit("ToolExecutionCompleted", {**payload, "status": "completed", "resultBytes": _utf8_bytes(result)})
            messages.append(tool_message(call, result))
        return {"messages": messages, "pending_tool_calls": [], "tool_call_count": call_count}

    def retry_on(exception: BaseException) -> bool:
        return isinstance(exception, RetryablePreDispatchError)

    def route_after_model(state: GraphState) -> str:
        return "tools" if state.get("pending_tool_calls") else END

    builder = StateGraph(GraphState)
    builder.add_node(
        "model",
        call_model,
        retry_policy=RetryPolicy(max_attempts=max_attempts, jitter=False, retry_on=retry_on),
    )
    builder.add_node("tools", execute_tools)
    builder.add_edge(START, "model")
    builder.add_conditional_edges("model", route_after_model, {"tools": "tools", END: END})
    builder.add_edge("tools", "model")
    return builder.compile(checkpointer=checkpointer)


def complete_model(
    model: ModelConfig,
    state: GraphState,
    attempt: int,
    is_cancelled: Callable[[], bool],
    tool_names: list[str] | None = None,
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
    if model == "fake-success":
        return ModelResponse(f"Fake response: {prompt}", [], empty_usage())
    if model == "fake-pre-dispatch-retry":
        if attempt == 1:
            raise RetryablePreDispatchError("The deterministic model failed before dispatch on its first attempt.")
        return ModelResponse(f"Fake response after retry: {prompt}", [], empty_usage())
    if model == "fake-pre-dispatch-failure":
        raise PreDispatchError("The deterministic model failed before dispatch.")
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
    definitions = [CALCULATOR_DEFINITION] if "calculator" in tool_names else []
    if definitions:
        payload_data["tools"] = definitions
        payload_data["tool_choice"] = "auto"
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
        if 400 <= exc.code < 500:
            raise ProviderError(f"OpenRouter rejected the request with HTTP {exc.code}.") from exc
        raise OutcomeUnknownError("OpenRouter returned an ambiguous server-side response.") from exc
    except ResponseTooLargeError:
        raise
    except json.JSONDecodeError as exc:
        raise ProviderError("OpenRouter returned an invalid JSON response.") from exc
    except (urllib_error.URLError, TimeoutError, OSError) as exc:
        raise OutcomeUnknownError("The OpenRouter response outcome could not be established.") from exc

    return parse_openrouter_response(body, tool_names)


def parse_openrouter_response(body: Any, tool_names: list[str]) -> ModelResponse:
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
            if _json_bytes(arguments) > MAX_TOOL_ARGUMENT_BYTES:
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


def read_bounded_response(response: Any) -> bytes:
    chunks: list[bytes] = []
    total_bytes = 0
    while True:
        chunk = response.read(64 * 1024)
        if not chunk:
            break
        total_bytes += len(chunk)
        if total_bytes > MAX_RESPONSE_BYTES:
            raise ResponseTooLargeError("OpenRouter returned a response larger than the configured safety limit.")
        chunks.append(chunk)
    return b"".join(chunks)


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


def validate_calculator_call(call: ToolCall, enabled_tools: list[str], round_number: int) -> tuple[str, str] | None:
    if call.tool_call_id == "" or len(call.tool_call_id) > MAX_TOOL_CALL_ID_CHARS:
        return "INVALID_CALL_ID", "Tool call ID is missing or unsafe."
    if call.name not in enabled_tools:
        return "UNKNOWN_TOOL", f"Tool is not enabled: {call.name}"
    if call.name != "calculator":
        return "UNKNOWN_TOOL", f"Tool is not registered: {call.name}"
    if round_number < 1:
        return "INVALID_ROUND", "Tool call round must be positive."
    if _json_bytes(call.arguments) > MAX_TOOL_ARGUMENT_BYTES:
        return "ARGUMENTS_TOO_LARGE", "Arguments exceed the calculator input limit."
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
