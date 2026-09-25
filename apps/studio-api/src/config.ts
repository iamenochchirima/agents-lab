export interface StudioApiConfig {
  readonly host: string;
  readonly port: number;
  readonly webOrigin: string;
}

export type Environment = Readonly<Record<string, string | undefined>>;

export function parseStudioApiConfig(environment: Environment): StudioApiConfig {
  const host = environment.STUDIO_API_HOST?.trim() || "127.0.0.1";
  const portValue = environment.STUDIO_API_PORT?.trim() || "4320";
  const webOriginValue = environment.STUDIO_API_WEB_ORIGIN?.trim() || "http://localhost:5173";

  if (!/^[1-9]\d{0,4}$/.test(portValue)) {
    throw new Error("STUDIO_API_PORT must be an integer between 1 and 65535.");
  }
  const port = Number(portValue);
  if (port > 65535) {
    throw new Error("STUDIO_API_PORT must be an integer between 1 and 65535.");
  }
  if (!host || /\s/.test(host)) {
    throw new Error("STUDIO_API_HOST must be a non-empty host name or IP address.");
  }

  let webOrigin: string;
  try {
    const parsed = new URL(webOriginValue);
    if (!/^https?:$/.test(parsed.protocol) || parsed.origin !== webOriginValue.replace(/\/$/, "")) {
      throw new Error("origin must not contain a path, query, or fragment");
    }
    webOrigin = parsed.origin;
  } catch {
    throw new Error("STUDIO_API_WEB_ORIGIN must be an HTTP(S) origin without a path.");
  }

  return { host, port, webOrigin };
}
