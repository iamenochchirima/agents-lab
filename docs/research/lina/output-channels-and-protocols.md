# Output channels and delivery protocols

Reviewed 2026-10-08. This is a source study for Lina's Reply/Delivery block, not an implementation or a delivery experiment. Pi is pinned to `a276dabe57911253350bffb93cb7d7aff6a73261`; Waku is pinned to `24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01`, matching the neighbouring Lina studies. Current Telegram documentation and Meta-owned documentation were read online. No bot credentials, model account, external recipient or paid runtime was used.

## What the block must own

A complete output design needs two separate records: what the agent produced and what each destination observed. A completed model answer does not establish delivery. A send acknowledgement does not establish that someone read the answer. This distinction appears both in messaging APIs and in Pi's local RPC lifecycle below.

The following is a proposed boundary, not a claim that any studied implementation already supplies it:

| Owner | Responsibility |
| --- | --- |
| Harness | Produce assistant messages, typed results, tool events and child-agent results with provenance |
| Reply composition | Select the user-visible answer, artifacts and requested interaction; preserve the original structured result |
| Delivery adapter | Resolve the authorized destination, render for its capabilities, upload artifacts, send or edit, and preserve provider responses |
| Delivery state | Track each recipient, part, revision and attempt independently; correlate subsequent receipts |
| Input adapter | Resolve a reply/button answer to the specific outstanding prompt and authorized actor |

Avoid making a raw text string the only output contract. At minimum distinguish a final answer, progress update, artifact reference, structured result, question or approval prompt, and internal child result. A JSON event stream is an execution protocol, not automatically a schema-validated answer. The artifact record needs content type, size, digest, source run and custody location. A machine-readable result needs a schema identity and validation outcome. Rendering either as chat text must retain the original for inspection.

## Telegram Bot API

The current official API documents these contracts:

| Concern | Contract |
| --- | --- |
| Text | `sendMessage`: 1–4096 characters after entity parsing; `parse_mode` or explicit entities |
| Routing | `chat_id`, `message_thread_id`, `reply_parameters` |
| Completion | Send returns a `Message`; edits identify an existing message |
| Streaming | `sendMessageDraft` targets private chats, uses nonzero `draft_id`, previews for 30 seconds; final `sendMessage` persists the answer |
| Artifacts | Upload multipart, fetch URL or reuse `file_id`; `file_unique_id` cannot send/download |
| Downloads | `getFile` URL valid at least one hour; credentials appear in its path |
| Controls | Inline keyboards/callback queries, reactions, edits and deletion have distinct methods and restrictions |
| Throttling | `ResponseParameters.retry_after` supplies flood-control delay |

