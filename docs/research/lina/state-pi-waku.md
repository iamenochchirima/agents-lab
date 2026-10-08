# State, persistence and recovery in Pi and Waku

Reviewed 2026-10-08. This study distinguishes saved conversation history from resumable execution. It compares the revisions already used by Lina's other studies: Pi `a276dabe57911253350bffb93cb7d7aff6a73261` and Waku `24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01`. Pi source was inspected from local pinned Git objects; Waku source was read from pinned official raw files. Official GitHub documentation was also opened online. No upstream process, crash experiment, model call or production storage test was run.

## What these implementations actually provide

| Implementation | Persisted material | Continuation supported by inspected design | Limit |
| --- | --- | --- | --- |
| Ordinary Pi coding agent | JSONL entry tree, model/instruction changes, completed messages, compaction and context edits | Reopen a conversation, select its branch and build another model request | Saved history does not establish resumable scheduler work or safe replay of external effects |
| Pi's separate experimental durable package | Entries, submissions, typed documents, tasks, checkpoints and ownership | Resume pending generation/tool tasks after reopening storage | Replay policies and storage configuration determine guarantees; the package is explicitly experimental |
| Waku full-agent path | SQLite completed exchanges and metadata; facts and episodes in separate tables | Reload a past conversation and retrieve durable knowledge | Its live model/tool loop and pending gateway work are not checkpointed in the inspected paths |

The detailed evidence follows. The names above are implementation boundaries, not maturity rankings.

## Ordinary Pi sessions

Pi saves automatically unless `--no-session` is selected. `--continue` opens the most recent session for the working directory; `--resume` and `/resume` select a session. `/tree` branches inside the existing file, while `/fork` creates another session. These are conversation operations. They do not promise rollback of tools that acted before the branch point. [Session commands](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/docs/sessions.md)

The session format has a versioned header and entries with IDs, parent IDs and timestamps. The current format is version 3. Messages, model changes, compaction, branch summaries and context edits have distinct entry types. [Session format](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/docs/session-format.md)

`SessionManager` rebuilds its index from entries and chooses the most recently appended entry as the loaded leaf. Context follows parent links from that leaf and interprets compaction and edits. A branch move changes an in-memory leaf; its next appended child records the chosen branch. Do not treat a bare branch move as an independently committed execution checkpoint. V1/V2 records migrate on load. The writer initially holds setup entries in memory, creates the file once a user/assistant message exists, and subsequently appends synchronously. The reader skips malformed lines and can repair a missing trailing newline. Migration rewrites open the same file with `w`; neither replacement through a temporary file, explicit `fsync`, nor a session-file writer lock appears in these manager methods. This is a bounded inspection of this writer, not a claim about every host's filesystem guarantees. [Session manager](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/session-manager.ts)

