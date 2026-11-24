import {
  Address,
  Block,
  BlockKind,
  Building,
  BuildingKind,
  District,
  DistrictArchetype,
  DwellingType,
  FieldPolygon,
  GraphEdge,
  GraphNode,
  HouseholdSlot,
  Lot,
  OverlapViolation,
  ROAD_HALF_WIDTH,
  ROAD_SPEED_KPH,
  ResolvedTownShape,
  RetailCluster,
  RetailClusterKind,
  RoadClass,
  SettlementNode,
  SprawlKind,
  StageDiagnostic,
  StopReason,
  Street,
  StreamlineTrace,
  TensorBasis,
  TownData,
  TownParams,
  TreeCluster,
  Vec2,
  Venue,
  VenueDef,
  VenueSite,
  WealthTier,
  formatAddress,
} from '../model/types';
import {
  ARCHETYPE_SPECS,
  DISTRICT_NAMES_BY_ARCHETYPE,
  DWELLING_SPECS,
  PRESET_CONFIGS,
  RETAIL_AFFINITY_MATRIX,
  UK_FIRST_NAMES,
  UK_STREET_ROOTS,
  UK_SURNAMES,
  VENUE_DEFS,
  VENUE_NAMED_VARIANTS,
} from '../data/presets';
import { MAP_THEMES } from '../data/themes';
import { fnv1a, Noise2D, SeededRng } from '../geometry/rng';
import {
  add,
  boundsOverlap,
  bufferMultiPolygonOutward,
  bufferPolyline,
  catmullRomSpline,
  chaikinSmooth,
  chaikinSmoothClosed,
  clamp,
  clipPolygonByHalfPlane,
  convexHull,
  cross,
  dbscanPoints,
  deduplicatePoly,
  differenceMultiPolygons,
  dist,
  distancePolylineToPolygon,
  dot,
  ensureCCW,
  expandPolygon,
  hasPolygonFoldbackOrDupes,
  intersectMultiPolygons,
  lerpVec,
  marchingSquaresContours,
  minDistancePolygons,
  minTurningRadius,
  mul,
  norm,
  offsetPolygon,
  perp,
  pointInPolygon,
  pointToPolygonBoundaryDist,
  pointToSegment,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  polygonInsidePolygon,
  polygonIntersectionArea,
  polygonSelfIntersects,
  polylineLength,
  rdpSimplify,
  rdpSimplifyClosed,
  samplePolylineAt,
  segmentIntersection,
  splitPolygonByLine,
  sub,
} from '../geometry/geom';
import { SpatialHash } from '../geometry/spatialHash';
import { rk4Step, sampleTensorDirection } from '../geometry/tensor';
import { extractPlanarFaces } from '../geometry/halfEdge';
import {
  computeOverlapViolations,
  hashTownData,
  isRetailVenueForClustering,
  repairBuildingsPass,
  runInvariants,
} from './invariants';

export { hashTownData, runInvariants };

export interface RetailParkCampusPlan {
  center: Vec2;
  u: Vec2;
  v: Vec2;
  vBase: number;
  serviceRoad: Vec2[];
  backLoopRoad: Vec2[];
  padPoly: Vec2[];
  carParkPoly: Vec2[];
  boxes: Array<{ origin: Vec2; w: number; d: number; isAnchor: boolean }>;
  pods: Array<{ origin: Vec2; w: number; d: number; defId: string }>;
  serviceTraceId: number;
  districtId: number;
}

