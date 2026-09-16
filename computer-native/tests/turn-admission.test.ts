import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config/config.js";
import type { ModelProvider } from "../src/models/provider.js";
import { SessionStore } from "../src/persistence/session-store.js";
import { runTurn } from "../src/runtime/turn.js";

function providerThatWaitsUntilReleased(onStarted: () => void, response: string): ModelProvider {
  return {
    provider: "deterministic",
    model: "deterministic/admission",
    async *stream(_request, signal) {
      onStarted();
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      if (signal.aborted) return;
      yield { type: "text", text: response };
      yield { type: "completed", usage: { outputTokens: 1, totalTokens: 1 } };
    },
  };
}

test("runtime admission rejects a concurrent turn before its provider is invoked", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-turn-admission-"));
  try {
    const session = await SessionStore.open(stateDir);
    const config = loadConfig({ stateDir, workspaceRoot: stateDir, browserEnabled: false, timeoutMs: 2_000 }, {});
    let firstStarted = false;
    let secondProviderCalls = 0;
    const first = runTurn({
      session,
      provider: providerThatWaitsUntilReleased(() => { firstStarted = true; }, "first result"),
      config,
      userPrompt: "first turn",
    });
    for (let attempt = 0; attempt < 100 && !firstStarted; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.equal(firstStarted, true);
    await assert.rejects(
      () => session.recoverInterruptedTurns(),
      /already in use/u,
    );

    const secondProvider: ModelProvider = {
      provider: "deterministic",
      model: "deterministic/second",
      async *stream() {
        secondProviderCalls += 1;
        yield { type: "text", text: "must not run" };
      },
    };
    await assert.rejects(
      () => runTurn({ session, provider: secondProvider, config, userPrompt: "second turn" }),
      /already in use/u,
    );
    assert.equal(secondProviderCalls, 0);
    assert.equal((await first).status, "completed");

    const afterRelease = await runTurn({
      session,
      provider: secondProvider,
      config,
      userPrompt: "second turn after release",
    });
    assert.equal(afterRelease.status, "completed");
    assert.equal(secondProviderCalls, 1);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("runtime admission refuses an unrecovered durable turn until recovery closes it", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-turn-recovery-admission-"));
  try {
    const session = await SessionStore.open(stateDir);
    const orphan = await session.admitTurn("orphaned turn", "deterministic", "deterministic/orphan");
    await assert.rejects(
      () => runTurn({
        session,
        provider: { provider: "deterministic", model: "deterministic/next", async *stream() { yield { type: "text", text: "must wait" }; } },
        config: loadConfig({ stateDir, workspaceRoot: stateDir, browserEnabled: false }, {}),
        userPrompt: "new turn",
      }),
      new RegExp(`active turn '${orphan.turnId}'`),
    );

    const recovered = await session.recoverInterruptedTurns();
    assert.equal(recovered[0]?.turnId, orphan.turnId);
    assert.equal(recovered[0]?.status, "interrupted");
    const result = await runTurn({
      session,
      provider: { provider: "deterministic", model: "deterministic/next", async *stream() { yield { type: "text", text: "runs after recovery" }; } },
      config: loadConfig({ stateDir, workspaceRoot: stateDir, browserEnabled: false }, {}),
      userPrompt: "new turn after recovery",
    });
    assert.equal(result.status, "completed");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
