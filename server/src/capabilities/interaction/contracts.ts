/** Run input is retained separately from approvals and grants no tool authority. */
export interface TaskInput {
  readonly schemaVersion: 1;
  readonly inputId: string;
  readonly runId: string;
  readonly turnId: string;
  readonly sequence: number;
  readonly kind: "steering" | "clarification_reply";
  readonly content: string;
  readonly questionId?: string;
  readonly digest: string;
  readonly status: "accepted" | "delivered" | "consumed" | "rejected";
  readonly acceptedAt: string;
  readonly consumedAt?: string;
  readonly boundaryId?: string;
}
export interface TaskQuestion {
  readonly schemaVersion: 1;
  readonly questionId: string;
  readonly runId: string;
  readonly turnId: string;
  readonly toolCallId: string;
  readonly question: string;
  readonly status: "pending" | "answered" | "cancelled";
  readonly createdAt: string;
  readonly answerInputId?: string;
}
/** A wake notification carries identity only. Native boundaries fetch retained content. */
export interface TaskInputResume {
  readonly kind: "task_input";
  readonly runId: string;
  readonly turnId: string;
  readonly inputId: string;
  readonly sequence: number;
  readonly inputKind: TaskInput["kind"];
  readonly questionId?: string;
}
export interface TaskInteractionSnapshot {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly inputs: readonly TaskInput[];
  readonly questions: readonly TaskQuestion[];
}