export interface GenContext {
  params: TownParams;
  resolvedTownShape: ResolvedTownShape;
  domainAngle: number;
  domainPolygon: Vec2[];
  spinePolyline: Vec2[];
  arterialPolylines: Vec2[][];
  settlementNodes: SettlementNode[];
  builtUpPolygons: Vec2[][];
  ribbonContours: Vec2[][];
  retailParkServiceRoad: Vec2[] | null;
  retailParkCampus: RetailParkCampusPlan | null;
  urbanityGrid: {
    originX: number;
    originY: number;
    cellSize: number;
    nx: number;
    ny: number;
    values: number[][];
  } | null;
  urbanityAt: (p: Vec2) => number;
  isBuiltUp: (p: Vec2) => boolean;
  distanceToBuiltUp: (p: Vec2) => number;
  entryPoints: Vec2[];
  districts: District[];
  superblockCenters: Vec2[];
  arterialTraces: StreamlineTrace[];
  protectedTraceIds: Set<number>;
  tensorBases: TensorBasis[];
  noise: Noise2D;
  streamlines: StreamlineTrace[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  blocks: Block[];
  lots: Lot[];
  buildings: Building[];
  venueSites: VenueSite[];
  streets: Street[];
  venues: Venue[];
  retailClusters: RetailCluster[];
  unplacedVenues: Array<{ defId: string; displayName: string; reason: string }>;
  households: HouseholdSlot[];
  estimatedPopulation: number;
  namedShare: number;
  fields: FieldPolygon[];
  woodlands: Vec2[][];
  hedgerows: Array<[Vec2, Vec2]>;
  treeClusters: TreeCluster[];
  discardedSliverBlocks: number;
  diagnostics: StageDiagnostic[];
  fittingAttempts: number;
  fittingWarning: string | null;
  overlapViolations: OverlapViolation[];
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function createInitialContext(params: TownParams): GenContext {
  return {
    params,
    resolvedTownShape: 'strip',
    domainAngle: 0,
    domainPolygon: [],
    spinePolyline: [],
    arterialPolylines: [],
    settlementNodes: [],
    builtUpPolygons: [],
    ribbonContours: [],
    retailParkServiceRoad: null,
    retailParkCampus: null,
    urbanityGrid: null,
    urbanityAt: () => 0,
    isBuiltUp: () => false,
    distanceToBuiltUp: () => Infinity,
    entryPoints: [],
    districts: [],
    superblockCenters: [],
    arterialTraces: [],
    protectedTraceIds: new Set<number>(),
    tensorBases: [],
    noise: new Noise2D(fnv1a(params.seed, 'tensor_noise')),
    streamlines: [],
    nodes: [],
    edges: [],
    blocks: [],
    lots: [],
    buildings: [],
    venueSites: [],
    streets: [],
    venues: [],
    retailClusters: [],
    unplacedVenues: [],
    households: [],
    estimatedPopulation: 0,
    namedShare: 0,
    fields: [],
    woodlands: [],
    hedgerows: [],
    treeClusters: [],
    discardedSliverBlocks: 0,
    diagnostics: [],
    fittingAttempts: 1,
    fittingWarning: null,
    overlapViolations: [],
  };
}

// ---------------------------------------------------------------------------
// Domain, Spine & Urbanity Helpers (v0.2.1)
// ---------------------------------------------------------------------------
function makeOrganicCopse(
  center: Vec2,
  radius: number,
  noise: Noise2D,
  phaseX: number,
  phaseY: number,
  vertices = 16
): Vec2[] {
  const poly: Vec2[] = [];
  for (let i = 0; i < vertices; i++) {
    const angle = (i / vertices) * Math.PI * 2;
    const nx = Math.cos(angle) * 1.4 + phaseX;
    const ny = Math.sin(angle) * 1.4 + phaseY;
    const warp = 1 + clamp(noise.fbm(nx, ny, 3, 2.0, 0.5) * 0.22, -0.22, 0.22);
    const r = radius * warp;
    poly.push({
      x: center.x + Math.cos(angle) * r,
      y: center.y + Math.sin(angle) * r,
    });
  }
  return ensureCCW(poly);
}

function computeVoronoiCells(seeds: Vec2[], boundary: Vec2[]): Vec2[][] {
  return seeds.map((seedA, idxA) => {
    let cell = [...boundary];
    for (let idxB = 0; idxB < seeds.length; idxB++) {
      if (idxA === idxB) continue;
      const seedB = seeds[idxB];
      const mid = { x: (seedA.x + seedB.x) * 0.5, y: (seedA.y + seedB.y) * 0.5 };
      const inward = norm(sub(seedA, seedB));
      cell = clipPolygonByHalfPlane(cell, mid, inward);
      if (cell.length < 3) break;
    }
    return ensureCCW(cell);
  });
}

function findDistrictAt(districts: readonly District[], p: Vec2): District | null {
  for (const d of districts) {
    for (const poly of d.polygons) {
      if (poly.length >= 3 && pointInPolygon(p, poly)) return d;
    }
  }
  return null;
}

function findNearestDistrict(districts: readonly District[], p: Vec2): District {
  const exact = findDistrictAt(districts, p);
  if (exact) return exact;
  let best = districts[0];
  let bestD = Infinity;
  for (const d of districts) {
    const dd = dist(p, d.seedPoint);
    if (dd < bestD) {
      bestD = dd;
      best = d;
    }
  }
  return best;
}

function distPointToPolyline(p: Vec2, pts: readonly Vec2[]): { dist: number; tangent: Vec2; closest: Vec2 } {
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

function distToNearestPolyline(polylines: readonly (readonly Vec2[])[], p: Vec2): number {
  let best = Infinity;
  for (const pl of polylines) {
    const d = distPointToPolyline(p, pl).dist;
    if (d < best) best = d;
  }
  return best;
}

function resampleDense(pts: readonly Vec2[], step = 8.0): Vec2[] {
  if (pts.length < 2) return [...pts];
  const out: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = dist(a, b);
    const subs = Math.max(1, Math.ceil(d / step));
    for (let s = 1; s <= subs; s++) {
      out.push(lerpVec(a, b, s / subs));
    }
  }
  return out;
}

function clipPolylineToDomain(pts: readonly Vec2[], domain: readonly Vec2[], insetMargin = 4): Vec2[] {
  const safeDomain = offsetPolygon([...domain], insetMargin);
  const polyCheck = safeDomain.length >= 3 ? safeDomain : domain;
  const out: Vec2[] = [];
  for (const p of pts) {
    if (pointInPolygon(p, polyCheck)) {
      out.push(p);
    } else if (out.length > 0) {
      break;
    }
  }
  return out;
}

function rayToPolygonBoundary(origin: Vec2, dir: Vec2, maxDist: number, domain: readonly Vec2[]): Vec2 {
  const end = add(origin, mul(dir, maxDist));
  let bestPt = end;
  let bestD = Infinity;
  for (let i = 0; i < domain.length; i++) {
    const hit = segmentIntersection(origin, end, domain[i], domain[(i + 1) % domain.length]);
    if (hit) {
      const d = dist(origin, hit.point);
      if (d < bestD && d > 1) {
        bestD = d;
        bestPt = hit.point;
      }
    }
  }
  return bestPt;
}

// ---------------------------------------------------------------------------
// Stage 1: Spine and Rotated Rectangular Domain
// ---------------------------------------------------------------------------
export function runStageSpineAndDomain(ctx: GenContext): void {
  const t0 = nowMs();
  const rng = SeededRng.fromStage(ctx.params.seed, 'spine');
  const preset = PRESET_CONFIGS[ctx.params.preset];

  const domainW = ctx.params.domainSize?.w ?? 3800;
  const domainH = ctx.params.domainSize?.h ?? 2000;
  ctx.params.townExtent = Math.max(domainW, domainH);
  ctx.params.townRadius = ctx.params.townExtent * 0.5;

  // Resolve town shape ('strip' | 'fork' | 'crossroads')
  let resolvedShape: ResolvedTownShape;
  if (ctx.params.townShape && ctx.params.townShape !== 'auto') {
    resolvedShape = ctx.params.townShape;
  } else {
    const wMap = preset.townShapeWeights;
    const totalW = wMap.strip + wMap.fork + wMap.crossroads;
    let r = rng.range(0, Math.max(1e-6, totalW));
    if ((r -= wMap.strip) <= 0) resolvedShape = 'strip';
    else if ((r -= wMap.fork) <= 0) resolvedShape = 'fork';
    else resolvedShape = 'crossroads';
  }
  ctx.resolvedTownShape = resolvedShape;

  // Rotated rectangular domain (keep within +/- 27 deg so towns stretch visibly horizontally/diagonally)
  const angle = rng.range(-0.47, 0.47);
  ctx.domainAngle = angle;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const toWorld = (u: number, v: number): Vec2 => ({
    x: u * cosA - v * sinA,
    y: u * sinA + v * cosA,
  });
  const toLocal = (p: Vec2): Vec2 => ({
    x: p.x * cosA + p.y * sinA,
    y: -p.x * sinA + p.y * cosA,
  });

  const halfW = domainW * 0.5;
  const halfH = domainH * 0.5;
  ctx.domainPolygon = ensureCCW([
    toWorld(-halfW, -halfH),
    toWorld(halfW, -halfH),
    toWorld(halfW, halfH),
    toWorld(-halfW, halfH),
  ]);

  const maxOff = clamp(ctx.params.spineMaxOffset ?? 250, 140, halfH * 0.42);
  const minTurnR = Math.max(100, ctx.params.spineMinRadius ?? 150);

  // Build meandering main spine (~400 m control spacing along long axis)
  const nCtrl = 10;
  let chosenSpine: Vec2[] | null = null;
  let relaxFactor = 1.0;

  for (let attempt = 0; attempt < 12; attempt++) {
    if (attempt >= 8) relaxFactor *= 0.86;
    const rawOff: number[] = [];
    let walk = rng.range(-70, 70);
    const waveFreq = rng.range(2.2, 3.2);
    const wavePhase = rng.range(0, Math.PI * 2);
    const waveAmp = rng.range(0.68, 0.96) * maxOff * relaxFactor;

    for (let i = 0; i < nCtrl; i++) {
      const t = i / (nCtrl - 1);
      walk = clamp(walk + rng.range(-95, 95) * relaxFactor, -maxOff * 0.85, maxOff * 0.85);
      const wave = Math.sin(t * Math.PI * waveFreq + wavePhase) * waveAmp;
      rawOff.push(clamp(0.45 * walk + 0.55 * wave, -maxOff * relaxFactor, maxOff * relaxFactor));
    }
    // Smooth lateral offsets twice with [0.25, 0.5, 0.25]
    let sm = [...rawOff];
    for (let p = 0; p < 2; p++) {
      sm = sm.map((val, i) => {
        const prev = sm[Math.max(0, i - 1)];
        const next = sm[Math.min(sm.length - 1, i + 1)];
        return 0.25 * prev + 0.5 * val + 0.25 * next;
      });
    }

    // Tune interior amplitude if sinuosity < 1.048
    let ampBoost = 1.0;
    for (let tune = 0; tune < 5; tune++) {
      const ctrlPts: Vec2[] = [];
      for (let i = 0; i < nCtrl; i++) {
        const u = lerpVec({ x: -halfW + 10, y: 0 }, { x: halfW - 10, y: 0 }, i / (nCtrl - 1)).x;
        const endTaper = i === 0 || i === nCtrl - 1 ? 0.55 : 1.0;
        const v = clamp(sm[i] * ampBoost * endTaper, -halfH + 140, halfH - 140);
        ctrlPts.push(toWorld(u, v));
      }
      const spline = resampleDense(catmullRomSpline(ctrlPts, 18), 8.0);
      const sLen = polylineLength(spline);
      const chord = dist(spline[0], spline[spline.length - 1]);
      const sinuosity = sLen / Math.max(1, chord);
      const turnR = minTurningRadius(spline, 16);

      if (sinuosity >= 1.048 && sinuosity <= 1.23 && turnR >= minTurnR + 8) {
        chosenSpine = spline;
        break;
      }
      if (sinuosity < 1.048) ampBoost *= 1.18;
      else if (sinuosity > 1.23 || turnR < minTurnR + 8) ampBoost *= 0.86;
    }
    if (chosenSpine) break;
  }

  if (!chosenSpine) {
    const ctrlPts: Vec2[] = [];
    for (let i = 0; i < nCtrl; i++) {
      const t = i / (nCtrl - 1);
      const u = -halfW + 10 + t * (domainW - 20);
      const v = Math.sin(t * Math.PI * 2.6 + 0.4) * Math.min(230, maxOff);
      ctrlPts.push(toWorld(u, v));
    }
    chosenSpine = resampleDense(catmullRomSpline(ctrlPts, 18), 8.0);
  }

  ctx.spinePolyline = chosenSpine;
  const arterialPolylines: Vec2[][] = [chosenSpine];
  const entries: Vec2[] = [chosenSpine[0], chosenSpine[chosenSpine.length - 1]];

  // Optional Branch / Crossroad (2nd arterial)
  if (resolvedShape === 'fork' || resolvedShape === 'crossroads') {
    const spineLen = polylineLength(chosenSpine);
    const juncFrac = rng.range(0.38, 0.62);
    const juncSample = samplePolylineAt(chosenSpine, juncFrac * spineLen);
    const juncPt = juncSample.pos;
    const juncLocal = toLocal(juncPt);
    const bDeg = rng.range(57, 78);
    const bAngleRad = (bDeg * Math.PI) / 180;
    const baseTheta = Math.atan2(juncSample.tangent.y, juncSample.tangent.x);

    // Choose perpendicular side with more room inside domainPolygon
    const sideSign = juncLocal.y <= 0 ? 1 : -1;
    const dirTheta = baseTheta + sideSign * bAngleRad;
    const branchDir = { x: Math.cos(dirTheta), y: Math.sin(dirTheta) };
    const [minBL, maxBL] = ctx.params.branchLength ?? [800, 1500];

    const buildCurvedBranch = (startPt: Vec2, endPt: Vec2, bowSign: number): Vec2[] => {
      const chordLen = dist(startPt, endPt);
      const steps = 6;
      const bDir = norm(sub(endPt, startPt));
      const bNorm = perp(bDir);
      let bowAmp = chordLen * rng.range(0.11, 0.14) * bowSign;
      let bestBranch: Vec2[] | null = null;
      for (let tTry = 0; tTry < 6; tTry++) {
        const ctrl: Vec2[] = [];
        for (let k = 0; k < steps; k++) {
          const t = k / (steps - 1);
          const env = Math.sin(t * Math.PI);
          const wave = Math.sin(t * Math.PI * 1.4) * 0.25;
          const pt = add(lerpVec(startPt, endPt, t), mul(bNorm, bowAmp * (env + wave)));
          ctrl.push(pt);
        }
        const raw = resampleDense(catmullRomSpline(ctrl, 16), 8.0);
        const clipped = clipPolylineToDomain(raw, ctx.domainPolygon, 6);
        if (clipped.length >= 6) {
          const sLen = polylineLength(clipped);
          const cLen = dist(clipped[0], clipped[clipped.length - 1]);
          const sinu = sLen / Math.max(1, cLen);
          const minR = minTurningRadius(clipped, 16);
          if (sinu >= 1.045 && sinu <= 1.24 && minR >= minTurnR + 5) {
            bestBranch = clipped;
            break;
          }
          if (sinu < 1.045) bowAmp *= 1.18;
          else bowAmp *= 0.85;
        }
      }
      if (bestBranch) return bestBranch;
      const fallbackCtrl = [
        startPt,
        add(lerpVec(startPt, endPt, 0.35), mul(bNorm, chordLen * 0.105 * bowSign)),
        add(lerpVec(startPt, endPt, 0.72), mul(bNorm, chordLen * 0.085 * bowSign)),
        endPt,
      ];
      return resampleDense(catmullRomSpline(fallbackCtrl, 16), 8.0);
    };

    if (resolvedShape === 'fork') {
      const desiredLen = rng.range(Math.max(850, minBL), maxBL);
      const bndHit = rayToPolygonBoundary(juncPt, branchDir, desiredLen, ctx.domainPolygon);
      const hitDist = dist(juncPt, bndHit);
      const useDist = Math.min(desiredLen, Math.max(720, hitDist - 12));
      const endPt = add(juncPt, mul(branchDir, useDist));
      const branch = buildCurvedBranch(juncPt, endPt, rng.chance(0.5) ? 1 : -1);
      arterialPolylines.push(branch);
      entries.push(branch[branch.length - 1]);
    } else {
      // Crossroads: single continuous crossing arterial passing cleanly through juncPt
      const halfSpanPos = Math.min(
        rng.range(640, 820),
        dist(juncPt, rayToPolygonBoundary(juncPt, branchDir, 1200, ctx.domainPolygon)) - 14
      );
      const oppDir = mul(branchDir, -1);
      const halfSpanNeg = Math.min(
        rng.range(640, 820),
        dist(juncPt, rayToPolygonBoundary(juncPt, oppDir, 1200, ctx.domainPolygon)) - 14
      );
      const endNeg = add(juncPt, mul(oppDir, Math.max(460, halfSpanNeg)));
      const endPos = add(juncPt, mul(branchDir, Math.max(460, halfSpanPos)));
      const bNorm = perp(norm(sub(endPos, endNeg)));
      let bowAmp = dist(endNeg, endPos) * 0.085 * (rng.chance(0.5) ? 1 : -1);
      let crossPts: Vec2[] | null = null;
      for (let tTry = 0; tTry < 6; tTry++) {
        const ctrl = [
          endNeg,
          add(lerpVec(endNeg, juncPt, 0.5), mul(bNorm, bowAmp)),
          juncPt,
          add(lerpVec(juncPt, endPos, 0.5), mul(bNorm, -bowAmp * 0.85)),
          endPos,
        ];
        const raw = resampleDense(catmullRomSpline(ctrl, 16), 8.0);
        const sLen = polylineLength(raw);
        const cLen = dist(raw[0], raw[raw.length - 1]);
        const sinu = sLen / Math.max(1, cLen);
        const minR = minTurningRadius(raw, 16);
        if (sinu >= 1.045 && sinu <= 1.24 && minR >= minTurnR + 5) {
          crossPts = raw;
          break;
        }
        if (sinu < 1.045) bowAmp *= 1.22;
        else bowAmp *= 0.84;
      }
      const finalCross =
        crossPts ??
        resampleDense(
          catmullRomSpline(
            [
              endNeg,
              add(lerpVec(endNeg, juncPt, 0.5), mul(bNorm, 110)),
              juncPt,
              add(lerpVec(juncPt, endPos, 0.5), mul(bNorm, -110)),
              endPos,
            ],
            16
          ),
          8.0
        );
      arterialPolylines.push(finalCross);
      entries.push(finalCross[0], finalCross[finalCross.length - 1]);
    }
  }

  ctx.arterialPolylines = arterialPolylines;
  ctx.entryPoints = entries;

  ctx.diagnostics.push({
    stage: 'Stage 1 · Spine & Domain',
    durationMs: nowMs() - t0,
    summary: `${resolvedShape} (${domainW}×${domainH} m rotated ${Math.round((angle * 180) / Math.PI)}°), ${arterialPolylines.length} arterial(s), ${entries.length} entries`,
  });
}

// ---------------------------------------------------------------------------
// Stage 2: Urbanity Field, Built-Up Mask & Districts (v0.2.1)
// ---------------------------------------------------------------------------
export function runStageUrbanityAndDistricts(ctx: GenContext): void {
  const t0 = nowMs();
  const rng = SeededRng.fromStage(ctx.params.seed, 'urbanity');
  const urbanNoise = new Noise2D(fnv1a(ctx.params.seed, 'urbanity_noise'));
  const preset = PRESET_CONFIGS[ctx.params.preset];
  const theme = MAP_THEMES[ctx.params.themeId] ?? MAP_THEMES.ordnance_paper;

  const spine = ctx.spinePolyline;
  const spineLen = polylineLength(spine);
  const branch = ctx.arterialPolylines.length > 1 ? ctx.arterialPolylines[1] : null;

  // 1. Place settlement nodes:
  //    - 1 Core node at 35-65% along spine (snapped near branch junction if fork/crossroads)
  //    - 2-3 Satellite nodes along spine >= 600 m apart from core & each other (incl. StationIndustrial)
  //    - 1-2 Lobes 250-450 m perpendicular off spine or branch
  let coreFrac = rng.range(0.42, 0.58);
  if (branch) {
    const bStart = ctx.resolvedTownShape === 'fork' ? branch[0] : branch[Math.floor(branch.length * 0.5)];
    let bestD = Infinity;
    let acc = 0;
    for (let i = 1; i < spine.length; i++) {
      acc += dist(spine[i - 1], spine[i]);
      const d = dist(spine[i], bStart);
      if (d < bestD) {
        bestD = d;
        coreFrac = clamp(acc / Math.max(1, spineLen), 0.38, 0.62);
      }
    }
  }

  const coreSample = samplePolylineAt(spine, coreFrac * spineLen);
  const nodes: SettlementNode[] = [
    {
      id: 0,
      kind: 'core',
      pos: coreSample.pos,
      tangent: coreSample.tangent,
      sigma: ctx.params.coreSigma ?? 380,
      weight: 1.0,
      stretchAlongSpine: ctx.params.stretchAlongSpine ?? 1.6,
      archetype: DistrictArchetype.OldTown,
    },
  ];

  // Pick 2 or 3 spine satellites >= 680 m apart from core and each other
  const desiredSatTotal = clamp(Math.round(ctx.params.satelliteCount), 3, 4);
  const satAlongCount = desiredSatTotal >= 4 ? 3 : 2;
  const satRange = ctx.params.satelliteSigma ?? [200, 260];
  const satFracs: number[] = [];

  if (satAlongCount === 2) {
    satFracs.push(
      clamp(coreFrac - rng.range(0.24, 0.30), 0.14, 0.32),
      clamp(coreFrac + rng.range(0.24, 0.30), 0.68, 0.86)
    );
  } else {
    // Place 2 on the slightly longer side or spread nicely >= 640 m apart
    if (coreFrac >= 0.5) {
      satFracs.push(0.14, 0.32, clamp(coreFrac + 0.27, 0.72, 0.86));
    } else {
      satFracs.push(clamp(coreFrac - 0.27, 0.14, 0.28), 0.68, 0.86);
    }
  }

  // Enforce >= 620 m pairwise Euclidean separation from core & other satellites
  const stationIdxChoice = rng.chance(0.5) ? 0 : satFracs.length - 1;
  const satNodes: SettlementNode[] = [];
  for (let i = 0; i < satFracs.length; i++) {
    const f = satFracs[i];
    const samp = samplePolylineAt(spine, f * spineLen);
    if (nodes.some((n) => dist(n.pos, samp.pos) < 620)) continue;
    const isStation = i === stationIdxChoice;
    const sigma = isStation ? Math.max(245, satRange[1]) : rng.range(satRange[0], satRange[1]);
    const sn: SettlementNode = {
      id: nodes.length,
      kind: 'satellite',
      pos: samp.pos,
      tangent: samp.tangent,
      sigma,
      weight: isStation ? 0.80 : rng.range(0.73, 0.79),
      stretchAlongSpine: ctx.params.stretchAlongSpine ?? 1.6,
      archetype: isStation ? DistrictArchetype.StationIndustrial : DistrictArchetype.Suburb,
    };
    nodes.push(sn);
    satNodes.push(sn);
  }

  // Fallback check: guarantee at least 2 spine satellites incl. StationIndustrial
  if (satNodes.length < 2) {
    for (const f of [0.18, 0.82]) {
      const samp = samplePolylineAt(spine, f * spineLen);
      if (nodes.every((n) => dist(n.pos, samp.pos) >= 600)) {
        const isStation = !nodes.some((n) => n.archetype === DistrictArchetype.StationIndustrial);
        const sn: SettlementNode = {
          id: nodes.length,
          kind: 'satellite',
          pos: samp.pos,
          tangent: samp.tangent,
          sigma: isStation ? 250 : 225,
          weight: isStation ? 0.80 : 0.75,
          stretchAlongSpine: ctx.params.stretchAlongSpine ?? 1.6,
          archetype: isStation ? DistrictArchetype.StationIndustrial : DistrictArchetype.Suburb,
        };
        nodes.push(sn);
        satNodes.push(sn);
      }
    }
  }
  if (!nodes.some((n) => n.archetype === DistrictArchetype.StationIndustrial) && satNodes.length > 0) {
    satNodes[0].archetype = DistrictArchetype.StationIndustrial;
    satNodes[0].sigma = 250;
    satNodes[0].weight = 0.80;
  }

  // Add 1-2 lobes 265-360 m perpendicular off the spine or branch (keeps >=70% within 300 m of spine/branch)
  const lobeCount = desiredSatTotal >= 4 ? 1 : rng.chance(0.55) ? 2 : 1;
  for (let l = 0; l < lobeCount; l++) {
    const side = l % 2 === 0 ? 1 : -1;
    const useBranch = branch !== null && l === 0 && ctx.resolvedTownShape === 'fork';
    let baseSample: { pos: Vec2; tangent: Vec2 };
    if (useBranch && branch) {
      const bLen = polylineLength(branch);
      baseSample = samplePolylineAt(branch, bLen * rng.range(0.55, 0.78));
    } else {
      const lobeSpineF = clamp(coreFrac + (l === 0 ? -0.14 : 0.14) + rng.range(-0.04, 0.04), 0.25, 0.75);
      baseSample = samplePolylineAt(spine, lobeSpineF * spineLen);
    }
    const nrm = mul(perp(baseSample.tangent), side);
    const offDist = rng.range(265, 345);
    let candPos = add(baseSample.pos, mul(nrm, offDist));
    if (!pointInPolygon(candPos, ctx.domainPolygon)) {
      candPos = add(baseSample.pos, mul(nrm, -offDist));
    }
    if (!pointInPolygon(candPos, ctx.domainPolygon)) continue;
    // Keep away from StationIndustrial Retail Park side
    const stationN = nodes.find((n) => n.archetype === DistrictArchetype.StationIndustrial);
    if (stationN && dist(candPos, stationN.pos) < 420) continue;

    nodes.push({
      id: nodes.length,
      kind: 'lobe',
      pos: candPos,
      tangent: baseSample.tangent,
      sigma: rng.range(200, 230),
      weight: rng.range(0.72, 0.78),
      stretchAlongSpine: 1.0,
      archetype:
        l === 0
          ? preset.archetypeWeights[DistrictArchetype.PostWarEstate] >=
            preset.archetypeWeights[DistrictArchetype.Parkside]
            ? DistrictArchetype.PostWarEstate
            : DistrictArchetype.Parkside
          : DistrictArchetype.Suburb,
    });
  }

  ctx.settlementNodes = nodes;

  // 2. Evaluate Urbanity Field U(p) on a 20 m grid covering domain AABB + 120 m zero-border padding
  const domB = polygonBounds(ctx.domainPolygon);
  const cellSize = 20;
  const pad = 120;
  const originX = Math.floor((domB.minX - pad) / cellSize) * cellSize;
  const originY = Math.floor((domB.minY - pad) / cellSize) * cellSize;
  const nx = Math.ceil((domB.maxX + pad - originX) / cellSize) + 1;
  const ny = Math.ceil((domB.maxY + pad - originY) / cellSize) + 1;

  const ribbonSigma = ctx.params.ribbonSigma ?? 58;
  const ribbonWeight = ctx.params.ribbonWeight ?? 0.29;
  const noiseAmp = ctx.params.noiseAmp ?? 0.26;
  const builtUpThresh = ctx.params.builtUpThreshold ?? 0.25;

  const fastArterials = ctx.arterialPolylines.map((p) =>
    p.length > 8 ? rdpSimplify(p, 8.0) : p
  );
  const evalUrbanityExact = (p: Vec2): number => {
    const dSpine = distToNearestPolyline(fastArterials, p);
    const R = ribbonWeight * Math.exp(-Math.pow(dSpine / ribbonSigma, 2));
    let sumN = 0;
    for (const node of nodes) {
      const rel = sub(p, node.pos);
      const a = dot(rel, node.tangent);
      const nVec = perp(node.tangent);
      const b = dot(rel, nVec);
      const sigA = node.sigma * (node.kind === 'lobe' ? 0.85 : node.stretchAlongSpine);
      const isStation = node.archetype === DistrictArchetype.StationIndustrial;
      const sigB =
        node.sigma * (node.kind === 'lobe' ? 0.78 : isStation ? 0.68 : 0.54);
      sumN += node.weight * Math.exp(-((a / sigA) * (a / sigA) + (b / sigB) * (b / sigB)));
    }
    const base = Math.max(R, sumN);
    const mod = 1 + noiseAmp * urbanNoise.fbm(p.x / 300, p.y / 300, 3, 2.0, 0.5);
    return clamp(base * mod, 0, 1.2);
  };

  const values: number[][] = [];
  for (let iy = 0; iy < ny; iy++) {
    const row = new Array<number>(nx).fill(0);
    const py = originY + iy * cellSize;
    // Keep 2-cell outer padding = 0 so marching squares always closes all contours cleanly
    if (iy >= 2 && iy <= ny - 3) {
      for (let ix = 2; ix <= nx - 3; ix++) {
        const px = originX + ix * cellSize;
        if (
          px >= domB.minX - 60 &&
          px <= domB.maxX + 60 &&
          py >= domB.minY - 60 &&
          py <= domB.maxY + 60
        ) {
          row[ix] = evalUrbanityExact({ x: px, y: py });
        }
      }
    }
    values.push(row);
  }

  ctx.urbanityGrid = { originX, originY, cellSize, nx, ny, values };

  const urbanityAt = (p: Vec2): number => {
    const gx = (p.x - originX) / cellSize;
    const gy = (p.y - originY) / cellSize;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    if (ix < 0 || iy < 0 || ix >= nx - 1 || iy >= ny - 1) return 0;
    const tx = gx - ix;
    const ty = gy - iy;
    const v00 = values[iy][ix];
    const v10 = values[iy][ix + 1];
    const v01 = values[iy + 1][ix];
    const v11 = values[iy + 1][ix + 1];
    return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
  };
  ctx.urbanityAt = urbanityAt;

  // 3. Extract built-up mask & ribbon contours via marching squares + 1x Chaikin + 3.0 m RDP simplify + domain clip
  const rawBuilt = marchingSquaresContours(values, originX, originY, cellSize, builtUpThresh);
  const smoothedBuilt: Vec2[][] = [];
  for (const poly of rawBuilt) {
    if (polygonArea(poly) < 35000) continue;
    const sm = rdpSimplifyClosed(chaikinSmoothClosed(poly, 1), 3.0);
    if (sm.length >= 3 && polygonArea(sm) >= 35000) {
      smoothedBuilt.push(sm);
    }
  }
  const clippedBuilt = intersectMultiPolygons(smoothedBuilt, [ctx.domainPolygon]).filter(
    (p) => polygonArea(p) >= 30000
  );
  ctx.builtUpPolygons = clippedBuilt;

  const ribbonThresh = ctx.params.ribbonThreshold ?? 0.10;
  const rawRibbon = marchingSquaresContours(values, originX, originY, cellSize, ribbonThresh);
  const smoothedRibbon = rawRibbon
    .filter((p) => polygonArea(p) >= 3500)
    .map((p) => rdpSimplifyClosed(chaikinSmoothClosed(p, 1), 3.0))
    .filter((p) => p.length >= 3);
  ctx.ribbonContours = intersectMultiPolygons(smoothedRibbon, [ctx.domainPolygon]).filter(
    (p) => polygonArea(p) >= 2000
  );

  ctx.isBuiltUp = (p: Vec2): boolean => {
    if (!pointInPolygon(p, ctx.domainPolygon)) return false;
    for (const bp of ctx.builtUpPolygons) {
      if (pointInPolygon(p, bp)) return true;
    }
    return false;
  };

  ctx.distanceToBuiltUp = (p: Vec2): number => {
    if (ctx.isBuiltUp(p)) return 0;
    let best = Infinity;
    for (const bp of ctx.builtUpPolygons) {
      const d = pointToPolygonBoundaryDist(p, bp);
      if (d < best) best = d;
    }
    return best;
  };

  // 4. Plan StationIndustrial Retail Park Campus beside spine (guaranteed inside Station built-up contour)
  const stationNode = nodes.find((n) => n.archetype === DistrictArchetype.StationIndustrial);
  ctx.retailParkCampus = null;
  ctx.retailParkServiceRoad = null;
  if (stationNode) {
    const u = stationNode.tangent;
    const vRaw = perp(u);
    const branchCheck = branch;
    let chosenSide = 1;
    let bestSideScore = -Infinity;
    for (const side of [1, -1]) {
      const v = mul(vRaw, side);
      const testPt = add(stationNode.pos, mul(v, 95));
      if (!pointInPolygon(testPt, ctx.domainPolygon)) continue;
      let bDist = 999;
      if (branchCheck) bDist = distPointToPolyline(testPt, branchCheck).dist;
      const sc = (ctx.isBuiltUp(testPt) ? 500 : 0) + Math.min(400, bDist);
      if (sc > bestSideScore) {
        bestSideScore = sc;
        chosenSide = side;
      }
    }
    const v = mul(vRaw, chosenSide);

    // Find safe vBase >= 36 m off spine so serviceRoad & backLoopRoad clear spine curves by >= 20 m
    let vBase = 38;
    for (let candV = 38; candV <= 72; candV += 6) {
      let minSpineD = Infinity;
      for (const dvCheck of [candV, candV + 108]) {
        for (const duCheck of [-124, -60, 0, 60, 124]) {
          const pt = add(stationNode.pos, add(mul(u, duCheck), mul(v, dvCheck)));
          const dSp = distPointToPolyline(pt, spine).dist;
          if (dSp < minSpineD) minSpineD = dSp;
          if (branchCheck) {
            const dBr = distPointToPolyline(pt, branchCheck).dist;
            if (dBr < minSpineD) minSpineD = dBr;
          }
        }
      }
      if (minSpineD >= 22) {
        vBase = candV;
        break;
      }
    }

    const toCampus = (du: number, dv: number): Vec2 =>
      add(stationNode.pos, add(mul(u, du), mul(v, dv)));

    const padPoly = ensureCCW([
      toCampus(-126, vBase),
      toCampus(126, vBase),
      toCampus(126, vBase + 108),
      toCampus(-126, vBase + 108),
    ]);

    if (padPoly.every((pt) => pointInPolygon(pt, ctx.domainPolygon))) {
      const spineL = distPointToPolyline(toCampus(-128, 0), spine).closest;
      const spineR = distPointToPolyline(toCampus(128, 0), spine).closest;
      const serviceRoad = resampleDense(
        [
          spineL,
          toCampus(-126, vBase * 0.55),
          toCampus(-126, vBase),
          toCampus(0, vBase),
          toCampus(126, vBase),
          toCampus(126, vBase * 0.55),
          spineR,
        ],
        8.0
      );
      const backLoopRoad = [
        toCampus(-126, vBase),
        toCampus(-126, vBase + 108),
        toCampus(126, vBase + 108),
        toCampus(126, vBase),
      ];

      const carParkPoly = makeOrientedRect(toCampus(-112, vBase + 8.0), u, v, 210, 17.5);
      const boxes = [
        { origin: toCampus(-112, vBase + 35), w: 45, d: 56, isAnchor: true },
        { origin: toCampus(-55, vBase + 35), w: 40, d: 52, isAnchor: false },
        { origin: toCampus(-3, vBase + 35), w: 40, d: 52, isAnchor: false },
        { origin: toCampus(49, vBase + 35), w: 40, d: 52, isAnchor: false },
      ];
      const pods = [
        { origin: toCampus(-63.5, vBase + 26.8), w: 7.0, d: 6.0, defId: 'cafe' },
        { origin: toCampus(40.5, vBase + 26.8), w: 7.0, d: 6.0, defId: 'bakery' },
      ];

      ctx.retailParkServiceRoad = serviceRoad;
      ctx.retailParkCampus = {
        center: toCampus(0, vBase + 54),
        u,
        v,
        vBase,
        serviceRoad,
        backLoopRoad,
        padPoly,
        carParkPoly,
        boxes,
        pods,
        serviceTraceId: 201,
        districtId: -1,
      };
    }
  }

  // 5. Build 5-6 Districts via Voronoi over settlement sites, clipped to domain and intersected with built-up mask
  const usedNames = new Set<string>();
  const pickDistrictName = (arch: DistrictArchetype, id: number): string => {
    const pool = rng.shuffle([...DISTRICT_NAMES_BY_ARCHETYPE[arch]]);
    for (const cand of pool) {
      if (!usedNames.has(cand)) {
        usedNames.add(cand);
        return cand;
      }
    }
    const fallback = `${pool[0]} ${id + 1}`;
    usedNames.add(fallback);
    return fallback;
  };

  interface DistrictSeedSpec {
    seedPoint: Vec2;
    kind: 'core' | 'satellite';
    nodeKind: 'core' | 'satellite' | 'lobe';
    archetype: DistrictArchetype;
  }
  const coreNode = nodes[0];
  const coreCount = clamp(Math.round(ctx.params.coreDistrictCount), 2, 3);
  const districtSeeds: DistrictSeedSpec[] = [
    {
      seedPoint: coreNode.pos,
      kind: 'core',
      nodeKind: 'core',
      archetype: DistrictArchetype.OldTown,
    },
  ];

  // Add 1-2 flanking core districts along/across core spine
  const coreNorm = perp(coreNode.tangent);
  if (coreCount >= 2) {
    const vicOffset = add(
      add(coreNode.pos, mul(coreNode.tangent, rng.range(-190, 190))),
      mul(coreNorm, rng.chance(0.5) ? 140 : -140)
    );
    districtSeeds.push({
      seedPoint: pointInPolygon(vicOffset, ctx.domainPolygon) ? vicOffset : coreNode.pos,
      kind: 'core',
      nodeKind: 'core',
      archetype: DistrictArchetype.VictorianTerraces,
    });
  }
  if (coreCount >= 3 && nodes.length <= 4) {
    const thirdArch =
      preset.archetypeWeights[DistrictArchetype.Parkside] >
      preset.archetypeWeights[DistrictArchetype.PostWarEstate]
        ? DistrictArchetype.Parkside
        : DistrictArchetype.PostWarEstate;
    const cOff = add(
      add(coreNode.pos, mul(coreNode.tangent, rng.range(-170, 170))),
      mul(coreNorm, -150)
    );
    districtSeeds.push({
      seedPoint: pointInPolygon(cOff, ctx.domainPolygon) ? cOff : coreNode.pos,
      kind: 'core',
      nodeKind: 'core',
      archetype: thirdArch,
    });
  }

  for (let i = 1; i < nodes.length && districtSeeds.length < 6; i++) {
    const sn = nodes[i];
    const arch =
      sn.archetype ??
      (sn.kind === 'lobe' ? DistrictArchetype.PostWarEstate : DistrictArchetype.Suburb);
    districtSeeds.push({
      seedPoint: sn.pos,
      kind: 'satellite',
      nodeKind: sn.kind,
      archetype: arch,
    });
  }

  const voronoiCells = computeVoronoiCells(
    districtSeeds.map((s) => s.seedPoint),
    ctx.domainPolygon
  );

  const districts: District[] = [];
  for (let i = 0; i < districtSeeds.length; i++) {
    const ds = districtSeeds[i];
    const spec = ARCHETYPE_SPECS[ds.archetype];
    const clippedPolys =
      ctx.builtUpPolygons.length > 0
        ? intersectMultiPolygons([voronoiCells[i]], ctx.builtUpPolygons)
        : [voronoiCells[i]];
    const sortedPolys = [...clippedPolys].sort((a, b) => polygonArea(b) - polygonArea(a));
    const primaryPoly = sortedPolys[0] ?? voronoiCells[i];

    districts.push({
      id: districts.length,
      name: pickDistrictName(ds.archetype, districts.length),
      kind: ds.kind,
      nodeKind: ds.nodeKind,
      archetype: ds.archetype,
      seedPoint: ds.seedPoint,
      polygon: primaryPoly,
      polygons: sortedPolys.length > 0 ? sortedPolys : [voronoiCells[i]],
      color: theme.districtPalette[ds.archetype],
      dwellingMix: { ...spec.dwellingMix },
      wealthTier: spec.wealthTier,
      venueProfile: [...spec.venueProfile],
    });
  }

  ctx.districts = districts;
  ctx.params.districtCount = districts.length;
  if (ctx.retailParkCampus) {
    const siDist = districts.find((d) => d.archetype === DistrictArchetype.StationIndustrial);
    ctx.retailParkCampus.districtId = siDist ? siDist.id : districts[0].id;
  }

  // Non-OldTown, non-Retail-Park civic/superblock centers
  const superCenters: Vec2[] = [];
  for (const d of districts) {
    if (d.archetype === DistrictArchetype.OldTown) continue;
    if (d.archetype === DistrictArchetype.StationIndustrial) continue;
    let c = d.polygon.length >= 3 ? polygonCentroid(d.polygon) : d.seedPoint;
    if (distToNearestPolyline(ctx.arterialPolylines, c) < 52) {
      let bestP = c;
      let bestArtD = distToNearestPolyline(ctx.arterialPolylines, c);
      for (const rOff of [58, 78, 96]) {
        for (let k = 0; k < 12; k++) {
          const ang = (k / 12) * Math.PI * 2;
          const cand = add(c, { x: Math.cos(ang) * rOff, y: Math.sin(ang) * rOff });
          if (!pointInPolygon(cand, d.polygon) || !ctx.isBuiltUp(cand)) continue;
          const da = distToNearestPolyline(ctx.arterialPolylines, cand);
          if (da > bestArtD) {
            bestArtD = da;
            bestP = cand;
          }
        }
        if (bestArtD >= 56) break;
      }
      c = bestP;
    }
    if (ctx.isBuiltUp(c)) superCenters.push(c);
  }
  ctx.superblockCenters = superCenters;

  ctx.diagnostics.push({
    stage: 'Stage 2 · Urbanity Field & Districts',
    durationMs: nowMs() - t0,
    summary: `${nodes.length} settlement nodes, ${ctx.builtUpPolygons.length} built-up mask poly(s), ${districts.length} districts`,
  });
}

// ---------------------------------------------------------------------------
// Stage 2.5: Arterials (Spine + Branch + Lobe Connectors + Country Lane + RP Service Road)
// ---------------------------------------------------------------------------
export function runStageArterials(ctx: GenContext): void {
  const t0 = nowMs();
  const rng = SeededRng.fromStage(ctx.params.seed, 'arterials');
  const traces: StreamlineTrace[] = [];
  const protectedIds = new Set<number>();
  let traceId = 1;

  // 1. Pre-inject spine & optional branch/crossroad as RoadClass.Arterial
  for (const poly of ctx.arterialPolylines) {
    const tid = traceId++;
    protectedIds.add(tid);
    traces.push({
      traceId: tid,
      level: RoadClass.Arterial,
      family: 'major',
      points: resampleDense(poly, 7.5),
      stopReasonForward: StopReason.OutOfDomain,
      stopReasonBackward: StopReason.OutOfDomain,
    });
  }

  // 2. Connect each lobe to the nearest point on spine/branch with 1 curved Main-class connector
  for (const node of ctx.settlementNodes) {
    if (node.kind !== 'lobe') continue;
    let bestHit = distPointToPolyline(node.pos, ctx.arterialPolylines[0]);
    for (let k = 1; k < ctx.arterialPolylines.length; k++) {
      const cand = distPointToPolyline(node.pos, ctx.arterialPolylines[k]);
      if (cand.dist < bestHit.dist) bestHit = cand;
    }
    const dir = norm(sub(node.pos, bestHit.closest));
    const nrm = perp(dir);
    const bow = dist(bestHit.closest, node.pos) * rng.range(0.08, 0.14) * (rng.chance(0.5) ? 1 : -1);
    const overshoot = add(node.pos, mul(dir, 26));
    const mid = add(lerpVec(bestHit.closest, overshoot, 0.52), mul(nrm, bow));
    const pts = resampleDense(catmullRomSpline([bestHit.closest, mid, overshoot], 12), 7.0);
    const clipped = clipPolylineToDomain(pts, ctx.domainPolygon, 6);
    if (clipped.length >= 2) {
      const tid = traceId++;
      protectedIds.add(tid);
      traces.push({
        traceId: tid,
        level: RoadClass.Main,
        family: 'major',
        points: clipped,
        stopReasonForward: StopReason.Loop,
        stopReasonBackward: StopReason.Loop,
      });
    }
  }

  // 3. Optional 0-1 extra Secondary country lane ending at domain edge (never Arterial, clears Retail Park)
  if (rng.chance(0.75)) {
    const spineMid = samplePolylineAt(ctx.spinePolyline, polylineLength(ctx.spinePolyline) * rng.range(0.26, 0.74));
    const sideChoice = rng.chance(0.5) ? 1 : -1;
    for (const sTry of [sideChoice, -sideChoice]) {
      const laneAngle = Math.atan2(spineMid.tangent.y, spineMid.tangent.x) + sTry * rng.range(0.85, 1.35);
      const laneDir = { x: Math.cos(laneAngle), y: Math.sin(laneAngle) };
      const bnd = rayToPolygonBoundary(spineMid.pos, laneDir, 1500, ctx.domainPolygon);
      const dLane = dist(spineMid.pos, bnd);
      if (dLane <= 320) continue;
      const endPt = add(spineMid.pos, mul(laneDir, dLane - 8));
      const nrm = perp(laneDir);
      const mid1 = add(lerpVec(spineMid.pos, endPt, 0.35), mul(nrm, rng.range(-55, 55)));
      const mid2 = add(lerpVec(spineMid.pos, endPt, 0.7), mul(nrm, rng.range(-55, 55)));
      const lanePts = resampleDense(catmullRomSpline([spineMid.pos, mid1, mid2, endPt], 14), 8.0);
      const hitsRp =
        ctx.retailParkCampus !== null &&
        lanePts.some((pt) => dist(pt, ctx.retailParkCampus!.center) < 165);
      if (hitsRp) continue;
      const tid = traceId++;
      traces.push({
        traceId: tid,
        level: RoadClass.Secondary,
        family: 'minor',
        points: lanePts,
        stopReasonForward: StopReason.OutOfDomain,
        stopReasonBackward: StopReason.Loop,
      });
      break;
    }
  }

  // 4. Pre-inject Retail Park Service Road + Block Frame if planned
  if (ctx.retailParkCampus) {
    const svcId = traceId++;
    ctx.retailParkCampus.serviceTraceId = svcId;
    protectedIds.add(svcId);
    traces.push({
      traceId: svcId,
      level: RoadClass.Main,
      family: 'major',
      points: ctx.retailParkCampus.serviceRoad,
      stopReasonForward: StopReason.Loop,
      stopReasonBackward: StopReason.Loop,
    });

    const backId = traceId++;
    protectedIds.add(backId);
    traces.push({
      traceId: backId,
      level: RoadClass.Secondary,
      family: 'minor',
      points: ctx.retailParkCampus.backLoopRoad,
      stopReasonForward: StopReason.Loop,
      stopReasonBackward: StopReason.Loop,
    });
  }

  ctx.arterialTraces = traces;
  ctx.protectedTraceIds = protectedIds;

  ctx.diagnostics.push({
    stage: 'Stage 2.5 · Arterials',
    durationMs: nowMs() - t0,
    summary: `${ctx.arterialPolylines.length} arterial(s), ${traces.length} pre-injected corridors`,
  });
}

// ---------------------------------------------------------------------------
// Stage 3: Spine-Aligned Tensor Field with Jogs & Strict OldTown Radial Cap
// ---------------------------------------------------------------------------
export function runStageTensorField(ctx: GenContext): void {
  const t0 = nowMs();
  const rng = SeededRng.fromStage(ctx.params.seed, 'tensor_field');
  const bases: TensorBasis[] = [];

  const oldTown = ctx.districts.find((d) => d.archetype === DistrictArchetype.OldTown);
  const jogFreq = 1 / rng.range(160, 240);

  // 1. Spine-aligned grid basis elements every 100 m along spine & branch
  for (const poly of ctx.arterialPolylines) {
    const totalLen = polylineLength(poly);
    const steps = Math.max(2, Math.floor(totalLen / 100));
    for (let i = 0; i <= steps; i++) {
      const samp = samplePolylineAt(poly, (i / steps) * totalLen);
      const angle = Math.atan2(samp.tangent.y, samp.tangent.x);
      bases.push({
        kind: 'grid',
        center: samp.pos,
        angle,
        size: 250,
        strength: 0.72,
        decay: 0.000048,
        warpStrength: 0.14, // ~5-6 deg jogs
        noiseFreq: jogFreq,
      });
    }
  }

  // 2. District-specific modifiers (ZERO radial/curved_radial outside OldTown!)
  for (const d of ctx.districts) {
    const center = d.polygon.length >= 3 ? polygonCentroid(d.polygon) : d.seedPoint;
    const spineNearest = distPointToPolyline(center, ctx.spinePolyline);
    const localSpineAng = Math.atan2(spineNearest.tangent.y, spineNearest.tangent.x);
    const decay = 0.000055;

    switch (d.archetype) {
      case DistrictArchetype.OldTown: {
        // Spine-aligned grid + ONE small radial element (max influence <= 150 m) at market square
        bases.push({
          kind: 'grid',
          center,
          angle: localSpineAng,
          size: 240,
          strength: 0.85,
          decay: 0.000045,
          warpStrength: 0.16,
          noiseFreq: jogFreq,
          districtId: d.id,
        });
        const marketCenter = ctx.settlementNodes[0]?.pos ?? center;
        bases.push({
          kind: 'radial',
          center: marketCenter,
          angle: localSpineAng,
          size: 90,
          strength: 0.42,
          decay: 0.00042, // <= 150 m influence (exp(-0.00042 * 150^2) < 1e-4)
          warpStrength: 0.18,
          districtId: d.id,
        });
        break;
      }
      case DistrictArchetype.VictorianTerraces:
        bases.push({
          kind: 'grid',
          center,
          angle: localSpineAng,
          size: 230,
          strength: 1.05,
          decay,
          warpStrength: 0.12, // ~5-6 deg jogs
          noiseFreq: jogFreq,
          districtId: d.id,
        });
        break;
      case DistrictArchetype.PostWarEstate:
        bases.push({
          kind: 'grid',
          center,
          angle: localSpineAng + rng.range(-0.18, 0.18),
          size: 240,
          strength: 0.96,
          decay,
          warpStrength: 0.48, // ~20 deg organic estate meander (no radial/curved_radial)
          noiseFreq: 0.0058,
          districtId: d.id,
        });
        break;
      case DistrictArchetype.Suburb: {
        const sign = rng.chance(0.5) ? 1 : -1;
        const rot = sign * ((rng.range(15, 25) * Math.PI) / 180);
        bases.push({
          kind: 'grid',
          center,
          angle: localSpineAng + rot,
          size: 250,
          strength: 0.94,
          decay,
          warpStrength: 0.15,
          noiseFreq: jogFreq,
          districtId: d.id,
        });
        break;
      }
      case DistrictArchetype.StationIndustrial:
        bases.push({
          kind: 'grid',
          center,
          angle: localSpineAng,
          size: 260,
          strength: 1.25,
          decay,
          warpStrength: 0.08, // strong spine-aligned industrial grid with slight jog
          noiseFreq: jogFreq,
          districtId: d.id,
        });
        break;
      case DistrictArchetype.Parkside:
        bases.push({
          kind: 'grid',
          center,
          angle: localSpineAng + rng.range(-0.28, 0.28),
          size: 250,
          strength: 0.92,
          decay,
          warpStrength: 0.42, // gentle organic curve (no radial/curved_radial)
          noiseFreq: 0.0055,
          districtId: d.id,
        });
        break;
    }
  }

  // Fallback check if no OldTown exists
  if (!oldTown && ctx.settlementNodes.length > 0) {
    // No radial needed outside OldTown per invariant
  }

  ctx.tensorBases = bases;
  ctx.diagnostics.push({
    stage: 'Stage 3 · Tensor Field',
    durationMs: nowMs() - t0,
    summary: `${bases.length} spine-aligned tensor bases (${bases.filter((b) => b.kind !== 'grid').length} radial <= 150m in OldTown)`,
  });
}

// ---------------------------------------------------------------------------
// Stage 4: Streamlines (Inside Built-Up Mask + 40 m Arterial Corridor)
// ---------------------------------------------------------------------------
export function runStageStreamlines(ctx: GenContext): void {
  const t0 = nowMs();
  const rng = SeededRng.fromStage(ctx.params.seed, 'streamlines');
  const traces: StreamlineTrace[] = [...ctx.arterialTraces];
  let nextTraceId = traces.reduce((m, t) => Math.max(m, t.traceId), 0) + 1;

  const allMajorSamples: Array<{ pos: Vec2; traceId: number }> = [];
  const allMinorSamples: Array<{ pos: Vec2; traceId: number }> = [];
  const globalHashMajor = new SpatialHash<{ pos: Vec2; traceId: number; idx: number }>(24);
  const globalHashMinor = new SpatialHash<{ pos: Vec2; traceId: number; idx: number }>(24);

  for (const art of ctx.arterialTraces) {
    const hash = art.family === 'major' ? globalHashMajor : globalHashMinor;
    const arr = art.family === 'major' ? allMajorSamples : allMinorSamples;
    for (let i = 0; i < art.points.length; i++) {
      const pt = art.points[i];
      hash.insertPoint(pt, { pos: pt, traceId: art.traceId, idx: i });
      arr.push({ pos: pt, traceId: art.traceId });
    }
  }

  // Keep superblockCenters clear of pre-injected arterialTraces (spine, branch, lobe connectors, RP roads)
  const artTracePolys = ctx.arterialTraces.map((tr) => tr.points);
  ctx.superblockCenters = ctx.superblockCenters.map((sc) => {
    if (distToNearestPolyline(artTracePolys, sc) >= 62) return sc;
    const dObj = findDistrictAt(ctx.districts, sc);
    let bestP = sc;
    let bestD = distToNearestPolyline(artTracePolys, sc);
    for (const rOff of [68, 92, 118]) {
      for (let k = 0; k < 12; k++) {
        const ang = (k / 12) * Math.PI * 2;
        const cand = add(sc, { x: Math.cos(ang) * rOff, y: Math.sin(ang) * rOff });
        if (!ctx.isBuiltUp(cand)) continue;
        if (dObj && !pointInPolygon(cand, dObj.polygon)) continue;
        const da = distToNearestPolyline(artTracePolys, cand);
        if (da > bestD) {
          bestD = da;
          bestP = cand;
        }
      }
      if (bestD >= 68) break;
    }
    return bestP;
  });

  const oldTownDist = ctx.districts.find((d) => d.archetype === DistrictArchetype.OldTown);
  const oldTownSquareCenter = oldTownDist
    ? (oldTownDist.polygon.length >= 3 ? polygonCentroid(oldTownDist.polygon) : oldTownDist.seedPoint)
    : null;
  const builtUpThresh = ctx.params.builtUpThreshold ?? 0.25;
  const isTraceable = (p: Vec2): boolean => {
    if (!pointInPolygon(p, ctx.domainPolygon)) return false;
    if (ctx.urbanityAt(p) >= builtUpThresh) return true;
    return distToNearestPolyline(ctx.arterialPolylines, p) <= 40;
  };

  // Protect Retail Park pad interior & immediate surround from incoming traces
  const rpCampus = ctx.retailParkCampus;
  const isInsideRetailParkPad = (p: Vec2): boolean => {
    if (!rpCampus) return false;
    const rel = sub(p, rpCampus.center);
    const du = dot(rel, rpCampus.u);
    const dv = dot(rel, rpCampus.v);
    return Math.abs(du) < 130 && dv > -58 && dv < 58;
  };

  const levels: Array<{ level: RoadClass; dsep: number; maxSeeds: number }> = [
    { level: RoadClass.Main, dsep: 108, maxSeeds: 220 },
    { level: RoadClass.Secondary, dsep: 48, maxSeeds: 600 },
    { level: RoadClass.Lane, dsep: 28, maxSeeds: 340 },
  ];

  const traceFromSeed = (
    seedPos: Vec2,
    initDir: Vec2,
    family: 'major' | 'minor',
    dtest: number,
    traceId: number,
    roadLevel: RoadClass
  ): { pts: Vec2[]; reason: StopReason } => {
    const pts: Vec2[] = [{ x: seedPos.x, y: seedPos.y }];
    let currPos = { x: seedPos.x, y: seedPos.y };
    let currDir = norm(initDir);
    let reason = StopReason.MaxLength;
    const stepSize = 3.0;
    const maxSteps = 210;
    const minLoopIndexGap = Math.ceil((dtest * 1.55) / stepSize) + 6;
    const famHash = family === 'major' ? globalHashMajor : globalHashMinor;

    for (let step = 0; step < maxSteps; step++) {
      const rk = rk4Step(ctx.tensorBases, currPos, stepSize, family, currDir, ctx.noise);
      if (!rk) {
        reason = StopReason.Degenerate;
        break;
      }

      const nextPos = rk.nextPos;
      if (!pointInPolygon(nextPos, ctx.domainPolygon)) {
        reason = StopReason.OutOfDomain;
        break;
      }
      if (!isTraceable(nextPos)) {
        if (step > 1) {
          reason = StopReason.OutOfBuiltUp;
          break;
        }
      }

      if (step > 0) {
        if (isInsideRetailParkPad(nextPos)) {
          reason = StopReason.TooClose;
          break;
        }
        if (
          roadLevel === RoadClass.Lane &&
          oldTownSquareCenter !== null &&
          dist(oldTownSquareCenter, nextPos) < 58
        ) {
          reason = StopReason.TooClose;
          break;
        }
        if (roadLevel >= RoadClass.Secondary) {
          const hitSuper = ctx.superblockCenters.some((sc) => dist(sc, nextPos) < 88);
          if (hitSuper) {
            reason = StopReason.TooClose;
            break;
          }
        }
      }

      let looped = false;
      for (let k = 0; k < pts.length - minLoopIndexGap; k++) {
        if (dist(pts[k], nextPos) < dtest * 0.58) {
          pts.push(pts[k]);
          looped = true;
          break;
        }
      }
      if (looped) {
        reason = StopReason.Loop;
        break;
      }

      const nearby = famHash.queryRadius(nextPos, dtest);
      let hitExisting: Vec2 | null = null;
      let hitDist = Infinity;
      for (const entry of nearby) {
        if (entry.item.traceId === traceId) continue;
        const d = dist(entry.pos, nextPos);
        if (d < hitDist) {
          hitDist = d;
          hitExisting = entry.pos;
        }
      }
      if (hitExisting) {
        if (hitDist <= dtest * 1.18) {
          pts.push({ x: hitExisting.x, y: hitExisting.y });
        }
        reason = StopReason.TooClose;
        break;
      }

      pts.push(nextPos);
      currPos = nextPos;
      currDir = rk.nextDir;
    }

    return { pts, reason };
  };

  for (const cfg of levels) {
    const dsep = cfg.dsep;
    const dtest = dsep * 0.48;
    const minLen = cfg.level === RoadClass.Main ? dsep * 1.15 : dsep * 1.02;
    const levelHashMajor = new SpatialHash<{ pos: Vec2; traceId: number }>(dsep * 0.5);
    const levelHashMinor = new SpatialHash<{ pos: Vec2; traceId: number }>(dsep * 0.5);

    for (const s of allMajorSamples) levelHashMajor.insertPoint(s.pos, s);
    for (const s of allMinorSamples) levelHashMinor.insertPoint(s.pos, s);

    type SeedCandidate = { pos: Vec2; family: 'major' | 'minor'; dirHint?: Vec2 };
    const queue: SeedCandidate[] = [];

    if (cfg.level === RoadClass.Main) {
      // Seed along spine/branch built-up stretches & settlement nodes (no circular ring seeds!)
      for (const node of ctx.settlementNodes) {
        queue.push({ pos: node.pos, family: 'major' });
        queue.push({ pos: node.pos, family: 'minor' });
        const nrm = perp(node.tangent);
        for (const s of [-1, 1]) {
          queue.push({ pos: add(node.pos, mul(nrm, node.sigma * 0.48 * s)), family: 'major' });
          queue.push({ pos: add(node.pos, mul(node.tangent, node.sigma * 0.55 * s)), family: 'minor' });
        }
      }
      for (const art of ctx.arterialTraces) {
        if (art.level !== RoadClass.Arterial) continue;
        for (let i = 4; i < art.points.length - 4; i += 6) {
          const p = art.points[i];
          if (!ctx.isBuiltUp(p)) continue;
          const tan = norm(sub(art.points[i + 1], art.points[i - 1]));
          const n = perp(tan);
          queue.push({ pos: add(p, mul(n, dsep * 0.65)), family: 'minor' });
          queue.push({ pos: add(p, mul(n, -dsep * 0.65)), family: 'minor' });
        }
      }
    } else if (cfg.level === RoadClass.Secondary) {
      for (const tr of traces) {
        for (let i = 2; i < tr.points.length - 2; i += 4) {
          const p = tr.points[i];
          if (!isTraceable(p)) continue;
          const dObj = findDistrictAt(ctx.districts, p);
          const distScale =
            dObj?.archetype === DistrictArchetype.VictorianTerraces
              ? 0.85
              : dObj?.archetype === DistrictArchetype.StationIndustrial
              ? 1.28
              : 1.0;
          const stepD = dsep * distScale;
          const tan = norm(sub(tr.points[i + 1], tr.points[i - 1]));
          const n = perp(tan);
          queue.push({ pos: add(p, mul(n, stepD)), family: 'major' });
          queue.push({ pos: add(p, mul(n, -stepD)), family: 'major' });
          queue.push({ pos: add(p, mul(n, stepD)), family: 'minor' });
          queue.push({ pos: add(p, mul(n, -stepD)), family: 'minor' });
        }
      }
      for (const d of ctx.districts) {
        const c = d.polygon.length >= 3 ? polygonCentroid(d.polygon) : d.seedPoint;
        queue.push({ pos: c, family: 'major' });
        queue.push({ pos: c, family: 'minor' });
      }
    } else {
      for (const tr of traces) {
        for (let i = 2; i < tr.points.length - 2; i += 4) {
          const p = tr.points[i];
          if (!ctx.isBuiltUp(p)) continue;
          const dObj = findDistrictAt(ctx.districts, p);
          if (
            dObj?.archetype !== DistrictArchetype.OldTown &&
            dObj?.archetype !== DistrictArchetype.PostWarEstate &&
            dObj?.archetype !== DistrictArchetype.VictorianTerraces
          ) {
            continue;
          }
          const tan = norm(sub(tr.points[i + 1], tr.points[i - 1]));
          const n = perp(tan);
          queue.push({ pos: add(p, mul(n, dsep)), family: 'major' });
          queue.push({ pos: add(p, mul(n, -dsep)), family: 'minor' });
        }
      }
    }

    let processedSeeds = 0;
    while (queue.length > 0 && processedSeeds < cfg.maxSeeds) {
      processedSeeds++;
      const cand = queue.shift()!;
      if (!isTraceable(cand.pos)) continue;

      if (cfg.level === RoadClass.Main && isInsideRetailParkPad(cand.pos)) continue;
      if (cfg.level >= RoadClass.Secondary) {
        if (isInsideRetailParkPad(cand.pos)) continue;
        const nearSuper = ctx.superblockCenters.some((sc) => dist(sc, cand.pos) < 92);
        if (nearSuper) continue;
      }

      if (cfg.level === RoadClass.Lane) {
        if (oldTownSquareCenter !== null && dist(oldTownSquareCenter, cand.pos) < 62) {
          continue;
        }
        const dObj = findDistrictAt(ctx.districts, cand.pos);
        if (
          dObj?.archetype !== DistrictArchetype.OldTown &&
          dObj?.archetype !== DistrictArchetype.PostWarEstate &&
          dObj?.archetype !== DistrictArchetype.VictorianTerraces
        ) {
          continue;
        }
      }

      const lvlHash = cand.family === 'major' ? levelHashMajor : levelHashMinor;
      if (lvlHash.hasWithin(cand.pos, dtest * 0.9)) continue;

      const initDir =
        cand.dirHint ??
        sampleTensorDirection(ctx.tensorBases, cand.pos, cand.family, null, ctx.noise);
      if (!initDir) continue;

      const traceId = nextTraceId++;
      const fwd = traceFromSeed(cand.pos, initDir, cand.family, dtest, traceId, cfg.level);
      const bwd = traceFromSeed(cand.pos, mul(initDir, -1), cand.family, dtest, traceId, cfg.level);

      const combined = [...bwd.pts].reverse();
      for (let i = 1; i < fwd.pts.length; i++) {
        combined.push(fwd.pts[i]);
      }

      const totalLen = polylineLength(combined);
      if (totalLen < minLen || combined.length < 3) continue;

      const trace: StreamlineTrace = {
        traceId,
        level: cfg.level,
        family: cand.family,
        points: combined,
        stopReasonForward: fwd.reason,
        stopReasonBackward: bwd.reason,
      };
      traces.push(trace);

      const gHash = cand.family === 'major' ? globalHashMajor : globalHashMinor;
      const allArr = cand.family === 'major' ? allMajorSamples : allMinorSamples;

      for (let i = 0; i < combined.length; i++) {
        const pt = combined[i];
        gHash.insertPoint(pt, { pos: pt, traceId, idx: i });
        lvlHash.insertPoint(pt, { pos: pt, traceId });
        allArr.push({ pos: pt, traceId });

        if (i >= 2 && i % 4 === 0 && queue.length < cfg.maxSeeds * 2) {
          const tangent =
            i === combined.length - 1
              ? norm(sub(combined[i], combined[i - 1]))
              : norm(sub(combined[i + 1], combined[i - 1]));
          const n = perp(tangent);
          const jitter = rng.range(0.94, 1.06);
          queue.push({ pos: add(pt, mul(n, dsep * jitter)), family: cand.family });
          queue.push({ pos: add(pt, mul(n, -dsep * jitter)), family: cand.family });
        }
      }
    }
  }

  ctx.streamlines = traces;
  ctx.diagnostics.push({
    stage: 'Stage 4 · Streamlines',
    durationMs: nowMs() - t0,
    summary: `${traces.length} traces (Arterial: ${traces.filter((t) => t.level === RoadClass.Arterial).length}, Main: ${traces.filter((t) => t.level === RoadClass.Main).length}, Sec: ${traces.filter((t) => t.level === RoadClass.Secondary).length}, Lane: ${traces.filter((t) => t.level === RoadClass.Lane).length})`,
  });
}

// ---------------------------------------------------------------------------
// Stage 5: Planar Graph (Intersections, Snap, Never-Prune Arterials, Connect)
// ---------------------------------------------------------------------------
interface RawSegment {
  a: Vec2;
  b: Vec2;
  traceId: number;
  roadClass: RoadClass;
}

function buildPlanarGraphFromSegments(
  segments: RawSegment[],
  districts: readonly District[],
  protectedTraceIds: ReadonlySet<number>,
  snapRadius = 4.2
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const segHash = new SpatialHash<number>(34);
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    segHash.insertBounds(
      Math.min(s.a.x, s.b.x) - 2,
      Math.min(s.a.y, s.b.y) - 2,
      Math.max(s.a.x, s.b.x) + 2,
      Math.max(s.a.y, s.b.y) + 2,
      s.a,
      i
    );
  }

  const splitParams: number[][] = segments.map(() => [0, 1]);
  for (let i = 0; i < segments.length; i++) {
    const sA = segments[i];
    const cands = segHash.queryBounds(
      Math.min(sA.a.x, sA.b.x) - 1,
      Math.min(sA.a.y, sA.b.y) - 1,
      Math.max(sA.a.x, sA.b.x) + 1,
      Math.max(sA.a.y, sA.b.y) + 1
    );
    for (const j of cands) {
      if (j <= i) continue;
      const sB = segments[j];
      const hit = segmentIntersection(sA.a, sA.b, sB.a, sB.b, 1e-4);
      if (hit) {
        if (hit.tA > 1e-4 && hit.tA < 1 - 1e-4) splitParams[i].push(hit.tA);
        if (hit.tB > 1e-4 && hit.tB < 1 - 1e-4) splitParams[j].push(hit.tB);
      }
    }
  }

  const nodeHash = new SpatialHash<{ id: number; pos: Vec2 }>(snapRadius * 2);
  const rawNodes: Vec2[] = [];

  const getOrCreateNode = (p: Vec2): number => {
    const nearby = nodeHash.queryRadius(p, snapRadius);
    if (nearby.length > 0) {
      let bestId = nearby[0].item.id;
      let bestD = dist(p, nearby[0].pos);
      for (let i = 1; i < nearby.length; i++) {
        const d = dist(p, nearby[i].pos);
        if (d < bestD) {
          bestD = d;
          bestId = nearby[i].item.id;
        }
      }
      return bestId;
    }
    const id = rawNodes.length;
    const pt = { x: p.x, y: p.y };
    rawNodes.push(pt);
    nodeHash.insertPoint(pt, { id, pos: pt });
    return id;
  };

  interface AtomicSeg {
    u: number;
    v: number;
    traceId: number;
    roadClass: RoadClass;
  }
  const atomicSegs: AtomicSeg[] = [];
  const seenPairs = new Set<string>();

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const ts = Array.from(new Set(splitParams[i])).sort((a, b) => a - b);
    for (let k = 1; k < ts.length; k++) {
      const p0 = lerpVec(s.a, s.b, ts[k - 1]);
      const p1 = lerpVec(s.a, s.b, ts[k]);
      const minAtomic = s.roadClass === RoadClass.Arterial ? 0.08 : 0.5;
      if (dist(p0, p1) < minAtomic) continue;
      const u = getOrCreateNode(p0);
      const v = getOrCreateNode(p1);
      if (u === v) continue;
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      atomicSegs.push({ u, v, traceId: s.traceId, roadClass: s.roadClass });
    }
  }

