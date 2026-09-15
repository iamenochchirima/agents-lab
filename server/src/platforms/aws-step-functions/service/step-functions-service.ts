import {
  CreateActivityCommand,
  CreateStateMachineCommand,
  DescribeExecutionCommand,
  DescribeStateMachineCommand,
  GetExecutionHistoryCommand,
  ListActivitiesCommand,
  ListExecutionsCommand,
  ListStateMachinesCommand,
  StartExecutionCommand,
  StopExecutionCommand,
  UpdateStateMachineCommand,
} from "../aws-sdk.js";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type {
  PlatformExecutionReference,
  RunError,
  RunEventIntent,
  RunMetrics,
  RunResult,
  RunTrajectory,
} from "../../../control-plane/domain/types.js";
import type { AwsStepFunctionsApi, AwsStepFunctionsClientHandle } from "../client.js";
import { createAwsStepFunctionsClient } from "../client.js";
import type { AwsStepFunctionsConfig } from "../config.js";
import {
  AWS_STEP_FUNCTIONS_PLATFORM,
  AWS_STEP_FUNCTIONS_VARIANT,
} from "../config.js";
import {
  buildStateMachineDefinition,
  executionArnForStateMachine,
  executionInputFromRun,
  executionNameForRun,
} from "../variants/baseline/execution/state-machine.js";
import type {
  AwsStepFunctionsActivityOutput,
  AwsStepFunctionsAdmitResponse,
  AwsStepFunctionsDispatchResponse,
  AwsStepFunctionsNativeReference,
  AwsStepFunctionsPublicRunRecord,
  AwsStepFunctionsRunInput,
} from "../variants/baseline/contracts.js";
import { createModelRunner } from "../variants/baseline/models/factory.js";
import { AwsStepFunctionsActivityWorker, type ActivityWorkerHealth } from "./activity-worker.js";
import {
  deriveMetrics,
  deriveTrajectory,
  historyToEventIntents,
  timestampToIso,
  type AwsHistoryEvent,
} from "./history.js";

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_BODY_BYTES = 1_048_576;

interface AwsResources {
  readonly stateMachineArn: string;
  readonly activityArn: string;
  readonly definition: ReturnType<typeof buildStateMachineDefinition>;
}

interface ExecutionDescription {
  readonly executionArn: string;
  readonly stateMachineArn: string;
  readonly name: string;
  readonly status: string;
  readonly input: string | null;
  readonly output: string | null;
  readonly error: string | null;
  readonly cause: string | null;
  readonly startDate: unknown;
  readonly stopDate: unknown;
  readonly redriveCount: number;
}

export interface AwsStepFunctionsServiceOptions {
  readonly config: AwsStepFunctionsConfig;
  readonly api?: AwsStepFunctionsApi;
  readonly clientHandle?: AwsStepFunctionsClientHandle;
  readonly modelRunner?: ReturnType<typeof createModelRunner>;
  readonly now?: () => Date;
  readonly startWorker?: boolean;
}

export interface AwsStepFunctionsHealth {
  readonly status: "ready" | "degraded";
  readonly profile: AwsStepFunctionsConfig["profile"];
  readonly stateMachine: { readonly reachable: boolean; readonly arn: string | null };
  readonly activity: { readonly reachable: boolean; readonly arn: string | null };
  readonly worker: ActivityWorkerHealth;
  readonly message: string;
}

export class InvalidAwsStepFunctionsRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAwsStepFunctionsRunError";
  }
}

export class AwsStepFunctionsTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AwsStepFunctionsTransportError";
  }
}

export class AwsStepFunctionsExecutionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AwsStepFunctionsExecutionNotFoundError";
  }
}

export class AwsStepFunctionsExecutionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AwsStepFunctionsExecutionConflictError";
  }
}

/**
 * Owns AWS SDK calls, state-machine resources, the Activity worker, and the
 * platform-local HTTP boundary. The common server only sees the runner port.
 */
export class AwsStepFunctionsPlatformService {
  readonly config: AwsStepFunctionsConfig;
  private readonly api: AwsStepFunctionsApi;
  private readonly clientHandle: AwsStepFunctionsClientHandle | null;
  private readonly modelRunner: ReturnType<typeof createModelRunner>;
  private readonly now: () => Date;
  private readonly shouldStartWorker: boolean;
  private resources: AwsResources | null = null;
  private worker: AwsStepFunctionsActivityWorker | null = null;
  private initializePromise: Promise<void> | null = null;

