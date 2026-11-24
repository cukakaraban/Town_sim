import * as polygonClipping from 'polygon-clipping';
import { Vec2 } from '../model/types';

const pc =
  (polygonClipping as unknown as { default?: typeof polygonClipping }).default ??
  polygonClipping;

export function v2(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function mul(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function lenSq(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

export function len(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function distSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function norm(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  if (l < 1e-9) return { x: 1, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

export function perp(a: Vec2): Vec2 {
  return { x: -a.y, y: a.x };
}

export function lerpVec(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function pointToSegment(
  p: Vec2,
  a: Vec2,
  b: Vec2
): { dist: number; t: number; proj: Vec2 } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lSq = dx * dx + dy * dy;
  if (lSq < 1e-12) {
    return { dist: dist(p, a), t: 0, proj: { x: a.x, y: a.y } };
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lSq));
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return { dist: dist(p, proj), t, proj };
}

export function segmentToSegmentDist(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2
): number {
  if (segmentIntersection(a1, a2, b1, b2, 1e-6)) return 0;
  return Math.min(
    pointToSegment(a1, b1, b2).dist,
    pointToSegment(a2, b1, b2).dist,
    pointToSegment(b1, a1, a2).dist,
    pointToSegment(b2, a1, a2).dist
  );
}

export interface SegmentIntersectionResult {
  point: Vec2;
  tA: number;
  tB: number;
}

export function segmentIntersection(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2,
  eps = 1e-7
): SegmentIntersectionResult | null {
  const rx = a2.x - a1.x;
  const ry = a2.y - a1.y;
  const sx = b2.x - b1.x;
  const sy = b2.y - b1.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null;

  const qpx = b1.x - a1.x;
  const qpy = b1.y - a1.y;
  const tA = (qpx * sy - qpy * sx) / denom;
  const tB = (qpx * ry - qpy * rx) / denom;

  if (tA >= -eps && tA <= 1 + eps && tB >= -eps && tB <= 1 + eps) {
    const clampedA = Math.max(0, Math.min(1, tA));
    const clampedB = Math.max(0, Math.min(1, tB));
    return {
      point: { x: a1.x + clampedA * rx, y: a1.y + clampedA * ry },
      tA: clampedA,
      tB: clampedB,
    };
  }
  return null;
}

export function polygonSignedArea(poly: readonly Vec2[]): number {
  if (poly.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return 0.5 * sum;
}

export function polygonArea(poly: readonly Vec2[]): number {
  return Math.abs(polygonSignedArea(poly));
}

export function ensureCCW(poly: Vec2[]): Vec2[] {
  if (polygonSignedArea(poly) < 0) {
    return [...poly].reverse();
  }
  return poly;
}

export function polygonCentroid(poly: readonly Vec2[]): Vec2 {
  if (poly.length === 0) return { x: 0, y: 0 };
  if (poly.length < 3) {
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / poly.length, y: sy / poly.length };
  }
  let areaSum = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const f = a.x * b.y - b.x * a.y;
    areaSum += f;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  if (Math.abs(areaSum) < 1e-8) {
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / poly.length, y: sy / poly.length };
  }
  return { x: cx / (3 * areaSum), y: cy / (3 * areaSum) };
}

export function polygonBounds(poly: readonly Vec2[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function boundsOverlap(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
  pad = 0
): boolean {
  return (
    a.minX <= b.maxX + pad &&
    a.maxX >= b.minX - pad &&
    a.minY <= b.maxY + pad &&
    a.maxY >= b.minY - pad
  );
}

export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;

    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointToPolygonBoundaryDist(p: Vec2, poly: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = pointToSegment(p, poly[i], poly[(i + 1) % poly.length]).dist;
    if (d < best) best = d;
  }
  return best;
}

export function pointInPolygonWithTolerance(
  p: Vec2,
  poly: readonly Vec2[],
  tolerance = 0.05
): boolean {
  if (pointInPolygon(p, poly)) return true;
  if (tolerance <= 0) return false;
  return pointToPolygonBoundaryDist(p, poly) <= tolerance;
}

/**
 * Checks whether every vertex of `inner` lies inside `outer` (within `tolerance` meters),
 * and verifies edges don't cross deeply outside when `outer` has concavities.
 */
export function polygonInsidePolygon(
  inner: readonly Vec2[],
  outer: readonly Vec2[],
  tolerance = 0.05
): boolean {
  if (inner.length < 3 || outer.length < 3) return false;
  for (const pt of inner) {
    if (!pointInPolygonWithTolerance(pt, outer, tolerance)) return false;
  }
  // Check edge midpoints too so long thin rectangles cannot bridge across concave bays
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i];
    const b = inner[(i + 1) % inner.length];
    const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
    if (!pointInPolygonWithTolerance(mid, outer, tolerance + 0.05)) return false;
  }
  return true;
}

export function distanceSegmentToPolygon(
  a: Vec2,
  b: Vec2,
  poly: readonly Vec2[]
): number {
  if (poly.length < 3) return Infinity;
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return 0;
  let minD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % poly.length];
    const d = segmentToSegmentDist(a, b, p1, p2);
    if (d === 0) return 0;
    if (d < minD) minD = d;
  }
  return minD;
}

export function distancePolylineToPolygon(
  polyline: readonly Vec2[],
  poly: readonly Vec2[]
): number {
  let minD = Infinity;
  for (let i = 1; i < polyline.length; i++) {
    const d = distanceSegmentToPolygon(polyline[i - 1], polyline[i], poly);
    if (d === 0) return 0;
    if (d < minD) minD = d;
  }
  return minD;
}

export function minDistancePolygons(polyA: readonly Vec2[], polyB: readonly Vec2[]): number {
  if (polyA.length < 3 || polyB.length < 3) return Infinity;
  if (pointInPolygon(polyA[0], polyB) || pointInPolygon(polyB[0], polyA)) return 0;
  let best = Infinity;
  for (let i = 0; i < polyA.length; i++) {
    const a1 = polyA[i];
    const a2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j++) {
      const b1 = polyB[j];
      const b2 = polyB[(j + 1) % polyB.length];
      const d = segmentToSegmentDist(a1, a2, b1, b2);
      if (d === 0) return 0;
      if (d < best) best = d;
    }
  }
  return best;
}

