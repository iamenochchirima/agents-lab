import { consumeTaskInputs, prepareTaskQuestion, readTaskAnswer } from '../../../../../capabilities/interaction/runtime.js';
import type { ToolCall } from '../../../../../capabilities/tools/contracts.js';
import type { VercelWorkflowInput } from '../contracts.js';

export async function consumeInputStep(input: VercelWorkflowInput, boundaryId: string) {
  'use step';
  return consumeTaskInputs(input.runId, input.turnId ?? `${input.runId}:turn:1`, boundaryId);
}
export async function questionStep(input: VercelWorkflowInput, call: ToolCall) {
  'use step';
  return prepareTaskQuestion(input.runId, input.turnId ?? `${input.runId}:turn:1`, call);
}
export async function answerStep(input: VercelWorkflowInput, questionId: string) {
  'use step';
  return readTaskAnswer(input.runId, input.turnId ?? `${input.runId}:turn:1`, questionId);
}
consumeInputStep.maxRetries = questionStep.maxRetries = answerStep.maxRetries = 0;
