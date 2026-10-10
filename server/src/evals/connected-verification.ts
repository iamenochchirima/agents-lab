import { argumentDigest } from '../capabilities/reviews/store.js';

/** Verify the actual admitted call's arguments through its durable host receipt
 * fingerprint, then verify the structured provider result. A completed call with
 * the same name, or another record's successful result, is insufficient. */
export function matchesConnectedVerification(input: {
  receipt: any;
  catalogRevision: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  round: number;
  arguments: Record<string, unknown>;
  expectedState: Record<string, unknown>;
  resultStatus?: 'completed' | 'failed';
  sequence?: { actual: number; after?: number; before?: number };
}): boolean {
  const { receipt, sequence } = input;
  if (sequence && ((sequence.after !== undefined && sequence.actual <= sequence.after) || (sequence.before !== undefined && sequence.actual >= sequence.before))) return false;
  if (!receipt || receipt.status !== 'complete' || receipt.toolCallId !== input.toolCallId ||
      receipt.toolName !== input.toolName || receipt.catalogRevision !== input.catalogRevision || receipt.result?.status !== (input.resultStatus ?? 'completed')) return false;
  const expectedFingerprint = argumentDigest({ revision: input.catalogRevision, turnId: input.turnId,
    call: { toolCallId: input.toolCallId, name: input.toolName, arguments: input.arguments, round: input.round } });
  if (receipt.fingerprint !== expectedFingerprint) return false;
  const result = receipt.result.structuredContent;
  return result !== null && typeof result === 'object' && !Array.isArray(result) &&
    Object.entries(input.expectedState).every(([key, value]) => Object.hasOwn(result, key) && argumentDigest(result[key]) === argumentDigest(value));
}