export function isConvexPolygon(poly: readonly Vec2[]): boolean {
  const n = poly.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const c = poly[(i + 2) % n];
    const ab = sub(b, a);
    const bc = sub(c, b);
    const cr = cross(ab, bc);
    if (Math.abs(cr) > 1e-7) {
      const s = cr > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (sign !== s) return false;
    } else {
      // Reject 180-degree backtracking hairpins along collinear edges
      if (dot(ab, bc) < -1e-6) return false;
    }
    // Reject repeated non-adjacent vertices (e.g. from concave clip)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (dist(poly[i], poly[j]) < 1e-3) return false;
    }
  }
  return sign !== 0;
}

/**
 * Clips a polygon against a convex CCW clip polygon using Sutherland-Hodgman.
 */
export function clipConvexPolygon(
  subject: readonly Vec2[],
  clipCCW: readonly Vec2[]
): Vec2[] {
  let out = [...subject];
  const n = clipCCW.length;
  for (let i = 0; i < n; i++) {
    const a = clipCCW[i];
    const b = clipCCW[(i + 1) % n];
    const edge = sub(b, a);
    const inward = norm({ x: -edge.y, y: edge.x });
    out = clipPolygonByHalfPlane(out, a, inward);
    if (out.length < 3) return [];
  }
  return out;
}

/**
 * Ear-clipping triangulation for any simple polygon (returns CCW triangles).
 */
export function triangulateSimplePolygon(poly: readonly Vec2[]): Vec2[][] {
  if (poly.length < 3) return [];
  if (poly.length === 3) return [ensureCCW([...poly])];

  const ccw = ensureCCW(deduplicatePoly(poly, 1e-4));
  if (ccw.length < 3) return [];
  if (ccw.length === 3) return [ccw];

  const indices = ccw.map((_, i) => i);
  const tris: Vec2[][] = [];
  let guard = ccw.length * ccw.length + 10;

  const ptInTri = (p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean => {
    const c1 = cross(sub(b, a), sub(p, a));
    const c2 = cross(sub(c, b), sub(p, b));
    const c3 = cross(sub(a, c), sub(p, c));
    return c1 >= -1e-7 && c2 >= -1e-7 && c3 >= -1e-7;
  };

  let cursor = 0;
  while (indices.length > 3 && guard-- > 0) {
    const lenI = indices.length;
    const iPrev = indices[(cursor - 1 + lenI) % lenI];
    const iCurr = indices[cursor % lenI];
    const iNext = indices[(cursor + 1) % lenI];

    const a = ccw[iPrev];
    const b = ccw[iCurr];
    const c = ccw[iNext];

    const cr = cross(sub(b, a), sub(c, b));
    if (cr > 1e-7) {
      let containsAny = false;
      for (let k = 0; k < lenI; k++) {
        const idx = indices[k];
        if (idx === iPrev || idx === iCurr || idx === iNext) continue;
        if (ptInTri(ccw[idx], a, b, c)) {
          containsAny = true;
          break;
        }
      }
      if (!containsAny) {
        tris.push([a, b, c]);
        indices.splice(cursor % lenI, 1);
        cursor = cursor % indices.length;
        continue;
      }
    }
    cursor = (cursor + 1) % indices.length;
  }

  if (indices.length === 3) {
    tris.push(ensureCCW([ccw[indices[0]], ccw[indices[1]], ccw[indices[2]]]));
  }
  return tris;
}

/**
 * Exact intersection area between two simple polygons (works for both convex & concave).
 */
export function polygonIntersectionArea(polyA: readonly Vec2[], polyB: readonly Vec2[]): number {
  if (polyA.length < 3 || polyB.length < 3) return 0;
  const bA = polygonBounds(polyA);
  const bB = polygonBounds(polyB);
  if (!boundsOverlap(bA, bB, 0)) return 0;

  if (isConvexPolygon(polyA) && isConvexPolygon(polyB)) {
    const ccwB = ensureCCW([...polyB]);
    const clipped = clipConvexPolygon(polyA, ccwB);
    return clipped.length >= 3 ? polygonArea(clipped) : 0;
  }

  const trisA = isConvexPolygon(polyA) ? [ensureCCW([...polyA])] : triangulateSimplePolygon(polyA);
  const trisB = isConvexPolygon(polyB) ? [ensureCCW([...polyB])] : triangulateSimplePolygon(polyB);
  let total = 0;
  for (const tA of trisA) {
    const btA = polygonBounds(tA);
    for (const tB of trisB) {
      if (!boundsOverlap(btA, polygonBounds(tB), 0)) continue;
      const inter = clipConvexPolygon(tA, tB);
      if (inter.length >= 3) total += polygonArea(inter);
    }
  }
  return total;
}

export function polygonsOverlap(
  polyA: readonly Vec2[],
  polyB: readonly Vec2[],
  maxAllowedArea = 0.01
): boolean {
  return polygonIntersectionArea(polyA, polyB) > maxAllowedArea;
}

export function shrinkPolygonTowardCenter(poly: readonly Vec2[], scale: number): Vec2[] {
  const c = polygonCentroid(poly);
  return poly.map((p) => lerpVec(c, p, scale));
}

export function hasPolygonFoldbackOrDupes(poly: readonly Vec2[], eps = 0.12): boolean {
  const n = poly.length;
  if (n < 3) return true;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (dist(poly[i], poly[j]) < eps) return true;
    }
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const c = poly[(i + 2) % n];
    const ab = sub(b, a);
    const bc = sub(c, b);
    const l1 = len(ab);
    const l2 = len(bc);
    if (l1 < 1e-4 || l2 < 1e-4) return true;
    if (dot(ab, bc) / (l1 * l2) < -0.992) return true;
  }
  return false;
}