  constructor(options: AwsStepFunctionsServiceOptions) {
    this.config = options.config;
    if (options.api) {
      this.api = options.api;
      this.clientHandle = options.clientHandle ?? null;
    } else {
      const client = options.clientHandle ?? createAwsStepFunctionsClient(options.config);
      this.api = client.api;
      this.clientHandle = client;
    }
    this.modelRunner = options.modelRunner ?? createModelRunner(options.config);
    this.now = options.now ?? (() => new Date());
    this.shouldStartWorker = options.startWorker ?? options.config.workerEnabled;
  }

  async initialize(): Promise<void> {
    if (this.resources) return;
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = this.initializeOnce();
    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = null;
    }
  }

  async close(): Promise<void> {
    await this.worker?.stop();
    this.worker = null;
    this.clientHandle?.close();
  }

  async health(): Promise<AwsStepFunctionsHealth> {
    const worker = this.worker?.health() ?? {
      status: "stopped" as const,
      lastError: null,
      processedTaskCount: 0,
    };
    if (!this.resources) {
      return {
        status: "degraded",
        profile: this.config.profile,
        stateMachine: { reachable: false, arn: null },
        activity: { reachable: false, arn: null },
        worker,
        message: "AWS Step Functions resources have not been initialized.",
      };
    }

    try {
      await this.send(new DescribeStateMachineCommand({ stateMachineArn: this.resources.stateMachineArn }));
      const workerReady = !this.shouldStartWorker || worker.status === "running";
      return {
        status: workerReady ? "ready" : "degraded",
        profile: this.config.profile,
        stateMachine: { reachable: true, arn: this.resources.stateMachineArn },
        activity: { reachable: true, arn: this.resources.activityArn },
        worker,
        message: workerReady
          ? "Step Functions state machine, Activity, and worker are reachable."
          : worker.lastError ?? "The Activity worker is not running.",
      };
    } catch (error) {
      return {
        status: "degraded",
        profile: this.config.profile,
        stateMachine: { reachable: false, arn: this.resources.stateMachineArn },
        activity: { reachable: false, arn: this.resources.activityArn },
        worker,
        message: safeMessage(error, "AWS Step Functions is unavailable."),
      };
    }
  }

  async admit(input: AwsStepFunctionsRunInput): Promise<AwsStepFunctionsAdmitResponse> {
    await this.initialize();
    assertRunInput(input);
    const resources = this.requireResources();
    return {
      runId: input.runId,
      stateMachineArn: resources.stateMachineArn,
      activityArn: resources.activityArn,
      executionName: executionNameForRun(input.runId),
    };
  }

  async dispatch(input: AwsStepFunctionsRunInput): Promise<AwsStepFunctionsDispatchResponse> {
    await this.initialize();
    assertRunInput(input);
    const resources = this.requireResources();
    const executionName = executionNameForRun(input.runId);
    const inputJson = executionInputFromRun(input);
    try {
      const response = await this.send(new StartExecutionCommand({
        stateMachineArn: resources.stateMachineArn,
        name: executionName,
        input: inputJson,
      })) as { readonly executionArn?: string; readonly startDate?: unknown };
      if (typeof response.executionArn !== "string") {
        throw new AwsStepFunctionsTransportError("Step Functions did not return an execution ARN.");
      }
      return dispatchResponse(input, resources, executionName, response.executionArn, response.startDate, "accepted", "confirmed");
    } catch (error) {
      if (isExecutionAlreadyExists(error)) {
        const existing = await this.findExistingExecution(resources.stateMachineArn, executionName);
        if (!existing) {
          throw new AwsStepFunctionsTransportError(
            "Step Functions reported a duplicate execution, but the existing execution could not be reconciled.",
          );
        }
        if (existing.input !== null && !sameJson(existing.input, inputJson)) {
          throw new AwsStepFunctionsExecutionConflictError(
            `Execution name ${executionName} is already bound to a different input.`,
          );
        }
        return dispatchResponse(
          input,
          resources,
          executionName,
          existing.executionArn,
          existing.startDate,
          "already_accepted",
          "confirmed",
        );
      }
      if (error instanceof AwsStepFunctionsTransportError) throw error;
      if (isTransportLike(error)) {
        throw new AwsStepFunctionsTransportError(
          `Step Functions start outcome is unknown: ${safeMessage(error, "request failed")}`,
        );
      }
      throw new Error(`Step Functions rejected execution start: ${safeMessage(error, "unknown rejection")}`);
    }
  }

  async inspect(
    runId: string,
    preferredExecutionArn: string | null = null,
  ): Promise<AwsStepFunctionsPublicRunRecord> {
    await this.initialize();
    assertRunId(runId);
    const resources = this.requireResources();
    const executionName = executionNameForRun(runId);
    const executionArn = preferredExecutionArn ?? await this.resolveExecutionArn(resources.stateMachineArn, executionName);

    if (!executionArn) return reconciliationRequired(runId, resources, this.config, executionName, null, this.now());

    let description: ExecutionDescription;
    try {
      description = await this.describeExecution(executionArn);
    } catch (error) {
      if (isExecutionNotFound(error)) {
        return reconciliationRequired(runId, resources, this.config, executionName, preferredExecutionArn, this.now());
      }
      throw platformTransportError("Step Functions execution inspection failed", error);
    }

    let history: readonly AwsHistoryEvent[] = [];
    try {
      history = await this.executionHistory(executionArn);
    } catch (error) {
      // DescribeExecution is eventually consistent too. Preserve the status and
      // result while making missing native history visible in the reference.
      if (!isTransportLike(error)) throw error;
    }

    const eventIntents = historyToEventIntents(runId, history);
    const projection = projectExecution(runId, description, history, this.now());
    const reference = referenceFor(
      runId,
      resources,
      this.config,
      executionName,
      description,
      projection.providerRequestId,
      "accepted",
      "confirmed",
      history,
    );
    return {
      runId,
      status: projection.status,
      reference,
      eventIntents,
      result: projection.result,
      trajectory: projection.trajectory,
      metrics: projection.metrics,
    };
  }

  async cancel(
    runId: string,
    preferredExecutionArn: string | null,
    reason: string,
  ): Promise<{ accepted: boolean; alreadyTerminal: boolean; message: string; executionArn: string | null }> {
    await this.initialize();
    assertRunId(runId);
    const resources = this.requireResources();
    const executionArn = preferredExecutionArn ?? await this.resolveExecutionArn(resources.stateMachineArn, executionNameForRun(runId));
    if (!executionArn) throw new AwsStepFunctionsExecutionNotFoundError(`No Step Functions execution was found for ${runId}.`);

    try {
      const description = await this.describeExecution(executionArn);
      if (isTerminalStatus(description.status)) {
        return {
          accepted: false,
          alreadyTerminal: true,
          message: `Step Functions execution is already ${description.status}.`,
          executionArn,
        };
      }
    } catch (error) {
      if (!isExecutionNotFound(error)) throw platformTransportError("Step Functions cancellation inspection failed", error);
    }

    try {
      await this.send(new StopExecutionCommand({
        executionArn,
        error: "AgentLabCancelled",
        cause: redactText(reason || "Cancellation requested."),
      }));
    } catch (error) {
      if (isExecutionNotFound(error)) {
        throw new AwsStepFunctionsExecutionNotFoundError(`Step Functions execution was not found: ${executionArn}`);
      }
      throw platformTransportError("Step Functions cancellation failed", error);
    }
    return {
      accepted: true,
      alreadyTerminal: false,
      message: "Step Functions accepted the cancellation request; terminal state is asynchronous.",
      executionArn,
    };
  }

  createHttpServer(): Server {
    return createServer((request, response) => {
      void this.handleRequest(request, response);
    });
  }

  private async initializeOnce(): Promise<void> {
    const activityArn = this.config.activityArn ?? await this.ensureActivity();
    const definition = buildStateMachineDefinition(activityArn, this.config);
    const stateMachineArn = this.config.stateMachineArn ?? await this.ensureStateMachine(definition);
    this.resources = { stateMachineArn, activityArn, definition };
    if (this.shouldStartWorker) {
      this.worker = new AwsStepFunctionsActivityWorker({
        api: this.api,
        config: this.config,
        modelRunner: this.modelRunner,
        now: this.now,
      });
      this.worker.start(activityArn);
    }
  }

  private async ensureActivity(): Promise<string> {
    try {
      const listed = await this.send(new ListActivitiesCommand({ maxResults: 100 })) as {
        readonly activities?: readonly { readonly name?: string; readonly activityArn?: string }[];
      };
      const existing = listed.activities?.find((activity) => activity.name === this.config.activityName);
      if (existing?.activityArn) return existing.activityArn;
      const created = await this.send(new CreateActivityCommand({ name: this.config.activityName })) as {
        readonly activityArn?: string;
      };
      if (typeof created.activityArn !== "string") throw new Error("Step Functions did not return an Activity ARN.");
      return created.activityArn;
    } catch (error) {
      if (!isResourceAlreadyExists(error)) throw platformTransportError("Step Functions Activity setup failed", error);
      const listed = await this.send(new ListActivitiesCommand({ maxResults: 100 })) as {
        readonly activities?: readonly { readonly name?: string; readonly activityArn?: string }[];
      };
      const existing = listed.activities?.find((activity) => activity.name === this.config.activityName);
      if (!existing?.activityArn) throw new Error(`Step Functions Activity was not found: ${this.config.activityName}`);
      return existing.activityArn;
    }
  }

  private async ensureStateMachine(definition: ReturnType<typeof buildStateMachineDefinition>): Promise<string> {
    const definitionJson = JSON.stringify(definition);
    try {
      const listed = await this.send(new ListStateMachinesCommand({ maxResults: 100 })) as {
        readonly stateMachines?: readonly { readonly name?: string; readonly stateMachineArn?: string }[];
      };
      const existing = listed.stateMachines?.find((machine) => machine.name === this.config.stateMachineName);
      if (existing?.stateMachineArn) {
        await this.send(new UpdateStateMachineCommand({
          stateMachineArn: existing.stateMachineArn,
          definition: definitionJson,
          roleArn: this.config.roleArn,
        }));
        return existing.stateMachineArn;
      }
      const created = await this.send(new CreateStateMachineCommand({
        name: this.config.stateMachineName,
        definition: definitionJson,
        roleArn: this.config.roleArn,
        type: "STANDARD",
      })) as { readonly stateMachineArn?: string };
      if (typeof created.stateMachineArn !== "string") throw new Error("Step Functions did not return a state-machine ARN.");
      return created.stateMachineArn;
    } catch (error) {
      if (!isResourceAlreadyExists(error)) throw platformTransportError("Step Functions state-machine setup failed", error);
      const listed = await this.send(new ListStateMachinesCommand({ maxResults: 100 })) as {
        readonly stateMachines?: readonly { readonly name?: string; readonly stateMachineArn?: string }[];
      };
      const existing = listed.stateMachines?.find((machine) => machine.name === this.config.stateMachineName);
      if (!existing?.stateMachineArn) throw new Error(`Step Functions state machine was not found: ${this.config.stateMachineName}`);
      return existing.stateMachineArn;
    }
  }

  private async resolveExecutionArn(stateMachineArn: string, executionName: string): Promise<string | null> {
    const deterministicArn = executionArnForStateMachine(stateMachineArn, executionName);
    try {
      await this.describeExecution(deterministicArn);
      return deterministicArn;
    } catch (error) {
      if (!isExecutionNotFound(error)) throw error;
    }

    try {
      const listed = await this.send(new ListExecutionsCommand({ stateMachineArn, maxResults: 1000 })) as {
        readonly executions?: readonly { readonly name?: string; readonly executionArn?: string }[];
      };
      return listed.executions?.find((execution) => execution.name === executionName)?.executionArn ?? null;
    } catch (error) {
      if (isExecutionNotFound(error)) return null;
      throw platformTransportError("Step Functions execution reconciliation failed", error);
    }
  }

  private async findExistingExecution(
    stateMachineArn: string,
    executionName: string,
  ): Promise<ExecutionDescription | null> {
    const executionArn = await this.resolveExecutionArn(stateMachineArn, executionName);
    if (!executionArn) return null;
    try {
      return await this.describeExecution(executionArn);
    } catch (error) {
      if (isExecutionNotFound(error)) return null;
      throw error;
    }
  }

  private async describeExecution(executionArn: string): Promise<ExecutionDescription> {
    const response = await this.send(new DescribeExecutionCommand({ executionArn })) as Record<string, unknown>;
    if (typeof response.executionArn !== "string" || typeof response.status !== "string") {
      throw new Error("Step Functions returned an invalid execution description.");
    }
    return {
      executionArn: response.executionArn,
      stateMachineArn: stringOr(response.stateMachineArn, this.resources?.stateMachineArn ?? ""),
      name: stringOr(response.name, ""),
      status: response.status,
      input: nullableString(response.input),
      output: nullableString(response.output),
      error: nullableString(response.error),
      cause: nullableString(response.cause),
      startDate: response.startDate,
      stopDate: response.stopDate,
      redriveCount: numberOrZero(response.redriveCount),
    };
  }

  private async executionHistory(executionArn: string): Promise<readonly AwsHistoryEvent[]> {
    const history: AwsHistoryEvent[] = [];
    let nextToken: string | undefined;
    do {
      const response = await this.send(new GetExecutionHistoryCommand({
        executionArn,
        includeExecutionData: false,
        maxResults: 1_000,
        ...(nextToken ? { nextToken } : {}),
      })) as { readonly events?: readonly AwsHistoryEvent[]; readonly nextToken?: string };
      history.push(...(response.events ?? []));
      nextToken = response.nextToken;
    } while (nextToken);
    return history;
  }

  private async send(command: object): Promise<unknown> {
    try {
      return await this.api.send(command);
    } catch (error) {
      throw error;
    }
  }

  private requireResources(): AwsResources {
    if (!this.resources) throw new Error("AWS Step Functions service has not been initialized.");
    return this.resources;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
      if (request.method === "GET" && url.pathname === "/health") {
        jsonResponse(response, 200, await this.health());
        return;
      }
      if (request.method === "POST" && url.pathname === "/runs/admit") {
        const input = parseRunInput(await readJsonBody(request));
        jsonResponse(response, 200, await this.admit(input));
        return;
      }
      if (parts.length === 3 && parts[0] === "runs" && parts[2] === "dispatch" && request.method === "POST") {
        const input = parseRunInput(await readJsonBody(request));
        if (input.runId !== parts[1]) throw new InvalidAwsStepFunctionsRunError("Run ID does not match the request path.");
        jsonResponse(response, 200, await this.dispatch(input));
        return;
      }
      if (parts.length === 2 && parts[0] === "runs" && request.method === "GET") {
        const preferred = url.searchParams.get("executionArn");
        jsonResponse(response, 200, await this.inspect(parts[1], preferred));
        return;
      }
      if (parts.length === 2 && parts[0] === "runs" && request.method === "POST") {
        const body = await readJsonBody(request);
        const reason = isRecord(body) && typeof body.reason === "string" ? body.reason : "Cancellation requested.";
        const preferred = url.searchParams.get("executionArn");
        jsonResponse(response, 200, await this.cancel(parts[1], preferred, reason));
        return;
      }
      jsonResponse(response, 404, { message: "Route not found." });
    } catch (error) {
      const status = error instanceof InvalidAwsStepFunctionsRunError ? 400
        : error instanceof AwsStepFunctionsExecutionConflictError ? 409
          : error instanceof AwsStepFunctionsExecutionNotFoundError ? 404
            : error instanceof AwsStepFunctionsTransportError ? 503
              : 500;
      jsonResponse(response, status, {
        message: redactText(safeMessage(error, "AWS Step Functions request failed.")),
        ...(error instanceof AwsStepFunctionsTransportError ? { acknowledgement: "unknown" } : {}),
      });
    }
  }
}