  const adj = new Map<number, AtomicSeg[]>();
  for (const seg of atomicSegs) {
    if (!adj.has(seg.u)) adj.set(seg.u, []);
    if (!adj.has(seg.v)) adj.set(seg.v, []);
    adj.get(seg.u)!.push(seg);
    adj.get(seg.v)!.push(seg);
  }

  const isJunction = (nodeId: number): boolean => {
    const list = adj.get(nodeId);
    if (!list) return true;
    if (list.length !== 2) return true;
    return list[0].traceId !== list[1].traceId || list[0].roadClass !== list[1].roadClass;
  };

  const visitedSeg = new Set<AtomicSeg>();
  let draftEdges: Array<{
    nodeA: number;
    nodeB: number;
    traceId: number;
    roadClass: RoadClass;
    polyline: Vec2[];
  }> = [];

  for (const seg of atomicSegs) {
    if (visitedSeg.has(seg)) continue;

    let startNode = seg.u;
    let currSeg = seg;
    let safety = 0;
    while (!isJunction(startNode) && safety < 500) {
      safety++;
      const list = adj.get(startNode)!;
      const otherSeg = list[0] === currSeg ? list[1] : list[0];
      if (!otherSeg || otherSeg === seg) break;
      currSeg = otherSeg;
      startNode = currSeg.u === startNode ? currSeg.v : currSeg.u;
    }

    const poly: Vec2[] = [rawNodes[startNode]];
    let currNode = startNode;
    let walkSeg: AtomicSeg | undefined = currSeg;
    const endTraceId = seg.traceId;
    const endClass = seg.roadClass;
    safety = 0;

    while (walkSeg && !visitedSeg.has(walkSeg) && safety < 500) {
      safety++;
      visitedSeg.add(walkSeg);
      const nextNode = walkSeg.u === currNode ? walkSeg.v : walkSeg.u;
      poly.push(rawNodes[nextNode]);
      currNode = nextNode;

      if (isJunction(currNode) || currNode === startNode) break;
      const list = adj.get(currNode)!;
      walkSeg = list[0] === walkSeg ? list[1] : list[0];
    }

    if (startNode === currNode) continue;
    const simplified = rdpSimplify(poly, 0.8);
    if (simplified.length < 2) continue;

    draftEdges.push({
      nodeA: startNode,
      nodeB: currNode,
      traceId: endTraceId,
      roadClass: endClass,
      polyline: simplified,
    });
  }

  // Deduplicate parallel edges by splitting longer polyline (preserve arterial links!)
  const pairCounts = new Map<string, number>();
  const finalDraftEdges: typeof draftEdges = [];
  for (const e of draftEdges) {
    const key = e.nodeA < e.nodeB ? `${e.nodeA}:${e.nodeB}` : `${e.nodeB}:${e.nodeA}`;
    const count = pairCounts.get(key) ?? 0;
    pairCounts.set(key, count + 1);
    if (count > 0 && e.polyline.length >= 3) {
      const midIdx = Math.floor(e.polyline.length / 2);
      const midPt = e.polyline[midIdx];
      const midNodeId = rawNodes.length;
      rawNodes.push(midPt);
      finalDraftEdges.push({ ...e, nodeB: midNodeId, polyline: e.polyline.slice(0, midIdx + 1) });
      finalDraftEdges.push({ ...e, nodeA: midNodeId, polyline: e.polyline.slice(midIdx) });
    } else if (count > 0 && e.roadClass === RoadClass.Arterial) {
      const p0 = e.polyline[0];
      const p1 = e.polyline[e.polyline.length - 1];
      const n = perp(norm(sub(p1, p0)));
      const midPt = add(lerpVec(p0, p1, 0.5), mul(n, 0.35));
      const midNodeId = rawNodes.length;
      rawNodes.push(midPt);
      finalDraftEdges.push({ ...e, nodeB: midNodeId, polyline: [p0, midPt] });
      finalDraftEdges.push({ ...e, nodeA: midNodeId, polyline: [midPt, p1] });
    } else if (count === 0) {
      finalDraftEdges.push(e);
    }
  }
  draftEdges = finalDraftEdges;

  const activeNodes = new Map<number, GraphNode>();
  const activeEdges = new Map<number, GraphEdge>();

  const ensureNode = (id: number): GraphNode => {
    let n = activeNodes.get(id);
    if (!n) {
      n = { id, pos: rawNodes[id], edgeIds: [] };
      activeNodes.set(id, n);
    }
    return n;
  };

  draftEdges.forEach((de, idx) => {
    const len = polylineLength(de.polyline);
    if (len < 1.0) return;
    const edge: GraphEdge = {
      id: idx,
      nodeA: de.nodeA,
      nodeB: de.nodeB,
      streetId: -1,
      traceId: de.traceId,
      roadClass: de.roadClass,
      speedKph: ROAD_SPEED_KPH[de.roadClass],
      isCulDeSac: false,
      polyline: de.polyline,
      length: len,
    };
    activeEdges.set(edge.id, edge);
    ensureNode(edge.nodeA).edgeIds.push(edge.id);
    ensureNode(edge.nodeB).edgeIds.push(edge.id);
  });

  // Prune short non-arterial dead-ends (NEVER prune RoadClass.Arterial or protected connectors/service roads!)
  for (let iter = 0; iter < 15; iter++) {
    let prunedAny = false;
    for (const [eid, e] of Array.from(activeEdges.entries())) {
      if (e.roadClass === RoadClass.Arterial || protectedTraceIds.has(e.traceId)) continue;
      const nA = activeNodes.get(e.nodeA);
      const nB = activeNodes.get(e.nodeB);
      if (!nA || !nB) continue;
      const isDeadEnd = nA.edgeIds.length === 1 || nB.edgeIds.length === 1;
      if (!isDeadEnd) continue;

      const mid = e.polyline[Math.floor(e.polyline.length / 2)];
      const distObj = findDistrictAt(districts, mid);
      const inEstate = distObj?.archetype === DistrictArchetype.PostWarEstate;

      if (inEstate && e.length >= 25 && e.length <= 90) {
        e.isCulDeSac = true;
        continue;
      }

      if (e.length < 30 || (!inEstate && e.roadClass === RoadClass.Lane && e.length < 48)) {
        activeEdges.delete(eid);
        nA.edgeIds = nA.edgeIds.filter((id) => id !== eid);
        nB.edgeIds = nB.edgeIds.filter((id) => id !== eid);
        if (nA.edgeIds.length === 0) activeNodes.delete(nA.id);
        if (nB.edgeIds.length === 0) activeNodes.delete(nB.id);
        prunedAny = true;
      } else {
        e.isCulDeSac = true;
      }
    }
    if (!prunedAny) break;
  }

  // Largest connected component
  const visitedNodes = new Set<number>();
  let largestComp: Set<number> = new Set();

  for (const nid of activeNodes.keys()) {
    if (visitedNodes.has(nid)) continue;
    const comp = new Set<number>();
    const stack = [nid];
    visitedNodes.add(nid);
    while (stack.length > 0) {
      const curr = stack.pop()!;
      comp.add(curr);
      const node = activeNodes.get(curr);
      if (!node) continue;
      for (const eid of node.edgeIds) {
        const e = activeEdges.get(eid);
        if (!e) continue;
        const nxt = e.nodeA === curr ? e.nodeB : e.nodeA;
        if (!visitedNodes.has(nxt)) {
          visitedNodes.add(nxt);
          stack.push(nxt);
        }
      }
    }
    if (comp.size > largestComp.size) {
      largestComp = comp;
    }
  }

  const nodeIdMap = new Map<number, number>();
  const finalNodes: GraphNode[] = [];
  for (const oldId of largestComp) {
    const oldNode = activeNodes.get(oldId)!;
    const newId = finalNodes.length;
    nodeIdMap.set(oldId, newId);
    finalNodes.push({ id: newId, pos: oldNode.pos, edgeIds: [] });
  }

  const finalEdges: GraphEdge[] = [];
  for (const e of activeEdges.values()) {
    if (!largestComp.has(e.nodeA) || !largestComp.has(e.nodeB)) continue;
    const newA = nodeIdMap.get(e.nodeA)!;
    const newB = nodeIdMap.get(e.nodeB)!;
    const newEid = finalEdges.length;
    const newEdge: GraphEdge = {
      ...e,
      id: newEid,
      nodeA: newA,
      nodeB: newB,
    };
    finalEdges.push(newEdge);
    finalNodes[newA].edgeIds.push(newEid);
    finalNodes[newB].edgeIds.push(newEid);
  }

