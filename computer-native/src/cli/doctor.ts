import type { Writable } from "node:stream";
import type { AppConfig } from "../config/config.js";
import { createModelProvider } from "../models/factory.js";
import { asSessionId, asTurnId, type ModelRequest } from "../runtime/contracts.js";
import { ComputerNativeError, safeErrorMessage } from "../runtime/errors.js";
import { Workspace } from "../workspace/workspace.js";

interface DoctorResult {
  readonly ok: boolean;
  readonly responseText?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

function abortError(): DOMException {
  return new DOMException("The provider diagnostic was cancelled.", "AbortError");
}

function boundedResponse(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= 240) return normalized;
  return `${normalized.slice(0, 239)}…`;
}

async function probeProvider(config: AppConfig): Promise<DoctorResult> {
  const provider = createModelProvider(config);
  await Workspace.open(config.workspaceRoot, {
    maxFileBytes: config.maxFileBytes,
    maxDirectoryEntries: config.maxDirectoryEntries,
  });
  const request: ModelRequest = {
    sessionId: asSessionId("session_doctor"),
    turnId: asTurnId("turn_doctor"),
    provider: provider.provider,
    model: provider.model,
    messages: [
      { role: "system", content: "Reply with a short provider diagnostic confirmation." },
      { role: "user", content: "Reply with OK." },
    ],
  };
  const controller = new AbortController();
  let totalTimeout = false;
  let firstEventTimeout = false;
  let firstEvent = false;
  const totalTimer = setTimeout(() => {
    totalTimeout = true;
    controller.abort("timeout");
  }, config.timeoutMs);
  const firstEventTimer = setTimeout(() => {
    if (firstEvent) return;
    firstEventTimeout = true;
    controller.abort("first-event-timeout");
  }, config.firstEventTimeoutMs);
  const text: string[] = [];
  try {
    for await (const event of provider.stream(request, controller.signal)) {
      if (!firstEvent) {
        firstEvent = true;
        clearTimeout(firstEventTimer);
      }
      if (event.type === "text") text.push(event.text);
    }
    return { ok: text.join("").trim().length > 0, responseText: boundedResponse(text.join("")), errorCode: text.join("").trim().length > 0 ? undefined : "provider-empty", errorMessage: text.join("").trim().length > 0 ? undefined : "The provider completed without a diagnostic response." };
  } catch (error) {
    if (firstEventTimeout) return { ok: false, errorCode: "first-event-timeout", errorMessage: "The provider produced no first event before the configured deadline." };
    if (totalTimeout) return { ok: false, errorCode: "timeout", errorMessage: "The provider diagnostic exceeded the configured turn deadline." };
    if (error instanceof DOMException && error.name === "AbortError") return { ok: false, errorCode: "cancelled", errorMessage: "The provider diagnostic was cancelled." };
    return {
      ok: false,
      errorCode: error instanceof ComputerNativeError ? error.code : "provider",
      errorMessage: safeErrorMessage(error),
    };
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(firstEventTimer);
  }
}

export async function runDoctor(config: AppConfig, output: Writable): Promise<boolean> {
  output.write("Computer Native provider diagnostic\n");
  output.write(`provider: ${config.provider}\n`);
  output.write(`model: ${config.model}\n`);
  output.write(`workspace: ${config.workspaceRoot}\n`);
  try {
    const result = await probeProvider(config);
    if (!result.ok) {
      output.write(`result: failed\nerror: ${result.errorCode ?? "provider"} — ${result.errorMessage ?? "The provider did not return a response."}\n`);
      return false;
    }
    output.write("result: reachable\n");
    output.write(`response: ${result.responseText}\n`);
    return true;
  } catch (error) {
    output.write(`result: failed\nerror: ${error instanceof ComputerNativeError ? error.code : "configuration"} — ${safeErrorMessage(error)}\n`);
    return false;
  }
}
