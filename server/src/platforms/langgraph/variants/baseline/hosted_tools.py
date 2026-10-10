"""Frozen tool catalog validation and the authenticated capability host boundary.

The graph still owns tool decisions and lifecycle. Hosted implementations run in
an independently configured capability host; no endpoint or credential travels
in a model-facing descriptor. Transport failures after dispatch are ambiguous
and are never retried here.
"""
from __future__ import annotations

import functools
import json
import re
import http.client
import socket
import threading
import time
from urllib.parse import urlsplit
from pathlib import Path
from typing import Any, Callable

from jsonschema.validators import validator_for
from referencing import Registry


def catalog_tools(snapshot: dict[str, Any] | None, enabled: list[str]) -> dict[str, dict[str, Any]]:
    if snapshot is None:
        return {}
    if snapshot.get("schemaVersion") != 1 or not isinstance(snapshot.get("revision"), str):
        raise ValueError("Invalid frozen tool catalog identity.")
    descriptors = snapshot.get("tools")
    if not isinstance(descriptors, list) or len(descriptors) > 128:
        raise ValueError("Invalid frozen tool catalog entries.")
    selected: dict[str, dict[str, Any]] = {}
    for descriptor in descriptors:
        definition = descriptor["definition"]
        name = definition["name"]
        if name in selected:
            raise ValueError(f"Duplicate catalog tool: {name}.")
        validator_for(definition["inputSchema"]).check_schema(definition["inputSchema"])
        selected[name] = descriptor
    if any(name not in selected for name in enabled):
        raise ValueError("An enabled tool is absent from the frozen tool catalog.")
    return {name: selected[name] for name in enabled}


def validate_arguments(descriptor: dict[str, Any], arguments: Any) -> tuple[str, str] | None:
    definition = descriptor["definition"]
    if len(json.dumps(arguments, separators=(",", ":"), ensure_ascii=False).encode()) > definition["limits"]["maxArgumentBytes"]:
        return "ARGUMENTS_TOO_LARGE", "Arguments exceed the selected tool input limit."
    failure = next(validator_for(definition["inputSchema"])(definition["inputSchema"], registry=Registry()).iter_errors(arguments), None)
    if failure is not None:
        # Validation diagnostics can echo provider arguments. Return a bounded
        # path and keyword instead, while preserving the actual failed check.
        path = ".".join(str(part) for part in failure.absolute_path)[:128] or "arguments"
        return "INVALID_ARGUMENTS", f"Invalid {path}: failed {failure.validator}."
    return None


@functools.lru_cache(maxsize=8)
def host_key(key_file: str) -> str:
    key = Path(key_file).read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"[a-f0-9]{64}", key):
        raise ValueError("Capability host credential is invalid.")
    return key


def execute_hosted(
    descriptor: dict[str, Any], revision: str, arguments: Any,
    *, run_id: str, turn_id: str, tool_call_id: str, round_number: int,
    is_cancelled: Callable[[], bool], endpoint: str, key_file: str,
) -> dict[str, Any]:
    if is_cancelled():
        return failed("cancelled", "TOOL_CANCELLED", "Tool execution was cancelled before dispatch.")
    try:
        token = host_key(key_file)
    except (OSError, ValueError):
        return failed("failed", "CAPABILITY_HOST_NOT_CONFIGURED", "The native worker cannot read its capability host credential.")
    payload = {"runId": run_id, "turnId": turn_id, "catalogRevision": revision,
               "call": {"toolCallId": tool_call_id, "name": descriptor["definition"]["name"], "arguments": arguments, "round": round_number}}
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
    parsed = urlsplit(endpoint)
    if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password:
        return failed("failed", "CAPABILITY_HOST_NOT_CONFIGURED", "The capability host endpoint must be a configured HTTP(S) URL.")
    connection_class = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    deadline_seconds = descriptor["definition"]["limits"]["timeoutMs"] / 1000 + 2
    connection = connection_class(parsed.hostname, parsed.port, timeout=deadline_seconds)
    maximum = descriptor["definition"]["limits"]["maxResultBytes"] + 16_384
    finished = threading.Event()
    interrupted = threading.Event()
    outcome: list[dict[str, Any]] = []
    def perform() -> None:
        try:
            connection.connect()
            if interrupted.is_set() or is_cancelled():
                outcome.append(failed("cancelled", "TOOL_CANCELLED", "Tool execution was cancelled before dispatch."))
                return
            connection.request("POST", parsed.path.rstrip("/") + "/internal/capabilities/execute", body=body,
                headers={"Content-Type": "application/json", "Authorization": "Bearer " + token})
            response = connection.getresponse()
            if response.status in {400, 401, 403, 404, 409}:
                outcome.append(failed("failed", "CAPABILITY_HOST_REJECTED", f"The capability host rejected execution with HTTP {response.status}."))
                return
            if response.status != 200:
                outcome.append(failed("unknown", "TOOL_UNKNOWN", "The capability host execution outcome could not be confirmed."))
                return
            raw = response.read(maximum + 1)
            if len(raw) > maximum:
                raise ValueError("Oversized host acknowledgement")
            result = json.loads(raw)
            if not isinstance(result, dict) or result.get("status") not in {"completed", "failed", "cancelled", "timed_out", "unknown"} or not isinstance(result.get("content"), str):
                raise ValueError("Invalid host acknowledgement")
            if len(result["content"].encode("utf-8")) > descriptor["definition"]["limits"]["maxResultBytes"]:
                raise ValueError("Oversized tool content")
            outcome.append(result)
        except (OSError, ValueError, http.client.HTTPException):
            outcome.append(failed("unknown", "TOOL_UNKNOWN", "The capability host execution outcome could not be confirmed."))
        finally:
            connection.close()
            finished.set()
    worker = threading.Thread(target=perform, daemon=True)
    worker.start()
    deadline = time.monotonic() + deadline_seconds
    while not finished.wait(0.05):
        cancelled = is_cancelled()
        timed_out = time.monotonic() >= deadline
        if cancelled or timed_out:
            interrupted.set()
            # Closing a dispatched request propagates disconnect to the host;
            # it cannot establish whether an external side effect completed.
            if connection.sock is not None:
                try:
                    connection.sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
            connection.close()
            side_effecting = descriptor["definition"]["riskClass"] in {"write", "external"}
            status = "unknown" if side_effecting else "cancelled" if cancelled else "timed_out"
            code = "TOOL_UNKNOWN" if side_effecting else "TOOL_CANCELLED" if cancelled else "TOOL_TIMEOUT"
            return failed(status, code, "The dispatched tool was interrupted; its effect is unconfirmed." if side_effecting else "Tool execution was interrupted.")
    return outcome[0]



