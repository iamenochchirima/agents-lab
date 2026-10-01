import { ToolExecutionError } from "../runtime/errors.js";

/** A user-facing request may select one surface or let Lina choose. */
export type ComputerSurfacePolicy = "auto" | "browser" | "desktop";
export type ComputerSurface = "browser" | "desktop";
export type ComputerStrategyPolicy = "auto" | "traditional" | "typesafe" | "compare";
export type ComputerSelectableStrategy = Exclude<ComputerStrategyPolicy, "auto">;
export type ComputerRouteKind = "single-surface" | "mixed-surface";

export interface ComputerRoutingOptions {
  readonly surface?: ComputerSurfacePolicy;
  readonly availableSurfaces?: readonly ComputerSurface[];
  readonly preferredSurface?: ComputerSurface;
}

export interface ComputerRouteDecision {
  readonly kind: ComputerRouteKind;
  readonly surface: ComputerSurface | "ambiguous" | "unavailable";
  readonly explicit: boolean;
  readonly reason: string;
}

const MAX_GOAL_CHARS = 1_000;
const URL_PATTERN = /(?:https?:\/\/|\b(?:www\.)?)(?:(?:localhost|127(?:\.\d{1,3}){3})|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,})+)(?::\d{1,5})?(?:\/[^\s<>"]*)?/iu;
const EXPLICIT_BROWSER_REQUEST_PATTERN = /\b(?:browser|chrome|chromium|website|web\s*page|webpage|page|link|url|navigate|visit|address\s+bar|form|search\s+(?:the\s+)?(?:web|page|site)|scroll\s+(?:the\s+)?page)\b/iu;
const DESKTOP_REQUEST_PATTERN = /\b(?:desktop|screen|window|application|app|mouse|cursor|keyboard|native|on\s+my\s+screen|visible\s+desktop)\b/iu;
const NATIVE_SURFACE_PATTERN = /\b(?:native|desktop(?!\s+browser)|visible\s+desktop|on\s+my\s+screen|(?:notes?|text\s+editor|calendar|clocks?|calculator|files|file\s+manager|nautilus|settings?|system\s+settings?|terminal|command\s+line|vs\s*code|visual\s+studio\s+code|code\s+editor)(?:\s+(?:app|application))?)\b/iu;
function normalizedGoal(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolExecutionError("The computer goal must be a non-empty string.");
  }
  const goal = value.trim();
  if (goal.length > MAX_GOAL_CHARS) {
    throw new ToolExecutionError(`The computer goal is limited to ${MAX_GOAL_CHARS} characters.`);
  }
  return goal;
}

function availableSurfaces(value: readonly ComputerSurface[] | undefined): readonly ComputerSurface[] {
  const surfaces = [...new Set(value ?? ["browser", "desktop"])] as ComputerSurface[];
  return surfaces.filter((surface): surface is ComputerSurface => surface === "browser" || surface === "desktop");
}

function goalWithoutUrls(goal: string): string {
  return goal.replace(URL_PATTERN, " ");
}

function inferredSurface(goal: string): ComputerSurface | undefined {
  const intent = goalWithoutUrls(goal);
  // "Tab" is also ordinary native-editor vocabulary (for example, a new
  // document tab in GNOME Text Editor). Once a supported native application is
  // named, do not let that generic word override the explicit desktop target;
  // a URL or an explicit browser term still wins and is handled below.
  if (NATIVE_SURFACE_PATTERN.test(intent)
    && !URL_PATTERN.test(goal)
    && !/\b(?:browser|chrome|chromium|website|web\s*page|webpage|url|navigate|visit|address\s+bar|form|search\s+(?:the\s+)?(?:web|page|site))\b/iu.test(goal)) {
    return "desktop";
  }
  if (URL_PATTERN.test(goal) || EXPLICIT_BROWSER_REQUEST_PATTERN.test(goal)) return "browser";
  if (DESKTOP_REQUEST_PATTERN.test(goal)) return "desktop";
  return undefined;
}

function isMixedSurfaceGoal(goal: string): boolean {
  return (URL_PATTERN.test(goal) || EXPLICIT_BROWSER_REQUEST_PATTERN.test(goal)) && NATIVE_SURFACE_PATTERN.test(goalWithoutUrls(goal));
}

/**
 * Resolve only the execution surface. This function never authorizes an action.
 * The selected adapter, bounded action schema, approval, and fresh verification
 * remain responsible for deciding whether anything can happen.
 */
export function routeComputerRequest(goalValue: unknown, options: ComputerRoutingOptions = {}): ComputerRouteDecision {
  const goal = normalizedGoal(goalValue);
  const available = availableSurfaces(options.availableSurfaces);
  const requested = options.surface ?? "auto";

  if (isMixedSurfaceGoal(goal)) {
    return {
      kind: "mixed-surface",
      surface: "ambiguous",
      explicit: false,
      reason: "This request combines browser and native desktop work and requires the coordinated mixed-surface path.",
    };
  }

  if (requested !== "auto") {
    if (!available.includes(requested)) {
      return {
        kind: "single-surface",
        surface: "unavailable",
        explicit: true,
        reason: `The request requires the ${requested}, but no permitted ${requested} environment is available.`,
      };
    }
    return { kind: "single-surface", surface: requested, explicit: true, reason: `The ${requested} surface was explicitly selected.` };
  }

  const inferred = inferredSurface(goal);
  if (inferred !== undefined) {
    if (!available.includes(inferred)) {
      return {
        kind: "single-surface",
        surface: "unavailable",
        explicit: false,
        reason: `The request requires the ${inferred}, but no permitted ${inferred} environment is available.`,
      };
    }
    return {
      kind: "single-surface",
      surface: inferred,
      explicit: false,
      reason: inferred === "browser"
        ? "The request names a URL or browser page interaction."
        : "The request names a desktop, screen, window, or native input interaction.",
    };
  }

  if (available.length === 1 && available[0]) {
    return { kind: "single-surface", surface: available[0], explicit: false, reason: "Only one permitted computer surface is available." };
  }
  if (options.preferredSurface && available.includes(options.preferredSurface)) {
    return {
      kind: "single-surface",
      surface: options.preferredSurface,
      explicit: false,
      reason: "The request is surface-neutral, so the configured available surface is used.",
    };
  }
  if (available.length === 0) {
    return { kind: "single-surface", surface: "unavailable", explicit: false, reason: "No permitted browser or desktop environment is available." };
  }
  return { kind: "single-surface", surface: "ambiguous", explicit: false, reason: "The request could refer to either the managed browser or the desktop." };
}

export interface ComputerStrategyAvailability {
  readonly typesafe: boolean;
  readonly traditional: boolean;
}

/**
 * Return the only strategy order that the policy permits. Automatic selection
 * can try one alternative before approval; explicit selections cannot do so.
 */
export function strategyOrder(policy: ComputerStrategyPolicy, availability: ComputerStrategyAvailability): readonly ComputerSelectableStrategy[] {
  switch (policy) {
    case "typesafe": return availability.typesafe ? ["typesafe"] : [];
    case "traditional": return availability.traditional ? ["traditional"] : [];
    case "compare": return availability.typesafe && availability.traditional ? ["compare"] : [];
    case "auto":
      return [
        ...(availability.typesafe ? ["typesafe" as const] : []),
        ...(availability.traditional ? ["traditional" as const] : []),
      ];
  }
}

export function strategyLabel(strategy: ComputerStrategyPolicy | ComputerSelectableStrategy): string {
  switch (strategy) {
    case "typesafe": return "Jev";
    case "traditional": return "traditional vision";
    case "compare": return "compare";
    case "auto": return "automatic selection";
  }
}
