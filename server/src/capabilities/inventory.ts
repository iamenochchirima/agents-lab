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
  lines.push("Available procedural skills. Use the declared skill discovery and loading tools to inspect and load a relevant procedure before following it:");
  if (inventory.skills.length === 0) lines.push("- No procedural skills are available in this run.");
  for (const skill of inventory.skills) {
    lines.push(`- ${JSON.stringify(skill.name)} (${skill.activation}; ${skill.id}@${skill.version})`);
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
