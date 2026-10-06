export const STUDIO_API_ID = "studio-api" as const;
export const STUDIO_API_VERSION = "1" as const;

/** Deliberately small JSON contract for checking the browser/API boundary. */
export interface StudioApiHealth {
  readonly service: typeof STUDIO_API_ID;
  readonly status: "ok";
  readonly apiVersion: typeof STUDIO_API_VERSION;
}

export function isStudioApiHealth(value: unknown): value is StudioApiHealth {
  if (typeof value !== "object" || value === null) return false;
  const health = value as Record<string, unknown>;
  return health.service === STUDIO_API_ID
    && health.status === "ok"
    && health.apiVersion === STUDIO_API_VERSION;
}

export * from "./chat.js";
export * from "./context-experiment.js";
