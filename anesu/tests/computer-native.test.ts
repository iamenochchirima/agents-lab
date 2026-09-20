import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NativeComputerRunner } from "../src/computer/native-runner.js";
import { ComputerArtifactStore } from "../src/computer/artifacts.js";
import { loadConfig } from "../src/config/config.js";
import { DeterministicModelProvider } from "../src/models/deterministic.js";
import { SessionStore } from "../src/persistence/session-store.js";
import { runTurn } from "../src/runtime/turn.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { Workspace } from "../src/workspace/workspace.js";
import type {
  ComputerApprovalRequest,
  ComputerEnvironment,
  ComputerEnvironmentAction,
  ComputerEnvironmentObservation,
  ComputerEnvironmentReadiness,
  ComputerEnvironmentResult,
} from "../src/computer/contracts.js";

class FakeNativeEnvironment implements ComputerEnvironment {
  readonly kind = "ubuntu-x11-cua" as const;
  readonly sessionId = "native-test-session";
  readonly actions: ComputerEnvironmentAction[] = [];
  executionResult: ComputerEnvironmentResult = { ok: true, status: "completed", summary: "clicked" };
  revealOnDispatch = false;
  blockExecutionUntilAbort = false;
  blockFollowUpObservationUntilAbort = false;
  observationFailures = 0;
  abortSignal: AbortSignal | undefined;
  private observationNumber = 0;
  private safeResultVisible = false;

  constructor(private readonly screenshotPath: string, private readonly semantic = false) {}

  readiness(): ComputerEnvironmentReadiness {
    return { kind: this.kind, available: true, display: ":99", isolated: true };
  }

  async start(): Promise<ComputerEnvironmentReadiness> {
    return this.readiness();
  }

  async observe(): Promise<ComputerEnvironmentObservation> {
    await mkdir(path.dirname(this.screenshotPath), { recursive: true });
    await writeFile(this.screenshotPath, Buffer.from("png-fixture"));
    if (this.observationFailures > 0) {
      this.observationFailures -= 1;
      throw new Error("transient observation failure");
    }
    this.observationNumber += 1;
    if (this.blockFollowUpObservationUntilAbort && this.observationNumber > 1) {
      return await new Promise<ComputerEnvironmentObservation>((_resolve, reject) => {
        const abort = () => reject(new DOMException("cancelled", "AbortError"));
        if (this.abortSignal?.aborted) abort();
        else this.abortSignal?.addEventListener("abort", abort, { once: true });
      });
    }
    return {
      observationId: `observation-${this.observationNumber}`,
      environment: this.kind,
      sessionId: this.sessionId,
      generation: this.observationNumber,
      text: this.safeResultVisible ? "A controlled desktop fixture is visible. Computer success: safe result revealed." : "A controlled desktop fixture is visible.",
      structuredJson: JSON.stringify({
        screen_width: 800,
        screen_height: 600,
        display: ":99",
        ...(this.safeResultVisible ? { result: "Computer success: safe result revealed." } : {}),
        ...(this.semantic ? {
          accessibility: {
            pid: 9001,
            windowId: "42",
            snapshotId: "snapshot-1",
            appName: "Fixture",
            windowTitle: "Fixture",
            elements: [{ elementToken: "element-1", role: "button", label: "Reveal safe result", enabled: true, actions: ["click"], frame: { x: 100, y: 200, width: 80, height: 70 } }],
          },
        } : {}),
      }),
      imageCount: 1,
      imageBytes: 11,
      display: ":99",
      screenWidth: 800,
      screenHeight: 600,
      scaleFactor: 1,
      cursorX: 50,
      cursorY: 60,
      screenshotPath: this.screenshotPath,
      windowPid: 9001,
      windowId: "42",
      ...(this.semantic ? { windowSnapshotId: "snapshot-1" } : {}),
    };
  }

