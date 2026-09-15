const serviceUrl = process.env.AGENTLAB_INNGEST_SERVICE_URL ?? "http://127.0.0.1:9091";
const runId = `playground-${Date.now()}`;

const input = {
  runId,
  prompt: "Return one short sentence about durable steps.",
  systemInstruction: "Answer concisely.",
  provider: "fake",
  model: "fake-success",
};

async function request(path, init = {}) {
  const response = await fetch(`${serviceUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} returned HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

await request("/health");
await request("/runs/admit", { method: "POST", body: JSON.stringify(input) });
const dispatch = await request(`/runs/${encodeURIComponent(runId)}/dispatch`, {
  method: "POST",
  body: JSON.stringify(input),
});
console.log("dispatch", JSON.stringify(dispatch, null, 2));

for (let attempt = 0; attempt < 60; attempt += 1) {
  const record = await request(`/runs/${encodeURIComponent(runId)}`);
  console.log(`${record.status} attempt=${record.attemptCount} functionRunId=${record.functionRunId ?? "pending"}`);
  if (record.result) {
    console.log(JSON.stringify(record, null, 2));
    process.exit(record.result.status === "completed" ? 0 : 1);
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

throw new Error("Timed out waiting for an Inngest terminal projection.");
