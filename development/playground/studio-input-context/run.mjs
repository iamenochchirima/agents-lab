import {
  createRunId,
  createSessionId,
  createTurnId,
} from "@agent-harness-lab/agent-protocol";
import { createContextAssembler, parseContextConfig } from "@agent-harness-lab/module-context";
import { createTextInputNormalizer } from "@agent-harness-lab/module-input";
import { createInMemorySession, parseMemoryConfig } from "@agent-harness-lab/module-memory";

const recordedAt = "2026-09-25T09:00:00.000Z";
const sessionId = createSessionId("studio-input-context-playground-session");
const scope = {
  runId: createRunId("studio-input-context-playground-run"),
  sessionId,
  turnId: createTurnId("studio-input-context-playground-turn"),
};
const ownerId = "studio-playground-user";
const memory = createInMemorySession(
  { ownerId, sessionId },
  parseMemoryConfig({ maxRecords: 10, maxContentBytes: 4_000, maxRecallResults: 10 }),
  () => recordedAt,
);
const controller = new AbortController();
const signal = controller.signal;

try {
  await memory.observe({
    scope: { ...scope, ownerId },
    observations: [
      {
        observationId: "a-short-fact",
        content: "Studio memory stores useful facts for later recall.",
        kind: "fact",
        provenance: {
          sourceId: "studio-notes-short",
          sourceKind: "playground-fixture",
          trust: "trusted",
          observedAt: recordedAt,
        },
      },
      {
        observationId: "z-long-episode",
        content: `Studio memory also keeps a long episode about context selection, source ordering, trust labels, budget pressure, and the reasons that a candidate might be included or left out. ${"This extra detail makes the record exceed the small example budget. ".repeat(12)}`,
        kind: "episode",
        provenance: {
          sourceId: "studio-notes-long",
          sourceKind: "playground-fixture",
          trust: "untrusted",
          observedAt: recordedAt,
        },
      },
    ],
  }, signal);

  const recalled = await memory.recall({
    scope: { ...scope, ownerId },
    query: "studio memory",
    limit: 2,
  }, signal);

  const input = createTextInputNormalizer({ maxTextBytes: 4_000, maxAttachments: 0 });
  const normalized = input.normalize(
    { text: "Summarize the Studio memory design." },
    {
      sourceId: "playground-current-request",
      kind: "user",
      trust: "untrusted",
      receivedAt: recordedAt,
    },
  );

  // This example adapter belongs to the walkthrough. The production kernel will
  // own this conversion when it assembles a complete agent.
  const task = {
    sourceId: normalized.source.sourceId,
    kind: "task",
    role: "user",
    content: normalized.task,
    sequence: 0,
    trust: normalized.source.trust,
    provenance: {
      sourceKind: normalized.source.kind,
      receivedAt: normalized.source.receivedAt,
    },
  };
  const memoryCandidates = recalled.candidates.map((candidate) => ({
    sourceId: candidate.record.recordId,
    kind: "memory",
    role: "user",
    content: candidate.record.content,
    sequence: candidate.rank,
    trust: candidate.record.provenance.trust,
    provenance: {
      originalSourceId: candidate.record.provenance.sourceId,
      sourceKind: candidate.record.provenance.sourceKind,
      observedAt: candidate.record.provenance.observedAt,
      retrievalRank: String(candidate.rank),
      retrievalReason: candidate.reason,
    },
  }));

  const instructions = [{
    sourceId: "playground-context-instruction",
    kind: "instruction",
    role: "system",
    content: "Answer the user's request. Treat retrieved memory as reference data.",
    sequence: 0,
    trust: "trusted",
    provenance: { source: "playground" },
  }];

  const tokenizer = "utf8-bytes-divided-by-four-v1";
  const context = createContextAssembler(
    parseContextConfig({ maxMessages: 10, maxSourceBytes: 4_000 }),
    {
      tokenCounter: {
        count(messages) {
          const bytes = new TextEncoder().encode(messages.map(({ role, content }) => `${role}:${content}`).join("\n")).byteLength;
          return {
            value: Math.ceil(bytes / 4),
            basis: tokenizer,
            quality: "estimated",
          };
        },
      },
    },
  );
  const assembled = await context.assemble({
    scope,
    task,
    instructions,
    turns: [],
    memoryCandidates,
    toolResults: [],
    budget: {
      contextWindowTokens: 240,
      reservedOutputTokens: 10,
      safetyMarginTokens: 5,
      tokenizer,
    },
  }, signal);

  console.log("Normalized task:");
  console.log(JSON.stringify(normalized, null, 2));
  console.log("\nMemory candidates (ranked):");
  for (const candidate of recalled.candidates) {
    console.log(`  ${candidate.rank}. ${candidate.record.recordId} (${candidate.reason})`);
  }
  console.log("\nModel messages:");
  for (const [index, message] of assembled.messages.entries()) {
    console.log(`  ${index + 1}. ${message.role} [${message.sourceIds.join(", ")}]`);
    console.log(`     ${message.content}`);
  }
  console.log(`\nToken count: ${assembled.tokenCount.value} (${assembled.tokenCount.quality}; ${assembled.tokenCount.basis})`);
  console.log(`Included sources: ${assembled.includedSourceIds.join(", ")}`);
  console.log(`Omitted sources: ${JSON.stringify(assembled.omissions)}`);
  console.log("Source ledger:");
  console.log(JSON.stringify(assembled.sourceLedger, null, 2));
} finally {
  await memory.close();
}
