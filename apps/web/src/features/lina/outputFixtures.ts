import type { LinaDocument } from './linaModel';
import type { SimulationAnswer, SimulationChannel, SimulationEvent, SimulationWait } from './inputSimulation';
import { OUTPUT_STATE_ROUTES } from './outputBlock';
import { applyModelFixtureEvent, createModelFixtureState, type ModelFixtureState } from './modelFixtures';
export type OutputCase = 'disabled' | 'final' | 'structured' | 'invalid-structured' | 'media-only' | 'media-denied' | 'media-expired' | 'media-unavailable' | 'upload-unknown' | 'refusal' | 'failure' | 'quiet' | 'long-code' | 'prompt' | 'prompt-fallback' | 'clarification' | 'preview' | 'preview-promote' | 'preview-failure' | 'stale-preview' | 'coalesced-progress' | 'proactive' | 'proactive-ineligible' | 'fanout' | 'fanout-partial' | 'internal' | 'child-announcement' | 'tool-dedupe' | 'distinct-tool-content' | 'route-missing' | 'route-stale' | 'policy-denied' | 'permission-wait' | 'storage-failure' | 'registration-lost-ack' | 'safe-retry' | 'rate-limit' | 'permanent-failure' | 'partial-success' | 'retry-exhausted' | 'unknown-send' | 'warned-resend' | 'crash-before-admission' | 'crash-after-admission' | 'crash-after-send-start' | 'crash-after-acceptance' | 'crash-before-receipt-persist' | 'lost-claim' | 'duplicate-receipt' | 'out-of-order-receipt' | 'unmatched-receipt' | 'late-ack' | 'delivery-threshold' | 'read-threshold' | 'deadline' | 'stop-preview' | 'stop-unknown';
export const OUTPUT_CASES: {
    value: OutputCase;
    label: string;
}[] = [
    ['final', 'Final answer'], ['structured', 'Typed result'], ['invalid-structured', 'Invalid typed result'], ['media-only', 'Media-only answer'], ['media-denied', 'Artifact access denied'], ['media-expired', 'Expired media handle'], ['media-unavailable', 'Artifact bytes unavailable'], ['upload-unknown', 'Upload acknowledgment unknown'], ['refusal', 'Refusal'], ['failure', 'Failure status'], ['quiet', 'Quiet completion'], ['long-code', 'Long text and code fences'], ['clarification', 'Tool input clarification'], ['prompt', 'Four-choice prompt'], ['prompt-fallback', 'Prompt with typed fallback'], ['preview', 'Editable preview'], ['preview-promote', 'Promote preview to final'], ['preview-failure', 'Preview accepted; final fails'], ['stale-preview', 'Late stale preview'], ['coalesced-progress', 'Coalesced progress'], ['proactive', 'Admitted proactive notice'], ['proactive-ineligible', 'Proactive message ineligible'], ['fanout', 'Independent recipients'], ['fanout-partial', 'One recipient rejected'], ['internal', 'Internal child result'], ['child-announcement', 'Authorized child announcement'], ['tool-dedupe', 'Confirmed same-target duplicate'], ['distinct-tool-content', 'Preserve distinct new content'], ['route-missing', 'Missing route'], ['route-stale', 'Stale route binding'], ['policy-denied', 'Disclosure denied'], ['permission-wait', 'Output permission review'], ['storage-failure', 'Required custody fails'], ['registration-lost-ack', 'Registration acknowledgment lost'], ['safe-retry', 'Proven-unsent retry'], ['rate-limit', 'Provider wait'], ['permanent-failure', 'Permanent rejection'], ['partial-success', 'Some parts accepted'], ['retry-exhausted', 'Retry budget exhausted'], ['unknown-send', 'Uncertain transport acceptance'], ['warned-resend', 'Authorized duplicate-risk resend'], ['crash-before-admission', 'Crash before registration'], ['crash-after-admission', 'Crash after registration'], ['crash-after-send-start', 'Crash after send-start'], ['crash-after-acceptance', 'Crash after remote acceptance'], ['crash-before-receipt-persist', 'Crash before receipt persistence'], ['lost-claim', 'Claim fence changes'], ['duplicate-receipt', 'Duplicate provider receipt'], ['out-of-order-receipt', 'Out-of-order receipt'], ['unmatched-receipt', 'Unmatched recipient receipt'], ['late-ack', 'Late acceptance after Stop'], ['delivery-threshold', 'Wait for provider delivery'], ['read-threshold', 'Wait for read fact'], ['deadline', 'Deadline before send'], ['stop-preview', 'Stop seals preview'], ['stop-unknown', 'Stop preserves uncertain send'],
].map(([value, label]) => ({ value: value as OutputCase, label }));
export interface OutputSettings {
    threshold: 'accepted' | 'delivered' | 'read';
    streaming: 'final-only' | 'preview';
    cliMode: 'tty' | 'text' | 'jsonl' | 'rpc';
    maxAttempts: number;
    unknownPolicy: 'hold' | 'warned-resend';
    partLimit: number;
}
export const DEFAULT_OUTPUT_SETTINGS: OutputSettings = { threshold: 'accepted', streaming: 'final-only', cliMode: 'text', maxAttempts: 3, unknownPolicy: 'hold', partLimit: 160 };
export function outputScenarioSettings(scenario: OutputCase): Partial<OutputSettings> { return { ...(['preview', 'preview-promote', 'preview-failure', 'stale-preview', 'coalesced-progress', 'stop-preview'].includes(scenario) ? { streaming: 'preview' as const } : {}), ...(scenario === 'warned-resend' ? { unknownPolicy: 'warned-resend' as const } : {}), ...(scenario === 'delivery-threshold' ? { threshold: 'delivered' as const } : {}), ...(scenario === 'read-threshold' ? { threshold: 'read' as const } : {}) }; }
export interface OutputContent {
    kind: 'text' | 'structured' | 'media' | 'prompt' | 'status';
    text?: string;
    data?: {
        answer: number | null;
        source: string;
    };
    artifacts?: string[];
    choices?: string[];
    prompt?: {
        kind: 'approval' | 'clarification' | 'readiness';
        answerSchema?: Record<string, unknown>;
        id: string;
        waitId: string;
        revision: number;
        scopeDigest: string;
        responders: string[];
        expires: number;
        tokenId: string;
        choiceTokens: Record<string, string>;
    };
    canonicalDigest: string;
}
export interface OutputIntent {
    id: string;
    producer: string;
    audience: 'external' | 'internal';
    finality: 'final' | 'preview' | 'prompt' | 'notice';
    content: OutputContent;
    required: boolean;
    ownerAgentId: string;
    notification?: {
        id: string;
        admitted: boolean;
        optIn: boolean;
        serviceWindow: 'open' | 'closed';
        template?: string;
    };
    suppressed?: string;
}
export interface OutputPart {
    id: string;
    index: number;
    revision: number;
    payload: Record<string, unknown>;
    digest: string;
    status: 'prepared' | 'started' | 'accepted' | 'delivered' | 'read' | 'rejected' | 'unknown' | 'cancelled';
    providerId?: string;
    attemptIds: string[];
}
export interface OutputObligation {
    id: string;
    outputId: string;
    recipient: {
        accountId: string;
        target: string;
        thread: string;
        incarnation: number;
    };
    lane: string;
    generation: number;
    claim?: {
        owner: string;
        fence: number;
    };
    required: boolean;
    threshold: OutputSettings['threshold'];
    receiptCapabilities?: {
        delivery: boolean;
        read: boolean;
    };
    custody: 'unregistered' | 'retained' | 'transferred';
    parts: OutputPart[];
    status: 'prepared' | 'pending' | 'accepted' | 'failed' | 'suppressed' | 'cancelled' | 'unresolved';
    deadline: number;
    retentionOwner: string;
    duplicateRisk: boolean;
}
export interface OutputAttempt {
    id: string;
    deliveryId: string;
    partId: string;
    revision: number;
    fence: number;
    sendStarted: boolean;
    outcome: 'started' | 'accepted' | 'unsent' | 'rejected' | 'unknown';
    retryAfter?: number;
}
export interface OutputObservation {
    id: string;
    deliveryId: string;
    partId: string;
    providerId: string;
    accountId: string;
    target: string;
    fact: 'accepted' | 'delivered' | 'read' | 'rejected';
    fence: number;
    raw: Record<string, unknown>;
    projection: 'applied' | 'late' | 'duplicate' | 'stale' | 'unmatched';
}
export interface OutputArtifact {
    id: string;
    digest: string;
    bytes: string;
    access: 'allowed' | 'denied';
    custody: 'environment' | 'output' | 'retained';
    handle?: {
        id: string;
        accountId: string;
        digest: string;
        expires: number;
    };
    uploadAttempt?: {
        id: string;
        accountId: string;
        digest: string;
        sendStarted: boolean;
        outcome: 'started' | 'ready' | 'unknown' | 'unsent';
    };
    upload: 'none' | 'ready' | 'unknown';
    cleanup: 'retained' | 'eligible';
}
export interface OutputRecoverySnapshot {
    intents: Record<string, OutputIntent>;
    obligations: Record<string, OutputObligation>;
    attempts: Record<string, OutputAttempt>;
    observations: OutputObservation[];
    artifacts: Record<string, OutputArtifact>;
    transactions: Record<string, {
        fingerprint: string;
        outcome: string;
    }>;
    ownerFence: number;
}
export interface OutputFixtureState {
    storage: 'fixture-only';
    channel: SimulationChannel;
    intents: Record<string, OutputIntent>;
    obligations: Record<string, OutputObligation>;
    attempts: Record<string, OutputAttempt>;
    observations: OutputObservation[];
    artifacts: Record<string, OutputArtifact>;
    streams: Record<string, {
        revision: number;
        sealed: boolean;
        providerId?: string;
        coalesced: number;
    }>;
    transactions: Record<string, {
        fingerprint: string;
        outcome: string;
    }>;
    clock: number;
    ownerFence: number;
    stopped: boolean;
    recoverySnapshots: Record<string, OutputRecoverySnapshot>;
    recoveries: {
        stage: string;
        originalOutputIds: string[];
        originalAttemptIds: string[];
        preparedDigests: string[];
        newFence: number;
    }[];
    providerEvidence: Record<string, {
        providerId: string;
        fact: 'accepted';
    }>;
}
export interface OutputEvidence {
    phase: string;
    outcome: string;
    reason: string;
    outputId?: string;
    deliveryId?: string;
    partId?: string;
    attemptId?: string;
    threshold?: OutputSettings['threshold'];
}
const clone = <T>(value: T): T => structuredClone(value);
const digest = (value: unknown) => { let hash = 2166136261; for (const char of JSON.stringify(value))
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return `fixture-fnv:${(hash >>> 0).toString(16)}`; };
export function createOutputFixtureState(channel: SimulationChannel = 'cli'): OutputFixtureState { return { storage: 'fixture-only', channel, intents: {}, obligations: {}, attempts: {}, observations: [], artifacts: {}, streams: {}, transactions: {}, clock: 0, ownerFence: 1, stopped: false, recoverySnapshots: {}, recoveries: [], providerEvidence: {} }; }
/** Capture only committed Output custody at the injected boundary. Recovery reconstructs
 * original identities/bytes, advances worker fencing and leaves provider facts for inspection. */
