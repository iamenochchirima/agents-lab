import assert from "node:assert/strict";
import { createServer, type ServerHttp2Stream } from "node:http2";
import test from "node:test";
import { discoverEndpoint, registeredEndpoint } from "../../../src/platforms/restate/runner-adapter/service-discovery.js";

test("readiness follows current binding and rejects an obsolete configured URI", () => {
  const deployments = { deployments: [
    { id: "old", uri: "http://127.0.0.1:9080/", http_version: "HTTP/2.0", services: [{ name: "Agent", revision: 1 }] },
    { id: "current", uri: "http://127.0.0.1:29080/", http_version: "HTTP/2.0", services: [{ name: "Agent", revision: 2 }] },
  ] };
  assert.equal(registeredEndpoint(deployments, "Agent", "http://127.0.0.1:9080", "current").registered, false);
  assert.deepEqual(registeredEndpoint(deployments, "Agent", "http://127.0.0.1:29080", "current"), { registered: true, endpoint: "http://127.0.0.1:29080/", http2: true });
  assert.equal(registeredEndpoint(deployments, "Agent", "http://127.0.0.1:29080", "missing").registered, false);
  assert.equal(registeredEndpoint(deployments, "Agent", "http://127.0.0.1:9080").registered, false);
});

test("bounded HTTP2 SDK discovery distinguishes live, wrong-service and stopped endpoints", async () => {
  const server = createServer();
  server.on("stream", (stream, headers) => { assert.equal(headers[":path"], "/discover"); (stream as ServerHttp2Stream).respond({ ":status": 200, "content-type": "application/json" }); stream.end(JSON.stringify({ services: [{ name: "Agent" }] })); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const uri = `http://127.0.0.1:${address.port}/`;
  assert.equal(await discoverEndpoint(uri, "Agent", 1000, true, fetch), true);
  assert.equal(await discoverEndpoint(uri, "Different", 1000, true, fetch), false);
  await new Promise<void>(resolve => server.close(() => resolve()));
  await assert.rejects(discoverEndpoint(uri, "Agent", 1000, true, fetch));
});
