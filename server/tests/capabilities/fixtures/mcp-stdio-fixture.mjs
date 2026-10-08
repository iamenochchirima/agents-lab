import { createInterface } from 'node:readline';
const lines = createInterface({ input: process.stdin });
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
let initialized = false;
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.method === 'initialize') reply(request.id, { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } });
  else if (request.method === 'notifications/initialized') initialized = true;
  else if (request.method === 'tools/list') reply(request.id, { tools: [{ name: 'fixture_echo', description: 'Echo isolated test input.', inputSchema: { type: 'object', properties: {} } }] });
  else if (request.method === 'tools/call') {
    const args = request.params.arguments;
    if (args.crash) process.exit(3);
    else if (args.hang) { /* Deliberately lose acknowledgement. */ }
    else if (args.malformed) process.stdout.write('broken\n');
    else if (args.large) process.stdout.write('x'.repeat(10_000) + '\n');
    else {
      process.stderr.write('secret=' + process.env.MCP_TEST_SECRET + '\n');
      reply(request.id, { content: [{ type: 'text', text: JSON.stringify({ initialized, value: args.value, inherited: process.env.MCP_UNRELATED_SECRET ?? null, explicit: process.env.MCP_TEST_SECRET === 'fixture-credential' }) }] });
    }
  }
}
