/** JSON Schema vocabulary for provisional design contracts, never a runtime validator. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Schema {
  type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null';
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  minItems?: number;
  minLength?: number;
  minimum?: number;
  const?: Json;
  enum?: Json[];
  anyOf?: Schema[];
  description?: string;
}
export interface Payload { schema: Schema; example: Json }
export const text = (example: string, description?: string): Payload => ({ schema: { type: 'string', minLength: 1, ...(description ? { description } : {}) }, example });
export const count = (example: number): Payload => ({ schema: { type: 'integer', minimum: 0 }, example });
export const flag = (example: boolean): Payload => ({ schema: { type: 'boolean' }, example });
export const fixed = (example: Json): Payload => ({ schema: { const: example }, example });
export const choice = (values: string[], example = values[0]): Payload => ({ schema: { type: 'string', enum: values }, example });
export const nullable = (value: Payload): Payload => ({ schema: { anyOf: [value.schema, { type: 'null' }] }, example: value.example });
export const sample = (value: Payload, example: Json): Payload => ({ schema: value.schema, example });
export const list = (value: Payload, examples: Json[] = [value.example], minItems = 0): Payload => ({ schema: { type: 'array', items: value.schema, minItems }, example: examples });
export const union = (...values: Payload[]): Payload => ({ schema: { anyOf: values.map(value => value.schema) }, example: values[0].example });
export function object(fields: Record<string, Payload>, optional: string[] = []): Payload {
  return { schema: { type: 'object', properties: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.schema])), required: Object.keys(fields).filter(key => !optional.includes(key)), additionalProperties: false }, example: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.example])) };
}
/** Refine a shared record field for one branch, including its example. */
export function replaceField(value: Payload, key: string, field: Payload): Payload {
  if (value.schema.type !== 'object' || !value.schema.properties || !value.schema.properties[key]) throw new Error(`Cannot refine unknown record field ${key}`);
  return { schema: { ...value.schema, properties: { ...value.schema.properties, [key]: field.schema } }, example: { ...(value.example as Record<string, Json>), [key]: field.example } };
}
export interface ContractOutput extends Payload {
  id: string;
  label: string;
  when: string;
  edgeIds: string[];
}
export interface ContractDefinition {
  nodeId: string;
  /** Inputs supplied outside graph edges, e.g. a channel event or restart scan. */
  external?: { label: string; value: Payload; source: string }[];
  context: Payload;
  contextSource: string;
  /** Alternative dependency snapshots for inputs with different coordinator state. */
  contextExamples?: { label: string; value: Payload }[];
  reads: string[];
  writes: string[];
  rules: string[];
  outputs: ContractOutput[];
}
export function output(id: string, label: string, value: Payload, edgeIds: string[], when: string): ContractOutput {
  const event = object({ kind: fixed(id), payload: value });
  return { ...event, id, label, when, edgeIds };
}
export const inputEdges = (...ids: number[]) => ids.map(id => `lina-input-edge-${id}`);
export const executionEdges = (...ids: string[]) => ids.map(id => `lina-execution-edge-${id}`);