def failed(status: str, code: str, message: str) -> dict[str, Any]:
    return {"status": status, "content": json.dumps({"code": code, "error": message}),
            "error": {"code": code, "message": message}, "durationMs": 0, "attemptCount": 1}


def prepare_hosted(
    descriptor: dict[str, Any], revision: str, arguments: Any,
    *, run_id: str, turn_id: str, tool_call_id: str, round_number: int,
    is_cancelled: Callable[[], bool], endpoint: str, key_file: str,
) -> dict[str, Any] | None:
    """Persist exact-call review before native interruption. No source effects.

    Replaying this prepare after checkpoint resume returns the same durable
    proposal identity. Dispatch authority is checked separately by the host.
    """
    if is_cancelled():
        raise ValueError("Invocation proposal was cancelled before preparation.")
    parsed = urlsplit(endpoint)
    if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password:
        raise ValueError("Capability host endpoint must be configured HTTP(S).")
    connection_class = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    connection = connection_class(parsed.hostname, parsed.port, timeout=30)
    payload = {"runId": run_id, "turnId": turn_id, "catalogRevision": revision,
               "call": {"toolCallId": tool_call_id, "name": descriptor["definition"]["name"], "arguments": arguments, "round": round_number}}
    try:
        connection.request("POST", parsed.path.rstrip("/") + "/internal/capabilities/prepare", body=json.dumps(payload).encode(),
                           headers={"Content-Type": "application/json", "Authorization": "Bearer " + host_key(key_file)})
        response = connection.getresponse()
        if response.status != 200:
            raise ValueError(f"Invocation proposal rejected with HTTP {response.status}.")
        raw = response.read(256 * 1024 + 1)
        if len(raw) > 256 * 1024:
            raise ValueError("Invocation proposal acknowledgement exceeds its limit.")
        result = json.loads(raw)
        if result is not None and (not isinstance(result, dict) or result.get("schemaVersion") != 1 or result.get("runId") != run_id or result.get("call", {}).get("toolCallId") != tool_call_id or not isinstance(result.get("revision"), int)):
            raise ValueError("Invalid invocation proposal acknowledgement.")
        return result
    finally:
        connection.close()


def project_model_content(result: dict[str, Any]) -> tuple[str, list[str]]:
    """Project supported text/JSON explicitly; retain other blocks as evidence.

    This baseline uses text OpenAI-style tool messages. An image/audio block is
    never described as having been perceived by the model.
    """
    blocks = result.get("contentBlocks")
    texts: list[str] = [] if isinstance(blocks, list) else [result["content"]]
    unsupported: list[str] = []
    for block in blocks if isinstance(blocks, list) else []:
        if not isinstance(block, dict):
            unsupported.append("invalid")
        elif block.get("type") == "text" and isinstance(block.get("text"), str):
            texts.append(block["text"])
        elif block.get("type") == "resource" and isinstance(block.get("resource"), dict) and isinstance(block["resource"].get("text"), str):
            texts.append(block["resource"]["text"])
        elif block.get("type") == "resource_link":
            texts.append(json.dumps({"resourceLink": block.get("uri"), "name": block.get("name")}, separators=(",", ":")))
        else:
            unsupported.append(str(block.get("type", "unknown")) if isinstance(block, dict) else "invalid")
    if "structuredContent" in result and not any(_equivalent_json_text(text, result["structuredContent"]) for text in texts):
        texts.append(json.dumps(result["structuredContent"], separators=(",", ":")))
    if unsupported:
        texts.append("Unsupported tool content retained in evidence: " + ", ".join(sorted(set(unsupported))) + ".")
    return "\n".join(texts), sorted(set(unsupported))


def _equivalent_json_text(text: str, structured: Any) -> bool:
    """Deduplicate only an equivalent JSON representation; raw receipts stay unchanged."""
    def invalid_constant(value: str) -> None:
        raise ValueError(value)
    try:
        return _json_equivalent(json.loads(text, parse_constant=invalid_constant), structured)
    except (ValueError, TypeError):
        return False


def _json_equivalent(left: Any, right: Any) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if isinstance(left, dict) or isinstance(right, dict):
        return isinstance(left, dict) and isinstance(right, dict) and left.keys() == right.keys() and all(_json_equivalent(value, right[key]) for key, value in left.items())
    if isinstance(left, list) or isinstance(right, list):
        return isinstance(left, list) and isinstance(right, list) and len(left) == len(right) and all(_json_equivalent(a, b) for a, b in zip(left, right))
    return left == right