export function polygonSelfIntersects(poly: readonly Vec2[]): boolean {
  const n = poly.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = poly[i];
    const a2 = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = poly[j];
      const b2 = poly[(j + 1) % n];
      const hit = segmentIntersection(a1, a2, b1, b2, -1e-6);
      if (hit) return true;
    }
  }
  return false;
}

/**
 * Sutherland-Hodgman half-plane clip: keeps points where dot(p - planePt, inwardNormal) >= 0.
 */
export function clipPolygonByHalfPlane(
  poly: readonly Vec2[],
  planePt: Vec2,
  inwardNormal: Vec2
): Vec2[] {
  if (poly.length < 3) return [];
  const out: Vec2[] = [];
  const signedDist = (p: Vec2) =>
    (p.x - planePt.x) * inwardNormal.x + (p.y - planePt.y) * inwardNormal.y;

  let prev = poly[poly.length - 1];
  let prevD = signedDist(prev);

  for (let i = 0; i < poly.length; i++) {
    const curr = poly[i];
    const currD = signedDist(curr);

    if (currD >= -1e-7) {
      if (prevD < -1e-7) {
        const t = prevD / (prevD - currD);
        out.push(lerpVec(prev, curr, Math.max(0, Math.min(1, t))));
      }
      out.push(curr);
    } else if (prevD >= -1e-7) {
      const t = prevD / (prevD - currD);
      out.push(lerpVec(prev, curr, Math.max(0, Math.min(1, t))));
    }

    prev = curr;
    prevD = currD;
  }
  return deduplicatePoly(out);
}

export function deduplicatePoly(poly: readonly Vec2[], minDist = 0.05): Vec2[] {
  if (poly.length === 0) return [];
  const res: Vec2[] = [];
  for (const p of poly) {
    if (res.length === 0 || dist(res[res.length - 1], p) > minDist) {
      res.push({ x: p.x, y: p.y });
    }
  }
  if (res.length > 1 && dist(res[0], res[res.length - 1]) <= minDist) {
    res.pop();
  }
  return res;
}

export function splitPolygonByLine(
  poly: readonly Vec2[],
  linePt: Vec2,
  lineDir: Vec2
): [Vec2[], Vec2[]] {
  const n = norm(perp(lineDir));
  const left = clipPolygonByHalfPlane(poly, linePt, n);
  const right = clipPolygonByHalfPlane(poly, linePt, { x: -n.x, y: -n.y });
  return [left, right];
}

export function offsetPolygon(poly: readonly Vec2[], inset: number): Vec2[] {
  if (poly.length < 3 || Math.abs(inset) < 1e-6) return [...poly];
  const ccw = ensureCCW([...poly]);
  const n = ccw.length;
  const result: Vec2[] = [];

  for (let i = 0; i < n; i++) {
    const pPrev = ccw[(i - 1 + n) % n];
    const pCurr = ccw[i];
    const pNext = ccw[(i + 1) % n];

    const e1 = norm(sub(pCurr, pPrev));
    const e2 = norm(sub(pNext, pCurr));
    const n1 = { x: -e1.y, y: e1.x };
    const n2 = { x: -e2.y, y: e2.x };

    const bisector = add(n1, n2);
    const bLen = len(bisector);
    if (bLen < 1e-5) {
      result.push(add(pCurr, mul(n1, inset)));
      continue;
    }
    const bUnit = mul(bisector, 1 / bLen);
    const cosHalf = Math.max(0.35, dot(bUnit, n1));
    const miterLen = Math.min(inset * 2.0, inset / cosHalf);
    let shifted = add(pCurr, mul(bUnit, miterLen));
    if (inset > 0 && !pointInPolygon(shifted, ccw)) {
      const half = add(pCurr, mul(bUnit, inset * 0.65));
      shifted = pointInPolygon(half, ccw) ? half : lerpVec(pCurr, polygonCentroid(ccw), 0.12);
    }
    result.push(shifted);
  }

  const cleaned = deduplicatePoly(result, 0.15);
  if (cleaned.length < 3) return [];
  if (polygonSignedArea(cleaned) <= 1.0) return [];
  const validDirect =
    !polygonSelfIntersects(cleaned) &&
    !hasPolygonFoldbackOrDupes(cleaned) &&
    (inset <= 0 || polygonInsidePolygon(cleaned, ccw, 0.0));
  if (validDirect) return cleaned;

  const c = polygonCentroid(ccw);
  const origArea = polygonArea(ccw);
  const estRadius = Math.sqrt(origArea / Math.PI);
  const scale = Math.max(0, (estRadius - inset) / Math.max(1, estRadius));
  if (scale <= 0.15) return [];
  const shrunk = ccw.map((p) => lerpVec(c, p, scale));
  if (
    !polygonSelfIntersects(shrunk) &&
    (inset <= 0 || polygonInsidePolygon(shrunk, ccw, 0.0))
  ) {
    return shrunk;
  }
  return [];
}

