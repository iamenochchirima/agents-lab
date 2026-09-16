import assert from "node:assert/strict";
import { test } from "node:test";
import { BrowserUrlPolicy, type BrowserDnsLookup } from "../src/browser/policy.js";

function lookup(addresses: readonly string[]): BrowserDnsLookup {
  return async () => addresses;
}

test("browser URL policy allows HTTPS public URLs", async () => {
  const policy = new BrowserUrlPolicy({ dnsLookup: lookup(["93.184.216.34"]) });

  const result = await policy.validate("https://example.test/docs?q=one");

  assert.deepEqual(result, {
    ok: true,
    url: "https://example.test/docs?q=one",
    hostname: "example.test",
    local: false,
  });
});

test("browser URL policy rejects unsupported schemes and embedded credentials", async () => {
  const policy = new BrowserUrlPolicy({ dnsLookup: lookup(["93.184.216.34"]) });

  await assert.rejects(
    policy.validate("file:///etc/passwd"),
    /Only http and https browser URLs are allowed/,
  );
  await assert.rejects(
    policy.validate("https://alice:secret@example.test/"),
    /Browser URLs must not contain embedded credentials/,
  );
});

test("browser URL policy blocks private DNS results by default", async () => {
  const policy = new BrowserUrlPolicy({ dnsLookup: lookup(["192.168.1.20"]) });

  await assert.rejects(
    policy.validate("https://internal.example.test/"),
    /private or internal address/,
  );
});

test("browser URL policy fails closed when hostname resolution is unavailable", async () => {
  const policy = new BrowserUrlPolicy({ dnsLookup: async () => { throw new Error("resolver unavailable"); } });

  await assert.rejects(
    policy.validate("https://example.test/"),
    /could not be resolved safely/u,
  );
});

test("browser URL policy permits explicitly configured local development hosts", async () => {
  const policy = new BrowserUrlPolicy({
    allowedLocalHosts: ["127.0.0.1", "localhost"],
    dnsLookup: lookup(["127.0.0.1"]),
  });

  const result = await policy.validate("http://127.0.0.1:4173/fixture");

  assert.deepEqual(result, {
    ok: true,
    url: "http://127.0.0.1:4173/fixture",
    hostname: "127.0.0.1",
    local: true,
  });
});

test("browser URL policy always blocks cloud metadata addresses", async () => {
  const policy = new BrowserUrlPolicy({
    allowedLocalHosts: ["169.254.169.254"],
    dnsLookup: lookup([]),
  });

  await assert.rejects(
    policy.validate("http://169.254.169.254/latest/meta-data/"),
    /cloud metadata address/,
  );
});

test("browser URL policy rejects HTTPS downgrade redirects", async () => {
  const policy = new BrowserUrlPolicy({ dnsLookup: lookup(["93.184.216.34"]) });

  await assert.rejects(
    policy.validateRedirect("https://example.test/start", "http://example.test/final"),
    /HTTPS navigation cannot redirect to HTTP/,
  );
});

test("browser URL policy reports local redirects only when explicitly allowed", async () => {
  const policy = new BrowserUrlPolicy({ dnsLookup: lookup(["127.0.0.1"]) });

  await assert.rejects(
    policy.validateRedirect("https://example.test/start", "http://127.0.0.1:8080/private"),
    /private or internal address/,
  );
});