  return { nodes: finalNodes, edges: finalEdges };
}

export function runStageGraph(ctx: GenContext): void {
  const t0 = nowMs();
  const segments: RawSegment[] = [];

  for (const tr of ctx.streamlines) {
    const eps = tr.level === RoadClass.Arterial ? 1.2 : 2.6;
    const pts = tr.points.length > 4 ? rdpSimplify(tr.points, eps) : tr.points;
    for (let i = 1; i < pts.length; i++) {
      segments.push({
        a: pts[i - 1],
        b: pts[i],
        traceId: tr.traceId,
        roadClass: tr.level,
      });
    }
  }

  let graph = buildPlanarGraphFromSegments(segments, ctx.districts, ctx.protectedTraceIds, 4.4);

  // Split any non-Retail-Park, non-park built-up faces > 11,500 m2 so blocks > 12,000 m2 stay <= 8% of built-up area
  const builtUpArea = Math.max(
    1,
    ctx.builtUpPolygons.reduce((acc, p) => acc + polygonArea(p), 0)
  );
  const parkSuperBudget = builtUpArea * 0.022;
  let nextTrace = 9500;

  for (let splitPass = 0; splitPass < 6; splitPass++) {
    const faces = extractPlanarFaces(graph.nodes, graph.edges);
    let addedSplitter = false;
    let parkSuperReserved = 0;

    for (const f of faces) {
      const c = polygonCentroid(f.polygon);
      if (!ctx.isBuiltUp(c) && !f.polygon.some((pt) => ctx.isBuiltUp(pt))) continue;
      const isRetailParkPad =
        ctx.retailParkCampus !== null && pointInPolygon(c, ctx.retailParkCampus.padPoly);
      if (isRetailParkPad) continue;

      const nearSuper = ctx.superblockCenters.some((sc) => dist(sc, c) < 110);
      if (
        nearSuper &&
        f.signedArea > 12000 &&
        f.signedArea <= 36000 &&
        parkSuperReserved + f.signedArea <= parkSuperBudget
      ) {
        parkSuperReserved += f.signedArea;
        continue;
      }

      if (f.signedArea > 11200) {
        const b = polygonBounds(f.polygon);
        // Find a guaranteed interior anchor point even if polygon centroid lies in a concave notch
        let anchor = c;
        if (!pointInPolygon(anchor, f.polygon)) {
          const nv = f.polygon.length;
          let found = false;
          for (let i = 0; i < nv && !found; i++) {
            const pA = f.polygon[i];
            const pB = f.polygon[(i + Math.floor(nv / 2)) % nv];
            const m = lerpVec(pA, pB, 0.5);
            if (pointInPolygon(m, f.polygon)) {
              anchor = m;
              found = true;
            }
          }
          if (!found) {
            for (let gx = 0.2; gx <= 0.8 && !found; gx += 0.2) {
              for (let gy = 0.2; gy <= 0.8 && !found; gy += 0.2) {
                const gp = { x: b.minX + b.width * gx, y: b.minY + b.height * gy };
                if (pointInPolygon(gp, f.polygon)) {
                  anchor = gp;
                  found = true;
                }
              }
            }
          }
        }

        const span = Math.max(b.width, b.height) * 1.4;
        let bestCut: { a: Vec2; b: Vec2; len: number } | null = null;
        for (const rad of [0, Math.PI * 0.25, Math.PI * 0.5, Math.PI * 0.75]) {
          const dir = { x: Math.cos(rad), y: Math.sin(rad) };
          const p1 = add(anchor, mul(dir, -span));
          const p2 = add(anchor, mul(dir, span));
          const hits: Vec2[] = [];
          for (let i = 0; i < f.polygon.length; i++) {
            const hit = segmentIntersection(
              p1,
              p2,
              f.polygon[i],
              f.polygon[(i + 1) % f.polygon.length]
            );
            if (hit) hits.push(hit.point);
          }
          if (hits.length < 2) continue;
          hits.sort((u, v) => dist(p1, u) - dist(p1, v));
          for (let k = 0; k + 1 < hits.length; k++) {
            const hA = hits[k];
            const hB = hits[k + 1];
            const segLen = dist(hA, hB);
            if (segLen < 16) continue;
            const mid = lerpVec(hA, hB, 0.5);
            if (!pointInPolygon(mid, f.polygon)) continue;
            if (!bestCut || segLen > bestCut.len) {
              bestCut = { a: hA, b: hB, len: segLen };
            }
          }
        }
        if (bestCut) {
          const cutDir = norm(sub(bestCut.b, bestCut.a));
          segments.push({
            a: add(bestCut.a, mul(cutDir, -0.25)),
            b: add(bestCut.b, mul(cutDir, 0.25)),
            traceId: nextTrace++,
            roadClass: RoadClass.Secondary,
          });
          addedSplitter = true;
        }
      }
    }

    if (!addedSplitter) break;
    graph = buildPlanarGraphFromSegments(segments, ctx.districts, ctx.protectedTraceIds, 4.4);
  }

  // Ensure all RoadClass.Arterial edges form a single connected component
  const gEdgeById = new Map<number, GraphEdge>();
  for (const ge of graph.edges) gEdgeById.set(ge.id, ge);
  const gNodeById = new Map<number, GraphNode>();
  for (const gn of graph.nodes) gNodeById.set(gn.id, gn);

  for (let pass = 0; pass < 8; pass++) {
    const artNodes = new Set<number>();
    for (const ge of graph.edges) {
      if (ge.roadClass === RoadClass.Arterial) {
        artNodes.add(ge.nodeA);
        artNodes.add(ge.nodeB);
      }
    }
    if (artNodes.size === 0) break;
    const first = artNodes.values().next().value!;
    const mainComp = new Set<number>([first]);
    const st = [first];
    while (st.length > 0) {
      const curr = st.pop()!;
      const n = gNodeById.get(curr);
      if (!n) continue;
      for (const eid of n.edgeIds) {
        const ge = gEdgeById.get(eid);
        if (!ge || ge.roadClass !== RoadClass.Arterial) continue;
        const nxt = ge.nodeA === curr ? ge.nodeB : ge.nodeA;
        if (!mainComp.has(nxt)) {
          mainComp.add(nxt);
          st.push(nxt);
        }
      }
    }
    if (mainComp.size >= artNodes.size) break;

    const prevEdge = new Map<number, number>();
    const prevNode = new Map<number, number>();
    const q: number[] = Array.from(mainComp);
    const seen = new Set<number>(mainComp);
    let target: number | null = null;
    for (let qi = 0; qi < q.length && target === null; qi++) {
      const curr = q[qi];
      const n = gNodeById.get(curr);
      if (!n) continue;
      for (const eid of n.edgeIds) {
        const ge = gEdgeById.get(eid);
        if (!ge) continue;
        const nxt = ge.nodeA === curr ? ge.nodeB : ge.nodeA;
        if (seen.has(nxt)) continue;
        seen.add(nxt);
        prevEdge.set(nxt, eid);
        prevNode.set(nxt, curr);
        if (artNodes.has(nxt)) {
          target = nxt;
          break;
        }
        q.push(nxt);
      }
    }
    if (target === null) break;
    let cur: number | undefined = target;
    while (cur !== undefined && !mainComp.has(cur)) {
      const eid = prevEdge.get(cur);
      const ge = eid !== undefined ? gEdgeById.get(eid) : undefined;
      if (ge) {
        ge.roadClass = RoadClass.Arterial;
        ge.speedKph = ROAD_SPEED_KPH[RoadClass.Arterial];
      }
      cur = prevNode.get(cur);
    }
  }

  // Keep only the largest connected component
  if (graph.nodes.length > 0) {
    const gN = new Map<number, GraphNode>();
    for (const n of graph.nodes) gN.set(n.id, n);
    const gE = new Map<number, GraphEdge>();
    for (const e of graph.edges) gE.set(e.id, e);
    const seenAll = new Set<number>();
    let bestComp = new Set<number>();
    for (const startN of graph.nodes) {
      if (seenAll.has(startN.id)) continue;
      const comp = new Set<number>([startN.id]);
      const st = [startN.id];
      seenAll.add(startN.id);
      while (st.length > 0) {
        const c = st.pop()!;
        const cn = gN.get(c);
        if (!cn) continue;
        for (const eid of cn.edgeIds) {
          const ge = gE.get(eid);
          if (!ge) continue;
          const nxt = ge.nodeA === c ? ge.nodeB : ge.nodeA;
          if (!seenAll.has(nxt)) {
            seenAll.add(nxt);
            comp.add(nxt);
            st.push(nxt);
          }
        }
      }
      if (comp.size > bestComp.size) bestComp = comp;
    }
    if (bestComp.size < graph.nodes.length) {
      graph.edges = graph.edges.filter((e) => bestComp.has(e.nodeA) && bestComp.has(e.nodeB));
      graph.nodes = graph.nodes.filter((n) => bestComp.has(n.id));
    }
  }

  ctx.nodes = graph.nodes;
  ctx.edges = graph.edges;

  ctx.diagnostics.push({
    stage: 'Stage 5 · Planar Graph',
    durationMs: nowMs() - t0,
    summary: `${ctx.nodes.length} nodes, ${ctx.edges.length} edges (arterials preserved)`,
  });
}

// ---------------------------------------------------------------------------
// Stage 6: Blocks (Discard < 600 m2 slivers, cap > 12,000 m2 blocks <= 8% built-up)
// ---------------------------------------------------------------------------
export function runStageBlocks(ctx: GenContext): void {
  const t0 = nowMs();
  const rng = SeededRng.fromStage(ctx.params.seed, 'blocks');
  const faces = extractPlanarFaces(ctx.nodes, ctx.edges);
  const blocks: Block[] = [];
  let slivers = 0;

  const builtUpArea = Math.max(
    1,
    ctx.builtUpPolygons.reduce((acc, p) => acc + polygonArea(p), 0)
  );
  const largeBlockMaxBudget = builtUpArea * 0.072; // strictly <= 8% gate
  let largeBlockAreaUsed = 0;

  // Pre-count the Retail Park block if > 12,000 m2 so it is never crowded out
  for (const face of faces) {
    const area = polygonArea(face.polygon);
    if (area > 12000 && ctx.retailParkCampus) {
      const c = polygonCentroid(face.polygon);
      if (pointInPolygon(c, ctx.retailParkCampus.padPoly)) {
        largeBlockAreaUsed += area;
      }
    }
  }

  for (let i = 0; i < faces.length; i++) {
    const face = faces[i];
    const area = polygonArea(face.polygon);
    if (area < 600) {
      slivers++;
      continue;
    }

    const c = polygonCentroid(face.polygon);
    const isRetailPark =
      ctx.retailParkCampus !== null && pointInPolygon(c, ctx.retailParkCampus.padPoly);
    if (!ctx.isBuiltUp(c) && !isRetailPark) {
      continue;
    }

    const distObj = findNearestDistrict(ctx.districts, c);
    let kind = BlockKind.Built;

    if (!isRetailPark && area > 12000) {
      if (largeBlockAreaUsed + area <= largeBlockMaxBudget) {
        kind = BlockKind.Green; // Park / playing field / allotment
        largeBlockAreaUsed += area;
      } else {
        // Keep built or mark as small green park if needed; do not allow oversized non-park gap
        kind = BlockKind.Built;
      }
    } else if (
      !isRetailPark &&
      (distObj.archetype === DistrictArchetype.Parkside ||
        distObj.archetype === DistrictArchetype.PostWarEstate ||
        distObj.archetype === DistrictArchetype.Suburb) &&
      area > 2200 &&
      area < 9500 &&
      rng.chance(0.085)
    ) {
      kind = BlockKind.Green;
    }

    blocks.push({
      id: blocks.length,
      polygon: face.polygon,
      districtId: isRetailPark && ctx.retailParkCampus ? ctx.retailParkCampus.districtId : distObj.id,
      edgeIds: face.edgeIds,
      kind,
      area,
    });
  }

  ctx.blocks = blocks;
  ctx.discardedSliverBlocks = slivers;
  ctx.diagnostics.push({
    stage: 'Stage 6 · Blocks',
    durationMs: nowMs() - t0,
    summary: `${blocks.length} blocks (${blocks.filter((b) => b.kind === BlockKind.Built).length} built, ${blocks.filter((b) => b.kind === BlockKind.Green).length} parks; ${slivers} slivers discarded)`,
  });
}

// ---------------------------------------------------------------------------
// Stage 6b: Venue Site Reservation (BEFORE Lots — PRD Section 8.1 & 8.2)
// ---------------------------------------------------------------------------
function makeOrientedRect(
  origin: Vec2,
  tangent: Vec2,
  inward: Vec2,
  w: number,
  d: number
): Vec2[] {
  const c0 = origin;
  const c1 = add(c0, mul(tangent, w));
  const c2 = add(c1, mul(inward, d));
  const c3 = add(c0, mul(inward, d));
  return ensureCCW([c0, c1, c2, c3]);
}

function tryBuildVenueSiteOnBlockEdge(
  pA: Vec2,
  pB: Vec2,
  safeInner: Vec2[],
  blockPoly: Vec2[],
  existingSites: readonly VenueSite[],
  fpW: number,
  fpD: number,
  extraW: number,
  extraD: number,
  blockEdges: readonly GraphEdge[],
  edgeHash: SpatialHash<GraphEdge>,
  allEdges: readonly GraphEdge[],
  slideCursorStep = 5,
  preferClusterNear?: Vec2[],
  preferBehindFirst = false
): {
  sitePoly: Vec2[];
  fpPoly: Vec2[];
  extraPoly: Vec2[] | null;
  entrancePos: Vec2;
  entranceEdgeId: number;
  score: number;
} | null {
  const edgeLen = dist(pA, pB);
  const tangent = norm(sub(pB, pA));
  const inward = { x: -tangent.y, y: tangent.x };

  const layouts: Array<{
    totalW: number;
    totalD: number;
    fpOffsetT: number;
    fpOffsetN: number;
    fpUseW: number;
    fpUseD: number;
    exOffsetT: number;
    exOffsetN: number;
    exUseW: number;
    exUseD: number;
  }> = [];

  if (extraW > 0 && extraD > 0) {
    const behindLay = {
      totalW: Math.max(fpW, extraW) + 1.5,
      totalD: fpD + extraD + 3,
      fpOffsetT: (Math.max(fpW, extraW) + 1.5 - fpW) * 0.5,
      fpOffsetN: 0.75,
      fpUseW: fpW,
      fpUseD: fpD,
      exOffsetT: (Math.max(fpW, extraW) + 1.5 - extraW) * 0.5,
      exOffsetN: 0.75 + fpD + 1.5,
      exUseW: extraW,
      exUseD: extraD,
    };
    const besideLay = {
      totalW: fpW + extraW + 3,
      totalD: Math.max(fpD, extraD) + 1.5,
      fpOffsetT: 0.75,
      fpOffsetN: 0.75,
      fpUseW: fpW,
      fpUseD: fpD,
      exOffsetT: 0.75 + fpW + 1.5,
      exOffsetN: 0.75,
      exUseW: extraW,
      exUseD: extraD,
    };
    const rotBehindLay = {
      totalW: Math.max(fpD, extraW) + 1.5,
      totalD: fpW + extraD + 3,
      fpOffsetT: (Math.max(fpD, extraW) + 1.5 - fpD) * 0.5,
      fpOffsetN: 0.75,
      fpUseW: fpD,
      fpUseD: fpW,
      exOffsetT: (Math.max(fpD, extraW) + 1.5 - extraW) * 0.5,
      exOffsetN: 0.75 + fpW + 1.5,
      exUseW: extraW,
      exUseD: extraD,
    };
    const rotBesideLay = {
      totalW: fpD + extraW + 3,
      totalD: Math.max(fpW, extraD) + 1.5,
      fpOffsetT: 0.75,
      fpOffsetN: 0.75,
      fpUseW: fpD,
      fpUseD: fpW,
      exOffsetT: 0.75 + fpD + 1.5,
      exOffsetN: 0.75,
      exUseW: extraW,
      exUseD: extraD,
    };
    const rotBehindRotExLay = {
      totalW: Math.max(fpD, extraD) + 1.5,
      totalD: fpW + extraW + 3,
      fpOffsetT: (Math.max(fpD, extraD) + 1.5 - fpD) * 0.5,
      fpOffsetN: 0.75,
      fpUseW: fpD,
      fpUseD: fpW,
      exOffsetT: (Math.max(fpD, extraD) + 1.5 - extraD) * 0.5,
      exOffsetN: 0.75 + fpW + 1.5,
      exUseW: extraD,
      exUseD: extraW,
    };
    const rotBesideRotExLay = {
      totalW: fpD + extraD + 3,
      totalD: Math.max(fpW, extraW) + 1.5,
      fpOffsetT: 0.75,
      fpOffsetN: 0.75,
      fpUseW: fpD,
      fpUseD: fpW,
      exOffsetT: 0.75 + fpD + 1.5,
      exOffsetN: 0.75,
      exUseW: extraD,
      exUseD: extraW,
    };
    if (preferBehindFirst) {
      layouts.push(rotBesideRotExLay, behindLay, rotBehindLay, rotBehindRotExLay, besideLay, rotBesideLay);
    } else {
      layouts.push(besideLay, behindLay, rotBesideRotExLay, rotBehindLay, rotBehindRotExLay, rotBesideLay);
    }
  } else {
    layouts.push({
      totalW: fpW + 2.0,
      totalD: fpD + 2.0,
      fpOffsetT: 1.0,
      fpOffsetN: 1.0,
      fpUseW: fpW,
      fpUseD: fpD,
      exOffsetT: 0,
      exOffsetN: 0,
      exUseW: 0,
      exUseD: 0,
    });
    if (Math.abs(fpW - fpD) > 2) {
      layouts.push({
        totalW: fpD + 2.0,
        totalD: fpW + 2.0,
        fpOffsetT: 1.0,
        fpOffsetN: 1.0,
        fpUseW: fpD,
        fpUseD: fpW,
        exOffsetT: 0,
        exOffsetN: 0,
        exUseW: 0,
        exUseD: 0,
      });
    }
  }

  let bestRes: {
    sitePoly: Vec2[];
    fpPoly: Vec2[];
    extraPoly: Vec2[] | null;
    entrancePos: Vec2;
    entranceEdgeId: number;
    score: number;
  } | null = null;

  for (const lay of layouts) {
    if (edgeLen < lay.totalW) continue;
    for (let cursor = 0; cursor + lay.totalW <= edgeLen + 0.1; cursor += slideCursorStep) {
      const origin = add(pA, mul(tangent, cursor));
      const sitePoly = makeOrientedRect(origin, tangent, inward, lay.totalW, lay.totalD);
      if (
        !polygonInsidePolygon(sitePoly, safeInner, 0.01) ||
        !polygonInsidePolygon(sitePoly, blockPoly, 0.01)
      ) {
        continue;
      }

      const overlapsSite = existingSites.some(
        (vs) =>
          polygonIntersectionArea(vs.sitePolygon, sitePoly) > 0.02 ||
          polygonIntersectionArea(sitePoly, vs.sitePolygon) > 0.02 ||
          (vs.extraPolygon !== null && polygonIntersectionArea(vs.extraPolygon, sitePoly) > 0.02)
      );
      if (overlapsSite) continue;

      const fpOrigin = add(add(origin, mul(tangent, lay.fpOffsetT)), mul(inward, lay.fpOffsetN));
      const fpPoly = makeOrientedRect(fpOrigin, tangent, inward, lay.fpUseW, lay.fpUseD);

      const fpB = polygonBounds(fpPoly);
      const nearEdges = edgeHash.queryBounds(fpB.minX - 8, fpB.minY - 8, fpB.maxX + 8, fpB.maxY + 8);
      const fpTooClose = nearEdges.some((e) => {
        const req = ROAD_HALF_WIDTH[e.roadClass] + 1.05;
        return distancePolylineToPolygon(e.polyline, fpPoly) < req;
      });
      if (fpTooClose) continue;

      const extraPoly =
        lay.exUseW > 0
          ? makeOrientedRect(
              add(add(origin, mul(tangent, lay.exOffsetT)), mul(inward, lay.exOffsetN)),
              tangent,
              inward,
              lay.exUseW,
              lay.exUseD
            )
          : null;

      const fMid = add(fpOrigin, mul(tangent, lay.fpUseW * 0.5));
      let bestEdge = blockEdges[0] ?? allEdges[0];
      let bestD = Infinity;
      for (const e of blockEdges.length > 0 ? blockEdges : nearEdges.length > 0 ? nearEdges : allEdges) {
        for (let k = 1; k < e.polyline.length; k++) {
          const res = pointToSegment(fMid, e.polyline[k - 1], e.polyline[k]);
          if (res.dist < bestD) {
            bestD = res.dist;
            bestEdge = e;
          }
        }
      }

      let score = 0;
      if (preferClusterNear && preferClusterNear.length > 0) {
        const fpC = polygonCentroid(fpPoly);
        let minC = Infinity;
        for (const anc of preferClusterNear) {
          const d = dist(fpC, anc);
          if (d < minC) minC = d;
        }
        score = minC <= 58 ? 300 - minC : -minC;
      }

      const candidate = {
        sitePoly,
        fpPoly,
        extraPoly,
        entrancePos: fMid,
        entranceEdgeId: bestEdge.id,
        score,
      };

      if (!preferClusterNear || preferClusterNear.length === 0) {
        return candidate;
      }
      if (!bestRes || score > bestRes.score) {
        bestRes = candidate;
      }
    }
  }
  return bestRes;
}

