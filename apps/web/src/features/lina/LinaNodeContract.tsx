import { useState } from 'react';
import { contractForNode, outputsForEdge, schemaDocument } from './contracts/nodeContracts';
import type { Json, Schema, ContractOutput } from './contracts/schema';

/** Native disclosure controls keep every nested object/array independently keyboard accessible. */
function JsonField({ value, name, comma = false, root = false }: { value: unknown; name?: string; comma?: boolean; root?: boolean }) {
  const prefix = name === undefined ? null : <><span className="lina-json-key">{JSON.stringify(name)}</span><span className="lina-json-punctuation">: </span></>;
  const suffix = comma ? ',' : '';
  if (value !== null && typeof value === 'object') {
    const array = Array.isArray(value);
    const entries = array ? value.map((item, index) => [String(index), item] as const) : Object.entries(value);
    const open = array ? '[' : '{';
    const close = array ? ']' : '}';
    if (!entries.length) return <div className="lina-json-line">{prefix}<span className="lina-json-punctuation">{open}{close}{suffix}</span></div>;
    return <details className="lina-json-branch" open={root}>
      <summary>{prefix}<span className="lina-json-punctuation">{open}</span><span className="lina-json-folded"><span className="lina-json-count"> … {entries.length} {array ? 'items' : 'fields'} </span><span className="lina-json-punctuation">{close}{suffix}</span></span></summary>
      <div className="lina-json-children">{entries.map(([key, item], index) => <JsonField key={key} name={array ? undefined : key} value={item} comma={index < entries.length - 1}/>)}</div>
      <div className="lina-json-line lina-json-punctuation">{close}{suffix}</div>
    </details>;
  }
  const type = value === null ? 'null' : typeof value;
  return <div className="lina-json-line">{prefix}<span className={`lina-json-${type}`}>{JSON.stringify(value)}</span><span className="lina-json-punctuation">{suffix}</span></div>;
}
function JsonView({ value, label }: { value: Json | object; label: string }) {
  return <div className="lina-contract-json" role="group" aria-label={label}><JsonField value={value} root/></div>;
}
function SchemaView({ schema, label }: { schema: Schema; label: string }) {
  return <details className="lina-contract-schema"><summary>{label}</summary><JsonView value={schemaDocument(schema)} label={label}/></details>;
}
function OutputView({ output }: { output: ContractOutput }) {
  return <section className="lina-contract-output">
    <p className="lina-muted">{output.when}</p>
    <JsonView value={output.example} label="Example output"/>
    <SchemaView schema={output.schema} label="Output schema"/>
    {!output.edgeIds.length && <p className="lina-muted">Local or external outcome. No outgoing graph connection.</p>}
  </section>;
}
/** Examples are reference fixtures, independent of current simulation playback. */
export function LinaNodeContract({ nodeId }: { nodeId: string }) {
  const contract = contractForNode(nodeId);
  const [inputIndex, setInputIndex] = useState(0);
  const [outputIndex, setOutputIndex] = useState(0);
  if (!contract) return <p className="lina-muted">No contract has been defined for this component.</p>;
  const example = contract.input.examples[inputIndex] ?? contract.input.examples[0];
  const output = contract.outputs[outputIndex] ?? contract.outputs[0];
  return <div className="lina-contract">
    <p className="lina-muted">Provisional · v{contract.version} · Reference examples</p>
    <h3>Example input</h3>
    <label className="lina-contract-label">Input path<select aria-label="Input path" value={inputIndex} onChange={event => setInputIndex(Number(event.target.value))}>
      {contract.input.examples.map((item, index) => <option key={index} value={index}>{item.source} · {item.label}</option>)}
    </select></label>
    {example && <JsonView key={inputIndex} value={example.value} label="Example input"/>}
    <SchemaView schema={contract.input.schema} label="Input schema"/>
    <h3>Example output</h3>
    <label className="lina-contract-label">Outcome<select aria-label="Output outcome" value={outputIndex} onChange={event => setOutputIndex(Number(event.target.value))}>
      {contract.outputs.map((item, index) => <option key={item.id} value={index}>{item.label}</option>)}
    </select></label>
    {output && <OutputView key={output.id} output={output}/>}
    <details className="lina-contract-rules"><summary>State and rules</summary>
      <h3>Context supplied by</h3><p className="lina-muted">{contract.contextSource}</p>
      <h3>Reads</h3><ul>{contract.reads.map(read => <li key={read}>{read}</li>)}</ul>
      <h3>Writes</h3>{contract.writes.length ? <ul>{contract.writes.map(write => <li key={write}>{write}</li>)}</ul> : <p className="lina-muted">No persistent writes.</p>}
      <h3>Rules</h3><ul>{contract.rules.map(rule => <li key={rule}>{rule}</li>)}</ul>
    </details>
  </div>;
}
export function LinaConnectionContract({ edgeId }: { edgeId: string }) {
  const outputs = outputsForEdge(edgeId);
  const [index, setIndex] = useState(0);
  const current = outputs[index] ?? outputs[0];
  if (!current) return <p className="lina-muted">No payload contract has been defined for this connection.</p>;
  return <div className="lina-contract">
    <h3>Transferred output</h3>
    <label className="lina-contract-label">Outcome<select aria-label="Connection outcome" value={index} onChange={event => setIndex(Number(event.target.value))}>
      {outputs.map((item, position) => <option key={item.id} value={position}>{item.label}</option>)}
    </select></label>
    <OutputView key={current.id} output={current}/>
  </div>;
}