function projectExecution(
  runId: string,
  description: ExecutionDescription,
  history: readonly AwsHistoryEvent[],
  now: Date,
): {
  readonly status: "queued" | "running" | "completed" | "failed" | "cancelled";
  readonly result: RunResult | null;
  readonly trajectory: RunTrajectory | null;
  readonly metrics: RunMetrics | null;
  readonly providerRequestId: string | null;
} {
  const status = mapNativeStatus(description.status);
  const attempts = history.filter((event) => event.type === "ActivityStarted").length;
  if (status === "queued" || status === "running") {
    return { status, result: null, trajectory: null, metrics: null, providerRequestId: null };
  }

  if (status === "completed") {
    const parsed = parseActivityOutput(description.output, runId);
    if (parsed) {
      const trajectory = deriveTrajectory(runId, history);
      const metrics = deriveMetrics(
        runId,
        "completed",
        history,
        parsed.result.startedAt,
        parsed.result.finishedAt,
        parsed.metrics,
      );
      return {
        status,
        result: parsed.result,
        trajectory,
        metrics,
        providerRequestId: parsed.providerRequestId,
      };
    }
    const failure = internalFailure(runId, description, "Step Functions completed without a valid Activity output.", attempts, now);
    return {
      status: "failed",
      result: failure,
      trajectory: deriveTrajectory(runId, history),
      metrics: deriveMetrics(runId, "failed", history, failure.startedAt, failure.finishedAt, emptyMetrics()),
      providerRequestId: null,
    };
  }

  const result = failureFromExecution(runId, description, history, attempts, now);
  return {
    status: result.status === "cancelled" ? "cancelled" : "failed",
    result,
    trajectory: deriveTrajectory(runId, history),
    metrics: deriveMetrics(runId, result.status, history, result.startedAt, result.finishedAt, emptyMetrics()),
    providerRequestId: null,
  };
}

