import {
  choice, count, fixed, flag, inputEdges, list, nullable, object, output, sample,
  text, union, replaceField, type ContractDefinition, type Json, type Payload,
} from './schema';
import {
  attachmentRef, attachmentRouted, claim, content, destination, envelope, failure, identity, operation, outputRecord,
  routed, source, person, operationAuthorization, ordinaryOperation, queueOperation, stopOperation, promptOperation, commandOperation,
} from './shared';

// Provisional design contracts. The service must verify these facts; examples are synthetic.
const normalized = object({ envelope });
const identified = object({ envelope, identity });
const access = object({
  grantId: text('chat-grant-demo'),
  policyRevision: count(1),
  scope: choice(['owner-cli', 'approved-dm', 'approved-group']),
});
const permitted = object({ envelope, identity, access });
const routedInput = object({ record: routed });
const claimedInput = object({ record: routed, claim });
const authorizedInput = object({ record: routed, claim, operation, operationAuthorization });
const resolvedIdentity = object({ outcome: fixed('resolved'), person });
const unresolvedIdentity = object({ outcome: fixed('unresolved'), senderId: text('sender-unknown-demo') });
const unresolvedInput = replaceField(replaceField(identified, 'identity', unresolvedIdentity), 'envelope', replaceField(envelope, 'source', replaceField(source, 'senderId', text('sender-unknown-demo'))));
const receipt = object({
  record: routed,
  claim,
  state: choice(['claimed', 'retryable', 'rejected', 'accepted', 'uncertain']),
  statusRevision: count(1),
  custodyReferences: list(text('original:attachment-001'), []),
});
const existingInput = object({ requester: routedInput, existing: receipt });
const identifiedContext = object({
  identityLinksRevision: count(1),
  links: list(object({ channelAccountId: text('account-demo'), senderId: text('sender-demo'), personId: text('person-demo'), linkId: text('link-demo'), active: flag(true) })),
  authenticatedAccounts: list(object({ accountId: text('account-demo'), personId: text('person-demo'), owner: flag(true) })),
});
const chatGrants = object({
  policyRevision: count(1),
  ownerPersonId: text('person-demo'),
  dmGrants: list(object({ grantId: text('chat-grant-demo'), personId: text('person-demo'), allowed: flag(true) })),
  groupGrants: list(object({ accountId: text('account-demo'), chatId: text('chat-demo'), approved: flag(true), allowedPersonIds: list(text('person-demo')) })),
});

function event(channel: 'cli' | 'whatsapp' | 'telegram'): Payload {
  const forChannel = (value: Payload) => replaceField(value, 'channel', fixed(channel));
  return object({
    source: replaceField(forChannel(source), 'scope', fixed('personal')), content, destination: forChannel(destination),
    selectedConversationId: sample(nullable(text('conversation-demo')), null),
    requestedOperation: sample(nullable(operation), null),
    transportFacts: object({
      connectionId: nullable(text('connection-demo')),
      authenticationEvidenceRef: nullable(text('verified-connection-demo')),
      transportProofRef: nullable(text('transport-verification-demo')),
      mentionsLina: flag(true), replyToLina: flag(false),
      albumId: sample(nullable(text('album-demo')), null),
      messageId: text('message-001'), sourceTimestamp: nullable(text('2026-10-07T10:00:00Z')),
    }),
  });
}

