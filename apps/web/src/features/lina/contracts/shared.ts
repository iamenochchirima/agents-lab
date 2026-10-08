import { choice, count, fixed, flag, list, nullable, object, sample, text, union, replaceField, type Payload, type Json } from './schema';

// Deliberately small records reused at actual handoffs. Examples use synthetic IDs.
export const jsonValue = (example: Json): Payload => ({ schema: {}, example });
export const argumentObject: Payload = { schema: { type: 'object' as const, additionalProperties: true, description: 'Validated against the selected tool registry schema before launch.' }, example: { expression: '2 + 2' } };
export const channel = choice(['cli', 'whatsapp', 'telegram']);
export const destination = object({ channel, accountId: text('account-demo'), chatId: text('chat-demo'), topicId: sample(nullable(text('topic-demo')), null), replyTo: nullable(text('message-001')) });
export const source = object({ channel, accountId: text('account-demo'), eventId: text('message-001'), senderId: text('sender-demo'), chatId: text('chat-demo'), scope: choice(['personal', 'group']), topicId: sample(nullable(text('topic-demo')), null) });
export const attachmentRef = object({ attachmentId: text('attachment-001'), order: count(0), mediaType: choice(['image', 'audio', 'pdf', 'text', 'code']), retrievalRef: text('adapter-media:demo-001'), caption: nullable(text('Example attachment')) });
export const content = object({ text: nullable(text('What is 2 + 2?')), attachments: list(attachmentRef, []) });
export const ordinaryOperation = object({ kind: fixed('ordinary') });
export const queueOperation = object({ kind: fixed('queue') });
export const stopOperation = object({ kind: fixed('stop'), targetTurnId: text('turn-001'), guidance: sample(nullable(text('Use the updated constraints')), null) });
export const promptOperation = object({ kind: fixed('prompt-answer'), promptId: text('prompt-001'), targetTurnId: text('turn-001'), answer: text('approve') });
/** Explicit operation review is typed separately from arbitrary clarification text.
 * Input acceptance/correlation never grants execution authority by itself. */
