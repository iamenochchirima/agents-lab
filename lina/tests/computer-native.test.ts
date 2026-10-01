import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NativeComputerRunner } from "../src/computer/native-runner.js";
import { ComputerArtifactStore } from "../src/computer/artifacts.js";
import { compileComputerTask } from "../src/computer/task.js";
import { loadConfig } from "../src/config/config.js";
import { DeterministicModelProvider } from "../src/models/deterministic.js";
import { SessionStore } from "../src/persistence/session-store.js";
import { runTurn } from "../src/runtime/turn.js";
import { ModelProviderError } from "../src/runtime/errors.js";
import type { ModelRequest, ModelStreamEvent } from "../src/runtime/contracts.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { Workspace } from "../src/workspace/workspace.js";
import type {
  ComputerApprovalRequest,
  ComputerEnvironment,
  ComputerEnvironmentAction,
  ComputerEnvironmentObservation,
  ComputerEnvironmentReadiness,
  ComputerEnvironmentResult,
  ComputerEnvironmentVerification,
} from "../src/computer/contracts.js";

class FakeNativeEnvironment implements ComputerEnvironment {
  readonly kind = "ubuntu-x11-cua" as const;
  readonly sessionId = "native-test-session";
  readonly actions: ComputerEnvironmentAction[] = [];
  readonly presentedActions: ComputerEnvironmentAction[] = [];
  onPresentAction: ((action: ComputerEnvironmentAction, signal?: AbortSignal) => Promise<void> | void) | undefined;
  executionResult: ComputerEnvironmentResult = { ok: true, status: "completed", summary: "clicked" };
  executionResults: ComputerEnvironmentResult[] = [];
  revealOnDispatch = false;
  blockExecutionUntilAbort = false;
  blockFollowUpObservationUntilAbort = false;
  closeFailure = false;
  hostVerification: ComputerEnvironmentVerification | undefined;
  observationFailures = 0;
  abortSignal: AbortSignal | undefined;
  private observationNumber = 0;
  private safeResultVisible = false;

  constructor(
    private readonly screenshotPath: string,
    private readonly semantic = false,
    private readonly applicationName = "Fixture",
    private readonly semanticEditable = false,
    private readonly semanticElements?: readonly Record<string, unknown>[] | ((observationNumber: number) => readonly Record<string, unknown>[]),
  ) {}

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
    const semanticElements = typeof this.semanticElements === "function"
      ? this.semanticElements(this.observationNumber)
      : this.semanticElements;
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
            appName: this.applicationName,
            windowTitle: this.applicationName,
            elements: semanticElements ?? [this.semanticEditable
              ? { elementToken: "element-1", role: "entry", label: "Editor", enabled: true, actions: ["set_value"], frame: { x: 100, y: 200, width: 200, height: 30 } }
              : { elementToken: "element-1", role: "button", label: "Reveal safe result", enabled: true, actions: ["click"], frame: { x: 100, y: 200, width: 80, height: 70 } }],
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
    return this.executionResults.shift() ?? this.executionResult;
  }

  async presentAction(action: ComputerEnvironmentAction, signal?: AbortSignal): Promise<void> {
    this.presentedActions.push(action);
    await this.onPresentAction?.(action, signal);
  }

  async verify(): Promise<ComputerEnvironmentVerification> {
    return this.hostVerification ?? {
      status: "verified",
      summary: "native fixture verification passed",
      evidence: { cuaStatus: "satisfied" },
    };
  }

  async close(): Promise<void> {
    if (this.closeFailure) throw new Error("native fixture close failed");
  }
}

