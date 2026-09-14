# Sessions

Owns the active conversation: transcript, turn ordering, session metadata, compaction
state, and session recovery. It keeps short-term conversational history separate from
durable retrieved memory.

Every session records its originating profile and source identity. The gateway supplies
that source identity; sessions must not infer it from display names or ambient process
state, because doing so risks cross-user or cross-channel state leakage.

The first terminal slice records the fixed local values `source: "cli"` and
`profileId: "default"` in `session.json`. Gateway-supplied identities are deferred
until the gateway slice exists.
