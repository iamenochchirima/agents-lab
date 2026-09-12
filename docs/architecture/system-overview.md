# System overview

The laboratory has one control plane and several replaceable implementation areas.

The command-line interface selects a platform, environment, harness configuration, scenario, and experiment. The runner creates the run context, chooses the execution mode, supervises lifecycle events, and gives the selected harness its runtime context. The harness performs the agent work. Telemetry and the run store record what happened. Evaluation reads the recorded evidence and produces metrics. The API exposes recorded data to the web application.

The main flow is:

CLI -> registry -> runner -> harness
runner -> telemetry -> run store
run store -> evaluation -> API -> web application

The control plane must not implement a framework's reasoning loop. A harness must not decide how the laboratory names or stores every run. The common interfaces are the seams between those responsibilities.

The first vertical slice should use one control platform, one environment, one scenario, one experiment, and a read-only run viewer. That slice will test the structure before the repository grows.
