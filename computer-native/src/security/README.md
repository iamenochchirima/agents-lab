# Security

Owns permissions, secret boundaries, tool policy, resource limits, and sandbox-facing
security decisions. Do not treat environment isolation as sufficient authorization.

For external integrations, this includes credential access, OAuth-token boundaries,
account authorization, and approval policy for consequential actions such as a public
post or payment. An integration must never read another profile's credentials merely
because both are installed in the same process.
