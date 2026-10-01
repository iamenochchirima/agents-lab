import assert from "node:assert/strict";
import test from "node:test";

import {
  REFERENCE_ASSEMBLY_DESCRIPTOR,
  createCalculatorScenarioAgent,
  createComputerScenarioAgent,
  createReferenceAgent,
} from "../dist/index.js";

const expectedAreas = [
  "input", "context", "planning", "memory", "tool-use", "computer-use",
  "control", "execution-environment", "output-actions", "safety", "model-interface", "observability",
];

test("reference descriptor selects one known implementation for all twelve areas", () => {
  const agent = createReferenceAgent();
  assert.equal(agent.assembly, REFERENCE_ASSEMBLY_DESCRIPTOR);
  assert.deepEqual(agent.assembly.components.map((component) => component.area), expectedAreas);
  assert.equal(new Set(agent.assembly.components.map((component) => component.area)).size, 12);
  for (const component of agent.assembly.components) {
    assert.ok(component.packageName.startsWith("@agent-harness-lab/"));
    assert.ok(component.packageVersion);
    assert.ok(component.implementation.id);
    assert.ok(component.implementation.version);
    assert.doesNotThrow(() => JSON.stringify(component.configuration));
  }
});

test("calculator and computer scenarios keep the same selected assembly", () => {
  assert.deepEqual(createCalculatorScenarioAgent().assembly, REFERENCE_ASSEMBLY_DESCRIPTOR);
  assert.deepEqual(createComputerScenarioAgent().assembly, REFERENCE_ASSEMBLY_DESCRIPTOR);
});

test("static resolver rejects unknown, duplicate, or altered component selections", () => {
  const unknown = structuredClone(REFERENCE_ASSEMBLY_DESCRIPTOR);
  unknown.components.find((component) => component.area === "memory").implementation.id = "unregistered-memory";
  assert.throws(() => createReferenceAgent(unknown), /static Studio registry/);

  const duplicate = structuredClone(REFERENCE_ASSEMBLY_DESCRIPTOR);
  duplicate.components[1].area = "input";
  assert.throws(() => createReferenceAgent(duplicate), /unique registered implementation/);

  const changedConfig = structuredClone(REFERENCE_ASSEMBLY_DESCRIPTOR);
  changedConfig.components.find((component) => component.area === "context").configuration.maxMessages = 5;
  assert.throws(() => createReferenceAgent(changedConfig), /configuration for context/);

  const missingArea = structuredClone(REFERENCE_ASSEMBLY_DESCRIPTOR);
  missingArea.components.pop();
  assert.throws(() => createReferenceAgent(missingArea), /exactly one implementation/);

  const changedPackageVersion = structuredClone(REFERENCE_ASSEMBLY_DESCRIPTOR);
  changedPackageVersion.components.find((component) => component.area === "planning").packageVersion = "9.9.9";
  assert.throws(() => createReferenceAgent(changedPackageVersion), /static Studio registry/);
});