export function rdpSimplify(points: readonly Vec2[], epsilon: number): Vec2[] {
  if (points.length <= 2) return [...points];
  let maxDist = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = pointToSegment(points[i], first, last).dist;
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist > epsilon) {
    const left = rdpSimplify(points.slice(0, index + 1), epsilon);
    const right = rdpSimplify(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

export function chaikinSmooth(points: readonly Vec2[], passes = 2): Vec2[] {
  if (points.length < 3) return [...points];
  let pts = [...points];
  for (let p = 0; p < passes; p++) {
    const next: Vec2[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const q = lerpVec(pts[i], pts[i + 1], 0.25);
      const r = lerpVec(pts[i], pts[i + 1], 0.75);
      next.push(q, r);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

export function polylineLength(pts: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += dist(pts[i - 1], pts[i]);
  }
  return total;
}

export function samplePolylineAt(
  pts: readonly Vec2[],
  targetDist: number
): { pos: Vec2; tangent: Vec2 } {
  if (pts.length === 0) return { pos: { x: 0, y: 0 }, tangent: { x: 1, y: 0 } };
  if (pts.length === 1) return { pos: pts[0], tangent: { x: 1, y: 0 } };

  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const segLen = dist(pts[i - 1], pts[i]);
    if (acc + segLen >= targetDist || i === pts.length - 1) {
      const t = segLen > 1e-6 ? Math.max(0, Math.min(1, (targetDist - acc) / segLen)) : 0;
      const pos = lerpVec(pts[i - 1], pts[i], t);
      const tangent = norm(sub(pts[i], pts[i - 1]));
      return { pos, tangent };
    }
    acc += segLen;
  }
  return {
    pos: pts[pts.length - 1],
    tangent: norm(sub(pts[pts.length - 1], pts[pts.length - 2])),
  };
}

/**
 * Andrew's monotone chain convex hull (CCW) + optional outward padding.
 */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  if (points.length <= 2) return [...points];
  const sorted = [...points].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
  const lower: Vec2[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(sub(lower[lower.length - 1], lower[lower.length - 2]), sub(p, lower[lower.length - 2])) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(sub(upper[upper.length - 1], upper[upper.length - 2]), sub(p, upper[upper.length - 2])) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return ensureCCW([...lower, ...upper]);
}

export function expandPolygon(poly: readonly Vec2[], pad: number): Vec2[] {
  if (poly.length < 3) return [...poly];
  const c = polygonCentroid(poly);
  return poly.map((p) => {
    const d = norm(sub(p, c));
    return add(p, mul(d, pad));
  });
}

/**
 * Minimum Spanning Tree (Prim's algorithm) over node positions.
 */
export function computeMstEdges(points: readonly Vec2[]): Array<[number, number]> {
  const n = points.length;
  if (n < 2) return [];
  const inTree = new Array<boolean>(n).fill(false);
  const minDist = new Array<number>(n).fill(Infinity);
  const parent = new Array<number>(n).fill(-1);
  minDist[0] = 0;

  const edges: Array<[number, number]> = [];
  for (let step = 0; step < n; step++) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (!inTree[i] && (u === -1 || minDist[i] < minDist[u])) u = i;
    }
    if (u === -1) break;
    inTree[u] = true;
    if (parent[u] !== -1) edges.push([parent[u], u]);
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const d = dist(points[u], points[v]);
      if (d < minDist[v]) {
        minDist[v] = d;
        parent[v] = u;
      }
    }
  }
  return edges;
}

/**
 * Deterministic DBSCAN clustering over 2D points.
 */
export function dbscanPoints(
  points: readonly Vec2[],
  eps: number,
  minPts: number
): { clusters: number[][]; noise: number[] } {
  const n = points.length;
  const labels = new Array<number>(n).fill(-1); // -1 = unvisited, -2 = noise
  const clusters: number[][] = [];
  const epsSq = eps * eps;

  const regionQuery = (idx: number): number[] => {
    const p = points[idx];
    const res: number[] = [];
    for (let j = 0; j < n; j++) {
      if (distSq(p, points[j]) <= epsSq) res.push(j);
    }
    return res;
  };

  for (let i = 0; i < n; i++) {
    if (labels[i] !== -1) continue;
    const neighbors = regionQuery(i);
    if (neighbors.length < minPts) {
      labels[i] = -2;
      continue;
    }

    const clusterId = clusters.length;
    const members: number[] = [];
    labels[i] = clusterId;
    members.push(i);

    const queue = neighbors.filter((j) => j !== i);
    for (let q = 0; q < queue.length; q++) {
      const j = queue[q];
      if (labels[j] === -2) {
        labels[j] = clusterId;
        members.push(j);
      }
      if (labels[j] !== -1) continue;
      labels[j] = clusterId;
      members.push(j);
      const jNeighbors = regionQuery(j);
      if (jNeighbors.length >= minPts) {
        for (const kn of jNeighbors) {
          if (!queue.includes(kn)) queue.push(kn);
        }
      }
    }
    clusters.push(members);
  }

  const noise: number[] = [];
  for (let i = 0; i < n; i++) {
    if (labels[i] === -2) noise.push(i);
  }
  return { clusters, noise };
}