[Telegram API](https://core.telegram.org/bots/api)

The FAQ advises roughly one message/second per chat, 20/minute per group and about 30/second for ordinary bulk broadcasts; bursts can trigger 429. It documents paid broadcast capacity separately. `file_id` values can be treated as persistent. Sending a Bot API call inside a webhook response prevents learning its success or result. [Telegram FAQ](https://core.telegram.org/bots/faq)

Design implication: persist message IDs and intended revisions. Draft success must remain a preview state; a failed final send must not leave the run marked delivered. Record ordinary send acceptance without inventing a general outbound read receipt. Store files independently if their retention matters to the experiment, and redact credential-bearing download URLs. A callback should select an already recorded action rather than supply unrestricted instructions.

## WhatsApp Cloud API

Meta's official Postman collection identifies `POST /{Phone-Number-ID}/messages` as the message endpoint. Replies refer to a prior message through context; the incoming context contains the original message ID and sender. These identifiers are conversation references, not a portable Telegram-style forum topic. [Message endpoint](https://www.postman.com/meta/whatsapp-business-platform/request/8gvd47s/send-text-message), [context object](https://www.postman.com/meta/whatsapp-business-platform/folder/hysdhqs/context-object)

The Meta-owned SDK documentation describes text `body`, formatting and optional `preview_url`; that SDK is archived. Do not equate its formatting with arbitrary Markdown or HTML. The live developer reference could not be read during this study, so this note does not assert a current text-length or formatting feature matrix. Validate length, escaping, supported message type and API version against the live reference before implementing an adapter. [Archived text contract](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/types/TextObject/)

Meta's interactive reply-button request sends `type: interactive` and returns a `wamid` identifier to track status. Incoming messages expose interactive and button results. These are suitable transport capabilities for approval prompts, but permission checks, expiry and one-use action semantics belong to the application. A transport button is not proof of authorization. [Reply buttons](https://www.postman.com/meta/whatsapp-business-platform/request/x0kd1at/send-reply-button), [incoming message object](https://www.postman.com/meta/whatsapp-business-platform/folder/1dtuocp/messages-object)

The media contract separates upload, reference and download. `POST /{phone-number-ID}/media` uploads; `GET /{media-ID}` resolves a URL; `DELETE /{media-ID}` deletes media; downloading uses that URL and an access token. Upload responses and inbound media webhooks provide media IDs. The collection lists image limits of 5 MB, document limits of 100 MB and audio/video limits of 16 MB, with MIME and codec restrictions. These values come from the collection rather than a fresh live-reference verification. [Meta media collection](https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ecb27be5-4d27-4763-bbee-6a8002c04bf3)

A retrieved media URL lasts five minutes and requires authentication; an ordinary unauthenticated fetch does not retrieve it. Preserve the media ID and custody record, not an expiring URL as the sole artifact reference. This study did not verify a current media-ID retention period. [Retrieve media URL](https://www.postman.com/meta/whatsapp-business-platform/request/fpj02x0/retrieve-media-url)

The status webhook object carries message ID, recipient, status and timestamp, with errors for failure. Its collection lists `sent`, `delivered`, `read`, `failed` and `deleted`; it also contains historical pricing material, so do not copy its whole object into a current schema. Track receipt evidence separately from the original HTTP response. Marking incoming messages read is a separate operation; the API does not allow the business to mark its outgoing messages read. [Status object](https://www.postman.com/meta/whatsapp-business-platform/folder/fuaee8l/statuses-object), [mark incoming message read](https://www.postman.com/meta/whatsapp-business-platform/request/ltlvmyf/mark-message-as-read?tab=body)

A receipt is provider evidence, not proof that a person understood the message. An absent read receipt must remain unknown; this study did not verify current read-receipt privacy rules or a client-display guarantee. Do not make run success depend on read status unless the scenario explicitly measures receipt availability.

The current Business Messaging Policy, updated September 23, 2026, requires recipient contact details and opt-in permission for subsequent communications, and respecting opt-out requests. A user message opens or resets a 24-hour customer-service window. Outside it, replies must use approved templates; initiating conversations also requires approved templates. Automation during the window must offer a clear escalation path. Thus a scheduled agent notification can be correctly composed yet ineligible to send as free-form text. [Current WhatsApp policy](https://whatsappbusiness.com/policy/)

The live developer pages failed to load. Current throughput limits, pair limits, webhook retry duration, text/caption lengths, media retention and edit/delete support therefore remain verification tasks. Do not turn Waku's setup prose about rates, account approval or pricing into platform guarantees. Test doubles can inject limits and duplicates without claiming those are Meta's current operational values. Record actual account/API-version limits when running a live experiment.

## CLI and Pi output

Pi's pinned print mode has two contracts. Text mode emits the last assistant message's text to stdout; errors/aborts produce diagnostics and a failing exit status. JSON mode emits a header and JSON event records, observes stdout backpressure and flushes output on cleanup. It disposes its runtime on SIGTERM/SIGHUP. A text-only consumer loses nontext content. [Print implementation](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/modes/print-mode.ts)

Pi RPC is long-lived JSONL over stdin/stdout. Correlate command responses by optional request ID, not arrival order. Stdout is reserved for protocol records; diagnostics go to stderr. Read continuously to avoid backpressure stalls. A successful prompt response reports accepted, queued or handled, not model completion. `agent_end` can precede automatic continuation; `agent_settled` represents the point where automatic work will not continue. A handled prompt may start no run. [RPC documentation](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/docs/rpc.md)

RPC extension UI sends requests with IDs and accepts matching `extension_ui_response` records. Pending requests live in a process-local map; timeout/abort resolves supported dialogs with defaults. It exposes explicit `abort`, while raw terminal input and several TUI customization operations are unavailable in RPC mode. Restart recovery for an outstanding UI request is not established by that map. [RPC implementation](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/modes/rpc/rpc-mode.ts)

Design implication: distinguish TTY rendering, batch text, event JSONL and bidirectional RPC as capabilities. Do not interpret terminal escape sequences as protocol records. A process exit, partial stdout, explicit abort acknowledgement and durable run result are different observations. Pipe closure and cancellation need defined policies for partial answers and artifacts. None should claim that already completed tool side effects were rolled back.

## What Waku actually supplies

The pinned CLI renders a Rich terminal interface, tool/gate observer activity and `result.reply`. It is a human-oriented interface rather than the Pi JSONL/RPC contract. Its input loop catches EOF/KeyboardInterrupt. [CLI gateway](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/gateway/cli.py)

The Telegram gateway handles text and calls `reply_text`. The runner first completes the agent turn, then sends its reply and records delivery exceptions. Its executor is process-local, not a durable outbound queue. [Telegram gateway](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/gateway/telegram.py), [runner](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/gateway/runner.py)

WhatsApp sends text through Graph API v21.0. `_send_message` returns a boolean after HTTP status validation; it does not preserve returned `wamid` or process status receipts. That boolean cannot establish read or delivery. [WhatsApp gateway](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/gateway/whatsapp.py)

Delegation starts Pi with `--no-session`, captures stdout/stderr, parses JSON events when supported and keeps raw transcripts. Selected subagent events go to an observer. The tool returns a bounded summary to its caller. This is useful internal response isolation: the parent can decide what becomes the user answer. It does not make child stdout an independently authorized external reply or create durable child-job/delivery recovery. [Delegation implementation](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/tools/experimental.py)

## Baseline engineering and optional capabilities

The essentials are destination/actor scoping; reply correlation; capability validation; typed content and artifact custody; per-part/per-recipient attempts; bounded queues; preserved provider IDs/errors; and an explicit cancellation/restart policy. Send policy must cover requested replies and proactive notifications separately. Record why a notification was suppressed or deferred.

Persist an outbound intent before dispatch, including output ID, recipient, reply target, content digest, part number and attempt ID. Persist returned provider IDs immediately. Store raw receipt events and derive status without discarding duplicates or regressing on delayed events. These are proposed controls, not provider guarantees.

A timeout after remote acceptance is an ambiguous outcome. A local idempotency key can prevent duplicate local dispatch, but cannot prove remote deduplication. Neither inspected messaging send contract establishes a general client-selected idempotency guarantee. After restart, choose and record the policy for unknown sends: reconcile where supported, retain unknown for review, or resend with duplicate risk. Keep uploaded-but-unsent artifacts and cleanup decisions visible.

Fanout is a set of recipient deliveries, each of which can partly fail. Multipart replies also partly fail. Retry only the eligible failed/unknown parts according to the chosen policy; never label the entire fanout delivered because one send succeeded. Do not rerun the model solely to repair delivery unless that is the experiment variable.

Optional capability flags can cover previews, edits, reactions, deletion, rich layouts, interactive prompts, voice and multi-recipient fanout. Unsupported operations should return an explicit result and a documented fallback. Editing/deleting messages should not erase the run's original evidence. Interactive actions need prompt ID, authorized actor, expiry, allowed response set and stale/duplicate-answer handling in coordination with Input.

## Experiments worth running

These are proposed experiments, not observed results. Basic escaping, size validation, destination isolation and truthful receipt labels are correctness requirements, not competing harness strategies.

| Variable | Hypothesis | Required measurements and failures |
| --- | --- | --- |
| Final-only versus periodic edits versus supported ephemeral drafts | Earlier visibility improves task interaction at a measurable delivery cost | First visible preview, first accepted final, request count, revisions, throttling, lost final send and cancellation |
| Chunked text versus summary plus downloadable artifact | Representation changes retrieval effort and information preservation | Exact content digest, part ordering, omissions, artifact accessibility after restart/URL expiry, user retrieval task |
| Retry unknown sends versus hold for reconciliation | Recovery policy trades duplicate delivery against unresolved output | Crash before dispatch, remote acceptance with lost response, crash before local acknowledgement, duplicates and unresolved age |
| Immediate progress versus bounded coalescing | Coalescing reduces noise and queue load without hiding meaningful failures | Update count, freshness, queue depth, recipient limits, slow consumers and final-message latency |
| Buttons versus typed answers for the same prompt | Interaction format changes valid completion and stale-answer errors | Correlation accuracy, unauthorized/stale/duplicate replies, expired prompts, restart while pending |
| Parent-selected child summary versus direct child publication | Publication policy changes accuracy and disclosure risk | Same child results, provenance, premature/inconsistent answers, internal/tool detail leakage and final-answer coverage |

Hold harness/model/prompt/scenario, recipient fixtures, media bytes, API version, rendering policy and failure schedule fixed when comparing delivery strategies. Record channel capability declarations, account limits, timestamps, provider IDs, attempt/part/revision IDs, receipt events and artifact digests in run evidence. Use deterministic adapters for repeatable loss, reordering, timeout and rate-limit injections. Optional live checks establish actual platform behaviour for the tested version and account only. They should not require a particular paid model or provider to run the baseline suite.

Validation was source inspection only. No runtime or live delivery guarantee was tested. The explicit Meta verification gaps above prevent treating this note as a current production API specification.
