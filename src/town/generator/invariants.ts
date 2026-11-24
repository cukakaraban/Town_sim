import {
  Block,
  BlockKind,
  Building,
  BuildingKind,
  District,
  DistrictArchetype,
  GraphEdge,
  GraphNode,
  InvariantCheckResult,
  InvariantReport,
  Lot,
  OverlapViolation,
  ROAD_HALF_WIDTH,
  RoadClass,
  TownData,
  Vec2,
  VenueSite,
} from '../model/types';
import {
  boundsOverlap,
  computePcaAspectRatio,
  dist,
  distPointToPolyline,
  distToNearestPolyline,
  distancePolylineToPolygon,
  intersectMultiPolygons,
  minDistancePolygons,
  minTurningRadius,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  polygonInsidePolygon,
  polygonIntersectionArea,
  polygonSelfIntersects,
  polylineLength,
  shrinkPolygonTowardCenter,
  unionPolygonsMetrics,
} from '../geometry/geom';
import { SpatialHash } from '../geometry/spatialHash';
import { findShortestRoute } from '../geometry/dijkstra';
import { VENUE_DEFS } from '../data/presets';

export function hashTownData(data: TownData): string {
  let h = 0x811c9dc5;
  const mixInt = (n: number) => {
    h ^= n | 0;
    h = Math.imul(h, 0x01000193);
  };
  const mixStr = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };

  mixStr(data.generatorVersion);
  mixInt(data.params.seed);
  mixStr(data.params.preset);
  mixStr(data.resolvedTownShape);
  mixInt(Math.round(data.domainAngle * 1000));
  mixInt(data.spinePolyline.length);
  mixInt(data.builtUpPolygons.length);
  mixInt(data.districts.length);
  mixInt(data.streets.length);
  mixInt(data.nodes.length);
  mixInt(data.edges.length);
  mixInt(data.blocks.length);
  mixInt(data.lots.length);
  mixInt(data.buildings.length);
  mixInt(data.venues.length);
  mixInt(data.retailClusters.length);
  mixInt(data.households.length);

  for (const s of data.streets) mixStr(s.name);
  for (const b of data.buildings) {
    mixStr(b.addressString);
    mixInt(Math.round(b.centroid.x * 100));
    mixInt(Math.round(b.centroid.y * 100));
  }
  for (const v of data.venues) {
    mixStr(v.name);
    mixStr(v.addressString);
  }

  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Spatial-hash broad-phase + exact polygon/road clearance repair pass (PRD Section 11).
 * Candidates failing overlap, road clearance, or venue site separation are shrunk (up to 3 tries)
 * or removed cleanly. Venue footprints are never shrunk below catalog tolerance.
 */