// ---------------------------------------------------------------------------
// v0.2.1 Geometry Kernels (polygon-clipping isolated inside geom.ts)
// ---------------------------------------------------------------------------

export function rdpSimplifyClosed(poly: readonly Vec2[], eps: number): Vec2[] {
  if (poly.length <= 6) return [...poly];
  const open = [...poly, poly[0]];
  const simp = rdpSimplify(open, eps);
  if (simp.length >= 4) simp.pop();
  return simp.length >= 3 ? simp : [...poly];
}

function snapCoord(v: number): number {
  return Math.round(v * 20) / 20;
}

function toPCRing(poly: readonly Vec2[], snapFn = snapCoord): polygonClipping.Ring {
  if (poly.length < 3) return [];
  const ring: polygonClipping.Ring = [];
  for (const p of poly) {
    const x = snapFn(p.x);
    const y = snapFn(p.y);
    if (ring.length === 0 || Math.hypot(x - ring[ring.length - 1][0], y - ring[ring.length - 1][1]) >= 0.05) {
      ring.push([x, y]);
    }
  }
  if (ring.length < 3) return [];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.05) {
    ring.pop();
  }
  if (ring.length < 3) return [];
  ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

function fromPCRing(ring: polygonClipping.Ring): Vec2[] {
  if (ring.length < 3) return [];
  const pts: Vec2[] = [];
  for (let i = 0; i < ring.length; i++) {
    const pt = { x: ring[i][0], y: ring[i][1] };
    if (i === ring.length - 1 && pts.length > 0 && dist(pts[0], pt) < 1e-5) {
      continue;
    }
    pts.push(pt);
  }
  return ensureCCW(deduplicatePoly(pts, 0.05));
}

function toPCMultiPolygon(polys: readonly (readonly Vec2[])[], snapFn = snapCoord): polygonClipping.MultiPolygon {
  const out: polygonClipping.MultiPolygon = [];
  for (const p of polys) {
    if (p.length >= 3 && polygonArea(p) >= 0.5) {
      const r = toPCRing(p, snapFn);
      if (r.length >= 4) out.push([r]);
    }
  }
  return out;
}

function fromPCMultiPolygon(mp: polygonClipping.MultiPolygon): Vec2[][] {
  const out: Vec2[][] = [];
  for (const poly of mp) {
    if (!poly || poly.length === 0) continue;
    const outer = fromPCRing(poly[0]);
    if (outer.length >= 3 && polygonArea(outer) >= 1.0) {
      out.push(outer);
    }
  }
  return out;
}

function safePCUnionList(mps: polygonClipping.MultiPolygon[]): polygonClipping.MultiPolygon {
  if (mps.length === 0) return [];
  if (mps.length === 1) return mps[0];
  try {
    return pc.union(mps[0], ...mps.slice(1));
  } catch {
    // Divide-and-conquer pairwise fallback so a single degenerate contact never breaks the whole union
    let acc = mps[0];
    for (let i = 1; i < mps.length; i++) {
      try {
        acc = pc.union(acc, mps[i]);
      } catch {
        // Fallback: keep disjoint polygon if union hits numerical collinearity
        acc = [...acc, ...mps[i]];
      }
    }
    return acc;
  }
}

export function unionPolygons(polys: readonly (readonly Vec2[])[]): Vec2[][] {
  const valid = toPCMultiPolygon(polys);
  if (valid.length === 0) return [];
  if (valid.length === 1) return fromPCMultiPolygon(valid);
  const res = safePCUnionList(valid.map((p) => [p]));
  return fromPCMultiPolygon(res);
}

export function unionPolygonsMetrics(polys: readonly (readonly Vec2[])[]): {
  area: number;
  perimeter: number;
  roundness: number;
} {
  const valid = toPCMultiPolygon(polys);
  if (valid.length === 0) return { area: 0, perimeter: 0, roundness: 0 };
  const res = safePCUnionList(valid.map((p) => [p]));
  let area = 0;
  let perimeter = 0;
  for (const poly of res) {
    if (!poly || poly.length === 0) continue;
    for (let rIdx = 0; rIdx < poly.length; rIdx++) {
      const ring = fromPCRing(poly[rIdx]);
      if (ring.length < 3) continue;
      const rArea = polygonArea(ring);
      area += rIdx === 0 ? rArea : -rArea;
      for (let i = 0; i < ring.length; i++) {
        perimeter += dist(ring[i], ring[(i + 1) % ring.length]);
      }
    }
  }
  if (area <= 0 || perimeter <= 1e-6) return { area: 0, perimeter: 0, roundness: 0 };
  const roundness = (4 * Math.PI * area) / (perimeter * perimeter);
  return { area, perimeter, roundness };
}

export function intersectMultiPolygons(
  a: readonly (readonly Vec2[])[],
  b: readonly (readonly Vec2[])[]
): Vec2[][] {
  const mpA = toPCMultiPolygon(a);
  const mpB = toPCMultiPolygon(b);
  if (mpA.length === 0 || mpB.length === 0) return [];
  try {
    return fromPCMultiPolygon(pc.intersection(mpA, mpB));
  } catch {
    const coarse = (v: number) => Math.round(v * 5) / 5;
    const cA = toPCMultiPolygon(a, coarse);
    const cB = toPCMultiPolygon(b, coarse);
    if (cA.length === 0 || cB.length === 0) return [];
    try {
      return fromPCMultiPolygon(pc.intersection(cA, cB));
    } catch {
      return [];
    }
  }
}

