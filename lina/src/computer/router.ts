import { createHash } from "node:crypto";
import { stableStringify } from "../persistence/json.js";
import { ToolExecutionError } from "../runtime/errors.js";
import type { ComputerContext, ComputerEvent, ComputerOutcome } from "./runner.js";
import type { TypeSafeModelEvidence } from "./contracts.js";
import { addComputerTaskGrantBinding, bindComputerTaskGrant, ComputerTaskCompileError, type ComputerTaskActionClass, type ComputerTaskApprovalRequest, type ComputerTaskGrantState, type ComputerTaskSpec } from "./task.js";
import {
  routeComputerRequest,
  strategyLabel,
  strategyOrder,
  type ComputerSelectableStrategy,
  type ComputerStrategyPolicy,
  type ComputerSurface,
  type ComputerSurfacePolicy,
} from "./routing.js";

export interface ComputerPath {
  run(callId: string, rawGoal: unknown, context: ComputerContext): Promise<ComputerOutcome>;
}

export interface ComputerPathFactory {
  readonly availableStrategies: {
    readonly typesafe: boolean;
    readonly traditional: boolean;
  };
  /** Capability and health proof required before task approval or execution. */
  readonly preflight?: () => Promise<void>;
  create(strategy: ComputerSelectableStrategy): ComputerPath;
}

export type ComputerRunExclusive = <T>(operation: () => Promise<T>) => Promise<T>;

export interface ComputerRouterOptions {
  readonly surface?: ComputerSurfacePolicy;
  readonly preferredSurface?: ComputerSurface;
  readonly strategy: ComputerStrategyPolicy;
  readonly browser?: ComputerPathFactory;
  readonly desktop?: ComputerPathFactory;
  /** Serializes complete task runs around the shared runtime-owned state. */
  readonly browserRunExclusive?: ComputerRunExclusive;
  readonly desktopRunExclusive?: ComputerRunExclusive;
  /** Serializes all computer surfaces, including a mixed browser/native run. */
  readonly computerRunExclusive?: ComputerRunExclusive;
  /** Proves the configured Jev model before a task reaches approval. */
  readonly typeSafePreflight?: (signal?: AbortSignal) => Promise<TypeSafeModelEvidence>;
  /** Compiles the route-specific, code-owned task grant before any runner starts. */
  readonly compileTask?: (input: { readonly taskId: string; readonly goal: string; readonly surface: "browser" | "native" }) => ComputerTaskSpec;
}

const FALLBACK_ERROR_CODES = new Set([
  "computer-no-candidate",
  "computer-confidence-abstention",
  "computer-blocked",
  "computer-malformed-response",
  "computer-provider-timeout",
]);

function goal(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolExecutionError("The computer goal must be a non-empty string.");
  }
  const normalized = value.trim();
  if (normalized.length > 1_000) throw new ToolExecutionError("The computer goal is limited to 1000 characters.");
  return normalized;
}

function unavailableOutcome(status: "ambiguous" | "unavailable" | "strategy-unavailable", reason: string): ComputerOutcome {
  return {
    ok: false,
    status: status === "ambiguous" ? "clarification-required" : "failed",
    content: stableStringify({ status, reason }),
    summary: reason,
    errorCode: status === "ambiguous" ? "computer-surface-ambiguous" : status === "strategy-unavailable" ? "computer-strategy-unavailable" : "computer-surface-unavailable",
  };
}

function mixedSurfaceOutcome(reason: string): ComputerOutcome {
  return {
    ok: false,
    status: "clarification-required",
    content: stableStringify({ status: "clarification-required", boundary: "mixed-surface", reason }),
    summary: reason,
    errorCode: "computer-surface-ambiguous",
  };
}

