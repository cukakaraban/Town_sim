import { GraphEdge, GraphNode, RoadClass, RouteResult, Street, Vec2 } from '../model/types';
import { dist, pointToSegment } from './geom';

interface HeapItem {
  nodeId: number;
  cost: number;
}

/**
 * Binary min-heap priority queue for Dijkstra shortest paths.
 */
export class MinHeap {
  private data: HeapItem[] = [];

  get size(): number {
    return this.data.length;
  }

  push(item: HeapItem): void {
    this.data.push(item);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): HeapItem | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(idx: number): void {
    const item = this.data[idx];
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1;
      const parent = this.data[parentIdx];
      if (item.cost >= parent.cost) break;
      this.data[idx] = parent;
      idx = parentIdx;
    }
    this.data[idx] = item;
  }

  private sinkDown(idx: number): void {
    const len = this.data.length;
    const item = this.data[idx];
    while (true) {
      const left = (idx << 1) + 1;
      const right = left + 1;
      let smallest = idx;
      if (left < len && this.data[left].cost < this.data[smallest].cost) {
        smallest = left;
      }
      if (right < len && this.data[right].cost < this.data[smallest].cost) {
        smallest = right;
      }
      if (smallest === idx) break;
      this.data[idx] = this.data[smallest];
      idx = smallest;
    }
    this.data[idx] = item;
  }
}

export const WALK_SPEED_MPS = 1.4;

export function roadSpeedMps(roadClass: RoadClass): number {
  switch (roadClass) {
    case RoadClass.Arterial:
      return WALK_SPEED_MPS * 1.05; // wide regional arterial footway
    case RoadClass.Main:
      return WALK_SPEED_MPS * 1.04; // paved wide footpaths
    case RoadClass.Secondary:
      return WALK_SPEED_MPS;
    case RoadClass.Lane:
      return WALK_SPEED_MPS * 0.96;
  }
}

export interface ProjectedEdgePoint {
  edge: GraphEdge;
  proj: Vec2;
  distAlongEdge: number;
  distFromOrigin: number;
}

export function projectPointOntoEdges(
  pos: Vec2,
  edges: readonly GraphEdge[],
  preferredEdgeId?: number | null
): ProjectedEdgePoint | null {
  if (edges.length === 0) return null;

  const evalEdge = (edge: GraphEdge): ProjectedEdgePoint => {
    let bestDist = Infinity;
    let bestProj = edge.polyline[0];
    let bestAlong = 0;
    let acc = 0;

    for (let i = 1; i < edge.polyline.length; i++) {
      const a = edge.polyline[i - 1];
      const b = edge.polyline[i];
      const segLen = dist(a, b);
      const res = pointToSegment(pos, a, b);
      if (res.dist < bestDist) {
        bestDist = res.dist;
        bestProj = res.proj;
        bestAlong = acc + res.t * segLen;
      }
      acc += segLen;
    }

    return {
      edge,
      proj: bestProj,
      distAlongEdge: Math.max(0, Math.min(edge.length, bestAlong)),
      distFromOrigin: bestDist,
    };
  };

  if (preferredEdgeId !== undefined && preferredEdgeId !== null) {
    const pref = edges.find((e) => e.id === preferredEdgeId);
    if (pref) return evalEdge(pref);
  }

  let best: ProjectedEdgePoint | null = null;
  for (const edge of edges) {
    const cand = evalEdge(edge);
    if (!best || cand.distFromOrigin < best.distFromOrigin) {
      best = cand;
    }
  }
  return best;
}

