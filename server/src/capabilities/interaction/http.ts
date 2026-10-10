import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { RunEvidenceStore } from "../../control-plane/application/evidence-store.js";
import { capabilityHostKeyPath } from "../extensions/runtime.js";
import { TaskInteractionStore } from "./store.js";

/** Workers publish/check input at short authenticated boundaries. No endpoint
 * waits for a human. Native execution owns the retained wait and task deadline.
 */
export async function registerInternalInteraction(app: FastifyInstance, store: TaskInteractionStore, evidence: RunEvidenceStore): Promise<void> {
  const key = (await readFile(capabilityHostKeyPath(), "utf8")).trim();
  for (const operation of ["boundary", "question", "answer"] as const) {
    app.post(`/internal/interaction/${operation}`, {bodyLimit: 65536}, async (request, reply) => {
      const actual = Buffer.from(request.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${key}`);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply.code(401).send({error: "Runtime authentication required."});
      try {
        const body = request.body as {runId: string; turnId: string; boundaryId: string; toolCallId: string; question: string; questionId: string};
        const manifest = await evidence.readManifest(body.runId);
        if (manifest.context.turnId !== body.turnId) throw new Error("Task input turn mismatch.");
        const snapshot = await evidence.readSnapshot(body.runId);
        if (snapshot.result || snapshot.events.some(event => event.kind === "RunCancellationRequested")) throw new Error("Run no longer accepts task input.");
        if (operation === "boundary") return reply.send(await store.consume(body.runId, body.turnId, body.boundaryId));
        if (operation === "answer") return reply.send(await store.answer(body.runId, body.turnId, body.questionId));
        if (!manifest.capabilities?.toolCatalog?.tools.some(tool => tool.definition.name === "ask_user" && tool.source.id === "agentlab/task-interaction")) throw new Error("Clarification capability is not admitted.");
        return reply.send(await store.question(body));
      } catch { return reply.code(409).send({error: "Task input boundary rejected. Inspect the run and retained input identity."}); }
    });
  }
}
