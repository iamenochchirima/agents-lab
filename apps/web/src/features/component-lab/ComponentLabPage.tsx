import { ComponentLabView } from "./ComponentLabView";
import { componentAreas, contextCases, contextStrategies } from "./componentCatalog";
import { validateComponentCatalog } from "./componentModel";
import "./component-lab.css";

const catalogErrors = validateComponentCatalog(componentAreas, contextStrategies, contextCases);

function assertCatalogIsValid() {
  if (catalogErrors.length > 0) {
    throw new Error(`Invalid Component Lab catalog:\n${catalogErrors.join("\n")}`);
  }
}

export function ComponentLabPage() {
  assertCatalogIsValid();
  return <ComponentLabView areas={componentAreas} entranceMode />;
}

export function ComponentLabAreaPage() {
  assertCatalogIsValid();
  return <ComponentLabView areas={componentAreas} detailMode />;
}
