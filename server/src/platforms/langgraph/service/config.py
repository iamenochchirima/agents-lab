"""Environment-backed configuration for the local LangGraph service."""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path


PLATFORM_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STATE_DIR = PLATFORM_ROOT / ".local"


@dataclass(frozen=True)
class ServiceConfig:
    host: str = "127.0.0.1"
    port: int = 2024
    state_dir: Path = DEFAULT_STATE_DIR
    context_root: Path = PLATFORM_ROOT.parents[4] / "lab" / "sessions"
    service_version: str = "0.1.0"
    protocol_version: int = 1
    default_max_attempts: int = 2
    default_timeout_ms: int = 30_000

    @property
    def database_path(self) -> Path:
        return self.state_dir / "langgraph.sqlite"

    @classmethod
    def from_environment(cls, environment: dict[str, str] | None = None) -> "ServiceConfig":
        values = os.environ if environment is None else environment
        state_dir = Path(values.get("AGENTLAB_LANGGRAPH_STATE_DIR", str(DEFAULT_STATE_DIR))).expanduser()
        context_root = Path(values.get("AGENTLAB_CONTEXT_ROOT", str(PLATFORM_ROOT.parents[4] / "lab" / "sessions"))).expanduser()
        return cls(
            host=values.get("AGENTLAB_LANGGRAPH_HOST", "127.0.0.1"),
            port=_positive_int(values.get("AGENTLAB_LANGGRAPH_PORT"), 2024, "AGENTLAB_LANGGRAPH_PORT"),
            state_dir=state_dir,
            context_root=context_root,
            default_max_attempts=_bounded_int(
                values.get("AGENTLAB_LANGGRAPH_MAX_ATTEMPTS"), 2, 1, 5, "AGENTLAB_LANGGRAPH_MAX_ATTEMPTS"
            ),
            default_timeout_ms=_bounded_int(
                values.get("AGENTLAB_LANGGRAPH_TIMEOUT_MS"), 30_000, 100, 300_000, "AGENTLAB_LANGGRAPH_TIMEOUT_MS"
            ),
        )


def python_version() -> str:
    return ".".join(str(part) for part in sys.version_info[:3])


def _positive_int(value: str | None, fallback: int, name: str) -> int:
    return _bounded_int(value, fallback, 1, 65_535, name)


def _bounded_int(value: str | None, fallback: int, minimum: int, maximum: int, name: str) -> int:
    resolved = fallback if value is None else int(value)
    if resolved < minimum or resolved > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}.")
    return resolved
