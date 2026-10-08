import { connect } from "node:http2";

const mediaType = "application/vnd.restate.endpointmanifest.v4+json";
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const normalized = (uri: string) => new URL(uri).href.replace(/\/$/, "");

/** Match the current service binding, falling back to the newest advertised
 * revision when older Admin APIs lack binding information. Payloads lacking URI retain their
 * registration information, but cannot establish endpoint reachability. */
export function registeredEndpoint(value: unknown, serviceName: string, configuredUri: string, currentDeploymentId?: string): { registered: boolean; endpoint: string | null; http2: boolean } {
  if (!object(value) || !Array.isArray(value.deployments)) return { registered: false, endpoint: null, http2: false };
  const matches = value.deployments.flatMap(deployment => object(deployment) && Array.isArray(deployment.services)
    ? deployment.services.filter(service => object(service) && service.name === serviceName).map(service => ({ deployment, service: service as Record<string, unknown> })) : []);
  const revisions = matches.map(match => match.service.revision).filter((revision): revision is number => typeof revision === "number" && Number.isSafeInteger(revision));
  const latest = currentDeploymentId ? matches.filter(match => match.deployment.id === currentDeploymentId) : revisions.length ? matches.filter(match => match.service.revision === Math.max(...revisions)) : matches;
  const known = latest.filter(match => typeof match.deployment.uri === "string");
  if (!known.length) return { registered: latest.length > 0, endpoint: null, http2: false };
  const matching = known.find(match => { try { return normalized(match.deployment.uri as string) === normalized(configuredUri); } catch { return false; } });
  return { registered: Boolean(matching), endpoint: matching ? matching.deployment.uri as string : null, http2: matching?.deployment.http_version === "HTTP/2.0" };
}

/** Read-only SDK discovery with a bounded body/deadline; no invocation or model
 * generation is dispatched. The installed Node SDK uses cleartext HTTP/2. */
export async function discoverEndpoint(uri: string, serviceName: string, timeoutMs: number, http2: boolean, fetchImplementation: typeof fetch): Promise<boolean> {
  const url = new URL(uri); url.pathname = `${url.pathname.replace(/\/$/, "")}/discover`;
  let text: string;
  if (http2) {
    text = await new Promise<string>((resolve, reject) => {
      const session = connect(url.origin);
      let stream: ReturnType<typeof session.request> | undefined, done = false, bytes = 0, body = "";
      const finish = (error?: Error) => { if (done) return; done = true; clearTimeout(timer); stream?.close(); session.destroy(); error ? reject(error) : resolve(body); };
      const timer = setTimeout(() => finish(new Error("SDK discovery timed out.")), timeoutMs);
      session.once("error", error => finish(error));
      stream = session.request({ ":method": "GET", ":path": url.pathname + url.search, accept: mediaType });
      stream.on("response", headers => { if (headers[":status"] !== 200) finish(new Error("SDK discovery rejected.")); });
      stream.on("data", chunk => { bytes += chunk.length; if (bytes > 262144) finish(new Error("SDK discovery exceeded limit.")); else body += chunk.toString(); });
      stream.once("error", error => finish(error)); stream.once("end", () => finish()); stream.end();
    });
  } else {
    const response = await fetchImplementation(url.href, { method: "GET", headers: { accept: mediaType }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return false;
    const reader = response.body?.getReader(); if (!reader) return false;
    let bytes = 0; const chunks: Uint8Array[] = [];
    try { while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.length; if (bytes > 262144) throw new Error("SDK discovery exceeded limit."); chunks.push(next.value); } }
    finally { await reader.cancel(); }
    text = Buffer.concat(chunks).toString("utf8");
  }
  const manifest: unknown = JSON.parse(text);
  return object(manifest) && Array.isArray(manifest.services) && manifest.services.some(service => object(service) && service.name === serviceName);
}
