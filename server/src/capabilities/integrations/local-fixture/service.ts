import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

const MAX_BODY_BYTES = 8_192;

export interface LocalFixtureServerOptions {
  readonly host?: string;
  readonly port?: number;
}

interface FixtureRequest {
  readonly requestId: string;
  readonly operation: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string | null;
}

interface StoredWrite {
  readonly fingerprint: string;
  readonly response: FixtureResponse;
}

interface FixtureResponse {
  readonly providerRequestId: string;
  readonly statusCode: number;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface LocalFixtureServerHandle {
  readonly server: Server;
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Starts the no-Docker local provider used by platform connection tests.
 *
 * It is intentionally a separate HTTP process in the local stack so platform
 * workers and the Python LangGraph service exercise a real connection boundary.
 */
export async function createLocalFixtureServer(options: LocalFixtureServerOptions = {}): Promise<LocalFixtureServerHandle> {
  const host = options.host ?? process.env.AGENTLAB_LOCAL_FIXTURE_HOST ?? "127.0.0.1";
  const port = options.port ?? parsePort(process.env.AGENTLAB_LOCAL_FIXTURE_PORT, 9191);
  const values = new Map<string, string>([
    ["alpha", "local fixture alpha"],
    ["project", "Agent Harness Lab"],
  ]);
  const writes = new Map<string, StoredWrite>();

  const server = createServer((request, response) => {
    void handleRequest(request, response, values, writes);
  });
  await listen(server, host, port);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local fixture server did not expose a TCP address.");
  return {
    server,
    host,
    port: address.port,
    close: () => close(server),
  };
}

export async function startLocalFixtureServer(): Promise<void> {
  const handle = await createLocalFixtureServer();
  console.log(`Agent Harness Lab local fixture listening at http://${handle.host}:${handle.port}`);
  const shutdown = (): void => {
    void handle.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await new Promise<void>(() => undefined);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startLocalFixtureServer().catch((error: unknown) => {
    console.error("Local fixture stopped:", error);
    process.exitCode = 1;
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  values: Map<string, string>,
  writes: Map<string, StoredWrite>,
): Promise<void> {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { service: "local-fixture", status: "ready" });
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/connection") {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  try {
    const input = parseRequest(await readBody(request));
    const result = execute(input, values, writes);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      providerRequestId: `local-direct:${Date.now()}`,
      statusCode: 400,
      body: { error: safeMessage(error) },
    });
  }
}

function execute(request: FixtureRequest, values: Map<string, string>, writes: Map<string, StoredWrite>): FixtureResponse {
  if (request.operation === "fixture.lookup") {
    const key = stringValue(request.input.key);
    if (!key || key.length > 64) return response(request, 400, { error: "Invalid fixture lookup key." });
    return response(request, 200, { key, value: values.get(key) ?? null });
  }

  if (request.operation === "fixture.write") {
    const key = stringValue(request.input.key);
    const value = stringValue(request.input.value);
    if (!key || key.length > 64 || value === null || value.length > 512 || request.idempotencyKey === null) {
      return response(request, 400, { error: "Invalid fixture write request." });
    }
    const fingerprint = JSON.stringify({ key, value });
    const previous = writes.get(request.idempotencyKey);
    if (previous) {
      return previous.fingerprint === fingerprint
        ? previous.response
        : response(request, 409, { error: "The idempotency key was already used for another write." });
    }
    values.set(key, value);
    const committed = response(request, 200, { key, written: true });
    writes.set(request.idempotencyKey, { fingerprint, response: committed });
    return committed;
  }

  return response(request, 404, { error: "The local fixture operation is not available." });
}

function parseRequest(body: string): FixtureRequest {
  const value: unknown = JSON.parse(body);
  if (!isRecord(value) || !isSafe(value.requestId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/) || !isSafe(value.operation, /^[a-z][a-z0-9_.:-]{0,127}$/) || !isRecord(value.input) || (value.idempotencyKey !== null && !isSafe(value.idempotencyKey, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/))) {
    throw new Error("Invalid local fixture request.");
  }
  return {
    requestId: value.requestId,
    operation: value.operation,
    input: value.input,
    idempotencyKey: value.idempotencyKey,
  };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY_BYTES) throw new Error("Local fixture request is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function response(request: FixtureRequest, statusCode: number, body: Readonly<Record<string, unknown>>): FixtureResponse {
  return { providerRequestId: `local-direct:${request.requestId}`, statusCode, body };
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error("AGENTLAB_LOCAL_FIXTURE_PORT must be a valid port.");
  return parsed;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafe(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

function safeMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message.slice(0, 256) : "Invalid local fixture request.";
}
