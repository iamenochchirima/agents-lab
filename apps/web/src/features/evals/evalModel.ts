export type EvalGroup = "B" | "M" | "X";

export interface EvalCase {
  id: string;
  group: EvalGroup;
  title: string;
  task: string;
  acceptance: string;
}

/** Read the case tables from the canonical specification. Fail on malformed or
 * duplicate rows so a documentation edit cannot silently hide an acceptance case.
 * The source format is three pipe-separated cells; literal pipes must be escaped.
 */
export function readEvalCases(source: string): EvalCase[] {
  const cases: EvalCase[] = [];
  const ids = new Set<string>();
  for (const line of source.split(/\r?\n/)) {
    if (!/^\|\s*[BMX]\d/.test(line)) continue;
    const cells = line.trim().slice(1, -1).split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, "|"));
    const match = cells[0]?.match(/^([BMX]\d{2})\s+(.+)$/);
    if (!line.trim().endsWith("|") || cells.length !== 3 || !match || cells.some(cell => !cell)) {
      throw new Error(`Malformed eval specification row: ${line}`);
    }
    if (ids.has(match[1])) throw new Error(`Duplicate eval case: ${match[1]}`);
    ids.add(match[1]);
    cases.push({ id: match[1], group: match[1][0] as EvalGroup, title: match[2], task: cells[1], acceptance: cells[2] });
  }
  return cases;
}
