import type { JsonValue, ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";
import { createScopedComputerUse, SCOPED_COMPUTER_USE_IDENTITY } from "@agent-harness-lab/module-computer-use";
import {
  createContextAssembler,
  createFixedRecentMessageWindowAssembler,
  parseFixedRecentMessageWindowConfig,
  type ContextTokenCounter,
} from "@agent-harness-lab/module-context";
import { createSingleTurnControl } from "@agent-harness-lab/module-control";
import { CALCULATOR_CAPABILITY, COMPUTER_FIXTURE_CAPABILITY, createControlledReferenceExecutionEnvironment } from "@agent-harness-lab/module-execution-environment";
import { createTextInputNormalizer } from "@agent-harness-lab/module-input";
import { createInMemorySession, IN_MEMORY_SESSION_IDENTITY, type MemorySession, type MemorySessionScope } from "@agent-harness-lab/module-memory";
import { CALCULATOR_SCENARIO_ID, CALCULATOR_SCENARIO_TASK, COMPUTER_SCENARIO_ID, COMPUTER_SCENARIO_TASK, createReferenceModelInterface, REFERENCE_MODEL_IDENTITY } from "@agent-harness-lab/module-model-interface";
import { createJsonlObservability, type ObservabilityModule } from "@agent-harness-lab/module-observability";
import { createTextOutputActions, type OutputActionSink } from "@agent-harness-lab/module-output-actions";
import { createSingleStepResponsePlanner } from "@agent-harness-lab/module-planning";
import { createAllowlistSafetyModule } from "@agent-harness-lab/module-safety";
import { createCalculatorAddRegistration, createComputerClickRegistration, createToolUseModule } from "@agent-harness-lab/module-tool-use";
import { runTextTurn, type TextTurnModules, type TextTurnRequest, type TextTurnResult } from "@agent-harness-lab/agent-kernel";
export { CALCULATOR_SCENARIO_ID, CALCULATOR_SCENARIO_TASK, COMPUTER_SCENARIO_ID, COMPUTER_SCENARIO_TASK } from "@agent-harness-lab/module-model-interface";

export type ReferenceAssemblyArea =
  | "input" | "context" | "planning" | "memory" | "tool-use" | "computer-use"
  | "control" | "execution-environment" | "output-actions" | "safety" | "model-interface" | "observability";

export interface ReferenceAssemblyComponent {
  readonly area: ReferenceAssemblyArea;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly implementation: ModuleIdentity;
  readonly configuration: JsonValue;
}

export interface ReferenceChatAssembly {
  readonly schemaVersion: 1;
  readonly id: "studio-reference-agent";
  readonly version: "0.6.0";
  readonly mode: "deterministic-reference";
  readonly components: readonly ReferenceAssemblyComponent[];
  readonly limitations: readonly string[];
}

export type ReferenceContextStrategy = "deterministic-context-assembler" | "fixed-recent-message-window";

export interface ReferenceAssemblyContextSelection {
  readonly contextStrategy: ReferenceContextStrategy;
  readonly maxRecentMessages?: number;
}

export interface ReferenceAgent {
  readonly assembly: ReferenceChatAssembly;
  createMemorySession(scope: MemorySessionScope): MemorySession;
  createObservability(scope: RunScope, rootDirectory: string): ObservabilityModule;
  runTurn(request: Omit<TextTurnRequest, "memory"> & { readonly memory: MemorySession }): Promise<TextTurnResult>;
}

const ASSEMBLY_ID = "studio-reference-agent" as const;
const ASSEMBLY_VERSION = "0.6.0" as const;
const ASSEMBLY_MODE = "deterministic-reference" as const;

const CONFIG = Object.freeze({
  input: { maxTextBytes: 16_000, maxAttachments: 0 },
  memory: { maxRecords: 100, maxContentBytes: 16_000, maxRecallResults: 10 },
  context: {
    maxMessages: 100,
    maxSourceBytes: 16_000,
    minAvailableInputTokens: 1,
  },
  planning: { maxSteps: 12, maxDescriptionBytes: 4_096, maxAssumptions: 20 },
  control: { toolCallOrder: "serial", maxModelCalls: 2, maxToolCalls: 1 },
  model: { maxOutputTokens: 512, maxAttempts: 1, requestTimeoutMs: 10_000 },
  toolUse: { maxArgumentBytes: 1_024, maxResultBytes: 4_096, timeoutMs: 1_000 },
  computerUse: { maxActionsPerTurn: 20, maxObservationBytes: 2_000_000, actionTimeoutMs: 30_000 },
  outputActions: { maxPayloadBytes: 65_536, requireIdempotencyKey: true },
  safety: {
    defaultDecision: "deny",
    maxCheckpointBytes: 16_384,
    allowedToolCapabilities: [CALCULATOR_CAPABILITY],
    allowedEnvironmentCapabilities: [COMPUTER_FIXTURE_CAPABILITY],
    allowedOutputActionKinds: ["text-response"],
    allowedMemoryWriteKinds: ["episode"],
  },
  executionEnvironment: {
    operationTimeoutMs: 1_000,
    allowedCapabilities: [CALCULATOR_CAPABILITY, COMPUTER_FIXTURE_CAPABILITY],
  },
  observability: {
    maxBufferedEvents: 1_000,
    maxBufferedBytes: 8_388_608,
    flushEveryEvents: 25,
    maxEventBytes: 1_048_576,
    maxModuleDetailBytes: 65_536,
    maxTrackedEvents: 100_000,
    maxStoredBytes: 33_554_432,
  },
});

const AREAS: readonly ReferenceAssemblyArea[] = Object.freeze([
  "input", "context", "planning", "memory", "tool-use", "computer-use",
  "control", "execution-environment", "output-actions", "safety", "model-interface", "observability",
]);

const CONTEXT_BUDGET = Object.freeze({
  contextWindowTokens: 8_192,
  reservedOutputTokens: 512,
  safetyMarginTokens: 256,
  tokenizer: "utf8-bytes-div4-estimate-v1",
});

const LIMITATIONS = Object.freeze([
  "The model interface uses deterministic replay and two exact scripted scenario tasks; it does not call an LLM or answer semantically.",
  "Memory and conversation history live in the Studio API process and are cleared when that process restarts.",
  "Computer Use acts only on the controlled in-process fixture page; it does not connect to a real browser or desktop.",
  "The Execution Environment supports only fixture arithmetic and fixture computer operations; it has no filesystem, process, or network access.",
  "Planning proposes one advisory plan per turn; Control retains bounded loop and termination ownership.",
]);

const BASE_COMPONENTS: readonly ReferenceAssemblyComponent[] = Object.freeze([
  component("input", "@agent-harness-lab/module-input", "0.1.0", { id: "text-input-normalizer", version: "0.1.0" }, CONFIG.input),
  contextComponent("deterministic-context-assembler"),
  component("planning", "@agent-harness-lab/module-planning", "0.1.0", { id: "single-step-response-planner", version: "0.1.0" }, CONFIG.planning),
  component("memory", "@agent-harness-lab/module-memory", "0.1.0", IN_MEMORY_SESSION_IDENTITY, CONFIG.memory),
  component("tool-use", "@agent-harness-lab/module-tool-use", "0.2.0", { id: "strict-tool-use", version: "0.2.0" }, CONFIG.toolUse),
  component("computer-use", "@agent-harness-lab/module-computer-use", "0.2.0", SCOPED_COMPUTER_USE_IDENTITY, CONFIG.computerUse),
  component("control", "@agent-harness-lab/module-control", "0.3.0", { id: "bounded-single-turn-control", version: "0.2.0" }, CONFIG.control),
  component("execution-environment", "@agent-harness-lab/module-execution-environment", "0.2.0", { id: "controlled-reference-environment", version: "0.2.0" }, CONFIG.executionEnvironment),
  component("output-actions", "@agent-harness-lab/module-output-actions", "0.1.0", { id: "text-output-actions", version: "0.1.0" }, CONFIG.outputActions),
  component("safety", "@agent-harness-lab/module-safety", "0.2.0", { id: "allowlist-safety", version: "0.2.0" }, CONFIG.safety),
  component("model-interface", "@agent-harness-lab/module-model-interface", "0.4.0", REFERENCE_MODEL_IDENTITY, CONFIG.model),
  component("observability", "@agent-harness-lab/module-observability", "0.1.0", { id: "jsonl-observability-recorder", version: "0.1.0" }, CONFIG.observability),
]);

const STATIC_IMPLEMENTATION_REGISTRY = new Map(
  BASE_COMPONENTS.filter((entry) => entry.area !== "context").map((entry) => [entry.area, entry] as const),
);

/** Build one of the two statically compiled Context choices with all other selections fixed. */
export function createReferenceAssemblyDescriptor(
  selection: ReferenceAssemblyContextSelection = { contextStrategy: "deterministic-context-assembler" },
): ReferenceChatAssembly {
  if (!isRecord(selection)) throw new Error("A Context strategy selection object is required.");
  for (const key of Object.keys(selection)) {
    if (key !== "contextStrategy" && key !== "maxRecentMessages") {
      throw new Error(`Unsupported reference Context selection field ${JSON.stringify(key)}.`);
    }
  }
  let selectedContext: ReferenceAssemblyComponent;
  if (selection.contextStrategy === "deterministic-context-assembler") {
    if (selection.maxRecentMessages !== undefined) {
      throw new Error("maxRecentMessages is only valid for fixed-recent-message-window.");
    }
    selectedContext = contextComponent("deterministic-context-assembler");
  } else if (selection.contextStrategy === "fixed-recent-message-window") {
    const fixedConfig = parseFixedRecentMessageWindowConfig({
      ...CONFIG.context,
      maxRecentMessages: selection.maxRecentMessages,
    });
    selectedContext = contextComponent("fixed-recent-message-window", fixedConfig.maxRecentMessages);
  } else {
    throw new Error("The reference assembly supports only its two registered Context strategies.");
  }

  const descriptor: ReferenceChatAssembly = Object.freeze({
    schemaVersion: 1,
    id: ASSEMBLY_ID,
    version: ASSEMBLY_VERSION,
    mode: ASSEMBLY_MODE,
    components: Object.freeze(BASE_COMPONENTS.map((entry) => entry.area === "context" ? selectedContext : entry)),
    limitations: LIMITATIONS,
  });
  validateReferenceAssemblyDescriptor(descriptor);
  return descriptor;
}

/** Default Context selection used by ordinary chat and controlled action scenarios. */
export const REFERENCE_ASSEMBLY_DESCRIPTOR = createReferenceAssemblyDescriptor();
/** Default fixed-window descriptor, useful for inspecting the registered alternative. */
export const FIXED_WINDOW_REFERENCE_ASSEMBLY_DESCRIPTOR = createReferenceAssemblyDescriptor({
  contextStrategy: "fixed-recent-message-window",
});

/** Create the selected assembly, after validating its descriptor against the static registry. */
export function createReferenceAgent(descriptor: unknown = REFERENCE_ASSEMBLY_DESCRIPTOR): ReferenceAgent {
  validateReferenceAssemblyDescriptor(descriptor);
  const input = createTextInputNormalizer(CONFIG.input);
  const contextSelection = descriptor.components.find((entry) => entry.area === "context")!;
  const contextDependencies = { tokenCounter: createTokenCounter() };
  const context = contextSelection.implementation.id === "fixed-recent-message-window"
    ? createFixedRecentMessageWindowAssembler({
      ...CONFIG.context,
      maxRecentMessages: (contextSelection.configuration as Record<string, unknown>).maxRecentMessages as number,
    }, contextDependencies)
    : createContextAssembler(CONFIG.context, contextDependencies);
  const planning = createSingleStepResponsePlanner(CONFIG.planning);
  const control = createSingleTurnControl(CONFIG.control);
  const model = createReferenceModelInterface(CONFIG.model);
  const environment = createControlledReferenceExecutionEnvironment(CONFIG.executionEnvironment);
  const safety = createAllowlistSafetyModule(CONFIG.safety);

  const modules: TextTurnModules = {
    input,
    context,
    planning,
    control,
    model,
    createOutputActions: (sink: OutputActionSink) => createTextOutputActions(CONFIG.outputActions, { sink }),
    createComputerUse: (environmentCapability) => createScopedComputerUse(CONFIG.computerUse, {
      environment: environmentCapability,
      verify: ({ before, after }) => {
        if (!after) return { status: "not-verified", evidence: "No after observation was available." };
        const changed = JSON.stringify(before.content) !== JSON.stringify(after.content);
        return { status: changed ? "verified" : "not-verified", evidence: changed ? "The controlled page state changed." : "The controlled page state did not change." };
      },
    }),
    createToolUse: (executor) => createToolUseModule(CONFIG.toolUse, {
      registrations: [createCalculatorAddRegistration(), createComputerClickRegistration()],
      executor,
    }),
    safety,
    environment,
  };

  return Object.freeze({
    assembly: descriptor,
    createMemorySession(scope: MemorySessionScope) {
      return createInMemorySession(scope, CONFIG.memory);
    },
    createObservability(scope: RunScope, rootDirectory: string) {
      return createJsonlObservability(CONFIG.observability, { rootDirectory, scope });
    },
    runTurn(request: Omit<TextTurnRequest, "memory"> & { readonly memory: MemorySession }) {
      return runTextTurn(request, modules);
    },
  });
}

/** Compatibility helpers return the same assembled components; task text selects a controlled scenario. */
export const createCalculatorScenarioAgent = createReferenceAgent;
export const createComputerScenarioAgent = createReferenceAgent;

function component(
  area: ReferenceAssemblyArea,
  packageName: string,
  packageVersion: string,
  implementation: ModuleIdentity,
  configuration: object,
): ReferenceAssemblyComponent {
  return Object.freeze({ area, packageName, packageVersion, implementation, configuration: configuration as JsonValue });
}

function contextComponent(strategy: ReferenceContextStrategy, maxRecentMessages?: number): ReferenceAssemblyComponent {
  const configuration = {
    ...CONFIG.context,
    ...(strategy === "fixed-recent-message-window" ? { maxRecentMessages: maxRecentMessages ?? 4 } : {}),
    budget: CONTEXT_BUDGET,
  };
  return component(
    "context",
    "@agent-harness-lab/module-context",
    "0.6.0",
    strategy === "deterministic-context-assembler"
      ? { id: strategy, version: "0.4.0" }
      : { id: strategy, version: "0.1.0" },
    configuration,
  );
}

/** Reject unknown or incompatible selections before resolving any module factories. */
export function validateReferenceAssemblyDescriptor(value: unknown): asserts value is ReferenceChatAssembly {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.id !== ASSEMBLY_ID
    || value.version !== ASSEMBLY_VERSION || value.mode !== ASSEMBLY_MODE
    || !Array.isArray(value.components) || !Array.isArray(value.limitations)) {
    throw new Error("The reference assembly descriptor has an unsupported identity, version, or shape.");
  }
  const selected = new Set<ReferenceAssemblyArea>();
  for (const raw of value.components) {
    if (!isRecord(raw) || typeof raw.area !== "string" || !AREAS.includes(raw.area as ReferenceAssemblyArea)
      || typeof raw.packageName !== "string" || typeof raw.packageVersion !== "string"
      || !isRecord(raw.implementation) || typeof raw.implementation.id !== "string" || typeof raw.implementation.version !== "string") {
      throw new Error("The reference assembly contains an invalid module selection.");
    }
    const area = raw.area as ReferenceAssemblyArea;
    const expected = area === "context" ? expectedContextComponent(raw) : STATIC_IMPLEMENTATION_REGISTRY.get(area);
    if (!expected || selected.has(area)) throw new Error(`The reference assembly has no unique registered implementation for ${area}.`);
    if (raw.packageName !== expected.packageName || raw.packageVersion !== expected.packageVersion
      || raw.implementation.id !== expected.implementation.id || raw.implementation.version !== expected.implementation.version) {
      throw new Error(`The selected implementation for ${area} is not in the static Studio registry.`);
    }
    if (canonicalJson(raw.configuration) !== canonicalJson(expected.configuration)) {
      throw new Error(`The configuration for ${area} does not match this reference assembly version.`);
    }
    selected.add(area);
  }
  if (selected.size !== AREAS.length || AREAS.some((area) => !selected.has(area))) {
    throw new Error("The reference assembly descriptor must select exactly one implementation for each of the twelve areas.");
  }
  if (!value.limitations.every((limitation) => typeof limitation === "string")) {
    throw new Error("The reference assembly limitations must be text values.");
  }
}

