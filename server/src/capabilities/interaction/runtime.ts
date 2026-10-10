import { readFile } from "node:fs/promises";
import { capabilityHostKeyPath } from "../extensions/runtime.js";
import type { ToolCall } from "../tools/contracts.js";
import type { TaskInput, TaskQuestion } from "./contracts.js";

export async function consumeTaskInputs(runId: string, turnId: string, boundaryId: string): Promise<readonly TaskInput[]> {
  return invoke("boundary", {runId, turnId, boundaryId});
}
export async function prepareTaskQuestion(runId: string, turnId: string, call: ToolCall): Promise<TaskQuestion> {
  return invoke("question", {runId, turnId, toolCallId: call.toolCallId, question: (call.arguments as {question?: unknown})?.question});
}
export async function readTaskAnswer(runId: string, turnId: string, questionId: string): Promise<TaskInput | null> {
  return invoke("answer", {runId, turnId, questionId});
}
async function invoke<T>(operation: string, body: unknown): Promise<T> {
  const key = (await readFile(capabilityHostKeyPath(), "utf8")).trim();
  const url = new URL(`/internal/interaction/${operation}`, process.env.AGENTLAB_CAPABILITY_HOST_URL ?? `http://127.0.0.1:${process.env.AGENTLAB_API_PORT ?? "4318"}`);
  const response = await fetch(url, {method: "POST", headers: {"content-type": "application/json", authorization: `Bearer ${key}`}, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000)});
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Task interaction ${operation} rejected with HTTP ${response.status}.`); }
  const text = await response.text();
  if (Buffer.byteLength(text) > 1_048_576) throw new Error("Task interaction response exceeded its bound.");
  return JSON.parse(text) as T;
}
/** This prefix is retained by round compaction as current-task input, not summary. */
export function taskInputText(inputs: readonly TaskInput[]): string {
  return inputs.map(input => `[Live task instruction ${input.sequence}; input ${input.inputId}]\n${input.content}`).join("\n\n");
}
