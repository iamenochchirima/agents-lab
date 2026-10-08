import { createServer } from "node:http";
import type { MastraModelConfig } from "@mastra/core/llm";
import { COMPACTION_CONSTRAINT, type CompactionReceipt } from "./compaction-contracts.js";

/** Loopback-only controlled provider. Never forwards a request or retains headers. */
export async function startCompactionProvider(options: { summaryDelayMs?: number } = {}) {
  const summaryDelayMs = options.summaryDelayMs ?? 0;
  if (!Number.isSafeInteger(summaryDelayMs) || summaryDelayMs < 0 || summaryDelayMs > 10000) throw new Error("Summary fixture delay must be between 0 and 10000ms.");
  const receipts: CompactionReceipt[] = [];
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== "/chat/completions") { response.writeHead(404).end(); return; }
      let raw = "";
      for await (const chunk of request) { raw += chunk.toString(); if (raw.length > 100_000) throw new Error("Fixture request too large."); }
      const body = JSON.parse(raw), messages = body.messages as { role: string; content: string }[];
      if (typeof body.model !== "string" || !body.model.startsWith("fixture/compaction-") || !Array.isArray(messages) || !messages.every(message => typeof message.content === "string")) throw new Error("Unexpected fixture request.");
      const kind: CompactionReceipt["kind"] = messages.some(message => message.role === "system" && message.content.startsWith("Summarize the earlier conversation")) ? "summary" : "answer";
      const joined = messages.map(message => message.content).join("\n");
      const output = kind === "summary" ? joined.includes(COMPACTION_CONSTRAINT) ? `Persistent constraints: ${COMPACTION_CONSTRAINT}.` : "No constraints found."
        : messages.at(-1)?.content.startsWith("Return only a JSON object") ? joined.includes(COMPACTION_CONSTRAINT) ? JSON.stringify({ colour: "violet", batch: 27, mode: "read-only" }) : JSON.stringify({ missing: true }) : "Stored.";
      const receivedAt = new Date().toISOString();
      if (kind === "summary" && summaryDelayMs) await new Promise(resolve => setTimeout(resolve, summaryDelayMs));
      receipts.push(Object.assign({ sequence: receipts.length + 1, model: body.model, messages, output, kind }, { receivedAt, respondedAt: new Date().toISOString(), delayMs: kind === "summary" ? summaryDelayMs : 0 }));
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ id: `fixture-${receipts.length}`, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: output }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    } catch { response.writeHead(400).end("Invalid controlled request."); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture address.");
  return { baseUrl: `http://127.0.0.1:${address.port}`, receipts, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

/** Mastra SDK model boundary using the same controlled HTTP fixture for summaries
 * and ordinary generation. This is deliberately outside live-model evaluation. */
export function compactionMastraModel(model: string, baseUrl: string): MastraModelConfig {
  return { specificationVersion: "v2", provider: "agentlab.compaction-fixture", modelId: model, supportedUrls: {},
    doGenerate: async (input: any) => {
      const messages = input.prompt.map((message: any) => ({ role: message.role, content: typeof message.content === "string" ? message.content : message.content.map((part: any) => part.text ?? "").join("") }));
      const response = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, messages }), signal: input.abortSignal });
      if (!response.ok) throw new Error("Controlled provider rejected request.");
      const body = await response.json() as any;
      return { content: [{ type: "text", text: body.choices[0].message.content }], finishReason: "stop", warnings: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    }, doStream: async () => { throw new Error("Controlled provider does not stream."); },
  } as unknown as MastraModelConfig;
}
