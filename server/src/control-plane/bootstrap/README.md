# Bootstrap

Owns typed local configuration and server composition. `server.ts` builds the
control-plane seams once, starts in a degraded state when Temporal is unreachable,
and installs signal-driven shutdown for the Fastify app and Temporal client.
