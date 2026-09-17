# Daemon

Owns the lifecycle of the long-running Anesu service: startup, configuration
validation, readiness, health reporting, graceful drain, shutdown, restart recovery,
and process supervision integration.

The daemon keeps gateway adapters and the cron scheduler alive. It does not own agent
reasoning or turn execution. During shutdown it must stop admitting new work, allow or
cancel active turns according to explicit policy, persist recoverable state, and expose
enough diagnostic evidence to explain the outcome.
