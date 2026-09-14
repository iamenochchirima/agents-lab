# Lab backend

The Lab backend contains the Fastify control plane, shared production-like agent host,
reusable capability definitions, platform runners, contracts, and deployment topology.
The control plane validates run requests, creates immutable manifests, dispatches to
registered runners, collects evidence, and streams observable run state. It does not
implement a platform's agent loop or durability model.
