# Gateway

Owns long-lived inbound and outbound communication with people and external message
surfaces. It will start with a local CLI adapter and can later host Telegram, WhatsApp,
Discord, Slack, HTTP, or other channel adapters.

The gateway normalizes an incoming event, authenticates and authorizes its source,
resolves a profile and session, invokes the runtime, and delivers a result. It must not
embed model-loop, tool, or workspace policy decisions. Those belong to the runtime and
its explicit dependencies.

An adapter must preserve enough source identity to avoid session collisions: platform,
account or workspace scope, chat, thread, sender, and message identifier where each is
available. Delivery must retain its own evidence and idempotency information.
