import assert from "node:assert/strict";
import test from "node:test";

import type { ContextMessage } from "../../../src/capabilities/context/index.js";
import { buildRunManifest } from "../../../src/control-plane/domain/manifest.js";
import type { RunManifest } from "../../../src/control-plane/domain/types.js";
import {
  createMastraContextSummaryGenerator,
  MastraContextSummaryError,
} from "../../../src/platforms/mastra/runner-adapter/context-summary.js";
import { MastraBaselineRunner } from "../../../src/platforms/mastra/runner-adapter/mastra-runner.js";
import { createDeterministicFakeModel } from "../../../src/platforms/mastra/variants/baseline/models/fake.js";

test("Mastra fake context summarizer is deterministic and bounded", async () => {
  const manifest = manifestFor("fake", "fake-context");
  const generator = createMastraContextSummaryGenerator({
    manifest,
    modelFactory: () => createDeterministicFakeModel({ modelId: "unused" }),
    signal: new AbortController().signal,
  });

  const summary = await generator.summarize({
    sessionId: "summary-session",
    sourceRevision: 4,
    messages: [
      message("user", "Remember the project constraint."),
      message("assistant", "The constraint is no Docker for local acceptance."),
    ],
  });

  assert.equal(summary, "Earlier context:\n[user]\nRemember the project constraint.\n\n[assistant]\nThe constraint is no Docker for local acceptance.");
});

test("Mastra provider context summarizer uses a native Agent call", async () => {
  const manifest = manifestFor("openrouter", "openai/gpt-4o-mini");
  let selectedModel: string | null = null;
  const generator = createMastraContextSummaryGenerator({
    manifest,
    modelFactory: (selectedManifest) => {
      selectedModel = selectedManifest.model.model;
      return createDeterministicFakeModel({
        modelId: selectedManifest.model.model,
        responseText: "Native Mastra summary.",
      });
    },
    signal: new AbortController().signal,
  });

  const summary = await generator.summarize({
    sessionId: "summary-session",
    sourceRevision: 5,
    messages: [message("user", "Earlier request.")],
  });

  assert.equal(summary, "Native Mastra summary.");
  assert.equal(selectedModel, "openai/gpt-4o-mini");
});

test("Mastra context summarizer rejects an empty deterministic context", async () => {
  const generator = createMastraContextSummaryGenerator({
    manifest: manifestFor("fake", "fake-context"),
    modelFactory: () => createDeterministicFakeModel({ modelId: "unused" }),
    signal: new AbortController().signal,
  });

  await assert.rejects(
    generator.summarize({
      sessionId: "summary-session",
      sourceRevision: 1,
      messages: [],
    }),
    (error: unknown) => error instanceof MastraContextSummaryError && error.code === "SUMMARY_EMPTY",
  );
});

function manifestFor(provider: "fake" | "openrouter", model: string): RunManifest {
  const runner = new MastraBaselineRunner({ environment: { OPENROUTER_API_KEY: "test-key" } });
  return buildRunManifest(
    {
      platform: "mastra",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Summarize the conversation." },
      model: { provider, model },
    },
    { runId: "mastra-context-summary-test", platformConfig: runner.manifestConfiguration() },
  );
}

function message(role: "user" | "assistant", content: string): ContextMessage {
  return {
    schemaVersion: 1 as const,
    messageId: role + "-message",
    sessionId: "summary-session",
    sequence: role === "user" ? 1 : 2,
    role,
    content,
    source: "transcript",
    createdAt: "2026-09-20T00:00:00.000Z",
  };
}
