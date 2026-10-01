import { access, constants } from "node:fs/promises";
import path from "node:path";
import type { Writable } from "node:stream";
import type { AppConfig } from "../config/config.js";
import { CuaBrowserAdapter, DEFAULT_CUA_BROWSER_ORIGINS } from "../browser/index.js";
import { CuaNativeDriverOwner, inspectCuaReadiness } from "../computer/cua-driver.js";
import { createModelProvider } from "../models/factory.js";
import { asSessionId, asTurnId, type ModelRequest } from "../runtime/contracts.js";
import { LinaError, safeErrorMessage } from "../runtime/errors.js";
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

async function findExecutable(names: readonly string[]): Promise<string | undefined> {
  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter((entry) => entry.length > 0);
  for (const name of names) {
    const candidates = path.isAbsolute(name) ? [name] : pathEntries.map((entry) => path.join(entry, name));
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Keep checking the bounded candidate list.
      }
    }
  }
  return undefined;
}

async function writeCuaProbe(
  output: Writable,
  label: string,
  probe: () => Promise<{ readonly packageVersion?: string; readonly driverVersion?: string; readonly capabilityVersion?: string; readonly visualRegionCapability?: "available" | "unavailable" } | undefined>,
  close: () => Promise<void>,
): Promise<void> {
  let result: { readonly packageVersion?: string; readonly driverVersion?: string; readonly capabilityVersion?: string; readonly visualRegionCapability?: "available" | "unavailable" } | undefined;
  let failure: unknown;
  try {
    result = await probe();
  } catch (error) {
    failure = error;
  }
  try {
    await close();
  } catch (error) {
    failure ??= error;
  }
  if (failure) {
    output.write(`${label}: unavailable (${safeErrorMessage(failure)})\n`);
    return;
  }
  const identity = [result?.packageVersion ? `package ${result.packageVersion}` : undefined, result?.driverVersion ? `driver ${result.driverVersion}` : undefined, result?.capabilityVersion ? `capability ${result.capabilityVersion}` : undefined].filter(Boolean).join(", ");
  const visual = result?.visualRegionCapability ? `; visual regions ${result.visualRegionCapability}` : "";
  output.write(`${label}: ready${identity || visual ? ` (${[identity, visual.slice(2)].filter(Boolean).join("")})` : ""}\n`);
}

async function writeComputerReadiness(config: AppConfig, output: Writable): Promise<void> {
  if (!config.computerEnabled) return;
  output.write(`computer Jev credential: ${config.typeSafeApiKey ? "present" : "missing"}\n`);
  const [chrome, edge, windowManager] = await Promise.all([
    findExecutable(["google-chrome", "google-chrome-stable", "/opt/google/chrome/chrome"]),
    findExecutable(["microsoft-edge", "microsoft-edge-stable", "/opt/microsoft/msedge/msedge"]),
    findExecutable(["openbox", "fluxbox", "twm", "jwm", "gnome-shell"]),
  ]);
  output.write(`computer Chrome executable: ${chrome ? "present" : "missing"}\n`);
  output.write(`computer Edge executable: ${edge ? "present" : "missing"}\n`);
  output.write(`computer supported window manager: ${windowManager ? `present (${path.basename(windowManager)})` : "missing"}\n`);

  const manifestRoot = path.join(process.cwd(), "config");
  if (config.computerEnvironment === "ubuntu-x11-cua") {
    const owner = new CuaNativeDriverOwner({ manifestPath: path.join(manifestRoot, "cua-native-capabilities.yaml") });
    await writeCuaProbe(output, "computer native Cua", async () => {
      await owner.preflight();
      return owner.runtimeEvidence();
    }, () => owner.shutdown());
  }
  if (config.browserEnabled && (config.computerEnvironment === "browser" || config.computerEnvironment === "ubuntu-x11-cua")) {
    const adapter = new CuaBrowserAdapter({
      manifestPath: path.join(manifestRoot, "cua-browser-capabilities.yaml"),
      allowedOrigins: DEFAULT_CUA_BROWSER_ORIGINS,
    });
    await writeCuaProbe(output, "computer browser Cua", async () => {
      await adapter.preflight();
      return adapter.runtimeEvidence();
    }, () => adapter.shutdown());
  }
}