function referenceFor(
  runId: string,
  resources: AwsResources,
  config: AwsStepFunctionsConfig,
  executionName: string,
  description: ExecutionDescription,
  providerRequestId: string | null,
  submissionOutcome: AwsStepFunctionsNativeReference["submissionOutcome"],
  acknowledgement: AwsStepFunctionsNativeReference["acknowledgement"],
  history: readonly AwsHistoryEvent[],
): PlatformExecutionReference {
  const lastEvent = history.at(-1);
  const native: AwsStepFunctionsNativeReference = {
    schemaVersion: 1,
    profile: config.profile,
    region: config.region,
    endpointUrl: config.endpointUrl,
    stateMachineName: config.stateMachineName,
    stateMachineArn: resources.stateMachineArn,
    activityName: config.activityName,
    activityArn: resources.activityArn,
    executionName,
    executionArn: description.executionArn,
    startDate: nullableIso(description.startDate),
    stopDate: nullableIso(description.stopDate),
    nativeStatus: description.status,
    terminalStatus: isTerminalStatus(description.status) ? description.status : null,
    nativeError: description.error,
    nativeCause: description.cause ? redactText(description.cause) : null,
    historyEventCount: history.length,
    lastHistoryEventType: typeof lastEvent?.type === "string" ? lastEvent.type : null,
    retryCount: Math.max(0, history.filter((event) => event.type === "ActivityStarted").length - 1),
    providerRequestId,
    submissionOutcome,
    acknowledgement,
  };
  return {
    platform: AWS_STEP_FUNCTIONS_PLATFORM,
    variant: AWS_STEP_FUNCTIONS_VARIANT,
    executionId: `aws-step-functions:${runId}`,
    native: native as unknown as Readonly<Record<string, unknown>>,
  };
}

