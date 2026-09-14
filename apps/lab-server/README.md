# Lab server

The Lab server is the Fastify control plane. It validates run requests, creates
immutable run manifests, dispatches to registered runners, collects evidence, and
streams observable run state. It does not implement an agent loop or platform runtime.