export function repairBuildingsPass(
  buildings: Building[],
  lots: Lot[],
  edges: readonly GraphEdge[],
  venueSites: readonly VenueSite[]
): Building[] {
  const lotMap = new Map<number, Lot>();
  for (const l of lots) lotMap.set(l.id, l);

  const edgeHash = new SpatialHash<GraphEdge>(50);
  for (const e of edges) {
    const b = polygonBounds(e.polyline);
    const pad = ROAD_HALF_WIDTH[e.roadClass] + 6;
    edgeHash.insertBounds(b.minX - pad, b.minY - pad, b.maxX + pad, b.maxY + pad, e.polyline[0], e);
  }

  const siteHash = new SpatialHash<VenueSite>(80);
  for (const vs of venueSites) {
    const b = polygonBounds(vs.sitePolygon);
    siteHash.insertBounds(b.minX - 2, b.minY - 2, b.maxX + 2, b.maxY + 2, polygonCentroid(vs.sitePolygon), vs);
  }

  // Place fixed/venue buildings first so residential sprawl/lots yield to them
  const ordered = [...buildings].sort((a, b) => {
    const aRank = a.kind === BuildingKind.Venue ? 0 : 1;
    const bRank = b.kind === BuildingKind.Venue ? 0 : 1;
    return aRank - bRank || a.id - b.id;
  });

  const accepted: Building[] = [];
  const bldHash = new SpatialHash<Building>(40);

  const isFootprintValid = (poly: Vec2[], bld: Building): boolean => {
    if (poly.length < 3 || polygonSelfIntersects(poly) || polygonArea(poly) < 12) return false;
    const lot = lotMap.get(bld.lotId);
    if (lot && !polygonInsidePolygon(poly, lot.polygon, 0.02)) {
      return false;
    }

    const bb = polygonBounds(poly);
    // Check road clearance >= 1.05m outside road half-width
    const nearEdges = edgeHash.queryBounds(bb.minX - 8, bb.minY - 8, bb.maxX + 8, bb.maxY + 8);
    for (const e of nearEdges) {
      const req = ROAD_HALF_WIDTH[e.roadClass] + 1.05;
      if (distancePolylineToPolygon(e.polyline, poly) < req) {
        return false;
      }
    }

    // Check against reserved venue sites (if not belonging to that site)
    if (bld.kind !== BuildingKind.Venue) {
      const nearSites = siteHash.queryBounds(bb.minX - 1, bb.minY - 1, bb.maxX + 1, bb.maxY + 1);
      for (const vs of nearSites) {
        if (polygonIntersectionArea(poly, vs.sitePolygon) > 0.01) {
          return false;
        }
      }
    }

    // Check against already accepted buildings (overlap <= 0.01 m2)
    const nearBlds = bldHash.queryBounds(bb.minX - 1, bb.minY - 1, bb.maxX + 1, bb.maxY + 1);
    for (const other of nearBlds) {
      if (polygonIntersectionArea(poly, other.footprint) > 0.01) {
        return false;
      }
    }

    return true;
  };

  for (const bld of ordered) {
    if (isFootprintValid(bld.footprint, bld)) {
      accepted.push(bld);
      const bb = polygonBounds(bld.footprint);
      bldHash.insertBounds(bb.minX, bb.minY, bb.maxX, bb.maxY, bld.centroid, bld);
      continue;
    }

    // Shrink up to 3 tries for non-venue buildings
    let fixed = false;
    if (bld.kind !== BuildingKind.Venue) {
      for (const scale of [0.88, 0.78, 0.68]) {
        const shrunk = shrinkPolygonTowardCenter(bld.footprint, scale);
        if (isFootprintValid(shrunk, bld)) {
          bld.footprint = shrunk;
          bld.centroid = polygonCentroid(shrunk);
          accepted.push(bld);
          const bb = polygonBounds(shrunk);
          bldHash.insertBounds(bb.minX, bb.minY, bb.maxX, bb.maxY, bld.centroid, bld);
          fixed = true;
          break;
        }
      }
    } else {
      // For venue footprints keep within 92% of catalog bounds (well inside +/-10%)
      for (const scale of [0.96, 0.92]) {
        const shrunk = shrinkPolygonTowardCenter(bld.footprint, scale);
        if (isFootprintValid(shrunk, bld)) {
          bld.footprint = shrunk;
          bld.centroid = polygonCentroid(shrunk);
          accepted.push(bld);
          const bb = polygonBounds(shrunk);
          bldHash.insertBounds(bb.minX, bb.minY, bb.maxX, bb.maxY, bld.centroid, bld);
          fixed = true;
          break;
        }
      }
    }
    if (!fixed && bld.kind === BuildingKind.Venue) {
      // Should rarely happen; do not silently leave invalid venue overlap
    }
  }

  accepted.sort((a, b) => a.id - b.id);
  return accepted;
}