export function recoverOutputFixture(store: OutputFixtureState, stage: string): void {
    const snapshot: OutputRecoverySnapshot = clone({ intents: store.intents, obligations: store.obligations, attempts: store.attempts, observations: store.observations, artifacts: store.artifacts, transactions: store.transactions, ownerFence: store.ownerFence });
    store.recoverySnapshots[stage] = snapshot;
    const restored = clone(snapshot);
    // Existing local references stand for a recovered handler reacquiring the same record identity.
    for (const [id, row] of Object.entries(restored.obligations)) {
        const original = store.obligations[id];
        if (original) {
            const parts = original.parts;
            Object.assign(original, { ...row, parts });
            for (const part of row.parts)
                Object.assign(parts.find(candidate => candidate.id === part.id)!, part);
        }
        else
            store.obligations[id] = row;
    }
    store.intents = restored.intents;
    store.attempts = restored.attempts;
    store.observations = restored.observations;
    store.artifacts = restored.artifacts;
    store.transactions = restored.transactions;
    store.ownerFence = restored.ownerFence + 1;
    store.recoveries.push({ stage, originalOutputIds: Object.keys(restored.intents), originalAttemptIds: Object.keys(restored.attempts), preparedDigests: Object.values(restored.obligations).flatMap(row => row.parts.map(part => part.digest)), newFence: store.ownerFence });
}
/** Correlated observations retain raw duplicates; late delivery facts never regress read/acceptance. */
export function observeOutputFixture(store: OutputFixtureState, observation: Omit<OutputObservation, 'projection'>): OutputObservation['projection'] {
    const obligation = store.obligations[observation.deliveryId], part = obligation?.parts.find(part => part.id === observation.partId);
    let projection: OutputObservation['projection'] = 'applied';
    if (store.observations.some(row => row.id === observation.id))
        projection = 'duplicate';
    else if (!obligation || !part || obligation.recipient.accountId !== observation.accountId || obligation.recipient.target !== observation.target || part.providerId && part.providerId !== observation.providerId)
        projection = 'unmatched';
    else if (observation.fence !== obligation.generation)
        projection = part.attemptIds.some(id => store.attempts[id]?.fence === observation.fence) ? 'late' : 'stale';
    if ((projection === 'applied' || projection === 'late') && part) {
        const rank = { prepared: 0, started: 0, unknown: 0, cancelled: 0, rejected: 0, accepted: 1, delivered: 2, read: 3 };
        if (observation.fact === 'rejected') {
            if (rank[part.status] === 0)
                part.status = 'rejected';
        }
        else if (rank[observation.fact] > rank[part.status]) {
            part.status = observation.fact;
            part.providerId = observation.providerId;
        }
    }
    store.observations.push({ ...clone(observation), projection });
    return projection;
}
/** Required registration is an atomic fixture receipt. Reusing identity with changed prepared bytes conflicts. */
export function registerOutputFixture(store: OutputFixtureState, obligation: OutputObligation): 'stored' | 'duplicate' | 'conflict' { const fingerprint = digest({ outputId: obligation.outputId, recipient: obligation.recipient, lane: obligation.lane, required: obligation.required, threshold: obligation.threshold, parts: obligation.parts.map(part => ({ id: part.id, index: part.index, revision: part.revision, digest: part.digest, payload: part.payload })) }), prior = store.transactions[obligation.id]; if (prior)
    return prior.fingerprint === fingerprint ? 'duplicate' : 'conflict'; store.transactions[obligation.id] = { fingerprint, outcome: 'stored' }; obligation.custody = 'retained'; store.obligations[obligation.id] = clone(obligation); return 'stored'; }
