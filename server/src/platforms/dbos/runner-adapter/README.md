# Lab runner adapter

`dbos-runner.ts` implements the Lab runner protocol without exposing DBOS SDK types
to the common control plane. It submits through the DBOS service boundary, retains a
stable workflow ID and request hash, maps DBOS status to the Lab lifecycle, and
preserves step summaries in the native reference.

An unavailable service or lost start acknowledgement is not converted into success;
the stable workflow ID remains available for later reconciliation.