function sliceEdgePolyline(
  polyline: readonly Vec2[],
  fromDist: number,
  toDist: number
): Vec2[] {
  const forward = toDist >= fromDist;
  const d0 = Math.min(fromDist, toDist);
  const d1 = Math.max(fromDist, toDist);

  const pts: Vec2[] = [];
  let acc = 0;

  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1];
    const b = polyline[i];
    const segLen = dist(a, b);
    const segStart = acc;
    const segEnd = acc + segLen;

    if (segEnd >= d0 - 1e-6 && segStart <= d1 + 1e-6 && segLen > 1e-6) {
      const tStart = Math.max(0, Math.min(1, (d0 - segStart) / segLen));
      const tEnd = Math.max(0, Math.min(1, (d1 - segStart) / segLen));
      if (pts.length === 0) {
        pts.push({
          x: a.x + (b.x - a.x) * tStart,
          y: a.y + (b.y - a.y) * tStart,
        });
      }
      pts.push({
        x: a.x + (b.x - a.x) * tEnd,
        y: a.y + (b.y - a.y) * tEnd,
      });
    }
    acc = segEnd;
  }

  if (!forward) {
    pts.reverse();
  }
  return pts;
}

export function findShortestRoute(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  streets: readonly Street[],
  fromPos: Vec2,
  toPos: Vec2,
  fromEdgeId?: number | null,
  toEdgeId?: number | null
): RouteResult {
  const nodeMap = new Map<number, GraphNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const edgeMap = new Map<number, GraphEdge>();
  for (const e of edges) edgeMap.set(e.id, e);

  const streetMap = new Map<number, Street>();
  for (const s of streets) streetMap.set(s.id, s);

  const startProj = projectPointOntoEdges(fromPos, edges, fromEdgeId);
  const endProj = projectPointOntoEdges(toPos, edges, toEdgeId);

  if (!startProj || !endProj) {
    return { found: false, polyline: [], distanceMeters: 0, walkingMinutes: 0, streetNames: [] };
  }

  // Same edge direct walk shortcut
  if (startProj.edge.id === endProj.edge.id) {
    const slice = sliceEdgePolyline(
      startProj.edge.polyline,
      startProj.distAlongEdge,
      endProj.distAlongEdge
    );
    const poly = [fromPos, ...slice, toPos];
    let totalDist = 0;
    for (let i = 1; i < poly.length; i++) totalDist += dist(poly[i - 1], poly[i]);
    const street = streetMap.get(startProj.edge.streetId);
    return {
      found: true,
      polyline: poly,
      distanceMeters: totalDist,
      walkingMinutes: totalDist / (WALK_SPEED_MPS * 60),
      streetNames: street ? [street.name] : [],
    };
  }

  // Virtual node IDs: -1 = start, -2 = end
  const START_ID = -1;
  const END_ID = -2;

  type AdjStep = { to: number; cost: number; length: number; edgeId: number; reverse: boolean };
  const extraAdj = new Map<number, AdjStep[]>();
  const addExtra = (u: number, step: AdjStep) => {
    let arr = extraAdj.get(u);
    if (!arr) {
      arr = [];
      extraAdj.set(u, arr);
    }
    arr.push(step);
  };

  // Connect START_ID to both ends of startProj.edge
  {
    const e = startProj.edge;
    const spd = roadSpeedMps(e.roadClass);
    const dToA = startProj.distAlongEdge;
    const dToB = Math.max(0, e.length - startProj.distAlongEdge);
    addExtra(START_ID, { to: e.nodeA, cost: dToA / spd, length: dToA, edgeId: e.id, reverse: true });
    addExtra(START_ID, { to: e.nodeB, cost: dToB / spd, length: dToB, edgeId: e.id, reverse: false });
  }

  // Connect both ends of endProj.edge to END_ID
  {
    const e = endProj.edge;
    const spd = roadSpeedMps(e.roadClass);
    const dFromA = endProj.distAlongEdge;
    const dFromB = Math.max(0, e.length - endProj.distAlongEdge);
    addExtra(e.nodeA, { to: END_ID, cost: dFromA / spd, length: dFromA, edgeId: e.id, reverse: false });
    addExtra(e.nodeB, { to: END_ID, cost: dFromB / spd, length: dFromB, edgeId: e.id, reverse: true });
  }

  const distCost = new Map<number, number>();
  const prev = new Map<
    number,
    { from: number; edgeId: number; reverse: boolean; isStartSlice?: boolean; isEndSlice?: boolean }
  >();
  const heap = new MinHeap();

  distCost.set(START_ID, 0);
  heap.push({ nodeId: START_ID, cost: 0 });

  while (heap.size > 0) {
    const curr = heap.pop()!;
    if (curr.cost > (distCost.get(curr.nodeId) ?? Infinity)) continue;
    if (curr.nodeId === END_ID) break;

    const extras = extraAdj.get(curr.nodeId);
    if (extras) {
      for (const step of extras) {
        const nextCost = curr.cost + step.cost;
        if (nextCost < (distCost.get(step.to) ?? Infinity)) {
          distCost.set(step.to, nextCost);
          prev.set(step.to, {
            from: curr.nodeId,
            edgeId: step.edgeId,
            reverse: step.reverse,
            isStartSlice: curr.nodeId === START_ID,
            isEndSlice: step.to === END_ID,
          });
          heap.push({ nodeId: step.to, cost: nextCost });
        }
      }
    }

    if (curr.nodeId >= 0) {
      const node = nodeMap.get(curr.nodeId);
      if (!node) continue;
      for (const eid of node.edgeIds) {
        const e = edgeMap.get(eid);
        if (!e) continue;
        const other = e.nodeA === curr.nodeId ? e.nodeB : e.nodeA;
        const reverse = e.nodeB === curr.nodeId;
        const edgeCost = e.length / roadSpeedMps(e.roadClass);
        const nextCost = curr.cost + edgeCost;
        if (nextCost < (distCost.get(other) ?? Infinity)) {
          distCost.set(other, nextCost);
          prev.set(other, { from: curr.nodeId, edgeId: e.id, reverse });
          heap.push({ nodeId: other, cost: nextCost });
        }
      }
    }
  }

  if (!prev.has(END_ID)) {
    return { found: false, polyline: [], distanceMeters: 0, walkingMinutes: 0, streetNames: [] };
  }

  // Reconstruct path steps
  const steps: Array<{
    from: number;
    to: number;
    edgeId: number;
    reverse: boolean;
    isStartSlice?: boolean;
    isEndSlice?: boolean;
  }> = [];
  let trace = END_ID;
  while (trace !== START_ID) {
    const p = prev.get(trace);
    if (!p) break;
    steps.push({
      from: p.from,
      to: trace,
      edgeId: p.edgeId,
      reverse: p.reverse,
      isStartSlice: p.isStartSlice,
      isEndSlice: p.isEndSlice,
    });
    trace = p.from;
  }
  steps.reverse();

  const polyline: Vec2[] = [fromPos];
  const streetNames: string[] = [];

  for (const s of steps) {
    const e = edgeMap.get(s.edgeId);
    if (!e) continue;
    const st = streetMap.get(e.streetId);
    if (st && (streetNames.length === 0 || streetNames[streetNames.length - 1] !== st.name)) {
      streetNames.push(st.name);
    }

    let pts: Vec2[];
    if (s.isStartSlice) {
      pts = sliceEdgePolyline(
        e.polyline,
        startProj.distAlongEdge,
        s.reverse ? 0 : e.length
      );
    } else if (s.isEndSlice) {
      pts = sliceEdgePolyline(
        e.polyline,
        s.reverse ? e.length : 0,
        endProj.distAlongEdge
      );
    } else {
      pts = s.reverse ? [...e.polyline].reverse() : [...e.polyline];
    }

    for (const pt of pts) {
      if (polyline.length === 0 || dist(polyline[polyline.length - 1], pt) > 0.25) {
        polyline.push(pt);
      }
    }
  }

  if (dist(polyline[polyline.length - 1], toPos) > 0.25) {
    polyline.push(toPos);
  }

  let totalDist = 0;
  for (let i = 1; i < polyline.length; i++) {
    totalDist += dist(polyline[i - 1], polyline[i]);
  }
  const totalSec = (distCost.get(END_ID) ?? totalDist / WALK_SPEED_MPS) +
    (startProj.distFromOrigin + endProj.distFromOrigin) / WALK_SPEED_MPS;

  return {
    found: true,
    polyline,
    distanceMeters: totalDist,
    walkingMinutes: totalSec / 60,
    streetNames,
  };
}
