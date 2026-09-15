"""SQLite-backed service records and platform-native event log.

LangGraph's SQLite checkpointer stores graph state in the same database file,
but this module owns a separate set of tables for HTTP admission, lifecycle,
redacted events, and terminal results. The Lab evidence store remains a
different writer and is never opened here.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class RunConflictError(Exception):
    """The same run identity was submitted with different immutable inputs."""


class RunNotFoundError(Exception):
    """The requested platform execution does not exist."""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


class SQLiteRunStore:
    def __init__(self, database_path: Path) -> None:
        database_path.parent.mkdir(parents=True, exist_ok=True)
        self.database_path = database_path
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(database_path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._connection.execute("PRAGMA synchronous=FULL")
        self._initialize()

    def close(self) -> None:
        with self._lock:
            self._connection.close()

    def _initialize(self) -> None:
        with self._lock, self._connection:
            self._connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS service_runs (
                    execution_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL UNIQUE,
                    thread_id TEXT NOT NULL,
                    request_fingerprint TEXT NOT NULL,
                    graph TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    prompt_hash TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT,
                    output TEXT,
                    error_json TEXT,
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    usage_json TEXT NOT NULL,
                    checkpoint_id TEXT,
                    checkpoint_step INTEGER,
                    checkpoint_count INTEGER NOT NULL DEFAULT 0,
                    pending_writes INTEGER NOT NULL DEFAULT 0,
                    cancel_requested INTEGER NOT NULL DEFAULT 0,
                    cancel_reason TEXT
                );
                CREATE TABLE IF NOT EXISTS service_events (
                    execution_id TEXT NOT NULL,
                    source_sequence INTEGER NOT NULL,
                    event_key TEXT NOT NULL UNIQUE,
                    kind TEXT NOT NULL,
                    run_id TEXT NOT NULL,
                    occurred_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY (execution_id, source_sequence),
                    FOREIGN KEY (execution_id) REFERENCES service_runs(execution_id)
                );
                CREATE INDEX IF NOT EXISTS service_events_run_sequence
                    ON service_events(execution_id, source_sequence);
                """
            )

    def create_or_get(self, request: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        execution_id = request["execution_id"]
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM service_runs WHERE execution_id = ?", (execution_id,)
            ).fetchone()
            if row:
                existing = self._row_to_run(row)
                if existing["request_fingerprint"] != request["request_fingerprint"]:
                    raise RunConflictError("The run ID was already admitted with different immutable inputs.")
                return existing, False

            record = {
                **request,
                "status": "queued",
                "created_at": now_iso(),
                "started_at": None,
                "finished_at": None,
                "output": None,
                "error_json": None,
                "attempt_count": 0,
                "usage_json": canonical_json({"inputTokens": None, "outputTokens": None, "totalTokens": None}),
                "checkpoint_id": None,
                "checkpoint_step": None,
                "checkpoint_count": 0,
                "pending_writes": 0,
                "cancel_requested": 0,
                "cancel_reason": None,
            }
            with self._connection:
                self._connection.execute(
                    """
                    INSERT INTO service_runs (
                        execution_id, run_id, thread_id, request_fingerprint, graph,
                        provider, model, prompt_hash, status, created_at, started_at,
                        finished_at, output, error_json, attempt_count, usage_json,
                        checkpoint_id, checkpoint_step, checkpoint_count, pending_writes,
                        cancel_requested, cancel_reason
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        record["execution_id"], record["run_id"], record["thread_id"],
                        record["request_fingerprint"], record["graph"], record["provider"],
                        record["model"], record["prompt_hash"], record["status"],
                        record["created_at"], record["started_at"], record["finished_at"],
                        record["output"], record["error_json"], record["attempt_count"],
                        record["usage_json"], record["checkpoint_id"], record["checkpoint_step"],
                        record["checkpoint_count"], record["pending_writes"],
                        record["cancel_requested"], record["cancel_reason"],
                    ),
                )
            return record, True

    def get(self, execution_id: str) -> dict[str, Any]:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM service_runs WHERE execution_id = ?", (execution_id,)
            ).fetchone()
        if not row:
            raise RunNotFoundError(execution_id)
        return self._row_to_run(row)

    def append_event(self, execution_id: str, kind: str, payload: dict[str, Any]) -> int:
        event_key = hashlib.sha256(
            canonical_json({"executionId": execution_id, "kind": kind, "payload": payload}).encode()
        ).hexdigest()
        with self._lock, self._connection:
            existing = self._connection.execute(
                "SELECT source_sequence FROM service_events WHERE event_key = ?", (event_key,)
            ).fetchone()
            if existing:
                return int(existing["source_sequence"])
            row = self._connection.execute(
                "SELECT COALESCE(MAX(source_sequence), 0) AS maximum FROM service_events WHERE execution_id = ?",
                (execution_id,),
            ).fetchone()
            sequence = int(row["maximum"]) + 1
            self._connection.execute(
                """
                INSERT INTO service_events (execution_id, source_sequence, event_key, kind, run_id, occurred_at, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (execution_id, sequence, event_key, kind, self.get(execution_id)["run_id"], now_iso(), canonical_json(payload)),
            )
            return sequence

    def events(self, execution_id: str) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT source_sequence, kind, run_id, occurred_at, payload_json FROM service_events WHERE execution_id = ? ORDER BY source_sequence",
                (execution_id,),
            ).fetchall()
        return [
            {
                "source": "langgraph-service",
                "sourceSequence": int(row["source_sequence"]),
                "kind": row["kind"],
                "runId": row["run_id"],
                "occurredAt": row["occurred_at"],
                "payload": json.loads(row["payload_json"]),
            }
            for row in rows
        ]

    def update_status(self, execution_id: str, status: str, *, started_at: str | None = None) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                "UPDATE service_runs SET status = ?, started_at = COALESCE(?, started_at) WHERE execution_id = ?",
                (status, started_at, execution_id),
            )

    def update_checkpoint(self, execution_id: str, checkpoint_id: str | None, step: int | None, pending_writes: int = 0) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                "UPDATE service_runs SET checkpoint_id = ?, checkpoint_step = ?, checkpoint_count = checkpoint_count + 1, pending_writes = ? WHERE execution_id = ?",
                (checkpoint_id, step, pending_writes, execution_id),
            )

    def update_attempt_count(self, execution_id: str, attempt_count: int) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                "UPDATE service_runs SET attempt_count = MAX(attempt_count, ?) WHERE execution_id = ?",
                (attempt_count, execution_id),
            )

    def request_cancel(self, execution_id: str, reason: str) -> tuple[dict[str, Any], bool]:
        with self._lock, self._connection:
            record = self.get(execution_id)
            if record["status"] in {"completed", "failed", "cancelled", "unknown"}:
                return record, False
            self._connection.execute(
                "UPDATE service_runs SET cancel_requested = 1, cancel_reason = ? WHERE execution_id = ?",
                (reason, execution_id),
            )
        self.append_event(execution_id, "RunCancellationRequested", {"reason": reason})
        return self.get(execution_id), True

    def cancellation_requested(self, execution_id: str) -> tuple[bool, str | None]:
        record = self.get(execution_id)
        return bool(record["cancel_requested"]), record["cancel_reason"]

    def finish(
        self,
        execution_id: str,
        *,
        status: str,
        finished_at: str,
        output: str | None,
        error: dict[str, Any] | None,
        attempt_count: int,
        usage: dict[str, int | None],
    ) -> bool:
        with self._lock, self._connection:
            result = self._connection.execute(
                """
                UPDATE service_runs
                SET status = ?, finished_at = ?, output = ?, error_json = ?,
                    attempt_count = ?, usage_json = ?
                WHERE execution_id = ? AND status IN ('queued', 'running')
                """,
                (status, finished_at, output, canonical_json(error) if error else None, attempt_count, canonical_json(usage), execution_id),
            )
            return result.rowcount == 1

    def mark_incomplete_unknown(self, reason_code: str, reason: str) -> None:
        with self._lock:
            rows = self._connection.execute(
                "SELECT execution_id FROM service_runs WHERE status IN ('queued', 'running')"
            ).fetchall()
        for row in rows:
            execution_id = row["execution_id"]
            error = {
                "code": reason_code,
                "message": reason,
                "failureKind": "outcome_unknown",
                "retryable": False,
            }
            self.finish(
                execution_id,
                status="unknown",
                finished_at=now_iso(),
                output=None,
                error=error,
                attempt_count=self.get(execution_id)["attempt_count"],
                usage={"inputTokens": None, "outputTokens": None, "totalTokens": None},
            )
            self.append_event(execution_id, "RunReconciliationRequired", {"code": reason_code, "message": reason})

    def _row_to_run(self, row: sqlite3.Row) -> dict[str, Any]:
        record = dict(row)
        record["error"] = json.loads(record.pop("error_json")) if record["error_json"] else None
        record["usage"] = json.loads(record.pop("usage_json"))
        record["cancel_requested"] = bool(record["cancel_requested"])
        return record
