/** Deterministic design fixtures only: no policy service, durable storage or security enforcement. */
export type SafetyCase = 'policy-allow' | 'review' | 'parallel-review' | 'hard-deny' | 'mandatory-review' | 'grant-reuse' | 'session-end' | 'revoked' | 'binding-change' | 'policy-change' | 'persistence-failed' | 'persistence-unknown';
export type SafetyChoice = 'allow-once' | 'allow-session' | 'allow-always' | 'deny';
export interface SafetyGrant {
  id: string;
  lifetime: 'once' | 'session' | 'persistent';
  sessionId: string;
  operationId?: string;
  matcher: { agentId: string; workspaceId: string; accountId: string; action: string; target: string; argumentDigest: string; catalogRevision: number };
  policyRevision: number;
  generation: number;
  status: 'active' | 'consumed' | 'revoked' | 'expired';
  storage: 'fixture-only';
}
export interface SafetyEvidence { operationId: string; phase: 'policy' | 'evaluate' | 'lookup' | 'approval' | 'commit' | 'inspect' | 'admission' | 'dispatch' | 'consume' | 'revoke' | 'session-end'; decision?: 'allow' | 'deny' | 'ask' | 'unknown'; reason: string; grantId?: string; transactionId?: string; argumentDigest: string; policyRevision: number }
export const safetyCases: { value: SafetyCase; label: string }[] = [
  ['policy-allow','Policy allows'],['review','Review one operation'],['parallel-review','Two independent approvals'],['hard-deny','Policy denies'],['mandatory-review','Mandatory review overrides grant'],['grant-reuse','Reuse matching grant'],['session-end','Session ended'],['revoked','Grant revoked'],['binding-change','Binding changes while queued'],['policy-change','Policy changes while queued'],['persistence-failed','Saving grant fails'],['persistence-unknown','Saving grant needs inspection'],
].map(([value,label])=>({value:value as SafetyCase,label}));
export function safetyMatcher(accountId='account-demo', catalogRevision=7, action='tool.invoke') {
  return {agentId:'lina',workspaceId:'workspace-demo',accountId,action,target:action==='tool.invoke'?'fixture-calculator':'fixture-source',argumentDigest:'fixture-digest:reviewed-arguments',catalogRevision};
}
export function matchingSafetyGrant(grants: SafetyGrant[], matcher: SafetyGrant['matcher'], operationId: string): SafetyGrant | undefined {
  return grants.find(grant=>grant.status==='active' && grant.policyRevision===1 && (grant.lifetime!=='once'||grant.operationId===operationId) && grant.sessionId==='fixture-session-1' && JSON.stringify(grant.matcher)===JSON.stringify(matcher));
}
