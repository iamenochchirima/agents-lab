import { openclawGraph } from './data/openclaw';
import { SystemExplorer } from './SystemExplorer';

export function OpenClawExplorerPage() {
  return <SystemExplorer graph={openclawGraph} />;
}