export function differenceMultiPolygons(
  subject: readonly (readonly Vec2[])[],
  clips: readonly (readonly Vec2[])[]
): Vec2[][] {
  const mpSub = toPCMultiPolygon(subject);
  if (mpSub.length === 0) return [];
  const mpClips = toPCMultiPolygon(clips);
  if (mpClips.length === 0) return fromPCMultiPolygon(mpSub);
  try {
    return fromPCMultiPolygon(pc.difference(mpSub, mpClips));
  } catch {
    let acc = mpSub;
    for (const c of mpClips) {
      if (acc.length === 0) break;
      try {
        acc = pc.difference(acc, [c]);
      } catch {
        // Coarser grid retry for degenerate kissing segments
        try {
          const coarse = (v: number) => Math.round(v * 10) / 10;
          const subCoarse = toPCMultiPolygon(fromPCMultiPolygon(acc), coarse);
          const clipCoarse = toPCMultiPolygon(fromPCMultiPolygon([c]), coarse);
          if (subCoarse.length > 0 && clipCoarse.length > 0) {
            acc = pc.difference(subCoarse, clipCoarse);
          }
        } catch {
          // Skip unresolvable micro-clip
        }
      }
    }
    return fromPCMultiPolygon(acc);
  }
}

export function bufferPolyline(pts: readonly Vec2[], halfWidth: number): Vec2[][] {
  if (pts.length < 2 || halfWidth <= 0) return [];
  const simp = rdpSimplify(pts, 2.2);
  const pieces: Vec2[][] = [];
  for (let i = 1; i < simp.length; i++) {
    const a = simp[i - 1];
    const b = simp[i];
    const d = dist(a, b);
    if (d < 0.2) continue;
    const dir = norm(sub(b, a));
    const n = perp(dir);
    const ext = Math.min(halfWidth * 0.72, halfWidth);
    const sa = sub(a, mul(dir, ext));
    const sb = add(b, mul(dir, ext));
    pieces.push(
      ensureCCW([
        add(sa, mul(n, halfWidth)),
        add(sb, mul(n, halfWidth)),
        sub(sb, mul(n, halfWidth)),
        sub(sa, mul(n, halfWidth)),
      ])
    );
  }
  return unionPolygons(pieces);
}

export function bufferMultiPolygonOutward(
  polys: readonly (readonly Vec2[])[],
  offset: number
): Vec2[][] {
  if (polys.length === 0) return [];
  if (offset <= 0) return unionPolygons(polys);
  const perPolyResults: Vec2[][] = [];
  for (const rawPoly of polys) {
    if (rawPoly.length < 3) continue;
    const poly = rdpSimplifyClosed(rawPoly, 3.0);
    const parts: Vec2[][] = [poly];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const d = dist(a, b);
      if (d < 0.25) continue;
      const dir = norm(sub(b, a));
      const n = perp(dir);
      const ext = offset * 0.78;
      const sa = sub(a, mul(dir, ext));
      const sb = add(b, mul(dir, ext));
      parts.push(
        ensureCCW([
          add(sa, mul(n, offset)),
          add(sb, mul(n, offset)),
          sub(sb, mul(n, offset)),
          sub(sa, mul(n, offset)),
        ])
      );
    }
    const u = unionPolygons(parts);
    for (const p of u) perPolyResults.push(p);
  }
  return unionPolygons(perPolyResults);
}

export function chaikinSmoothClosed(poly: readonly Vec2[], passes = 2): Vec2[] {
  if (poly.length < 3) return [...poly];
  let pts = [...poly];
  for (let p = 0; p < passes; p++) {
    const next: Vec2[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      next.push(lerpVec(a, b, 0.25), lerpVec(a, b, 0.75));
    }
    pts = next;
  }
  return ensureCCW(deduplicatePoly(pts, 0.1));
}

