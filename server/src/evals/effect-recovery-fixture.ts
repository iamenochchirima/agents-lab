import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

/** Disposable external provider: keyed creates commit before deliberately losing
 * the first acknowledgement. Replay of identical key+content returns its receipt;
 * conflicting key reuse rejects. State is owned by the provider, not run evidence. */
export async function createEffectRecoveryFixture() {
  const tickets = new Map<string, { id: string; value: string }>();
  const attempts = new Map<string, number>();
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== "POST" || request.url !== "/tickets") { response.writeHead(404).end(); return; }
      let text = "";
      for await (const chunk of request) { text += chunk; if (text.length > 4096) { response.writeHead(413).end(); return; } }
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== "object" || !("key" in value) || !("value" in value) || typeof value.key !== "string" || typeof value.value !== "string") {
        response.writeHead(400).end(); return;
      }
      attempts.set(value.key, (attempts.get(value.key) ?? 0) + 1);
      const previous = tickets.get(value.key);
      if (previous && previous.value !== value.value) { response.writeHead(409).end(); return; }
      if (!previous) {
        tickets.set(value.key, { id: randomUUID(), value: value.value });
        // The external mutation is committed, but no response bytes are sent.
        request.socket.destroy(); return;
      }
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(previous));
    })().catch(() => response.writeHead(400).end());
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Effect fixture did not bind a TCP address.");
  return {
    endpoint: `http://127.0.0.1:${address.port}/tickets`,
    snapshot(key: string) { return { key, ticket: tickets.get(key) ?? null, effectCount: tickets.has(key) ? 1 : 0, attempts: attempts.get(key) ?? 0 }; },
    async create(key: string, value: string, signal?: AbortSignal) {
      const response = await fetch(`http://127.0.0.1:${address.port}/tickets`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, value }), signal: signal ?? AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Fixture create returned HTTP ${response.status}.`);
      return await response.json() as { id: string; value: string };
    },
    async close() { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
