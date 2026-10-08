# L07 language correction development observation — 2026-10-08

One free-model trial per Mastra, LangGraph, Temporal and Restate baseline ran from
17:45:29 to 17:52:26 UTC. L07 version 1 measures M02 with a fresh session:
a French report, an explicit correction to English, then another report without
a language reminder. Live suite 3 / grader 4 retains objective context assertions
separately from the semantic rubric. No human assessment was submitted.

The native runtime checkpoint was `9d1ede4`; each invocation records
`dc3a445aeafed1efe46f2e01990b7445891e744b` and `dirty: true`. Documentation/UI
work continued, while the native source was held stable during this batch.
This is development evidence, not three-trial readiness or a stable success rate.

| Baseline | Retained invocation | Objective assertions | Original outcome |
| --- | --- | --- | --- |
| Mastra | `live-33eb1f22-19e7-4086-ac7a-dfa890f50ed3` | 3/12; only first turn admitted | Error: dispatched model segment timed out; provider outcome unknown. |
| LangGraph | `live-38b14355-23a4-48a2-960a-d3cc30eae39f` | 22/22; all three turns completed | Blocked, review-required: objective delivery passes; language/fact compliance awaits actual human assessment. |
| Temporal | `live-16ccc281-7a89-4143-90cb-3c4e3cc90509` | 9/17; first turn completed, correction failed | Error: model Activity heartbeat was lost while the worker process remained alive; dispatched outcome unknown. |
| Restate | `live-a84da031-9065-431d-b68e-05275ba26df0` | 3/12; first turn queued | Error: observer deadline elapsed before model execution; retained deployment referenced a stopped endpoint. |

Counts are **zero pass, one blocked, three error**. Failed completion/context
assertions on interrupted cases do not independently establish that a model
ignored the correction. The original reports remain unchanged under
`lab/runs/.evals/<invocation>/summary.json` and each owner's
`lab/runs/<run-id>/artifacts/eval.json`.

## Controls and limitations

- Exact model: `nvidia/nemotron-3.5-lightning:free`. Fresh OpenRouter catalog
  confirmed zero prompt/completion pricing and supported tools/tool_choice/
  max_tokens before admission. Native requests use zero price ceilings,
  `require_parameters: true`, `allow_fallbacks: false`, and 512 output tokens.
  No paid model, substitute model or retry-until-pass campaign was used.
- Each turn used a 120,000 ms driver observation deadline. Mastra used a 120,000 ms
  active generation segment deadline; Temporal used 90,000 ms Activity
  start-to-close and 1,000 ms heartbeat deadlines. These scopes are different.
  Other native profile controls remain inspectable in each report's environment.
- A fresh shared session contains exactly the scenario prompts and retained
  answers. No connected tools, production records or native filesystem were used.
- LangGraph's mapped requests retain the correction and previous answers through
  all three turns. Its semantic result remains pending; successful context delivery
  is not automatic semantic approval.
- Temporal server history confirms timeout type HEARTBEAT for correction run
  `c1a3dfa1-c9c3-4195-8d8e-af100c36e073` after roughly 75 seconds, before the
  90-second start-to-close deadline. The worker stayed running. The model Activity
  emits heartbeats; the reason for this observed liveness gap is unresolved.
- Restate's registered deployment pointed to `127.0.0.1:29080`, while the refreshed
  service listened on `9080`. Registry presence alone did not prove a live endpoint.
  The trial made no observed model call and is an environment failure, not a model
  decision. The endpoint was corrected afterward for separately recorded core
  acceptance; that correction does not rewrite or pass this historical trial.

Execute another affected trial only after a relevant correction or explicit
additional measurement decision. Provider/runtime failures and pending semantic
judgment stay visible alongside passing mechanical evidence.

## Separate affected-path correction afterward

A controlled Temporal compaction summary delayed by 2,000 ms demonstrated that
context preparation lacked heartbeats despite its 1,000 ms heartbeat deadline.
The failing native observation is
`compaction-abfa27a9-45a5-43eb-998e-ec9964efcbf1`. Adding context-preparation
heartbeats made the same bounded native fixture pass in
`compaction-0f23f5a6-ee2a-4f8c-a94e-a7c9c7185b5b`; three affected B03 trials
passed in `behaviour-9a8be7fa-4ec9-4db7-9b1e-a97512c8b995`.

The L07 model Activity already emitted heartbeats, so its observed loss remains
unexplained. No free-model rerun was made for this different context-compaction
fix. Earlier core acceptance remains evidence at its recorded revision;
affected-path checks do not become a full final-revision readiness gate.
