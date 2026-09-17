export type ComponentLabStatus =
  | "planned"
  | "designing"
  | "ui-preview"
  | "implemented"
  | "verified"
  | "blocked";

export interface ComponentDocumentLink {
  documentId: string;
  label: string;
}

export interface ComponentAreaDescriptor {
  id: string;
  name: string;
  summary: string;
  status: ComponentLabStatus;
  nextAction: string;
  document?: ComponentDocumentLink;
}

export interface StrategyParameter {
  id: string;
  label: string;
  description: string;
  options: readonly string[];
  defaultValue: string;
}

export interface ComponentStrategyDescriptor {
  id: string;
  name: string;
  summary: string;
  status: ComponentLabStatus;
  parameters: readonly StrategyParameter[];
  inputs: readonly string[];
  outputs: readonly string[];
  limitations: readonly string[];
}

export interface ComponentCaseDescriptor {
  id: string;
  name: string;
  task: string;
  fixtureSummary: string;
  intendedObservation: string;
  controls: readonly string[];
}

export interface ContextEnvelopeField {
  label: string;
  value: string;
  detail: string;
}

export interface ContextEvidenceItem {
  label: string;
  description: string;
}
