# External integrations

An external integration lets Agent Harness Lab start, observe, and compare a system
that remains independently owned and runnable outside this repository.

The Lab owns the experiment request, normalized evidence boundary, and comparison
workflow. An integrated system owns its runtime, lifecycle, internal architecture, and
native telemetry. Do not copy an external system's runtime into this directory.

No external harness adapter is currently implemented here. Add one only with a
versioned request, event, artifact, and completion contract, plus evidence that the
integration can be run and observed independently.
