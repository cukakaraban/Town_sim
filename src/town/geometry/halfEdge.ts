import { GraphEdge, GraphNode, Vec2 } from '../model/types';
import { deduplicatePoly, polygonSelfIntersects, polygonSignedArea } from './geom';

export interface ExtractedFace {
  polygon: Vec2[];
  edgeIds: number[];
  signedArea: number;
}

interface HalfEdge {
  id: number;
  edgeId: number;
  fromNode: number;
  toNode: number;
  pts: Vec2[]; // oriented from fromNode -> toNode
  startAngle: number;
  twinId: number;
  visited: boolean;
}

/**
 * Extracts bounded planar faces from a planar graph by sorting half-edges around each node
 * by outgoing angle and walking the minimal-angle left-turn cycle.
 * Discards the outer unbounded face (negative signed area).
 */
export function extractPlanarFaces(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[]
): ExtractedFace[] {
  if (nodes.length === 0 || edges.length === 0) return [];

  const nodeMap = new Map<number, GraphNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const halfEdges: HalfEdge[] = [];
  const outgoing = new Map<number, number[]>();
  for (const n of nodes) outgoing.set(n.id, []);

  for (const edge of edges) {
    if (edge.nodeA === edge.nodeB || edge.polyline.length < 2) continue;
    const fwdPts = edge.polyline;
    const revPts = [...edge.polyline].reverse();

    const fwdStartAngle = Math.atan2(fwdPts[1].y - fwdPts[0].y, fwdPts[1].x - fwdPts[0].x);
    const revStartAngle = Math.atan2(revPts[1].y - revPts[0].y, revPts[1].x - revPts[0].x);

    const heFwdId = halfEdges.length;
    const heRevId = heFwdId + 1;

    halfEdges.push({
      id: heFwdId,
      edgeId: edge.id,
      fromNode: edge.nodeA,
      toNode: edge.nodeB,
      pts: fwdPts,
      startAngle: fwdStartAngle,
      twinId: heRevId,
      visited: false,
    });
    halfEdges.push({
      id: heRevId,
      edgeId: edge.id,
      fromNode: edge.nodeB,
      toNode: edge.nodeA,
      pts: revPts,
      startAngle: revStartAngle,
      twinId: heFwdId,
      visited: false,
    });

    outgoing.get(edge.nodeA)?.push(heFwdId);
    outgoing.get(edge.nodeB)?.push(heRevId);
  }

  // Sort outgoing half-edges CCW by startAngle around each node
  const nodeSortedPos = new Map<number, Map<number, number>>();
  for (const [nodeId, list] of outgoing.entries()) {
    list.sort((a, b) => halfEdges[a].startAngle - halfEdges[b].startAngle);
    const posMap = new Map<number, number>();
    for (let i = 0; i < list.length; i++) {
      posMap.set(list[i], i);
    }
    nodeSortedPos.set(nodeId, posMap);
  }

  const nextHalfEdge = (heId: number): number => {
    const he = halfEdges[heId];
    const targetNode = he.toNode;
    const list = outgoing.get(targetNode);
    const posMap = nodeSortedPos.get(targetNode);
    if (!list || list.length === 0 || !posMap) return -1;

    const twinPos = posMap.get(he.twinId);
    if (twinPos === undefined) return -1;
    // In CCW order around targetNode, the previous outgoing edge relative to twin
    // forms the tightest CCW (interior) face walk!
    const nextIdx = (twinPos - 1 + list.length) % list.length;
    return list[nextIdx];
  };

  const faces: ExtractedFace[] = [];
  const maxSteps = Math.max(200, edges.length * 2 + 10);

  for (let i = 0; i < halfEdges.length; i++) {
    if (halfEdges[i].visited) continue;

    const cycleEdges: number[] = [];
    const polyPts: Vec2[] = [];
    let curr = i;
    let steps = 0;
    let closed = false;

    while (steps < maxSteps) {
      steps++;
      const he = halfEdges[curr];
      if (he.visited) {
        closed = curr === i && cycleEdges.length >= 2;
        break;
      }
      he.visited = true;
      cycleEdges.push(he.edgeId);
      // Append all points except the final endpoint (next edge starts there)
      for (let k = 0; k < he.pts.length - 1; k++) {
        polyPts.push(he.pts[k]);
      }

      const nxt = nextHalfEdge(curr);
      if (nxt < 0) break;
      curr = nxt;
      if (curr === i) {
        closed = true;
        break;
      }
    }

    if (!closed || polyPts.length < 3) continue;
    const cleaned = deduplicatePoly(polyPts, 0.2);
    if (cleaned.length < 3) continue;

    const signedArea = polygonSignedArea(cleaned);
    // Keep only bounded CCW interior faces (positive signed area)
    if (signedArea > 50 && !polygonSelfIntersects(cleaned)) {
      const uniqueEdgeIds = Array.from(new Set(cycleEdges));
      faces.push({
        polygon: cleaned,
        edgeIds: uniqueEdgeIds,
        signedArea,
      });
    }
  }

  return faces;
}
