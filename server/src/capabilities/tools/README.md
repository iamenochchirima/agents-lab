# Tools

This directory owns the provider-neutral meaning of a tool call. It defines tool
schemas, validation outcomes, risk classes, execution results, and the allowlist
registry. It does not know how Restate, Temporal, OpenRouter, or the browser
stores or transports those values.

The registry is deny-by-default: a definition is visible to a model only when its
name is explicitly enabled for the run. Registration validates the schema version,
name, input schema, description, and resource limits. Validation happens again at
the execution boundary because a TypeScript union is not a runtime security
boundary. Tool error content and error messages are bounded before they can be
returned to a model or included in normalized lifecycle evidence.

The first implementation exposes only the pure, deterministic `calculator` tool.
It accepts a structured operation (`add`, `subtract`, `multiply`, or `divide`)
and rejects extra properties, non-finite values, division by zero, oversized
arguments, and oversized results. It has no shell, subprocess, filesystem,
network, dynamic import, or external side effect.

Risk classes are vocabulary for later platform policy, not permission by
themselves:

- `pure`: deterministic computation with no external effects;
- `read`: reads from an explicitly scoped resource;
- `write`: changes a local or durable resource;
- `external`: communicates with a third-party service.

Restate executes the enabled calculator through its own named durable action and
owns the model/tool loop. Other platforms must keep their own durability and
retry semantics at their adapter boundary. The shared registry must not become a
framework-specific agent runtime.
