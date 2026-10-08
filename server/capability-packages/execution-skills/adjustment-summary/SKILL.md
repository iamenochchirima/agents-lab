---
name: adjustment-summary
description: Run the referenced reporting script through the authorized connected execution service and inspect its computed business summary.
---

Use this procedure when asked to calculate and inspect the net amount of a saved
support order. Read the referenced `scripts/summary.json` using the skill resource
tool. Reading the script does not execute it.

If `procedures_execute` is in the admitted tools, submit the script's exact content
and its resource digest to that connected tool with the assigned namespace. The
execution service reads the saved business record and runs the declared steps.
Inspect the returned net amount, revision and script execution identity.

If that tool is unavailable or denied, report that execution is unavailable. Do
not calculate and claim that the connected script ran. This skill grants no tool
permissions, credentials, filesystem access or local shell execution.
