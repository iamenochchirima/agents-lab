import type { AwsStepFunctionsApi } from "../../../src/platforms/aws-step-functions/client.js";
import { loadAwsStepFunctionsConfig, type AwsStepFunctionsConfig } from "../../../src/platforms/aws-step-functions/config.js";
import type { AwsHistoryEvent } from "../../../src/platforms/aws-step-functions/service/history.js";
import type { AwsStepFunctionsActivityOutput } from "../../../src/platforms/aws-step-functions/variants/baseline/contracts.js";

export const STATE_MACHINE_ARN = "arn:aws:states:us-east-1:012345678901:stateMachine:AgentLabAwsStepFunctionsBaseline";
export const ACTIVITY_ARN = "arn:aws:states:us-east-1:012345678901:activity:AgentLabAwsStepFunctionsModel";

export function testConfig(overrides: Record<string, string> = {}): AwsStepFunctionsConfig {
  return loadAwsStepFunctionsConfig({
    AGENTLAB_AWS_STEP_FUNCTIONS_WORKER_ENABLED: "false",
    ...overrides,
  });
}

export function commandName(command: object): string {
  return (command as { readonly constructor: { readonly name: string } }).constructor.name;
}

export function commandInput(command: object): Record<string, unknown> {
  return (command as { readonly input: Record<string, unknown> }).input;
}

export function awsError(name: string, message = name): Error {
  return Object.assign(new Error(message), { name });
}

export interface FakeExecution {
  readonly executionArn: string;
  readonly stateMachineArn: string;
  readonly name: string;
  input: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "ABORTED";
  output: string | undefined;
  error: string | undefined;
  cause: string | undefined;
  startDate: Date;
  stopDate: Date | undefined;
  history: AwsHistoryEvent[];
}

export class FakeStepFunctionsApi implements AwsStepFunctionsApi {
  readonly commands: string[] = [];
  readonly executions = new Map<string, FakeExecution>();
  readonly activityArn = ACTIVITY_ARN;
  readonly stateMachineArn = STATE_MACHINE_ARN;
  private readonly activities = new Set<string>();
  private readonly stateMachines = new Set<string>();

  async send(command: object): Promise<unknown> {
    const name = commandName(command);
    const input = commandInput(command);
    this.commands.push(name);
    switch (name) {
      case "ListActivitiesCommand":
        return { activities: this.activities.has(this.activityArn) ? [{ name: "AgentLabAwsStepFunctionsModel", activityArn: this.activityArn }] : [] };
      case "CreateActivityCommand":
        this.activities.add(this.activityArn);
        return { activityArn: this.activityArn };
      case "ListStateMachinesCommand":
        return { stateMachines: this.stateMachines.has(this.stateMachineArn) ? [{ name: "AgentLabAwsStepFunctionsBaseline", stateMachineArn: this.stateMachineArn }] : [] };
      case "CreateStateMachineCommand":
        this.stateMachines.add(this.stateMachineArn);
        return { stateMachineArn: this.stateMachineArn };
      case "UpdateStateMachineCommand":
        return {};
      case "DescribeStateMachineCommand":
        if (!this.stateMachines.has(String(input.stateMachineArn))) throw awsError("StateMachineDoesNotExist");
        return { stateMachineArn: this.stateMachineArn, status: "ACTIVE" };
      case "StartExecutionCommand":
        return this.startExecution(input);
      case "DescribeExecutionCommand":
        return this.describeExecution(String(input.executionArn));
      case "ListExecutionsCommand":
        return { executions: [...this.executions.values()].map((execution) => ({ name: execution.name, executionArn: execution.executionArn })) };
      case "GetExecutionHistoryCommand": {
        const execution = this.mustGetExecution(String(input.executionArn));
        return { events: execution.history };
      }
      case "StopExecutionCommand": {
        const execution = this.mustGetExecution(String(input.executionArn));
        execution.status = "ABORTED";
        execution.error = String(input.error ?? "AgentLabCancelled");
        execution.cause = String(input.cause ?? "Cancellation requested.");
        execution.stopDate = new Date("2026-09-15T10:00:02.000Z");
        execution.history.push({ id: execution.history.length + 1, type: "ExecutionAborted", timestamp: execution.stopDate });
        return {};
      }
      case "GetActivityTaskCommand":
        return {};
      default:
        throw new Error(`Unexpected fake AWS command: ${name}`);
    }
  }

  complete(executionArn: string, output: AwsStepFunctionsActivityOutput): void {
    const execution = this.mustGetExecution(executionArn);
    execution.status = "SUCCEEDED";
    execution.output = JSON.stringify(output);
    execution.stopDate = new Date("2026-09-15T10:00:01.000Z");
    execution.history.push(
      { id: 3, type: "ActivitySucceeded", timestamp: execution.stopDate, activitySucceededEventDetails: { name: "AgentLabAwsStepFunctionsModel" } },
      { id: 4, type: "ExecutionSucceeded", timestamp: execution.stopDate },
    );
  }

  private startExecution(input: Record<string, unknown>): { readonly executionArn: string; readonly startDate: Date } {
    const name = String(input.name);
    const existing = [...this.executions.values()].find((execution) => execution.name === name);
    if (existing) throw awsError("ExecutionAlreadyExists");
    const executionArn = `${STATE_MACHINE_ARN.replace(":stateMachine:", ":execution:")}:${name}`;
    const startDate = new Date("2026-09-15T10:00:00.000Z");
    const execution: FakeExecution = {
      executionArn,
      stateMachineArn: STATE_MACHINE_ARN,
      name,
      input: String(input.input),
      status: "RUNNING",
      output: undefined,
      error: undefined,
      cause: undefined,
      startDate,
      stopDate: undefined,
      history: [
        { id: 1, type: "ExecutionStarted", timestamp: startDate },
        { id: 2, type: "ActivityStarted", timestamp: startDate, activityStartedEventDetails: { name: "AgentLabAwsStepFunctionsModel" } },
      ],
    };
    this.executions.set(executionArn, execution);
    return { executionArn, startDate };
  }

  private describeExecution(executionArn: string): Record<string, unknown> {
    const execution = this.mustGetExecution(executionArn);
    return {
      executionArn: execution.executionArn,
      stateMachineArn: execution.stateMachineArn,
      name: execution.name,
      status: execution.status,
      input: execution.input,
      output: execution.output,
      error: execution.error,
      cause: execution.cause,
      startDate: execution.startDate,
      stopDate: execution.stopDate,
    };
  }

  private mustGetExecution(executionArn: string): FakeExecution {
    const execution = this.executions.get(executionArn);
    if (!execution) throw awsError("ExecutionDoesNotExist");
    return execution;
  }
}

export function successfulActivityOutput(runId: string): AwsStepFunctionsActivityOutput {
  return {
    schemaVersion: 1,
    result: {
      schemaVersion: 1,
      runId,
      status: "completed",
      startedAt: "2026-09-15T10:00:00.000Z",
      finishedAt: "2026-09-15T10:00:01.000Z",
      output: "done",
      error: null,
      attemptCount: 1,
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    },
    trajectory: {
      schemaVersion: 1,
      runId,
      phases: [{ name: "model-call", startedAt: "2026-09-15T10:00:00.000Z", finishedAt: "2026-09-15T10:00:01.000Z" }],
    },
    metrics: {
      schemaVersion: 1,
      runId,
      status: "completed",
      durationMs: 1_000,
      modelCallCount: 1,
      modelAttemptCount: 1,
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 5,
      costUsd: null,
    },
    providerRequestId: "provider-1",
  };
}
