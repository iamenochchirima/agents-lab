import { coverageCatalog } from "./coverageCatalog";
import { validateCoverageCatalog } from "./coverageModel";
import { CoverageView } from "./CoverageView";
import "./coverage.css";

const catalogErrors = validateCoverageCatalog(coverageCatalog);

export function CoveragePage() {
  if (catalogErrors.length > 0) {
    throw new Error(`Invalid coverage catalog:\n${catalogErrors.join("\n")}`);
  }

  return <CoverageView catalog={coverageCatalog} />;
}