export function runStageVenueSiteReservation(ctx: GenContext): void {
  const t0 = nowMs();
  const rng = SeededRng.fromStage(ctx.params.seed, 'venue_sites');
  const districtsById = new Map<number, District>();
  for (const d of ctx.districts) districtsById.set(d.id, d);
  const edgesById = new Map<number, GraphEdge>();
  for (const e of ctx.edges) edgesById.set(e.id, e);

  const edgeHash = new SpatialHash<GraphEdge>(55);
  for (const e of ctx.edges) {
    const b = polygonBounds(e.polyline);
    const pad = ROAD_HALF_WIDTH[e.roadClass] + 4;
    edgeHash.insertBounds(b.minX - pad, b.minY - pad, b.maxX + pad, b.maxY + pad, e.polyline[0], e);
  }

  const blockSafeInner = new Map<number, Vec2[]>();
  for (const blk of ctx.blocks) {
    if (blk.kind !== BlockKind.Built) continue;
    const tryInsets = [
      ROAD_HALF_WIDTH[RoadClass.Secondary] + 1.35,
      ROAD_HALF_WIDTH[RoadClass.Lane] + 1.25,
      1.2,
      0.25,
    ];
    let chosen: Vec2[] | null = null;
    for (const ins of tryInsets) {
      const cand = offsetPolygon(blk.polygon, ins);
      if (
        cand.length >= 3 &&
        polygonArea(cand) > 120 &&
        !polygonSelfIntersects(cand) &&
        polygonInsidePolygon(cand, blk.polygon, 0.01)
      ) {
        chosen = cand;
        break;
      }
    }
    if (!chosen && blk.area > 3500) {
      chosen = blk.polygon;
    }
    if (chosen) {
      blockSafeInner.set(blk.id, chosen);
    }
  }

  const plotDefs = VENUE_DEFS.filter((d) => d.siteType === 'plot').sort((a, b) => {
    const minSideBoost = (d: VenueDef) => (d.id === 'supermarket' ? 3200 : 0);
    const areaA = a.footprint.w * a.footprint.d + (a.site ? a.site.w * a.site.d : 0) + minSideBoost(a);
    const areaB = b.footprint.w * b.footprint.d + (b.site ? b.site.w * b.site.d : 0) + minSideBoost(b);
    return areaB - areaA;
  });

  const sites: VenueSite[] = [];
  const unplaced: Array<{ defId: string; displayName: string; reason: string }> = [];
  const packedRetailParkDefs = new Set<string>();

  // -------------------------------------------------------------------------
  // Retail Park Row Campus along Service Road beside Spine (Supermarket anchor first, >= 10 m gaps, shared car park in front)
  // -------------------------------------------------------------------------
  let reservedRetailParkBlockId: number | null = null;
  const rpAnchorDef = plotDefs.find((d) => d.id === 'retail_park');
  const rpUnitDef = plotDefs.find((d) => d.id === 'retail_park_unit');
  if (rpAnchorDef && rpUnitDef && ctx.retailParkCampus) {
    const campus = ctx.retailParkCampus;
    const serviceEdges = ctx.edges.filter((e) => e.traceId === campus.serviceTraceId);
    const rpBlock = ctx.blocks.find(
      (blk) => blk.kind === BlockKind.Built && pointInPolygon(campus.center, blk.polygon)
    );
    if (rpBlock) reservedRetailParkBlockId = rpBlock.id;

    if (rpBlock && serviceEdges.length > 0) {
      const inner = blockSafeInner.get(rpBlock.id) ?? rpBlock.polygon;
      const candidateSites: VenueSite[] = [];
      let allFit = true;

      for (let i = 0; i < campus.boxes.length; i++) {
        const bx = campus.boxes[i];
        const fpPoly = makeOrientedRect(bx.origin, campus.u, campus.v, bx.w, bx.d);
        const siteOrig = sub(bx.origin, add(mul(campus.u, 0.8), mul(campus.v, 0.8)));
        const sitePoly = makeOrientedRect(siteOrig, campus.u, campus.v, bx.w + 1.6, bx.d + 1.6);
        if (
          !polygonInsidePolygon(sitePoly, inner, 0.01) ||
          !polygonInsidePolygon(sitePoly, rpBlock.polygon, 0.01)
        ) {
          allFit = false;
          break;
        }
        const fpB = polygonBounds(fpPoly);
        const nearEdges = edgeHash.queryBounds(fpB.minX - 8, fpB.minY - 8, fpB.maxX + 8, fpB.maxY + 8);
        if (
          nearEdges.some(
            (e) =>
              distancePolylineToPolygon(e.polyline, fpPoly) < ROAD_HALF_WIDTH[e.roadClass] + 1.05
          )
        ) {
          allFit = false;
          break;
        }

        const fMid = add(bx.origin, mul(campus.u, bx.w * 0.5));
        let bestSvcEdge = serviceEdges[0];
        let bestSvcD = Infinity;
        for (const se of serviceEdges) {
          for (let k = 1; k < se.polyline.length; k++) {
            const r = pointToSegment(fMid, se.polyline[k - 1], se.polyline[k]);
            if (r.dist < bestSvcD) {
              bestSvcD = r.dist;
              bestSvcEdge = se;
            }
          }
        }

        const extraOk =
          bx.isAnchor &&
          polygonInsidePolygon(campus.carParkPoly, inner, 0.01) &&
          polygonInsidePolygon(campus.carParkPoly, rpBlock.polygon, 0.01);

        candidateSites.push({
          id: sites.length + candidateSites.length,
          defId: bx.isAnchor ? 'retail_park' : 'retail_park_unit',
          venueId: null,
          blockId: rpBlock.id,
          districtId: rpBlock.districtId,
          edgeId: bestSvcEdge.id,
          sitePolygon: sitePoly,
          footprintPolygon: fpPoly,
          extraPolygon: extraOk ? campus.carParkPoly : null,
          extraLabel: extraOk ? 'Shared Car Park' : null,
          entrancePos: fMid,
          catalogW: bx.w,
          catalogD: bx.d,
        });
      }

      if (allFit) {
        // Reserve 2 small promenade kiosk sites between car park and gaps so Euclidean DBSCAN (eps=60, minPts=4) bridges the row
        for (const pod of campus.pods) {
          const fpPoly = makeOrientedRect(pod.origin, campus.u, campus.v, pod.w, pod.d);
          const siteOrig = sub(pod.origin, add(mul(campus.u, 0.5), mul(campus.v, 0.5)));
          const sitePoly = makeOrientedRect(siteOrig, campus.u, campus.v, pod.w + 1.0, pod.d + 1.0);
          if (
            polygonInsidePolygon(sitePoly, inner, 0.01) &&
            polygonInsidePolygon(sitePoly, rpBlock.polygon, 0.01)
          ) {
            const fMid = add(pod.origin, mul(campus.u, pod.w * 0.5));
            let bestSvcEdge = serviceEdges[0];
            let bestSvcD = Infinity;
            for (const se of serviceEdges) {
              for (let k = 1; k < se.polyline.length; k++) {
                const r = pointToSegment(fMid, se.polyline[k - 1], se.polyline[k]);
                if (r.dist < bestSvcD) {
                  bestSvcD = r.dist;
                  bestSvcEdge = se;
                }
              }
            }
            candidateSites.push({
              id: sites.length + candidateSites.length,
              defId: pod.defId,
              venueId: null,
              blockId: rpBlock.id,
              districtId: rpBlock.districtId,
              edgeId: bestSvcEdge.id,
              sitePolygon: sitePoly,
              footprintPolygon: fpPoly,
              extraPolygon: null,
              extraLabel: null,
              entrancePos: fMid,
              catalogW: pod.w,
              catalogD: pod.d,
            });
          }
        }

        for (const s of candidateSites) sites.push(s);
        packedRetailParkDefs.add('retail_park');
        packedRetailParkDefs.add('retail_park_unit');
      }
    }
  }

  for (const def of plotDefs) {
    if (packedRetailParkDefs.has(def.id)) continue;
    const count = rng.int(def.countRange[0], def.countRange[1]);

    for (let k = 0; k < count; k++) {
      const isRetailParkItem = def.id === 'retail_park' || def.id === 'retail_park_unit';
      const retailParkCenters =
        def.id === 'retail_park_unit'
          ? sites
              .filter((s) => s.defId === 'retail_park' || s.defId === 'retail_park_unit')
              .map((s) => polygonCentroid(s.footprintPolygon))
          : undefined;

      const candidateBlocks = ctx.blocks
        .filter((blk) => {
          if (blk.kind !== BlockKind.Built || !blockSafeInner.has(blk.id)) return false;
          if (reservedRetailParkBlockId !== null && blk.id === reservedRetailParkBlockId) return false;
          if (isRetailParkItem) {
            const dObj = districtsById.get(blk.districtId);
            if (dObj?.archetype === DistrictArchetype.OldTown) return false;
          }
          return true;
        })
        .map((blk) => {
          const inner = blockSafeInner.get(blk.id)!;
          const distObj = districtsById.get(blk.districtId);
          const distMatch =
            distObj && def.requiredDistrictTags.includes(distObj.archetype) ? 1 : 0;
          const bEdges = blk.edgeIds
            .map((id) => edgesById.get(id))
            .filter((e): e is GraphEdge => !!e);
          const hasArterialOrMain = bEdges.some((e) => e.roadClass <= RoadClass.Main);
          const c = polygonCentroid(inner);

          let score = distMatch * 65 + Math.min(28, polygonArea(inner) / 900);
          if (def.frontageClass <= RoadClass.Main && hasArterialOrMain) score += 12;

          // Keep StationIndustrial large blocks free for Millbrook Supermarket & Retail Park Units!
          if (
            distObj?.archetype === DistrictArchetype.StationIndustrial &&
            !def.requiredDistrictTags.includes(DistrictArchetype.StationIndustrial) &&
            def.site
          ) {
            score -= 1200;
          }

          if (def.id === 'retail_park_unit' && retailParkCenters && retailParkCenters.length > 0) {
            const minD = Math.min(...retailParkCenters.map((rc) => dist(rc, c)));
            score += minD < 210 ? 450 - minD * 0.9 : -minD * 0.5;
          }
          if (def.id === 'retail_park' && distObj?.archetype === DistrictArchetype.StationIndustrial) {
            score += 220;
          }

          for (const s of sites) {
            if (s.defId === def.id && def.id !== 'retail_park_unit') {
              const sd = dist(polygonCentroid(s.footprintPolygon), c);
              if (sd < def.minSpacing) score -= 80;
            }
          }

          return { blk, inner, innerArea: polygonArea(inner), innerBb: polygonBounds(inner), bEdges, score };
        })
        .sort((a, b) => b.score - a.score);

      let bestOverall: {
        blk: Block;
        hit: NonNullable<ReturnType<typeof tryBuildVenueSiteOnBlockEdge>>;
        fpW: number;
        fpD: number;
      } | null = null;
      const attemptsCfg: Array<{
        wScale: number;
        dScale: number;
        exScale: number;
        deepSweep: boolean;
      }> = [
        { wScale: 1.0, dScale: 1.0, exScale: 1.0, deepSweep: false },
        { wScale: 0.96, dScale: 0.96, exScale: 0.85, deepSweep: false },
        { wScale: 0.96, dScale: 0.96, exScale: 0.65, deepSweep: true },
        { wScale: 0.95, dScale: 0.95, exScale: 0.28, deepSweep: true },
      ];
      if (def.id === 'supermarket') {
        attemptsCfg.push({ wScale: 39 / 45, dScale: 68 / 60, exScale: 0.28, deepSweep: true });
        attemptsCfg.push({ wScale: 36 / 45, dScale: 72 / 60, exScale: 0.25, deepSweep: true });
      }
      for (const cfgAttempt of attemptsCfg) {
        if (bestOverall) break;
        const fpW = def.footprint.w * cfgAttempt.wScale;
        const fpD = def.footprint.d * cfgAttempt.dScale;
        const exW = def.site ? def.site.w * cfgAttempt.exScale : 0;
        const exD = def.site ? def.site.d * cfgAttempt.exScale : 0;
        const minNeededArea = fpW * fpD + exW * exD;
        const minNeededSide = Math.min(fpW, fpD);

        const eligibleCands = candidateBlocks.filter(
          (cand) =>
            cand.innerArea >= minNeededArea &&
            Math.max(cand.innerBb.width, cand.innerBb.height) >= minNeededSide
        );
        const blockLimit = cfgAttempt.deepSweep
          ? Math.min(28, eligibleCands.length)
          : Math.min(18, eligibleCands.length);

        for (let bIdx = 0; bIdx < blockLimit; bIdx++) {
          const cand = eligibleCands[bIdx];
          if (bestOverall && (!retailParkCenters || bestOverall.hit.score >= 242)) break;
          const inner = cand.inner;
          const existingInBlock = sites.filter((s) => s.blockId === cand.blk.id);

          const edgeOrder = inner.map((_, i) => i);
          if (retailParkCenters && retailParkCenters.length > 0) {
            const ac = retailParkCenters[0];
            edgeOrder.sort((ia, ib) => {
              const midA = lerpVec(inner[ia], inner[(ia + 1) % inner.length], 0.5);
              const midB = lerpVec(inner[ib], inner[(ib + 1) % inner.length], 0.5);
              return dist(ac, midA) - dist(ac, midB);
            });
          } else if (def.id === 'retail_park') {
            edgeOrder.sort((ia, ib) => {
              const lA = dist(inner[ia], inner[(ia + 1) % inner.length]);
              const lB = dist(inner[ib], inner[(ib + 1) % inner.length]);
              return lB - lA;
            });
          }

          const nVerts = inner.length;
          const chordCandidates: Array<{ a: Vec2; b: Vec2 }> = [];
          for (const ei of edgeOrder) {
            for (const span of [1, 2, 3, 4]) {
              if (span >= nVerts) continue;
              const pA = inner[ei];
              const pB = inner[(ei + span) % nVerts];
              if (dist(pA, pB) >= Math.min(fpW, fpD)) {
                chordCandidates.push({ a: pA, b: pB });
              }
            }
          }
          const bb = polygonBounds(inner);
          if (bb.width > 40 && bb.height > 40) {
            const fracs = cfgAttempt.deepSweep ? [0.2, 0.5, 0.8] : [0.25, 0.75];
            for (const yFrac of fracs) {
              const y = bb.minY + bb.height * yFrac;
              chordCandidates.push({ a: { x: bb.minX + 1, y }, b: { x: bb.maxX - 1, y } });
              chordCandidates.push({ a: { x: bb.maxX - 1, y }, b: { x: bb.minX + 1, y } });
            }
            for (const xFrac of fracs) {
              const x = bb.minX + bb.width * xFrac;
              chordCandidates.push({ a: { x, y: bb.minY + 1 }, b: { x, y: bb.maxY - 1 } });
              chordCandidates.push({ a: { x, y: bb.maxY - 1 }, b: { x, y: bb.minY + 1 } });
            }
            if (cfgAttempt.deepSweep) {
              const innerC = polygonCentroid(inner);
              const radSpan = Math.max(bb.width, bb.height) * 0.75;
              // Include exact angles of longest polygon edges + 30-degree grid
              const baseAngles = [0, 30, 60, 90, 120, 150];
              for (const ei of edgeOrder.slice(0, 3)) {
                const pA = inner[ei];
                const pB = inner[(ei + 1) % nVerts];
                if (dist(pA, pB) > 12) {
                  baseAngles.push((Math.atan2(pB.y - pA.y, pB.x - pA.x) * 180) / Math.PI);
                }
              }
              for (const deg of baseAngles) {
                const rad = (deg * Math.PI) / 180;
                const dir = { x: Math.cos(rad), y: Math.sin(rad) };
                const nrm = perp(dir);
                const halfProj =
                  Math.abs(nrm.x) * (bb.width * 0.45) + Math.abs(nrm.y) * (bb.height * 0.45);
                const shifts = [-halfProj * 0.85, -halfProj * 0.55, -halfProj * 0.25, 0, halfProj * 0.25, halfProj * 0.55, halfProj * 0.85];
                for (const shift of shifts) {
                  const org = add(innerC, mul(nrm, shift));
                  const p0 = add(org, mul(dir, -radSpan));
                  const p1 = add(org, mul(dir, radSpan));
                  chordCandidates.push({ a: p0, b: p1 });
                  chordCandidates.push({ a: p1, b: p0 });
                }
              }
            }
          }

          let bestHit: ReturnType<typeof tryBuildVenueSiteOnBlockEdge> = null;
          for (const ch of chordCandidates) {
            const hit = tryBuildVenueSiteOnBlockEdge(
              ch.a,
              ch.b,
              inner,
              cand.blk.polygon,
              existingInBlock,
              fpW,
              fpD,
              exW,
              exD,
              cand.bEdges,
              edgeHash,
              ctx.edges,
              retailParkCenters ? 7 : 10,
              retailParkCenters,
              isRetailParkItem
            );
            if (hit) {
              if (!retailParkCenters || retailParkCenters.length === 0) {
                bestHit = hit;
                break;
              }
              if (!bestHit || hit.score > bestHit.score) {
                bestHit = hit;
                if (bestHit.score >= 246) break;
              }
            }
          }

          if (bestHit) {
            // For retail_park_unit during non-final passes, require proximity <= 58m to an already placed park unit!
            if (
              def.id === 'retail_park_unit' &&
              retailParkCenters &&
              retailParkCenters.length > 0 &&
              !cfgAttempt.deepSweep &&
              bestHit.score < 242
            ) {
              continue;
            }
            if (!bestOverall || bestHit.score > bestOverall.hit.score) {
              bestOverall = { blk: cand.blk, hit: bestHit, fpW, fpD };
            }
            if (!retailParkCenters || bestHit.score >= 244) break;
          }
        }
      }

      if (bestOverall) {
        sites.push({
          id: sites.length,
          defId: def.id,
          venueId: null,
          blockId: bestOverall.blk.id,
          districtId: bestOverall.blk.districtId,
          edgeId: bestOverall.hit.entranceEdgeId,
          sitePolygon: bestOverall.hit.sitePoly,
          footprintPolygon: bestOverall.hit.fpPoly,
          extraPolygon: bestOverall.hit.extraPoly,
          extraLabel: def.extraLabel ?? null,
          entrancePos: bestOverall.hit.entrancePos,
          catalogW: bestOverall.fpW,
          catalogD: bestOverall.fpD,
        });
      } else {
        unplaced.push({
          defId: def.id,
          displayName: def.displayName,
          reason: `No eligible block/edge strip could fit ${def.footprint.w}x${def.footprint.d}m${def.site ? ` + ${def.site.w}x${def.site.d}m ${def.extraLabel}` : ''}`,
        });
      }
    }
  }

  ctx.venueSites = sites;
  ctx.unplacedVenues = unplaced;
  ctx.diagnostics.push({
    stage: 'Stage 6b · Venue Site Reservation',
    durationMs: nowMs() - t0,
    summary: `${sites.length} plot venue sites reserved (${unplaced.length} unplaced)`,
  });
}

// ---------------------------------------------------------------------------
// Stage 7-9: Lots, Urban Density Gradient, Sprawl & Greenbelt, Repair & Fitting
// ---------------------------------------------------------------------------
function pickWeightedDwelling(
  mix: Record<DwellingType, number>,
  rNorm: number,
  rng: SeededRng
): DwellingType {
  // Density gradient m(r): boost flats/terraces near center, houses outward
  const adj: Record<DwellingType, number> = {
    [DwellingType.FlatBuilding]: mix[DwellingType.FlatBuilding] * clamp(1.15 - rNorm * 0.45, 0.55, 1.25),
    [DwellingType.Terraced]: mix[DwellingType.Terraced] * clamp(1.1 - rNorm * 0.35, 0.65, 1.2),
    [DwellingType.SemiDetached]: mix[DwellingType.SemiDetached] * clamp(0.85 + rNorm * 0.4, 0.7, 1.35),
    [DwellingType.Detached]: mix[DwellingType.Detached] * clamp(0.7 + rNorm * 0.6, 0.6, 1.45),
    [DwellingType.LuxuryMansion]: mix[DwellingType.LuxuryMansion] * clamp(0.6 + rNorm * 0.75, 0.5, 1.5),
  };
  const entries = Object.entries(adj) as Array<[DwellingType, number]>;
  const total = entries.reduce((acc, [, w]) => acc + w, 0);
  let r = rng.range(0, Math.max(1e-6, total));
  for (const [type, w] of entries) {
    r -= w;
    if (r <= 0) return type;
  }
  return DwellingType.Terraced;
}

function findBestBlockEdgeForPoly(
  lotPoly: Vec2[],
  blockEdges: GraphEdge[],
  fallbackPolyEdge: [Vec2, Vec2]
): {
  edge: GraphEdge;
  frontageEdge: [Vec2, Vec2];
  frontageMidpoint: Vec2;
  side: 'left' | 'right';
} {
  const c = polygonCentroid(lotPoly);
  let bestEdge = blockEdges[0];
  let bestDist = Infinity;
  let bestProj = c;

  for (const e of blockEdges) {
    for (let i = 1; i < e.polyline.length; i++) {
      const res = pointToSegment(c, e.polyline[i - 1], e.polyline[i]);
      if (res.dist < bestDist) {
        bestDist = res.dist;
        bestEdge = e;
        bestProj = res.proj;
      }
    }
  }

  let lotEdge: [Vec2, Vec2] = fallbackPolyEdge;
  let bestLotEdgeDist = Infinity;
  for (let i = 0; i < lotPoly.length; i++) {
    const a = lotPoly[i];
    const b = lotPoly[(i + 1) % lotPoly.length];
    const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
    const d = dist(mid, bestProj);
    if (d < bestLotEdgeDist) {
      bestLotEdgeDist = d;
      lotEdge = [a, b];
    }
  }

  const edgeDir = sub(
    bestEdge.polyline[bestEdge.polyline.length - 1],
    bestEdge.polyline[0]
  );
  const toLot = sub(c, bestProj);
  const side: 'left' | 'right' = cross(edgeDir, toLot) >= 0 ? 'left' : 'right';

  return {
    edge: bestEdge,
    frontageEdge: lotEdge,
    frontageMidpoint: {
      x: (lotEdge[0].x + lotEdge[1].x) * 0.5,
      y: (lotEdge[0].y + lotEdge[1].y) * 0.5,
    },
    side,
  };
}

export function makeFootprintInsideLot(
  lotPoly: Vec2[],
  frontageEdge: [Vec2, Vec2],
  footprintW: number,
  footprintD: number,
  rng: SeededRng,
  strictCatalog = false
): Vec2[] | null {
  const fA = frontageEdge[0];
  const fB = frontageEdge[1];
  const fLen = dist(fA, fB);
  if (fLen < 3.4) return null;

  const tangent = norm(sub(fB, fA));
  const lotCenter = polygonCentroid(lotPoly);
  let inward = perp(tangent);
  const fMid = { x: (fA.x + fB.x) * 0.5, y: (fA.y + fB.y) * 0.5 };
  if (dot(inward, sub(lotCenter, fMid)) < 0) {
    inward = mul(inward, -1);
  }

  const jitterRad = strictCatalog ? 0 : rng.range(-3, 3) * (Math.PI / 180);
  const cosJ = Math.cos(jitterRad);
  const sinJ = Math.sin(jitterRad);
  const rotT = { x: tangent.x * cosJ - tangent.y * sinJ, y: tangent.x * sinJ + tangent.y * cosJ };
  const rotN = { x: inward.x * cosJ - inward.y * sinJ, y: inward.x * sinJ + inward.y * cosJ };

  let maxInwardProj = 0;
  for (const pt of lotPoly) {
    const p = dot(sub(pt, fMid), inward);
    if (p > maxInwardProj) maxInwardProj = p;
  }

  const frontSetback = strictCatalog
    ? 0.25
    : Math.min(rng.range(2.2, 4.4), Math.max(1.1, maxInwardProj * 0.2));

  const targetW = strictCatalog
    ? footprintW
    : Math.min(footprintW * rng.range(0.92, 1.06), fLen - 0.9);
  const targetD = strictCatalog
    ? footprintD
    : Math.min(footprintD * rng.range(0.92, 1.06), Math.max(3.8, maxInwardProj - frontSetback - 1.0));

  const scales = strictCatalog ? [1.0, 0.97, 0.94] : [1.0, 0.9, 0.8, 0.72, 0.64];
  const setbacks = strictCatalog ? [0.25, 0.9, 1.8, 2.7] : [frontSetback];
  const latShifts = strictCatalog ? [0, -1.2, 1.2, -2.4, 2.4] : [0];
  for (const scale of scales) {
    const hw = targetW * scale * 0.5;
    const d = targetD * scale;
    if (hw < 1.5 || d < 3.0) return null;

    for (const sb of setbacks) {
      for (const ls of latShifts) {
        const frontCenter = add(add(fMid, mul(rotN, sb)), mul(rotT, ls));
        const c1 = add(frontCenter, mul(rotT, -hw));
        const c2 = add(frontCenter, mul(rotT, hw));
        const c3 = add(c2, mul(rotN, d));
        const c4 = add(c1, mul(rotN, d));
        const rect = ensureCCW([c1, c2, c3, c4]);

        if (polygonInsidePolygon(rect, lotPoly, 0.01)) {
          return rect;
        }
      }
    }
  }

  if (strictCatalog) return null;

  const bounds = polygonBounds(lotPoly);
  const hw = Math.min(footprintW * 0.42, bounds.width * 0.26);
  const hd = Math.min(footprintD * 0.42, bounds.height * 0.26);
  if (hw < 1.5 || hd < 2.2) return null;
  const rect = ensureCCW([
    sub(add(lotCenter, mul(rotT, -hw)), mul(rotN, hd)),
    sub(add(lotCenter, mul(rotT, hw)), mul(rotN, hd)),
    add(add(lotCenter, mul(rotT, hw)), mul(rotN, hd)),
    add(add(lotCenter, mul(rotT, -hw)), mul(rotN, hd)),
  ]);
  return polygonInsidePolygon(rect, lotPoly, 0.01) ? rect : null;
}