  async execute(action: ComputerEnvironmentAction, signal?: AbortSignal): Promise<ComputerEnvironmentResult> {
    this.actions.push(action);
    if (this.blockExecutionUntilAbort) {
      return await new Promise<ComputerEnvironmentResult>((_resolve, reject) => {
        const abort = () => reject(new DOMException("cancelled", "AbortError"));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
    }
    if (this.revealOnDispatch) this.safeResultVisible = true;
    return this.executionResult;
  }

  async close(): Promise<void> {}
}

async function setup(selection: Record<string, unknown> = { operation: "click", x: 123, y: 234 }, options: { readonly strategy?: "traditional" | "typesafe" | "compare"; readonly semantic?: boolean; readonly typeSafeConfidence?: number; readonly maxActions?: number; readonly blockDecision?: boolean; readonly blockExecutionUntilAbort?: boolean; readonly blockFollowUpObservationUntilAbort?: boolean; readonly abortSignal?: AbortSignal; readonly captureArtifacts?: boolean; readonly observationFailures?: number; readonly decisionFailures?: number; readonly providerEnvelopeError?: { readonly code: number; readonly message: string } } = {}): Promise<{ readonly root: string; readonly environment: FakeNativeEnvironment; readonly runner: NativeComputerRunner; readonly requestBodies: Record<string, unknown>[] }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-native-computer-"));
  const artifactStore = new ComputerArtifactStore(path.join(root, "managed-artifacts"));
  let environment: FakeNativeEnvironment | undefined;
  let decisionFailuresRemaining = options.decisionFailures ?? 0;
  const requestBodies: Record<string, unknown>[] = [];
  const runner = new NativeComputerRunner({
    createEnvironment: (screenshotPath) => {
      environment = new FakeNativeEnvironment(screenshotPath, options.semantic);
      environment.blockExecutionUntilAbort = options.blockExecutionUntilAbort ?? false;
      environment.blockFollowUpObservationUntilAbort = options.blockFollowUpObservationUntilAbort ?? false;
      environment.observationFailures = options.observationFailures ?? 0;
      environment.abortSignal = options.abortSignal;
      return environment;
    },
    displayId: "primary",
    artifactDirectory: root,
    artifactStore,
    captureArtifacts: options.captureArtifacts,
    openRouterApiKey: "openrouter-test-key",
    traditionalModel: "vision-test-model",
    strategy: options.strategy,
    typeSafeApiKey: options.strategy === "typesafe" || options.strategy === "compare" ? "typesafe-test-key" : undefined,
    typeSafeModel: options.strategy === "typesafe" || options.strategy === "compare" ? "jev-latest" : undefined,
    maxActions: options.maxActions,
    maxOutputBytes: 8_192,
    fetchImpl: async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { readonly messages?: unknown; readonly questions?: unknown };
      requestBodies.push(request as Record<string, unknown>);
      if (options.strategy === "typesafe" || (options.strategy === "compare" && request.questions !== undefined)) {
        return new Response(JSON.stringify({
          model: "jev-latest",
          answers: { target: { type: "choice", choice: "native_accessibility_click_0", confidence: options.typeSafeConfidence ?? 0.96, probabilities: { native_accessibility_click_0: options.typeSafeConfidence ?? 0.96 } } },
          usage: { input_tokens: 10, output_tokens: 3 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (options.blockDecision) {
        return await new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new DOMException("cancelled", "AbortError"));
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener("abort", abort, { once: true });
        });
      }
      if (options.providerEnvelopeError) {
        return new Response(JSON.stringify({ error: options.providerEnvelopeError }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (decisionFailuresRemaining > 0) {
        decisionFailuresRemaining -= 1;
        return new Response("provider returned HTTP 429", { status: 429 });
      }
      assert.ok(request.messages);
      return new Response(JSON.stringify({
        choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(selection) } }] } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  // The factory is invoked lazily by the runner, so expose it after creation.
  return {
    root,
    requestBodies,
    get environment(): FakeNativeEnvironment {
      if (!environment) throw new Error("The native environment was not created.");
      return environment;
    },
    runner,
  };
}

test("native traditional vision sends one bounded screenshot message per decision", async () => {
  const fixture = await setup();
  try {
    const result = await fixture.runner.run("native_traditional_message_count", "Reveal the safe result.", {
      approveComputer: async () => ({ decision: "allow-once" }),
    });
    assert.equal(result.ok, true);
    assert.equal(fixture.requestBodies.length, 1);
    assert.equal(fixture.requestBodies[0]?.messages && Array.isArray(fixture.requestBodies[0].messages) ? fixture.requestBodies[0].messages.length : -1, 2);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native traditional can abstain without approval or input", async () => {
  const fixture = await setup({ operation: "none", reason: "The target is not unambiguous." });
  try {
    let approvals = 0;
    const events: string[] = [];
    const result = await fixture.runner.run("native_traditional_abstain", "Reveal the safe result.", {
      approveComputer: async () => {
        approvals += 1;
        return { decision: "allow-once" };
      },
      onComputer: (event) => { events.push(event.type); },
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "computer-blocked");
    assert.match(result.summary, /abstain|not unambiguous/u);
    assert.equal(approvals, 0);
    assert.equal(fixture.environment.actions.length, 0);
    assert.deepEqual(events, ["started", "observed", "abstained"]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native compare stops on visual abstention before asking the shadow strategy", async () => {
  const fixture = await setup({ operation: "none", reason: "The visual target is ambiguous." }, { strategy: "compare", semantic: true });
  try {
    const result = await fixture.runner.run("native_compare_abstain", "Reveal the safe result.", {
      approveComputer: async () => ({ decision: "allow-once" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "computer-blocked");
    assert.equal(fixture.requestBodies.length, 1);
    assert.equal(fixture.environment.actions.length, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native runner publishes bounded observation artifacts and event references when enabled", async () => {
  const fixture = await setup(undefined, { captureArtifacts: true });
  try {
    const observed: Array<{ readonly artifactId?: string; readonly artifactPath?: string; readonly artifactBytes?: number }> = [];
    let startedRunId: string | undefined;
    const result = await fixture.runner.run("native_artifact_call", "Click the visible fixture control.", {
      approveComputer: async () => ({ decision: "allow-once" }),
      onComputer: (event) => {
        if (event.type === "started") startedRunId = event.runId;
        if (event.type === "observed") observed.push({ artifactId: event.artifactId, artifactPath: event.artifactPath, artifactBytes: event.artifactBytes });
      },
    });
    assert.equal(result.ok, true, result.content);
    assert.ok(startedRunId);
    assert.equal(observed.length, 1);
    assert.match(observed[0]?.artifactPath ?? "", new RegExp(`^${startedRunId}/computer_artifact_.*\\.png$`, "u"));
    assert.equal(observed[0]?.artifactBytes, 11);
    const managedRun = path.join(fixture.root, "managed-artifacts", startedRunId);
    const managedFiles = await readdir(managedRun);
    assert.equal(managedFiles.filter((name) => name.endsWith(".png")).length, 2);
    assert.equal(managedFiles.filter((name) => name.endsWith(".png.json")).length, 2);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native runner retries one read-only observation failure before any input", async () => {
  const fixture = await setup(undefined, { observationFailures: 1 });
  try {
    const result = await fixture.runner.run("native_observation_retry", "Click the visible fixture control.", {
      approveComputer: async () => ({ decision: "allow-once" }),
    });
    assert.equal(result.ok, true, result.content);
    assert.equal(fixture.environment.actions.length, 1);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native TypeSafe selects a bounded CUA accessibility candidate and uses its element token", async () => {
  const fixture = await setup({}, { strategy: "typesafe", semantic: true });
  try {
    const approvals: ComputerApprovalRequest[] = [];
    let proposedEvidence: { readonly model?: string; readonly latencyMs?: number; readonly probabilities?: Readonly<Record<string, number>>; readonly targetSource?: string; readonly targetRole?: string; readonly targetLabel?: string; readonly targetFrame?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } } | undefined;
    let observedEvidence: { readonly display?: string; readonly screenWidth?: number; readonly screenHeight?: number; readonly scaleFactor?: number; readonly cursorX?: number; readonly cursorY?: number; readonly imageCount?: number; readonly imageBytes?: number; readonly windowPid?: number; readonly windowId?: string; readonly windowSnapshotId?: string } | undefined;
    const result = await fixture.runner.run("native_typesafe_call", "Reveal the safe result.", {
      approveComputer: async (request) => {
        approvals.push(request);
        return { decision: "allow-once" };
      },
      onComputer: (event) => {
        if (event.type === "proposed") proposedEvidence = event as unknown as typeof proposedEvidence;
        if (event.type === "observed") observedEvidence = {
          display: event.display,
          screenWidth: event.screenWidth,
          screenHeight: event.screenHeight,
          scaleFactor: event.scaleFactor,
          cursorX: event.cursorX,
          cursorY: event.cursorY,
          imageCount: event.imageCount,
          imageBytes: event.imageBytes,
          windowPid: event.windowPid,
          windowId: event.windowId,
          windowSnapshotId: event.windowSnapshotId,
        };
      },
    });
    assert.equal(result.ok, true, result.content);
    assert.match(result.content, /"candidateId":"native_accessibility_click_0"/u);
    assert.equal(approvals[0]?.targetLabel, "Reveal safe result");
    assert.equal(approvals[0]?.targetSource, "accessibility");
    assert.deepEqual(fixture.environment.actions[0]?.position, { kind: "element", token: "element-1" });
    assert.equal(proposedEvidence?.model, "jev-latest");
    assert.equal(typeof proposedEvidence?.latencyMs, "number");
    assert.deepEqual(proposedEvidence?.probabilities, { native_accessibility_click_0: 0.96 });
    assert.equal(proposedEvidence?.targetSource, "accessibility");
    assert.equal(proposedEvidence?.targetRole, "button");
    assert.equal(proposedEvidence?.targetLabel, "Reveal safe result");
    assert.deepEqual(proposedEvidence?.targetFrame, { x: 100, y: 200, width: 80, height: 70 });
    assert.deepEqual(observedEvidence, {
      display: ":99",
      screenWidth: 800,
      screenHeight: 600,
      scaleFactor: 1,
      cursorX: 50,
      cursorY: 60,
      imageCount: 1,
      imageBytes: 11,
      windowPid: 9001,
      windowId: "42",
      windowSnapshotId: "snapshot-1",
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native TypeSafe refuses when CUA does not expose semantic candidates", async () => {
  const fixture = await setup({}, { strategy: "typesafe", semantic: false });
  try {
    const result = await fixture.runner.run("native_typesafe_no_candidates", "Reveal the safe result.");
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "computer-no-candidate");
    assert.equal(fixture.environment.actions.length, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native TypeSafe abstains below the shared confidence threshold before approval", async () => {
  const fixture = await setup({}, { strategy: "typesafe", semantic: true, typeSafeConfidence: 0.49 });
  try {
    let approvals = 0;
    const result = await fixture.runner.run("native_typesafe_low_confidence", "Reveal the safe result.", {
      approveComputer: async () => {
        approvals += 1;
        return { decision: "allow-once" };
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "computer-confidence-abstention");
    assert.match(result.content, /"status":"abstained"/u);
    assert.equal(approvals, 0);
    assert.equal(fixture.environment.actions.length, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native traditional path approves one model-selected click and reobserves", async () => {
  const fixture = await setup();
  try {
    const events: string[] = [];
    const approvals: string[] = [];
    const result = await fixture.runner.run("native_call_1", "Click the visible fixture control.", {
      approveComputer: async (request) => {
        approvals.push(`${request.operation}:${request.x},${request.y}`);
        return { decision: "allow-once" };
      },
      onComputerApproval: (event) => { events.push(event.type); },
      onComputer: (event) => { events.push(event.type); },
    });

    assert.equal(result.ok, true);
  assert.match(result.summary, /fresh CUA observation/);
    assert.deepEqual(approvals, ["click:123,234"]);
    assert.deepEqual(fixture.environment.actions[0]?.position, { kind: "coordinates", x: 123, y: 234 });
    assert.deepEqual(events, ["started", "observed", "proposed", "prepared", "approval_decided", "act_requested", "verified"]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native decision retries a transient provider failure before approval", async () => {
  const fixture = await setup(undefined, { decisionFailures: 1 });
  try {
    const attempts: Array<{ readonly attempt: number; readonly retrying: boolean; readonly errorCode?: string }> = [];
    const result = await fixture.runner.run("native_retry", "Click the visible fixture control.", {
      approveComputer: async () => ({ decision: "allow-once" }),
      onComputer: (event) => {
        if (event.type === "decision_attempt") attempts.push({ attempt: event.attempt, retrying: event.retrying, errorCode: event.errorCode });
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(attempts, [{ attempt: 1, retrying: true, errorCode: "computer-decision" }]);
    assert.equal(fixture.environment.actions.length, 1);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native decision surfaces a provider error envelope instead of misclassifying it as malformed", async () => {
  const fixture = await setup(undefined, { providerEnvelopeError: { code: 502, message: "ResourceExhausted: worker capacity reached" } });
  try {
    const result = await fixture.runner.run("native_provider_envelope", "Click the visible fixture control.", {
      approveComputer: async () => ({ decision: "allow-once" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "computer-decision");
    assert.match(result.content, /upstream error: HTTP 502: ResourceExhausted: worker capacity reached/u);
    assert.equal(fixture.environment.actions.length, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native compare records both proposals and executes the primary click once", async () => {
  const fixture = await setup({ operation: "click", x: 123, y: 234 }, { strategy: "compare", semantic: true });
  try {
    const proposals: string[] = [];
    let approvals = 0;
    const result = await fixture.runner.run("native_compare_agree", "Click the visible fixture control.", {
      approveComputer: async () => {
        approvals += 1;
        return { decision: "allow-once" };
      },
      onComputer: (event) => {
        if (event.type === "proposed") proposals.push(event.strategy);
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(proposals, ["traditional", "typesafe"]);
    assert.equal(approvals, 1);
    assert.equal(fixture.environment.actions.length, 1);
    assert.deepEqual(fixture.environment.actions[0]?.position, { kind: "coordinates", x: 123, y: 234 });
    assert.deepEqual(
      {
        display: fixture.environment.actions[0]?.display,
        screenWidth: fixture.environment.actions[0]?.screenWidth,
        screenHeight: fixture.environment.actions[0]?.screenHeight,
        scaleFactor: fixture.environment.actions[0]?.scaleFactor,
        windowPid: fixture.environment.actions[0]?.windowPid,
        windowId: fixture.environment.actions[0]?.windowId,
        windowSnapshotId: fixture.environment.actions[0]?.windowSnapshotId,
      },
      { display: ":99", screenWidth: 800, screenHeight: 600, scaleFactor: 1, windowPid: 9001, windowId: "42", windowSnapshotId: "snapshot-1" },
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native compare stops on proven target disagreement before approval", async () => {
  const fixture = await setup({ operation: "click", x: 300, y: 300 }, { strategy: "compare", semantic: true });
  try {
    const events: string[] = [];
    let approvals = 0;
    const result = await fixture.runner.run("native_compare_disagree", "Click the visible fixture control.", {
      approveComputer: async () => {
        approvals += 1;
        return { decision: "allow-once" };
      },
      onComputer: (event) => { events.push(event.type); },
    });

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "computer-disagreement");
    assert.equal(approvals, 0);
    assert.equal(fixture.environment.actions.length, 0);
    assert.deepEqual(events, ["started", "observed", "proposed", "proposed", "abstained"]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native computer loop reobserves between approved inputs and enforces its action limit", async () => {
  const fixture = await setup({ operation: "click", x: 123, y: 234 }, { maxActions: 2 });
  try {
    const events: string[] = [];
    const observationIds: string[] = [];
    const previousObservationIds: Array<string | undefined> = [];
    const result = await fixture.runner.run("native_loop_limit", "Click until the safe result is visible.", {
      approveComputer: async () => ({ decision: "allow-once" }),
      onComputer: (event) => {
        events.push(event.type);
        if (event.type === "observed") {
          observationIds.push(event.observationId);
          previousObservationIds.push(event.previousObservationId);
        }
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "computer-action-limit");
    assert.equal(fixture.environment.actions.length, 2);
    assert.equal(new Set(observationIds).size, 2);
    assert.deepEqual(previousObservationIds, [undefined, observationIds[0]]);
    assert.deepEqual(events, [
      "started", "observed", "proposed", "act_requested", "verified",
      "observed", "proposed", "act_requested", "verified",
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native cancellation before input emits a terminal failed event", async () => {
  const fixture = await setup(undefined, { blockDecision: true });
  const controller = new AbortController();
  try {
    const events: Array<{ readonly type: string; readonly runStatus?: string; readonly reason?: string }> = [];
    const promise = fixture.runner.run("native_cancel_before_input", "Click the visible fixture control.", {
      signal: controller.signal,
      approveComputer: async () => ({ decision: "allow-once" }),
      onComputer: (event) => { events.push(event); },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort("test cancellation");
    await assert.rejects(promise);
    assert.equal(fixture.environment.actions.length, 0);
    assert.deepEqual(events.map((event) => event.type), ["started", "observed", "failed"]);
    assert.equal(events.at(-1)?.runStatus, "failed");
    assert.match(events.at(-1)?.reason ?? "", /cancelled before any input/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native cancellation during dispatch emits outcome-unknown without replay", async () => {
  const fixture = await setup(undefined, { blockExecutionUntilAbort: true });
  const controller = new AbortController();
  try {
    const events: Array<{ readonly type: string; readonly runStatus?: string; readonly reason?: string }> = [];
    const promise = fixture.runner.run("native_cancel_during_input", "Click the visible fixture control.", {
      signal: controller.signal,
      approveComputer: async () => ({ decision: "allow-once" }),
      onComputerApproval: (event) => { events.push(event as unknown as { readonly type: string }); },
      onComputer: (event) => { events.push(event); },
    });
    let environment: FakeNativeEnvironment;
    while (true) {
      try {
        environment = fixture.environment;
        break;
      } catch {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    while (environment.actions.length === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort("test cancellation");
    await assert.rejects(promise);
    assert.equal(environment.actions.length, 1);
    assert.deepEqual(events.map((event) => event.type), ["started", "observed", "proposed", "prepared", "approval_decided", "act_requested", "failed"]);
    assert.equal(events.at(-1)?.runStatus, "outcome-unknown");
    assert.match(events.at(-1)?.reason ?? "", /after 1 input/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native approval denial reaches no native input", async () => {
  const fixture = await setup();
  try {
    const result = await fixture.runner.run("native_call_2", "Click the visible fixture control.", {
      approveComputer: async () => ({ decision: "deny", reason: "test denial" }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "computer-approval-denied");
    assert.equal(fixture.environment.actions.length, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native traditional path validates and approves a bounded typing action", async () => {
  const fixture = await setup({ operation: "type", text: "hello fixture" });
  try {
    const approvals: ComputerApprovalRequest[] = [];
    const result = await fixture.runner.run("native_call_type", "Type hello fixture into the focused safe field.", {
      approveComputer: async (request) => {
        approvals.push(request);
        return { decision: "allow-once" };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(approvals[0]?.operation, "type");
    assert.equal(approvals[0]?.x, undefined);
    assert.equal(approvals[0]?.textLength, 13);
    assert.equal(approvals[0]?.textPreview, "hello fixture");
    assert.equal(fixture.environment.actions[0]?.operation, "type");
    assert.equal(fixture.environment.actions[0]?.text, "hello fixture");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native traditional path blocks credential-like typing before approval", async () => {
  const fixture = await setup({ operation: "type", text: "password=not-for-a-real-account" });
  let approvalCalled = false;
  try {
    const result = await fixture.runner.run("native_call_secret", "Type the password into the login form.", {
      approveComputer: async () => {
        approvalCalled = true;
        return { decision: "allow-once" };
      },
    });

    assert.equal(result.ok, false);
    assert.match(result.content, /credential or secret entry/u);
    assert.equal(approvalCalled, false);
    assert.equal(fixture.environment.actions.length, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native traditional path preserves scroll and drag payloads for approval", async () => {
  const scrollFixture = await setup({ operation: "scroll", x: 100, y: 200, direction: "down", amount: 2 });
  try {
    const result = await scrollFixture.runner.run("native_call_scroll", "Scroll down in the safe fixture.", {
      approveComputer: async (request) => {
        assert.equal(request.operation, "scroll");
        assert.equal(request.direction, "down");
        assert.equal(request.amount, 2);
        return { decision: "allow-once" };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(scrollFixture.environment.actions[0]?.operation, "scroll");
  } finally {
    await rm(scrollFixture.root, { recursive: true, force: true });
  }

  const dragFixture = await setup({ operation: "drag", fromX: 10, fromY: 20, toX: 100, toY: 120 });
  try {
    const result = await dragFixture.runner.run("native_call_drag", "Drag the safe fixture handle.", {
      approveComputer: async (request) => {
        assert.equal(request.operation, "drag");
        assert.equal(request.x, 10);
        assert.equal(request.y, 20);
        assert.equal(request.endX, 100);
        assert.equal(request.endY, 120);
        return { decision: "allow-once" };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(dragFixture.environment.actions[0]?.operation, "drag");
  } finally {
    await rm(dragFixture.root, { recursive: true, force: true });
  }
});

test("native runner does not claim success for an uncertain CUA effect", async () => {
  const fixture = await setup();
  try {
    const result = await fixture.runner.run("native_call_uncertain", "Click the visible fixture control.", {
      approveComputer: async () => ({ decision: "allow-once" }),
      onComputer: (event) => {
        if (event.type === "started") fixture.environment.executionResult = { ok: false, status: "unknown", summary: "CUA reported an uncertain effect." };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "computer-environment");
    assert.match(result.summary, /uncertain effect/u);
    assert.equal(fixture.environment.actions.length, 1);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native runner verifies an uncertain CUA effect from a fresh fixture observation without retrying", async () => {
  const fixture = await setup();
  try {
    const result = await fixture.runner.run("native_call_uncertain_verified", "Reveal the safe result.", {
      approveComputer: async () => ({ decision: "allow-once" }),
      onComputer: (event) => {
        if (event.type === "started") {
          fixture.environment.revealOnDispatch = true;
          fixture.environment.executionResult = { ok: false, status: "unknown", summary: "CUA reported an uncertain effect." };
        }
      },
    });

    assert.equal(result.ok, true, result.content);
    assert.match(result.summary, /fresh observation verified the safe result/u);
    assert.match(result.content, /"executionStatus":"unknown"/u);
    assert.match(result.content, /"verification":"safe-fixture-marker"/u);
    assert.equal(fixture.environment.actions.length, 1);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native cancellation after an ambiguous acknowledgement remains outcome-unknown", async () => {
  const controller = new AbortController();
  const fixture = await setup(undefined, { blockFollowUpObservationUntilAbort: true, abortSignal: controller.signal });
  try {
    const events: Array<{ readonly type: string; readonly runStatus?: string; readonly reason?: string }> = [];
    const promise = fixture.runner.run("native_cancel_after_unknown", "Click the visible fixture control.", {
      signal: controller.signal,
      approveComputer: async () => ({ decision: "allow-once" }),
      onComputerApproval: (event) => { events.push(event as unknown as { readonly type: string }); },
      onComputer: (event) => {
        events.push(event);
        if (event.type === "started") fixture.environment.executionResult = { ok: false, status: "unknown", summary: "CUA reported an uncertain effect." };
      },
    });
    let environment: FakeNativeEnvironment;
    while (true) {
      try {
        environment = fixture.environment;
        break;
      } catch {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    while (environment.actions.length === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    while (environment.actions.length === 1 && !controller.signal.aborted) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (events.some((event) => event.type === "act_requested")) controller.abort("test cancellation");
    }
    await assert.rejects(promise);
    assert.equal(environment.actions.length, 1);
    assert.equal(events.at(-1)?.type, "failed");
    assert.equal(events.at(-1)?.runStatus, "outcome-unknown");
    assert.match(events.at(-1)?.reason ?? "", /after 1 input/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native traditional path rejects malformed or extra model action fields", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-native-computer-invalid-"));
  let environment: FakeNativeEnvironment | undefined;
  const runner = new NativeComputerRunner({
    createEnvironment: (screenshotPath) => {
      environment = new FakeNativeEnvironment(screenshotPath);
      return environment;
    },
    displayId: "primary",
    artifactDirectory: root,
    openRouterApiKey: "openrouter-test-key",
    traditionalModel: "vision-test-model",
    maxOutputBytes: 8_192,
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ operation: "click", x: 1, y: 2, selector: "#unsafe" }) } }] }), { status: 200 }),
  });
  try {
    const result = await runner.run("native_call_3", "Click the visible fixture control.", { approveComputer: async () => ({ decision: "allow-once" }) });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "computer-malformed-response");
    assert.equal(environment?.actions.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the tool registry dispatches the configured Ubuntu/X11 native environment", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-native-registry-"));
  let environment: FakeNativeEnvironment | undefined;
  try {
    const workspace = await Workspace.open(root, { maxFileBytes: 64 * 1024, maxDirectoryEntries: 100, maxTreeEntries: 500, maxTreeBytes: 1024 * 1024, maxTreeDepth: 16 });
    const registry = new ToolRegistry(workspace, 8_192, undefined, undefined, undefined, undefined, {
      environment: "ubuntu-x11-cua",
      strategy: "traditional",
      native: {
        displayId: "primary",
        artifactDirectory: path.join(root, "artifacts"),
        openRouterApiKey: "openrouter-test-key",
        traditionalModel: "vision-test-model",
        maxOutputBytes: 8_192,
        createEnvironment: (screenshotPath) => {
          environment = new FakeNativeEnvironment(screenshotPath);
          return environment;
        },
        fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ operation: "click", x: 123, y: 234 }) } }] }), { status: 200 }),
      },
    });
    assert.ok(registry.definitions.some((definition) => definition.name === "computer"));

    const result = await registry.execute({ callId: "registry_native_call", name: "computer", argumentsJson: JSON.stringify({ goal: "Click the visible fixture control." }) }, {
      approveComputer: async () => ({ decision: "allow-once" }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.terminal, true);
    assert.equal(environment?.actions.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the runtime persists the native action lifecycle around approval and verification", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-native-runtime-records-"));
  try {
    const config = loadConfig({ stateDir: path.join(root, "state"), workspaceRoot: root, browserEnabled: false }, {});
    const session = await SessionStore.open(config.stateDir);
    const workspace = await Workspace.open(root, {
      maxFileBytes: config.maxFileBytes,
      maxDirectoryEntries: config.maxDirectoryEntries,
      maxTreeEntries: config.maxTreeEntries,
      maxTreeBytes: config.maxTreeBytes,
      maxTreeDepth: config.maxTreeDepth,
    });
    const tools = new ToolRegistry(workspace, config.maxToolOutputBytes, undefined, undefined, undefined, undefined, {
      environment: "ubuntu-x11-cua",
      strategy: "traditional",
      native: {
        displayId: "primary",
        artifactDirectory: path.join(root, "artifacts"),
        openRouterApiKey: "openrouter-test-key",
        traditionalModel: "vision-test-model",
        maxActions: config.computerMaxActions,
        maxOutputBytes: config.maxToolOutputBytes,
        createEnvironment: (screenshotPath) => {
          const environment = new FakeNativeEnvironment(screenshotPath);
          environment.revealOnDispatch = true;
          return environment;
        },
        fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ operation: "click", x: 123, y: 234 }) } }] }), { status: 200 }),
      },
    });
    const result = await runTurn({
      session,
      provider: new DeterministicModelProvider("deterministic/computer-records", {
        toolCall: {
          name: "computer",
          argumentsJson: JSON.stringify({ goal: "Click the visible fixture control." }),
          finalResponse: "Native computer action recorded.",
        },
      }),
      tools,
      config,
      userPrompt: "Click the visible fixture control.",
      approveComputer: async () => ({ decision: "allow-once" }),
    });

    assert.equal(result.status, "completed");
    const turnDirectory = path.join(session.sessionDirectory, "turns", result.turnId);
    const [recordName] = await readdir(path.join(turnDirectory, "computer-actions"));
    assert.ok(recordName);
    const action = JSON.parse(await readFile(path.join(turnDirectory, "computer-actions", recordName), "utf8")) as { status?: string; operation?: string };
    assert.equal(action.status, "completed");
    assert.equal(action.operation, "click");
    const [runName] = await readdir(path.join(turnDirectory, "computer-runs"));
    assert.ok(runName);
    const run = JSON.parse(await readFile(path.join(turnDirectory, "computer-runs", runName, "run.json"), "utf8")) as { status?: string; strategy?: string; environment?: string; maxActions?: number };
    assert.equal(run.status, "completed");
    assert.equal(run.strategy, "traditional");
    assert.equal(run.environment, "ubuntu-x11-cua");
    assert.equal(run.maxActions, 3);
    const runEvents = (await readFile(path.join(turnDirectory, "computer-runs", runName, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { sequence?: number; kind?: string; payload?: Record<string, unknown> });
    assert.deepEqual(runEvents.map((event) => [event.sequence, event.kind]), [
      [1, "started"],
      [2, "observed"],
      [3, "proposed"],
      [4, "approval"],
      [5, "approval"],
      [6, "act_requested"],
      [7, "verified"],
    ]);
    const nativeObservationIds = runEvents
      .filter((event) => event.kind === "observed" || event.kind === "proposed" || event.kind === "act_requested" || event.kind === "verified")
      .map((event) => event.payload?.observationId);
    assert.equal(nativeObservationIds.length, 4);
    assert.equal(new Set(nativeObservationIds).size, 1);
    assert.match(String(nativeObservationIds[0]), /^observation-/u);
    assert.equal(runEvents[1]?.payload?.display, ":99");
    assert.equal(runEvents[1]?.payload?.cursorX, 50);
    assert.equal(runEvents[1]?.payload?.cursorY, 60);
    assert.equal(runEvents[1]?.payload?.windowId, "42");
    assert.equal(runEvents[2]?.payload?.model, "vision-test-model");
    assert.equal(typeof runEvents[2]?.payload?.latencyMs, "number");
    assert.ok(runEvents.every((event) => !JSON.stringify(event).includes("openrouter-test-key")));
    const events = await readFile(path.join(turnDirectory, "events.jsonl"), "utf8");
    assert.match(events, /ComputerPrepared/u);
    assert.match(events, /ComputerApprovalDecided/u);
    assert.match(events, /ComputerStarted/u);
    assert.match(events, /ComputerCompleted/u);

    const denied = await runTurn({
      session,
      provider: new DeterministicModelProvider("deterministic/computer-records-denied", {
        toolCall: {
          name: "computer",
          argumentsJson: JSON.stringify({ goal: "Click the visible fixture control." }),
          finalResponse: "Native computer action was denied.",
        },
      }),
      tools,
      config,
      userPrompt: "Click the visible fixture control, but deny the action.",
      approveComputer: async () => ({ decision: "deny", reason: "test denial" }),
    });
    assert.equal(denied.status, "completed");
    const deniedDirectory = path.join(session.sessionDirectory, "turns", denied.turnId);
    const [deniedRecordName] = await readdir(path.join(deniedDirectory, "computer-actions"));
    assert.ok(deniedRecordName);
    const deniedAction = JSON.parse(await readFile(path.join(deniedDirectory, "computer-actions", deniedRecordName), "utf8")) as { status?: string; errorCode?: string };
    assert.equal(deniedAction.status, "failed");
    assert.equal(deniedAction.errorCode, "computer-approval-denied");
    const [deniedRunName] = await readdir(path.join(deniedDirectory, "computer-runs"));
    assert.ok(deniedRunName);
    const deniedRun = JSON.parse(await readFile(path.join(deniedDirectory, "computer-runs", deniedRunName, "run.json"), "utf8")) as { status?: string; summary?: string };
    assert.equal(deniedRun.status, "failed");
    assert.equal(deniedRun.summary, "test denial");
    assert.match(await readFile(path.join(deniedDirectory, "events.jsonl"), "utf8"), /ComputerCompleted/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
