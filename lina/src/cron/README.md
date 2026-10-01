# Cron

Owns persisted schedules, timer evaluation, wake-up requests, and scheduled-run
delivery. A scheduled job is not a background prompt: it is a durable declaration of
when work should be admitted and where an outcome should be sent.

Cron may request a runtime turn, but it must not duplicate runtime logic. It records
the schedule, trigger identity, execution outcome, retry policy, and delivery status so
that restart and duplicate-tick behaviour can be understood and tested.