const integer = (example: number): Payload => ({ schema: { type: 'integer' }, example });
const telegramUser = object({ id: count(123456), is_bot: flag(false), first_name: text('Example person') });
const privateChat = object({ id: count(123456), type: fixed('private') });
const groupChat = object({ id: integer(-100123456), type: fixed('group') });
const supergroupChat = object({ id: integer(-100987654), type: fixed('supergroup'), is_forum: flag(true) });
const channelChat = object({ id: integer(-100555555), type: fixed('channel'), title: text('Example channel') });
const messageBody = {
  message_id: count(42), date: count(1791367200), text: nullable(text('What is 2 + 2?')),
  attachmentReferences: list(attachmentRef, []),
  media_group_id: sample(nullable(text('album-demo')), null),
  mentionsLina: flag(false), replyToLina: flag(false),
};
const telegramDmMessage = object({ ...messageBody, chat: privateChat, from: telegramUser });
const telegramGroupMessage = object({ ...messageBody, mentionsLina: flag(true), chat: groupChat, from: nullable(telegramUser), sender_chat: sample(nullable(groupChat), null) });
const telegramTopicMessage = object({ ...messageBody, mentionsLina: flag(true), chat: supergroupChat, from: nullable(telegramUser), sender_chat: sample(nullable(supergroupChat), null), message_thread_id: count(7) });
const telegramSupergroupMessage = object({ ...messageBody, mentionsLina: flag(true), chat: supergroupChat, from: nullable(telegramUser), sender_chat: sample(nullable(supergroupChat), null) });
const telegramChannelMessage = object({ ...messageBody, chat: channelChat, sender_chat: channelChat, author_signature: sample(nullable(text('Display signature only')), null) });
const imageAttachment = replaceField(attachmentRef, 'mediaType', fixed('image'));
const voiceAttachment = replaceField(replaceField(replaceField(attachmentRef, 'mediaType', fixed('audio')), 'caption', fixed(null)), 'retrievalRef', text('adapter-media:voice-demo'));
const imageDmMessage = replaceField(replaceField(telegramDmMessage, 'text', fixed(null)), 'attachmentReferences', list(imageAttachment, [imageAttachment.example], 1));
const voiceDmMessage = replaceField(replaceField(telegramDmMessage, 'text', fixed(null)), 'attachmentReferences', list(voiceAttachment, [voiceAttachment.example], 1));
const albumGroupMessage = replaceField(replaceField(replaceField(telegramGroupMessage, 'text', fixed(null)), 'attachmentReferences', list(imageAttachment, [imageAttachment.example], 1)), 'media_group_id', text('album-demo'));
const anonymousGroupMessage = replaceField(replaceField(telegramGroupMessage, 'from', fixed(null)), 'sender_chat', groupChat);
const wireExtras: Payload = { schema: { type: 'object', additionalProperties: true, description: 'Original Bot API update retained separately from typed projection; not authorization evidence.' }, example: {} };
function telegramUpdate(form: string, fields: Record<string, Payload>): Payload {
  return object({ form: fixed(form), botAccountId: text('account-demo'), update_id: count(101), ...fields, originalUpdate: wireExtras });
}
const telegramDm = telegramUpdate('message-private', { message: telegramDmMessage });
const telegramGroup = telegramUpdate('message-group', { message: telegramGroupMessage });
const telegramTopic = telegramUpdate('message-supergroup-topic', { message: telegramTopicMessage });
const telegramSupergroup = telegramUpdate('message-supergroup', { message: telegramSupergroupMessage });
const telegramImage = telegramUpdate('message-private-image', { message: imageDmMessage });
const telegramVoice = telegramUpdate('message-private-voice', { message: voiceDmMessage });
const telegramAlbum = telegramUpdate('message-group-album', { message: albumGroupMessage });
const telegramAnonymous = telegramUpdate('message-group-anonymous', { message: anonymousGroupMessage });
const telegramChannel = telegramUpdate('channel-post', { channel_post: telegramChannelMessage });
const telegramEditedMessage = telegramUpdate('edited-message', { edited_message: union(telegramDmMessage, telegramGroupMessage, telegramTopicMessage, telegramSupergroupMessage) });
const telegramEditedChannel = telegramUpdate('edited-channel-post', { edited_channel_post: telegramChannelMessage });
const telegramCallback = telegramUpdate('callback-query', { callback_query: object({
  id: text('callback-demo'), from: telegramUser,
  message: nullable(union(telegramDmMessage, telegramGroupMessage, telegramTopicMessage, telegramSupergroupMessage, telegramChannelMessage)),
  inline_message_id: sample(nullable(text('inline-message-demo')), null),
  data: nullable(text('opaque-callback-demo')), chat_instance: text('chat-instance-demo'),
}) });
const telegramOther = telegramUpdate('other-update', { updateType: text('chat_member') });
const telegramForms = [
  { label: 'Telegram direct message', value: telegramDm, id: 'dm' },
  { label: 'Telegram group message', value: telegramGroup, id: 'group' },
  { label: 'Telegram supergroup topic', value: telegramTopic, id: 'topic' },
  { label: 'Telegram supergroup without topic', value: telegramSupergroup, id: 'supergroup' },
  { label: 'Telegram attachment-only image', value: telegramImage, id: 'image' },
  { label: 'Telegram attachment-only voice', value: telegramVoice, id: 'voice' },
  { label: 'Telegram album member', value: telegramAlbum, id: 'album' },
  { label: 'Telegram anonymous group sender', value: telegramAnonymous, id: 'anonymous' },
  { label: 'Telegram channel post', value: telegramChannel, id: 'channel' },
  { label: 'Telegram edited message', value: telegramEditedMessage, id: 'edit' },
  { label: 'Telegram edited channel post', value: telegramEditedChannel, id: 'channel-edit' },
  { label: 'Telegram callback query', value: telegramCallback, id: 'callback' },
  { label: 'Other Telegram update', value: telegramOther, id: 'other' },
];

const approvalAnswer = object({ kind: fixed('prompt-answer'), promptId: text('prompt-001'), targetTurnId: text('turn-001'), answer: fixed('approve') });
function telegramRequest(scope: 'personal' | 'group', topic = false, callback = false, media: Payload | null = null, album = false, supergroup = false): Payload {
  const chatId = scope === 'personal' ? '123456' : topic || supergroup ? '-100987654' : '-100123456';
  return object({
    source: object({ channel: fixed('telegram'), accountId: text('account-demo'), eventId: text('101'), senderId: text('123456'), chatId: text(chatId), scope: fixed(scope), topicId: topic ? text('7') : sample(nullable(text('7')), null) }),
    content: callback ? object({ text: fixed(null), attachments: list(attachmentRef, []) }) : media ? object({ text: fixed(null), attachments: list(media, [media.example], 1) }) : content,
    destination: object({ channel: fixed('telegram'), accountId: text('account-demo'), chatId: text(chatId), topicId: topic ? text('7') : sample(nullable(text('7')), null), replyTo: text('42') }),
    selectedConversationId: fixed(null), requestedOperation: callback ? approvalAnswer : fixed(null),
    transportFacts: object({
      updateId: count(101), messageId: count(42), callbackId: callback ? text('callback-demo') : fixed(null),
      albumId: album ? text('album-demo') : sample(nullable(text('album-demo')), null),
      mentionsLina: flag(scope === 'group'), replyToLina: flag(false),
      sourceTimestamp: count(1791367200), originalUpdate: wireExtras,
      serverMappingId: callback ? text('callback-mapping-demo') : fixed(null),
    }),
  });
}

