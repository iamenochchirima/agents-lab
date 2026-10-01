# Studio chat: inspect the reference assembly

This browser playground sends turns through one fixed assembly containing a
baseline implementation for all twelve Studio module areas. It is an interactive
way to inspect role boundaries and run evidence, not a benchmark or model-quality
experiment.

## Start it

From the repository root, run:

```sh
./scripts/run_local_stack.sh studio
```

The launcher starts the Studio API and shared web app. Press Ctrl-C to stop them.
Open `/studio` and choose **Open assembly chat**.

Send a message through deterministic Replay. Open **Turn evidence** to inspect
the assembly selections, Planning proposal, Memory recall/write, exact Context
messages, Model Interface request/response, and Observability receipts. Enable
**Save this message to session Memory** and send a later message with overlapping
terms to see a candidate recalled. Memory and chat history are process-local and
clear on New chat, idle-session eviction, or API restart.

Use **Run calculator scenario** to send one fixed `calculator.add(19, 23)` call
through Tool Use, Safety, and the scoped Environment. Use **Run computer scenario**
to click the fixture page's `say-hello` control through Computer Use and inspect
its before/after observations and verification. These scenarios use the same
assembly; they do not load alternate modules.

## Read the run record

The API writes each run beneath `lab/runs/run-<run-id>/` by default. `config.json`
records the full assembly selection and task, `events.jsonl` contains ordered
kernel events plus module evidence, and `result.json` contains the terminal
projection. The browser shows the recorder's append and flush receipts. A
successful turn may still report partial or unknown persistence; those statuses
are not equivalent to durable evidence.

The files contain the submitted task and model-visible Context without redaction.
Keep the local runs directory private and remove records when no longer needed.
Set `STUDIO_RUNS_ROOT` to use a different trusted local directory.

Replay does not answer semantically or call an LLM. The named scenarios use
deterministic scripted Model Interface behavior and an in-process fixture; they do
not access the network, a real browser, desktop, filesystem, or shell. Planning
proposes one advisory plan per turn and does not replan after actions. Session
Memory is not durable across API restart. These constraints keep this reference
assembly useful for contract and integration exploration without claiming
production behavior.
