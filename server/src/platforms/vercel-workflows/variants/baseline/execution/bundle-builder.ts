import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { StandaloneBuilder } from "../../../sdk.js";

export interface VercelWorkflowBundle {
  readonly outputRoot: string;
  readonly flowPath: string;
  readonly webhookPath: string;
  readonly manifestPath: string;
  readonly workflowId: string;
}

export async function buildVercelWorkflowBundle(platformRoot: string): Promise<VercelWorkflowBundle> {
  const executionRoot = join(platformRoot, "variants/baseline/execution");
  const outputRoot = join(platformRoot, ".workflow-build");
  const flowPath = join(outputRoot, "flow.mjs");
  const webhookPath = join(outputRoot, "webhook.mjs");
  const manifestPath = join(executionRoot, ".well-known/workflow/v1/manifest.json");

  const builder = new StandaloneBuilder({
    buildTarget: "standalone",
    dirs: ["."],
    workingDir: executionRoot,
    projectRoot: executionRoot,
    moduleSpecifierRoot: executionRoot,
    stepsBundlePath: join(outputRoot, "steps.mjs"),
    workflowsBundlePath: flowPath,
    webhookBundlePath: webhookPath,
    sourcemap: false,
    suppressCreateWorkflowsBundleLogs: true,
    suppressCreateWorkflowsBundleWarnings: true,
    suppressCreateWebhookBundleLogs: true,
    suppressCreateManifestLogs: true,
  });
  await builder.build();

  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    readonly workflows?: Record<string, Record<string, { readonly workflowId?: string }>>;
  };
  const workflowId = Object.values(manifest.workflows ?? {})
    .flatMap((workflows) => Object.values(workflows))
    .map((workflow) => workflow.workflowId)
    .find((value): value is string => typeof value === "string");
  if (!workflowId) throw new Error("The Vercel Workflow build did not emit a workflow ID.");

  return { outputRoot, flowPath, webhookPath, manifestPath, workflowId };
}
