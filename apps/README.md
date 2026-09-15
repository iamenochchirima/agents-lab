# Applications

This directory contains runnable applications that interact with the laboratory.

`lab-server/` is the Fastify server, `agent-host/` is the shared production-like
agent host, and `web/` is the React/Vite application. Applications may depend on
versioned contracts. They must not reach into Computer Native or backend platform
implementations, or duplicate run-processing rules.