async function probeProvider(config: AppConfig): Promise<DoctorResult> {
  const provider = createModelProvider(config);
  await Workspace.open(config.workspaceRoot, {
    maxFileBytes: config.maxFileBytes,
    maxDirectoryEntries: config.maxDirectoryEntries,
    maxTreeEntries: config.maxTreeEntries,
    maxTreeBytes: config.maxTreeBytes,
    maxTreeDepth: config.maxTreeDepth,
    maxPatchSetBytes: config.maxPatchSetBytes,
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
      errorCode: error instanceof LinaError ? error.code : "provider",
      errorMessage: safeErrorMessage(error),
    };
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(firstEventTimer);
  }
}

export async function runDoctor(config: AppConfig, output: Writable): Promise<boolean> {
  output.write("Lina provider diagnostic\n");
  output.write(`provider: ${config.provider}\n`);
  output.write(`model: ${config.model}\n`);
  output.write(`workspace: ${config.workspaceRoot}\n`);
  output.write(`workspace limits: ${config.maxFileBytes} bytes/file, ${config.maxPatchSetBytes} bytes/patch set, ${config.maxTreeBytes} bytes/tree\n`);
  output.write(`browser: ${config.browserEnabled ? "enabled" : "disabled"}\n`);
  output.write(`model/tool rounds: ${config.maxModelToolRounds}\n`);
  output.write(`browser action timeout: ${config.browserActionTimeoutMs}ms\n`);
  output.write(`browser session timeout: ${config.browserSessionTimeoutMs}ms\n`);
  output.write(`browser read-only retries: ${config.browserReadRetryCount}\n`);
  output.write(`browser max tabs: ${config.browserMaxTabs}\n`);
  output.write(`browser profile retention: ${config.browserProfileRetentionMs}ms\n`);
  output.write(`browser wait maximum: ${config.browserWaitMaxMs}ms\n`);
  output.write(`browser snapshot: ${config.browserSnapshotMaxChars} chars, ${config.browserMaxSnapshotReferences} references\n`);
  output.write(`browser uploads: ${config.browserUploadMaxBytes} bytes; downloads, screenshots, and native select controls: unavailable\n`);
  output.write(`browser local hosts: ${config.browserAllowedLocalHosts.join(",") || "none"}\n`);
  output.write(`computer: ${config.computerEnabled ? `${config.computerEnvironment}/${config.computerSurface}/${config.computerStrategy}` : "disabled"}\n`);
  output.write(`computer decision/action deadline: ${config.computerDurationMs}ms\n`);
  output.write(`computer run retention: ${config.computerRunRetentionMs}ms\n`);
  output.write(`computer cleanup maximum: ${config.computerCleanupMaxEntries} entries\n`);
  output.write(`computer observation artifacts: ${config.computerArtifactsEnabled ? "enabled" : "disabled"}\n`);
  output.write(`computer artifact retention: ${config.computerArtifactRetentionMs}ms\n`);
  output.write(`computer artifact cleanup maximum: ${config.computerArtifactCleanupMaxEntries} entries\n`);
  output.write(`computer artifact bounds: ${config.computerArtifactMaxBytes} bytes, ${config.computerArtifactMaxWidth}x${config.computerArtifactMaxHeight} pixels\n`);
  if (config.computerEnabled && config.computerEnvironment === "ubuntu-x11-cua") {
    const readiness = inspectCuaReadiness();
    output.write(`computer CUA display: ${readiness.available ? `ready (${readiness.display})` : `unavailable (${readiness.reason ?? "unknown"})`}\n`);
  }
  await writeComputerReadiness(config, output);
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
    output.write(`result: failed\nerror: ${error instanceof LinaError ? error.code : "configuration"} — ${safeErrorMessage(error)}\n`);
    return false;
  }
}
