export const COVERAGE_VERSION: string;
export const COVERAGE_PLATFORMS: readonly string[];
export interface CoverageRequirement {
  readonly id: string;
  readonly group: "B" | "M" | "X";
  readonly mode: "scripted" | "live" | "scripted-native";
  readonly cases: readonly string[];
  readonly implementation: "executable" | "partial" | "not-implemented" | "not-applicable";
  readonly boundary: string;
  readonly applicablePlatforms?: readonly string[];
}
export const coverageRequirements: readonly CoverageRequirement[];