/** Fixture-native limits are configurable teaching values, not claims about platform maxima. */
export function renderOutputFixture(content: OutputContent, channel: SimulationChannel, settings: OutputSettings): Record<string, unknown>[] {
    if (content.kind === 'media')
        return [{ type: 'media', artifactRefs: content.artifacts }];
    if (content.kind === 'structured' && channel === 'cli' && ['jsonl', 'rpc'].includes(settings.cliMode))
        return [{ type: settings.cliMode, result: content.data, stdout: JSON.stringify({ type: 'result', result: content.data }) }];
    if (content.kind === 'prompt')
        return [{ type: 'prompt', text: content.text, controls: channel === 'whatsapp' ? content.choices?.slice(0, 3) : channel === 'cli' ? [] : content.choices, typedAnswers: content.choices, prompt: content.prompt, scopeToken: content.prompt?.tokenId, diagnostics: 'stderr-only' }];
    const text = content.kind === 'structured' ? JSON.stringify(content.data) : content.text ?? '', chunks: string[] = [];
    let remaining = text;
    const width = Math.max(24, settings.partLimit);
    while (remaining.length) {
        let end = Math.min(width, remaining.length);
        const fence = remaining.lastIndexOf('```', end - 1);
        if (fence >= 0 && fence < end && fence + 3 > end)
            end = fence;
        const tail = remaining.slice(0, end).match(/`{1,2}$/)?.[0];
        if (tail && end < remaining.length && remaining[end] === '`')
            end -= tail.length;
        if (end <= 0)
            end = Math.min(3, remaining.length);
        chunks.push(remaining.slice(0, end));
        remaining = remaining.slice(end);
    }
    if (!chunks.length)
        chunks.push('');
    let inside = false;
    return chunks.map(chunk => { const prefix = inside ? '```\n' : '', count = chunk.split('```').length - 1; inside = count % 2 ? !inside : inside; const rendered = prefix + chunk + (inside ? '\n```' : ''); return { type: 'text', text: rendered, sourceText: chunk, codeFenceBalanced: rendered.split('```').length % 2 === 1, canonicalText: text, stdout: channel === 'cli' ? settings.cliMode === 'jsonl' ? JSON.stringify({ type: 'text', text: chunk }) : settings.cliMode === 'rpc' ? JSON.stringify({ type: 'response', text: chunk }) : chunk : undefined, diagnostics: 'stderr-only' }; });
}
/** Each outward producer enters one shared transport lifecycle. Records and sends are fixtures. */
export function withOutput(base: SimulationEvent[], document: LinaDocument, scenario: OutputCase = 'final', settings: Partial<OutputSettings> = {}, options: {
    answers?: Record<string, SimulationAnswer>;
    seed?: OutputFixtureState;
    stopped?: boolean;
    channel?: SimulationChannel;
} = {}): SimulationEvent[] {
    if (scenario === 'disabled' || scenario === 'final' && !document.nodes.some(node => node.id.startsWith('lina-output-')))
        return base;
    const config = { ...DEFAULT_OUTPUT_SETTINGS, ...outputScenarioSettings(scenario), ...settings }, store = options.seed ? clone(options.seed) : createOutputFixtureState(options.channel), out: SimulationEvent[] = [], deferred: SimulationEvent[] = [];
    let serial = 0, finalized = false, previewed = false, released = false, toolPublished = false, noticePublished = false, internalPublished = false, model: ModelFixtureState | undefined, protocol: ModelFixtureState['protocol'] = 'openai-chat', turnStatus = 'completed';
    let plannedModel: ModelFixtureState | undefined, plannedProtocol: ModelFixtureState['protocol'] = 'openai-chat';
    for (const event of base) {
        if (event.agentId && event.agentId !== 'main')
            continue;
        if (event.modelRequest)
            plannedProtocol = event.modelRequest.binding.protocol;
        if (event.modelEvent?.type === 'launch')
            plannedModel = createModelFixtureState(event.modelEvent.attemptId, plannedProtocol);
        if (event.modelEvent && plannedModel)
            plannedModel = applyModelFixtureEvent(plannedModel, event.modelEvent);
    }
    const plannedText = plannedModel?.outcome?.text || 'Observed fixture result';
    const n = (suffix: string) => `lina-output-${suffix}`;
    const emit = (source: string, target: string, phase: string, outcome: string, reason: string, obligation?: OutputObligation, extra: Partial<SimulationEvent> = {}) => { const edge = document.edges.find(edge => edge.source === source && edge.target === target); out.push({ id: `output:${serial++}:${phase}:${obligation?.id ?? 'intent'}`, nodeId: target, sourceNodeId: source, edgeId: edge?.id ?? `missing-output-edge:${source}:${target}`, update: { detail: reason }, outputEvidence: { phase, outcome, reason, deliveryId: obligation?.id, outputId: obligation?.outputId, threshold: obligation?.threshold }, outputSnapshot: clone(store), ...extra }); };
    function persist(owner: string, kind: 'load' | 'record', obligation?: OutputObligation) { const route = OUTPUT_STATE_ROUTES.find(route => route.source === n(owner) && route.kind === kind); if (!route)
        return; emit(route.source, route.target, owner, kind === 'record' ? 'committed' : 'inspected', `${route.phase}; exact original identity and prepared bytes`, obligation); emit(route.target, route.returnTarget, owner, 'acknowledged', 'Resume original Output phase under same receipt', obligation); }
    function wait(obligation: OutputObligation, receipt = false, part?: OutputPart) { const id = `output-wait:${obligation.id}${part ? `:part:${part.index + 1}` : ''}`, answer = options.answers?.[id]; if (answer && answer !== 'stale' && answer !== 'wrong-account')
        return answer; emit(n('reconcile'), 'lina-execution-wait', 'reconcile', 'waiting', 'Original delivery retained until exact evidence or eligible receipt arrives', obligation, { id, wait: { id, kind: receipt ? 'output-receipt' : 'output-reconciliation', owner: 'output', deliveryId: obligation.id, ownerNodeId: n('reconcile') } }); const event = out.pop()!; deferred.push(event); return undefined; }
    function settle(obligation: OutputObligation, source: string, reason: string) {
        const rank = { prepared: 0, started: 0, unknown: 0, cancelled: 0, rejected: 0, accepted: 1, delivered: 2, read: 3 }, threshold = { accepted: 1, delivered: 2, read: 3 }[obligation.threshold];
        obligation.status = obligation.parts.every(part => rank[part.status] >= threshold) ? 'accepted' : obligation.parts.some(part => part.status === 'unknown') ? 'unresolved' : obligation.parts.some(part => part.status === 'rejected') ? 'failed' : obligation.parts.some(part => part.status === 'cancelled') ? 'cancelled' : 'pending';
        if (obligation.status === 'accepted') {
            obligation.custody = 'transferred';
            obligation.retentionOwner = 'run-artifacts';
            for (const artifact of Object.values(store.artifacts)) {
                artifact.custody = 'retained';
                artifact.cleanup = 'retained';
            }
        }
        emit(source, n('settle'), 'settle', obligation.status, reason, obligation);
        persist('settle', 'record', obligation);
    }
    function observation(obligation: OutputObligation, part: OutputPart, fact: OutputObservation['fact'], source = n('send'), overrides: Partial<OutputObservation> = {}) {
        const row = { id: `receipt:${part.id}:${fact}`, deliveryId: obligation.id, partId: part.id, providerId: part.providerId ?? `provider:${part.id}`, accountId: obligation.recipient.accountId, target: obligation.recipient.target, fact, fence: store.attempts[part.attemptIds.at(-1) ?? '']?.fence ?? obligation.generation, raw: { synthetic: true, nativeFact: fact, sourceTime: store.clock, localTime: store.clock }, ...overrides };
        const outcome = observeOutputFixture(store, row);
        emit(source, n('observe'), 'observe', outcome, `Correlated ${fact} fact; acceptance is distinct from delivery/read`, obligation);
        persist('observe', 'record', obligation);
    }
    function dispatch(obligation: OutputObligation) {
        emit(n('register'), n('schedule'), 'schedule', 'claimed', 'Acquire ordered account/recipient/thread lane', obligation);
        obligation.generation = store.ownerFence;
        obligation.claim = { owner: 'output-worker', fence: store.ownerFence };
        persist('schedule', 'record', obligation);
        if (['deadline', 'lost-claim'].includes(scenario)) {
            if (scenario === 'lost-claim')
                store.ownerFence++;
            for (const part of obligation.parts)
                part.status = 'cancelled';
            settle(obligation, n('schedule'), scenario === 'lost-claim' ? 'Stale fence cannot send under newer owner' : 'Delivery deadline exhausted before send');
            return;
        }
        for (const part of obligation.parts) {
            if (['accepted', 'delivered', 'read'].includes(part.status))
                continue;
            let attempt = 0, sent = false;
            while (!sent && attempt < Math.max(1, config.maxAttempts)) {
                attempt++;
                store.clock++;
                if (obligation.claim?.fence !== store.ownerFence) {
                    obligation.generation = store.ownerFence;
                    obligation.claim = { owner: 'output-worker', fence: store.ownerFence };
                    persist('schedule', 'record', obligation);
                }
                if (store.stopped || obligation.claim?.fence !== store.ownerFence || obligation.generation !== store.ownerFence || part.digest !== digest(part.payload)) {
                    part.status = 'cancelled';
                    for (const remaining of obligation.parts)
                        if (remaining.status === 'prepared')
                            remaining.status = 'cancelled';
                    settle(obligation, n('schedule'), 'Current Stop/claim/revision/digest admission rejects transport before any send-start');
                    return;
                }
                const attemptId = `attempt:${part.id}:${attempt}`;
                let record: OutputAttempt = { id: attemptId, deliveryId: obligation.id, partId: part.id, revision: part.revision, fence: obligation.generation, sendStarted: true, outcome: 'started' };
                part.attemptIds.push(attemptId);
                store.attempts[attemptId] = record;
                part.status = 'started';
                emit(n('schedule'), n('send'), 'send', 'start-staged', 'Exact part/revision/fence rechecked before external fixture effect', obligation);
                persist('send', 'record', obligation);
                const unknown = ['unknown-send', 'warned-resend', 'crash-after-send-start', 'stop-unknown'].includes(scenario) && attempt === 1;
                if (unknown) {
                    if (scenario === 'crash-after-send-start') {
                        recoverOutputFixture(store, 'after-send-start');
                        emit('lina-state-recover', n('reconcile'), 'reconcile', 'attempt-restored', 'Recorded send-start restored; remote effect remains unknown', obligation);
                        record = store.attempts[attemptId];
                    }
                    record.outcome = 'unknown';
                    part.status = 'unknown';
                    emit(n('send'), n('reconcile'), 'reconcile', 'unknown', 'Send-start exists; missing acknowledgment does not establish no effect', obligation);
                    persist('reconcile', 'load', obligation);
                    if (scenario === 'stop-unknown') {
                        store.stopped = true;
                        store.ownerFence++;
                        emit('lina-execution-cancel', n('schedule'), 'schedule', 'withheld', 'Stop retains original uncertain attempt and forbids fresh dispatch', obligation);
                    }
                    const answer = wait(obligation, false, part);
                    if (answer === 'known-success') {
                        emit('lina-execution-wait', n('reconcile'), 'reconcile', 'confirmed', 'Matched original transport evidence; no resend', obligation, { id: `output-wait:${obligation.id}:part:${part.index + 1}`, resumeWait: true });
                        observation(obligation, part, 'accepted', n('reconcile'));
                        store.attempts[attemptId].outcome = 'accepted';
                        sent = true;
                    }
                    else if (answer === 'known-no-effect') {
                        emit('lina-execution-wait', n('reconcile'), 'reconcile', 'unsent', 'Exact evidence proves original part was not sent', obligation, { id: `output-wait:${obligation.id}:part:${part.index + 1}`, resumeWait: true });
                        record.outcome = 'unsent';
                        part.status = store.stopped ? 'cancelled' : 'prepared';
                        if (store.stopped) {
                            settle(obligation, n('reconcile'), 'Stopped original send proven absent; no replacement admitted');
                            return;
                        }
                        emit(n('reconcile'), n('schedule'), 'schedule', 'retry-safe', 'Original part identity/custody retained; no agent rerun', obligation);
                    }
                    else if (config.unknownPolicy === 'warned-resend' && attempt < config.maxAttempts) {
                        const pending = deferred.findIndex(event => event.wait?.owner === 'output' && event.wait.deliveryId === obligation.id && event.id === `output-wait:${obligation.id}:part:${part.index + 1}`);
                        if (pending >= 0)
                            deferred.splice(pending, 1);
                        obligation.duplicateRisk = true;
                        part.status = 'prepared';
                        emit(n('reconcile'), n('schedule'), 'schedule', 'duplicate-risk', 'Explicit warned-resend policy admits possible duplicate remote effect', obligation);
                    }
                    else {
                        settle(obligation, n('reconcile'), 'Unknown effect retained; automatic resend withheld');
                        return;
                    }
                    continue;
                }
                const permanent = scenario === 'permanent-failure' || scenario === 'preview-failure' && obligation.required || scenario === 'fanout-partial' && obligation.recipient.target.endsWith(':recipient-2');
                const failed = permanent || scenario === 'retry-exhausted' || (['safe-retry', 'rate-limit'].includes(scenario) && attempt === 1) || scenario === 'partial-success' && part.index === 1 && attempt === 1;
                if (failed) {
                    record.outcome = permanent ? 'rejected' : 'unsent';
                    part.status = 'rejected';
                    emit(n('send'), n('retry'), 'retry', permanent ? 'permanent' : 'proven-unsent', 'Classify rejection/effect certainty before retrying', obligation);
                    if (permanent || attempt >= config.maxAttempts) {
                        settle(obligation, n('retry'), 'Permanent failure or retry budget exhausted; accepted siblings retained');
                        return;
                    }
                    if (scenario === 'rate-limit') {
                        record.retryAfter = store.clock + 2;
                        store.clock += 2;
                        emit(n('retry'), n('schedule'), 'schedule', 'provider-wait', 'Original part deferred by declared retry-after', obligation);
                    }
                    else
                        emit(n('retry'), n('schedule'), 'schedule', 'safe-retry', 'Only proven-unsent part retries; no confirmed sibling is replayed', obligation);
                    continue;
                }
                if (['crash-after-acceptance', 'crash-before-receipt-persist'].includes(scenario) && attempt === 1) {
                    store.providerEvidence[attemptId] = { providerId: `provider:${part.id}`, fact: 'accepted' };
                    recoverOutputFixture(store, scenario === 'crash-after-acceptance' ? 'after-remote-acceptance' : 'before-receipt-persistence');
                    part.status = 'unknown';
                    store.attempts[attemptId].outcome = 'unknown';
                    emit('lina-state-recover', n('reconcile'), 'reconcile', 'restored-unknown', 'Only send-start was committed; provider acknowledgment was not in recovered journal', obligation);
                    persist('reconcile', 'load', obligation);
                    observation(obligation, part, store.providerEvidence[attemptId].fact, n('reconcile'), { providerId: store.providerEvidence[attemptId].providerId });
                    store.attempts[attemptId].outcome = 'accepted';
                    sent = true;
                }
                else {
                    record.outcome = 'accepted';
                    observation(obligation, part, 'accepted');
                    sent = true;
                }
                if (scenario === 'late-ack') {
                    store.stopped = true;
                    store.ownerFence++;
                    emit('lina-execution-cancel', n('schedule'), 'schedule', 'stopped', 'Native effect already occurred; Stop withholds new work', obligation);
                    obligation.generation = store.ownerFence;
                    observation(obligation, part, 'delivered', 'lina-input-delivery', { id: `late:${part.id}`, fence: record.fence });
                }
                if (scenario === 'duplicate-receipt')
                    observation(obligation, part, 'accepted', 'lina-input-delivery');
                if (scenario === 'out-of-order-receipt') {
                    observation(obligation, part, 'read', 'lina-input-delivery');
                    observation(obligation, part, 'delivered', 'lina-input-delivery');
                }
                if (scenario === 'unmatched-receipt')
                    observation(obligation, part, 'read', 'lina-input-delivery', { id: `unmatched:${part.id}`, target: 'wrong-recipient' });
                if (part.index < obligation.parts.length - 1)
                    emit(n('observe'), n('schedule'), 'schedule', 'next-part', 'Accepted chunk is retained; schedule only next ordered unsent chunk', obligation);
            }
        }
        settle(obligation, n('observe'), 'All required parts assessed independently at configured threshold');
        if (obligation.status === 'pending' && !obligation.receiptCapabilities?.[obligation.threshold === 'read' ? 'read' : 'delivery']) {
            obligation.status = 'unresolved';
            emit(n('observe'), n('settle'), 'settle', 'unsupported-threshold', 'Selected native adapter has no declared provider receipt capability; acceptance retained, later fact unknown', obligation);
            persist('settle', 'record', obligation);
            return;
        }
        if (obligation.status === 'pending') {
            emit(n('observe'), n('reconcile'), 'reconcile', 'receipt-pending', 'Execution may release after custody; provider receipt remains a separate obligation', obligation);
            const answer = wait(obligation, true);
            if (answer === 'ready' || answer === 'known-success') {
                emit('lina-execution-wait', n('reconcile'), 'reconcile', 'receipt', 'Matched provider fact received for original delivery', obligation, { id: `output-wait:${obligation.id}`, resumeWait: true });
                for (const part of obligation.parts)
                    observation(obligation, part, obligation.threshold === 'read' ? 'read' : 'delivered', n('reconcile'));
                settle(obligation, n('observe'), 'Configured provider threshold observed');
            }
        }
    }
    function produce(source: string, text: string, kind: OutputIntent['finality'] = 'final', owner = 'main', originalWaits?: SimulationWait[], audience: OutputIntent['audience'] = 'external', promptAnchor?: string, promptIdentity?: SimulationWait, promptReturnNode = 'lina-input-delivery') {
        const accountId = `account-fixture:${store.channel}`;
        const outputId = `output:${owner}:${kind}:${Object.keys(store.intents).length + 1}`, content: OutputContent = { kind: kind === 'prompt' ? 'prompt' : 'text', text, canonicalDigest: digest(text), ...(kind === 'prompt' ? { choices: ['allow-once', 'allow-session', 'allow-always', 'deny'] } : {}) };
        if (kind === 'prompt') {
            const registered = originalWaits?.[0] ?? promptIdentity, waitId = registered?.id ?? `fixture:output-prompt:${outputId}`, scopeDigest = registered && 'reviewedMatcher' in registered ? digest(registered.reviewedMatcher) : digest({ waitId });
            const promptKind = registered?.kind === 'input' ? 'clarification' : registered?.kind === 'approval' ? 'approval' : 'readiness';
            if (promptKind !== 'approval')
                content.choices = [];
            content.prompt = { kind: promptKind, ...(promptKind !== 'approval' ? { answerSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } } : {}), id: `prompt:${waitId}`, waitId, revision: 1, scopeDigest, responders: ['fixture:authorized-user'], expires: store.clock + 30, tokenId: `token:${waitId}:${scopeDigest}`, choiceTokens: Object.fromEntries(content.choices!.map(choice => [choice, `token:${waitId}:${scopeDigest}:${choice}`])) };
        }
        if (scenario === 'structured' || scenario === 'invalid-structured') {
            content.kind = 'structured';
            content.data = { answer: scenario === 'structured' ? 4 : null, source: 'observed fixture result' };
            content.canonicalDigest = digest(content.data);
        }
        if (scenario.startsWith('media-') || scenario === 'upload-unknown') {
            content.kind = 'media';
            content.artifacts = ['artifact:output:report'];
            const denied = scenario === 'media-denied';
            store.artifacts['artifact:output:report'] = { id: 'artifact:output:report', digest: digest('fixture report bytes'), bytes: scenario === 'media-unavailable' ? '' : 'fixture report bytes', access: denied ? 'denied' : 'allowed', custody: 'environment', upload: 'none', cleanup: 'retained', ...(scenario === 'media-expired' ? { handle: { id: 'native:expired', accountId, digest: digest('fixture report bytes'), expires: 0 } } : {}) };
        }
        if (scenario === 'long-code' || scenario === 'partial-success') {
            content.text = 'Explanation\n```ts\n' + ('const answer = 4;\n'.repeat(28)) + '```\nComplete.';
            content.canonicalDigest = digest(content.text);
        }
        const intent: OutputIntent = { id: outputId, producer: source, audience, finality: kind, content, required: kind !== 'preview', ownerAgentId: owner, ...(kind === 'notice' && ['proactive', 'proactive-ineligible'].includes(scenario) ? { notification: { id: `notice:${outputId}`, admitted: true, optIn: scenario !== 'proactive-ineligible', serviceWindow: scenario === 'proactive-ineligible' ? 'closed' as const : 'open' as const } } : {}) };
        store.intents[outputId] = intent;
        if (kind === 'preview')
            emit(source, n('stream'), 'stream', 'visible', 'Admitted visible model text enters revision controller before any transport');
        else
            emit(source, n('intent'), 'intent', 'captured', 'Canonical producer/audience/content captured without new model attempt');
        if (intent.audience === 'internal') {
            emit(n('intent'), 'lina-subagents-coordinate', 'intent', 'internal-return', 'Internal parent result has no external recipient or transport effect');
            return;
        }
        if (scenario === 'quiet') {
            intent.suppressed = 'explicit-quiet';
            emit(n('intent'), n('settle'), 'settle', 'suppressed', 'Quiet completion declared; no owed external send');
            return;
        }
        if (scenario === 'tool-dedupe' && kind === 'final' && Object.values(store.obligations).some(obligation => store.intents[obligation.outputId]?.producer === 'lina-tools-dispatch' && store.intents[obligation.outputId].content.canonicalDigest === content.canonicalDigest && obligation.recipient.accountId === accountId && obligation.recipient.target === `${store.channel}:recipient-1` && obligation.status === 'accepted')) {
            intent.suppressed = 'confirmed-same-target-digest';
            emit(n('intent'), n('settle'), 'settle', 'suppressed', 'Target-specific confirmed tool message matches final canonical digest');
            return;
        }
        if (kind !== 'preview')
            emit(n('intent'), n('route'), 'route', 'bound', 'Bind original account/recipient/thread/incarnation; no target fallback');
        if (['route-missing', 'route-stale'].includes(scenario)) {
            emit(n('route'), n('settle'), 'settle', 'failed', 'Missing/stale destination cannot silently switch accounts or recipients');
            return;
        }
        emit(n(kind === 'preview' ? 'stream' : 'route'), n('policy'), 'policy', 'requested', 'Disclosure and native eligibility apply before previews as well as finals');
        emit(n('policy'), 'lina-safety-evaluate', 'policy', 'review', 'Review exact content digest, account and destination');
        emit('lina-safety-evaluate', 'lina-safety-authorize', 'policy', 'evaluated', 'Exact disclosure policy result forwarded to bounded authorization');
        emit('lina-safety-authorize', n('policy'), 'policy', scenario === 'policy-denied' || scenario === 'proactive-ineligible' && kind === 'notice' ? 'denied' : 'admitted', 'Fixture policy returns exact disclosure/eligibility decision; authentication grants none');
        if (scenario === 'policy-denied' || scenario === 'proactive-ineligible' && kind === 'notice') {
            emit(n('policy'), n('settle'), 'settle', 'rejected', scenario === 'policy-denied' ? 'Public disclosure refused before any exposure' : 'Proactive free-form eligibility unavailable; no silent template substitution');
            return;
        }
        if (scenario === 'permission-wait') {
            const id = `output-policy:${outputId}`, answer = options.answers?.[id];
            if (!answer) {
                emit(n('policy'), 'lina-execution-wait', 'policy', 'waiting', 'Output permission waits before any transport effect', undefined, { id, wait: { id, kind: 'output-policy', owner: 'output', deliveryId: outputId, ownerNodeId: n('policy') } });
                return;
            }
            emit('lina-execution-wait', n('policy'), 'policy', answer === 'deny' ? 'denied' : 'allowed', 'Matched disclosure decision rechecked', undefined, { id, resumeWait: true });
            if (answer === 'deny' || answer === 'expire') {
                emit(n('policy'), n('settle'), 'settle', 'rejected', 'Permission refused; no message sent');
                return;
            }
        }
        emit(n('policy'), n('render'), 'render', 'prepared', 'Prepare native ordered parts while retaining original typed content and four prompt choices');
        if (scenario === 'invalid-structured') {
            emit(n('render'), n('settle'), 'settle', 'invalid', 'Null answer fails the required numeric result schema; malformed data never becomes text success');
            return;
        }
        const payloads = renderOutputFixture(content, store.channel, config), targets = ['fanout', 'fanout-partial'].includes(scenario) ? ['recipient-1', 'recipient-2'] : ['recipient-1'];
        if (content.kind === 'media') {
            emit(n('render'), n('media'), 'media', 'requested', 'Resolve retained artifact identity/digest/access before upload');
            emit(n('media'), 'lina-environment-artifacts', 'media', 'custody-request', 'Bytes are addressed by retained artifact identity, not a workspace path');
            emit('lina-environment-artifacts', n('media'), 'media', 'custody-return', 'Original artifact requester receives access/custody metadata');
            const artifact = store.artifacts[content.artifacts![0]];
            if (artifact.access === 'denied' || !artifact.bytes) {
                emit(n('media'), n('settle'), 'settle', 'failed', 'Artifact access denied or bytes unavailable; no fabricated handle');
                return;
            }
            const reusable = artifact.handle && artifact.handle.accountId === accountId && artifact.handle.digest === artifact.digest && artifact.handle.expires > store.clock;
            if (!reusable) {
                if (artifact.handle)
                    emit(n('media'), 'lina-environment-artifacts', 'media', 'expired-handle', 'Account/digest/expiry mismatch prevents native handle reuse; retained bytes permit admitted refresh');
                artifact.custody = 'output';
                artifact.uploadAttempt = { id: `upload:${artifact.id}:${accountId}:${artifact.digest}`, accountId, digest: artifact.digest, sendStarted: false, outcome: 'started' };
                persist('media', 'record');
                artifact.uploadAttempt.sendStarted = true;
                if (scenario === 'upload-unknown') {
                    artifact.upload = 'unknown';
                    artifact.uploadAttempt.outcome = 'unknown';
                    emit(n('media'), n('reconcile'), 'reconcile', 'upload-unknown', 'Original upload may have happened; retain bytes and exact upload identity');
                    persist('media', 'load');
                    const id = `output-upload:${artifact.id}`, answer = options.answers?.[id];
                    if (!['known-success', 'known-no-effect'].includes(answer ?? '')) {
                        emit(n('reconcile'), 'lina-execution-wait', 'reconcile', 'waiting', 'Inspect original upload; no automatic replacement permitted', undefined, { id, wait: { id, kind: 'output-reconciliation', owner: 'output', deliveryId: artifact.uploadAttempt.id, ownerNodeId: n('reconcile') } });
                        return;
                    }
                    emit('lina-execution-wait', n('reconcile'), 'reconcile', answer === 'known-success' ? 'upload-found' : 'upload-unsent', 'Matched upload evidence resolves original account/digest/custody', undefined, { id, resumeWait: true });
                    if (answer === 'known-no-effect') {
                        artifact.uploadAttempt.outcome = 'unsent';
                        persist('media', 'record');
                    }
                }
                artifact.uploadAttempt.outcome = 'ready';
                artifact.upload = 'ready';
                artifact.handle = { id: `native:${artifact.uploadAttempt.id}`, accountId, digest: artifact.digest, expires: store.clock + 100 };
                persist('media', 'record');
            }
        }
        const prepared: OutputObligation[] = [];
        for (const target of targets) {
            const id = `delivery:${outputId}:${target}`, obligation: OutputObligation = { id, outputId, recipient: { accountId, target: `${store.channel}:${target}`, thread: `${store.channel}:thread-fixture`, incarnation: 1 }, lane: `${accountId}/${target}/${store.channel}:thread-fixture`, generation: store.ownerFence, required: intent.required, threshold: intent.required ? config.threshold : 'accepted', receiptCapabilities: { delivery: store.channel === 'whatsapp', read: store.channel === 'whatsapp' }, custody: 'unregistered', parts: payloads.map((payload, index) => ({ id: `${id}:part:${index + 1}`, index, revision: 1, payload, digest: digest(payload), status: 'prepared', attemptIds: [] })), status: 'prepared', deadline: 100, retentionOwner: 'output', duplicateRisk: false };
            if (scenario === 'preview-promote' && obligation.required) {
                const preview = Object.values(store.obligations).find(row => !row.required && row.status === 'accepted' && row.recipient.target === obligation.recipient.target)?.parts[0];
                if (preview?.providerId)
                    for (const part of obligation.parts) {
                        part.providerId = preview.providerId;
                        part.revision = 2;
                        part.payload = { ...part.payload, operation: 'edit-promote', nativeMessageId: preview.providerId, revision: 2 };
                        part.digest = digest(part.payload);
                    }
            }
            const preparation = content.kind === 'media' ? 'media' : kind === 'preview' ? 'stream' : 'render';
            if (kind === 'preview') {
                store.streams[outputId] = { revision: 1, sealed: false, coalesced: 0 };
                if (scenario === 'coalesced-progress') {
                    store.streams[outputId].revision = 4;
                    store.streams[outputId].coalesced = 3;
                    for (const part of obligation.parts) {
                        part.revision = 4;
                        part.payload = { ...part.payload, revision: 4, latestOnly: true };
                        part.digest = digest(part.payload);
                    }
                }
                emit(n('render'), n('stream'), 'stream', 'prepared', 'Coalesced preview revision is best effort and cannot satisfy owed final');
            }
            emit(n(preparation), n('register'), 'register', 'requested', 'Register prepared obligation and exact bytes before native dispatch', obligation);
            if (scenario === 'storage-failure') {
                emit(n('register'), n('settle'), 'settle', 'failed', 'Required storage failure cannot silently downgrade custody');
                return;
            }
            if (scenario === 'crash-before-admission') {
                recoverOutputFixture(store, 'before-admission');
                emit('lina-state-recover', n('reconcile'), 'reconcile', 'producer-restored', 'Saved producer output restored; no delivery or send-start existed', obligation);
                persist('register', 'load', obligation);
            }
            const registered = registerOutputFixture(store, obligation), retained = store.obligations[id];
            persist('register', 'record', retained);
            if (scenario === 'registration-lost-ack') {
                persist('register', 'load', retained);
                emit(n('register'), n('schedule'), 'register', registerOutputFixture(store, clone(obligation)), 'Inspect original registration identity; duplicate receipt retains prepared bytes', retained);
            }
            if (scenario === 'crash-after-admission') {
                recoverOutputFixture(store, 'after-admission');
                emit('lina-state-recover', n('reconcile'), 'reconcile', 'custody-restored', 'Same registered prepared bytes restored; no transport attempt replayed', retained);
                persist('register', 'load', retained);
            }
            prepared.push(retained);
        }
        if (kind === 'final' && owner === 'main' && !released && prepared.length === targets.length) {
            emit(n('register'), 'lina-execution-release', 'register', 'custody-transferred', 'All required recipient obligations now belong to retained Output owner; execution need not wait for native acceptance/read', prepared[0]);
            released = true;
        }
        for (const retained of prepared) {
            dispatch(retained);
            if (kind === 'preview') {
                const stream = store.streams[outputId];
                stream.providerId = retained.parts[0]?.providerId;
                if (scenario === 'stale-preview') {
                    const attemptedRevision = 0;
                    emit(n('observe'), n('stream'), 'stream', 'stale', 'Older preview revision rejected before editing accepted native message', retained);
                    emit(n('stream'), n('settle'), 'stream', 'ignored', `Revision ${attemptedRevision} cannot overwrite current ${stream.revision}`, retained);
                }
                if (scenario === 'stop-preview') {
                    store.stopped = true;
                    stream.sealed = true;
                    emit('lina-execution-cancel', n('stream'), 'stream', 'sealed', 'Stop prevents final/new preview sends; accepted draft remains exposed', retained);
                }
            }
        }
        if (kind === 'prompt') {
            const edge = document.edges.find(edge => edge.source === n('settle') && edge.target === promptReturnNode);
            out.push({ id: promptAnchor ?? `output:prompt:${outputId}`, nodeId: promptReturnNode, sourceNodeId: n('settle'), edgeId: edge?.id, update: { detail: 'Prompt obligation accepted; Input still owns matched answers' }, waits: originalWaits ?? [], wait: originalWaits?.[0], outputSnapshot: clone(store) });
        }
    }
    if (options.stopped) {
        store.stopped = true;
        for (const stream of Object.values(store.streams))
            stream.sealed = true;
        emit('lina-execution-cancel', n('stream'), 'stream', 'sealed', 'Stop invalidates preview/prompt controls; accepted exposure is retained');
        for (const obligation of Object.values(store.obligations)) {
            for (const part of obligation.parts) {
                if (part.status === 'prepared')
                    part.status = 'cancelled';
                else if (part.status === 'started')
                    part.status = 'unknown';
            }
            if (obligation.parts.some(part => part.status === 'unknown' || part.status === 'started')) {
                emit('lina-execution-cancel', n('schedule'), 'schedule', 'withheld', 'Stop prevents new sends but cannot retract uncertain effects', obligation);
                settle(obligation, n('schedule'), 'Original uncertain send remains visible after Stop');
            }
            else
                settle(obligation, n('schedule'), 'Unsent work cancelled; accepted messages retained');
        }
        return [...out, ...base];
    }
    for (const event of base) {
        if (released && event.nodeId === 'lina-execution-release' && (!event.agentId || event.agentId === 'main'))
            continue;
        const external = !event.agentId || event.agentId === 'main';
        if (external && event.nodeId === 'lina-tools-dispatch' && !toolPublished && ['tool-dedupe', 'distinct-tool-content'].includes(scenario)) {
            out.push(event);
            toolPublished = true;
            produce(event.nodeId, scenario === 'tool-dedupe' ? plannedText : 'Distinct admitted tool notification', 'notice');
            const obligation = Object.values(store.obligations).at(-1);
            emit(n('settle'), 'lina-tools-collect', 'settle', 'tool-message-result', 'Return exact admitted native messaging call observation', obligation, { operations: [{ callId: 'call:fixture-native-message', batchId: 'batch:output-native', attemptId: 'attempt:output-native', nodeId: 'lina-tools-collect', status: obligation?.status === 'accepted' ? 'success' : 'error', effectClass: 'write', accountId: `account-fixture:${store.channel}`, catalogRevision: 7 }], results: [{ callId: 'call:fixture-native-message', status: obligation?.status === 'accepted' ? 'success' : 'error', artifactRef: `artifact:${obligation?.id}:receipt` }] });
            continue;
        }
        if (external && event.nodeId === 'lina-execution-settle' && !noticePublished && ['proactive', 'proactive-ineligible'].includes(scenario)) {
            out.push(event);
            noticePublished = true;
            produce(event.nodeId, 'Admitted scheduled fixture notification', 'notice');
            continue;
        }
        if (event.nodeId === 'lina-subagents-return' && !internalPublished && ['internal', 'child-announcement'].includes(scenario) && event.subagentEvidence?.outcome === 'success') {
            out.push(event);
            internalPublished = true;
            produce(event.nodeId, 'Retained child result artifact', 'notice', event.agentId ?? 'main', undefined, scenario === 'internal' ? 'internal' : 'external');
            continue;
        }
        if (external && event.modelRequest)
            protocol = event.modelRequest.binding.protocol;
        if (external && event.update.outcome)
            turnStatus = event.update.outcome;
        if (external && event.modelEvent) {
            if (event.modelEvent.type === 'launch')
                model = createModelFixtureState(event.modelEvent.attemptId, protocol);
            if (model)
                model = applyModelFixtureEvent(model, event.modelEvent);
        }
        if (external && event.modelEvent?.type === 'text-delta' && config.streaming === 'preview' && !previewed) {
            out.push(event);
            previewed = true;
            produce('lina-model-invoke', event.modelEvent.text, 'preview');
            continue;
        }
        if (store.stopped && external && event.nodeId === 'lina-input-delivery') {
            out.push({ ...event, update: { ...event.update, detail: 'Stopped stream retains accepted draft; owed final explicitly cancelled' } });
            continue;
        }
        if (external && scenario === 'clarification' && event.nodeId === 'lina-execution-wait' && event.sourceNodeId === 'lina-tools-collect') {
            const waits = event.waits ?? (event.wait ? [event.wait] : []), op = event.operations?.[0], identity = op ? { id: `wait:input:${op.callId}`, kind: 'input' as const, callId: op.callId, batchId: op.batchId, ownerNodeId: 'lina-tools-collect' } : undefined;
            out.push({ ...event, id: `${event.id}:output-handoff`, wait: undefined, waits: [] });
            produce(event.nodeId, 'Provide the requested tool input', 'prompt', 'main', waits, 'external', event.id, identity, 'lina-execution-wait');
            continue;
        }
        if (external && event.nodeId === 'lina-input-delivery' && (!event.sourceNodeId?.startsWith('lina-state-') || event.wait || event.waits?.length)) {
            const waits = event.waits ?? (event.wait ? [event.wait] : []), prompt = waits.length > 0 || event.sourceNodeId === 'lina-safety-approval';
            out.push({ ...event, id: prompt ? `${event.id}:output-handoff` : event.id, wait: undefined, waits: waits.length ? [] : event.waits });
            const text = waits.length ? 'Review exact requested action' : scenario === 'refusal' ? 'I cannot fulfill that request.' : scenario === 'failure' ? 'The turn failed.' : model?.outcome?.text || `Turn ${turnStatus}.`;
            const operation = event.operations?.[0], identity = operation ? { id: `wait:approval:${operation.callId}`, kind: 'approval' as const, callId: operation.callId, batchId: operation.batchId, ownerNodeId: 'lina-tools-permissions' } : undefined;
            produce(event.nodeId, text, prompt ? 'prompt' : 'final', 'main', waits, 'external', prompt ? event.id : undefined, identity);
            if (!prompt)
                finalized = true;
            continue;
        }
        if (external && event.nodeId === 'lina-execution-release' && !finalized && !store.stopped && !base.some(previous => previous.nodeId === 'lina-input-delivery')) {
            produce('lina-execution-settle', model?.outcome?.text || `Turn ${turnStatus}.`);
            finalized = true;
            if (released)
                continue;
        }
        out.push(event);
    }
    return [...out, ...deferred.map(event => ({ ...event, outputSnapshot: clone(store) }))];
}