const noContent = object({ text: fixed(null), attachments: fixed([]) });
const cliControl = replaceField(replaceField(event('cli'), 'requestedOperation', stopOperation), 'content', noContent);
const cliFile = replaceField(replaceField(event('cli'), 'selectedConversationId', text('task-conversation-demo')), 'content', object({ text: text('Review this file.'), attachments: list(attachmentRef, [attachmentRef.example], 1) }));
const whatsappGroup = replaceField(event('whatsapp'), 'source', replaceField(replaceField(source, 'channel', fixed('whatsapp')), 'scope', fixed('group')));
const whatsappMedia = replaceField(event('whatsapp'), 'content', object({ text: fixed(null), attachments: list(attachmentRef, [attachmentRef.example], 1) }));
function cliStructured(action: Payload, originalText: string | null = null): Payload {
  return replaceField(replaceField(event('cli'), 'requestedOperation', action), 'content', object({ text: originalText === null ? fixed(null) : text(originalText), attachments: fixed([]) }));
}
const cliQueue = cliStructured(queueOperation, 'Answer this as a separate later task.');
const steerOperation = object({ kind: fixed('steer'), targetTurnId: text('turn-001'), guidance: text('Use the updated constraints.') });
const interruptOperation = object({ kind: fixed('interrupt'), targetTurnId: text('turn-001'), guidance: text('Replace the current task with this revised request.') });
const cliSteer = cliStructured(steerOperation);
const cliInterrupt = cliStructured(interruptOperation, 'Replace the current task with this revised request.');
const cliPrompt = cliStructured(promptOperation);
const cliStatus = cliStructured(replaceField(commandOperation, 'name', fixed('status')));
const cliReconnected = replaceField(event('cli'), 'transportFacts', object({
  connectionId: text('connection-demo-reconnected'), authenticationEvidenceRef: text('verified-reconnected-owner-demo'),
  transportProofRef: fixed(null), mentionsLina: flag(false), replyToLina: flag(false),
  albumId: fixed(null), messageId: text('message-001'), sourceTimestamp: nullable(text('2026-10-07T10:00:00Z')),
}));
const cliAdditionalForms = [
  { id: 'queue', label: 'CLI explicit Queue with task', value: cliQueue, when: 'An authenticated explicit Queue submits a preserved task to the conversation.' },
  { id: 'steer', label: 'CLI exact-turn Steer', value: cliSteer, when: 'Authenticated structured guidance targets one exact turn; permission and compatibility are checked later.' },
  { id: 'interrupt', label: 'CLI exact-turn Interrupt with replacement', value: cliInterrupt, when: 'An authenticated exact-turn cancellation/replacement request preserves its submitted replacement text.' },
  { id: 'prompt', label: 'CLI exact prompt answer', value: cliPrompt, when: 'An authenticated explicit answer identifies its exact pending prompt and owning turn.' },
  { id: 'status', label: 'CLI explicit status command', value: cliStatus, when: 'An authenticated status command requests observation rather than ordinary model work.' },
  { id: 'resubmission', label: 'CLI reconnect and resend same submission', value: cliReconnected, when: 'A newly authenticated connection resends the same original source event ID; dedupe returns existing status downstream.' },
];
const providerFacts: Payload = { schema: { type: 'object', additionalProperties: true, description: 'Integration-specific provider facts retained as provenance; field mapping is not selected.' }, example: {} };
const whatsappDeliveryStatus = object({
  form: fixed('delivery-status'), channel: fixed('whatsapp'), accountId: text('account-demo'),
  providerEventId: sample(nullable(text('provider-event-demo')), null),
  transportMessageId: text('outbound-message-demo'),
  mappingRef: sample(nullable(text('delivery-mapping-demo')), null),
  status: choice(['sent', 'delivered', 'read', 'failed']), observedAt: text('2026-10-07T10:00:02Z'),
  originalProviderFacts: providerFacts,
});
const whatsappDeliveryObservation = object({
  form: fixed('verified-delivery-status'), channel: fixed('whatsapp'), accountId: text('account-demo'),
  transportMessageId: text('outbound-message-demo'), mappingRef: text('delivery-mapping-demo'),
  outputId: text('output-001'), status: choice(['sent', 'delivered', 'read', 'failed']),
  observedAt: text('2026-10-07T10:00:02Z'), originalProviderFacts: providerFacts,
});
const whatsappOther = object({ form: fixed('unsupported-adapter-event'), channel: fixed('whatsapp'), accountId: text('account-demo'), providerEventType: text('integration-specific-event-demo'), originalProviderFacts: providerFacts });

function authorizedFor(action: Payload, originalText: string | null = null): Payload {
  const requestContent = originalText === null ? noContent : object({ text: text(originalText), attachments: fixed([]) });
  const requestEnvelope = replaceField(replaceField(envelope, 'requestedOperation', action), 'content', requestContent);
  return replaceField(replaceField(authorizedInput, 'record', replaceField(routed, 'envelope', requestEnvelope)), 'operation', action);
}

function stageFailure(stage: 'adapter' | 'identity' | 'claim' | 'envelope' | 'route' | 'permission' | 'claim-recovery', code: string): Payload {
  return replaceField(replaceField(replaceField(failure, 'stage', fixed(stage)), 'code', fixed(code)), 'certainty', fixed('known'));
}

function delivered(category: 'challenge' | 'refusal' | 'status', message: string): Payload {
  const result = replaceField(replaceField(outputRecord, 'category', fixed(category)), 'text', text(message));
  // Delivery records can be retained; this never declares the source input accepted.
  return category === 'status' ? result : replaceField(result, 'conversationId', fixed(null));
}

function untrustedAdapterFailure(code: string): Payload {
  return replaceField(replaceField(stageFailure('adapter', code), 'inputId', fixed(null)), 'destination', fixed(null));
}