export function marchingSquaresContours(
  grid: readonly (readonly number[])[],
  originX: number,
  originY: number,
  cellSize: number,
  threshold: number
): Vec2[][] {
  const ny = grid.length;
  if (ny < 2) return [];
  const nx = grid[0].length;
  if (nx < 2) return [];

  interface Seg {
    a: Vec2;
    b: Vec2;
  }
  const segs: Seg[] = [];

  const interp = (v1: number, v2: number): number => {
    const denom = v2 - v1;
    if (Math.abs(denom) < 1e-9) return 0.5;
    return clamp((threshold - v1) / denom, 0, 1);
  };

  for (let iy = 0; iy < ny - 1; iy++) {
    const row0 = grid[iy];
    const row1 = grid[iy + 1];
    for (let ix = 0; ix < nx - 1; ix++) {
      const tl = row0[ix];
      const tr = row0[ix + 1];
      const br = row1[ix + 1];
      const bl = row1[ix];

      const b0 = tl >= threshold ? 8 : 0;
      const b1 = tr >= threshold ? 4 : 0;
      const b2 = br >= threshold ? 2 : 0;
      const b3 = bl >= threshold ? 1 : 0;
      const code = b0 | b1 | b2 | b3;
      if (code === 0 || code === 15) continue;

      const topPt = (): Vec2 => ({
        x: originX + (ix + interp(tl, tr)) * cellSize,
        y: originY + iy * cellSize,
      });
      const rightPt = (): Vec2 => ({
        x: originX + (ix + 1) * cellSize,
        y: originY + (iy + interp(tr, br)) * cellSize,
      });
      const bottomPt = (): Vec2 => ({
        x: originX + (ix + interp(bl, br)) * cellSize,
        y: originY + (iy + 1) * cellSize,
      });
      const leftPt = (): Vec2 => ({
        x: originX + ix * cellSize,
        y: originY + (iy + interp(tl, bl)) * cellSize,
      });

      const addPair = (p1: Vec2, p2: Vec2) => {
        if (dist(p1, p2) > 1e-5) segs.push({ a: p1, b: p2 });
      };

      switch (code) {
        case 1:
        case 14:
          addPair(leftPt(), bottomPt());
          break;
        case 2:
        case 13:
          addPair(bottomPt(), rightPt());
          break;
        case 3:
        case 12:
          addPair(leftPt(), rightPt());
          break;
        case 4:
        case 11:
          addPair(topPt(), rightPt());
          break;
        case 5: {
          const avg = 0.25 * (tl + tr + br + bl);
          if (avg >= threshold) {
            addPair(topPt(), leftPt());
            addPair(bottomPt(), rightPt());
          } else {
            addPair(topPt(), rightPt());
            addPair(leftPt(), bottomPt());
          }
          break;
        }
        case 6:
        case 9:
          addPair(topPt(), bottomPt());
          break;
        case 7:
        case 8:
          addPair(topPt(), leftPt());
          break;
        case 10: {
          const avg = 0.25 * (tl + tr + br + bl);
          if (avg >= threshold) {
            addPair(topPt(), rightPt());
            addPair(leftPt(), bottomPt());
          } else {
            addPair(topPt(), leftPt());
            addPair(bottomPt(), rightPt());
          }
          break;
        }
      }
    }
  }

  // Stitch undirected segments into closed loops
  const keyOf = (p: Vec2): string =>
    `${Math.round(p.x * 1000)}:${Math.round(p.y * 1000)}`;
  const adj = new Map<string, number[]>();
  const used = new Array<boolean>(segs.length).fill(false);

  for (let i = 0; i < segs.length; i++) {
    const ka = keyOf(segs[i].a);
    const kb = keyOf(segs[i].b);
    let la = adj.get(ka);
    if (!la) {
      la = [];
      adj.set(ka, la);
    }
    la.push(i);
    let lb = adj.get(kb);
    if (!lb) {
      lb = [];
      adj.set(kb, lb);
    }
    lb.push(i);
  }

  const loops: Vec2[][] = [];
  for (let startIdx = 0; startIdx < segs.length; startIdx++) {
    if (used[startIdx]) continue;
    used[startIdx] = true;
    const poly: Vec2[] = [segs[startIdx].a, segs[startIdx].b];
    const startKey = keyOf(segs[startIdx].a);
    let currKey = keyOf(segs[startIdx].b);

    let guard = 0;
    while (currKey !== startKey && guard < segs.length + 10) {
      guard++;
      const list = adj.get(currKey);
      if (!list) break;
      let nextSegIdx = -1;
      for (const sIdx of list) {
        if (!used[sIdx]) {
          nextSegIdx = sIdx;
          break;
        }
      }
      if (nextSegIdx === -1) break;
      used[nextSegIdx] = true;
      const seg = segs[nextSegIdx];
      const nextPt = keyOf(seg.a) === currKey ? seg.b : seg.a;
      poly.push(nextPt);
      currKey = keyOf(nextPt);
    }

    if (currKey === startKey && poly.length >= 4) {
      poly.pop(); // remove closing duplicate
      const cleaned = ensureCCW(deduplicatePoly(poly, 0.25));
      if (cleaned.length >= 3 && polygonArea(cleaned) > 1.0) {
        loops.push(cleaned);
      }
    }
  }

  return loops;
}

export function catmullRomSpline(ctrlPts: readonly Vec2[], samplesPerSeg = 16): Vec2[] {
  if (ctrlPts.length < 2) return [...ctrlPts];
  if (ctrlPts.length === 2) return [ctrlPts[0], ctrlPts[1]];

  const pStart = sub(mul(ctrlPts[0], 2), ctrlPts[1]);
  const pEnd = sub(
    mul(ctrlPts[ctrlPts.length - 1], 2),
    ctrlPts[ctrlPts.length - 2]
  );
  const pts = [pStart, ...ctrlPts, pEnd];
  const out: Vec2[] = [];

  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2];

    // Centripetal Catmull-Rom knot intervals (alpha = 0.5)
    const t0 = 0;
    const t1 = t0 + Math.pow(Math.max(1e-4, dist(p0, p1)), 0.5);
    const t2 = t1 + Math.pow(Math.max(1e-4, dist(p1, p2)), 0.5);
    const t3 = t2 + Math.pow(Math.max(1e-4, dist(p2, p3)), 0.5);

    const steps = i === pts.length - 3 ? samplesPerSeg : samplesPerSeg;
    for (let s = 0; s < steps; s++) {
      const t = t1 + ((t2 - t1) * s) / steps;
      const A1 = add(
        mul(p0, (t1 - t) / Math.max(1e-6, t1 - t0)),
        mul(p1, (t - t0) / Math.max(1e-6, t1 - t0))
      );
      const A2 = add(
        mul(p1, (t2 - t) / Math.max(1e-6, t2 - t1)),
        mul(p2, (t - t1) / Math.max(1e-6, t2 - t1))
      );
      const A3 = add(
        mul(p2, (t3 - t) / Math.max(1e-6, t3 - t2)),
        mul(p3, (t - t2) / Math.max(1e-6, t3 - t2))
      );

      const B1 = add(
        mul(A1, (t2 - t) / Math.max(1e-6, t2 - t0)),
        mul(A2, (t - t0) / Math.max(1e-6, t2 - t0))
      );
      const B2 = add(
        mul(A2, (t3 - t) / Math.max(1e-6, t3 - t1)),
        mul(A3, (t - t1) / Math.max(1e-6, t3 - t1))
      );

      const C = add(
        mul(B1, (t2 - t) / Math.max(1e-6, t2 - t1)),
        mul(B2, (t - t1) / Math.max(1e-6, t2 - t1))
      );
      out.push(C);
    }
  }
  out.push(ctrlPts[ctrlPts.length - 1]);
  return out;
}

