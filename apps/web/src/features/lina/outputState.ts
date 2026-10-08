import { commitStateFixture, type StateFixtureState } from './stateFixtures';
import type { SimulationEvent, SimulationChannel } from './inputSimulation';
import type { OutputFixtureState } from './outputFixtures';
declare module './stateFixtures' {
    interface StateRestore {
        outputSnapshot?: OutputFixtureState;
    }
}
/** Outbox recovery is independent of an older execution checkpoint. Select the
 * exact channel ledger, never an arbitrary other account's stored output. */
export function restoreOutputState(state: StateFixtureState, channel: SimulationChannel): OutputFixtureState | undefined {
    const value = state.records[`output-ledger:${channel}`]?.payload as OutputFixtureState | undefined;
    if (!value || value.storage !== 'fixture-only' || value.channel !== channel)
        return;
    return structuredClone(value);
}
/** Output owns semantics; State supplies fixture custody and conditional writes.
 * A recovered turn overlays the latest outbox record without rewriting historical
 * checkpoints or treating a persistence receipt as transport acceptance. */
export function attachOutputState(events: SimulationEvent[], expectedChannel?: SimulationChannel): SimulationEvent[] {
    if (!events.some(event => event.outputSnapshot || event.stateRestore && event.stateSnapshot))
        return events;
    let journal: StateFixtureState | undefined, ledger: OutputFixtureState | undefined;
    return events.map(original => {
        const event = { ...original };
        if (event.outputSnapshot)
            ledger = event.outputSnapshot;
        if (event.stateSnapshot) {
            const next = structuredClone(event.stateSnapshot);
            if (journal) {
                for (const [id, row] of Object.entries(journal.records))
                    if (id.startsWith('output-ledger:'))
                        next.records[id] = row;
                for (const [id, row] of Object.entries(journal.transactions))
                    if (id.startsWith('output-state:'))
                        next.transactions[id] = row;
            }
            journal = next;
            const channel = expectedChannel ?? ledger?.channel;
            if (event.stateRestore && channel)
                ledger = restoreOutputState(journal, channel) ?? ledger;
        }
        if (ledger && event.nodeId === 'lina-state-record' && event.outputEvidence) {
            journal ??= { storage: 'fixture-only', ownerRevision: 1, records: {}, transactions: {}, checkpoints: [] };
            const recordId = `output-ledger:${ledger.channel}`, transactionId = `output-state:${event.id}`;
            const outcome = commitStateFixture(journal, transactionId, recordId, ledger);
            event.stateEvidence = { phase: 'commit', outcome, recordId, transactionId, ownerRevision: journal.ownerRevision, reason: 'Fixture State retains prepared Output obligations, attempts, observations and artifact custody' };
        }
        if (journal && ledger) {
            // Only a newly created checkpoint may include current Output state.
            if (event.nodeId === 'lina-state-checkpoint')
                for (const checkpoint of journal.checkpoints)
                    if (checkpoint.id === journal.checkpointRef) {
                        checkpoint.restore.outputSnapshot = structuredClone(ledger);
                        const record = journal.records[`output-ledger:${ledger.channel}`];
                        if (record)
                            checkpoint.recordRevisions[`output-ledger:${ledger.channel}`] = record.revision;
                    }
            if (event.stateRestore)
                event.stateRestore = { ...event.stateRestore, outputSnapshot: restoreOutputState(journal, ledger.channel) ?? structuredClone(ledger) };
            if (event.stateSnapshot || event.nodeId.startsWith('lina-state-') && event.outputEvidence)
                event.stateSnapshot = structuredClone(journal);
        }
        return event;
    });
}