export const permissionApprovalChoices = ['allow-once', 'allow-session', 'allow-always', 'deny'];
export const approvalOperation = object({ kind: fixed('prompt-answer'), answerKind: fixed('operation-approval'), promptId: text('prompt-001'), targetTurnId: text('turn-001'), operationId: text('call-001'), waitId: text('wait:approval:call-001'), waitRevision: count(1), answer: choice(permissionApprovalChoices), reviewedScopeDigest: text('sha256:fixture-reviewed-scope') });
export const commandOperation = object({ kind: fixed('command'), name: choice(['status', 'reset', 'configure']), arguments: list(text('demo'), []) });
export const operation = union(
  object({ kind: fixed('ordinary') }),
  object({ kind: fixed('queue') }),
  object({ kind: choice(['steer', 'interrupt', 'stop']), targetTurnId: text('turn-001'), guidance: nullable(text('Use the updated constraints')) }),
  object({ kind: fixed('prompt-answer'), promptId: text('prompt-001'), targetTurnId: text('turn-001'), answer: text('approve') }),
  object({ kind: fixed('command'), name: choice(['status', 'reset', 'configure']), arguments: list(text('demo'), []) }),
  approvalOperation,
);
const envelopeRecord = object({ inputId: text('input-001'), receivedAt: text('2026-10-07T10:00:00Z'), source, content, destination, addressed: flag(true), selectedConversationId: sample(nullable(text('conversation-demo')), null), requestedOperation: sample(nullable(operation), null), transportFacts: { schema: { type: 'object', additionalProperties: true, description: 'Original adapter facts retained for provenance; never grant permission by themselves.' }, example: { connectionId: 'connection-demo' } } });
// A structured operation is valid without message text; ordinary input needs
// usable text or an original attachment reference. Keep this condition on the
// envelope rather than forcing empty controls to invent message content.
export const envelope: Payload = { ...envelopeRecord, schema: { ...envelopeRecord.schema, anyOf: [
  { type: 'object' as const, properties: { content: { type: 'object' as const, properties: { text: { type: 'string' as const, minLength: 1 } }, required: ['text'] } }, required: ['content'] },
  { type: 'object' as const, properties: { content: { type: 'object' as const, properties: { attachments: { type: 'array' as const, minItems: 1 } }, required: ['attachments'] } }, required: ['content'] },
  { type: 'object' as const, properties: { requestedOperation: { type: 'object', properties: { kind: { type: 'string', enum: ['queue', 'steer', 'interrupt', 'stop', 'prompt-answer', 'command'] } }, required: ['kind'] } }, required: ['requestedOperation'] },
] } };
export const person = object({ personId: text('person-demo'), linkId: sample(nullable(text('link-demo')), null), verification: choice(['authenticated-account', 'verified-link']) });
export const identity = union(object({ outcome: fixed('resolved'), person }), object({ outcome: fixed('unresolved'), senderId: text('sender-demo') }));
export const authorization = object({ actorId: text('person-demo'), sourceGrantId: text('chat-grant-demo'), routeGrantId: text('route-grant-demo'), policyRevision: count(1), checkedAt: text('2026-10-07T10:00:00Z') });
export const routed = object({ envelope, identity, conversationId: text('conversation-demo'), authorization });
export const claim = object({ claimId: text('claim-001'), inputId: text('input-001'), sourceKey: text('cli:account-demo:chat-demo:message-001'), ownerId: text('ingress-worker-demo'), fence: count(1) });
export const authority = object({ ownerId: text('execution-worker-demo'), fence: count(2), permissions: list(choice(['model', 'tools', 'steer', 'stop']), ['model', 'tools', 'steer', 'stop'], 1) });
export const custody = object({ attachmentId: text('attachment-001'), originalRef: text('original:attachment-001'), sha256: text('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), bytes: count(128), order: count(0) });
export const operationAuthorization = object({ actorId: text('person-demo'), permissionRevision: count(1), checkedAt: text('2026-10-07T10:00:01Z') });
export const accepted = object({ record: routed, claim, operation, operationAuthorization, originals: list(custody, []), acceptedAt: text('2026-10-07T10:00:01Z') });
export const work = object({ conversationId: text('conversation-demo'), inputs: list(accepted, [accepted.example], 1), busyPolicy: choice(['queue', 'steer', 'interrupt']) });
export const turn = object({ turnId: text('turn-001'), conversationId: text('conversation-demo'), authority, inputIds: list(text('input-001'), ['input-001'], 1) });
export const admitted = object({ turn, work });
export const failure = object({ stage: choice(['adapter', 'identity', 'claim', 'envelope', 'route', 'permission', 'custody', 'acceptance', 'claim-recovery']), code: text('invalid_input'), certainty: choice(['known', 'unknown']), inputId: nullable(text('input-001')), destination: nullable(destination), safeMessage: text('This request could not be accepted.') });
export const outputRecord = object({ outputId: text('output-001'), inputId: text('input-001'), conversationId: nullable(text('conversation-demo')), destination, category: choice(['receipt', 'answer', 'status', 'refusal', 'challenge', 'command', 'control']), text: text('4'), saved: flag(true) });
export const checkpoint = object({ checkpointId: text('checkpoint-001'), turn, nextStep: choice(['prepare', 'controls', 'settle']), settledCallIds: list(text('call-001'), []), round: count(1) });
export const uncertainty = object({ turn, operationId: text('call-001'), evidenceRef: text('evidence:call-001'), effect: choice(['unknown', 'succeeded', 'failed']), authorityRetained: fixed(true) });
export const control = object({ conversationId: text('conversation-demo'), turnId: text('turn-001'), action: choice(['steer', 'interrupt', 'stop']), guidance: nullable(text('Use the updated constraints')), actorId: text('person-demo'), authority });
export const approvalPromptAnswer = object({ promptId: text('prompt-001'), turnId: text('turn-001'), operationId: text('call-001'), responderId: text('person-demo'), waitId: text('wait:approval:call-001'), waitRevision: count(1), answerKind: fixed('operation-approval'), answer: choice(permissionApprovalChoices), reviewedScopeDigest: text('sha256:fixture-reviewed-scope'), authority, continuationGranted: fixed(false) });
export const promptAnswer = object({ promptId: text('prompt-001'), turnId: text('turn-001'), operationId: text('call-001'), responderId: text('person-demo'), answer: text('approve'), authority });
export const toolCall = object({ callId: text('call-001'), name: text('calculator'), arguments: argumentObject });
export const toolResult = union(
  object({ callId: text('call-001'), outcome: fixed('success'), value: jsonValue(4) }),
  object({ callId: text('call-001'), outcome: choice(['error', 'denied', 'skipped', 'cancelled']), code: text('invalid_expression'), message: text('Supply a valid arithmetic expression.'), correctable: flag(true) }),
);
export const limits = object({ roundsStarted: count(0), maxRounds: { schema: { type: 'integer', minimum: 1 }, example: 3 }, attempts: count(0), retriesRemaining: count(1) });
export const turnState = object({ turn, limits, results: list(toolResult, []), pendingControls: list(control, []) });
export const terminal = object({ turn, outcome: choice(['completed', 'failed', 'cancelled', 'exhausted']), reason: text('answer_complete'), requiredWorkResolved: flag(true) });
export const released = object({ turnId: text('turn-001'), conversationId: text('conversation-demo'), ownerId: text('execution-worker-demo'), fence: count(2), outcome: choice(['completed', 'failed', 'cancelled', 'exhausted']) });

export const attachmentEnvelope = replaceField(envelope, 'content', object({ text: sample(nullable(text('Read this image')), null), attachments: list(attachmentRef, [attachmentRef.example], 1) }));
export const attachmentRouted = replaceField(routed, 'envelope', attachmentEnvelope);
export const attachmentAccepted = replaceField(replaceField(accepted, 'record', attachmentRouted), 'originals', list(custody, [custody.example], 1));