export function minTurningRadius(pts: readonly Vec2[], sampleSpacing = 14): number {
  if (pts.length < 3) return Infinity;
  const totalLen = polylineLength(pts);
  if (totalLen < 12) return Infinity;

  let sampled: Vec2[];
  if (totalLen > sampleSpacing * 3) {
    const count = Math.max(4, Math.round(totalLen / sampleSpacing));
    sampled = [];
    for (let i = 0; i <= count; i++) {
      sampled.push(samplePolylineAt(pts, (i / count) * totalLen).pos);
    }
  } else {
    sampled = [...pts];
  }

  let minR = Infinity;
  for (let i = 1; i < sampled.length - 1; i++) {
    const a = sampled[i - 1];
    const b = sampled[i];
    const c = sampled[i + 1];
    const ab = dist(a, b);
    const bc = dist(b, c);
    const ac = dist(a, c);
    const area2 = Math.abs(cross(sub(b, a), sub(c, a)));
    if (area2 < 1e-6) continue;
    const r = (ab * bc * ac) / (2 * area2);
    if (r < minR) minR = r;
  }
  return minR;
}

export function computePcaAspectRatio(pts: readonly Vec2[]): number {
  const n = pts.length;
  if (n < 3) return 1;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;

  let cxx = 0;
  let cyy = 0;
  let cxy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  cxx /= n;
  cyy /= n;
  cxy /= n;

  const trace = cxx + cyy;
  const disc = Math.sqrt(Math.max(0, (cxx - cyy) * (cxx - cyy) + 4 * cxy * cxy));
  const lambda1 = 0.5 * (trace + disc);
  const lambda2 = 0.5 * (trace - disc);
  if (lambda2 <= 1e-9) return 100;
  return Math.sqrt(lambda1 / lambda2);
}

function convexSatOverlap(a: readonly Vec2[], b: readonly Vec2[], eps = 1e-4): boolean {
  const testAxes = (poly: readonly Vec2[]): boolean => {
    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i];
      const p1 = poly[(i + 1) % poly.length];
      const axis = perp(norm(sub(p1, p0)));
      let minA = Infinity,
        maxA = -Infinity;
      for (const p of a) {
        const pr = p.x * axis.x + p.y * axis.y;
        if (pr < minA) minA = pr;
        if (pr > maxA) maxA = pr;
      }
      let minB = Infinity,
        maxB = -Infinity;
      for (const p of b) {
        const pr = p.x * axis.x + p.y * axis.y;
        if (pr < minB) minB = pr;
        if (pr > maxB) maxB = pr;
      }
      if (maxA <= minB + eps || maxB <= minA + eps) return false;
    }
    return true;
  };
  return testAxes(a) && testAxes(b);
}

/**
 * Independent Separating Axis Theorem (SAT) overlap check for two simple polygons.
 */
export function satPolygonsOverlap(
  polyA: readonly Vec2[],
  polyB: readonly Vec2[],
  eps = 1e-3
): boolean {
  if (polyA.length < 3 || polyB.length < 3) return false;
  const bA = polygonBounds(polyA);
  const bB = polygonBounds(polyB);
  if (!boundsOverlap(bA, bB, 0)) return false;

  if (isConvexPolygon(polyA) && isConvexPolygon(polyB)) {
    return convexSatOverlap(polyA, polyB, eps);
  }
  const trisA = isConvexPolygon(polyA) ? [polyA] : triangulateSimplePolygon(polyA);
  const trisB = isConvexPolygon(polyB) ? [polyB] : triangulateSimplePolygon(polyB);
  for (const tA of trisA) {
    for (const tB of trisB) {
      if (convexSatOverlap(tA, tB, eps)) return true;
    }
  }
  return false;
}

export function distPointToPolyline(
  p: Vec2,
  pts: readonly Vec2[]
): { dist: number; tangent: Vec2; closest: Vec2 } {
  let bestD = Infinity;
  let bestTan = { x: 1, y: 0 };
  let bestPt = pts[0] ?? { x: 0, y: 0 };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const res = pointToSegment(p, a, b);
    if (res.dist < bestD) {
      bestD = res.dist;
      bestPt = res.proj;
      bestTan = norm(sub(b, a));
    }
  }
  return { dist: bestD, tangent: bestTan, closest: bestPt };
}

export function distToNearestPolyline(
  polylines: readonly (readonly Vec2[])[],
  p: Vec2
): number {
  let best = Infinity;
  for (const pl of polylines) {
    const d = distPointToPolyline(p, pl).dist;
    if (d < best) best = d;
  }
  return best;
}

