/** Direct provider smoke check. Creates and deletes only its unique private memo.
 * Does not execute a model or establish native-platform agent correctness.
 * Writes are never retried; lost acknowledgements leave evidence for inspection.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HttpMcpServer } from '../src/capabilities/integrations/mcp/http-server.js';
const authorization = process.env.AGENTLAB_MEMOS_AUTHORIZATION;
if (!authorization) throw new Error('Set AGENTLAB_MEMOS_AUTHORIZATION to a dedicated Memos test account bearer token.');
const endpoint = process.env.AGENTLAB_MEMOS_ENDPOINT ?? 'http://127.0.0.1:5230/mcp';
const id = `lab-${randomUUID().slice(0, 30)}`;
const evidenceDir = resolve(process.env.AGENTLAB_MEMOS_CHECK_ROOT ?? '../lab/runs', `memos-check-${id}`);
await mkdir(evidenceDir, { recursive: true });
const evidence: Record<string, unknown> = { endpoint, memoId: id, startedAt: new Date().toISOString(), model: null, checks: [] };
const checks = evidence.checks as string[];
const client = new HttpMcpServer({ endpoint, protocolVersion: '2026-07-28', headers: { Authorization: authorization } });
async function call(name: string, args: Record<string, unknown>) {
  const { output } = await client.callTool(name, args, randomUUID(), AbortSignal.timeout(15_000));
  return output;
}
try {
  const tools = await client.listTools(AbortSignal.timeout(15_000));
  for (const name of ['memo_list_memos', 'memo_create_memo', 'memo_get_memo', 'memo_update_memo', 'memo_delete_memo']) assert(tools.some(t => t.name === name), `Missing ${name}`);
  checks.push('discovery');
  const original = `# Disposable Lab CRUD check ${id}\nOwner: Alex\nMeeting: 10:00\n#lab-crud-check`;
  const created = await call('memo_create_memo', { memoId: id, body: { content: original, visibility: 'PRIVATE' } });
  assert.equal(created.name, `memos/${id}`);
  evidence.memoName = created.name;
  checks.push('create');
  const read = await call('memo_get_memo', { memo: id });
  assert.equal(read.content, original); assert.equal(read.visibility, 'PRIVATE');
  checks.push('read');
  const changed = original.replace('Meeting: 10:00', 'Meeting: 14:00');
  await call('memo_update_memo', { memo: id, body: { content: changed }, updateMask: 'content' });
  const updated = await call('memo_get_memo', { memo: id });
  assert.equal(updated.content, changed); assert.equal(updated.visibility, 'PRIVATE');
  checks.push('update-readback');
  const listed = await call('memo_list_memos', { filter: `content.contains("${id}")`, pageSize: 10 });
  assert(Array.isArray(listed.memos) && listed.memos.some(m => m.name === `memos/${id}`));
  checks.push('filtered-list');
  await call('memo_delete_memo', { memo: id });
  const after = await call('memo_list_memos', { filter: `content.contains("${id}")`, pageSize: 10 });
  assert(!Array.isArray(after.memos) || after.memos.every(m => m.name !== `memos/${id}`));
  const absent = await client.callToolResult('memo_get_memo', { memo: id }, randomUUID(), AbortSignal.timeout(15_000));
  assert.equal(absent.isError, true);
  assert(JSON.stringify(absent.content).includes('404'), 'Deleted memo should return provider 404');
  checks.push('delete-absence'); evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  // Do not record raw error/response bodies that could contain provider credentials.
  evidence.error = error instanceof Error ? error.name : 'UnknownError';
  throw error;
} finally {
  evidence.completedAt = new Date().toISOString();
  await writeFile(resolve(evidenceDir, 'result.json'), JSON.stringify(evidence, null, 2));
  await client.close();
  console.log(JSON.stringify({ status: evidence.status, checks, evidenceDir, memoId: id }));
}