async function setup(selection: Record<string, unknown> = { operation: "click", x: 123, y: 234 }, options: { readonly strategy?: "traditional" | "typesafe" | "compare"; readonly semantic?: boolean; readonly semanticEditable?: boolean; readonly semanticElements?: readonly Record<string, unknown>[] | ((observationNumber: number) => readonly Record<string, unknown>[]); readonly applicationName?: string; readonly typeSafeConfidence?: number; readonly typeSafeChoices?: readonly string[]; readonly maxActions?: number; readonly blockDecision?: boolean; readonly blockExecutionUntilAbort?: boolean; readonly blockFollowUpObservationUntilAbort?: boolean; readonly abortSignal?: AbortSignal; readonly captureArtifacts?: boolean; readonly observationFailures?: number; readonly decisionFailures?: number; readonly providerEnvelopeError?: { readonly code: number; readonly message: string }; readonly closeFailure?: boolean; readonly revealOnDispatch?: boolean; readonly onPresentAction?: (action: ComputerEnvironmentAction, signal?: AbortSignal) => Promise<void> | void; readonly executionResults?: readonly ComputerEnvironmentResult[]; readonly hostVerification?: ComputerEnvironmentVerification } = {}): Promise<{ readonly root: string; readonly environment: FakeNativeEnvironment; readonly runner: NativeComputerRunner; readonly requestBodies: Record<string, unknown>[] }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lina-native-computer-"));
  const artifactStore = new ComputerArtifactStore(path.join(root, "managed-artifacts"));
  let environment: FakeNativeEnvironment | undefined;
  let decisionFailuresRemaining = options.decisionFailures ?? 0;
  let typeSafeChoiceIndex = 0;
  const requestBodies: Record<string, unknown>[] = [];
  const runner = new NativeComputerRunner({
    createEnvironment: (screenshotPath) => {
      environment = new FakeNativeEnvironment(screenshotPath, options.semantic, options.applicationName, options.semanticEditable, options.semanticElements);
      environment.blockExecutionUntilAbort = options.blockExecutionUntilAbort ?? false;
      environment.blockFollowUpObservationUntilAbort = options.blockFollowUpObservationUntilAbort ?? false;
      environment.observationFailures = options.observationFailures ?? 0;
      environment.closeFailure = options.closeFailure ?? false;
      environment.revealOnDispatch = options.revealOnDispatch ?? false;
      environment.onPresentAction = options.onPresentAction;
      environment.executionResults = [...(options.executionResults ?? [])];
      environment.hostVerification = options.hostVerification;
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
        const choice = options.typeSafeChoices?.[typeSafeChoiceIndex++] ?? "native_accessibility_click_0";
        return new Response(JSON.stringify({
          model: "jev-latest",
          answers: { target: { type: "choice", choice, confidence: options.typeSafeConfidence ?? 0.96, probabilities: { [choice]: options.typeSafeConfidence ?? 0.96 } } },
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

test("native app-open tasks verify immediately after launch without asking Jev for input", async () => {
  const fixture = await setup(undefined, { applicationName: "GNOME Calendar", strategy: "typesafe", semantic: true });
  try {
    const task = compileComputerTask({
      taskId: "native-open-calendar",
      goal: "Open Calendar.",
      surface: "native",
      application: { name: "Calendar", launchPath: "/usr/bin/gnome-calendar" },
      allowedOrigins: [],
      maxActions: 3,
      nowMs: Date.now(),
      deadlineMs: 30_000,
    });
    const events: string[] = [];
    const result = await fixture.runner.run("native_open_calendar", "Open Calendar.", {
      taskContext: { task, grant: { approved: true, actionCount: 0, taskHashes: [task.grantHash] } },
      approveComputer: async () => ({ decision: "allow-once" }),
      onComputer: (event) => { events.push(event.type); },
    });
    assert.equal(result.ok, true, result.content);
    assert.equal(result.status, "completed");
    assert.equal(fixture.environment.actions.length, 0);
    assert.equal(fixture.requestBodies.length, 0);
    assert.deepEqual(events, ["started", "observed", "verified"]);
    assert.match(result.content, /native-app-open/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native cleanup failure replaces an otherwise verified result with outcome unknown", async () => {
  const fixture = await setup({ operation: "click", x: 123, y: 234 }, { revealOnDispatch: true, closeFailure: true });
  const result = await fixture.runner.run("native_cleanup_failure", "Reveal the safe result.", { approveComputer: async () => ({ decision: "allow-once" as const }) });
  assert.equal(result.ok, false);
  assert.equal(result.status, "outcome-unknown");
  assert.match(result.summary, /cleanup failed/u);
});

test("native runner cannot upgrade an unknown Cua verify_state result", async () => {
  const fixture = await setup({ operation: "click", x: 123, y: 234 }, {
    revealOnDispatch: true,
    hostVerification: {
      status: "unknown",
      summary: "CUA could not prove the exact native postcondition.",
      evidence: { cuaStatus: "unknown", cuaStable: "false" },
    },
  });
  try {
    const result = await fixture.runner.run("native_verify_unknown", "Reveal the safe result.", { approveComputer: async () => ({ decision: "allow-once" }) });
    assert.equal(result.status, "clarification-required");
    assert.match(result.summary, /completion remains unproven/u);
    assert.equal(fixture.environment.actions.length, 1);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native traditional vision sends one bounded screenshot message per decision", async () => {
  const fixture = await setup();
  try {
    const result = await fixture.runner.run("native_traditional_message_count", "Reveal the safe result.", {
      approveComputer: async () => ({ decision: "allow-once" }),
    });
    assert.equal(result.ok, true);
    assert.equal(fixture.requestBodies.length, 1);
    assert.equal(fixture.requestBodies[0]?.messages && Array.isArray(fixture.requestBodies[0].messages) ? fixture.requestBodies[0].messages.length : -1, 2);
    const systemMessage = fixture.requestBodies[0]?.messages && Array.isArray(fixture.requestBodies[0].messages)
      ? fixture.requestBodies[0].messages[0]
      : undefined;
    const systemContent = typeof systemMessage === "object" && systemMessage !== null
      ? (systemMessage as { readonly content?: unknown }).content
      : undefined;
    if (typeof systemContent !== "string") throw new Error("Traditional vision request did not include a string system prompt.");
    assert.match(systemContent, /full screenshot coordinate frame/u);
    assert.match(systemContent, /visible bounding box/u);
    const userMessage = fixture.requestBodies[0]?.messages && Array.isArray(fixture.requestBodies[0].messages)
      ? fixture.requestBodies[0].messages[1]
      : undefined;
    const userContent = typeof userMessage === "object" && userMessage !== null
      ? (userMessage as { readonly content?: unknown }).content
      : undefined;
    if (!Array.isArray(userContent)) throw new Error("Traditional vision request did not include multimodal user content.");
    const userText = userContent[0] && typeof userContent[0] === "object" && !Array.isArray(userContent[0])
      ? (userContent[0] as { readonly text?: unknown }).text
      : undefined;
    if (typeof userText !== "string") throw new Error("Traditional vision request did not include a text part.");
    assert.match(userText, /^Goal:/u);
    assert.match(userText, /Screenshot size:/u);
    const tools = fixture.requestBodies[0]?.tools;
    const computerTool = Array.isArray(tools) && tools[0] && typeof tools[0] === "object" && !Array.isArray(tools[0])
      ? tools[0] as { readonly function?: { readonly parameters?: { readonly properties?: Record<string, unknown> } } }
      : undefined;
    const properties = computerTool?.function?.parameters?.properties;
    assert.equal(properties?.x_abs, undefined);
    assert.equal(properties?.y_abs, undefined);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native traditional accepts a bounded provider rationale alongside a click", async () => {
  const fixture = await setup({ operation: "click", x: 123, y: 234, reason: "The requested visible control is unambiguous." });
  try {
    const result = await fixture.runner.run("native_traditional_provider_rationale", "Reveal the safe result.", {
      approveComputer: async () => ({ decision: "allow-once" }),
    });
    assert.equal(result.ok, true);
    assert.equal(fixture.environment.actions.length, 1);
    assert.deepEqual(fixture.environment.actions[0]?.position, { kind: "coordinates", x: 123, y: 234 });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native traditional converts bounded normalized coordinates using the observed screen", async () => {
  const fixture = await setup({ operation: "click", x: 0.5, y: 0.25 }, { maxActions: 1 });
  try {
    await fixture.runner.run("native_traditional_normalized_coordinates", "Reveal the safe result.", {
      approveComputer: async () => ({ decision: "allow-once" }),
    });
    assert.deepEqual(fixture.environment.actions[0]?.position, { kind: "coordinates", x: 400, y: 150 });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native traditional normalizes the declared provider coordinate aliases", async () => {
  const fixture = await setup({ operation: "click", x_abs: 0.625, y: 0.5, y_abs: 0.5 }, { maxActions: 1 });
  try {
    await fixture.runner.run("native_traditional_provider_aliases", "Reveal the safe result.", {
      approveComputer: async () => ({ decision: "allow-once" }),
    });
    assert.deepEqual(fixture.environment.actions[0]?.position, { kind: "coordinates", x: 500, y: 300 });
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
    assert.deepEqual(approvals[0]?.expectedVerification, { kind: "text-present", expected: "Computer success: safe result revealed." });
    assert.equal(approvals[0]?.step, 1);
    assert.equal(approvals[0]?.maxActions, 1);
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

test("native TypeSafe uses the focused text rung only for an explicit value when accessibility has no candidate", async () => {
  const fixture = await setup(undefined, {
    strategy: "typesafe",
    semantic: false,
    typeSafeChoices: ["native_focused_type"],
  });
  try {
    const proposed: Array<{ readonly targetSource?: string; readonly targetRole?: string }> = [];
    const result = await fixture.runner.run("native_typesafe_focused", 'Type "Meeting notes" into the focused editor.', {
      approveComputer: async () => ({ decision: "allow-once" }),
      onComputer: (event) => {
        if (event.type === "proposed") proposed.push({ targetSource: event.targetSource, targetRole: event.targetRole });
      },
    });

    assert.equal(result.ok, true, result.content);
    assert.deepEqual(fixture.environment.actions[0] && {
      operation: fixture.environment.actions[0].operation,
      text: fixture.environment.actions[0].text,
      position: fixture.environment.actions[0].position,
    }, { operation: "type", text: "Meeting notes", position: undefined });
    assert.deepEqual(proposed, [{ targetSource: "focused", targetRole: "focused-window" }]);
    const state = fixture.requestBodies[0]?.state as { readonly accessibilityCandidates?: Record<string, string> } | undefined;
    assert.match(state?.accessibilityCandidates?.native_focused_type ?? "", /task-approved text/u);
    assert.doesNotMatch(JSON.stringify(state?.accessibilityCandidates), /Meeting notes/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native alarm entry types the compiled time only into a fresh time-labelled CUA control", async () => {
  const fixture = await setup(undefined, {
    strategy: "typesafe",
    semantic: true,
    applicationName: "Clocks",
    maxActions: 3,
    typeSafeChoices: ["native_accessibility_type_1"],
    semanticElements: [
      { elementToken: "label-field", role: "entry", label: "Alarm label", enabled: true, editable: true, actions: ["set_value"] },
      { elementToken: "alarm-time", role: "spin button", label: "Alarm time", enabled: true, editable: true, actions: ["set_value"] },
    ],
    hostVerification: { status: "unknown", summary: "fixture has not saved an alarm", evidence: { cuaStatus: "unknown" } },
  });
  try {
    const task = compileComputerTask({
      taskId: "clock-time-binding",
      goal: "Set an alarm for 7:30 tomorrow in Clocks.",
      surface: "native",
      application: { name: "Clocks", launchPath: "/usr/bin/gnome-clocks" },
      allowedOrigins: [],
      maxActions: 3,
      nowMs: Date.now(),
      deadlineMs: 30_000,
      timeZone: "Africa/Johannesburg",
    });

    const result = await fixture.runner.run("clock-time-binding", task.originalGoal, {
      taskContext: { task, grant: { approved: true, actionCount: 0, taskHashes: [task.grantHash] } },
      approveComputer: async () => ({ decision: "allow-once" }),
    });

    assert.equal(result.status, "clarification-required", "a CUA action without fresh alarm evidence must not be reported as completed");
    assert.deepEqual(fixture.environment.actions.map((action) => ({
      operation: action.operation,
      text: action.text,
      position: action.position,
    })), [{
      operation: "type",
      text: "07:30",
      position: { kind: "element", token: "alarm-time" },
    }]);
    const state = fixture.requestBodies[0]?.state as { readonly accessibilityCandidates?: Record<string, string> } | undefined;
    assert.match(state?.accessibilityCandidates?.native_accessibility_type_1 ?? "", /task-approved time/u);
    assert.doesNotMatch(state?.accessibilityCandidates?.native_accessibility_type_1 ?? "", /07:30/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native Calendar task sequences compiled title, date, and time values and verifies the committed event", async () => {
  const task = compileComputerTask({
    taskId: "calendar-form-sequence",
    goal: 'Create a calendar event called "Planning" tomorrow at 10:00 in Calendar.',
    surface: "native",
    application: { name: "Calendar", launchPath: "/usr/bin/gnome-calendar" },
    allowedOrigins: [],
    maxActions: 5,
    nowMs: Date.now(),
    deadlineMs: 30_000,
    timeZone: "Africa/Johannesburg",
  });
  const fixture = await setup(undefined, {
    strategy: "typesafe",
    semantic: true,
    applicationName: "Calendar",
    maxActions: 5,
    typeSafeChoices: [
      "native_accessibility_click_0",
      "native_accessibility_type_0",
      "native_accessibility_type_1",
      "native_accessibility_type_2",
      "native_accessibility_click_3",
    ],
    semanticElements: (observationNumber) => observationNumber === 1
      ? [
        { elementToken: "new-event", role: "button", label: "New Event", enabled: true, actions: ["click"] },
      ]
      : observationNumber >= 6
        ? [
          { elementToken: "saved-event", role: "list item", label: `Planning ${task.values.date?.value} 10:00`, enabled: true, actions: [] },
        ]
        : [
          { elementToken: "event-title", role: "entry", label: "Event title", enabled: true, editable: true, actions: ["set_value"] },
          { elementToken: "event-date", role: "entry", label: "Start date", enabled: true, editable: true, actions: ["set_value"] },
          { elementToken: "event-time", role: "spin button", label: "Start time", enabled: true, editable: true, actions: ["set_value"] },
          { elementToken: "save-event", role: "button", label: "Save", enabled: true, actions: ["click"] },
        ],
  });
  try {
    const result = await fixture.runner.run("calendar-form-sequence", task.originalGoal, {
      taskContext: { task, grant: { approved: true, actionCount: 0, taskHashes: [task.grantHash] } },
      approveComputer: async () => ({ decision: "allow-once" }),
    });

    assert.equal(result.ok, true, result.content);
    assert.equal(result.status, "completed");
    assert.deepEqual(fixture.environment.actions.map((action) => ({
      operation: action.operation,
      text: action.text,
      position: action.position,
    })), [
      { operation: "click", text: undefined, position: { kind: "element", token: "new-event" } },
      { operation: "type", text: "Planning", position: { kind: "element", token: "event-title" } },
      { operation: "type", text: task.values.date?.value, position: { kind: "element", token: "event-date" } },
      { operation: "type", text: "10:00", position: { kind: "element", token: "event-time" } },
      { operation: "click", text: undefined, position: { kind: "element", token: "save-event" } },
    ]);
    assert.equal(fixture.requestBodies.length, 5);
    for (const body of fixture.requestBodies.slice(1)) {
      const state = body.state as { readonly accessibilityCandidates?: Record<string, string> } | undefined;
      const serialized = JSON.stringify(state?.accessibilityCandidates);
      assert.doesNotMatch(serialized, /Planning|10:00/u);
      assert.ok(task.values.date?.value);
      assert.equal(serialized.includes(task.values.date.value), false);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native runner cannot acquire focused input outside the compiled task grant", async () => {
  const fixture = await setup(undefined, {
    strategy: "typesafe",
    semantic: false,
  });
  try {
    const compiled = compileComputerTask({
      taskId: "native-focused-route-denied",
      goal: 'Type "Meeting notes" into the focused editor.',
      surface: "native",
      application: { name: "Notes", launchPath: "/usr/bin/gnome-text-editor" },
      allowedOrigins: [],
      maxActions: 1,
      nowMs: Date.now(),
      deadlineMs: 30_000,
    });
    const task = { ...compiled, nativeFallbackRoutes: [] as const };
    const result = await fixture.runner.run("native_focused_route_denied", task.originalGoal, {
      taskContext: { task, grant: { approved: true, actionCount: 0, taskHashes: [task.grantHash] } },
      approveComputer: async () => ({ decision: "allow-once" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "computer-no-candidate");
    assert.equal(fixture.environment.actions.length, 0);
    assert.equal(fixture.requestBodies.length, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native TypeSafe fresh-observes and changes to focused input after a structured refusal", async () => {
  const fixture = await setup(undefined, {
    strategy: "typesafe",
    semantic: true,
    semanticEditable: true,
    maxActions: 2,
    typeSafeChoices: ["native_accessibility_type_0", "native_focused_type"],
    executionResults: [
      { ok: false, status: "refused", summary: "background element typing is unavailable" },
      { ok: true, status: "completed", summary: "focused typing completed" },
    ],
  });
  try {
    const observed: string[] = [];
    const result = await fixture.runner.run("native_typesafe_focused_after_refusal", 'Type "Meeting notes" into the editor.', {
      approveComputer: async () => ({ decision: "allow-once" }),
      onComputer: (event) => {
        if (event.type === "observed") observed.push(event.observationId);
      },
    });

    assert.equal(result.ok, true, result.content);
    assert.deepEqual(observed, ["observation-1", "observation-2"]);
    assert.equal(fixture.environment.actions.length, 2);
    assert.deepEqual(fixture.environment.actions.map((action) => ({
      operation: action.operation,
      position: action.position,
      text: action.text,
    })), [
      { operation: "type", position: { kind: "element", token: "element-1" }, text: "Meeting notes" },
      { operation: "type", position: undefined, text: "Meeting notes" },
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native TypeSafe reobserves before input when Jev rejects the current structured route", async () => {
  const fixture = await setup(undefined, {
    strategy: "typesafe",
    semantic: true,
    typeSafeChoices: ["reobserve", "native_accessibility_click_0"],
    revealOnDispatch: true,
  });
  try {
    const observed: string[] = [];
    const result = await fixture.runner.run("native_typesafe_reobserve", "Reveal the safe result.", {
      approveComputer: async () => ({ decision: "allow-once" }),
      onComputer: (event) => {
        if (event.type === "observed") observed.push(event.observationId);
      },
    });

    assert.equal(result.ok, true, result.content);
    assert.equal(fixture.environment.actions.length, 1);
    assert.deepEqual(observed, ["observation-1", "observation-2"]);
    assert.equal(fixture.requestBodies.length, 2);
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
    assert.match(result.summary, /no further input will be sent without a trusted verifier/);
    assert.match(result.content, /"outcome":"outcome-unknown"/u);
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

test("native cancellation before input emits a terminal cancelled event", async () => {
  const fixture = await setup(undefined, { blockDecision: true });
  const controller = new AbortController();
  try {
    const events: Array<{ readonly type: string; readonly outcome?: string; readonly reason?: string }> = [];
    const promise = fixture.runner.run("native_cancel_before_input", "Click the visible fixture control.", {
      signal: controller.signal,
      approveComputer: async () => ({ decision: "allow-once" }),
      onComputer: (event) => { events.push(event); },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort("test cancellation");
    await assert.rejects(promise);
    assert.equal(fixture.environment.actions.length, 0);
    assert.deepEqual(events.map((event) => event.type), ["started", "observed", "cancelled"]);
    assert.equal(events.at(-1)?.outcome, "cancelled");
    assert.match(events.at(-1)?.reason ?? "", /cancelled before any input/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native cancellation after action approval is terminal and sends no input", async () => {
  const fixture = await setup();
  const controller = new AbortController();
  try {
    const events: Array<{ readonly type: string; readonly outcome?: string; readonly reason?: string }> = [];
    const result = await fixture.runner.run("native_cancel_after_approval", "Click the visible fixture control.", {
      signal: controller.signal,
      approveComputer: async () => ({ decision: "allow-once" }),
      onComputerApproval: (event) => {
        if (event.type === "approval_decided") controller.abort("cancel immediately after approval");
      },
      onComputer: (event) => { events.push(event); },
    });

    assert.equal(result.status, "cancelled");
    assert.equal(result.errorCode, "computer-cancelled");
    assert.equal(fixture.environment.actions.length, 0);
    assert.equal(events.at(-1)?.type, "cancelled");
    assert.equal(events.at(-1)?.outcome, "cancelled");
    assert.match(events.at(-1)?.reason ?? "", /after approval and before dispatch/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native cancellation during cursor presentation remains pre-dispatch and sends no input", async () => {
  const controller = new AbortController();
  const fixture = await setup(undefined, {
    onPresentAction: () => controller.abort("cancel while showing the approved target"),
  });
  try {
    const events: Array<{ readonly type: string; readonly outcome?: string }> = [];
    const result = await fixture.runner.run("native_cancel_cursor_presentation", "Click the visible fixture control.", {
      signal: controller.signal,
      approveComputer: async () => ({ decision: "allow-once" }),
      onComputer: (event) => { events.push(event); },
    });

    assert.equal(result.status, "cancelled");
    assert.equal(fixture.environment.presentedActions.length, 1);
    assert.equal(fixture.environment.actions.length, 0);
    assert.equal(events.at(-1)?.type, "cancelled");
    assert.equal(events.at(-1)?.outcome, "cancelled");
    assert.equal(events.some((event) => event.type === "act_requested"), false);
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
    assert.match(result.content, /"verification":"text-present"/u);
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
  const root = await mkdtemp(path.join(os.tmpdir(), "lina-native-computer-invalid-"));
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
  const root = await mkdtemp(path.join(os.tmpdir(), "lina-native-registry-"));
  let environment: FakeNativeEnvironment | undefined;
  try {
    const workspace = await Workspace.open(root, { maxFileBytes: 64 * 1024, maxDirectoryEntries: 100, maxTreeEntries: 500, maxTreeBytes: 1024 * 1024, maxTreeDepth: 16 });
    const registry = new ToolRegistry(workspace, 8_192, undefined, undefined, undefined, undefined, {
      environment: "ubuntu-x11-cua",
      strategy: "typesafe",
      typeSafePreflight: async () => ({ requestedModel: "jev-latest", resolvedModel: "jev-latest" }),
      native: {
        displayId: "primary",
        artifactDirectory: path.join(root, "artifacts"),
        openRouterApiKey: "openrouter-test-key",
        traditionalModel: "vision-test-model",
        typeSafeApiKey: "typesafe-test-key",
        typeSafeModel: "jev-latest",
        maxOutputBytes: 8_192,
        createEnvironment: (screenshotPath) => {
          environment = new FakeNativeEnvironment(screenshotPath, true);
          return environment;
        },
        fetchImpl: async () => new Response(JSON.stringify({ model: "jev-latest", answers: { target: { type: "choice", choice: "native_accessibility_click_0", confidence: 0.96, probabilities: { native_accessibility_click_0: 0.96 } } } }), { status: 200 }),
      },
    });
    assert.ok(registry.definitions.some((definition) => definition.name === "computer"));

    const result = await registry.execute({ callId: "registry_native_call", name: "computer", argumentsJson: JSON.stringify({ goal: "Open Notes and reveal the safe result." }) }, {
      approveComputer: async () => ({ decision: "allow-once" }),
      approveComputerTask: async (request) => ({ decision: "allow-task", grantHash: request.grantHash }),
    });


    assert.equal(result.ok, true);
    assert.equal(result.terminal, true);
    assert.equal(environment?.actions.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the runtime persists the native action lifecycle around approval and verification", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lina-native-runtime-records-"));
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
      strategy: "typesafe",
      typeSafePreflight: async () => ({ requestedModel: "jev-latest", resolvedModel: "jev-latest" }),
      native: {
        displayId: "primary",
        artifactDirectory: path.join(root, "artifacts"),
        openRouterApiKey: "openrouter-test-key",
        traditionalModel: "vision-test-model",
        typeSafeApiKey: "typesafe-test-key",
        typeSafeModel: "jev-latest",
        maxActions: config.computerMaxActions,
        maxOutputBytes: config.maxToolOutputBytes,
        createEnvironment: (screenshotPath) => {
          const environment = new FakeNativeEnvironment(screenshotPath, true);
          environment.revealOnDispatch = true;
          return environment;
        },
        fetchImpl: async () => new Response(JSON.stringify({ model: "jev-latest", answers: { target: { type: "choice", choice: "native_accessibility_click_0", confidence: 0.96, probabilities: { native_accessibility_click_0: 0.96 } } } }), { status: 200 }),
      },
    });
    const result = await runTurn({
      session,
      provider: new DeterministicModelProvider("deterministic/computer-records", {
        toolCall: {
          name: "computer",
          argumentsJson: JSON.stringify({ goal: "Open Notes and reveal the safe result." }),
          finalResponse: "Native computer action recorded.",
        },
      }),
      tools,
      config,
      userPrompt: "Open Notes and reveal the safe result.",
      approveComputer: async () => ({ decision: "allow-once" }),
      approveComputerTask: async (request) => ({ decision: "allow-task", grantHash: request.grantHash }),
    });


    assert.equal(result.status, "completed");
    const turnDirectory = path.join(session.sessionDirectory, "turns", result.turnId);
    const [recordName] = await readdir(path.join(turnDirectory, "computer-actions"));
    assert.ok(recordName);
    const action = JSON.parse(await readFile(path.join(turnDirectory, "computer-actions", recordName), "utf8")) as { status?: string; operation?: string; taskId?: string; grantHash?: string };
    assert.equal(action.status, "completed");
    assert.equal(action.operation, "click");
    assert.match(action.taskId ?? "", /^computer_/u);
    assert.match(action.grantHash ?? "", /^[a-f0-9]{64}$/u);
    const [runName] = await readdir(path.join(turnDirectory, "computer-runs"));
    assert.ok(runName);
    const run = JSON.parse(await readFile(path.join(turnDirectory, "computer-runs", runName, "run.json"), "utf8")) as { status?: string; strategy?: string; environment?: string; maxActions?: number; taskId?: string; grantHash?: string; taskSurface?: string; applicationName?: string; profileMode?: string; nativeFallbackRoutes?: string[]; inputRoute?: string; timeZone?: string; compiledValueEvidence?: unknown[] };
    assert.equal(run.status, "completed");
    assert.equal(run.strategy, "typesafe");
    assert.equal(run.environment, "ubuntu-x11-cua");
    assert.equal(run.maxActions, 8);
    assert.match(run.taskId ?? "", /^computer_/u);
    assert.match(run.grantHash ?? "", /^[a-f0-9]{64}$/u);
    assert.equal(run.taskSurface, "native");
    assert.equal(run.applicationName, "Notes");
    assert.equal(run.profileMode, "isolated_new");
    assert.deepEqual(run.nativeFallbackRoutes, ["structured", "focused-key-text"]);
    assert.equal(run.timeZone, "Africa/Johannesburg");
    assert.deepEqual(run.compiledValueEvidence, []);
    assert.equal(run.inputRoute, "trusted");
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
    assert.equal(runEvents.find((event) => event.kind === "observed")?.payload?.cuaSessionLabel, "native-test-session");
    assert.equal(runEvents[1]?.payload?.display, ":99");
    assert.equal(runEvents[1]?.payload?.cursorX, 50);
    assert.equal(runEvents[1]?.payload?.cursorY, 60);
    assert.equal(runEvents[1]?.payload?.windowId, "42");
    assert.equal(runEvents[2]?.payload?.model, "jev-latest");
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
          argumentsJson: JSON.stringify({ goal: "Open Notes and reveal the safe result." }),
          finalResponse: "Native computer action was denied.",
        },
      }),
      tools,
      config,
      userPrompt: "Open Notes and reveal the safe result, but deny the action.",
      approveComputerTask: async () => ({ decision: "deny", reason: "test task denial" }),
    });
    assert.equal(denied.status, "completed");
    const deniedDirectory = path.join(session.sessionDirectory, "turns", denied.turnId);
    const [deniedRunName] = await readdir(path.join(deniedDirectory, "computer-runs"));
    assert.ok(deniedRunName);
    const deniedRun = JSON.parse(await readFile(path.join(deniedDirectory, "computer-runs", deniedRunName, "run.json"), "utf8")) as { status?: string; summary?: string; errorCode?: string };
    assert.equal(deniedRun.status, "failed");
    assert.equal(deniedRun.summary, "test task denial");
    assert.equal(deniedRun.errorCode, "computer-approval-denied");
    // Task denial happens before any native action is prepared, so there is no
    // per-action completion event to emit. The failed computer run is the
    // durable denial record in this case.
    assert.doesNotMatch(await readFile(path.join(deniedDirectory, "events.jsonl"), "utf8"), /ComputerCompleted/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the conversation model can choose native computer use without forced or synthetic calls", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lina-native-tool-routing-"));
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
    let launchCount = 0;
    const tools = new ToolRegistry(workspace, config.maxToolOutputBytes, undefined, undefined, undefined, undefined, {
      environment: "ubuntu-x11-cua",
      strategy: "typesafe",
      typeSafePreflight: async () => ({ requestedModel: "jev-latest", resolvedModel: "jev-latest" }),
      native: {
        displayId: "primary",
        artifactDirectory: path.join(root, "artifacts"),
        openRouterApiKey: "openrouter-test-key",
        traditionalModel: "vision-test-model",
        typeSafeApiKey: "typesafe-test-key",
        typeSafeModel: "jev-latest",
        maxOutputBytes: config.maxToolOutputBytes,
        createEnvironment: (screenshotPath) => {
          launchCount += 1;
          return new FakeNativeEnvironment(screenshotPath, true, "Notes");
        },
        fetchImpl: async () => new Response(JSON.stringify({ model: "jev-latest", answers: { target: { type: "choice", choice: "native_accessibility_click_0", confidence: 0.96, probabilities: { native_accessibility_click_0: 0.96 } } } }), { status: 200 }),
      },
    });
    const actionRequests: ModelRequest[] = [];
    const actionProvider = {
      provider: "deterministic" as const,
      model: "deterministic/recorded-computer-route",
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
        actionRequests.push(request);
        assert.equal(request.toolChoice, undefined);
        assert.ok(request.tools?.some((tool) => tool.name === "computer"));
        yield { type: "tool_call", call: { callId: "open_notes_call", name: "computer", argumentsJson: JSON.stringify({ goal: "Open Notes" }) } };
      },
    };

    const actionResult = await runTurn({
      session,
      provider: actionProvider,
      tools,
      config,
      userPrompt: "Open Notes",
      approveComputerTask: async (request) => ({ decision: "allow-task", grantHash: request.grantHash }),
    });

    assert.equal(actionResult.status, "completed");
    assert.equal(actionRequests[0]?.toolChoice, undefined);
    assert.equal(launchCount, 1);

    const questionRequests: ModelRequest[] = [];
    const questionProvider = {
      provider: "deterministic" as const,
      model: "deterministic/recorded-computer-route",
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
        questionRequests.push(request);
        yield { type: "text", text: "Notes is a note-taking application." };
      },
    };
    const questionResult = await runTurn({
      session,
      provider: questionProvider,
      tools,
      config,
      userPrompt: "What is the Notes app used for?",
    });

    assert.equal(questionResult.status, "completed");
    assert.equal(questionResult.assistantText, "Notes is a note-taking application.");
    assert.equal(questionRequests[0]?.toolChoice, undefined);
    assert.equal(launchCount, 1);

    let ordinaryText = "";
    const modelDeclinesComputer = {
      provider: "deterministic" as const,
      model: "deterministic/model-declines-computer",
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
        assert.equal(request.toolChoice, undefined);
        yield { type: "text", text: "I can explain how to open Notes." };
      },
    };
    const modelDeclinesResult = await runTurn({
      session,
      provider: modelDeclinesComputer,
      tools,
      config,
      userPrompt: "Open Notes",
      onText: (text) => { ordinaryText += text; },
    });

    assert.equal(modelDeclinesResult.status, "completed");
    assert.equal(modelDeclinesResult.assistantText, "I can explain how to open Notes.");
    assert.equal(ordinaryText, "I can explain how to open Notes.");
    assert.equal(launchCount, 1);

    const refusalProvider = {
      provider: "deterministic" as const,
      model: "deterministic/computer-refusal",
      async *stream(): AsyncIterable<ModelStreamEvent> {
        throw new ModelProviderError("The model refused this request.", { code: "provider-refusal", retryable: false });
      },
    };
    const refusalResult = await runTurn({
      session,
      provider: refusalProvider,
      tools,
      config,
      userPrompt: "Open Notes",
    });

    assert.equal(refusalResult.status, "failed");
    assert.equal(refusalResult.error?.code, "provider-refusal");
    assert.equal(launchCount, 1, "a typed provider refusal must not be converted into computer execution");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runTurn persists native cancellation after approval on both action and run records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lina-native-cancel-records-"));
  const controller = new AbortController();
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
    let environment: FakeNativeEnvironment | undefined;
    const tools = new ToolRegistry(workspace, config.maxToolOutputBytes, undefined, undefined, undefined, undefined, {
      environment: "ubuntu-x11-cua",
      strategy: "typesafe",
      typeSafePreflight: async () => ({ requestedModel: "jev-latest", resolvedModel: "jev-latest" }),
      native: {
        displayId: "primary",
        artifactDirectory: path.join(root, "artifacts"),
        openRouterApiKey: "openrouter-test-key",
        traditionalModel: "vision-test-model",
        typeSafeApiKey: "typesafe-test-key",
        typeSafeModel: "jev-latest",
        maxActions: config.computerMaxActions,
        maxOutputBytes: config.maxToolOutputBytes,
        createEnvironment: (screenshotPath) => {
          environment = new FakeNativeEnvironment(screenshotPath, true, "Notes");
          return environment;
        },
        fetchImpl: async () => new Response(JSON.stringify({ model: "jev-latest", answers: { target: { type: "choice", choice: "native_accessibility_click_0", confidence: 0.96, probabilities: { native_accessibility_click_0: 0.96 } } } }), { status: 200 }),
      },
    });
    const provider = {
      provider: "deterministic" as const,
      model: "deterministic/native-cancellation",
      async *stream(): AsyncIterable<ModelStreamEvent> {
        yield { type: "tool_call", call: { callId: "cancel_after_approval", name: "computer", argumentsJson: JSON.stringify({ goal: "Reveal the safe result in Notes." }) } };
      },
    };
    const approvalEvents: string[] = [];
    const result = await runTurn({
      session,
      provider,
      tools,
      config,
      userPrompt: "Reveal the safe result in Notes.",
      signal: controller.signal,
      approveComputerTask: async (request) => ({ decision: "allow-task", grantHash: request.grantHash }),
      onComputerApproval: (event) => {
        approvalEvents.push(event.type);
        if (event.type === "approval_decided") controller.abort("cancel after durable action approval");
      },
    });

    assert.deepEqual(approvalEvents, ["prepared", "approval_decided"]);
    assert.equal(result.status, "cancelled");
    assert.equal(environment?.actions.length, 0);
    const turnDirectory = path.join(session.sessionDirectory, "turns", result.turnId);
    const actionNames = await readdir(path.join(turnDirectory, "computer-actions"));
    assert.equal(actionNames.length, 1);
    const action = JSON.parse(await readFile(path.join(turnDirectory, "computer-actions", actionNames[0]!), "utf8")) as { status?: string; errorCode?: string };
    assert.equal(action.status, "cancelled");
    assert.equal(action.errorCode, "computer-cancelled");

    const runNames = await readdir(path.join(turnDirectory, "computer-runs"));
    assert.equal(runNames.length, 1);
    const runDirectory = path.join(turnDirectory, "computer-runs", runNames[0]!);
    const run = JSON.parse(await readFile(path.join(runDirectory, "run.json"), "utf8")) as { status?: string; outcome?: string };
    assert.equal(run.status, "cancelled");
    assert.equal(run.outcome, "cancelled");
    const runEvents = (await readFile(path.join(runDirectory, "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { kind?: string });
    assert.equal(runEvents.at(-1)?.kind, "cancelled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runTurn persists cancellation after native dispatch as outcome-unknown without replay", { timeout: 3_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lina-native-cancel-dispatched-"));
  const controller = new AbortController();
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
    let environment: FakeNativeEnvironment | undefined;
    const tools = new ToolRegistry(workspace, config.maxToolOutputBytes, undefined, undefined, undefined, undefined, {
      environment: "ubuntu-x11-cua",
      strategy: "typesafe",
      typeSafePreflight: async () => ({ requestedModel: "jev-latest", resolvedModel: "jev-latest" }),
      native: {
        displayId: "primary",
        artifactDirectory: path.join(root, "artifacts"),
        openRouterApiKey: "openrouter-test-key",
        traditionalModel: "vision-test-model",
        typeSafeApiKey: "typesafe-test-key",
        typeSafeModel: "jev-latest",
        maxActions: config.computerMaxActions,
        maxOutputBytes: config.maxToolOutputBytes,
        createEnvironment: (screenshotPath) => {
          environment = new FakeNativeEnvironment(screenshotPath, true, "Notes");
          environment.blockExecutionUntilAbort = true;
          return environment;
        },
        fetchImpl: async () => new Response(JSON.stringify({ model: "jev-latest", answers: { target: { type: "choice", choice: "native_accessibility_click_0", confidence: 0.96, probabilities: { native_accessibility_click_0: 0.96 } } } }), { status: 200 }),
      },
    });
    const provider = new DeterministicModelProvider("deterministic/native-cancellation-after-dispatch", {
      toolCall: {
        name: "computer",
        argumentsJson: JSON.stringify({ goal: "Reveal the safe result in Notes." }),
        finalResponse: "Native computer action recorded.",
      },
    });
    const computerEvents: string[] = [];
    const result = await runTurn({
      session,
      provider,
      tools,
      config,
      userPrompt: "Reveal the safe result in Notes.",
      signal: controller.signal,
      approveComputerTask: async (request) => ({ decision: "allow-task", grantHash: request.grantHash }),
      onComputer: (event) => {
        computerEvents.push(event.type);
        if (event.type === "act_requested") controller.abort("cancel after native dispatch began");
      },
    });

    assert.equal(result.status, "cancelled");
    assert.equal(environment?.actions.length, 1, "the dispatched input must not be replayed");
    assert.equal(computerEvents.filter((event) => event === "act_requested").length, 1);
    const turnDirectory = path.join(session.sessionDirectory, "turns", result.turnId);
    const actionNames = await readdir(path.join(turnDirectory, "computer-actions"));
    assert.equal(actionNames.length, 1);
    const action = JSON.parse(await readFile(path.join(turnDirectory, "computer-actions", actionNames[0]!), "utf8")) as { status?: string; errorCode?: string };
    assert.equal(action.status, "ambiguous");
    assert.equal(action.errorCode, "computer-ambiguous");

    const runNames = await readdir(path.join(turnDirectory, "computer-runs"));
    assert.equal(runNames.length, 1);
    const runDirectory = path.join(turnDirectory, "computer-runs", runNames[0]!);
    const run = JSON.parse(await readFile(path.join(runDirectory, "run.json"), "utf8")) as { status?: string; outcome?: string };
    assert.equal(run.status, "outcome-unknown");
    assert.equal(run.outcome, "outcome-unknown");
    const runEvents = (await readFile(path.join(runDirectory, "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { kind?: string });
    assert.equal(runEvents.at(-1)?.kind, "failed");
    assert.equal(runEvents.filter((event) => event.kind === "act_requested").length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
