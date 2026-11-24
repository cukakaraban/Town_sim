import {
  computePcaAspectRatio,
  distToNearestPolyline,
  distancePolylineToPolygon,
  minTurningRadius,
  polygonBounds,
  polylineLength,
  satPolygonsOverlap,
  unionPolygonsMetrics,
} from '../src/town/geometry/geom';
import { createDefaultParams, generateTownSync } from '../src/town/generator/pipeline';
import { runInvariants } from '../src/town/generator/invariants';
import { ROAD_HALF_WIDTH, TownPreset } from '../src/town/model/types';

const PRESETS = [
  TownPreset.MarketTown,
  TownPreset.IndustrialTown,
  TownPreset.PostWarEstate,
  TownPreset.CommuterTown,
];

function checkIndependentSatOverlaps(
  footprints: readonly { id: number; centroid: { x: number; y: number }; footprint: { x: number; y: number }[] }[]
): number {
  let overlaps = 0;
  const boxes = footprints.map((b) => polygonBounds(b.footprint));
  for (let i = 0; i < footprints.length; i++) {
    const ba = boxes[i];
    for (let j = i + 1; j < footprints.length; j++) {
      const bb = boxes[j];
      if (
        ba.maxX < bb.minX - 0.05 ||
        bb.maxX < ba.minX - 0.05 ||
        ba.maxY < bb.minY - 0.05 ||
        bb.maxY < ba.minY - 0.05
      ) {
        continue;
      }
      if (satPolygonsOverlap(footprints[i].footprint, footprints[j].footprint, 0.02)) {
        overlaps++;
      }
    }
  }
  return overlaps;
}

function checkRoadViolations(
  buildings: readonly { footprint: { x: number; y: number }[] }[],
  edges: readonly { roadClass: keyof typeof ROAD_HALF_WIDTH; polyline: { x: number; y: number }[] }[]
): number {
  let bad = 0;
  for (const b of buildings) {
    const bb = polygonBounds(b.footprint);
    for (const e of edges) {
      const eb = polygonBounds(e.polyline);
      const req = ROAD_HALF_WIDTH[e.roadClass] + 1.0 - 1e-3;
      if (
        bb.maxX < eb.minX - req - 1 ||
        bb.minX > eb.maxX + req + 1 ||
        bb.maxY < eb.minY - req - 1 ||
        bb.minY > eb.maxY + req + 1
      ) {
        continue;
      }
      if (distancePolylineToPolygon(e.polyline, b.footprint) < req) {
        bad++;
        break;
      }
    }
  }
  return bad;
}

function main(): void {
  let passedCount = 0;
  let totalSatOverlaps = 0;
  let totalRoadBad = 0;
  let totalMs = 0;
  let maxMs = 0;
  let minPca = Infinity;
  let sumPca = 0;
  let maxRoundness = 0;
  let minBuildings = Infinity;
  let maxBuildings = 0;
  const failingSeeds: Array<{ seed: number; reasons: string[] }> = [];

  console.log(
    'seed | shape      | bldgs | satOv | rd<1m | PCA   | round | <=300m | sinuosities      | minR  | clusters             | hh/pop        | time  | status'
  );
  console.log('-'.repeat(156));

  for (let seed = 1; seed <= 50; seed++) {
    const preset = PRESETS[(seed - 1) % PRESETS.length];
    const params = createDefaultParams({
      seed,
      preset,
      coreDistrictCount: seed % 3 === 0 ? 3 : 2,
      satelliteCount: seed % 2 === 0 ? 4 : 3,
    });

    const t0 = performance.now();
    const town = generateTownSync(params);
    const dt = performance.now() - t0;

    totalMs += dt;
    if (dt > maxMs) maxMs = dt;

    const satOv = checkIndependentSatOverlaps(town.buildings);
    const rdBad = checkRoadViolations(town.buildings, town.edges);
    totalSatOverlaps += satOv;
    totalRoadBad += rdBad;

    const pca = computePcaAspectRatio(town.buildings.map((b) => b.centroid));
    sumPca += pca;
    if (pca < minPca) minPca = pca;

    const roundness = unionPolygonsMetrics(town.builtUpPolygons).roundness;
    if (roundness > maxRoundness) maxRoundness = roundness;

    const bCount = town.buildings.length;
    if (bCount < minBuildings) minBuildings = bCount;
    if (bCount > maxBuildings) maxBuildings = bCount;

    const within300 = town.buildings.filter(
      (b) => distToNearestPolyline(town.arterialPolylines, b.centroid) <= 300
    ).length;
    const share300 = bCount > 0 ? (within300 / bCount) * 100 : 0;

    const sinuosities = town.arterialPolylines.map((p) => {
      const len = polylineLength(p);
      const chord = Math.hypot(p[p.length - 1].x - p[0].x, p[p.length - 1].y - p[0].y);
      return (len / Math.max(1, chord)).toFixed(3);
    });
    const minTurnR = Math.min(...town.arterialPolylines.map((p) => minTurningRadius(p, 16)));

    const clusterStr = town.retailClusters
      .map((c) => `${c.kind === 'high_street' ? 'HS' : c.kind === 'retail_park' ? 'RP' : 'P'}:${c.venueIds.length}`)
      .join(' ');

    const report = runInvariants(town);
    const reasons = report.checks.filter((c) => !c.passed).map((c) => `${c.id}(${c.detail})`);
    if (satOv > 0) reasons.push(`SAT_overlaps=${satOv}`);
    if (rdBad > 0) reasons.push(`road<1m=${rdBad}`);

    const ok = reasons.length === 0;
    if (ok) passedCount++;
    else failingSeeds.push({ seed, reasons });

    console.log(
      `${String(seed).padStart(4)} | ${town.resolvedTownShape.padEnd(10)} | ${String(bCount).padStart(5)} | ${String(satOv).padStart(5)} | ${String(rdBad).padStart(5)} | ${pca.toFixed(2).padStart(5)} | ${roundness.toFixed(3).padStart(5)} | ${share300.toFixed(1).padStart(5)}% | ${sinuosities.join(',').padEnd(16)} | ${String(Math.round(minTurnR)).padStart(4)}m | ${clusterStr.padEnd(20)} | ${String(town.households.length).padStart(4)}/${String(town.estimatedPopulation).padStart(4)} | ${Math.round(dt).toString().padStart(4)}ms | ${ok ? 'PASS' : 'FAIL: ' + reasons.join('; ')}`
    );
  }

  const avgPca = sumPca / 50;
  const avgMs = totalMs / 50;

  console.log('-'.repeat(156));
  console.log(
    `SUMMARY: ${passedCount}/50 invariants+SAT passed | Buildings [${minBuildings}, ${maxBuildings}] | SAT overlaps=${totalSatOverlaps} | Road<1m=${totalRoadBad} | PCA avg=${avgPca.toFixed(2)} min=${minPca.toFixed(2)} | Max roundness=${maxRoundness.toFixed(3)} | Time avg=${avgMs.toFixed(0)}ms max=${maxMs.toFixed(0)}ms`
  );

  if (failingSeeds.length > 0) {
    console.log('Failures:', JSON.stringify(failingSeeds, null, 2));
  }

  const gatesPass =
    passedCount === 50 &&
    totalSatOverlaps === 0 &&
    totalRoadBad === 0 &&
    avgPca >= 2.2 &&
    minPca >= 1.8 &&
    maxMs < 6000;

  if (!gatesPass) {
    process.exitCode = 1;
  }
}

main();
