import { getPlatformApiBaseUrl } from "./platformApi";

export interface TaskInput {
  inputId: string; sequence: number; kind: "steering" | "clarification_reply";
  content: string; status: "accepted" | "delivered" | "consumed" | "rejected";
  questionId?: string;
}
export interface TaskQuestion {
  questionId: string; question: string; status: "pending" | "answered" | "cancelled";
  answerInputId?: string;
}
export interface TaskInteraction { inputs: TaskInput[]; questions: TaskQuestion[] }
export async function getTaskInteraction(runId: string, signal?: AbortSignal): Promise<TaskInteraction> {
  return request(runId, { signal });
}
export async function sendTaskInput(runId: string, input: Pick<TaskInput, "inputId" | "kind" | "content" | "questionId">): Promise<{ input: TaskInput }> {
  return request(runId, { method: "POST", body: JSON.stringify(input) });
}
async function request<T>(runId: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${getPlatformApiBaseUrl()}/api/runs/${encodeURIComponent(runId)}/inputs`, { ...init, headers: { "content-type": "application/json" } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Task input could not be delivered.");
  return body as T;
}
