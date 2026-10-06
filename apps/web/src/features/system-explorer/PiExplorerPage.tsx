import { piGraph } from './data/pi';
import { SystemExplorer } from './SystemExplorer';

export function PiExplorerPage() {
  return <SystemExplorer graph={piGraph} />;
}