export const inputAdmissionContracts: ContractDefinition[] = [
  {
    nodeId: 'lina-input-cli',
    external: [
      { label: 'CLI text submission', source: 'Authenticated CLI connection; local presence alone does not grant owner authority.', value: event('cli') },
      { label: 'CLI Stop control', source: 'Authenticated structured action targeting an exact turn.', value: cliControl },
      { label: 'CLI selected task with file', source: 'Authenticated terminal selection and authorized local-file reference.', value: cliFile },
      ...cliAdditionalForms.map(form => ({ label: form.label, source: 'Provisional authenticated CLI design contract; synthetic original submission facts, not an implemented terminal protocol.', value: form.value })),
    ],
    context: object({
      serviceEndpoint: text('local-service:demo'),
      authenticatedAccountId: text('account-demo'),
      authenticationEvidenceId: text('connection-auth-demo'),
      selectedConversationId: nullable(text('conversation-demo')),
      connectionId: text('cli-connection-demo'),
      attachmentResolver: text('cli-file-resolver-demo'),
    }),
    contextSource: 'CLI connection authentication and terminal selection; concrete authentication and reconnect protocol remain proposed.',
    reads: ['Authenticated account and connection evidence', 'Terminal conversation selection', 'Submitted text, files, source ID and explicit action'],
    writes: ['Transport envelope facts and retrieval references; no conversation history or turn ownership'],
    rules: [
      'Preserve a stable submission identity across retry; the missing-ID protocol remains open.',
      'On reconnect authenticate again but preserve the original source event ID for a resend; changing the connection ID does not create a new logical task.',
      'Forward explicit structured actions and selected conversation separately from content.',
      'Verify the connection with the service; user text cannot supply trusted authentication evidence.',
      'Resolve local attachment references through an authorized retrieval capability; do not claim acceptance.',
      'Connection/authentication failures stop without acceptance; never fabricate a safe reply destination.',
    ],
    outputs: [
      output('input-cli-submission', 'Authenticated submission facts', event('cli'), inputEdges(0), 'The connection is authenticated and the adapter has preserved the submission and origin.'),
      output('input-cli-control', 'Structured CLI Stop action', cliControl, inputEdges(0), 'An authenticated client supplies an explicit Stop target; content may be empty.'),
      output('input-cli-file', 'Selected task and file submission', cliFile, inputEdges(0), 'The authenticated terminal selects a task conversation and supplies a retrievable file.'),
      ...cliAdditionalForms.map(form => output(`input-cli-${form.id}`, form.label, form.value, inputEdges(0), form.when)),
      output('input-cli-failed', 'CLI authentication or intake failed', untrustedAdapterFailure('cli_intake_failed'), inputEdges(50), 'The connection or submission cannot be authenticated or safely preserved; no accepted input exists.'),
    ],
  },
  {
    nodeId: 'lina-input-whatsapp',
    external: [
      { label: 'WhatsApp direct message', source: 'Selected integration facts; wire authentication precedes trusted projection.', value: event('whatsapp') },
      { label: 'WhatsApp group message', source: 'Adapter preserves group sender, mention/reply and original chat; support depends on selected integration.', value: whatsappGroup },
      { label: 'WhatsApp attachment-only message', source: 'Adapter supplies media retrieval references; these are not durable custody.', value: whatsappMedia },
      { label: 'WhatsApp delivery-status observation', source: 'Provisional integration-neutral projection of a provider receipt; integration and provider-field mapping are still open.', value: whatsappDeliveryStatus },
      { label: 'WhatsApp unsupported provider event', source: 'Selected integration may emit non-message events; this synthetic tagged projection does not assert a particular wire API.', value: whatsappOther },
    ],
    context: object({
      adapterAccountId: text('account-demo'), integration: text('whatsapp-integration-not-selected'),
      credentialHandle: text('credential-handle-demo'), authenticityVerifier: text('transport-verifier-demo'),
      attachmentRetriever: text('whatsapp-media-retriever-demo'),
      acknowledgementPolicy: choice(['pending-design', 'durable-handoff-required']),
      deliveryMappings: list(object({ accountId: text('account-demo'), transportMessageId: text('outbound-message-demo'), mappingRef: text('delivery-mapping-demo'), outputId: text('output-001') })),
      providerFieldMapping: fixed('integration-selection-pending'),
    }),
    contextSource: 'Adapter configuration and credential provider; integration selection, capability coverage and transport acknowledgement timing remain open.',
    reads: ['Transport account, sender/chat IDs and event identity', 'Text, ordered media references, captions, reply and mention facts', 'Persisted account-scoped outbound delivery correlation for provider receipts'],
    writes: ['Verified transport facts and adapter-scoped retrieval references', 'Correlated delivery observation for the saved output; unsupported events remain outside agent intake'],
    rules: [
      'Do not infer authenticated transport identity from arbitrary payload metadata.',
      'Preserve source event identity and source account scope; same text does not establish duplication.',
      'Media retrieval uses channel credentials; retrieval references are not evidence of durable custody.',
      'Transport acknowledgement and Lina acceptance are separate; never discard unowned input on an early acknowledgement.',
      'Wire verification failures stop without execution or acceptance; untrusted origins cannot authorize failure delivery.',
      'A provider delivery-status event is not a user message: never route it into identity, input claim, ordinary batching or a model turn.',
      'Only correlate a verified provider receipt through the saved account-scoped outbound mapping; arbitrary provider data cannot choose a Lina output ID.',
      'Delivery observation updates belong to the delivery lifecycle; retries use the saved output and never rerun the agent.',
      'Withhold unsupported or uncorrelated provider events locally; integration selection and exact provider event/status mapping remain open.',
    ],
    outputs: [
      output('input-whatsapp-event', 'Verified WhatsApp facts', event('whatsapp'), inputEdges(1), 'Transport verification succeeds and normalization preserves original identity/content and destination.'),
      output('input-whatsapp-group', 'Verified group facts', whatsappGroup, inputEdges(1), 'The selected integration supports groups and verifies group sender/chat facts.'),
      output('input-whatsapp-media', 'Verified attachment-only facts', whatsappMedia, inputEdges(1), 'Verified transport carries supported attachment references without text.'),
      output('input-whatsapp-delivery-observation', 'Verified correlated output delivery observation', whatsappDeliveryObservation, inputEdges(57), 'Transport authenticity and a saved account/message mapping establish which existing output the provider receipt describes.'),
      output('input-whatsapp-event-withheld', 'Unsupported event withheld from agent intake', object({ channel: fixed('whatsapp'), accountId: text('account-demo'), disposition: fixed('withheld'), reason: choice(['unsupported-provider-event', 'uncorrelated-delivery-status', 'provider-mapping-pending']), acceptedInputCreated: fixed(false), agentTurnCreated: fixed(false) }), [], 'The provider event has no supported message interpretation or trusted saved-output mapping; handling terminates locally.'),
      output('input-whatsapp-failed', 'WhatsApp transport verification failed', untrustedAdapterFailure('whatsapp_intake_failed'), inputEdges(51), 'Transport authenticity or required adapter facts cannot be established.'),
    ],
  },
  {
    nodeId: 'lina-input-telegram',
    external: telegramForms.map(form => ({ label: form.label, source: 'Telegram Bot API update, projected into a tagged design event after transport verification; originalUpdate retains wire provenance. https://core.telegram.org/bots/api', value: form.value })),
    context: object({
      botAccountId: text('account-demo'), transport: choice(['polling', 'webhook']),
      credentialHandle: text('telegram-credential-demo'), verifier: text('telegram-verifier-demo'),
      attachmentRetriever: text('telegram-media-demo'),
      offlineBacklogPolicy: choice(['pending-design', 'durable-handoff-required']),
    }),
    contextSource: 'Telegram adapter configuration and verified transport; offset/webhook acknowledgement and offline backlog policy remain open.',
    reads: ['Bot/update/message IDs, sender and chat/topic', 'Text, media/album IDs, captions and reply/mention facts'],
    writes: ['Tagged verified update facts; routing and envelope construction occur in Telegram event router'],
    rules: [
      'Retain update identity separately from message/reply identity; edits and missing IDs need explicit adapter rules.',
      'Preserve album membership from the transport; timing alone cannot establish album membership.',
      'The draft shared source record does not yet model every Telegram metadata field; original wire facts must remain available by provenance.',
      'Do not advance an offset or confirm a delivery in a way that abandons input before an explicit durable owner exists.',
      'Transport failure routes to a safe failure outcome and must not produce Lina acceptance.',
    ],
    outputs: [
      ...telegramForms.map(form => output(`input-telegram-raw-${form.id}`, form.label, form.value, inputEdges(2), `Transport verification succeeds and the update is classified as ${form.label}; no person or envelope is fabricated.`)),
      output('input-telegram-failed', 'Telegram transport verification failed', untrustedAdapterFailure('telegram_intake_failed'), inputEdges(52), 'Transport authenticity or required bot/update facts cannot be established.'),
    ],
  },
  {
    nodeId: 'lina-input-telegram-route',
    context: object({
      botAccountId: text('account-demo'), botUserId: count(999001), now: text('2026-10-07T10:00:00Z'),
      channelPostPolicy: fixed('pending-design'), editPolicy: fixed('pending-design'),
      callbackMappings: list(object({ mappingId: text('callback-mapping-demo'), opaqueData: text('opaque-callback-demo'), promptId: text('prompt-001'), turnId: text('turn-001'), operation: approvalAnswer, actorUserId: count(123456), destination: object({ chatId: text('123456'), topicId: fixed(null), replyTo: text('42') }), expiresAt: text('2026-10-07T10:10:00Z') })),
      ordinaryMessagePolicy: fixed('person-principal-required'),
    }),
    contextSource: 'Verified bot configuration and server-owned expiring callback mappings. Telegram Update/Message/CallbackQuery fields: https://core.telegram.org/bots/api. Channel-post and edit handling remain open design policies.',
    reads: ['Tagged update form, update ID and original wire provenance', 'User principal versus sender_chat identity', 'Chat/topic/reply/album facts', 'Trusted callback mappings, expiry and exact prompt/turn/actor target'],
    writes: ['Normalized request only for supported person-authored messages or trusted mapped controls', 'Explicit deferred/refused outcome for unsupported or policy-open event forms'],
    rules: [
      'Telegram private messages, group messages and supergroup topics preserve their distinct scopes and topic IDs.',
      'Use update_id as source event identity; message_id is a separate reply/edit anchor.',
      'sender_chat and author signatures do not establish a Lina person. Anonymous group sends and channel posts cannot fabricate a user principal.',
      'Channel posts and edits stop under pending policies; never reinterpret them as new ordinary model turns.',
      'Callback data is opaque. Resolve only a live trusted server mapping with matching actor/prompt/turn and applicable permissions; do not parse arbitrary data as approval.',
      'Callback message can be absent for inline callbacks. Use a verified mapping destination or refuse; do not fabricate chat or reply IDs.',
      'A known structured callback action may have empty content; current authorization is checked downstream.',
      'Preserve originalUpdate, album identity, mention/reply facts and source timestamp independently of prepared content.',
      'Unsupported updates and unavailable identity/destination produce a local safe failure without acceptance or an unauthorized reply.',
    ],
    outputs: [
      output('input-telegram-route-dm', 'Telegram DM request', telegramRequest('personal'), inputEdges(55), 'An ordinary private message has a real sender user and supported content.'),
      output('input-telegram-route-group', 'Telegram group request', telegramRequest('group'), inputEdges(55), 'An ordinary group message has a person sender; activation remains a later authorized gate.'),
      output('input-telegram-route-topic', 'Telegram topic request', telegramRequest('group', true), inputEdges(55), 'An ordinary supergroup topic message has a person sender; its thread ID is preserved.'),
      output('input-telegram-route-supergroup', 'Telegram supergroup without topic', telegramRequest('group', false, false, null, false, true), inputEdges(55), 'A person-authored supergroup message has no topic ID; do not fabricate one.'),
      output('input-telegram-route-image', 'Attachment-only image request', telegramRequest('personal', false, false, imageAttachment), inputEdges(55), 'A person-authored DM supplies an image reference without text; custody is checked later.'),
      output('input-telegram-route-voice', 'Attachment-only voice request', telegramRequest('personal', false, false, voiceAttachment), inputEdges(55), 'A person-authored DM supplies a voice/audio reference without text; no transcript is fabricated.'),
      output('input-telegram-route-album', 'Album member request', telegramRequest('group', false, false, imageAttachment, true), inputEdges(55), 'A person-authored album member preserves media-group identity and each source update; timing does not define album membership.'),
      output('input-telegram-route-callback', 'Trusted mapped prompt answer', telegramRequest('personal', false, true), inputEdges(55), 'An unexpired server callback mapping establishes an exact prompt/turn/actor/action and accessible destination.'),
      output('input-telegram-route-channel-deferred', 'Channel-post policy unresolved', untrustedAdapterFailure('telegram_channel_policy_pending'), inputEdges(56), 'A channel post lacks a person principal and the channel-post policy has not been selected.'),
      output('input-telegram-route-edit-deferred', 'Edit policy unresolved', untrustedAdapterFailure('telegram_edit_policy_pending'), inputEdges(56), 'An edited message or edited channel post arrives while edit handling is undefined.'),
      output('input-telegram-route-refused', 'Unsupported or unmapped update', untrustedAdapterFailure('telegram_event_not_admissible'), inputEdges(56), 'The update is unsupported, anonymous, missing a safe destination, or has an unmapped/expired/mismatched callback.'),
      output('input-telegram-route-anonymous', 'Anonymous group principal unavailable', untrustedAdapterFailure('telegram_person_principal_missing'), inputEdges(56), 'A group update has sender_chat but no sender user; the design cannot authorize it as a person.'),
    ],
  },
  {
    nodeId: 'lina-input-envelope',
    context: object({ schemaRevision: count(1), inputIdAllocator: text('input-id-allocator-demo'), clock: text('receipt-clock-demo'), sourceIdPolicy: choice(['pending-design', 'require-source-identity']) }),
    contextSource: 'Service schema, ID allocator and receipt clock; exact channel-required fields remain provisional.',
    reads: ['Preserved adapter facts, source scope and original content', 'Channel-required fields and source identity policy'],
    writes: ['Internal input ID, receipt timestamp and validated original envelope'],
    rules: [
      'Accept attachment-only messages and explicit structured actions; ordinary messages require usable text or at least one attachment reference.',
      'Preserve original content and origin separately from model preparation.',
      'Carry trusted adapter evidence, explicit actions and requested conversation independently of text.',
      'A malformed input must not continue to identity or execution; safe failure destinations require verified transport origin.',
      'Missing source IDs and edits remain design decisions; do not invent text-based duplicate keys.',
    ],
    outputs: [
      output('input-envelope-valid', 'Validated envelope', normalized, inputEdges(3), 'Required channel fields and content structure are valid.'),
      output('input-envelope-invalid', 'Malformed envelope', stageFailure('envelope', 'invalid_envelope'), inputEdges(32), 'Required structure is invalid; no acceptance or agent work is created.'),
    ],
  },
  {
    nodeId: 'lina-input-identity',
    context: identifiedContext,
    contextSource: 'Owner-managed verified identity-link registry and CLI account authentication records; no authority is derived from text or display names.',
    reads: ['Envelope sender/account scope', 'Verified CLI authentication evidence', 'Active verified identity links and their revision'],
    writes: ['Resolved person/link provenance, or an explicitly unresolved identity'],
    rules: [
      'An unknown messaging sender proceeds as unresolved to access/pairing; unknown is not an authorization grant.',
      'Use only verified active links; preserve which link established person identity.',
      'Identity linking never merges existing histories implicitly.',
      'Registry/authentication dependency failure must fail closed; it is not an unresolved-person authorization grant.',
    ],
    outputs: [
      output('input-identity-evidence', 'Verified identity evidence', replaceField(identified, 'identity', resolvedIdentity), inputEdges(4), 'Resolution yields a verified authenticated account or active person link.'),
      output('input-identity-unresolved', 'Unknown sender evidence', unresolvedInput, inputEdges(4), 'The registry is available but no verified identity link resolves this sender.'),
      output('input-identity-failed', 'Identity evidence unavailable', stageFailure('identity', 'identity_resolution_failed'), inputEdges(53), 'Authentication or registry dependencies cannot establish a reliable identity outcome.'),
    ],
  },
  {
    nodeId: 'lina-input-access',
    context: chatGrants,
    contextSource: 'Current owner/chat/group authorization records; operation permissions are checked later and independently.',
    reads: ['Resolved/unresolved identity and ingress evidence', 'DM approvals, group approval and permitted group senders', 'Current grant revocations'],
    writes: ['Admission decision with policy/grant provenance; no execution permission'],
    rules: [
      'Unknown DMs require pairing or explicit allowlisting before execution.',
      'Approve the group and its permitted senders separately; DM approval alone does not admit group requests.',
      'Owner CLI admission requires authenticated owner evidence, not merely a local connection.',
      'Revocation rejects subsequent requests; handling running work remains an explicit separate policy.',
    ],
    outputs: [
      output('input-access-refused', 'Unknown DM requires pairing', object({ input: unresolvedInput, reason: fixed('unknown-dm') }), inputEdges(5), 'An unknown direct-message sender has no current approval.'),
      output('input-access-group-refused', 'Group sender refused', object({ input: replaceField(unresolvedInput, 'envelope', replaceField(envelope, 'source', replaceField(replaceField(source, 'scope', fixed('group')), 'senderId', text('sender-unknown-demo')))), reason: fixed('sender-not-approved') }), inputEdges(5), 'The group or sender lacks a distinct group approval; DM approval is insufficient.'),
      output('input-access-policy-refused', 'Current source access refused', object({ input: identified, reason: choice(['revoked', 'group-not-approved', 'cli-not-owner']) }), inputEdges(5), 'A revocation, group policy or owner-only CLI rule refuses current access.'),
      output('input-access-admitted', 'Source admitted', permitted, inputEdges(6), 'Current authenticated owner or explicit DM/group grants admit this source.'),
    ],
  },
  {
    nodeId: 'lina-input-pairing',
    context: object({
      ownerPersonId: text('person-demo'),
      pendingChallenges: list(object({ challengeId: text('pairing-demo'), senderId: text('sender-demo'), accountId: text('account-demo'), expiresAt: text('2026-10-07T10:10:00Z') }), []),
      challengeIssuer: text('pairing-issuer-demo'), challengeExpirySeconds: count(600),
      maxAttempts: count(3), refusalPolicy: choice(['visible-refusal', 'pending-design']),
    }),
    contextSource: 'Pairing registry and authenticated owner approval interface; synthetic expiry/limits illustrate fields, not agreed policy values.',
    reads: ['Unadmitted source identity and scope', 'Existing pending challenges and current approval policy'],
    writes: ['Pending owner approval challenge and attempt state when the selected policy permits'],
    rules: [
      'Issue pairing only for eligible unknown DMs; disallowed group traffic never starts an agent turn.',
      'Only authenticated owner approval can create a chat grant; this challenge alone grants nothing.',
      'Chat approval and identity-link management are separate permissions.',
      'Do not automatically replay the refused message after pairing without an explicit retry/retention design.',
      'Challenge failure, expiry, limits and whether refusal is silent remain open policies.',
    ],
    outputs: [
      output('input-pairing-challenge', 'Pending owner approval', delivered('challenge', 'Pairing is pending owner approval.'), inputEdges(27), 'An eligible unknown DM can receive a challenge and its pending record has been created.'),
      output('input-pairing-refusal', 'Safe access refusal', delivered('refusal', 'This source is not approved to use Lina.'), inputEdges(27), 'Pairing is unavailable or access is refused; no private status is disclosed.'),
    ],
  },
  {
    nodeId: 'lina-input-activation',
    context: object({ activationPolicyRevision: count(1), channelRules: list(object({ channel: choice(['whatsapp', 'telegram']), requireMentionOrReply: fixed(true), botIdentityId: text('bot-demo') })) }),
    contextSource: 'Channel-specific verified mention/reply rules; exact reply activation policy remains open.',
    reads: ['Admitted scope', 'Verified mention and reply facts'],
    writes: ['Activated or ignored branch outcome'],
    rules: ['CLI and admitted DMs proceed.', 'Group activation requires a verified mention or reply under the selected channel rule.', 'Unaddressed group input ends without ordinary acceptance, execution or a reply.'],
    outputs: [
      output('input-activation-pass', 'Activated input', permitted, inputEdges(30), 'The input is CLI/DM or an admitted group input addressing Lina.'),
      output('input-activation-ignore', 'Unaddressed group', object({ input: sample(permitted, {
        ...(permitted.example as Record<string, Json>), envelope: {
          ...(envelope.example as Record<string, Json>), addressed: false,
          source: { ...(source.example as Record<string, Json>), scope: 'group' },
        },
      }), reason: fixed('unaddressed-group') }), inputEdges(31), 'Admitted group input does not address Lina.'),
    ],
  },
  {
    nodeId: 'lina-input-ignored',
    context: object({ retentionPolicy: choice(['pending-design', 'metadata-only']), transportAckOwner: text('channel-adapter-demo') }),
    contextSource: 'Proposed ignored-input retention and adapter acknowledgement policy; this is not the accepted-input inbox.',
    reads: ['Unaddressed admitted group outcome', 'Retention and transport acknowledgement policy'],
    writes: ['Optional bounded ignored metadata; no accepted input or turn'],
    rules: ['Terminal branch: do not create ordinary acceptance, execution or reply.', 'A transport acknowledgement does not assert Lina accepted responsibility.', 'Retention is still proposed; do not silently store private content indefinitely.'],
    outputs: [output('input-ignored-terminal', 'Ignored without acceptance', object({ inputId: text('input-001'), disposition: fixed('ignored'), accepted: fixed(false), replyCreated: fixed(false) }), [], 'The input is an admitted unaddressed group event; handling terminates locally.')],
  },
  {
    nodeId: 'lina-input-conversation',
    context: object({
      personConversations: list(object({ personId: text('person-demo'), conversationId: text('conversation-demo') })),
      groupConversations: list(object({ accountId: text('account-demo'), chatId: text('chat-demo'), topicId: nullable(text('topic-demo')), conversationId: text('group-conversation-demo') })),
      authorizedSelections: list(object({ personId: text('person-demo'), conversationId: text('conversation-demo'), permitted: flag(true) })),
      historySelectionRevision: count(1),
    }),
    contextSource: 'Durable person/group/topic routing registry and history-access policy; conversation creation/selection mechanics remain provisional.',
    reads: ['Verified person/link provenance and source scope', 'Optional authenticated CLI selection', 'Existing history ownership and selected future conversation after linking'],
    writes: ['Authorized conversation ID and retained originating reply destination'],
    rules: [
      'Linked personal DMs route to the selected personal conversation; other people retain separate private histories.',
      'Group/topic routing stays separate from private history.',
      'Check access to explicit selection; never infer authorization from a conversation ID supplied in content.',
      'Linking preserves existing histories; route changes do not retroactively rewrite prior input ownership.',
      'Sharing history does not broadcast answers to linked channels; preserve the request origin.',
    ],
    outputs: [
      output('input-conversation-routed', 'Authorized conversation', routedInput, inputEdges(7), 'The source has a valid accessible conversation under the current routing registry.'),
      output('input-conversation-refused', 'Conversation selection refused', stageFailure('route', 'conversation_not_authorized'), inputEdges(33), 'Selection is invalid, inaccessible, or cannot be safely resolved.'),
    ],
  },
  {
    nodeId: 'lina-input-claim',
    context: object({ store: text('input-receipt-store-demo'), uniquenessScope: fixed('channel/account/transport-scope/source-event'), receiptRetentionPolicy: choice(['pending-design', 'channel-aware']), matchingReceipts: list(receipt, []), claimOwnerId: text('ingress-worker-demo'), nextFence: count(1) }),
    contextSource: 'Persistent input identity store and preparation-owner registry; transactions, fencing and retention are provisional.',
    reads: ['Authorized route and exact source identity', 'Existing receipt and original conversation', 'Current preparation ownership and persisted state'],
    writes: ['Atomic source claim and preparation ownership before creating new work'],
    rules: [
      'Claim identity atomically; a read-then-create race is insufficient.',
      'Retain source provenance and the original route; duplicate text is not a duplicate event.',
      'Known accepted/terminal/live receipts return status rather than admitting another turn.',
      'Incomplete or retryable receipts require safe preaccept recovery before new preparation.',
      'Known claim persistence failure stops without acceptance; unknown commits require persisted-status inspection and safe reclaim, never a fresh duplicate turn.',
    ],
    outputs: [
      output('input-claim-existing', 'Existing input receipt', existingInput, inputEdges(8), 'The source identity already has a live, accepted or terminal receipt.'),
      output('input-claim-new', 'New preparation claim', claimedInput, inputEdges(9), 'Atomic uniqueness succeeds and a new preparation owner is recorded.'),
      output('input-claim-incomplete', 'Incomplete receipt inspection', existingInput, inputEdges(37), 'A matching incomplete/retryable receipt requires ownership and custody inspection.'),
      output('input-claim-failed', 'Claim persistence failed', stageFailure('claim', 'claim_persistence_failed'), inputEdges(54), 'Persistence is known to have failed; no new acceptance is promised.'),
      output('input-claim-uncertain', 'Claim outcome requires inspection', replaceField(stageFailure('claim', 'claim_commit_unknown'), 'certainty', fixed('unknown')), inputEdges(54), 'Commit outcome cannot be established; preserve uncertainty and inspect status before any fresh claim.'),
    ],
  },
  {
    nodeId: 'lina-input-duplicate',
    context: object({ originalConversationAccess: object({ requesterPersonId: text('person-demo'), originalConversationId: text('conversation-demo'), authorized: flag(true), policyRevision: count(1) }), statusReader: text('receipt-status-reader-demo'), disclosurePolicy: fixed('authorize-original-conversation') }),
    contextSource: 'Current authorization against the stored original conversation and receipt status; a newly resolved route cannot authorize old private history.',
    reads: ['Existing source receipt and its original conversation', 'Current requester authorization for that original history', 'Recorded receipt/execution/delivery status'],
    writes: ['Status/refusal response only; no new ordinary execution admission'],
    rules: [
      'Check access to the stored original conversation before returning status.',
      'A current route change or identity unlink does not rewrite the original input.',
      'A lost acceptance acknowledgement returns recorded status for the same identity.',
      'A denied status lookup must not reveal original history, contents or progress.',
      'The graph has one delivery edge; safe lookup refusal uses that handoff without asserting any acceptance.',
    ],
    outputs: [
      output('input-duplicate-status', 'Authorized existing status', delivered('status', 'The original input is already recorded; no additional turn was created.'), inputEdges(28), 'Current permission permits status access to the stored original conversation.'),
      output('input-duplicate-refusal', 'Status access refused', delivered('refusal', 'The requested status is not available to this identity.'), inputEdges(28), 'Authorization to the original conversation fails; only a safe refusal is delivered.'),
    ],
  },
  {
    nodeId: 'lina-input-claim-recovery',
    context: object({
      originalConversationAccess: flag(true),
      previousOwner: object({ ownerId: text('previous-ingress-worker-demo'), state: choice(['released', 'active', 'unknown']), fence: count(1), evidenceRef: text('ownership-evidence-demo') }),
      custodyOutcome: choice(['none', 'known-safe', 'unknown']), commitOutcome: choice(['not-accepted', 'accepted', 'unknown']),
      freshOwnerId: text('ingress-worker-demo'), freshFence: count(2),
      reclaimPolicy: choice(['pending-design', 'known-safe-only']),
    }),
    contextSource: 'Original receipt ownership, custody evidence and durable commit inspection; elapsed time alone is not proof of safe reclaim.',
    reads: ['Original receipt and conversation authorization', 'Previous owner release/fence evidence', 'Known custody and acceptance outcomes'],
    writes: ['Fresh fenced preparation claim only after safe prior-owner release; otherwise preserved status or uncertainty'],
    rules: [
      'Recheck current access to the stored original conversation.',
      'An accepted input never becomes a fresh source event.',
      'A live preparation owner retains its claim; duplicates return existing status.',
      'Unknown owner, custody or commit outcomes prevent blind reclaim.',
      'A safe reclaim preserves original input identity and route while replacing preparation ownership.',
    ],
    outputs: [
      output('input-claim-recovered', 'Safe renewed preparation claim', sample(claimedInput, { ...(claimedInput.example as Record<string, Json>), claim: { ...(claim.example as Record<string, Json>), fence: 2 } }), inputEdges(38), 'Original-history access is valid, prior ownership is released, effects are known safe and acceptance has not committed.'),
      output('input-claim-recovery-existing', 'Existing receipt retained', existingInput, inputEdges(39), 'A live owner, accepted input or terminal receipt requires existing status instead of fresh admission.'),
      output('input-claim-recovery-unsafe', 'Reclaim blocked', stageFailure('claim-recovery', 'reclaim_not_safe'), inputEdges(40), 'Current access is denied or owner/custody/commit evidence does not establish safe reclaim.'),
    ],
  },
  {
    nodeId: 'lina-input-intent',
    context: object({
      permissionRevision: count(1),
      actorPermissions: list(choice(['chat', 'queue', 'steer', 'interrupt', 'stop', 'approve', 'configure']), ['chat', 'queue', 'steer', 'interrupt', 'stop']),
      activeTurnId: nullable(text('turn-001')),
      pendingPrompts: list(object({ promptId: text('prompt-001'), turnId: text('turn-001'), kind: choice(['approval', 'clarification']), authorizedResponders: list(text('person-demo')) }), []),
      executionAuthorityCompatible: flag(true), commandPolicyRevision: count(1),
    }),
    contextSource: 'Service operation permissions, live turn/prompt registry and explicit command/action parser; exact grants and steering compatibility remain proposed.',
    reads: ['Claimed original input, verified actor and structured action', 'Current operation grants and exact turn/prompt targets', 'Ordered attachment references and required-custody policy'],
    writes: ['Authorized operation with preserved record/claim identity and actor/permission-revision/time provenance, or visible refusal'],
    rules: [
      'Chat admission does not imply administrative or execution-control authority.',
      'Check structured controls and explicit command syntax; arbitrary transport metadata cannot grant permission.',
      'Explicit approval/denial must identify the pending approval; plain yes/no cannot grant tool approval.',
      'Plain clarification text can resolve a question only when the target is unambiguous.',
      'Steer/Interrupt/Stop target an exact active turn; stale requests cannot affect a newer turn.',
      'Control and prompt answers retain bypass intent but still require acceptance and authorization.',
      'Preserve original content; classification does not overwrite it or acquire attachment custody.',
    ],
    outputs: [
      output('input-intent-denied', 'Operation refused', stageFailure('permission', 'operation_not_authorized'), inputEdges(10), 'Operation, target or authority is invalid or denied.'),
      output('input-intent-custody', 'Authorized input requiring originals', replaceField(authorizedInput, 'record', attachmentRouted), inputEdges(11), 'The authorized operation requires original attachments to be acquired before acceptance.'),
      output('input-intent-no-custody', 'Authorized ordinary text', replaceField(replaceField(authorizedInput, 'operation', ordinaryOperation), 'record', replaceField(routed, 'envelope', replaceField(envelope, 'content', object({ text: text('What is 2 + 2?'), attachments: fixed([]) })))), inputEdges(12), 'An authorized ordinary text input requires no attachment custody.'),
      output('input-intent-queue', 'Authorized explicit Queue', authorizedFor(queueOperation, 'Answer this as a separate later task.'), inputEdges(12), 'An explicitly authorized Queue action preserves the submitted task and targets the conversation.'),
      output('input-intent-steer', 'Authorized exact-turn Steer', authorizedFor(steerOperation), inputEdges(12), 'An explicitly authorized compatible Steer retains guidance and the exact active-turn target.'),
      output('input-intent-interrupt', 'Authorized exact-turn Interrupt', authorizedFor(interruptOperation, 'Replace the current task with this revised request.'), inputEdges(12), 'An explicitly authorized Interrupt preserves the replacement task and exact active-turn target.'),
      output('input-intent-stop', 'Authorized exact-turn Stop', authorizedFor(stopOperation), inputEdges(12), 'An explicitly authorized Stop targets an exact active turn and requires no attachment custody.'),
      output('input-intent-prompt-answer', 'Authorized prompt answer', authorizedFor(promptOperation), inputEdges(12), 'An explicit valid prompt answer retains exact prompt and owning-turn targets.'),
      output('input-intent-command', 'Authorized command', authorizedFor(commandOperation), inputEdges(12), 'A recognized command passes its specific permission and busy-policy checks.'),
    ],
  },
];
