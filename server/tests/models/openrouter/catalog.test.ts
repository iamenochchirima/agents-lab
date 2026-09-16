import assert from "node:assert/strict";
import test from "node:test";

import {
  OpenRouterCatalogError,
  OpenRouterModelCatalog,
  type OpenRouterCatalogConfig,
} from "../../../src/models/openrouter/catalog.js";

const config: OpenRouterCatalogConfig = {
  apiKey: "test-secret",
  baseUrl: "https://openrouter.example/api/v1",
  timeoutMs: 500,
  cacheTtlMs: 1_000,
  resultLimit: 10,
  defaultModel: "openai/gpt-4o-mini",
};

test("catalog parses safe model metadata, filters non-text output, and normalizes price", async () => {
  let requestUrl = "";
  const catalog = new OpenRouterModelCatalog(config, {
    fetchImplementation: async (url) => {
      requestUrl = String(url);
      return new Response(JSON.stringify({
        data: [
          {
            id: "openai/gpt-4o-mini",
            name: "GPT-4o mini",
            description: "A compact model",
            context_length: 128000,
            input_modalities: ["text", "image"],
            output_modalities: ["text"],
            supported_parameters: ["tools"],
            pricing: { prompt: "0.00000015", completion: "0.0000006" },
          },
          { id: "image/model", name: "Image model", output_modalities: ["image"], pricing: {} },
          { id: "invalid", name: "", pricing: {} },
        ],
      }), { status: 200 });
    },
  });

  const result = await catalog.list("GPT 4o");

  assert.match(requestUrl, /\/models\?/);
  assert.match(requestUrl, /q=gpt(?:%20|\+)4o/);
  assert.match(requestUrl, /output_modalities=text/);
  assert.equal(result.defaultModel, "openai/gpt-4o-mini");
  assert.deepEqual(result.models[0], {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o mini",
    description: "A compact model",
    contextLength: 128000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    promptPriceUsdPerMillion: 0.15,
    completionPriceUsdPerMillion: 0.6,
    isFree: false,
    supportsTools: true,
  });
  assert.equal(result.models.length, 1);
});

test("catalog cache avoids duplicate upstream requests and expires", async () => {
  let now = 10_000;
  let requests = 0;
  const catalog = new OpenRouterModelCatalog(config, {
    now: () => now,
    fetchImplementation: async () => {
      requests += 1;
      return new Response(JSON.stringify({ data: [{ id: "model/a", name: "A" }] }), { status: 200 });
    },
  });

  await catalog.list("a");
  await catalog.list(" A ");
  assert.equal(requests, 1);
  now += 1_001;
  await catalog.list("a");
  assert.equal(requests, 2);
});

test("catalog does not label models with unknown pricing as free", async () => {
  const catalog = new OpenRouterModelCatalog(config, {
    fetchImplementation: async () => new Response(JSON.stringify({
      data: [{ id: "model/unknown-price", name: "Unknown price", output_modalities: ["text"], pricing: {} }],
    }), { status: 200 }),
  });

  const result = await catalog.list("unknown");
  assert.equal(result.models[0]?.isFree, false);
  assert.equal(result.models[0]?.promptPriceUsdPerMillion, null);
});

test("catalog keeps the configured default model in the initial visible page", async () => {
  const catalog = new OpenRouterModelCatalog({ ...config, resultLimit: 2, defaultModel: "model/z" }, {
    fetchImplementation: async () => new Response(JSON.stringify({
      data: [
        { id: "model/a", name: "Alpha", output_modalities: ["text"], pricing: { prompt: "0", completion: "0" } },
        { id: "model/b", name: "Beta", output_modalities: ["text"], pricing: { prompt: "0", completion: "0" } },
        { id: "model/z", name: "Zulu", output_modalities: ["text"], pricing: { prompt: "0", completion: "0" } },
      ],
    }), { status: 200 }),
  });

  const result = await catalog.list();
  assert.deepEqual(result.models.map((model) => model.id), ["model/a", "model/z"]);
});

test("catalog resolves the selected model window and rejects unknown model IDs", async () => {
  const catalog = new OpenRouterModelCatalog(config, {
    fetchImplementation: async (url) => {
      assert.match(String(url), /q=openai%2F(?:gpt-4o-mini|unknown)/);
      return new Response(JSON.stringify({
        data: [{ id: "openai/gpt-4o-mini", name: "GPT-4o mini", context_length: 128000, output_modalities: ["text"] }],
      }), { status: 200 });
    },
  });

  assert.deepEqual(await catalog.resolve("openrouter", "openai/gpt-4o-mini"), { contextWindowTokens: 128000 });
  await assert.rejects(
    catalog.resolve("openrouter", "openai/unknown"),
    (error: unknown) => error instanceof OpenRouterCatalogError && error.code === "OPENROUTER_MODEL_NOT_FOUND" && error.statusCode === 400,
  );
});

test("catalog hides missing credentials and upstream response details", async () => {
  const missing = new OpenRouterModelCatalog({ ...config, apiKey: null });
  await assert.rejects(
    missing.list(),
    (error: unknown) => error instanceof OpenRouterCatalogError && error.code === "OPENROUTER_NOT_CONFIGURED" && error.statusCode === 503,
  );

  const unavailable = new OpenRouterModelCatalog(config, {
    fetchImplementation: async () => new Response("private upstream detail", { status: 401 }),
  });
  await assert.rejects(
    unavailable.list(),
    (error: unknown) => error instanceof OpenRouterCatalogError && error.code === "OPENROUTER_CATALOG_UNAVAILABLE" && !error.message.includes("private"),
  );
});
