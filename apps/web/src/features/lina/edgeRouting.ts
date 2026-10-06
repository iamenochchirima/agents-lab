import type { LinaEdge, LinaNode } from './linaModel';

export const LINA_NODE_WIDTH = 300;
export const LINA_NODE_HEIGHT = 144;
const CLEARANCE = 30;
const TURN_COST = 48;
const MAX_LANES = 14;

type Point = { x: number; y: number };
type Box = { left: number; right: number; top: number; bottom: number; id: string };
type Port = { point: Point; escape: Point };
export type LinaEdgeRoute = {
  path: string;
  labelX: number;
  labelY: number;
  labelAnchor: 'start' | 'middle' | 'end';
};

function box(node: LinaNode, padding = CLEARANCE): Box {
  return { id: node.id, left: node.x - padding, right: node.x + LINA_NODE_WIDTH + padding,
    top: node.y - padding, bottom: node.y + LINA_NODE_HEIGHT + padding };
}

/** Routes may follow a clearance boundary, but never enter its interior. */
function intersects(a: Point, b: Point, obstacle: Box): boolean {
  if (a.x === b.x) return a.x > obstacle.left && a.x < obstacle.right
    && Math.max(a.y, b.y) > obstacle.top && Math.min(a.y, b.y) < obstacle.bottom;
  return a.y > obstacle.top && a.y < obstacle.bottom
    && Math.max(a.x, b.x) > obstacle.left && Math.min(a.x, b.x) < obstacle.right;
}

function simplify(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last?.x === point.x && last.y === point.y) continue;
    const before = result.at(-2);
    if (before && last && ((before.x === last.x && last.x === point.x)
      || (before.y === last.y && last.y === point.y))) result.pop();
    result.push(point);
  }
  return result;
}

function ports(node: LinaNode, offset: number): Port[] {
  const cx = node.x + LINA_NODE_WIDTH / 2 + offset;
  const cy = node.y + LINA_NODE_HEIGHT / 2 + offset;
  return [
    { point: { x: node.x + LINA_NODE_WIDTH, y: cy }, escape: { x: node.x + LINA_NODE_WIDTH + CLEARANCE, y: cy } },
    { point: { x: node.x, y: cy }, escape: { x: node.x - CLEARANCE, y: cy } },
    { point: { x: cx, y: node.y + LINA_NODE_HEIGHT }, escape: { x: cx, y: node.y + LINA_NODE_HEIGHT + CLEARANCE } },
    { point: { x: cx, y: node.y }, escape: { x: cx, y: node.y - CLEARANCE } },
  ];
}

function lanes(values: number[], start: number, end: number, outer: number): number[] {
  // Keep both endpoint lanes and the outer bus. Remaining lanes are ranked by
  // the extra distance they add, so large imported documents have bounded work.
  const distance = (value: number) => Math.abs(start - value) + Math.abs(end - value);
  const candidates = [...new Set(values)].sort((a, b) => distance(a) - distance(b) || a - b);
  return [...new Set([start, end, (start + end) / 2, outer, ...candidates.slice(0, MAX_LANES)])];
}

function labelPosition(points: Point[], nodes: LinaNode[], label: string, offset: number): Omit<LinaEdgeRoute, 'path'> {
  const width = Math.max(60, label.length * 7 + 20);
  const obstacles = nodes.map(node => box(node, 8));
  const segments = points.slice(1).map((end, index) => {
    const start = points[index];
    return { start, end, horizontal: start.y === end.y,
      length: Math.abs(end.x - start.x) + Math.abs(end.y - start.y) };
  }).sort((a, b) => Number(b.horizontal && b.length >= width) - Number(a.horizontal && a.length >= width)
    || b.length - a.length);
  for (const segment of segments) {
    for (const fraction of [.5, .3, .7]) {
      for (const side of [-1, 1]) {
        const x = segment.start.x + (segment.end.x - segment.start.x) * fraction;
        const y = segment.start.y + (segment.end.y - segment.start.y) * fraction;
        const labelX = segment.horizontal ? x : x + side * 12;
        const labelY = segment.horizontal ? y + (side < 0 ? -12 : 25) - offset / 3 : y - offset / 3;
        const labelAnchor = segment.horizontal ? 'middle' : side < 0 ? 'end' : 'start';
        const left = labelAnchor === 'middle' ? labelX - width / 2 : labelAnchor === 'end' ? labelX - width : labelX;
        if (obstacles.every(obstacle => left + width <= obstacle.left || left >= obstacle.right
          || labelY <= obstacle.top || labelY - 18 >= obstacle.bottom)) {
          return { labelX, labelY, labelAnchor };
        }
      }
    }
  }
  // An overlapping user layout can leave no room beside any segment. Keep the
  // label readable in the canvas margin instead of placing it inside a node.
  return { labelX: Math.max(0, ...nodes.map(node => node.x + LINA_NODE_WIDTH)) + 60,
    labelY: points[0].y, labelAnchor: 'start' };
}

