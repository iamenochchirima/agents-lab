import { readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { MastraBaselineRunner } from "../../../../src/platforms/mastra/runner-adapter/mastra-runner.js";
import { createDeterministicFakeModel } from "../../../../src/platforms/mastra/variants/baseline/models/fake.js";
import type { RunManifest } from "../../../../src/control-plane/domain/types.js";

const root = process.argv[2]!;
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as RunManifest;
let requests = 0;
const runner = new MastraBaselineRunner({ contextRoot: root,
  modelFactory: () => createDeterministicFakeModel({ modelId: "fake-tool-call", toolCall: true,
    // The second model round is interrupted after the calculator result persisted.
    delayMs: 100,
    onRequest: () => {
      requests++;
      if (requests === 2) {
        process.stdout.write("SECOND_MODEL_REQUEST\n");
      }
    } }),
  onToolObservation: async () => { await appendFile(join(root, "effects.jsonl"), "calculator\n"); },
});
await runner.start(manifest);
setInterval(() => undefined, 1_000);
