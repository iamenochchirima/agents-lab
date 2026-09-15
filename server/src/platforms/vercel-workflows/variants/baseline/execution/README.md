# execution

Owns the official standalone Workflow build, the generated flow handler, the
deterministic workflow function, and the model step. The workflow function may
branch and sleep, but provider I/O belongs in a step.