function generateLotsBuildingsAndSprawlPass(
  ctx: GenContext,
  widthScale: number,
  seedOffset: number
): {
  lots: Lot[];
  buildings: Building[];
  sprawlAddedNodes: GraphNode[];
  sprawlAddedEdges: GraphEdge[];
} {
  const rng = new SeededRng(fnv1a(ctx.params.seed + seedOffset, 'lots_and_buildings'));
  const lots: Lot[] = [];
  const buildings: Building[] = [];

  const edgeById = new Map<number, GraphEdge>();
  for (const e of ctx.edges) edgeById.set(e.id, e);
  const districtById = new Map<number, District>();
  for (const d of ctx.districts) districtById.set(d.id, d);

  const sitesByBlock = new Map<number, VenueSite[]>();
  for (const vs of ctx.venueSites) {
    let arr = sitesByBlock.get(vs.blockId);
    if (!arr) {
      arr = [];
      sitesByBlock.set(vs.blockId, arr);
    }
    arr.push(vs);
  }

  const globalLotHash = new SpatialHash<Lot>(45);
  const insertLotToGlobalHash = (lotObj: Lot) => {
    const lb = polygonBounds(lotObj.polygon);
    globalLotHash.insertBounds(
      lb.minX - 0.5,
      lb.minY - 0.5,
      lb.maxX + 0.5,
      lb.maxY + 0.5,
      polygonCentroid(lotObj.polygon),
      lotObj
    );
  };

  // Build buildings for all reserved VenueSites first
  for (const vs of ctx.venueSites) {
    const lotId = lots.length;
    const fEdge: [Vec2, Vec2] = [vs.footprintPolygon[0], vs.footprintPolygon[1]];
    const blkEdges = (ctx.blocks.find((b) => b.id === vs.blockId)?.edgeIds ?? [])
      .map((eid) => edgeById.get(eid))
      .filter((e): e is GraphEdge => !!e);
    const match =
      blkEdges.length > 0
        ? findBestBlockEdgeForPoly(vs.sitePolygon, blkEdges, fEdge)
        : null;

    const vLot: Lot = {
      id: lotId,
      blockId: vs.blockId,
      districtId: vs.districtId,
      polygon: vs.sitePolygon,
      frontageEdge: match?.frontageEdge ?? fEdge,
      frontageMidpoint: vs.entrancePos,
      streetId: match?.edge.streetId ?? -1,
      edgeId: vs.edgeId,
      side: match?.side ?? 'left',
      dwellingType: DwellingType.FlatBuilding,
      isFringe: false,
      isGardenOrParking: false,
    };
    lots.push(vLot);
    insertLotToGlobalHash(vLot);

    buildings.push({
      id: buildings.length,
      lotId,
      blockId: vs.blockId,
      districtId: vs.districtId,
      footprint: vs.footprintPolygon,
      centroid: polygonCentroid(vs.footprintPolygon),
      kind: BuildingKind.Venue,
      dwellingType: null,
      address: { streetId: match?.edge.streetId ?? -1, number: 0, unitLabel: '' },
      addressString: '',
      unitIds: [],
      venueId: null, // linked cleanly in retail/venues stage
      entrancePos: vs.entrancePos,
      entranceEdgeId: vs.edgeId,
      isFringe: false,
      sprawlType: null,
    });
  }

  // Subdivide Built blocks inside urban blobs into residential/shop lots
  for (const block of ctx.blocks) {
    if (block.kind !== BlockKind.Built || block.isSprawlBlock) continue;
    const district = districtById.get(block.districtId) ?? ctx.districts[0];
    const blockEdges = block.edgeIds
      .map((id) => edgeById.get(id))
      .filter((e): e is GraphEdge => !!e);
    if (blockEdges.length === 0) continue;

    // Exact inset respecting widest surrounding road + >= 1.25 m clearance
    const maxHW = blockEdges.reduce(
      (m, e) => Math.max(m, ROAD_HALF_WIDTH[e.roadClass]),
      ROAD_HALF_WIDTH[RoadClass.Secondary]
    );
    const inset = maxHW + 1.25;
    const innerPoly = offsetPolygon(block.polygon, inset);
    if (
      innerPoly.length < 3 ||
      polygonArea(innerPoly) < 110 ||
      !polygonInsidePolygon(innerPoly, block.polygon, 0.01)
    ) {
      continue;
    }

    const blockCenter = polygonCentroid(block.polygon);
    const uBlock = ctx.urbanityAt(blockCenter);
    const uNorm = clamp(
      1 - (uBlock - (ctx.params.builtUpThreshold ?? 0.25)) / 0.72,
      0,
      1.1
    );
    const outerGardenProb =
      uNorm > 0.6 ? clamp(0.025 + (uNorm - 0.6) * 0.17, 0.025, 0.12) : 0.02;
    const rNorm = uNorm;

    const reservedSites = sitesByBlock.get(block.id) ?? [];

    const canAcceptLotPoly = (poly: Vec2[]): boolean => {
      if (
        poly.length < 3 ||
        polygonArea(poly) < 55 ||
        hasPolygonFoldbackOrDupes(poly) ||
        polygonSelfIntersects(poly)
      ) {
        return false;
      }
      if (!polygonInsidePolygon(poly, block.polygon, 0.02)) return false;
      for (const vs of reservedSites) {
        if (
          polygonIntersectionArea(poly, vs.sitePolygon) > 0.2 ||
          polygonIntersectionArea(vs.sitePolygon, poly) > 0.2
        ) {
          return false;
        }
        if (
          vs.extraPolygon &&
          (polygonIntersectionArea(poly, vs.extraPolygon) > 0.2 ||
            polygonIntersectionArea(vs.extraPolygon, poly) > 0.2)
        ) {
          return false;
        }
      }
      const pb = polygonBounds(poly);
      const nearLots = globalLotHash.queryBounds(pb.minX - 0.5, pb.minY - 0.5, pb.maxX + 0.5, pb.maxY + 0.5);
      for (const existing of nearLots) {
        if (
          polygonIntersectionArea(poly, existing.polygon) > 0.3 ||
          polygonIntersectionArea(existing.polygon, poly) > 0.3
        ) {
          return false;
        }
      }
      return true;
    };

    if (district.archetype === DistrictArchetype.OldTown) {
      const minSq = 230 * widthScale * widthScale;
      const queue: Vec2[][] = [innerPoly];
      const leaves: Vec2[][] = [];
      let guard = 0;

      while (queue.length > 0 && guard < 120) {
        guard++;
        const poly = queue.pop()!;
        const area = polygonArea(poly);
        if (area < minSq * rng.range(0.85, 1.4)) {
          leaves.push(poly);
          continue;
        }
        const b = polygonBounds(poly);
        const c = polygonCentroid(poly);
        const angleJitter = rng.range(-0.18, 0.18);
        const baseDir = b.width >= b.height ? { x: 0, y: 1 } : { x: 1, y: 0 };
        const splitDir = {
          x: baseDir.x * Math.cos(angleJitter) - baseDir.y * Math.sin(angleJitter),
          y: baseDir.x * Math.sin(angleJitter) + baseDir.y * Math.cos(angleJitter),
        };
        const offsetAmt = rng.range(-0.14, 0.14) * Math.min(b.width, b.height);
        const splitPt = {
          x: c.x + (b.width >= b.height ? offsetAmt : 0),
          y: c.y + (b.height > b.width ? offsetAmt : 0),
        };
        const [left, right] = splitPolygonByLine(poly, splitPt, splitDir);
        if (left.length >= 3 && right.length >= 3 && polygonArea(left) > 65 && polygonArea(right) > 65) {
          queue.push(left, right);
        } else {
          leaves.push(poly);
        }
      }

      for (const leaf of leaves) {
        if (!canAcceptLotPoly(leaf)) continue;
        const match = findBestBlockEdgeForPoly(leaf, blockEdges, [leaf[0], leaf[1]]);
        if (dist(match.frontageEdge[0], match.frontageEdge[1]) < 3.5) continue;

        const dwellingType = pickWeightedDwelling(district.dwellingMix, rNorm, rng);
        const isGardenOrParking = rng.chance(outerGardenProb);
        const lotId = lots.length;
        const lotObj: Lot = {
          id: lotId,
          blockId: block.id,
          districtId: block.districtId,
          polygon: leaf,
          frontageEdge: match.frontageEdge,
          frontageMidpoint: match.frontageMidpoint,
          streetId: match.edge.streetId,
          edgeId: match.edge.id,
          side: match.side,
          dwellingType,
          isFringe: false,
          isGardenOrParking,
        };
        lots.push(lotObj);
        insertLotToGlobalHash(lotObj);

        if (!isGardenOrParking) {
          const spec = DWELLING_SPECS[dwellingType];
          const footprint = makeFootprintInsideLot(
            leaf,
            match.frontageEdge,
            spec.footprintW,
            spec.footprintD,
            rng
          );
          if (footprint && !polygonSelfIntersects(footprint)) {
            buildings.push({
              id: buildings.length,
              lotId,
              blockId: block.id,
              districtId: block.districtId,
              footprint,
              centroid: polygonCentroid(footprint),
              kind: BuildingKind.Residential,
              dwellingType,
              address: { streetId: match.edge.streetId, number: 0, unitLabel: '' },
              addressString: '',
              unitIds: [],
              venueId: null,
              entrancePos: match.frontageMidpoint,
              entranceEdgeId: match.edge.id,
              isFringe: false,
              sprawlType: null,
            });
          }
        }
      }
    } else {
      // Frontage strips with corner bisectors + outer ring density thinning
      const nVerts = innerPoly.length;
      for (let i = 0; i < nVerts; i++) {
        const pPrev = innerPoly[(i - 1 + nVerts) % nVerts];
        const pA = innerPoly[i];
        const pB = innerPoly[(i + 1) % nVerts];
        const pNext = innerPoly[(i + 2) % nVerts];

        const edgeLen = dist(pA, pB);
        if (edgeLen < 5.5) continue;

        const dir = norm(sub(pB, pA));
        const inward = { x: -dir.y, y: dir.x };
        const prevDir = norm(sub(pA, pPrev));
        const nextDir = norm(sub(pNext, pB));
        const bisA = norm(add({ x: -prevDir.y, y: prevDir.x }, inward));
        const bisB = norm(add(inward, { x: -nextDir.y, y: nextDir.x }));
        const bisANorm = { x: bisA.y, y: -bisA.x };
        const bisBNorm = { x: -bisB.y, y: bisB.x };

        let cursor = 0;
        while (cursor + 4.5 <= edgeLen) {
          const dwellingType = pickWeightedDwelling(district.dwellingMix, rNorm, rng);
          const spec = DWELLING_SPECS[dwellingType];
          const desiredW =
            (spec.lotWidth + rng.range(-spec.widthJitter, spec.widthJitter)) * widthScale;
          const remaining = edgeLen - cursor;
          const lotW = remaining < desiredW * 1.45 ? remaining : Math.max(4.5, desiredW);
          const depth = Math.min(spec.stripDepth, Math.max(13, Math.sqrt(block.area) * 0.42));

          const s0 = add(pA, mul(dir, cursor));
          const s1 = add(pA, mul(dir, cursor + lotW));
          cursor += lotW;

          let lotPoly = [...innerPoly];
          lotPoly = clipPolygonByHalfPlane(lotPoly, s0, dir);
          lotPoly = clipPolygonByHalfPlane(lotPoly, s1, mul(dir, -1));
          lotPoly = clipPolygonByHalfPlane(lotPoly, s0, inward);
          lotPoly = clipPolygonByHalfPlane(
            lotPoly,
            add(s0, mul(inward, depth)),
            mul(inward, -1)
          );
          if (cursor - lotW < 1) lotPoly = clipPolygonByHalfPlane(lotPoly, pA, bisANorm);
          if (cursor >= edgeLen - 1) lotPoly = clipPolygonByHalfPlane(lotPoly, pB, bisBNorm);

          lotPoly = ensureCCW(deduplicatePoly(lotPoly, 0.1));
          if (!canAcceptLotPoly(lotPoly)) continue;

          const match = findBestBlockEdgeForPoly(lotPoly, blockEdges, [s0, s1]);
          if (dist(match.frontageEdge[0], match.frontageEdge[1]) < 3.5) continue;

          const isGardenOrParking = rng.chance(outerGardenProb);
          const lotId = lots.length;
          const lotObj: Lot = {
            id: lotId,
            blockId: block.id,
            districtId: block.districtId,
            polygon: lotPoly,
            frontageEdge: match.frontageEdge,
            frontageMidpoint: match.frontageMidpoint,
            streetId: match.edge.streetId,
            edgeId: match.edge.id,
            side: match.side,
            dwellingType,
            isFringe: false,
            isGardenOrParking,
          };
          lots.push(lotObj);
          insertLotToGlobalHash(lotObj);

          if (!isGardenOrParking) {
            const footprint = makeFootprintInsideLot(
              lotPoly,
              match.frontageEdge,
              spec.footprintW,
              spec.footprintD,
              rng
            );
            if (footprint && !polygonSelfIntersects(footprint)) {
              buildings.push({
                id: buildings.length,
                lotId,
                blockId: block.id,
                districtId: block.districtId,
                footprint,
                centroid: polygonCentroid(footprint),
                kind: BuildingKind.Residential,
                dwellingType,
                address: { streetId: match.edge.streetId, number: 0, unitLabel: '' },
                addressString: '',
                unitIds: [],
                venueId: null,
                entrancePos: match.frontageMidpoint,
                entranceEdgeId: match.edge.id,
                isFringe: false,
                sprawlType: null,
              });
            }
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // M4 Sprawl: Arterial Ribbon + Roadside Hamlets + Greenbelt Farms (<= 25% cap)
  // -------------------------------------------------------------------------
  const fringeRng = SeededRng.fromStage(ctx.params.seed + seedOffset, 'sprawl_greenbelt');
  const coreSatBuildingCount = buildings.length;
  const maxSprawlBudget = Math.floor((coreSatBuildingCount * 0.24) / 0.76); // safely <= 24% total
  let sprawlCount = 0;

  const sprawlEdgeHash = new SpatialHash<GraphEdge>(55);
  for (const e of ctx.edges) {
    const eb = polygonBounds(e.polyline);
    const pad = ROAD_HALF_WIDTH[e.roadClass] + 8;
    sprawlEdgeHash.insertBounds(eb.minX - pad, eb.minY - pad, eb.maxX + pad, eb.maxY + pad, e.polyline[0], e);
  }
  const sprawlBlockHash = new SpatialHash<Block>(65);
  for (const b of ctx.blocks) {
    const bb = polygonBounds(b.polygon);
    sprawlBlockHash.insertBounds(bb.minX - 2, bb.minY - 2, bb.maxX + 2, bb.maxY + 2, polygonCentroid(b.polygon), b);
  }
  const sprawlBldHash = new SpatialHash<Building>(40);
  for (const b of buildings) {
    const bb = polygonBounds(b.footprint);
    sprawlBldHash.insertBounds(bb.minX - 2, bb.minY - 2, bb.maxX + 2, bb.maxY + 2, b.centroid, b);
  }

  const isInsideUrbanBlock = (p: Vec2): boolean =>
    sprawlBlockHash
      .queryBounds(p.x - 1, p.y - 1, p.x + 1, p.y + 1)
      .some((b) => !b.isSprawlBlock && pointInPolygon(p, b.polygon));

  const placeSprawlBuilding = (
    center: Vec2,
    tangent: Vec2,
    outNormal: Vec2,
    lotW: number,
    lotD: number,
    fpW: number,
    fpD: number,
    edgeId: number,
    streetId: number,
    districtId: number,
    dwellingType: DwellingType | null,
    kind: BuildingKind,
    sprawlType: SprawlKind
  ): boolean => {
    if (sprawlCount >= maxSprawlBudget) return false;
    if (!pointInPolygon(center, ctx.domainPolygon)) return false;

    const roadClear = ROAD_HALF_WIDTH[RoadClass.Arterial] + 1.8;
    const f0 = add(add(center, mul(outNormal, -lotD * 0.5)), mul(tangent, -lotW * 0.5));
    const f1 = add(add(center, mul(outNormal, -lotD * 0.5)), mul(tangent, lotW * 0.5));
    const f2 = add(f1, mul(outNormal, lotD));
    const f3 = add(f0, mul(outNormal, lotD));
    const lotPoly = ensureCCW([f0, f1, f2, f3]);

    if (!lotPoly.every((pt) => pointInPolygon(pt, ctx.domainPolygon))) return false;
    const lb = polygonBounds(lotPoly);
    const nearBlocks = sprawlBlockHash.queryBounds(lb.minX - 1, lb.minY - 1, lb.maxX + 1, lb.maxY + 1);
    if (nearBlocks.some((b) => polygonIntersectionArea(b.polygon, lotPoly) > 0.4)) return false;
    const nearLots = globalLotHash.queryBounds(lb.minX - 1, lb.minY - 1, lb.maxX + 1, lb.maxY + 1);
    if (nearLots.some((l) => polygonIntersectionArea(l.polygon, lotPoly) > 0.3)) return false;

    const nearEdges = sprawlEdgeHash.queryBounds(lb.minX - 10, lb.minY - 10, lb.maxX + 10, lb.maxY + 10);
    if (
      nearEdges.some(
        (e) => distancePolylineToPolygon(e.polyline, lotPoly) < Math.max(ROAD_HALF_WIDTH[e.roadClass] + 1.2, 3.0)
      )
    ) {
      return false;
    }

    const fp = makeFootprintInsideLot(lotPoly, [f0, f1], fpW, fpD, fringeRng);
    if (!fp) return false;
    if (
      nearEdges.some(
        (e) =>
          distancePolylineToPolygon(e.polyline, fp) <
          Math.max(roadClear, ROAD_HALF_WIDTH[e.roadClass] + 1.3)
      )
    ) {
      return false;
    }
    const fpC = polygonCentroid(fp);
    if (sprawlBldHash.hasWithin(fpC, 15)) return false;

    const blkId = ctx.blocks.length;
    const newBlk: Block = {
      id: blkId,
      polygon: lotPoly,
      districtId,
      edgeIds: [edgeId],
      kind: BlockKind.Built,
      area: polygonArea(lotPoly),
      isSprawlBlock: true,
    };
    ctx.blocks.push(newBlk);
    sprawlBlockHash.insertBounds(lb.minX, lb.minY, lb.maxX, lb.maxY, lb as unknown as Vec2, newBlk);

    const fMid = { x: (f0.x + f1.x) * 0.5, y: (f0.y + f1.y) * 0.5 };
    const lotId = lots.length;
    const newLot: Lot = {
      id: lotId,
      blockId: blkId,
      districtId,
      polygon: lotPoly,
      frontageEdge: [f0, f1],
      frontageMidpoint: fMid,
      streetId,
      edgeId,
      side: 'left',
      dwellingType: dwellingType ?? DwellingType.Detached,
      isFringe: true,
      isGardenOrParking: false,
    };
    lots.push(newLot);
    insertLotToGlobalHash(newLot);

    const newBld: Building = {
      id: buildings.length,
      lotId,
      blockId: blkId,
      districtId,
      footprint: fp,
      centroid: fpC,
      kind,
      dwellingType,
      address: { streetId, number: 0, unitLabel: '' },
      addressString: '',
      unitIds: [],
      venueId: null,
      entrancePos: fMid,
      entranceEdgeId: edgeId,
      isFringe: true,
      sprawlType,
    };
    buildings.push(newBld);
    const fpb = polygonBounds(fp);
    sprawlBldHash.insertBounds(fpb.minX, fpb.minY, fpb.maxX, fpb.maxY, fpC, newBld);
    sprawlCount++;
    return true;
  };

  // 1. Arterial Ribbon development where ribbonThreshold <= U(p) < builtUpThreshold
  const ribbonAnchors: Vec2[] = [];
  const ribbonThresh = ctx.params.ribbonThreshold ?? 0.10;
  const builtThresh = ctx.params.builtUpThreshold ?? 0.25;

  for (const edge of ctx.edges) {
    if (edge.roadClass > RoadClass.Secondary || edge.length < 65) continue;
    if (edge.roadClass === RoadClass.Main && ctx.retailParkCampus && edge.traceId === ctx.retailParkCampus.serviceTraceId) continue;
    const steps = Math.floor(edge.length / 22);
    for (let s = 1; s < steps; s++) {
      if (sprawlCount >= maxSprawlBudget) break;
      const t = s / steps;
      const idx = Math.min(edge.polyline.length - 2, Math.floor(t * (edge.polyline.length - 1)));
      const a = edge.polyline[idx];
      const b = edge.polyline[idx + 1];
      const dir = norm(sub(b, a));
      const sideSign = fringeRng.chance(0.5) ? 1 : -1;
      const n = mul(perp(dir), sideSign);
      const midPt = lerpVec(a, b, 0.5);

      const uVal = ctx.urbanityAt(midPt);
      if (ctx.isBuiltUp(midPt) || uVal < ribbonThresh || uVal >= builtThresh) continue;

      const uNorm = (uVal - ribbonThresh) / Math.max(0.05, builtThresh - ribbonThresh);
      const pKeep = clamp(0.25 + uNorm * 0.45, 0.2, 0.72) * ctx.params.ribbonDensity * 1.8;
      if (!fringeRng.chance(pKeep)) continue;

      const lotCenter = add(midPt, mul(n, 21));
      if (isInsideUrbanBlock(lotCenter) || ctx.isBuiltUp(lotCenter)) continue;
      if (ribbonAnchors.some((ra) => dist(ra, lotCenter) < 16)) continue;

      const nearD = findNearestDistrict(ctx.districts, lotCenter);
      const dt = fringeRng.chance(0.55) ? DwellingType.SemiDetached : DwellingType.Detached;
      const ok = placeSprawlBuilding(
        lotCenter,
        dir,
        n,
        15,
        24,
        dt === DwellingType.Detached ? 8.2 : 6.4,
        9.4,
        edge.id,
        edge.streetId,
        nearD.id,
        dt,
        BuildingKind.Residential,
        'ribbon'
      );
      if (ok) ribbonAnchors.push(lotCenter);
    }
  }

  // 2. Roadside Hamlets (short clusters along rural arterials outside built-up mask)
  const hamletCenters: Vec2[] = [];
  for (const edge of ctx.edges) {
    if (edge.roadClass !== RoadClass.Arterial || edge.length < 300) continue;
    const mid = edge.polyline[Math.floor(edge.polyline.length / 2)];
    if (ctx.distanceToBuiltUp(mid) < 110) continue;
    if (!fringeRng.chance(0.5)) continue;
    if (hamletCenters.some((hc) => dist(hc, mid) < 220)) continue;
    if (sprawlCount + 8 > maxSprawlBudget) break;

    const nearD = findNearestDistrict(ctx.districts, mid);
    const tangent = norm(sub(edge.polyline[edge.polyline.length - 1], edge.polyline[0]));
    const n = perp(tangent);
    hamletCenters.push(mid);

    const offsets = [-38, -18, 2, 22, 42];
    for (const sSide of [1, -1]) {
      for (const off of offsets) {
        const pt = add(add(mid, mul(tangent, off)), mul(n, sSide * 22));
        const dt = fringeRng.chance(0.6) ? DwellingType.Terraced : DwellingType.SemiDetached;
        placeSprawlBuilding(
          pt,
          tangent,
          mul(n, sSide),
          14,
          24,
          6.8,
          9.0,
          edge.id,
          edge.streetId,
          nearD.id,
          dt,
          BuildingKind.Residential,
          'hamlet'
        );
      }
    }
  }

  // 3. Greenbelt Farm Clusters (3-5 clusters on short lanes off arterials)
  const sprawlAddedNodes: GraphNode[] = [];
  const sprawlAddedEdges: GraphEdge[] = [];
  let nextFarmNodeId = ctx.nodes.reduce((m, n) => Math.max(m, n.id), -1) + 1;
  let nextFarmEdgeId = ctx.edges.reduce((m, e) => Math.max(m, e.id), -1) + 1;
  const farmCenters: Vec2[] = [];
  const desiredFarms = fringeRng.int(3, 5);
  const domB = polygonBounds(ctx.domainPolygon);

  for (let tries = 0; tries < 100 && farmCenters.length < desiredFarms; tries++) {
    if (sprawlCount + 4 > maxSprawlBudget) break;
    const artNodes = ctx.nodes.filter((n) =>
      n.edgeIds.some((eid) => {
        const ed = edgeById.get(eid);
        return ed && ed.roadClass <= RoadClass.Main;
      })
    );
    if (artNodes.length === 0) break;
    const baseN = fringeRng.pick(artNodes);
    const ang = fringeRng.range(0, Math.PI * 2);
    const rad = fringeRng.range(75, 220);
    const c = { x: baseN.pos.x + Math.cos(ang) * rad, y: baseN.pos.y + Math.sin(ang) * rad };
    if (!pointInPolygon(c, ctx.domainPolygon)) continue;
    if (ctx.distanceToBuiltUp(c) < 75) continue;
    if (farmCenters.some((fc) => dist(fc, c) < 200)) continue;
    if (hamletCenters.some((hc) => dist(hc, c) < 150)) continue;
    if (
      ctx.edges.some(
        (e) =>
          distancePolylineToPolygon(e.polyline, [c, add(c, { x: 1, y: 0 }), add(c, { x: 0, y: 1 })]) <
          48
      )
    ) {
      continue;
    }

    const bestNode = baseN;
    const laneMid = lerpVec(bestNode.pos, c, 0.88);
    const crossesOther = ctx.edges.some((e) => {
      if (e.nodeA === bestNode.id || e.nodeB === bestNode.id) return false;
      for (let k = 1; k < e.polyline.length; k++) {
        if (segmentIntersection(bestNode.pos, laneMid, e.polyline[k - 1], e.polyline[k], 1e-3)) {
          return true;
        }
      }
      return false;
    });
    if (crossesOther) continue;

    const farmNodeId = nextFarmNodeId++;
    const farmEdgeId = nextFarmEdgeId++;
    const lanePoly = [bestNode.pos, laneMid];
    const farmNode: GraphNode = { id: farmNodeId, pos: laneMid, edgeIds: [farmEdgeId] };
    const farmEdge: GraphEdge = {
      id: farmEdgeId,
      nodeA: bestNode.id,
      nodeB: farmNodeId,
      streetId: -1,
      traceId: 9900 + farmCenters.length,
      roadClass: RoadClass.Lane,
      speedKph: ROAD_SPEED_KPH[RoadClass.Lane],
      isCulDeSac: true,
      polyline: lanePoly,
      length: dist(bestNode.pos, laneMid),
    };
    bestNode.edgeIds.push(farmEdgeId);
    sprawlAddedNodes.push(farmNode);
    sprawlAddedEdges.push(farmEdge);
    edgeById.set(farmEdgeId, farmEdge);
    ctx.edges.push(farmEdge);
    ctx.nodes.push(farmNode);
    const feb = polygonBounds(lanePoly);
    sprawlEdgeHash.insertBounds(feb.minX - 6, feb.minY - 6, feb.maxX + 6, feb.maxY + 6, laneMid, farmEdge);

    const dir = norm(sub(laneMid, bestNode.pos));
    const n = perp(dir);
    const nearD = findNearestDistrict(ctx.districts, c);

    const slots: Array<{ offF: number; offN: number; w: number; d: number; kind: BuildingKind }> = [
      { offF: 18, offN: 14, w: 10, d: 11, kind: BuildingKind.Residential },
      { offF: 18, offN: -16, w: 12, d: 8, kind: BuildingKind.Other },
      { offF: -4, offN: 16, w: 9, d: 13, kind: BuildingKind.Other },
    ];
    let placedAny = false;
    for (const sl of slots) {
      const pt = add(add(laneMid, mul(dir, sl.offF)), mul(n, sl.offN));
      const ok = placeSprawlBuilding(
        pt,
        dir,
        norm(sub(pt, laneMid)),
        18,
        20,
        sl.w,
        sl.d,
        farmEdgeId,
        -1,
        nearD.id,
        sl.kind === BuildingKind.Residential ? DwellingType.Detached : null,
        sl.kind,
        'farm'
      );
      if (ok) placedAny = true;
    }
    if (placedAny) farmCenters.push(c);
  }

  // Run M1 spatial-hash footprint/road/site repair pass
  const repairedBuildings = repairBuildingsPass(buildings, lots, ctx.edges, ctx.venueSites);

  return {
    lots,
    buildings: repairedBuildings,
    sprawlAddedNodes,
    sprawlAddedEdges,
  };
}

function buildGreenbeltFieldsAndWoods(ctx: GenContext): {
  fields: FieldPolygon[];
  woodlands: Vec2[][];
  hedgerows: Array<[Vec2, Vec2]>;
  treeClusters: TreeCluster[];
} {
  const fringeRng = SeededRng.fromStage(ctx.params.seed, 'fields');
  const domB = polygonBounds(ctx.domainPolygon);

  const sprawlEdgeHash = new SpatialHash<GraphEdge>(55);
  for (const e of ctx.edges) {
    const eb = polygonBounds(e.polyline);
    const pad = ROAD_HALF_WIDTH[e.roadClass] + 10;
    sprawlEdgeHash.insertBounds(eb.minX - pad, eb.minY - pad, eb.maxX + pad, eb.maxY + pad, e.polyline[0], e);
  }
  const sprawlBldHash = new SpatialHash<Building>(45);
  for (const b of ctx.buildings) {
    const bb = polygonBounds(b.footprint);
    sprawlBldHash.insertBounds(bb.minX - 6, bb.minY - 6, bb.maxX + 6, bb.maxY + 6, b.centroid, b);
  }

  const fields: FieldPolygon[] = [];
  const hedgerows: Array<[Vec2, Vec2]> = [];
  const woodlands: Vec2[][] = [];
  const treeClusters: TreeCluster[] = [];

  // Build exact exclusion masks with bounds for fast per-cell filtering
  const clipEntries: Array<{ poly: Vec2[]; bounds: ReturnType<typeof polygonBounds> }> = [];
  const addClip = (poly: Vec2[]) => {
    if (poly.length >= 3 && polygonArea(poly) >= 1) {
      clipEntries.push({ poly, bounds: polygonBounds(poly) });
    }
  };

  for (const bp of bufferMultiPolygonOutward(ctx.builtUpPolygons, 16.0)) addClip(bp);
  for (const e of ctx.edges) {
    for (const rbp of bufferPolyline(e.polyline, ROAD_HALF_WIDTH[e.roadClass] + 6.5)) addClip(rbp);
  }
  for (const b of ctx.buildings) {
    if (!b.isFringe && ctx.isBuiltUp(b.centroid)) continue;
    for (const bfp of bufferMultiPolygonOutward([b.footprint], 2.5)) addClip(bfp);
  }

  const queryLocalClips = (targetPoly: Vec2[]): Vec2[][] => {
    const tb = polygonBounds(targetPoly);
    const out: Vec2[][] = [];
    for (const c of clipEntries) {
      if (boundsOverlap(tb, c.bounds, 0.5)) out.push(c.poly);
    }
    return out;
  };

  // Sample 34-46 jittered points at 125-160 m spacing in non-built-up greenbelt near roads/town
  const fieldSeeds: Vec2[] = [];
  const gridStep = 142;
  const candGridPts: Vec2[] = [];
  for (let gx = domB.minX + 80; gx <= domB.maxX - 80; gx += gridStep) {
    for (let gy = domB.minY + 80; gy <= domB.maxY - 80; gy += gridStep) {
      const p = {
        x: gx + fringeRng.range(-gridStep * 0.34, gridStep * 0.34),
        y: gy + fringeRng.range(-gridStep * 0.34, gridStep * 0.34),
      };
      if (!pointInPolygon(p, ctx.domainPolygon)) continue;
      if (ctx.distanceToBuiltUp(p) < 35) continue;
      const dSpine = distToNearestPolyline(ctx.arterialPolylines, p);
      if (dSpine < 35 || dSpine > 560) continue;
      if (sprawlBldHash.hasWithin(p, 26)) continue;
      if (
        sprawlEdgeHash
          .queryBounds(p.x - 16, p.y - 16, p.x + 16, p.y + 16)
          .some((e) => distPointToPolyline(p, e.polyline).dist < ROAD_HALF_WIDTH[e.roadClass] + 12)
      ) {
        continue;
      }
      candGridPts.push(p);
    }
  }
  fringeRng.shuffle(candGridPts);
  for (const p of candGridPts) {
    if (fieldSeeds.length >= 44) break;
    if (fieldSeeds.some((fs) => dist(fs, p) < 115)) continue;
    fieldSeeds.push(p);
  }

  if (fieldSeeds.length >= 4) {
    const rawCells = computeVoronoiCells(fieldSeeds, ctx.domainPolygon);
    const localPocketCap = 175;
    const candidateFields: FieldPolygon[] = [];

    for (let i = 0; i < rawCells.length; i++) {
      const seedPt = fieldSeeds[i];
      let boundedCell = rawCells[i];
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        const nrm = { x: -Math.cos(ang), y: -Math.sin(ang) };
        const planePt = {
          x: seedPt.x + Math.cos(ang) * localPocketCap,
          y: seedPt.y + Math.sin(ang) * localPocketCap,
        };
        boundedCell = clipPolygonByHalfPlane(boundedCell, planePt, nrm);
        if (boundedCell.length < 3) break;
      }
      if (boundedCell.length < 3) continue;

      const localClips = queryLocalClips(boundedCell);
      const clippedParts = differenceMultiPolygons([boundedCell], localClips);
      for (const part of clippedParts) {
        const area = polygonArea(part);
        if (area < 2400) continue;

        const b = polygonBounds(part);
        const nearEdges = sprawlEdgeHash.queryBounds(b.minX - 18, b.minY - 18, b.maxX + 18, b.maxY + 18);
        const hitsRoad = nearEdges.some(
          (e) => distancePolylineToPolygon(e.polyline, part) < ROAD_HALF_WIDTH[e.roadClass] + 6.0
        );
        if (hitsRoad) continue;

        const nearBlds = sprawlBldHash.queryBounds(b.minX - 4, b.minY - 4, b.maxX + 4, b.maxY + 4);
        const hitsBld = nearBlds.some(
          (bld) => polygonIntersectionArea(bld.footprint, part) > 0.05
        );
        if (hitsBld) continue;

        let hitsBuilt = false;
        for (const bp of ctx.builtUpPolygons) {
          if (minDistancePolygons(part, bp) < 15.0) {
            hitsBuilt = true;
            break;
          }
        }
        if (hitsBuilt) continue;

        const fc = polygonCentroid(part);
        let nearestRoadAng = 0;
        let nearestRoadD = Infinity;
        for (const e of ctx.edges) {
          const res = distPointToPolyline(fc, e.polyline);
          if (res.dist < nearestRoadD) {
            nearestRoadD = res.dist;
            nearestRoadAng = Math.atan2(res.tangent.y, res.tangent.x);
          }
        }
        const hatchAngle = nearestRoadAng + fringeRng.range(-0.12, 0.12);
        candidateFields.push({
          id: candidateFields.length,
          polygon: part,
          angle: hatchAngle,
        });
      }
    }

    candidateFields.sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon));
    const maxFields = Math.min(36, candidateFields.length);
    for (let i = 0; i < maxFields; i++) {
      const f = candidateFields[i];
      fields.push({ id: fields.length, polygon: f.polygon, angle: f.angle });
      for (let k = 0; k < f.polygon.length; k++) {
        const p0 = f.polygon[k];
        const p1 = f.polygon[(k + 1) % f.polygon.length];
        const mid = lerpVec(p0, p1, 0.5);
        const touchesRoad = ctx.edges.some(
          (e) => distPointToPolyline(mid, e.polyline).dist <= ROAD_HALF_WIDTH[e.roadClass] + 10.5
        );
        if (touchesRoad || fringeRng.chance(0.42)) {
          hedgerows.push([p0, p1]);
        }
      }
    }

    for (let i = maxFields; i < candidateFields.length && woodlands.length < 5; i++) {
      const part = candidateFields[i].polygon;
      if (polygonArea(part) > 2200) {
        woodlands.push(part);
      }
    }
  }

  for (let i = 0; i < 36 && woodlands.length < 8; i++) {
    const px = fringeRng.range(domB.minX + 120, domB.maxX - 120);
    const py = fringeRng.range(domB.minY + 120, domB.maxY - 120);
    const c = { x: px, y: py };
    if (!pointInPolygon(c, ctx.domainPolygon)) continue;
    if (ctx.distanceToBuiltUp(c) < 55) continue;
    if (sprawlBldHash.hasWithin(c, 70)) continue;
    if (fields.some((f) => pointInPolygon(c, f.polygon) || dist(polygonCentroid(f.polygon), c) < 70)) continue;
    const wR = fringeRng.range(38, 66);
    const rawWood = makeOrganicCopse(c, wR, ctx.noise, i * 2.1, -i * 1.7, 16);
    const wbRaw = polygonBounds(rawWood);
    const localWoodClips = [
      ...queryLocalClips(rawWood),
      ...fields.filter((f) => boundsOverlap(wbRaw, polygonBounds(f.polygon), 0.5)).map((f) => f.polygon),
    ];
    const clippedWood = differenceMultiPolygons([rawWood], localWoodClips);
    for (const wood of clippedWood) {
      if (polygonArea(wood) < 1200 || woodlands.length >= 8) continue;
      woodlands.push(wood);
      const trees: Array<{ x: number; y: number; r: number }> = [];
      const wb = polygonBounds(wood);
      for (let t = 0; t < 38 && trees.length < 18; t++) {
        const pt = { x: fringeRng.range(wb.minX + 3, wb.maxX - 3), y: fringeRng.range(wb.minY + 3, wb.maxY - 3) };
        if (pointInPolygon(pt, wood)) trees.push({ x: pt.x, y: pt.y, r: fringeRng.range(3.2, 5.8) });
      }
      if (trees.length > 0) treeClusters.push({ id: treeClusters.length, center: polygonCentroid(wood), trees });
    }
  }

  for (let wIdx = 0; wIdx < woodlands.length; wIdx++) {
    if (wIdx < treeClusters.length) continue;
    const wood = woodlands[wIdx];
    const trees: Array<{ x: number; y: number; r: number }> = [];
    const wb = polygonBounds(wood);
    for (let t = 0; t < 38 && trees.length < 16; t++) {
      const pt = { x: fringeRng.range(wb.minX + 3, wb.maxX - 3), y: fringeRng.range(wb.minY + 3, wb.maxY - 3) };
      if (pointInPolygon(pt, wood)) trees.push({ x: pt.x, y: pt.y, r: fringeRng.range(3.2, 5.8) });
    }
    if (trees.length > 0) treeClusters.push({ id: treeClusters.length, center: polygonCentroid(wood), trees });
  }

  for (const blk of ctx.blocks) {
    if (blk.kind === BlockKind.Green) {
      const c = polygonCentroid(blk.polygon);
      const count = Math.min(20, Math.max(3, Math.floor(blk.area / 360)));
      const trees: Array<{ x: number; y: number; r: number }> = [];
      const b = polygonBounds(blk.polygon);
      for (let t = 0; t < count * 3 && trees.length < count; t++) {
        const pt = {
          x: fringeRng.range(b.minX + 3, b.maxX - 3),
          y: fringeRng.range(b.minY + 3, b.maxY - 3),
        };
        if (pointInPolygon(pt, blk.polygon)) {
          trees.push({ x: pt.x, y: pt.y, r: fringeRng.range(2.8, 5.2) });
        }
      }
      if (trees.length > 0) {
        treeClusters.push({ id: treeClusters.length, center: c, trees });
      }
    }
  }

  return { fields, woodlands, hedgerows, treeClusters };
}

export function runStageLotsAndFitting(ctx: GenContext): void {
  const t0 = nowMs();
  const preset = PRESET_CONFIGS[ctx.params.preset];
  const [minB, maxB] = ctx.params.targetBuildings;
  const idealMid = (minB + maxB) * 0.5;

  const baseBlockCount = ctx.blocks.length;
  const baseNodeCount = ctx.nodes.length;
  const baseEdgeCount = ctx.edges.length;
  const baseEdgeIdsPerNode = ctx.nodes.map((n) => [...n.edgeIds]);

  let widthScale = preset.lotWidthScale * 0.96;
  let bestResult: ReturnType<typeof generateLotsBuildingsAndSprawlPass> | null = null;
  let bestBlocksSnapshot: Block[] = ctx.blocks.slice(0, baseBlockCount);
  let bestNodesSnapshot: GraphNode[] = [];
  let bestEdgesSnapshot: GraphEdge[] = [];
  let bestDelta = Infinity;
  let attempts = 0;

  for (let attempt = 0; attempt < 5; attempt++) {
    attempts++;
    ctx.blocks = ctx.blocks.slice(0, baseBlockCount);
    ctx.nodes.length = baseNodeCount;
    ctx.edges.length = baseEdgeCount;
    for (let i = 0; i < baseNodeCount; i++) {
      ctx.nodes[i].edgeIds = [...baseEdgeIdsPerNode[i]];
    }

    const res = generateLotsBuildingsAndSprawlPass(ctx, widthScale, attempt * 19);
    const count = res.buildings.length;
    const inRange = count >= minB && count <= maxB;
    const delta = inRange ? 0 : Math.abs(count - idealMid);

    if (delta < bestDelta || bestResult === null) {
      bestDelta = delta;
      bestResult = res;
      bestBlocksSnapshot = [...ctx.blocks];
      bestNodesSnapshot = ctx.nodes.map((n) => ({ ...n, edgeIds: [...n.edgeIds] }));
      bestEdgesSnapshot = [...ctx.edges];
    }

    if (inRange) break;

    const ratio = count / Math.max(1, idealMid);
    const step = clamp(Math.pow(ratio, 0.65), 0.72, 1.38);
    widthScale = clamp(widthScale * step, 0.58, 1.85);
  }

  if (bestResult) {
    ctx.blocks = bestBlocksSnapshot;
    ctx.nodes = bestNodesSnapshot;
    ctx.edges = bestEdgesSnapshot;
    ctx.lots = bestResult.lots;
    ctx.buildings = bestResult.buildings;
  }

  const greenbelt = buildGreenbeltFieldsAndWoods(ctx);
  ctx.fields = greenbelt.fields;
  ctx.woodlands = greenbelt.woodlands;
  ctx.hedgerows = greenbelt.hedgerows;
  ctx.treeClusters = greenbelt.treeClusters;

  ctx.fittingAttempts = attempts;
  if (ctx.buildings.length < minB || ctx.buildings.length > maxB) {
    ctx.fittingWarning = `Building count ${ctx.buildings.length} outside [${minB}, ${maxB}] after ${attempts} attempts`;
  } else {
    ctx.fittingWarning = null;
  }

  ctx.diagnostics.push({
    stage: 'Stage 7-9 · Lots, Sprawl & Fitting',
    durationMs: nowMs() - t0,
    summary: `${ctx.lots.length} lots, ${ctx.buildings.length} buildings in ${attempts} attempt(s)`,
  });
}

// ---------------------------------------------------------------------------
// Stage 10: Streets & Odd/Even Addressing
// ---------------------------------------------------------------------------
export function runStageStreetsAndAddresses(ctx: GenContext): void {
  const t0 = nowMs();
  const rng = SeededRng.fromStage(ctx.params.seed, 'streets_addresses');

  const edgesByTrace = new Map<number, GraphEdge[]>();
  for (const e of ctx.edges) {
    let arr = edgesByTrace.get(e.traceId);
    if (!arr) {
      arr = [];
      edgesByTrace.set(e.traceId, arr);
    }
    arr.push(e);
  }

  const streets: Street[] = [];
  const usedNames = new Set<string>();
  const shuffledRoots = rng.shuffle([...UK_STREET_ROOTS]);
  let rootCursor = 0;

  const oldTown = ctx.districts.find((d) => d.archetype === DistrictArchetype.OldTown);
  const stationDist = ctx.districts.find(
    (d) => d.archetype === DistrictArchetype.StationIndustrial
  );

  const chains: Array<{ edges: GraphEdge[]; roadClass: RoadClass; isCulDeSac: boolean; traceId: number }> = [];
  for (const [traceId, edgeGroup] of edgesByTrace.entries()) {
    const remaining = new Set(edgeGroup);
    while (remaining.size > 0) {
      const seedEdge = remaining.values().next().value!;
      remaining.delete(seedEdge);
      const comp: GraphEdge[] = [seedEdge];
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const cand of Array.from(remaining)) {
          const sharesNode = comp.some(
            (ce) =>
              ce.nodeA === cand.nodeA ||
              ce.nodeA === cand.nodeB ||
              ce.nodeB === cand.nodeA ||
              ce.nodeB === cand.nodeB
          );
          if (sharesNode) {
            comp.push(cand);
            remaining.delete(cand);
            expanded = true;
          }
        }
      }
      const roadClass = comp.reduce(
        (minC, e) => Math.min(minC, e.roadClass) as RoadClass,
        RoadClass.Lane
      );
      const isCulDeSac = comp.every((e) => e.isCulDeSac);
      chains.push({ edges: comp, roadClass, isCulDeSac, traceId });
    }
  }

  let highStreetIdx = -1;
  let bestHighScore = -Infinity;
  let stationRoadIdx = -1;
  let bestStationScore = -Infinity;

  for (let i = 0; i < chains.length; i++) {
    const ch = chains[i];
    const totalLen = ch.edges.reduce((acc, e) => acc + e.length, 0);
    const pts = ch.edges.flatMap((e) => e.polyline);
    const mid = pts[Math.floor(pts.length / 2)] ?? { x: 0, y: 0 };

    if ((ch.roadClass === RoadClass.Arterial || ch.roadClass === RoadClass.Main) && oldTown) {
      const inOld = pts.some((p) => pointInPolygon(p, oldTown.polygon));
      const coreNodePos = ctx.settlementNodes[0]?.pos ?? { x: 0, y: 0 };
      const preferArterial = ch.roadClass === RoadClass.Arterial ? 240 : 0;
      const score = (inOld ? 500 : 0) + preferArterial + totalLen - dist(mid, coreNodePos);
      if (score > bestHighScore) {
        bestHighScore = score;
        highStreetIdx = i;
      }
    }

    if (ch.roadClass <= RoadClass.Secondary && stationDist && i !== highStreetIdx) {
      const inStation = pts.some((p) => pointInPolygon(p, stationDist.polygon));
      const score = (inStation ? 400 : 0) + totalLen;
      if (score > bestStationScore) {
        bestStationScore = score;
        stationRoadIdx = i;
      }
    }
  }

  const nextStreetName = (roadClass: RoadClass, isCulDeSac: boolean): string => {
    const suffixes = isCulDeSac
      ? ['Close', 'Court', 'Mews']
      : roadClass === RoadClass.Arterial
      ? ['Way', 'Bypass', 'Road', 'Ringway']
      : roadClass === RoadClass.Main
      ? ['Road', 'Street', 'Way']
      : roadClass === RoadClass.Secondary
      ? ['Street', 'Avenue', 'Drive', 'Terrace']
      : ['Lane', 'Walk', 'Alley', 'Passage'];

    for (let tries = 0; tries < 500; tries++) {
      const root = shuffledRoots[rootCursor % shuffledRoots.length];
      rootCursor++;
      const suffix = suffixes[tries % suffixes.length];
      const name = `${root} ${suffix}`;
      if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
      }
    }
    const fallback = `Charter Way ${usedNames.size + 1}`;
    usedNames.add(fallback);
    return fallback;
  };

  const nodeMap = new Map<number, GraphNode>();
  for (const n of ctx.nodes) nodeMap.set(n.id, n);

  for (let i = 0; i < chains.length; i++) {
    const ch = chains[i];
    let name: string;
    if (i === highStreetIdx && !usedNames.has('High Street')) {
      name = 'High Street';
      usedNames.add(name);
    } else if (i === stationRoadIdx && !usedNames.has('Station Road')) {
      name = 'Station Road';
      usedNames.add(name);
    } else {
      name = nextStreetName(ch.roadClass, ch.isCulDeSac);
    }

    const ordered = [...ch.edges];
    if (ordered.length > 1) {
      const remaining = new Set(ordered);
      const nodeDeg = new Map<number, number>();
      for (const e of ordered) {
        nodeDeg.set(e.nodeA, (nodeDeg.get(e.nodeA) ?? 0) + 1);
        nodeDeg.set(e.nodeB, (nodeDeg.get(e.nodeB) ?? 0) + 1);
      }
      const endpoints = ordered.filter(
        (e) => (nodeDeg.get(e.nodeA) ?? 0) === 1 || (nodeDeg.get(e.nodeB) ?? 0) === 1
      );
      let startEdge = ordered[0];
      if (endpoints.length > 0) {
        startEdge = endpoints.reduce((best, e) => {
          const dBest = Math.min(
            Math.hypot(nodeMap.get(best.nodeA)!.pos.x, nodeMap.get(best.nodeA)!.pos.y),
            Math.hypot(nodeMap.get(best.nodeB)!.pos.x, nodeMap.get(best.nodeB)!.pos.y)
          );
          const dE = Math.min(
            Math.hypot(nodeMap.get(e.nodeA)!.pos.x, nodeMap.get(e.nodeA)!.pos.y),
            Math.hypot(nodeMap.get(e.nodeB)!.pos.x, nodeMap.get(e.nodeB)!.pos.y)
          );
          return dE < dBest ? e : best;
        });
      }

      ordered.length = 0;
      ordered.push(startEdge);
      remaining.delete(startEdge);
      const firstPosA = nodeMap.get(startEdge.nodeA)!.pos;
      const firstPosB = nodeMap.get(startEdge.nodeB)!.pos;
      let currNode =
        Math.hypot(firstPosA.x, firstPosA.y) <= Math.hypot(firstPosB.x, firstPosB.y)
          ? startEdge.nodeB
          : startEdge.nodeA;

      while (remaining.size > 0) {
        let found: GraphEdge | null = null;
        for (const cand of remaining) {
          if (cand.nodeA === currNode || cand.nodeB === currNode) {
            found = cand;
            break;
          }
        }
        if (!found) break;
        ordered.push(found);
        remaining.delete(found);
        currNode = found.nodeA === currNode ? found.nodeB : found.nodeA;
      }
      for (const leftover of remaining) ordered.push(leftover);
    }

    const polyline: Vec2[] = [];
    for (let k = 0; k < ordered.length; k++) {
      const e = ordered[k];
      const pts = [...e.polyline];
      if (k === 0) {
        if (
          Math.hypot(pts[pts.length - 1].x, pts[pts.length - 1].y) <
          Math.hypot(pts[0].x, pts[0].y)
        ) {
          pts.reverse();
        }
      } else {
        const lastPt = polyline[polyline.length - 1];
        if (dist(lastPt, pts[pts.length - 1]) < dist(lastPt, pts[0])) {
          pts.reverse();
        }
      }
      for (const p of pts) {
        if (polyline.length === 0 || dist(polyline[polyline.length - 1], p) > 0.2) {
          polyline.push(p);
        }
      }
    }

    const streetId = streets.length;
    for (const e of ordered) {
      e.streetId = streetId;
    }

    streets.push({
      id: streetId,
      name,
      roadClass: ch.roadClass,
      speedKph: ROAD_SPEED_KPH[ch.roadClass],
      isCulDeSac: ch.isCulDeSac,
      edgeIds: ordered.map((e) => e.id),
      traceIds: [ch.traceId],
      polyline,
    });
  }

  const edgeById = new Map<number, GraphEdge>();
  for (const e of ctx.edges) edgeById.set(e.id, e);
  const lotById = new Map<number, Lot>();
  for (const l of ctx.lots) {
    const e = edgeById.get(l.edgeId);
    if (e) l.streetId = e.streetId;
    lotById.set(l.id, l);
  }
  for (const b of ctx.buildings) {
    const l = lotById.get(b.lotId);
    if (l) b.address.streetId = l.streetId;
    else {
      const e = edgeById.get(b.entranceEdgeId);
      if (e) b.address.streetId = e.streetId;
    }
  }

  const streetById = new Map<number, Street>();
  for (const s of streets) streetById.set(s.id, s);

  const buildingsByStreet = new Map<number, Building[]>();
  for (const b of ctx.buildings) {
    let arr = buildingsByStreet.get(b.address.streetId);
    if (!arr) {
      arr = [];
      buildingsByStreet.set(b.address.streetId, arr);
    }
    arr.push(b);
  }

  for (const [sid, blds] of buildingsByStreet.entries()) {
    const st = streetById.get(sid);
    if (!st || st.polyline.length < 2) continue;

    const leftSide: Array<{ b: Building; t: number }> = [];
    const rightSide: Array<{ b: Building; t: number }> = [];

    for (const b of blds) {
      let bestDist = Infinity;
      let bestT = 0;
      let bestSide: 'left' | 'right' = 'left';
      let accLen = 0;

      for (let i = 1; i < st.polyline.length; i++) {
        const p0 = st.polyline[i - 1];
        const p1 = st.polyline[i];
        const segLen = dist(p0, p1);
        const res = pointToSegment(b.centroid, p0, p1);
        if (res.dist < bestDist) {
          bestDist = res.dist;
          bestT = accLen + res.t * segLen;
          const dir = sub(p1, p0);
          const toB = sub(b.centroid, res.proj);
          bestSide = cross(dir, toB) >= 0 ? 'left' : 'right';
        }
        accLen += segLen;
      }

      const lot = lotById.get(b.lotId);
      if (lot) lot.side = bestSide;
      if (bestSide === 'left') leftSide.push({ b, t: bestT });
      else rightSide.push({ b, t: bestT });
    }

    leftSide.sort((a, b) => a.t - b.t);
    rightSide.sort((a, b) => a.t - b.t);

    leftSide.forEach((item, idx) => {
      item.b.address = { streetId: sid, number: idx * 2 + 1, unitLabel: '' };
      item.b.addressString = formatAddress(item.b.address, streetById);
    });
    rightSide.forEach((item, idx) => {
      item.b.address = { streetId: sid, number: (idx + 1) * 2, unitLabel: '' };
      item.b.addressString = formatAddress(item.b.address, streetById);
    });
  }

  ctx.streets = streets;
  ctx.diagnostics.push({
    stage: 'Stage 10 · Streets & Addressing',
    durationMs: nowMs() - t0,
    summary: `${streets.length} uniquely named streets, ${ctx.buildings.length} addressed buildings`,
  });
}

