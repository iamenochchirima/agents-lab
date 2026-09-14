# Profiles

Owns named agent configurations: identity, instruction sources, model defaults, tool
policy references, memory scope, workspace assignment, and channel-routing targets.

A profile is a configuration boundary, not a person or a session. One person may use
several profiles, and one profile may serve many isolated sessions. Gateway routing
selects a profile before the runtime admits a turn.

Profiles reference connected accounts and permitted integration capabilities by stable
identifier. They never store OAuth tokens or connector implementation details.
