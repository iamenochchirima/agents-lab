import type {
  ComponentAreaDescriptor,
  ComponentCaseDescriptor,
  ComponentStrategyDescriptor,
} from "./componentTypes";

function checkUniqueIds(
  label: string,
  items: ReadonlyArray<{ id: string }>,
  errors: string[],
) {
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.id.trim()) errors.push(`${label} has an empty ID.`);
    if (ids.has(item.id)) errors.push(`Duplicate ${label.toLowerCase()} ID: ${item.id}`);
    ids.add(item.id);
  }
}

function checkNonEmpty(value: string, label: string, errors: string[]) {
  if (!value.trim()) errors.push(`${label} must not be empty.`);
}

export function validateComponentCatalog(
  areas: readonly ComponentAreaDescriptor[],
  strategies: readonly ComponentStrategyDescriptor[],
  cases: readonly ComponentCaseDescriptor[],
): readonly string[] {
  const errors: string[] = [];

  if (areas.length !== 11) errors.push(`Expected 11 component areas, found ${areas.length}.`);
  checkUniqueIds("component area", areas, errors);
  checkUniqueIds("context strategy", strategies, errors);
  checkUniqueIds("context case", cases, errors);

  for (const area of areas) {
    checkNonEmpty(area.name, `Area ${area.id} name`, errors);
    checkNonEmpty(area.summary, `Area ${area.id} summary`, errors);
    checkNonEmpty(area.nextAction, `Area ${area.id} next action`, errors);
    if (area.document) {
      checkNonEmpty(area.document.documentId, `Area ${area.id} document ID`, errors);
      checkNonEmpty(area.document.label, `Area ${area.id} document label`, errors);
    }
  }

  for (const strategy of strategies) {
    checkNonEmpty(strategy.name, `Strategy ${strategy.id} name`, errors);
    checkNonEmpty(strategy.summary, `Strategy ${strategy.id} summary`, errors);
    if (strategy.parameters.length === 0) errors.push(`Strategy ${strategy.id} needs a parameter description.`);
    if (strategy.inputs.length === 0) errors.push(`Strategy ${strategy.id} needs an input description.`);
    if (strategy.outputs.length === 0) errors.push(`Strategy ${strategy.id} needs an output description.`);
    if (strategy.limitations.length === 0) errors.push(`Strategy ${strategy.id} needs a limitation description.`);
    checkUniqueIds(`parameter in ${strategy.id}`, strategy.parameters, errors);
    for (const parameter of strategy.parameters) {
      checkNonEmpty(parameter.label, `Parameter ${strategy.id}/${parameter.id} label`, errors);
      checkNonEmpty(parameter.description, `Parameter ${strategy.id}/${parameter.id} description`, errors);
      if (parameter.options.length === 0) errors.push(`Parameter ${strategy.id}/${parameter.id} needs options.`);
      if (!parameter.options.includes(parameter.defaultValue)) {
        errors.push(`Parameter ${strategy.id}/${parameter.id} has an unknown default value.`);
      }
    }
  }

  for (const testCase of cases) {
    checkNonEmpty(testCase.name, `Case ${testCase.id} name`, errors);
    checkNonEmpty(testCase.task, `Case ${testCase.id} task`, errors);
    checkNonEmpty(testCase.fixtureSummary, `Case ${testCase.id} fixture summary`, errors);
    checkNonEmpty(testCase.intendedObservation, `Case ${testCase.id} intended observation`, errors);
    if (testCase.controls.length === 0) errors.push(`Case ${testCase.id} needs fixed controls.`);
  }

  return errors;
}

export function getComponentArea(areaId: string | undefined, areas: readonly ComponentAreaDescriptor[]) {
  return areas.find((area) => area.id === areaId);
}

export function getStrategy(strategyId: string, strategies: readonly ComponentStrategyDescriptor[]) {
  return strategies.find((strategy) => strategy.id === strategyId) ?? strategies[0];
}