function dispatchResponse(
  input: AwsStepFunctionsRunInput,
  resources: AwsResources,
  executionName: string,
  executionArn: string | null,
  startDate: unknown,
  submissionOutcome: AwsStepFunctionsDispatchResponse["submissionOutcome"],
  acknowledgement: AwsStepFunctionsDispatchResponse["acknowledgement"],
): AwsStepFunctionsDispatchResponse {
  return {
    runId: input.runId,
    stateMachineArn: resources.stateMachineArn,
    activityArn: resources.activityArn,
    executionName,
    executionArn,
    startDate: nullableIso(startDate),
    submissionOutcome,
    acknowledgement,
  };
}

function reconciliationRequired(
  runId: string,
  resources: AwsResources,
  config: AwsStepFunctionsConfig,
  executionName: string,
  executionArn: string | null,
  now: Date,
): AwsStepFunctionsPublicRunRecord {
  const finishedAt = now.toISOString();
  const result: RunResult = {
    schemaVersion: 1,
    runId,
    status: "reconciliation_required",
    startedAt: null,
    finishedAt,
    output: null,
    error: {
      code: "StepFunctionsOutcomeUnknown",
      message: "The start acknowledgement was lost and no matching execution is currently visible.",
      failureKind: "outcome_unknown",
      retryable: true,
    },
    attemptCount: 0,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
  return {
    runId,
    status: "reconciliation_required",
    reference: baseReference(runId, resources, config, executionName, executionArn, "unknown", "unknown"),
    eventIntents: [],
    result,
    trajectory: { schemaVersion: 1, runId, phases: [] },
    metrics: {
      schemaVersion: 1,
      runId,
      status: "reconciliation_required",
      durationMs: null,
      modelCallCount: 0,
      modelAttemptCount: 0,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
    },
  };
}

function baseReference(
  runId: string,
  resources: AwsResources,
  config: AwsStepFunctionsConfig,
  executionName: string,
  executionArn: string | null,
  submissionOutcome: AwsStepFunctionsNativeReference["submissionOutcome"],
  acknowledgement: AwsStepFunctionsNativeReference["acknowledgement"],
): PlatformExecutionReference {
  const native: AwsStepFunctionsNativeReference = {
    schemaVersion: 1,
    profile: config.profile,
    region: config.region,
    endpointUrl: config.endpointUrl,
    stateMachineName: config.stateMachineName,
    stateMachineArn: resources.stateMachineArn,
    activityName: config.activityName,
    activityArn: resources.activityArn,
    executionName,
    executionArn,
    startDate: null,
    stopDate: null,
    nativeStatus: executionArn ? "PENDING" : "UNKNOWN",
    terminalStatus: null,
    nativeError: null,
    nativeCause: null,
    historyEventCount: 0,
    lastHistoryEventType: null,
    retryCount: 0,
    providerRequestId: null,
    submissionOutcome,
    acknowledgement,
  };
  return {
    platform: AWS_STEP_FUNCTIONS_PLATFORM,
    variant: AWS_STEP_FUNCTIONS_VARIANT,
    executionId: `aws-step-functions:${runId}`,
    native: native as unknown as Readonly<Record<string, unknown>>,
  };
}

function failureFromExecution(
  runId: string,
  description: ExecutionDescription,
  history: readonly AwsHistoryEvent[],
  attempts: number,
  now: Date,
): RunResult {
  const timedOut = description.status === "TIMED_OUT" || description.error === "States.Timeout";
  const cancelled = description.status === "ABORTED";
  const cause = parseFailureCause(description.cause);
  return {
    schemaVersion: 1,
    runId,
    status: cancelled ? "cancelled" : "failed",
    startedAt: nullableIso(description.startDate),
    finishedAt: nullableIso(description.stopDate) ?? now.toISOString(),
    output: null,
    error: cancelled
      ? { code: "AgentLabCancelled", message: "The Step Functions execution was aborted.", failureKind: "cancelled", retryable: false }
      : {
          code: cause.code ?? description.error ?? (timedOut ? "States.Timeout" : "StepFunctionsExecutionFailed"),
          message: cause.message ?? description.cause ?? (timedOut ? "The Step Functions execution timed out." : "The Step Functions execution failed."),
          failureKind: timedOut ? "timeout" : cause.failureKind ?? "internal",
          retryable: cause.retryable ?? false,
        },
    attemptCount: attempts,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
}

function internalFailure(
  runId: string,
  description: ExecutionDescription,
  message: string,
  attempts: number,
  now: Date,
): RunResult {
  return {
    schemaVersion: 1,
    runId,
    status: "failed",
    startedAt: nullableIso(description.startDate),
    finishedAt: nullableIso(description.stopDate) ?? now.toISOString(),
    output: null,
    error: { code: "InvalidActivityOutput", message, failureKind: "internal", retryable: false },
    attemptCount: attempts,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
}

function parseActivityOutput(raw: string | null, runId: string): AwsStepFunctionsActivityOutput | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AwsStepFunctionsActivityOutput>;
    if (
      parsed.schemaVersion !== 1 ||
      !parsed.result ||
      parsed.result.schemaVersion !== 1 ||
      parsed.result.runId !== runId ||
      parsed.result.status !== "completed" ||
      !parsed.trajectory ||
      !parsed.metrics
    ) return null;
    return parsed as AwsStepFunctionsActivityOutput;
  } catch {
    return null;
  }
}

function parseFailureCause(raw: string | null): {
  readonly code: string | null;
  readonly message: string | null;
  readonly failureKind: RunError["failureKind"] | null;
  readonly retryable: boolean | null;
} {
  if (!raw) return { code: null, message: null, failureKind: null, retryable: null };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      code: typeof parsed.code === "string" ? parsed.code : null,
      message: typeof parsed.message === "string" ? redactText(parsed.message) : null,
      failureKind: isFailureKind(parsed.failureKind) ? parsed.failureKind : null,
      retryable: typeof parsed.retryable === "boolean" ? parsed.retryable : null,
    };
  } catch {
    return { code: null, message: redactText(raw), failureKind: null, retryable: null };
  }
}