/** Return an SVG orthogonal connection and a label beside a clear segment.
 * Missing endpoints return an empty path. Geometry is deterministic; index
 * separates neighbouring connections without changing the design document.
 * Candidate lanes are bounded rather than building an O(nodes²) grid.
 */
export function routeLinaEdge(edge: LinaEdge, nodes: readonly LinaNode[], index = 0): LinaEdgeRoute {
  const source = nodes.find(node => node.id === edge.source);
  const target = nodes.find(node => node.id === edge.target);
  if (!source || !target) return { path: '', labelX: 0, labelY: 0, labelAnchor: 'middle' };
  const sourceId = source.id, targetId = target.id;
  const offset = ((index % 5) - 2) * 9;
  const obstacles = nodes.map(node => box(node));
  const sourcePorts = ports(source, offset);
  const targetPorts = ports(target, offset);
  const outerX = Math.max(0, ...obstacles.map(obstacle => obstacle.right)) + 180 + (index % 7) * 18;
  const outerY = Math.max(0, ...obstacles.map(obstacle => obstacle.bottom)) + 100 + (index % 7) * 18;
  let best: Point[] | undefined;
  let bestCost = Infinity;
  let fallback: Point[] | undefined;
  let fallbackCost = Infinity;

  function consider(from: Port, to: Port, middle: Point[], outerBus = false) {
    const points = simplify([from.point, ...middle, to.point]);
    const length = points.slice(1).reduce((total, point, i) => total
      + Math.abs(point.x - points[i].x) + Math.abs(point.y - points[i].y), 0);
    const cost = length + Math.max(0, points.length - 2) * TURN_COST;
    if (cost >= bestCost) return;
    let collisions = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      for (const obstacle of obstacles) {
        // Only the short port stub may enter its own component's clearance.
        // Check before simplification below, since a stub can merge with a lane.
        if (obstacle.id === sourceId || obstacle.id === targetId) continue;
        if (intersects(a, b, obstacle)) collisions++;
      }
    }
    for (let i = 1; i < middle.length; i++) {
      for (const obstacle of obstacles) {
        if ((obstacle.id === sourceId || obstacle.id === targetId)
          && intersects(middle[i - 1], middle[i], obstacle)) collisions++;
      }
    }
    if (!collisions && cost < bestCost) { best = points; bestCost = cost; }
    if (outerBus && collisions * 1000000 + cost < fallbackCost) {
      fallback = points; fallbackCost = collisions * 1000000 + cost;
    }
  }

  const pairs = [[0, 1], [1, 0], [2, 3], [3, 2], [0, 0], [1, 1], [2, 2], [3, 3]];
  for (const [sourceSide, targetSide] of pairs) {
    const from = sourcePorts[sourceSide], to = targetPorts[targetSide];
    const a = from.escape, b = to.escape;
    const xs = lanes(obstacles.flatMap(obstacle => [obstacle.left, obstacle.right]), a.x, b.x, outerX);
    const ys = lanes(obstacles.flatMap(obstacle => [obstacle.top, obstacle.bottom]), a.y, b.y, outerY);
    for (const x of xs) consider(from, to, [a, { x, y: a.y }, { x, y: b.y }, b], x === outerX);
    for (const y of ys) consider(from, to, [a, { x: a.x, y }, { x: b.x, y }, b], y === outerY);
    // Four bends can get around blockers on both endpoint lanes. Only search
    // these when the shorter routes fail, to keep dragging a node responsive.
    if (!best) {
      for (const x of xs) for (const y of ys) {
        consider(from, to, [a, { x, y: a.y }, { x, y }, { x: b.x, y }, b], x === outerX || y === outerY);
        consider(from, to, [a, { x: a.x, y }, { x, y }, { x, y: b.y }, b], x === outerX || y === outerY);
      }
    }
  }
  // Dense or overlapping user layouts may have no clear route in the bounded
  // lane search. Prefer the outer bus with the fewest obstructions in that case;
  // it stays inside the renderer's right/bottom margins and remains inspectable.
  const points = best ?? fallback ?? [sourcePorts[0].point, sourcePorts[0].escape,
    { x: outerX, y: sourcePorts[0].escape.y }, { x: outerX, y: targetPorts[0].escape.y },
    targetPorts[0].escape, targetPorts[0].point];
  return { path: points.map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' '),
    ...labelPosition(points, [...nodes], edge.label, offset) };
}
