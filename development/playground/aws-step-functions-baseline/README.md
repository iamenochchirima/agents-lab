# AWS Step Functions baseline playground

This playground is for inspecting one real platform slice by hand. It is not a
test suite, scenario catalog, benchmark, or production run record.

## Observe one local run

1. Install the platform dependency using [`local-development.md`](../../../server/src/platforms/aws-step-functions/docs/local-development.md).
2. Start Step Functions Local and the platform service.
3. Submit a fake model prompt through the Lab UI or the platform runner.
4. Inspect the run's normalized result, ordered events, trajectory, metrics, and
   native AWS reference.
5. Repeat the run with `fake-retry-once`, then stop a `fake-timeout` execution.

Record observations separately for:

| Layer | Questions |
| --- | --- |
| Lab identity | Is `executionId` stable and different from `executionName` and `executionArn`? |
| Native lifecycle | Which AWS history events correspond to admission, Activity work, retry, completion, timeout, and abort? |
| Recovery | What remains inspectable after restarting the platform service? |
| Unknown outcome | Does an unavailable or uninspectable execution stay `reconciliation_required` with no output? |
| Emulator boundary | Which observations are local-emulator behaviour and which still require hosted AWS validation? |

The emulator is documented by AWS as unsupported and not feature-complete. Do
not treat a successful local observation as proof of the hosted service's full
guarantees.
