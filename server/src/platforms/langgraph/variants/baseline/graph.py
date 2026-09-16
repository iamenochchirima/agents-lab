"""The real one-node LangGraph baseline graph.

The graph deliberately contains no tools or external side effects. The model
call is still a graph node, so checkpointing, node attempts, task identity,
streamed updates, and failure behaviour are observable as LangGraph behaviour.
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


class GraphState(TypedDict, total=False):
    prompt: str
    system_instruction: str
    output: str
    model_provider: str
    model_name: str
    node: str
    attempt_count: int
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


def build_baseline_graph(
    model: ModelConfig,
    emit: EventEmitter,
    is_cancelled: Callable[[], bool],
    run_id: str,
    max_attempts: int,
    checkpointer: Any,
):
    def call_model(state: GraphState, runtime: Runtime[Any]) -> GraphState:
        execution_info = runtime.execution_info
        attempt = execution_info.node_attempt
        emit(
            "GraphStepStarted",
            {"node": "model", "attempt": attempt, "taskId": execution_info.task_id, "runId": run_id},
        )
        emit(
            "ModelRequested",
            {
                "node": "model",
                "attempt": attempt,
                "provider": model.provider,
                "model": model.model,
                "requestSent": model.provider == "openrouter" or not model.model.startswith("fake-pre-dispatch"),
            },
        )
        output, usage = complete_model(model, state, attempt, is_cancelled)
        emit(
            "ModelResponse",
            {
                "node": "model",
                "attempt": attempt,
                "outputCharacters": len(output),
                "usage": usage,
            },
        )
        return {
            "output": output,
            "model_provider": model.provider,
            "model_name": model.model,
            "node": "model",
            "attempt_count": attempt,
            "usage": usage,
        }

    def retry_on(exception: BaseException) -> bool:
        return isinstance(exception, RetryablePreDispatchError)

    builder = StateGraph(GraphState)
    builder.add_node(
        "model",
        call_model,
        retry_policy=RetryPolicy(max_attempts=max_attempts, jitter=False, retry_on=retry_on),
    )
    builder.add_edge(START, "model")
    builder.add_edge("model", END)
    return builder.compile(checkpointer=checkpointer)


def complete_model(
    model: ModelConfig,
    state: GraphState,
    attempt: int,
    is_cancelled: Callable[[], bool],
) -> tuple[str, dict[str, int | None]]:
    if is_cancelled():
        raise CancellationError("Cancellation was requested before the model call started.")

    if model.provider == "fake":
        return complete_fake(model.model, state["prompt"], attempt, is_cancelled, model.timeout_ms)
    if model.provider == "openrouter":
        return complete_openrouter(model, state, is_cancelled)
    raise ConfigurationError("The configured model provider is not supported by the LangGraph baseline.")


def complete_fake(
    model: str,
    prompt: str,
    attempt: int,
    is_cancelled: Callable[[], bool],
    timeout_ms: int,
) -> tuple[str, dict[str, int | None]]:
    if model == "fake-success":
        return f"Fake response: {prompt}", empty_usage()
    if model == "fake-pre-dispatch-retry":
        if attempt == 1:
            raise RetryablePreDispatchError("The deterministic model failed before dispatch on its first attempt.")
        return f"Fake response after retry: {prompt}", empty_usage()
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
    raise ConfigurationError(f"Unknown fake model: {model}")


def complete_openrouter(
    model: ModelConfig,
    state: GraphState,
    is_cancelled: Callable[[], bool],
) -> tuple[str, dict[str, int | None]]:
    if not model.api_key:
        raise ConfigurationError("OPENROUTER_API_KEY is required for the openrouter provider.")
    if is_cancelled():
        raise CancellationError("Cancellation was requested before the OpenRouter request.")

    payload = json.dumps(
        {
            "model": model.model,
            "messages": [
                {"role": "system", "content": state["system_instruction"]},
                {"role": "user", "content": state["prompt"]},
            ],
        }
    ).encode()
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

    try:
        output = body["choices"][0]["message"]["content"]
        usage = body.get("usage") or {}
        if not isinstance(output, str) or not output.strip():
            raise TypeError
        if len(output) > MAX_OUTPUT_CHARS:
            raise ResponseTooLargeError("OpenRouter assistant output exceeded the configured safety limit.")
        return output, {
            "inputTokens": _optional_int(usage.get("prompt_tokens")),
            "outputTokens": _optional_int(usage.get("completion_tokens")),
            "totalTokens": _optional_int(usage.get("total_tokens")),
        }
    except (KeyError, IndexError, TypeError, ValueError) as exc:
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


def empty_usage() -> dict[str, int | None]:
    return {"inputTokens": None, "outputTokens": None, "totalTokens": None}


def _optional_int(value: object) -> int | None:
    return value if isinstance(value, int) and value >= 0 else None