// ---------------------------------------------------------------------------
// Stage 11: Retail Clustering, Frontage Shops & DBSCAN (Isolated 'retail' RNG!)
// ---------------------------------------------------------------------------
export function runStageRetailAndFrontageVenues(ctx: GenContext): void {
  const t0 = nowMs();
  // Isolated RNG stream — changing retailClusterStrength must NOT change streets or residential geometry!
  const rng = SeededRng.fromStage(ctx.params.seed, 'retail');
  const strength = ctx.params.retailClusterStrength;

  const districtsById = new Map<number, District>();
  for (const d of ctx.districts) districtsById.set(d.id, d);
  const streetsById = new Map<number, Street>();
  for (const s of ctx.streets) streetsById.set(s.id, s);
  const edgesById = new Map<number, GraphEdge>();
  for (const e of ctx.edges) edgesById.set(e.id, e);
  const lotsById = new Map<number, Lot>();
  for (const l of ctx.lots) lotsById.set(l.id, l);
  const defById = new Map<string, VenueDef>();
  for (const d of VENUE_DEFS) defById.set(d.id, d);

  const nameCursors = new Map<string, number>();
  const getVenueDisplayName = (def: VenueDef): string => {
    const variants = VENUE_NAMED_VARIANTS[def.id];
    if (!variants || variants.length === 0) return def.displayName;
    const idx = nameCursors.get(def.id) ?? 0;
    nameCursors.set(def.id, idx + 1);
    return variants[idx % variants.length];
  };

  const venues: Venue[] = [];
  const usedBuildingIds = new Set<number>();
  const usedBlockIds = new Set<number>();

  // 1. Register buildings created by Stage 6b reserved VenueSites
  const bldByLotId = new Map<number, Building>();
  for (const b of ctx.buildings) bldByLotId.set(b.lotId, b);

  for (const vs of ctx.venueSites) {
    const lot = ctx.lots.find((l) => polygonIntersectionArea(l.polygon, vs.sitePolygon) > 10 && dist(l.frontageMidpoint, vs.entrancePos) < 2);
    const bld = lot ? bldByLotId.get(lot.id) : ctx.buildings.find((b) => dist(b.entrancePos, vs.entrancePos) < 1);
    if (!bld) continue;
    const def = defById.get(vs.defId)!;
    const venueId = venues.length;
    vs.venueId = venueId;
    bld.kind = BuildingKind.Venue;
    bld.venueId = venueId;
    bld.dwellingType = null;
    usedBuildingIds.add(bld.id);

    venues.push({
      id: venueId,
      defId: def.id,
      name: getVenueDisplayName(def),
      category: def.category,
      retailGroup: def.retailGroup,
      siteType: def.siteType,
      buildingId: bld.id,
      siteId: vs.id,
      clusterId: null,
      blockId: bld.blockId,
      districtId: bld.districtId,
      address: bld.address,
      addressString: bld.addressString,
      entrancePos: bld.entrancePos,
      entranceEdgeId: bld.entranceEdgeId,
      pos: bld.centroid,
      catalogW: vs.catalogW,
      catalogD: vs.catalogD,
    });
  }

  // 2. Green / Park venues
  const parkDefs = VENUE_DEFS.filter((d) => d.siteType === 'green');
  for (const def of parkDefs) {
    const count = rng.int(def.countRange[0], def.countRange[1]);
    for (let k = 0; k < count; k++) {
      let bestBlock: Block | null = null;
      let bestScore = -Infinity;
      for (const blk of ctx.blocks) {
        if (blk.kind !== BlockKind.Green || usedBlockIds.has(blk.id)) continue;
        const distObj = districtsById.get(blk.districtId);
        const distMatch = distObj && def.requiredDistrictTags.includes(distObj.archetype) ? 1.0 : 0.2;
        const c = polygonCentroid(blk.polygon);
        const spacingPenalty = venues.some((v) => dist(v.pos, c) < def.minSpacing) ? 2.0 : 0;
        const score = distMatch * 2.5 + Math.min(1.5, blk.area / 3000) - spacingPenalty + rng.range(0, 0.3);
        if (score > bestScore) {
          bestScore = score;
          bestBlock = blk;
        }
      }
      if (bestBlock) {
        usedBlockIds.add(bestBlock.id);
        const c = polygonCentroid(bestBlock.polygon);
        let bestEdge = ctx.edges[0];
        let bestProj = c;
        let bestD = Infinity;
        for (const e of ctx.edges) {
          for (let i = 1; i < e.polyline.length; i++) {
            const res = pointToSegment(c, e.polyline[i - 1], e.polyline[i]);
            if (res.dist < bestD) {
              bestD = res.dist;
              bestEdge = e;
              bestProj = res.proj;
            }
          }
        }
        const streetName = streetsById.get(bestEdge.streetId)?.name ?? 'Park Road';
        venues.push({
          id: venues.length,
          defId: def.id,
          name: k === 0 ? def.displayName : `${def.displayName} ${k + 1}`,
          category: def.category,
          retailGroup: def.retailGroup,
          siteType: 'green',
          buildingId: null,
          siteId: null,
          clusterId: null,
          blockId: bestBlock.id,
          districtId: bestBlock.districtId,
          address: { streetId: bestEdge.streetId, number: 0, unitLabel: '' },
          addressString: streetName,
          entrancePos: bestProj,
          entranceEdgeId: bestEdge.id,
          pos: c,
          catalogW: 0,
          catalogD: 0,
        });
      }
    }
  }

  // SpatialHashes for fast Stage 11 clearance & neighbor checks (~50x speedup)
  const edgeHash = new SpatialHash<GraphEdge>(55);
  for (const e of ctx.edges) {
    const eb = polygonBounds(e.polyline);
    const pad = ROAD_HALF_WIDTH[e.roadClass] + 3;
    edgeHash.insertBounds(eb.minX - pad, eb.minY - pad, eb.maxX + pad, eb.maxY + pad, e.polyline[0], e);
  }
  const siteHash = new SpatialHash<VenueSite>(75);
  for (const vs of ctx.venueSites) {
    const sb = polygonBounds(vs.sitePolygon);
    siteHash.insertBounds(sb.minX - 2, sb.minY - 2, sb.maxX + 2, sb.maxY + 2, vs.entrancePos, vs);
  }
  const bldHash = new SpatialHash<Building>(40);
  for (const b of ctx.buildings) {
    const bb = polygonBounds(b.footprint);
    bldHash.insertBounds(bb.minX - 2, bb.minY - 2, bb.maxX + 2, bb.maxY + 2, b.centroid, b);
  }

  // Helper: fit a shop footprint inside an existing lot, verifying catalog size, site clearance & live building hash
  const tryConvertBuildingToShop = (
    bld: Building,
    def: VenueDef
  ): { ok: boolean; w: number; d: number } => {
    const lot = lotsById.get(bld.lotId);
    if (!lot) return { ok: false, w: 0, d: 0 };

    const widthCandidates = def.footprint.wMax
      ? [rng.range(def.footprint.w, def.footprint.wMax), def.footprint.w, 6.0, 5.5]
      : [def.footprint.w, Math.max(5.4, def.footprint.w * 0.91)];
    const dims: Array<[number, number]> = [];
    for (const w of widthCandidates) {
      dims.push([w, def.footprint.d]);
      dims.push([def.footprint.d, w]);
    }
    if (def.footprint.d > 10) {
      dims.push(
        [6, 10],
        [10, 6],
        [6.5, 10.5],
        [10.5, 6.5],
        [5.5, 13.8],
        [13.8, 5.5],
        [5.0, 14.0],
        [14.0, 5.0],
        [5.2, 13.5],
        [13.5, 5.2],
        [8.0, 9.0],
        [9.0, 8.0],
        [4.8, 13.8],
        [13.8, 4.8]
      );
    }

    for (const [tryW, tryD] of dims) {
      const fp = makeFootprintInsideLot(lot.polygon, lot.frontageEdge, tryW, tryD, rng, true);
      if (!fp) continue;

      const bb = polygonBounds(fp);
      const nearEdges = edgeHash.queryBounds(bb.minX - 8, bb.minY - 8, bb.maxX + 8, bb.maxY + 8);
      const tooCloseRoad = nearEdges.some((e) => {
        const req = ROAD_HALF_WIDTH[e.roadClass] + 1.05;
        return distancePolylineToPolygon(e.polyline, fp) < req;
      });
      if (tooCloseRoad) continue;

      const nearSites = siteHash.queryBounds(bb.minX - 1, bb.minY - 1, bb.maxX + 1, bb.maxY + 1);
      const overlapsSite = nearSites.some((vs) => polygonIntersectionArea(vs.sitePolygon, fp) > 0.01);
      if (overlapsSite) continue;

      const nearBlds = bldHash.queryBounds(bb.minX - 1, bb.minY - 1, bb.maxX + 1, bb.maxY + 1);
      const overlapsBld = nearBlds.some(
        (other) => other.id !== bld.id && polygonIntersectionArea(other.footprint, fp) > 0.01
      );
      if (overlapsBld) continue;

      const actualArea = polygonArea(fp);
      const targetArea = tryW * tryD;
      if (Math.abs(actualArea - targetArea) / targetArea > 0.095) continue;

      bld.footprint = fp;
      bld.centroid = polygonCentroid(fp);
      bld.kind = BuildingKind.Venue;
      bld.dwellingType = null;
      // Register updated expanded footprint into bldHash immediately so subsequent conversions see it!
      bldHash.insertBounds(bb.minX - 2, bb.minY - 2, bb.maxX + 2, bb.maxY + 2, bld.centroid, bld);
      return { ok: true, w: tryW, d: tryD };
    }
    return { ok: false, w: 0, d: 0 };
  };

  const isConvertibleLot = (b: Building): boolean => {
    const lot = lotsById.get(b.lotId);
    if (!lot) return false;
    return dist(lot.frontageEdge[0], lot.frontageEdge[1]) >= 5.5 && polygonArea(lot.polygon) >= 58;
  };

  // Pre-build seed hubs for High Street & District Parades when strength > 0
  const highStreet = ctx.streets.find((s) => s.name === 'High Street');
  const oldTownDist = ctx.districts.find((d) => d.archetype === DistrictArchetype.OldTown);
  const coreNodePos = ctx.settlementNodes[0]?.pos ?? (oldTownDist ? oldTownDist.seedPoint : { x: 0, y: 0 });
  // Pick hub inside OldTown with highest chained DBSCAN (<= 55 m) reach along the core spine
  let highStreetHub = highStreet
    ? highStreet.polyline[Math.floor(highStreet.polyline.length * 0.5)]
    : coreNodePos;
  if (oldTownDist) {
    const allPool = ctx.buildings.filter((b) => {
      if (b.isFringe || b.kind !== BuildingKind.Residential || !isConvertibleLot(b)) return false;
      if (dist(b.centroid, coreNodePos) >= 480) return false;
      const lot = lotsById.get(b.lotId);
      return lot !== undefined && polygonArea(lot.polygon) >= 72;
    });
    const deepPool = allPool.filter((b) => {
      const lot = lotsById.get(b.lotId)!;
      const area = polygonArea(lot.polygon);
      const fLen = Math.max(1, dist(lot.frontageEdge[0], lot.frontageEdge[1]));
      const depth = area / fLen;
      return area >= 98 && ((fLen >= 6.8 && depth >= 8.2) || (fLen >= 10.5 && depth >= 7.0));
    });
    const pool = deepPool.length >= 22 ? deepPool : allPool;
    const oldBlds = pool.filter((b) => b.districtId === oldTownDist.id);
    const seedsToCheck = oldBlds.length > 0 ? oldBlds : pool;
    const bfsReach = (seed: Building): number => {
      const seen = new Set<number>([seed.id]);
      const q = [seed];
      for (let i = 0; i < q.length && seen.size < 38; i++) {
        const cur = q[i];
        for (const o of pool) {
          if (!seen.has(o.id) && dist(cur.centroid, o.centroid) <= 52) {
            seen.add(o.id);
            q.push(o);
          }
        }
      }
      return seen.size;
    };
    let bestScore = -1;
    for (const b of seedsToCheck) {
      const reach = bfsReach(b);
      const immediate = pool.filter((o) => dist(o.centroid, b.centroid) <= 50).length;
      const inOld = pool.filter(
        (o) => o.districtId === oldTownDist.id && dist(o.centroid, b.centroid) <= 85
      ).length;
      const onHS = highStreet && b.address.streetId === highStreet.id ? 8 : 0;
      const spineD = distPointToPolyline(b.centroid, ctx.spinePolyline).dist;
      const nearSpineBonus = spineD <= 65 ? 5 : 0;
      const reachBonus = reach >= 22 ? 60 : reach * 2;
      const sc = reachBonus + immediate * 2.5 + inOld * 0.6 + onHS + nearSpineBonus - dist(b.centroid, coreNodePos) * 0.02;
      if (sc > bestScore) {
        bestScore = sc;
        highStreetHub = b.centroid;
      }
    }
  }

  // Find candidate hubs for Parades (verify >= 7 convertible lots within 54 m so parades never fizzle!)
  const paradeHubs: Array<{ districtId: number; pos: Vec2; streetId: number }> = [];
  for (const d of ctx.districts) {
    if (d.archetype === DistrictArchetype.OldTown) continue;
    if (d.archetype === DistrictArchetype.StationIndustrial) continue;
    const dCenter = d.polygon.length >= 3 ? polygonCentroid(d.polygon) : d.seedPoint;
    const distBlds = ctx.buildings.filter(
      (b) => b.districtId === d.id && !b.isFringe && b.kind === BuildingKind.Residential && isConvertibleLot(b)
    );
    let bestHub: { pos: Vec2; streetId: number; score: number } | null = null;
    for (let idx = 0; idx < distBlds.length; idx++) {
      const b = distBlds[idx];
      if (dist(b.centroid, highStreetHub) < 195) continue;
      if (paradeHubs.some((ph) => dist(ph.pos, b.centroid) < 155)) continue;
      const nearby = distBlds.filter((o) => dist(o.centroid, b.centroid) <= 52).length;
      if (nearby < 7) continue;
      const e = edgesById.get(b.entranceEdgeId);
      const roadBonus = e && e.roadClass <= RoadClass.Secondary ? 3 : 0;
      const spineNear = distToNearestPolyline(ctx.arterialPolylines, b.centroid) <= 120 ? 3 : 0;
      const score = nearby * 2 + roadBonus + spineNear - dist(b.centroid, dCenter) * 0.015;
      if (!bestHub || score > bestHub.score) {
        bestHub = { pos: b.centroid, streetId: b.address.streetId, score };
      }
    }
    if (bestHub) {
      paradeHubs.push({ districtId: d.id, pos: bestHub.pos, streetId: bestHub.streetId });
    }
  }

  if (paradeHubs.length < 4) {
    for (const d of ctx.districts) {
      if (paradeHubs.length >= 4) break;
      if (d.archetype === DistrictArchetype.OldTown) continue;
      const distBlds = ctx.buildings.filter(
        (b) => b.districtId === d.id && !b.isFringe && b.kind === BuildingKind.Residential && isConvertibleLot(b)
      );
      for (const b of distBlds) {
        if (dist(b.centroid, highStreetHub) < 180) continue;
        if (paradeHubs.some((ph) => dist(ph.pos, b.centroid) < 145)) continue;
        const nearby = distBlds.filter((o) => dist(o.centroid, b.centroid) <= 53).length;
        if (nearby >= 6) {
          paradeHubs.push({ districtId: d.id, pos: b.centroid, streetId: b.address.streetId });
          if (paradeHubs.length >= 4) break;
        }
      }
    }
  }

  const frontageDefs = VENUE_DEFS.filter((d) => d.siteType === 'frontage');
  const plannedFrontage: Array<{ def: VenueDef; targetMode: 'high_street' | 'parade' | 'single'; paradeIdx?: number }> = [];

  const doughnutDef = defById.get('doughnut_shop')!;
  plannedFrontage.push({ def: doughnutDef, targetMode: strength > 0 ? 'high_street' : 'single' });

  const highShopDef = defById.get('high_street_shop')!;
  const cornerDef = defById.get('corner_shop')!;
  const cafeDef = defById.get('cafe')!;
  const takeawayDef = defById.get('takeaway')!;
  const pharmacyDef = defById.get('pharmacy')!;
  const bakeryDef = defById.get('bakery')!;
  const postDef = defById.get('post_office')!;

  if (strength > 0) {
    // 21 venues chained onto High Street (reliably yields >= 15-21 DBSCAN-clustered in OldTown)
    const hsMix: VenueDef[] = [
      ...Array(14).fill(highShopDef),
      cafeDef,
      cafeDef,
      bakeryDef,
      pharmacyDef,
      postDef,
      takeawayDef,
    ];
    for (const d of hsMix) plannedFrontage.push({ def: d, targetMode: 'high_street' });

    // 6 venues per Parade hub (up to 4 hubs -> yields >= 3-4 DBSCAN parades of 5-6 shops each)
    for (let pIdx = 0; pIdx < Math.min(4, paradeHubs.length); pIdx++) {
      const pMix: VenueDef[] = [
        cornerDef,
        cornerDef,
        takeawayDef,
        cafeDef,
        bakeryDef,
        pIdx % 2 === 0 ? pharmacyDef : cornerDef,
      ];
      for (const d of pMix) plannedFrontage.push({ def: d, targetMode: 'parade', paradeIdx: pIdx });
    }

    // 1 isolated roadside single (+ Town Supermarket = ~2-4 isolated, comfortably <= 8)
    const singleMix: VenueDef[] = [cornerDef];
    for (const d of singleMix) plannedFrontage.push({ def: d, targetMode: 'single' });
  } else {
    for (const def of frontageDefs) {
      if (def.id === 'doughnut_shop') continue;
      const cnt = rng.int(def.countRange[0], def.countRange[1]);
      for (let i = 0; i < cnt; i++) {
        plannedFrontage.push({ def, targetMode: 'single' });
      }
    }
  }

  const eligibleResidential = ctx.buildings.filter(
    (b) => b.kind === BuildingKind.Residential && !b.isFringe
  );

  const highStreetPlacedPts: Vec2[] = [];
  const paradePlacedPts = new Map<number, Vec2[]>();

  for (const item of plannedFrontage) {
    const def = item.def;

    const runCandidateSearch = (
      maxChainDist: number
    ): { bld: Building; fit: { w: number; d: number } } | null => {
      const scoredCands: Array<{ bld: Building; score: number }> = [];

      for (const bld of eligibleResidential) {
        if (usedBuildingIds.has(bld.id)) continue;
        const lot = lotsById.get(bld.lotId);
        if (!lot) continue;
        const fLen = dist(lot.frontageEdge[0], lot.frontageEdge[1]);
        if (fLen < 5.5) continue;

        const distObj = districtsById.get(bld.districtId);
        const edge = edgesById.get(bld.entranceEdgeId);
        const r = dist(bld.centroid, coreNodePos);
        const centrality = 1 - Math.min(1, r / 1400);
        const distMatch = distObj && def.requiredDistrictTags.includes(distObj.archetype) ? 1.0 : 0.15;
        const frontageScore = edge ? (edge.roadClass <= def.frontageClass ? 1.0 : 0.35) : 0.2;

        let affinityScore = 0;
        let clusterBias = 0;

        if (strength > 0) {
          if (item.targetMode === 'high_street') {
            if (paradeHubs.some((ph) => dist(ph.pos, bld.centroid) < 95)) continue;
            const dChain =
              highStreetPlacedPts.length === 0
                ? dist(bld.centroid, highStreetHub)
                : Math.min(...highStreetPlacedPts.map((p) => dist(p, bld.centroid)));
            if (highStreetPlacedPts.length > 0 && dChain > maxChainDist) continue;
            const sameSt = highStreet && bld.address.streetId === highStreet.id ? 2.5 : 0;
            clusterBias += sameSt + (dChain <= 54 ? 12.0 - dChain * 0.06 : -dChain * 0.14);
          } else if (item.targetMode === 'parade' && item.paradeIdx !== undefined) {
            if (highStreetPlacedPts.some((hp) => dist(hp, bld.centroid) < 72)) continue;
            const hub = paradeHubs[item.paradeIdx];
            const placed = paradePlacedPts.get(item.paradeIdx) ?? [];
            const dChain =
              placed.length === 0
                ? dist(bld.centroid, hub.pos)
                : Math.min(...placed.map((p) => dist(p, bld.centroid)));
            if (placed.length > 0 && dChain > maxChainDist) continue;
            clusterBias += dChain <= 53 ? 12.0 - dChain * 0.08 : -dChain * 0.14;
          } else {
            const nearV = venues.some((v) => dist(v.pos, bld.centroid) < 85);
            clusterBias += nearV ? -3.0 : 1.5;
          }

          for (const v of venues) {
            const d = dist(v.pos, bld.centroid);
            if (d <= 58 && v.siteType === 'frontage') {
              const aff = RETAIL_AFFINITY_MATRIX[def.retailGroup][v.retailGroup];
              affinityScore += aff * (1 - d / 65) * 0.9;
            }
          }
        }

        const score =
          1.0 * centrality +
          1.2 * frontageScore +
          1.4 * distMatch +
          strength * (clusterBias + affinityScore) +
          rng.range(0, 0.18);

        scoredCands.push({ bld, score });
      }

      scoredCands.sort((a, b) => b.score - a.score);

      const candCap =
        item.targetMode === 'single' ? Math.min(36, scoredCands.length) : scoredCands.length;
      for (let cIdx = 0; cIdx < candCap; cIdx++) {
        const cand = scoredCands[cIdx].bld;
        const fit = tryConvertBuildingToShop(cand, def);
        if (fit.ok) {
          return { bld: cand, fit: { w: fit.w, d: fit.d } };
        }
      }
      return null;
    };

    const match =
      item.targetMode === 'single'
        ? runCandidateSearch(52) ?? runCandidateSearch(58.5) ?? runCandidateSearch(72)
        : runCandidateSearch(52) ?? runCandidateSearch(58.5);
    const bestBld = match?.bld ?? null;
    const bestFit = match?.fit ?? null;

    if (bestBld && bestFit) {
      usedBuildingIds.add(bestBld.id);
      if (item.targetMode === 'high_street') {
        highStreetPlacedPts.push(bestBld.centroid);
      } else if (item.targetMode === 'parade' && item.paradeIdx !== undefined) {
        const arr = paradePlacedPts.get(item.paradeIdx) ?? [];
        arr.push(bestBld.centroid);
        paradePlacedPts.set(item.paradeIdx, arr);
      }
      const venueId = venues.length;
      bestBld.venueId = venueId;

      venues.push({
        id: venueId,
        defId: def.id,
        name: getVenueDisplayName(def),
        category: def.category,
        retailGroup: def.retailGroup,
        siteType: 'frontage',
        buildingId: bestBld.id,
        siteId: null,
        clusterId: null,
        blockId: bestBld.blockId,
        districtId: bestBld.districtId,
        address: bestBld.address,
        addressString: bestBld.addressString,
        entrancePos: bestBld.entrancePos,
        entranceEdgeId: bestBld.entranceEdgeId,
        pos: bestBld.centroid,
        catalogW: bestFit.w,
        catalogD: bestFit.d,
      });
    }
  }

  // Reserve a few industrial/warehouse "Other" buildings in StationIndustrial
  for (const bld of ctx.buildings) {
    if (usedBuildingIds.size >= venues.length + 12) break;
    if (usedBuildingIds.has(bld.id) || bld.isFringe || bld.kind !== BuildingKind.Residential) continue;
    const dObj = districtsById.get(bld.districtId);
    if (dObj?.archetype === DistrictArchetype.StationIndustrial && rng.chance(0.28)) {
      usedBuildingIds.add(bld.id);
      bld.kind = BuildingKind.Other;
      bld.dwellingType = null;
    }
  }

  // -------------------------------------------------------------------------
  // M5 DBSCAN Retail Cluster Detection (eps = 60m, minPts = 4)
  // -------------------------------------------------------------------------
  const retailVenues = venues.filter((v) => isRetailVenueForClustering(v.defId));
  const { clusters: dbClusters } = dbscanPoints(
    retailVenues.map((v) => v.pos),
    60,
    4
  );
  // Process largest clusters first so High Street always wins OldTown primary status over smaller edge parades
  dbClusters.sort((a, b) => b.length - a.length);

  const retailClusters: RetailCluster[] = [];
  let paradeCounter = 1;

  for (const memberIndices of dbClusters) {
    const members = memberIndices.map((idx) => retailVenues[idx]);
    const pts = members.map((v) => v.pos);
    const hull = pts.length >= 3 ? expandPolygon(convexHull(pts), 12) : [];
    const c = polygonCentroid(pts);
    const distObj = findNearestDistrict(ctx.districts, c);

    const hasRetailPark = members.some(
      (v) => v.defId === 'retail_park' || v.defId === 'retail_park_unit'
    );
    const inOldTown =
      members.some((v) => v.defId === 'high_street_shop') ||
      distObj.archetype === DistrictArchetype.OldTown ||
      members.filter(
        (v) => districtsById.get(v.districtId)?.archetype === DistrictArchetype.OldTown
      ).length >= 3;

    let kind: RetailClusterKind = 'parade';
    let name = `${distObj.name} Parade`;
    if (hasRetailPark) {
      kind = 'retail_park';
      name = 'Millbrook Retail Park';
    } else if (inOldTown && !retailClusters.some((rc) => rc.kind === 'high_street')) {
      kind = 'high_street';
      name = 'High Street';
    } else {
      if (retailClusters.some((rc) => rc.name === name)) {
        name = `${distObj.name} Parade ${++paradeCounter}`;
      }
    }

    const clusterId = retailClusters.length;
    for (const m of members) {
      m.clusterId = clusterId;
    }

    retailClusters.push({
      id: clusterId,
      kind,
      name,
      districtId: distObj.id,
      venueIds: members.map((v) => v.id),
      hull,
    });
  }

  ctx.venues = venues;
  ctx.retailClusters = retailClusters;

  ctx.diagnostics.push({
    stage: 'Stage 11 · Venues & Retail Clusters',
    durationMs: nowMs() - t0,
    summary: `${venues.length} venues across ${retailClusters.length} DBSCAN clusters (${retailVenues.filter((v) => v.clusterId !== null).length}/${retailVenues.length} retail clustered)`,
  });
}

