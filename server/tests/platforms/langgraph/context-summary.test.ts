import assert from "node:assert/strict";
import test from "node:test";

import type { ContextSummaryRequest } from "../../../src/capabilities/context/index.js";
import {
  createLangGraphContextSummaryGenerator,
  LangGraphContextSummaryError,
} from "../../../src/platforms/langgraph/runner-adapter/context-summary.js";

const request: ContextSummaryRequest = {
  sessionId: "session-summary-test",
  sourceRevision: 4,
  messages: [
    {
      schemaVersion: 1,
      messageId: "message-1",
      sessionId: "session-summary-test",
      sequence: 1,
      role: "user",
      content: "Remember the deployment code is 4318.",
      source: "transcript",
      createdAt: "2026-09-20T10:00:00.000Z",
    },
    {
      schemaVersion: 1,
      messageId: "message-2",
      sessionId: "session-summary-test",
      sequence: 2,
      role: "assistant",
      content: "I will retain deployment code 4318.",
      source: "transcript",
      createdAt: "2026-09-20T10:00:01.000Z",
    },
  ],
};

test("fake LangGraph context summaries are deterministic and preserve earlier facts", async () => {
  const summarize = createLangGraphContextSummaryGenerator({ provider: "fake", model: "fake-context" });
  const result = await summarize.summarize(request);

  assert.match(result, /Earlier context:/);
  assert.match(result, /4318/);
  assert.equal(result, await summarize.summarize(request));
});

test("OpenRouter context summaries use the selected model and hide provider response details", async () => {
  let receivedBody: Record<string, unknown> | null = null;
  const summarize = createLangGraphContextSummaryGenerator({
    provider: "openrouter",
    model: "openai/gpt-4o-mini",
    apiKey: "test-key",
    baseUrl: "https://router.test/v1",
    fetchImplementation: async (_input, init) => {
      receivedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ choices: [{ message: { content: "Deployment code 4318 is retained." } }] }), { status: 200 });
    },
  });

  assert.equal(await summarize.summarize(request), "Deployment code 4318 is retained.");
  assert.ok(receivedBody);
  const body = receivedBody as Record<string, unknown>;
  assert.equal(body.model, "openai/gpt-4o-mini");
  assert.equal((body.messages as Array<Record<string, unknown>>).length, 2);
});

test("OpenRouter context summaries fail clearly when credentials are missing", async () => {
  const summarize = createLangGraphContextSummaryGenerator({ provider: "openrouter", model: "openai/gpt-4o-mini" });

  await assert.rejects(
    summarize.summarize(request),
    (error: unknown) => error instanceof LangGraphContextSummaryError
      && error.code === "OPENROUTER_API_KEY_MISSING"
      && !error.message.includes("undefined"),
  );
});

test("OpenRouter context summaries do not expose upstream error bodies", async () => {
  const summarize = createLangGraphContextSummaryGenerator({
    provider: "openrouter",
    model: "openai/gpt-4o-mini",
    apiKey: "test-key",
    fetchImplementation: async () => new Response("private provider diagnostic", { status: 401 }),
  });

  await assert.rejects(
    summarize.summarize(request),
    (error: unknown) => error instanceof LangGraphContextSummaryError
      && error.code === "OPENROUTER_SUMMARY_HTTP_ERROR"
      && !error.message.includes("private provider diagnostic"),
  );
});
