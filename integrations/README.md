# External integrations

An external integration lets Agent Harness Lab start, observe, and compare a system
that remains independently owned and runnable outside this repository.

The Lab owns the experiment request, normalized evidence boundary, and comparison
workflow. The integrated system owns its runtime, lifecycle, internal architecture,
and native telemetry. Do not copy an external system's runtime into this directory.

Computer Native is temporarily developed as the extraction-ready top-level
`computer-native/` project. Its Lab-side client and protocol mapping stay in
`integrations/computer-native/`; no runtime code belongs here.
