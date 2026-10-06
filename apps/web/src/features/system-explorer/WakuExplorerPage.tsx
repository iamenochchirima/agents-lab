import { wakuGraph } from './data/waku';
import { SystemExplorer } from './SystemExplorer';

export function WakuExplorerPage() {
  return <SystemExplorer graph={wakuGraph} />;
}
