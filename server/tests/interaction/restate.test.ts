import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baselineWorkflow } from "../../src/platforms/restate/variants/baseline/workflow.js";
import { taskInteractionContribution } from "../../src/capabilities/interaction/tools.js";
import { TaskInteractionStore } from "../../src/capabilities/interaction/store.js";
import type { RestateWorkflowInput } from "../../src/platforms/restate/variants/baseline/contracts.js";
import type { TaskInputResume, TaskQuestion } from "../../src/capabilities/interaction/contracts.js";

const handlers = (baselineWorkflow as unknown as {workflow: {run(ctx: unknown, input: RestateWorkflowInput): Promise<any>; taskInput(ctx: unknown, input: TaskInputResume): Promise<{accepted: boolean}>}}).workflow;

for (const mode of ["reply", "steering"] as const) test(`Restate clarification ${mode} retains identity and replays without hosted execution`, async () => {
  const root = await mkdtemp(join(tmpdir(), "restate-question-"));
  const savedFetch = globalThis.fetch;
  const savedKey = process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE;
  const savedModelKey = process.env.OPENROUTER_API_KEY;
  const state = new Map<string, unknown>();
  const store = new TaskInteractionStore(root);
  const journal = new Map<string, unknown>();
  const waits = new Map<string, {promise: Promise<any>; value: any; resolve: (value: any) => void}>();
  let modelRequests = 0;
  let wakeResult: Promise<{accepted: boolean}> | null = null;
  const ctx = {
    date: {toJSON: async () => new Date().toISOString()},
    request: () => ({id: "native-invocation", attemptCompletedSignal: new AbortController().signal}),
    get: async (key: string) => state.get(key) ?? null,
    clear: (key: string) => state.delete(key),
    set: (key: string, value: unknown) => {
      state.set(key, value);
      if (key === "pendingQuestion" && !wakeResult) {
        const question = value as TaskQuestion;
        wakeResult = store.accept({runId: "run", turnId: "turn", inputId: "reply-1", kind: mode === "reply" ? "clarification_reply" : "steering", ...(mode === "reply" ? {questionId: question.questionId} : {}), content: "Research notes only."})
          .then(reply => handlers.taskInput(ctx, {kind: "task_input", runId: reply.runId, turnId: reply.turnId, inputId: reply.inputId, sequence: reply.sequence, inputKind: reply.kind, questionId: reply.questionId}));
      }
    },
    run: async (name: string, action: () => Promise<unknown>) => {
      if (journal.has(name)) return journal.get(name);
      const value = await action(); journal.set(name, value); return value;
    },
    promise: (name: string) => {
      let wait = waits.get(name);
      if (!wait) {
        let resolve!: (value: unknown) => void;
        const promise = new Promise(value => {resolve = value;});
        wait = {promise, value: null, resolve}; waits.set(name, wait);
      }
      const value = wait;
      return {peek: async () => value.value, resolve: async (input: unknown) => {value.value = input; value.resolve(input);}, then: value.promise.then.bind(value.promise), get: () => value.promise};
    },
  };
  try {
    const key = join(root, "key"); await writeFile(key, "a".repeat(64));
    process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE = key;
    process.env.OPENROUTER_API_KEY = "fake-test-key";
    globalThis.fetch = (async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).includes("/internal/interaction/boundary")) return Response.json(await store.consume(body.runId, body.turnId, body.boundaryId));
      if (String(url).includes("/internal/interaction/question")) return Response.json(await store.question(body));
      if (String(url).includes("/internal/interaction/answer")) return Response.json(await store.answer(body.runId, body.turnId, body.questionId));
      assert.ok(String(url).endsWith("/chat/completions"));
      modelRequests += 1;
      if (modelRequests === 1) return Response.json({id: "model-1", choices: [{message: {content: null, tool_calls: [{id: "question-call", type: "function", function: {name: "ask_user", arguments: JSON.stringify({question: "Which notes should I review?"})}}]}}], usage: {prompt_tokens: 10, completion_tokens: 5, total_tokens: 15}});
      if (mode === "reply") assert.ok(body.messages.some((message: any) => message.role === "tool" && JSON.parse(message.content).answer === "Research notes only."));
      else {
        const toolIndex = body.messages.findIndex((message: any) => message.role === "tool" && JSON.parse(message.content).code === "TASK_INPUT_SUPERSEDED");
        const userIndex = body.messages.findIndex((message: any) => message.role === "user" && message.content.startsWith("[Live task instruction"));
        assert.ok(toolIndex >= 0 && userIndex > toolIndex, "steering follows completed tool-call protocol messages");
      }
      return Response.json({id: "model-2", choices: [{message: {content: "I will review research notes only."}}], usage: {prompt_tokens: 10, completion_tokens: 5, total_tokens: 15}});
    }) as typeof fetch;
    const input: RestateWorkflowInput = {runId: "run", turnId: "turn", prompt: "Review my notes.", systemInstruction: "Ask if information is missing.", model: {provider: "openrouter", model: "test-model"}, tools: {enabledNames: ["ask_user"], maxRounds: 4, maxCalls: 4}, toolCatalog: {schemaVersion: 1, revision: "a".repeat(64), tools: [taskInteractionContribution().descriptor]}};
    const result = await handlers.run(ctx, input);
    assert.equal(result.status, "completed");
    assert.equal((await (wakeResult as Promise<{accepted: boolean}> | null))?.accepted, true);
    assert.equal(modelRequests, 2);
    assert.equal(result.eventIntents.filter((event: any) => event.kind === "WorkflowSuspended" && event.payload.reason === "clarification").length, 1);
    assert.equal(result.eventIntents.filter((event: any) => event.kind === "TaskInputConsumed").length, 1);
    assert.equal((await store.read("run")).questions[0]?.status, mode === "reply" ? "answered" : "cancelled");
    const replay = await handlers.run(ctx, input);
    assert.equal(replay.status, "completed");
    assert.equal(modelRequests, 2, "journaled model requests must not repeat on replay");
    assert.equal((await store.read("run")).inputs.length, 1);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE; else process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE = savedKey;
    if (savedModelKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = savedModelKey;
    await rm(root, {recursive: true, force: true});
  }
});
