# Integrations

Owns connections to external services and their account-level capabilities. An
integration encapsulates provider authentication, account discovery, API transport,
provider-specific request and response semantics, webhook verification where relevant,
and idempotency requirements for external side effects.

Examples include X, Facebook Pages, Instagram Business, LinkedIn, email, payments, and
business systems. A social connector may offer actions such as drafting, publishing,
reading account state, or inspecting a prior publication.

Profiles select allowed connected accounts by stable reference. Tools expose only the
approved actions to the model. Security controls credential access and whether public
or otherwise consequential actions require approval. Persistence retains the operation
and idempotency evidence; artifacts retain the resulting links or provider identifiers.

Integrations are not messaging channels. Receiving a WhatsApp message belongs to the
gateway; publishing to a connected Facebook Page belongs to an integration. A plugin
may add an integration, but no plugin API is defined until a first concrete connector
establishes the required lifecycle contract.
