import { fileURLToPath } from "node:url";

import { buildVercelWorkflowBundle } from "../variants/baseline/execution/bundle-builder.js";

const platformRoot = fileURLToPath(new URL("..", import.meta.url));
const bundle = await buildVercelWorkflowBundle(platformRoot);
console.log(`Vercel Workflow bundle written to ${bundle.outputRoot} (${bundle.workflowId})`);
