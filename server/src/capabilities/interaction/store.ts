import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TaskInput, TaskInteractionSnapshot, TaskQuestion } from "./contracts.js";

const safe = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
interface State extends TaskInteractionSnapshot { boundaries: Record<string, readonly string[]> }
export class TaskInteractionError extends Error {}

/** Single API owner serializes acceptance and dispatch gates. Atomic rename saves
 * inputs, questions and boundary acknowledgements together. This is not a lease
 * for several API processes sharing a directory. Workers use the host API.
 */
export class TaskInteractionStore {
  private readonly locks = new Map<string, Promise<void>>();
  constructor(private readonly runsRoot: string, private readonly now = Date.now) {}
  async locked<T>(runId: string, action: () => Promise<T>): Promise<T> {
    assertId(runId);
    const prior = this.locks.get(runId) ?? Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    this.locks.set(runId, pending);
    await prior;
    try { return await action(); }
    finally { release(); if (this.locks.get(runId) === pending) this.locks.delete(runId); }
  }
  async read(runId: string): Promise<TaskInteractionSnapshot> {
    const { boundaries: _boundaries, ...snapshot } = await this.state(runId);
    return snapshot;
  }
  async accept(input: {runId: string; turnId: string; inputId: string; kind: TaskInput["kind"]; content: string; questionId?: string}, before?: () => Promise<void>): Promise<TaskInput> {
    assertId(input.turnId); assertId(input.inputId); assertContent(input.content);
    if (!["steering", "clarification_reply"].includes(input.kind)) throw new TaskInteractionError("Unknown input kind.");
    return this.locked(input.runId, async () => {
      const state = await this.state(input.runId);
      const digest = hash(JSON.stringify([input.turnId, input.kind, input.content, input.questionId ?? null]));
      const existing = state.inputs.find(item => item.inputId === input.inputId);
      if (existing) { if (existing.digest !== digest) throw new TaskInteractionError("Input identity has a conflicting payload."); return existing; }
      await before?.();
      if (state.inputs.length >= 256) throw new TaskInteractionError("This run reached its input limit.");
      if (input.kind === "clarification_reply") {
        const question = state.questions.find(item => item.questionId === input.questionId && item.turnId === input.turnId);
        if (!question || question.status !== "pending" || question.answerInputId) throw new TaskInteractionError("This question is not awaiting an answer.");
      } else if (input.questionId) throw new TaskInteractionError("Steering cannot answer a question.");
      const value: TaskInput = {...input, schemaVersion: 1, digest, status: "accepted", sequence: state.inputs.length + 1, acceptedAt: new Date(this.now()).toISOString()};
      const questions = state.questions.map(question => question.questionId === input.questionId ? {...question, answerInputId: input.inputId} : question);
      await this.write({...state, inputs: [...state.inputs, value], questions});
      return value;
    });
  }
  async question(input: {runId: string; turnId: string; toolCallId: string; question: string}): Promise<TaskQuestion> {
    assertId(input.turnId); assertId(input.toolCallId); assertContent(input.question);
    return this.locked(input.runId, async () => {
      const state = await this.state(input.runId);
      const existing = state.questions.find(item => item.toolCallId === input.toolCallId);
      if (existing) {
        if (existing.turnId !== input.turnId || existing.question !== input.question) throw new TaskInteractionError("Question call identity changed.");
        return existing;
      }
      if (state.questions.length >= 128) throw new TaskInteractionError("This run reached its question limit.");
      const value: TaskQuestion = {...input, schemaVersion: 1, questionId: hash(`${input.runId}:${input.toolCallId}`), status: "pending", createdAt: new Date(this.now()).toISOString()};
      await this.write({...state, questions: [...state.questions, value]});
      return value;
    });
  }
  /** Exact boundary retries return their original inputs, including after restart. */
  async consume(runId: string, turnId: string, boundaryId: string): Promise<readonly TaskInput[]> {
    assertId(turnId); assertId(boundaryId);
    return this.locked(runId, async () => {
      const state = await this.state(runId);
      const previous = state.boundaries[boundaryId];
      if (previous) return state.inputs.filter(item => previous.includes(item.inputId));
      const pending = state.inputs.filter(item => item.turnId === turnId && item.kind === "steering" && ["accepted", "delivered"].includes(item.status));
      const consumedAt = new Date(this.now()).toISOString();
      const cancelledQuestions = pending.length ? state.questions.filter(question => question.turnId === turnId && question.status === "pending").map(question => question.questionId) : [];
      const inputs = state.inputs.map(item => pending.some(value => value.inputId === item.inputId)
        ? {...item, status: "consumed" as const, consumedAt, boundaryId}
        : item.kind === "clarification_reply" && item.questionId && cancelledQuestions.includes(item.questionId) && ["accepted", "delivered"].includes(item.status)
          ? {...item, status: "rejected" as const} : item);
      await this.write({...state, inputs, questions: pending.length ? state.questions.map(question => question.turnId === turnId && question.status === "pending" ? {...question, status: "cancelled" as const} : question) : state.questions, boundaries: {...state.boundaries, [boundaryId]: pending.map(item => item.inputId)}});
      return inputs.filter(item => pending.some(value => value.inputId === item.inputId));
    });
  }
  async answer(runId: string, turnId: string, questionId: string): Promise<TaskInput | null> {
    assertId(questionId); assertId(turnId);
    return this.locked(runId, async () => {
      const state = await this.state(runId);
      const question = state.questions.find(item => item.questionId === questionId && item.turnId === turnId);
      if (!question) throw new TaskInteractionError("Question not found for this turn.");
      if (question.status === "cancelled") throw new TaskInteractionError("Question was cancelled.");
      const answer = state.inputs.find(item => item.inputId === question.answerInputId);
      if (!answer) return null;
      const value = answer.status === "consumed" ? answer : {...answer, status: "consumed" as const, consumedAt: new Date(this.now()).toISOString(), boundaryId: `question:${questionId}`};
      await this.write({...state, inputs: state.inputs.map(item => item.inputId === value.inputId ? value : item), questions: state.questions.map(item => item.questionId === questionId ? {...item, status: "answered" as const} : item)});
      return value;
    });
  }
  async delivered(runId: string, inputId: string): Promise<void> {
    await this.locked(runId, async () => {
      const state = await this.state(runId);
      await this.write({...state, inputs: state.inputs.map(item => item.inputId === inputId && item.status === "accepted" ? {...item, status: "delivered" as const} : item)});
    });
  }
  /** Caller holds locked(). Used immediately before committing an external dispatch. */
  async hasPendingSteering(runId: string): Promise<boolean> {
    return (await this.state(runId)).inputs.some(item => item.kind === "steering" && ["accepted", "delivered"].includes(item.status));
  }
  async close(runId: string): Promise<void> {
    await this.locked(runId, async () => {
      const state = await this.state(runId);
      await this.write({...state, inputs: state.inputs.map(item => ["accepted", "delivered"].includes(item.status) ? {...item, status: "rejected" as const} : item), questions: state.questions.map(item => item.status === "pending" ? {...item, status: "cancelled" as const} : item)});
    });
  }
  private async state(runId: string): Promise<State> {
    assertId(runId);
    try {
      const state = JSON.parse(await readFile(this.path(runId), "utf8")) as State;
      if (state.schemaVersion !== 1 || state.runId !== runId || !Array.isArray(state.inputs) || !Array.isArray(state.questions) || !state.boundaries) throw new TaskInteractionError("Invalid retained task input state.");
      return state;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {schemaVersion: 1, runId, inputs: [], questions: [], boundaries: {}}; throw error; }
  }
  private path(runId: string): string { return join(this.runsRoot, runId, "interaction", "state.json"); }
  private async write(state: State): Promise<void> {
    const directory = join(this.runsRoot, state.runId, "interaction");
    await mkdir(directory, {recursive: true});
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(state, null, 2), {mode: 0o600});
    await rename(temporary, this.path(state.runId));
  }
}
function assertId(value: string): void { if (typeof value !== "string" || !safe.test(value)) throw new TaskInteractionError("Invalid task input identity."); }
function assertContent(value: string): void { if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > 16_384) throw new TaskInteractionError("Task input requires 1 to 16384 bytes of text."); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
