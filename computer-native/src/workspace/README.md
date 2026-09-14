# Workspace

Owns workspace ownership, files, and durable task-local documents. It is the seam
between agent logic and its permitted computer resources. Explicit run outputs belong
to the artifacts module, even when a tool produced them inside the workspace.