function expectedContextComponent(raw: Record<string, unknown>): ReferenceAssemblyComponent | undefined {
  if (raw.packageName !== "@agent-harness-lab/module-context" || raw.packageVersion !== "0.6.0"
    || !isRecord(raw.implementation) || !isRecord(raw.configuration)) return undefined;
  const id = raw.implementation.id;
  const version = raw.implementation.version;
  if (id === "deterministic-context-assembler" && version === "0.4.0") {
    return contextComponent("deterministic-context-assembler");
  }
  if (id === "fixed-recent-message-window" && version === "0.1.0") {
    const maxRecentMessages = raw.configuration.maxRecentMessages;
    if (typeof maxRecentMessages !== "number" || !Number.isInteger(maxRecentMessages) || maxRecentMessages < 1 || maxRecentMessages > 12) {
      return undefined;
    }
    return contextComponent("fixed-recent-message-window", maxRecentMessages);
  }
  return undefined;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createTokenCounter(): ContextTokenCounter {
  return {
    count(messages) {
      const bytes = messages.reduce((total, message) => total + new TextEncoder().encode(JSON.stringify(message)).byteLength, 0);
      return { value: Math.ceil(bytes / 4), basis: "utf8-bytes-div4-estimate-v1", quality: "estimated" };
    },
  };
}
