# Lab runner adapter

`trigger-dev-runner.ts` is the only module in this platform that crosses into the
common `PlatformRunner` port. It calls the official SDK, returns safe execution
references, maps native statuses, and preserves unknown outcomes.

It does not write Lab evidence directly. The common run service writes normalized
events, trajectory, metrics, results, and `native/trigger-dev.json` from the
inspection returned by this adapter.