function mapNativeStatus(status: string): "queued" | "running" | "completed" | "failed" | "cancelled" {
  switch (status) {
    case "RUNNING": return "running";
    case "SUCCEEDED": return "completed";
    case "ABORTED": return "cancelled";
    case "FAILED":
    case "TIMED_OUT":
    case "PENDING_REDRIVE":
      return "failed";
    default: return "queued";
  }
}

function isTerminalStatus(status: string): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "TIMED_OUT" || status === "ABORTED";
}

function assertRunInput(input: AwsStepFunctionsRunInput): void {
  assertRunId(input.runId);
  if (!input.prompt.trim()) throw new InvalidAwsStepFunctionsRunError("Prompt must not be empty.");
  if (!input.systemInstruction.trim()) throw new InvalidAwsStepFunctionsRunError("System instruction must not be empty.");
  if (input.provider !== "fake" && input.provider !== "openrouter") {
    throw new InvalidAwsStepFunctionsRunError("Model provider must be fake or openrouter.");
  }
  if (!input.model.trim()) throw new InvalidAwsStepFunctionsRunError("Model name must not be empty.");
}

function parseRunInput(value: unknown): AwsStepFunctionsRunInput {
  if (
    !isRecord(value) ||
    typeof value.runId !== "string" ||
    typeof value.prompt !== "string" ||
    typeof value.systemInstruction !== "string" ||
    typeof value.model !== "string" ||
    (value.provider !== "fake" && value.provider !== "openrouter")
  ) throw new InvalidAwsStepFunctionsRunError("Request body does not match the Step Functions baseline input.");
  const input = value as unknown as AwsStepFunctionsRunInput;
  assertRunInput(input);
  return input;
}

function assertRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) throw new InvalidAwsStepFunctionsRunError("Run ID contains unsupported characters.");
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new InvalidAwsStepFunctionsRunError("Request body is too large.");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InvalidAwsStepFunctionsRunError("Request body must be valid JSON.");
  }
}

function jsonResponse(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
  response.end(payload);
}

function sameJson(left: string, right: string): boolean {
  try {
    return stableJson(JSON.parse(left)) === stableJson(JSON.parse(right));
  } catch {
    return left === right;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isExecutionAlreadyExists(error: unknown): boolean {
  return errorName(error) === "ExecutionAlreadyExists";
}

function isResourceAlreadyExists(error: unknown): boolean {
  const name = errorName(error);
  return name === "ActivityAlreadyExists" || name === "StateMachineAlreadyExists";
}

function isExecutionNotFound(error: unknown): boolean {
  return errorName(error) === "ExecutionDoesNotExist";
}

function isTransportLike(error: unknown): boolean {
  if (error instanceof AwsStepFunctionsTransportError) return true;
  const name = errorName(error);
  const message = safeMessage(error, "");
  return name === "TimeoutError" || name === "AbortError" || name === "NetworkingError" ||
    /ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket|network|fetch failed/i.test(message);
}

function platformTransportError(prefix: string, error: unknown): AwsStepFunctionsTransportError {
  return new AwsStepFunctionsTransportError(`${prefix}: ${safeMessage(error, "request failed")}`);
}

function errorName(error: unknown): string | null {
  return error instanceof Error && typeof error.name === "string" ? error.name : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

function nullableIso(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return timestampToIso(value as Date | string | number);
}

function emptyMetrics(): RunMetrics {
  return {
    schemaVersion: 1,
    runId: "",
    status: "failed",
    durationMs: null,
    modelCallCount: 0,
    modelAttemptCount: 0,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    costUsd: null,
  };
}

function isFailureKind(value: unknown): value is RunError["failureKind"] {
  return value === "validation" || value === "configuration" || value === "pre_dispatch" ||
    value === "provider" || value === "timeout" || value === "cancelled" || value === "outcome_unknown" ||
    value === "internal" || value === "reconciliation";
}

function redactText(value: string): string {
  return value
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/(?:api[_-]?key|secret|password)\s*[:=]\s*[^\s,}]+/gi, "$1=[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted]")
    .slice(0, 32_768);
}