const MIXED_URL_PATTERN = /(?<url>(?:https?:\/\/)?(?:(?:localhost|127(?:\.\d{1,3}){3})|(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})(?::\d{1,5})?(?:\/[^\s<>"']*)?)/iu;
const MIXED_NATIVE_TARGET_PATTERN = /\b(?:write|type|enter|put)\s+(?:it|that|the\s+heading)\s+(?:in|into)\s+(?:the\s+)?(?<application>text\s+editor|notes?|calendar|clocks?|calculator)\b/iu;

function mixedTaskParts(goal: string): { readonly browserGoal: string; readonly nativeApplication: string } | undefined {
  const url = goal.match(MIXED_URL_PATTERN)?.groups?.url?.replace(/[),.!?]+$/u, "");
  const application = goal.match(MIXED_NATIVE_TARGET_PATTERN)?.groups?.application;
  if (!url || !application || !/\b(?:heading|title)\b/iu.test(goal)) return undefined;
  const normalizedApplication = application.toLocaleLowerCase().replace(/\s+/gu, " ");
  const nativeApplication = normalizedApplication === "text editor" ? "Text Editor"
    : normalizedApplication.startsWith("note") ? "Notes"
      : normalizedApplication.startsWith("calendar") ? "Calendar"
        : normalizedApplication.startsWith("clock") ? "Clocks"
          : "Calculator";
  return {
    browserGoal: `Open ${/^https?:\/\//iu.test(url) ? url : `https://${url}`} and tell me the page heading.`,
    nativeApplication,
  };
}

function mixedHeading(content: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    if (record.status !== "completed" || record.verification !== "browser-heading") return undefined;
    // The browser runner uses `evidence` for a read-only completion and
    // `verificationEvidence` for an action completion. Both are part of the
    // bounded child outcome; neither is accepted without the completed
    // browser-heading verifier above.
    const evidence = record.evidence ?? record.verificationEvidence;
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return undefined;
    const heading = (evidence as Record<string, unknown>).observed;
    return typeof heading === "string" && heading.length > 0 && heading.length <= 512 && heading !== "absent" ? heading : undefined;
  } catch {
    return undefined;
  }
}

function canFallback(outcome: ComputerOutcome): boolean {
  return outcome.ok === false && outcome.errorCode !== undefined && FALLBACK_ERROR_CODES.has(outcome.errorCode);
}

function taskFailure(error: ComputerTaskCompileError): ComputerOutcome {
  return {
    ok: false,
    status: "clarification-required",
    content: stableStringify({ status: "clarification-required", code: error.code, reason: error.message }),
    summary: error.message,
    errorCode: "computer-task-invalid",
  };
}

function preflightFailure(surface: ComputerSurface | "mixed", error: unknown): ComputerOutcome {
  const reason = error instanceof Error ? error.message : `The ${surface} Cua runtime failed readiness checks.`;
  return {
    ok: false,
    status: "failed",
    content: stableStringify({ status: "failed", surface, reason }),
    summary: reason,
    errorCode: "computer-driver-failure",
  };
}

function decoratedStarted(
  event: Extract<ComputerEvent, { readonly type: "started" }>,
  surface: ComputerSurface,
  policy: ComputerStrategyPolicy,
  reason: string,
  fallbackFrom: ComputerSelectableStrategy | undefined,
  fallbackReason: string | undefined,
): Extract<ComputerEvent, { readonly type: "started" }> {
  return {
    ...event,
    surface,
    strategyPolicy: policy,
    routingReason: reason,
    ...(fallbackFrom ? { fallbackFrom } : {}),
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

/**
 * The router owns only admission and path selection. Browser and native runners
 * retain observation, approval, input, verification, and recovery semantics.
 * A failed automatic decision is buffered until the router knows whether it is
 * safe to try the one permitted alternative before approval.
 */
export class ComputerRouter {
  constructor(private readonly options: ComputerRouterOptions) {}

  async run(callId: string, rawGoal: unknown, context: ComputerContext = {}): Promise<ComputerOutcome> {
    const requestGoal = goal(rawGoal);
    if (this.options.computerRunExclusive) {
      const nestedOptions = { ...this.options, computerRunExclusive: undefined };
      return this.options.computerRunExclusive(() => new ComputerRouter(nestedOptions).run(callId, requestGoal, context));
    }
    const routingGoal = context.routingGoal ?? requestGoal;
    const taskGoal = context.taskGoal ?? requestGoal;
    const availableSurfaces: ComputerSurface[] = [
      ...(this.options.browser ? ["browser" as const] : []),
      ...(this.options.desktop ? ["desktop" as const] : []),
    ];
    const route = routeComputerRequest(routingGoal, {
      surface: this.options.surface,
      preferredSurface: this.options.preferredSurface,
      availableSurfaces,
    });
    await context.onComputer?.({
      type: "routed",
      strategy: this.options.strategy,
      surface: route.surface,
      reason: route.reason,
    });
    if (route.kind === "mixed-surface") return this.runMixed(callId, taskGoal, context, availableSurfaces);
    if (route.surface === "ambiguous" || route.surface === "unavailable") {
      return unavailableOutcome(route.surface, route.reason);
    }

    let task: ComputerTaskSpec | undefined;
    if (this.options.compileTask) {
      try {
        task = this.options.compileTask({
          taskId: `computer_${callId.replace(/[^a-zA-Z0-9_.:-]/gu, "_").slice(0, 96)}`,
          goal: taskGoal,
          surface: route.surface === "browser" ? "browser" : "native",
        });
      } catch (error) {
        if (error instanceof ComputerTaskCompileError) return taskFailure(error);
        throw error;
      }
    }

    const factory = route.surface === "browser" ? this.options.browser : this.options.desktop;
    if (!factory) return unavailableOutcome("unavailable", route.reason);
    try {
      await factory.preflight?.();
    } catch (error) {
      return preflightFailure(route.surface, error);
    }
    const order = strategyOrder(this.options.strategy, factory.availableStrategies);
    if (order.length === 0) {
      const reason = `No configured ${strategyLabel(this.options.strategy)} strategy is available for the ${route.surface}.`;
      await context.onComputer?.({ type: "failed", strategy: this.options.strategy === "auto" ? "typesafe" : this.options.strategy, reason, errorCode: "computer-strategy-unavailable" });
      return unavailableOutcome("strategy-unavailable", reason);
    }

    let typeSafeModel = context.typeSafeModel;
    if (order.includes("typesafe") && !typeSafeModel) {
      if (!this.options.typeSafePreflight) {
        return preflightFailure(route.surface, new ToolExecutionError("The TypeSafe model readiness probe is not configured."));
      }
      try {
        typeSafeModel = await this.options.typeSafePreflight(context.signal);
      } catch (error) {
        return preflightFailure(route.surface, error);
      }
    }

    let fallbackFrom: ComputerSelectableStrategy | undefined;
    let fallbackReason: string | undefined;
    for (let index = 0; index < order.length; index += 1) {
      const selectedStrategy = order[index];
      if (!selectedStrategy) continue;
      const path = factory.create(selectedStrategy);
      const buffer: ComputerEvent[] = [];
      let inputRequested = false;
      const buffering = this.options.strategy === "auto" && index < order.length - 1;
      const childContext: ComputerContext = {
        ...context,
        ...(task ? (() => {
          const grant = context.taskContext?.grant ?? { approved: false, actionCount: 0 };
          bindComputerTaskGrant(task, grant);
          return { taskContext: { task, grant } };
        })() : {}),
        ...(typeSafeModel ? { typeSafeModel } : {}),
        approveBrowser: context.approveBrowser
          ? (request, signal) => context.approveBrowser!({ ...request, strategy: selectedStrategy }, signal)
          : undefined,
        approveComputer: context.approveComputer
          ? (request, signal) => context.approveComputer!({ ...request, strategy: selectedStrategy }, signal)
          : undefined,
        onComputer: async (event) => {
          if (event.type === "act_requested") inputRequested = true;
          const decorated = event.type === "started"
            ? decoratedStarted(event, route.surface as ComputerSurface, this.options.strategy, route.reason, fallbackFrom, fallbackReason)
            : event;
          if (buffering && !inputRequested) {
            buffer.push(decorated);
            return;
          }
          await context.onComputer?.(decorated);
        },
      };
      const runExclusive = route.surface === "browser" ? this.options.browserRunExclusive : this.options.desktopRunExclusive;
      const outcome = runExclusive
        ? await runExclusive(() => path.run(callId, requestGoal, childContext))
        : await path.run(callId, requestGoal, childContext);
      const safeToTryFallback = buffering && !inputRequested && canFallback(outcome);
      if (safeToTryFallback) {
        fallbackFrom = selectedStrategy;
        fallbackReason = outcome.summary;
        continue;
      }
      if (buffer.length > 0) {
        for (const event of buffer) await context.onComputer?.(event);
      }
      return outcome;
    }

    const reason = fallbackReason ?? "No configured computer strategy completed the request.";
    await context.onComputer?.({
      type: "failed",
      strategy: this.options.strategy === "auto" ? fallbackFrom ?? "typesafe" : this.options.strategy,
      reason,
      errorCode: "computer-strategy-unavailable",
    });
    return unavailableOutcome("strategy-unavailable", reason);
  }

  private async runMixed(
    callId: string,
    originalGoal: string,
    context: ComputerContext,
    availableSurfaces: readonly ComputerSurface[],
  ): Promise<ComputerOutcome> {
    if (!availableSurfaces.includes("browser") || !availableSurfaces.includes("desktop") || !this.options.browser || !this.options.desktop) {
      return mixedSurfaceOutcome("This mixed task requires both the Cua browser and isolated native desktop runtimes.");
    }
    const parts = mixedTaskParts(originalGoal);
    if (!parts) {
      return mixedSurfaceOutcome("The mixed task must name a browser URL, request its heading, and name a supported native application destination.");
    }
    if (!this.options.compileTask) {
      return mixedSurfaceOutcome("The mixed task cannot start without the code-owned task compiler.");
    }
    // Both child runtimes must prove their independent capability and health
    // contracts before one approval can authorize a mixed task. The child
    // routers repeat their cached preflight defensively before execution.
    try {
      await this.options.browser.preflight?.();
      await this.options.desktop.preflight?.();
    } catch (error) {
      return preflightFailure("mixed", error);
    }
    let typeSafeModel = context.typeSafeModel;
    const browserNeedsTypeSafe = strategyOrder(this.options.strategy, this.options.browser.availableStrategies).includes("typesafe");
    const nativeNeedsTypeSafe = strategyOrder(this.options.strategy, this.options.desktop.availableStrategies).includes("typesafe");
    if ((browserNeedsTypeSafe || nativeNeedsTypeSafe) && !typeSafeModel) {
      if (!this.options.typeSafePreflight) {
        return preflightFailure("mixed", new ToolExecutionError("The TypeSafe model readiness probe is not configured."));
      }
      try {
        typeSafeModel = await this.options.typeSafePreflight(context.signal);
      } catch (error) {
        return preflightFailure("mixed", error);
      }
    }
    const taskId = `computer_${callId.replace(/[^a-zA-Z0-9_.:-]/gu, "_").slice(0, 80)}`;
    let browserTask: ComputerTaskSpec;
    try {
      browserTask = this.options.compileTask({ taskId: `${taskId}:browser`, goal: parts.browserGoal, surface: "browser" });
    } catch (error) {
      return error instanceof ComputerTaskCompileError ? taskFailure(error) : mixedSurfaceOutcome("The browser half of the mixed task could not be compiled.");
    }
    const maxActions = browserTask.maxActions;
    const nativeFallbackRoutes = ["structured", "focused-key-text"] as const;
    const allowedActions: readonly ComputerTaskActionClass[] = [...new Set<ComputerTaskActionClass>([...browserTask.allowedActions, "launch", "type"])] as ComputerTaskActionClass[];
    const expiresAtMs = Date.now() + browserTask.deadlineMs;
    const grantHash = createHash("sha256").update(stableStringify({
      taskId,
      originalGoal,
      surfaces: ["browser", "native"],
      applicationName: parts.nativeApplication,
      nativeFallbackRoutes,
      allowedOrigins: browserTask.allowedOrigins,
      allowedActions,
      maxActions,
      expiresAtMs,
    }), "utf8").digest("hex");
    const approvalRequest: ComputerTaskApprovalRequest = {
      taskId,
      surface: "mixed",
      originalGoal,
      applicationName: parts.nativeApplication,
      profileMode: "isolated_new",
      nativeFallbackRoutes,
      inputRoute: browserTask.inputRoute,
      timeZone: browserTask.timeZone,
      values: Object.fromEntries(Object.entries(browserTask.values).map(([key, value]) => [key, value.value])),
      allowedOrigins: browserTask.allowedOrigins,
      allowedActions,
      maxActions,
      deadlineMs: browserTask.deadlineMs,
      expiresAtMs,
      completion: { kind: "none", reason: "The browser heading must be freshly read before the native handoff can be compiled." },
      grantHash,
    };
    if (!context.approveComputerTask) {
      return { ok: false, status: "clarification-required", content: stableStringify({ status: "clarification-required", reason: "No task approval channel is available; the mixed computer task was not started." }), summary: "No task approval channel is available; the mixed computer task was not started.", errorCode: "computer-approval-unavailable" };
    }
    context.pauseDeadline?.();
    context.pauseTurnDeadline?.();
    let decision;
    try {
      decision = await context.approveComputerTask(approvalRequest, context.signal);
    } finally {
      context.resumeTurnDeadline?.();
      context.resumeDeadline?.();
    }
    if (decision.decision !== "allow-task" || decision.grantHash !== grantHash) {
      const reason = decision.decision === "allow-task" ? "The mixed task approval did not match its compiled grant." : decision.reason ?? "The mixed task was not approved.";
      return { ok: false, status: "abstained", content: stableStringify({ status: "abstained", reason }), summary: reason, errorCode: decision.decision === "deny" ? "computer-approval-denied" : "computer-approval-unavailable" };
    }
    const grant: ComputerTaskGrantState = { approved: true, actionCount: 0, taskHashes: [browserTask.grantHash] };
    const browserRouter = new ComputerRouter({
      ...this.options,
      surface: "browser",
      preferredSurface: "browser",
      desktop: undefined,
      compileTask: () => browserTask,
    });
    const browserOutcome = await browserRouter.run(`${callId}:browser`, parts.browserGoal, {
      ...context,
      routingGoal: parts.browserGoal,
      taskGoal: browserTask.originalGoal,
      ...(typeSafeModel ? { typeSafeModel } : {}),
      taskContext: { task: browserTask, grant },
    });
    if (!browserOutcome.ok) return browserOutcome;
    const heading = mixedHeading(browserOutcome.content);
    if (!heading) {
      return { ok: false, status: "outcome-unknown", content: stableStringify({ status: "outcome-unknown", reason: "The browser half completed without a bounded heading value for the native handoff." }), summary: "The browser result did not expose a bounded heading for the native handoff; no native input was sent.", errorCode: "computer-verification" };
    }
    const nativeGoal = `Open ${parts.nativeApplication} and type "${heading}".`;
    let nativeTask: ComputerTaskSpec;
    try {
      nativeTask = this.options.compileTask({ taskId: `${taskId}:native`, goal: nativeGoal, surface: "native" });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The native half of the mixed task could not be compiled.";
      return { ok: false, status: "outcome-unknown", content: stableStringify({ status: "outcome-unknown", reason }), summary: `${reason} No native input was sent.`, errorCode: "computer-task-invalid" };
    }
    if (nativeTask.maxActions !== maxActions) {
      return { ok: false, status: "outcome-unknown", content: stableStringify({ status: "outcome-unknown", reason: "The mixed task child grants did not agree on their action ceiling." }), summary: "The mixed task child grants did not agree on their action ceiling; no native input was sent.", errorCode: "computer-task-invalid" };
    }
    try {
      addComputerTaskGrantBinding(nativeTask, grant);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The native child could not be bound to the mixed task grant.";
      return { ok: false, status: "outcome-unknown", content: stableStringify({ status: "outcome-unknown", reason }), summary: `${reason} No native input was sent.`, errorCode: "computer-task-invalid" };
    }
    const nativeRouter = new ComputerRouter({
      ...this.options,
      surface: "desktop",
      preferredSurface: "desktop",
      browser: undefined,
      compileTask: () => nativeTask,
    });
    return nativeRouter.run(`${callId}:native`, nativeGoal, {
      ...context,
      routingGoal: nativeGoal,
      taskGoal: nativeTask.originalGoal,
      ...(typeSafeModel ? { typeSafeModel } : {}),
      taskContext: { task: nativeTask, grant },
    });
  }
}
