# DBOS baseline semantics

The runner derives `dbos:<run-id>` as the DBOS workflow ID and hashes the immutable
run inputs. A repeated request with the same workflow ID and hash is treated as an
existing workflow. A conflicting request is rejected.

DBOS stores workflow progress, step status, and recovery metadata in PostgreSQL.
The model call is one DBOS step. A retry can repeat an external provider call when
the acknowledgement boundary is ambiguous; the baseline records that possibility
and does not claim exactly-once model execution.

The service exposes only a narrow HTTP boundary:

- `GET /health` and `GET /ready` report service/database readiness.
- `POST /workflows` admits a workflow by stable ID.
- `GET /workflows/:id` reads DBOS status, result, and step summaries.
- `POST /workflows/:id?cancel=1` requests cancellation.

The Lab server writes normalized events, trajectory, metrics, result, and
`native/dbos.json`. DBOS passwords, full connection strings, prompts, provider
headers, and raw model responses are excluded from native evidence.

An in-flight workflow remains owned by DBOS after the Lab server restarts. If the
workflow cannot be found or the service is unavailable, the Lab keeps the last
known projection and requires reconciliation; it does not fabricate a terminal
result.
