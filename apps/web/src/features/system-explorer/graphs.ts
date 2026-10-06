import { openclawGraph } from './data/openclaw';
import { piGraph } from './data/pi';
import { wakuGraph } from './data/waku';

export const explorerGraphs = [openclawGraph, piGraph, wakuGraph] as const;