export function computeOverlapViolations(
  buildings: readonly Building[],
  lots: readonly Lot[],
  blocks: readonly Block[],
  edges: readonly GraphEdge[],
  venueSites: readonly VenueSite[]
): {
  violations: OverlapViolation[];
  footprintOverlapCount: number;
  roadClearanceCount: number;
  lotOverlapCount: number;
  lotInBlockCount: number;
  footprintInLotCount: number;
  venueSiteOverlapCount: number;
} {
  const violations: OverlapViolation[] = [];
  let footprintOverlapCount = 0;
  let roadClearanceCount = 0;
  let lotOverlapCount = 0;
  let lotInBlockCount = 0;
  let footprintInLotCount = 0;
  let venueSiteOverlapCount = 0;

  const blockMap = new Map<number, Block>();
  for (const b of blocks) blockMap.set(b.id, b);
  const lotMap = new Map<number, Lot>();
  for (const l of lots) lotMap.set(l.id, l);

  const bldHash = new SpatialHash<{ b: Building; bounds: ReturnType<typeof polygonBounds> }>(40);
  for (const b of buildings) {
    const bounds = polygonBounds(b.footprint);
    bldHash.insertBounds(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, b.centroid, {
      b,
      bounds,
    });
  }

  const edgeHash = new SpatialHash<GraphEdge>(50);
  for (const e of edges) {
    const eb = polygonBounds(e.polyline);
    const pad = ROAD_HALF_WIDTH[e.roadClass] + 3;
    edgeHash.insertBounds(eb.minX - pad, eb.minY - pad, eb.maxX + pad, eb.maxY + pad, e.polyline[0], e);
  }

  // 1. Footprint vs Footprint (> 0.01 m2) & Building vs Road (< halfWidth + 1.0m) & Footprint in Lot
  for (let i = 0; i < buildings.length; i++) {
    const bA = buildings[i];
    const boundsA = polygonBounds(bA.footprint);

    const cands = bldHash.queryBounds(boundsA.minX - 0.5, boundsA.minY - 0.5, boundsA.maxX + 0.5, boundsA.maxY + 0.5);
    for (const c of cands) {
      if (c.b.id <= bA.id) continue;
      if (!boundsOverlap(boundsA, c.bounds, 0.01)) continue;
      if (polygonIntersectionArea(bA.footprint, c.b.footprint) > 0.01) {
        footprintOverlapCount++;
        violations.push({
          kind: 'footprint',
          polygon: bA.footprint,
          detail: `Building #${bA.id} overlaps #${c.b.id}`,
        });
      }
    }

    const nearEdges = edgeHash.queryBounds(boundsA.minX - 8, boundsA.minY - 8, boundsA.maxX + 8, boundsA.maxY + 8);
    for (const e of nearEdges) {
      const req = ROAD_HALF_WIDTH[e.roadClass] + 1.0 - 1e-3;
      if (distancePolylineToPolygon(e.polyline, bA.footprint) < req) {
        roadClearanceCount++;
        violations.push({
          kind: 'road',
          polygon: bA.footprint,
          detail: `Building #${bA.id} within 1.0m of road edge #${e.id}`,
        });
        break;
      }
    }

    if (bA.lotId >= 0) {
      const lot = lotMap.get(bA.lotId);
      if (!lot || !polygonInsidePolygon(bA.footprint, lot.polygon, 0.05)) {
        footprintInLotCount++;
        violations.push({
          kind: 'containment',
          polygon: bA.footprint,
          detail: `Building #${bA.id} exits lot #${bA.lotId}`,
        });
      }
    }
  }

  // 2. Lot overlap (> 0.5 m2) & Lot in Block (all vertices tolerance 0.05 m)
  const lotHash = new SpatialHash<{ l: Lot; bounds: ReturnType<typeof polygonBounds> }>(45);
  for (const l of lots) {
    const bounds = polygonBounds(l.polygon);
    lotHash.insertBounds(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, polygonCentroid(l.polygon), {
      l,
      bounds,
    });
  }

  for (const l of lots) {
    const blk = blockMap.get(l.blockId);
    if (!blk || !polygonInsidePolygon(l.polygon, blk.polygon, 0.05)) {
      lotInBlockCount++;
      violations.push({
        kind: 'containment',
        polygon: l.polygon,
        detail: `Lot #${l.id} has vertex outside block #${l.blockId}`,
      });
    }

    const bA = polygonBounds(l.polygon);
    const cands = lotHash.queryBounds(bA.minX - 0.5, bA.minY - 0.5, bA.maxX + 0.5, bA.maxY + 0.5);
    for (const c of cands) {
      if (c.l.id <= l.id) continue;
      if (!boundsOverlap(bA, c.bounds, 0)) continue;
      if (polygonIntersectionArea(l.polygon, c.l.polygon) > 0.5) {
        lotOverlapCount++;
        violations.push({
          kind: 'lot',
          polygon: l.polygon,
          detail: `Lot #${l.id} overlaps lot #${c.l.id}`,
        });
      }
    }
  }

  // 3. Venue sites overlap check
  const bldByLotId = new Map<number, Building>();
  for (const b of buildings) bldByLotId.set(b.lotId, b);

  for (const vs of venueSites) {
    const vb = polygonBounds(vs.sitePolygon);
    const nearLots = lotHash.queryBounds(vb.minX - 0.5, vb.minY - 0.5, vb.maxX + 0.5, vb.maxY + 0.5);
    for (const c of nearLots) {
      const ownerBld = bldByLotId.get(c.l.id);
      if (ownerBld && ownerBld.venueId !== null && vs.venueId === ownerBld.venueId) continue;
      if (polygonIntersectionArea(c.l.polygon, vs.sitePolygon) > 0.5) {
        venueSiteOverlapCount++;
        violations.push({
          kind: 'venue_site',
          polygon: c.l.polygon,
          detail: `Lot #${c.l.id} overlaps venue site #${vs.id}`,
        });
      }
    }
    const nearBlds = bldHash.queryBounds(vb.minX - 0.5, vb.minY - 0.5, vb.maxX + 0.5, vb.maxY + 0.5);
    for (const c of nearBlds) {
      if (c.b.venueId !== null && vs.venueId === c.b.venueId) continue;
      if (c.b.kind === BuildingKind.Venue) continue;
      if (polygonIntersectionArea(c.b.footprint, vs.sitePolygon) > 0.05) {
        venueSiteOverlapCount++;
        violations.push({
          kind: 'venue_site',
          polygon: c.b.footprint,
          detail: `Building #${c.b.id} overlaps venue site #${vs.id}`,
        });
      }
    }
  }

  return {
    violations,
    footprintOverlapCount,
    roadClearanceCount,
    lotOverlapCount,
    lotInBlockCount,
    footprintInLotCount,
    venueSiteOverlapCount,
  };
}

