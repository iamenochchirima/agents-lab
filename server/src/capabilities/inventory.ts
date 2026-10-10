import type { CapabilityInventorySnapshot } from "./contracts.js";

/** Render only the admitted, safe summary; executable schemas remain authoritative. */
export function capabilityInventoryContext(inventory: CapabilityInventorySnapshot): string {
  const lines = [
    `Configured capability inventory (revision ${inventory.revision}; callable tool catalog ${inventory.toolCatalogRevision}).`,
    `Selected agent profile: ${inventory.profile.id}@${inventory.profile.version}.`,
    "The following tool sources and definitions are enabled for this run. The corresponding callable schemas are supplied separately:",
  ];
  if (inventory.sources.length === 0) lines.push("- No tools are enabled for this run.");
  for (const source of inventory.sources) {
    const tools = source.tools.map(tool => `${JSON.stringify(tool.name)} (${tool.risk}; ${approvalDescription(tool.approvalMode)})`).join(", ");
    lines.push(`- ${JSON.stringify(source.id)}@${source.version}: ${tools}`);
  }
  if (inventory.sources.some(source => source.tools.some(tool => tool.approvalMode === "invocation"))) {
    lines.push("For tools marked review required, submitting a tool call proposes its exact arguments. The platform prepares an action review and waits for the user's decision before dispatching that call. Gather required values first, then submit the proposed tool call when asked to propose an action. A plain-text confirmation request does not create an actionable review. Approval is not execution success; report the observed tool result. Denial prevents that call and is returned as tool feedback. A denial is the user's review decision about that exact action, not a provider validation failure or cancellation of the whole task. Do not retry or bypass it. Unless the user stopped the task or remaining work depends on the denied action, continue other requested work within the admitted permissions and obtain each required review. If the task requires verification, use an available read operation to check the affected resource after approval or denial. Before reporting completion, compare the original task with observed results and identify unfinished or blocked work.");
  }
  lines.push("Procedural skills. Preloaded skill instructions are already in context. Available skills below contain metadata only; use a declared skill loader to obtain their instructions before following or claiming to use them:");
  if (inventory.skills.length === 0) lines.push("- No procedural skills are available in this run.");
  for (const skill of inventory.skills) {
    lines.push(`- ${JSON.stringify(skill.name)} (${skill.activation}; ${skill.id}@${skill.version}): ${JSON.stringify(skill.description.slice(0, 600))}`);
  }
  lines.push("Only the tool definitions supplied with this run are callable. This inventory does not add permissions.");
  return lines.join("\n");
}

function approvalDescription(mode: "automatic" | "tool_grant" | "invocation"): string {
  switch (mode) {
    case "automatic": return "automatic";
    case "tool_grant": return "approved for this run";
    case "invocation": return "review required for each proposed action";
  }
}