`AgentSession` records system, user, assistant and tool-result messages at `message_end`. Extension/public event notification precedes persistence. Streaming deltas are therefore not equivalent to acknowledged durable message records. Its runtime steering/follow-up queues and retries are separate from the entry tree. [Event and persistence ordering](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/agent-session.ts#L1074-L1167)

Provider message transformation synthesizes an error result saying "No result provided" when a tool call has no corresponding result. It omits errored/aborted assistant messages from provider replay. This repairs protocol structure; it does not prove the tool never ran or reconcile a filesystem/network effect. [Message transformation](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/ai/src/api/transform-messages.ts)

The ordinary official subagent example starts child Pi processes with `--no-session`. Its child transcript can be observed during the invocation, but that flag provides no child session to reopen after exit. [Subagent example](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/examples/extensions/subagent/index.ts)

## Pi's separate durable package

The package explicitly marks its API experimental. Its conversation commits combine entries, document updates and task creation. Pending work can resume after reopening SQLite/JSONL storage and starting the scheduler. Submission `requestId` deduplication reacquires the existing submission on retry. Cancelling a submission wait cancels that wait, while conversation abort is a separate operation. These are useful concrete semantics to represent in Lina without adopting the package as a dependency. [Durable package documentation](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/durable/README.md)

Generation checkpoints distinguish preparation, request, timed retry, polling and tool waits. Request state retains model/options and a transcript cutoff. Tool-wait state retains owned task IDs and sequential calls not yet started. A checkpoint therefore identifies a legal continuation, rather than saving an arbitrary live JavaScript stack. [Generation state](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/durable/src/harness/generation.ts#L50-L89)

A tool task commits final validated arguments and replay policy before execution. Recovery invokes it again only when both the recorded policy and current tool definition mark replay safe. Otherwise it settles an interrupted result with committed partial output and states that the tool may have partially run. This is direct evidence for recording intent separately from outcome, and for refusing blind write replay. Replay safety is a declared adapter contract, not an automatically established exactly-once guarantee. [Tool execution and recovery](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/durable/src/harness/tool.ts#L37-L110)

Durable subagent examples create a conversation owned by the parent tool task, find that same child on recovery, and use a stable child request ID. Ownership survives the suspended wait, so a restart need not create a second child. Child tasks can be checkpointed and joined; abort propagation follows ownership. This belongs to the durable package, not the ordinary subprocess example above. [Ownership and child tasks](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/durable/README.md#abort-and-subagents)

### Backend guarantees remain separate

SQLite commits table writes, document changes and sequence advancement through a transaction. The Node adapter serializes access and uses `BEGIN IMMEDIATE`, `COMMIT` and rollback. It configures competing-file-lock waits and WAL settings. A task/document commit is a database operation; an external tool effect is still outside it. [Storage commit](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/durable/src/storage/sqlite/storage.ts#L160-L184), [Node SQLite adapter](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/durable/src/storage/sqlite/node.ts)

Durable JSONL stores document/task sidecars before publishing a main commit marker. Recovery ignores/truncates unconfirmed tails and rejects damaged confirmed data. Write failures poison the open store, requiring reopen. Its `fsync` option defaults false; enabling it flushes affected sidecars before the marker, but the inspected commit path does not unconditionally flush the main marker before acknowledgment. Process-restart semantics must not be presented as unconditional power-loss durability. [JSONL storage](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/durable/src/storage/jsonl/storage.ts)

## Waku

`Session.add_exchange` adds the final user/reply pair to history and calls `Memory.log_chat`. Tool activity is folded into the assistant text. `log_chat` inserts the pair and commits; `Session.switch` reloads recent completed exchanges. That supports conversation reload, but the exchange is recorded after the live loop returns. A crash during a tool or after an effect but before this commit leaves no completed exchange proving that effect. [Session recording/reload](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/runtime/session.py#L93-L142), [Chat log persistence](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/memory/__init__.py#L130-L149)

The full-agent loop keeps native assistant tool calls and results in an in-memory message list. `respond` runs that loop, records the completed exchange, then consolidates memory. No resumable loop phase, pending-call journal or generic execution checkpoint appears in those inspected methods. A graph fallback can call the plain loop after a graph failure; that is runtime fallback, not durable recovery. [Application lifecycle](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/app.py), [Loop](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/loop/agent.py)

Waku's database keeps raw chats, semantic facts, episodic summaries and local calendar artifacts in different tables of `state.db`. Additive migrations inspect existing columns and commit additions. The connection sets a busy timeout; dashboard cross-thread reuse requires its owning lock. SQLite alone does not introduce a checkpoint protocol for the agent. [Database/schema](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/db.py)

The gateway serializes turns through a one-worker executor. Initial construction assigns its session ID without invoking session-history reload. Its queued work belongs to the executor; no persisted queue or restart claim appears in this runner. The graph engine similarly runs over a Python dictionary with wave snapshots and bounded steps, without a storage/checkpoint interface in the inspected engine. [Gateway ownership](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/gateway/runner.py), [Graph execution](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/graph/engine.py)

Experimental delegation launches Pi with `--no-session`, a task and working directory, then saves a log after invocation. That log is evidence of output; it is not a durable child-job registry. A timeout or subprocess termination does not reverse preceding writes. [Delegation](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/experimental.py#L186-L281)

## Implications for Lina

The following are proposed Lina responsibilities, inferred from these implementations and their limits.

| Proposed responsibility | Contract needed |
| --- | --- |
| Load state | Scoped session/run/task reads; coherent committed revision; distinguish missing, incompatible, corrupt and unavailable records |
| Record state | Stable write/admission ID, expected revision, atomic related changes, acknowledged/failed/conflict/unknown outcome; retain tool intent and outcome separately |
| Create checkpoint | Versioned continuation phase with source-record cutoff, owner IDs, pending waits/calls, joined results and retry timer; record it before declaring a suspend point resumable |
| Recover execution | Validate current code/contracts, identify incomplete work and resume only at supported boundaries; route uncertain tool effects to Tools reconciliation; avoid recreating children or reconsuming approvals |

Four nodes can represent these responsibilities if Record has explicit tagged operations for admission, intent, result, cancellation and grant/wait records. They should be invoked by their domain owners, not form a mandatory four-step pipeline for every message. Additional nodes are justified only when the fuller comparison finds an independently owned behavior that these contracts cannot express clearly.

State and Memory remain separate responsibilities even when they use the same database. A message transcript is a State record; selecting it for a request is Context work. Distilling facts and retrieving them for later tasks is Memory work. Waku's shared facade/database demonstrates physical co-location, not an architectural requirement to merge these responsibilities.

Execution owns legal transitions and waits. Tools owns replay/effect classification and reconciliation. Safety owns grant matching and authorization. State stores their acknowledged records and produces continuation evidence. Recovered work must recheck live permission, cancellation and adapter bindings before dispatch.

Useful simulation cases include a prompt saved before first response; incomplete tool/result pair; effect followed by lost result-write acknowledgment; duplicate input after restart; checkpoint before parallel siblings finish; checkpoint with one completed sibling; expired/revoked approval on resumption; cancelled wait with work still running; missing tool implementation; schema migration or corrupt record; and child recovery finding the existing child. Process-crash and power-loss cases need distinct labels. Pure deterministic fixtures can illustrate them, but cannot validate real storage or remote-effect guarantees.