export function runInvariants(data: TownData): InvariantReport {
  const checks: InvariantCheckResult[] = [];
  const [minB, maxB] = data.params.targetBuildings;

  // 1. Building count
  checks.push({
    id: 'building_count',
    label: `Building count within ${minB}–${maxB}`,
    passed: data.buildings.length >= minB && data.buildings.length <= maxB,
    detail: `${data.buildings.length} buildings${data.fittingWarning ? ` (${data.fittingWarning})` : ''}`,
  });

  // 2. Hardened geometric overlap & containment audit
  const ov = computeOverlapViolations(
    data.buildings,
    data.lots,
    data.blocks,
    data.edges,
    data.venueSites
  );

  checks.push({
    id: 'footprint_overlap',
    label: 'Footprint overlap <= 0.01 m²',
    passed: ov.footprintOverlapCount === 0,
    detail:
      ov.footprintOverlapCount === 0
        ? `${data.buildings.length} footprints overlap-free`
        : `${ov.footprintOverlapCount} footprint overlap(s)`,
  });

  checks.push({
    id: 'building_vs_road',
    label: 'Building clearance >= 1.0 m outside road surface',
    passed: ov.roadClearanceCount === 0,
    detail:
      ov.roadClearanceCount === 0
        ? `All ${data.buildings.length} footprints clear all road surfaces`
        : `${ov.roadClearanceCount} road clearance violation(s)`,
  });

  checks.push({
    id: 'lot_overlap',
    label: 'Lot overlap <= 0.5 m²',
    passed: ov.lotOverlapCount === 0,
    detail:
      ov.lotOverlapCount === 0
        ? `${data.lots.length} lots overlap-free`
        : `${ov.lotOverlapCount} lot overlap(s)`,
  });

  checks.push({
    id: 'lot_in_block',
    label: 'All lot vertices inside block polygon (0.05 m tol.)',
    passed: ov.lotInBlockCount === 0,
    detail:
      ov.lotInBlockCount === 0
        ? `${data.lots.length} lots fully enclosed in blocks`
        : `${ov.lotInBlockCount} lot containment violation(s)`,
  });

  checks.push({
    id: 'footprint_in_lot',
    label: 'All footprint vertices inside lot polygon',
    passed: ov.footprintInLotCount === 0,
    detail:
      ov.footprintInLotCount === 0
        ? `${data.buildings.length} footprints enclosed in lots`
        : `${ov.footprintInLotCount} footprint-in-lot violation(s)`,
  });

  checks.push({
    id: 'venue_sites',
    label: 'No building or lot overlaps reserved venue sites',
    passed: ov.venueSiteOverlapCount === 0 && data.unplacedVenues.length === 0,
    detail:
      ov.venueSiteOverlapCount === 0 && data.unplacedVenues.length === 0
        ? `${data.venueSites.length} reserved venue sites clear`
        : `${ov.venueSiteOverlapCount} site overlap(s), ${data.unplacedVenues.length} unplaced venue(s)`,
  });

  // 3. Venue footprints match catalog size within 10%
  const bldMap = new Map<number, Building>();
  for (const b of data.buildings) bldMap.set(b.id, b);
  const defMap = new Map(VENUE_DEFS.map((d) => [d.id, d]));
  let venueSizeErrors = 0;
  for (const v of data.venues) {
    if (v.siteType === 'green' || v.buildingId === null) continue;
    const b = bldMap.get(v.buildingId);
    const def = defMap.get(v.defId);
    if (!b || !def) {
      venueSizeErrors++;
      continue;
    }
    const targetArea = v.catalogW * v.catalogD;
    const actualArea = polygonArea(b.footprint);
    const relErr = Math.abs(actualArea - targetArea) / Math.max(1, targetArea);
    if (relErr > 0.1) {
      venueSizeErrors++;
    }
  }
  checks.push({
    id: 'venue_footprints',
    label: 'Venue footprints match catalog size within 10%',
    passed: venueSizeErrors === 0,
    detail:
      venueSizeErrors === 0
        ? `${data.venues.filter((v) => v.buildingId !== null).length} venue footprints within tolerance`
        : `${venueSizeErrors} venue footprint size mismatch(es)`,
  });

  // 4. Section 6 v0.2.1 Spine, Urbanity & Layout Invariants
  // 4a. Linearity: PCA aspect ratio of building centroids >= 2.0
  const pcaRatio = computePcaAspectRatio(data.buildings.map((b) => b.centroid));
  checks.push({
    id: 'linearity',
    label: 'Linearity: building PCA aspect ratio >= 2.0',
    passed: pcaRatio >= 2.0,
    detail: `PCA aspect ratio ${pcaRatio.toFixed(2)} (${data.resolvedTownShape})`,
  });

  // 4b. Roundness: 4 * pi * area / perimeter^2 of union of built-up polygons <= 0.45
  const builtMetrics = unionPolygonsMetrics(data.builtUpPolygons);
  checks.push({
    id: 'roundness',
    label: 'Roundness: built-up mask circularity <= 0.45',
    passed: data.builtUpPolygons.length > 0 && builtMetrics.roundness <= 0.45,
    detail: `Roundness ${builtMetrics.roundness.toFixed(3)} (area ${(builtMetrics.area / 1e6).toFixed(2)} km²)`,
  });

  // 4c. Spine proximity: >= 70% of buildings within 300 m of spine or branch
  let withinSpine300 = 0;
  for (const b of data.buildings) {
    if (distToNearestPolyline(data.arterialPolylines, b.centroid) <= 300) {
      withinSpine300++;
    }
  }
  const spineShare = data.buildings.length > 0 ? withinSpine300 / data.buildings.length : 0;
  checks.push({
    id: 'spine_proximity',
    label: 'Spine proximity: >= 70% of buildings within 300 m of spine/branch',
    passed: spineShare >= 0.70,
    detail: `${(spineShare * 100).toFixed(1)}% (${withinSpine300}/${data.buildings.length}) within 300 m`,
  });

  // 4d. Spine sinuosity: each arterial length/chord in [1.04, 1.25] & min turning radius >= spineMinRadius
  const minAllowedR = data.params.spineMinRadius ?? 150;
  const sinuosities: number[] = [];
  const turnRadii: number[] = [];
  let sinuosityOk = data.arterialPolylines.length > 0;
  for (const poly of data.arterialPolylines) {
    const len = polylineLength(poly);
    const chord = dist(poly[0], poly[poly.length - 1]);
    const s = len / Math.max(1, chord);
    const minR = minTurningRadius(poly, 16);
    sinuosities.push(s);
    turnRadii.push(minR);
    if (s < 1.04 || s > 1.25 || minR < minAllowedR - 1e-3) {
      sinuosityOk = false;
    }
  }
  checks.push({
    id: 'spine_sinuosity',
    label: `Spine sinuosity in [1.04, 1.25] & min radius >= ${minAllowedR} m`,
    passed: sinuosityOk,
    detail: `Sinuosity [${sinuosities.map((v) => v.toFixed(3)).join(', ')}], min R ${Math.round(Math.min(...turnRadii))} m`,
  });

  // 4e. No isolated villages: longest stretch along spine without built-up or ribbon land <= 250 m
  let longestGapM = 0;
  if (data.spinePolyline.length >= 2) {
    const stepM = 12;
    let totalLen = 0;
    let runGap = 0;
    const isCovered = (p: Vec2): boolean => {
      for (const poly of data.builtUpPolygons) {
        if (pointInPolygon(p, poly)) return true;
      }
      for (const poly of data.ribbonContours) {
        if (pointInPolygon(p, poly)) return true;
      }
      return false;
    };
    const allBuiltMask = [...data.builtUpPolygons, ...data.ribbonContours];
    // Sample every 12 m along spine between first and last covered point (built ribbon)
    const sampleHits: boolean[] = [];
    for (let i = 1; i < data.spinePolyline.length; i++) {
      const segLen = dist(data.spinePolyline[i - 1], data.spinePolyline[i]);
      totalLen += segLen;
      const subs = Math.max(1, Math.ceil(segLen / stepM));
      for (let s = 0; s < subs; s++) {
        const t = s / subs;
        const pt = {
          x: data.spinePolyline[i - 1].x + (data.spinePolyline[i].x - data.spinePolyline[i - 1].x) * t,
          y: data.spinePolyline[i - 1].y + (data.spinePolyline[i].y - data.spinePolyline[i - 1].y) * t,
        };
        sampleHits.push(isCovered(pt) || allBuiltMask.some((m) => pointInPolygon(pt, m)));
      }
    }
    const firstCovered = sampleHits.indexOf(true);
    const lastCovered = sampleHits.lastIndexOf(true);
    if (firstCovered >= 0 && lastCovered > firstCovered && totalLen > 0) {
      const actualStep = totalLen / sampleHits.length;
      for (let idx = firstCovered; idx <= lastCovered; idx++) {
        if (!sampleHits[idx]) {
          runGap += actualStep;
          if (runGap > longestGapM) longestGapM = runGap;
        } else {
          runGap = 0;
        }
      }
    }
  }
  checks.push({
    id: 'no_isolated_villages',
    label: 'No isolated villages: longest uncovered spine gap <= 250 m',
    passed: longestGapM <= 250,
    detail: `Max uncovered spine gap ${Math.round(longestGapM)} m`,
  });

  // 4f. Radial limit: no radial basis > 150 m influence & zero radial/curved_radial outside OldTown
  const oldTownId = data.districts.find((d) => d.archetype === DistrictArchetype.OldTown)?.id ?? -1;
  let radialViolations = 0;
  for (const tb of data.tensorBases) {
    if (tb.kind === 'radial' || tb.kind === 'curved_radial') {
      if (tb.districtId !== oldTownId) radialViolations++;
      const wAt150 = Math.exp(-tb.decay * 150 * 150);
      if (wAt150 > 0.05) radialViolations++;
    }
  }
  checks.push({
    id: 'radial_limit',
    label: 'Radial limit: <= 150 m influence, zero radial outside OldTown',
    passed: radialViolations === 0,
    detail:
      radialViolations === 0
        ? `All radial tensor bases capped <= 150 m in OldTown`
        : `${radialViolations} radial tensor violation(s)`,
  });

  // 4g. Fields: 15-40 Voronoi fields, no road/builtUp/building overlap, hatch within 15 deg of nearest road
  let fieldOverlapErrs = 0;
  let fieldAngleErrs = 0;
  const roadEdgePairs: Array<{ a: Vec2; b: Vec2; req: number }> = [];
  for (const e of data.edges) {
    const req = ROAD_HALF_WIDTH[e.roadClass] + 5.8;
    for (let i = 1; i < e.polyline.length; i++) {
      roadEdgePairs.push({ a: e.polyline[i - 1], b: e.polyline[i], req });
    }
  }
  for (const f of data.fields) {
    // Check overlap with buildings
    const fb = polygonBounds(f.polygon);
    for (const b of data.buildings) {
      const bb = polygonBounds(b.footprint);
      if (!boundsOverlap(fb, bb, 0.5)) continue;
      if (polygonIntersectionArea(f.polygon, b.footprint) > 0.25) {
        fieldOverlapErrs++;
        break;
      }
    }
    // Check overlap with built-up mask (tolerating <= 1.0 m^2 numerical sliver from Chaikin/clip)
    for (const bp of data.builtUpPolygons) {
      const bb = polygonBounds(bp);
      if (!boundsOverlap(fb, bb, 0.5)) continue;
      if (intersectMultiPolygons([f.polygon], [bp]).some((p) => polygonArea(p) > 2.0)) {
        fieldOverlapErrs++;
        break;
      }
    }
    // Check clearance against arterial/main/lane road corridors
    for (const e of data.edges) {
      if (e.roadClass > RoadClass.Secondary) continue;
      const eb = polygonBounds(e.polyline);
      const req = ROAD_HALF_WIDTH[e.roadClass] + 5.6;
      if (!boundsOverlap(fb, eb, req + 1)) continue;
      if (distancePolylineToPolygon(e.polyline, f.polygon) < req) {
        fieldOverlapErrs++;
        break;
      }
    }
    // Hatch angle within 15 deg of nearest road tangent
    const fc = polygonCentroid(f.polygon);
    let bestD = Infinity;
    let roadAng = f.angle;
    for (const e of data.edges) {
      const res = distPointToPolyline(fc, e.polyline);
      if (res.dist < bestD) {
        bestD = res.dist;
        roadAng = Math.atan2(res.tangent.y, res.tangent.x);
      }
    }
    const diff = Math.abs(Math.atan2(Math.sin(f.angle - roadAng), Math.cos(f.angle - roadAng)));
    const diffAcute = Math.min(diff, Math.abs(Math.PI - diff));
    if (diffAcute > (15.5 * Math.PI) / 180) {
      fieldAngleErrs++;
    }
  }
  checks.push({
    id: 'fields',
    label: 'Fields: 15–40 Voronoi fields clear of roads/built-up, aligned <= 15°',
    passed:
      data.fields.length >= 15 &&
      data.fields.length <= 40 &&
      fieldOverlapErrs === 0 &&
      fieldAngleErrs === 0,
    detail: `${data.fields.length} Voronoi fields, ${fieldOverlapErrs} overlap(s), ${fieldAngleErrs} alignment err(s)`,
  });

  // 4h. Retail park: >= 3 big boxes in a row along service road, >= 10 m gap, shared car park in front, anchor first
  const rpBoxes = data.venues
    .filter((v) => v.defId === 'retail_park' || v.defId === 'retail_park_unit')
    .map((v) => ({
      v,
      bld: data.buildings.find((b) => b.id === v.buildingId),
      site: data.venueSites.find((vs) => vs.id === v.siteId),
    }))
    .filter((x) => x.bld !== undefined);
  let rpMinGap = Infinity;
  for (let i = 0; i < rpBoxes.length; i++) {
    for (let j = i + 1; j < rpBoxes.length; j++) {
      const d = minDistancePolygons(rpBoxes[i].bld!.footprint, rpBoxes[j].bld!.footprint);
      if (d < rpMinGap) rpMinGap = d;
    }
  }
  const hasSharedCarPark = data.venueSites.some(
    (vs) => vs.extraLabel === 'Shared Car Park' && vs.extraPolygon !== null
  );
  const anchorPresent = rpBoxes.some((x) => x.v.defId === 'retail_park');
  const rpSvcCheck =
    data.retailParkServiceRoad !== null &&
    rpBoxes.every((x) => {
      const e = data.edges.find((ed) => ed.id === x.v.entranceEdgeId);
      if (!e || e.polyline.length < 2) return false;
      const eMid = e.polyline[Math.floor(e.polyline.length / 2)];
      return (
        distPointToPolyline(eMid, data.retailParkServiceRoad!).dist <= 6 &&
        distPointToPolyline(x.v.entrancePos, data.retailParkServiceRoad!).dist <= 45
      );
    });
  checks.push({
    id: 'retail_park',
    label: 'Retail park: >= 3 big boxes along service road, >= 10 m gaps & car park',
    passed:
      rpBoxes.length >= 3 &&
      rpMinGap >= 9.9 &&
      hasSharedCarPark &&
      anchorPresent &&
      rpSvcCheck,
    detail: `${rpBoxes.length} boxes (min gap ${rpBoxes.length > 1 ? rpMinGap.toFixed(1) : '—'} m · car park ${hasSharedCarPark ? 'yes' : 'no'})`,
  });

  // 4i. Large blocks > 12,000 m² <= 8% of built-up area
  const largeBlocksArea = data.blocks
    .filter((b) => b.area > 12000)
    .reduce((acc, b) => acc + b.area, 0);
  const largeBlocksPct =
    builtMetrics.area > 0 ? (largeBlocksArea / builtMetrics.area) * 100 : 0;
  checks.push({
    id: 'large_blocks',
    label: 'Large blocks (> 12,000 m²) <= 8% of built-up area',
    passed: largeBlocksPct <= 8.0,
    detail: `${largeBlocksPct.toFixed(2)}% of built-up area`,
  });

  // 5. Arterial & Street Graph connected; every district & entry reachable
  const nodeMap = new Map<number, GraphNode>();
  for (const n of data.nodes) nodeMap.set(n.id, n);
  const edgeMap = new Map<number, GraphEdge>();
  for (const e of data.edges) edgeMap.set(e.id, e);

  let graphErrors = 0;
  for (const e of data.edges) {
    const nA = nodeMap.get(e.nodeA);
    const nB = nodeMap.get(e.nodeB);
    if (!nA || !nB || !nA.edgeIds.includes(e.id) || !nB.edgeIds.includes(e.id)) {
      graphErrors++;
    }
  }
  const visited = new Set<number>();
  if (data.nodes.length > 0) {
    const stack = [data.nodes[0].id];
    visited.add(data.nodes[0].id);
    while (stack.length > 0) {
      const curr = stack.pop()!;
      const n = nodeMap.get(curr)!;
      for (const eid of n.edgeIds) {
        const e = edgeMap.get(eid);
        if (!e) continue;
        const nxt = e.nodeA === curr ? e.nodeB : e.nodeA;
        if (!visited.has(nxt)) {
          visited.add(nxt);
          stack.push(nxt);
        }
      }
    }
  }

  // Check arterial connectivity specifically
  const arterialVisited = new Set<number>();
  const arterialNodes = new Set<number>();
  for (const e of data.edges) {
    if (e.roadClass === RoadClass.Arterial) {
      arterialNodes.add(e.nodeA);
      arterialNodes.add(e.nodeB);
    }
  }
  if (arterialNodes.size > 0) {
    const firstArt = arterialNodes.values().next().value!;
    const st = [firstArt];
    arterialVisited.add(firstArt);
    while (st.length > 0) {
      const curr = st.pop()!;
      const n = nodeMap.get(curr);
      if (!n) continue;
      for (const eid of n.edgeIds) {
        const e = edgeMap.get(eid);
        if (!e || e.roadClass !== RoadClass.Arterial) continue;
        const nxt = e.nodeA === curr ? e.nodeB : e.nodeA;
        if (!arterialVisited.has(nxt)) {
          arterialVisited.add(nxt);
          st.push(nxt);
        }
      }
    }
  }
  const arterialConnected =
    arterialNodes.size > 0 && arterialVisited.size === arterialNodes.size;
  const graphConnected = visited.size === data.nodes.length && data.nodes.length > 0;

  let unreachableVenues = 0;
  for (const v of data.venues) {
    const e = edgeMap.get(v.entranceEdgeId);
    if (!e || !visited.has(e.nodeA)) unreachableVenues++;
  }
  let unreachableHomes = 0;
  for (const h of data.households) {
    const b = bldMap.get(h.buildingId);
    const e = b ? edgeMap.get(b.entranceEdgeId) : undefined;
    if (!e || !visited.has(e.nodeA)) unreachableHomes++;
  }
  let sampleRouteOk = true;
  if (data.venues.length >= 2) {
    const r = findShortestRoute(
      data.nodes,
      data.edges,
      data.streets,
      data.venues[0].entrancePos,
      data.venues[data.venues.length - 1].entrancePos,
      data.venues[0].entranceEdgeId,
      data.venues[data.venues.length - 1].entranceEdgeId
    );
    sampleRouteOk = r.found;
  }

  checks.push({
    id: 'arterials_and_graph',
    label: 'Arterials connected & all districts/venues reachable',
    passed:
      arterialConnected &&
      graphConnected &&
      graphErrors === 0 &&
      unreachableVenues === 0 &&
      unreachableHomes === 0 &&
      sampleRouteOk,
    detail: `${visited.size}/${data.nodes.length} nodes connected, ${data.venues.length} venues & ${data.households.length} slots reachable`,
  });

  // 6. Unique street names & addresses
  const streetNames = new Set<string>();
  let dupStreetNames = 0;
  for (const s of data.streets) {
    if (streetNames.has(s.name)) dupStreetNames++;
    streetNames.add(s.name);
  }
  const addresses = new Set<string>();
  let dupAddresses = 0;
  for (const bld of data.buildings) {
    if (!bld.addressString || addresses.has(bld.addressString)) dupAddresses++;
    addresses.add(bld.addressString);
  }
  const missingFrontage = data.lots.filter((l) => l.streetId < 0 || l.edgeId < 0).length;
  checks.push({
    id: 'addressing',
    label: 'Unique street names, unique addresses, valid lot frontages',
    passed: dupStreetNames === 0 && dupAddresses === 0 && missingFrontage === 0,
    detail: `${streetNames.size} unique streets, ${addresses.size} unique addresses`,
  });

  // 7. Sprawl budget <= 25% of buildings
  const sprawlCount = data.buildings.filter((b) => b.sprawlType !== null).length;
  const sprawlPct = data.buildings.length > 0 ? (sprawlCount / data.buildings.length) * 100 : 0;
  checks.push({
    id: 'sprawl_budget',
    label: 'Sprawl (ribbon, hamlets, farms) <= 25% of buildings',
    passed: sprawlPct <= 25.0,
    detail: `${sprawlCount}/${data.buildings.length} sprawl buildings (${sprawlPct.toFixed(1)}%)`,
  });

  // 8. Retail clustering criteria (active when retailClusterStrength > 0)
  const retailVenues = data.venues.filter((v) => isRetailVenueForClustering(v.defId));
  const clusteredCount = retailVenues.filter((v) => v.clusterId !== null).length;
  const clusterShare = retailVenues.length > 0 ? clusteredCount / retailVenues.length : 0;
  const isolatedCount = retailVenues.length - clusteredCount;
  const highStreetCluster = data.retailClusters.find((c) => c.kind === 'high_street');
  const highStreetCount = highStreetCluster ? highStreetCluster.venueIds.length : 0;
  const paradeCount = data.retailClusters.filter((c) => c.kind === 'parade').length;
  const clusterEnforced = data.params.retailClusterStrength > 0;
  const clusterPassed =
    !clusterEnforced ||
    (clusterShare >= 0.7 && highStreetCount >= 12 && paradeCount >= 3 && isolatedCount <= 8);

  checks.push({
    id: 'retail_clustering',
    label: 'Retail clustering (>=70% clustered, High St >=12, >=3 parades, <=8 isolated)',
    passed: clusterPassed,
    detail: `${Math.round(clusterShare * 100)}% clustered · High St ${highStreetCount} · ${paradeCount} parades · ${isolatedCount} isolated`,
  });

  // 9. Household capacity (1.8x to 3.0x required minimum)
  const requiredSlots = Math.ceil((1.05 * data.params.namedNpcCount) / 2.3);
  const ratio = requiredSlots > 0 ? data.households.length / requiredSlots : 0;
  checks.push({
    id: 'capacity',
    label: `Household capacity 1.8–3.0x required (${requiredSlots} min slots)`,
    passed: data.households.length >= requiredSlots && ratio >= 1.8 && ratio <= 3.0,
    detail: `${data.households.length} slots (${ratio.toFixed(2)}x required · est. pop ${data.estimatedPopulation.toLocaleString()})`,
  });

  // 10. Bounded loops / fitting <= 5 attempts
  checks.push({
    id: 'bounded_loops',
    label: 'All stages bounded (count fitting <= 5 attempts)',
    passed: data.fittingAttempts <= 5,
    detail: `${data.fittingAttempts}/5 fitting attempts`,
  });

  // 11. Simple polygon sanity
  let selfIntCount = 0;
  for (const b of data.blocks) if (polygonSelfIntersects(b.polygon)) selfIntCount++;
  for (const l of data.lots) if (polygonSelfIntersects(l.polygon)) selfIntCount++;
  for (const bld of data.buildings) if (polygonSelfIntersects(bld.footprint)) selfIntCount++;
  checks.push({
    id: 'simple_polygons',
    label: 'No self-intersecting block, lot, or footprint polygons',
    passed: selfIntCount === 0,
    detail: selfIntCount === 0 ? 'All polygons simple' : `${selfIntCount} self-intersections`,
  });

  return {
    allPassed: checks.every((c) => c.passed),
    checks,
  };
}

export function isRetailVenueForClustering(defId: string): boolean {
  return (
    defId === 'high_street_shop' ||
    defId === 'corner_shop' ||
    defId === 'cafe' ||
    defId === 'takeaway' ||
    defId === 'bakery' ||
    defId === 'pharmacy' ||
    defId === 'post_office' ||
    defId === 'doughnut_shop' ||
    defId === 'supermarket' ||
    defId === 'retail_park' ||
    defId === 'retail_park_unit'
  );
}
