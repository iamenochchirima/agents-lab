/** Prove delivery of a skill resource to a later model request. Native tool-role
 * messages are authoritative; internal context headings are not a shared contract.
 * A matching call ID alone is insufficient: content and non-authoritative trust
 * metadata must match the completed receipt exactly.
 */
export function skillResourceDelivered(
  events: readonly { kind: string; recordedSequence?: number | null; payload: Record<string, unknown> }[],
  receipt: { toolCallId: string; sequence: number | null; result?: { status: string }; output: Record<string, unknown> } | undefined,
): boolean {
  if (!receipt || receipt.result?.status !== 'completed' || receipt.sequence === null) return false;
  const expected = receipt.output;
  if (expected.packageId !== 'notes-check-skills' || expected.name !== 'notes-check' || expected.path !== 'references/procedure.md' || expected.trust !== 'untrusted' || expected.authority !== 'none' || expected.encoding !== 'utf8' || typeof expected.digest !== 'string' || typeof expected.content !== 'string') return false;
  return events.some(event => {
    if (event.kind !== 'EvalModelObserved' || typeof event.recordedSequence !== 'number' || event.recordedSequence <= receipt.sequence!) return false;
    const observation = event.payload.observation;
    if (!object(observation) || !object(observation.providerRequest) || !Array.isArray(observation.providerRequest.messages)) return false;
    return observation.providerRequest.messages.some(message => {
      if (!object(message) || message.role !== 'tool' || message.tool_call_id !== receipt.toolCallId || typeof message.content !== 'string') return false;
      try {
        const actual: unknown = JSON.parse(message.content);
        return object(actual) && ['packageId', 'name', 'path', 'digest', 'content', 'trust', 'authority', 'encoding'].every(key => actual[key] === expected[key]);
      } catch { return false; }
    });
  });
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
