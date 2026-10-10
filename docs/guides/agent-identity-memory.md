# Agent identity, memory and live instructions

Open a platform's **Chat**, then **Agent settings**. Identity and saved memory are
shared across Temporal, Restate, LangGraph, Mastra and Vercel Workflows. Connected
tools and skills continue to come from the shared capability catalog.

## Identity

Edit the agent's name, purpose, communication style, initiative and behavior.
Saving applies the new revision to new conversations on every platform. An
existing conversation retains its original identity so its context is reproducible.
The editor can export or import identity Markdown. It is workspace configuration,
not a file the agent edits and not a tool-permission mechanism.

## Saved memory

Ask the agent to remember a preference or fact, or use **Memory → Add memory**.
For example: “Remember that I prefer concise checklists.” The agent has explicit
search, read, save, update and forget tools. Saving requires an explicit user
request in the system instructions; there is no automatic extraction from chats.

The editor shows the saved content, revision and provenance. Edit a record to
correct it. Forget prevents future retrieval; earlier conversations and run
records still contain their original context. **Use saved memory** can be turned
off before starting a task. That run then has no recall or memory-tool access.

Preferences are recalled within a bounded allowance. Facts use lexical matching
against the new prompt. This is intentionally a small explicit retrieval method;
semantic search and automatic memory consolidation are not implemented.

Ordinary chats share the local workspace namespace. Runs declaring an experiment
or comparison use a separate namespace, so evaluation fixtures do not borrow
personal memories. A conversation cannot change namespace halfway through.
The editor manages the ordinary workspace; experiment memories remain inspectable
through their run evidence and recorded namespace.

## Questions and instructions during a task

When a necessary detail is missing, the agent can call **ask_user**. Its question
appears in the assistant message with an answer field and **Reply**. The native
execution waits for the matching answer. Refreshing retains the question, answer
and unsent reply draft.

While a task is running, the composer accepts a new instruction. Its inline card
first shows **Saved, awaiting agent**, then **Received by agent** after the native
execution consumes it. Acceptance and consumption are distinct. The instruction
is applied at the next safe execution boundary; it cannot undo an already
started external operation.

Changing direction cancels pending action proposals. A changed tool call needs a
fresh inline approval. Already dispatched actions retain their actual outcome.
Consumed answers and instructions become conversation history before the final
answer, so later turns preserve the correction.

## Local setup and evidence

Use the normal [local development](local-development.md) services. The API owns
persistent workspace identity/memory, ordered input storage and delivery. Native
workers own execution, suspension and continuation. This does not add a native
agent filesystem or require a shared VM.

Run manifests record identity revision, memory namespace, memory enabled state and
recalled record IDs. Context snapshots preserve the exact projected content.
Tool receipts and input boundary receipts retain execution evidence. Local JSON
storage has a single API owner; it is not a distributed multi-user database.
Credentials stay in the existing separate encrypted connection store.

See [the architecture](../architecture/agent-identity-memory-interaction.md) for
storage boundaries, replay behavior and platform-specific guarantees.
