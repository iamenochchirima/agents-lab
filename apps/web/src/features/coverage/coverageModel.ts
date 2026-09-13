import type {
  CapabilityAssessment,
  CapabilityDefinition,
  CoverageCatalog,
  CoverageStatus,
  HarnessVariantCoverage,
} from "./coverageTypes";

export const coverageStatusLabels: Readonly<Record<CoverageStatus, string>> = {
  "not-assessed": "Not assessed",
  planned: "Planned",
  "in-progress": "In progress",
  implemented: "Implemented",
  verified: "Verified",
  blocked: "Blocked",
  unsupported: "Unsupported",
  "not-applicable": "Not applicable",
};

export function resolveCapabilityStatus(
  definition: CapabilityDefinition,
  assessment?: CapabilityAssessment,
): CoverageStatus {
  if (assessment?.disposition) return assessment.disposition;

  const completed = new Set(assessment?.completedChecks ?? []);
  if (completed.size === definition.checks.length && assessment?.evidence?.length) return "verified";
  if (completed.size === definition.checks.length) return "implemented";
  if (completed.size > 0) return "in-progress";
  if (assessment?.approach || assessment?.nextAction || assessment?.owner) return "planned";
  return "not-assessed";
}

export function summarizeVariant(
  variant: HarnessVariantCoverage,
  capabilities: readonly CapabilityDefinition[],
) {
  const counts: Record<CoverageStatus, number> = {
    "not-assessed": 0,
    planned: 0,
    "in-progress": 0,
    implemented: 0,
    verified: 0,
    blocked: 0,
    unsupported: 0,
    "not-applicable": 0,
  };

  capabilities.forEach((definition) => {
    counts[resolveCapabilityStatus(definition, variant.capabilityAssessments[definition.id])] += 1;
  });

  return counts;
}

export function summarizeCatalog(catalog: CoverageCatalog) {
  const variants = catalog.platforms.flatMap((platform) => platform.variants);
  const capabilityStates = variants.flatMap((variant) =>
    catalog.capabilities.map((definition) =>
      resolveCapabilityStatus(definition, variant.capabilityAssessments[definition.id]),
    ),
  );

  return {
    platforms: catalog.platforms.length,
    compositions: catalog.compositions.length,
    variants: variants.length,
    capabilitiesPerVariant: catalog.capabilities.length,
    verified: capabilityStates.filter((status) => status === "verified").length,
    blocked: capabilityStates.filter((status) => status === "blocked").length,
    assessed: capabilityStates.filter((status) => status !== "not-assessed").length,
    totalAssessments: capabilityStates.length,
  };
}

export function validateCoverageCatalog(catalog: CoverageCatalog): readonly string[] {
  const errors: string[] = [];
  const groupIds = new Set(catalog.capabilityGroups.map((group) => group.id));
  const capabilityIds = new Set<string>();
  const platformIds = new Set<string>();

  for (const capability of catalog.capabilities) {
    if (capabilityIds.has(capability.id)) errors.push(`Duplicate capability: ${capability.id}`);
    capabilityIds.add(capability.id);
    if (!groupIds.has(capability.groupId)) errors.push(`Unknown group on capability: ${capability.id}`);

    const checkIds = new Set<string>();
    for (const check of capability.checks) {
      if (checkIds.has(check.id)) errors.push(`Duplicate check in ${capability.id}: ${check.id}`);
      checkIds.add(check.id);
    }
  }

  for (const platform of catalog.platforms) {
    if (platformIds.has(platform.id)) errors.push(`Duplicate platform: ${platform.id}`);
    platformIds.add(platform.id);
    const variantIds = new Set<string>();
    for (const variant of platform.variants) {
      if (variantIds.has(variant.id)) errors.push(`Duplicate variant on ${platform.id}: ${variant.id}`);
      variantIds.add(variant.id);
      for (const [capabilityId, assessment] of Object.entries(variant.capabilityAssessments)) {
        const definition = catalog.capabilities.find((item) => item.id === capabilityId);
        if (!definition) {
          errors.push(`Unknown capability on ${platform.id}/${variant.id}: ${capabilityId}`);
          continue;
        }
        const checkIds = new Set(definition.checks.map((check) => check.id));
        for (const completedCheck of assessment.completedChecks ?? []) {
          if (!checkIds.has(completedCheck)) {
            errors.push(`Unknown check on ${platform.id}/${variant.id}/${capabilityId}: ${completedCheck}`);
          }
        }
      }
    }
  }

  return errors;
}