// ---------------------------------------------------------------------------
// Stage 12: Households & Capacity Calibration (1.8x - 3.0x Required Slots)
// ---------------------------------------------------------------------------
export function runStageHouseholds(ctx: GenContext): void {
  const t0 = nowMs();
  const rng = SeededRng.fromStage(ctx.params.seed, 'households');
  const districtsById = new Map<number, District>();
  for (const d of ctx.districts) districtsById.set(d.id, d);
  const defById = new Map<string, VenueDef>();
  for (const d of VENUE_DEFS) defById.set(d.id, d);
  const venueById = new Map<number, Venue>();
  for (const v of ctx.venues) venueById.set(v.id, v);

  const requiredSlots = Math.ceil((1.05 * ctx.params.namedNpcCount) / 2.3);
  const minTargetSlots = Math.ceil(requiredSlots * 1.85);
  const maxTargetSlots = Math.floor(requiredSlots * 2.9);

  const residentialBuildings = ctx.buildings.filter(
    (b) => b.kind === BuildingKind.Residential
  );
  // Also find frontage shop buildings that include 1-2 flatsAbove!
  const shopFlatBuildings: Array<{ b: Building; flats: number }> = [];
  for (const b of ctx.buildings) {
    if (b.kind !== BuildingKind.Venue || b.venueId === null) continue;
    const v = venueById.get(b.venueId);
    const def = v ? defById.get(v.defId) : undefined;
    if (def?.flatsAbove) {
      shopFlatBuildings.push({ b, flats: rng.int(def.flatsAbove.min, def.flatsAbove.max) });
    }
  }

  const unitCounts = new Map<number, number>();
  let totalSlots = 0;

  for (const b of residentialBuildings) {
    const dt = b.dwellingType ?? DwellingType.Terraced;
    const spec = DWELLING_SPECS[dt];
    const units =
      dt === DwellingType.FlatBuilding
        ? rng.int(spec.unitsRange[0], spec.unitsRange[1])
        : 1;
    unitCounts.set(b.id, units);
    totalSlots += units;
  }
  for (const sf of shopFlatBuildings) {
    unitCounts.set(sf.b.id, sf.flats);
    totalSlots += sf.flats;
  }

  // Track per-district flat share vs ARCHETYPE_SPECS.maxFlatShare
  const districtCounts = new Map<number, { total: number; flats: number }>();
  for (const b of residentialBuildings) {
    const st = districtCounts.get(b.districtId) ?? { total: 0, flats: 0 };
    st.total++;
    if (b.dwellingType === DwellingType.FlatBuilding) st.flats++;
    districtCounts.set(b.districtId, st);
  }

  // If too high (> 2.9x required), trim flat units down to 3-4 or downgrade excess flats -> terraced
  if (totalSlots > maxTargetSlots) {
    const flats = rng.shuffle(
      residentialBuildings.filter((b) => b.dwellingType === DwellingType.FlatBuilding)
    );
    for (const b of flats) {
      if (totalSlots <= maxTargetSlots) break;
      const cur = unitCounts.get(b.id) ?? 5;
      if (cur > 3) {
        const next = 3;
        unitCounts.set(b.id, next);
        totalSlots -= cur - next;
      }
    }
    for (const b of flats) {
      if (totalSlots <= maxTargetSlots) break;
      const cur = unitCounts.get(b.id) ?? 3;
      if (cur > 1) {
        b.dwellingType = DwellingType.Terraced;
        unitCounts.set(b.id, 1);
        totalSlots -= cur - 1;
      }
    }
  }

  // If below 1.85x required, boost flat building unit counts or upgrade eligible houses within maxFlatShare
  if (totalSlots < minTargetSlots) {
    const upgradeCands = rng.shuffle(
      residentialBuildings.filter(
        (b) =>
          b.dwellingType !== DwellingType.FlatBuilding &&
          b.dwellingType !== DwellingType.LuxuryMansion &&
          !b.isFringe
      )
    );
    for (const b of upgradeCands) {
      if (totalSlots >= minTargetSlots) break;
      const dObj = districtsById.get(b.districtId);
      const maxShare = dObj ? ARCHETYPE_SPECS[dObj.archetype].maxFlatShare : 0.45;
      const dc = districtCounts.get(b.districtId);
      if (dc && (dc.flats + 1) / Math.max(1, dc.total) > maxShare) continue;

      b.dwellingType = DwellingType.FlatBuilding;
      const newUnits = rng.int(5, 8);
      const oldUnits = unitCounts.get(b.id) ?? 1;
      unitCounts.set(b.id, newUnits);
      totalSlots += newUnits - oldUnits;
      if (dc) dc.flats++;
    }

    if (totalSlots < minTargetSlots) {
      for (const b of residentialBuildings) {
        if (totalSlots >= minTargetSlots) break;
        if (b.dwellingType === DwellingType.FlatBuilding) {
          const cur = unitCounts.get(b.id) ?? 5;
          if (cur < 10) {
            const addU = Math.min(10 - cur, minTargetSlots - totalSlots);
            unitCounts.set(b.id, cur + addU);
            totalSlots += addU;
          }
        }
      }
    }
  }

  const households: HouseholdSlot[] = [];
  let citizenId = 1;

  const createSlotsForBuilding = (b: Building, units: number, dt: DwellingType, isShopAbove = false) => {
    const district = districtsById.get(b.districtId) ?? ctx.districts[0];
    b.unitIds = [];
    for (let u = 0; u < units; u++) {
      const slotId = households.length;
      const unitLabel = isShopAbove
        ? `Flat ${u + 1} (Above)`
        : units > 1
        ? `Flat ${u + 1}`
        : '';
      const occupied = rng.chance(0.93);
      const occupantName = occupied
        ? `${rng.pick(UK_FIRST_NAMES)} ${rng.pick(UK_SURNAMES)}`
        : null;
      households.push({
        id: slotId,
        buildingId: b.id,
        unitLabel,
        dwellingType: dt,
        wealthTier: district.wealthTier,
        occupantId: occupied ? citizenId++ : -1,
        occupantName,
      });
      b.unitIds.push(slotId);
    }
  };

  for (const b of residentialBuildings) {
    createSlotsForBuilding(b, unitCounts.get(b.id) ?? 1, b.dwellingType ?? DwellingType.Terraced, false);
  }
  for (const sf of shopFlatBuildings) {
    createSlotsForBuilding(sf.b, unitCounts.get(sf.b.id) ?? 1, DwellingType.FlatBuilding, true);
  }

  ctx.households = households;
  ctx.estimatedPopulation = Math.round(households.length * 2.3 * 0.93);
  ctx.namedShare = households.length > 0 ? requiredSlots / households.length : 0;

  // Final overlap/containment audit for debug overlay & verification telemetry
  const ov = computeOverlapViolations(
    ctx.buildings,
    ctx.lots,
    ctx.blocks,
    ctx.edges,
    ctx.venueSites
  );
  ctx.overlapViolations = ov.violations;

  ctx.diagnostics.push({
    stage: 'Stage 12 · Households & Audit',
    durationMs: nowMs() - t0,
    summary: `${households.length} slots (~${ctx.estimatedPopulation.toLocaleString()} pop, ${ov.violations.length} overlap violations)`,
  });
}

export function claimHome(
  town: TownData,
  profile: { preferredDwelling?: DwellingType; wealthTier?: WealthTier; npcId: number; npcName: string },
  rng: SeededRng
): HouseholdSlot | null {
  const free = town.households.filter((h) => h.occupantId === -1);
  if (free.length === 0) return null;

  let pool = free.filter((h) => {
    if (profile.preferredDwelling && h.dwellingType !== profile.preferredDwelling) return false;
    if (profile.wealthTier && h.wealthTier !== profile.wealthTier) return false;
    return true;
  });
  if (pool.length === 0 && profile.preferredDwelling) {
    pool = free.filter((h) => h.dwellingType === profile.preferredDwelling);
  }
  if (pool.length === 0) pool = free;

  const chosen = rng.pick(pool);
  chosen.occupantId = profile.npcId;
  chosen.occupantName = profile.npcName;
  return chosen;
}
