import test from 'node:test';
import assert from 'node:assert/strict';
import { fnv1a, SeededRng } from './rng';
import {
  catmullRomSpline,
  chaikinSmoothClosed,
  clipPolygonByHalfPlane,
  computeMstEdges,
  computePcaAspectRatio,
  dbscanPoints,
  distancePolylineToPolygon,
  minTurningRadius,
  offsetPolygon,
  pointInPolygon,
  polygonArea,
  polygonInsidePolygon,
  polygonIntersectionArea,
  polygonSelfIntersects,
  satPolygonsOverlap,
  unionPolygonsMetrics,
} from './geom';
import { SpatialHash } from './spatialHash';
import { evaluateTensorField, sampleTensorDirection } from './tensor';
import { extractPlanarFaces } from './halfEdge';
import { findShortestRoute } from './dijkstra';
import { GraphEdge, GraphNode, ROAD_SPEED_KPH, RoadClass, Street, TensorBasis } from '../model/types';

test('FNV-1a and SeededRng streams are deterministic and isolated by stage', () => {
  assert.equal(fnv1a(1042, 'boundary'), fnv1a(1042, 'boundary'));
  assert.notEqual(fnv1a(1042, 'boundary'), fnv1a(1042, 'venues'));

  const rngA = SeededRng.fromStage(1042, 'streets');
  const rngB = SeededRng.fromStage(1042, 'streets');
  for (let i = 0; i < 10; i++) {
    assert.equal(rngA.next(), rngB.next());
  }
});

test('Tensor field eigen direction and Gaussian blending behave accurately', () => {
  const angle45 = Math.PI / 4;
  const bases: TensorBasis[] = [
    {
      kind: 'grid',
      center: { x: 0, y: 0 },
      angle: angle45,
      size: 60,
      strength: 1,
      decay: 0.0001,
      warpStrength: 0,
    },
  ];
  const dir = sampleTensorDirection(bases, { x: 10, y: 10 }, 'major', null);
  assert.ok(dir);
  assert.ok(Math.abs(dir.x - Math.cos(angle45)) < 1e-5);
  assert.ok(Math.abs(dir.y - Math.sin(angle45)) < 1e-5);

  const minor = sampleTensorDirection(bases, { x: 10, y: 10 }, 'minor', null);
  assert.ok(minor);
  const dotProd = dir.x * minor.x + dir.y * minor.y;
  assert.ok(Math.abs(dotProd) < 1e-5);

  const orthoBases: TensorBasis[] = [
    { kind: 'grid', center: { x: -50, y: 0 }, angle: 0, size: 50, strength: 1, decay: 0.001, warpStrength: 0 },
    { kind: 'grid', center: { x: 50, y: 0 }, angle: Math.PI / 2, size: 50, strength: 1, decay: 0.001, warpStrength: 0 },
  ];
  const midT = evaluateTensorField(orthoBases, { x: 0, y: 0 });
  assert.ok(Math.hypot(midT.a, midT.b) < 1e-6);
});

test('SpatialHash radius and bounds queries locate nearby points', () => {
  const hash = new SpatialHash<string>(20);
  hash.insertPoint({ x: 10, y: 10 }, 'a');
  hash.insertPoint({ x: 55, y: 55 }, 'b');
  assert.equal(hash.hasWithin({ x: 14, y: 12 }, 8), true);
  assert.equal(hash.hasWithin({ x: 14, y: 12 }, 2), false);
  const hits = hash.queryRadius({ x: 50, y: 50 }, 10);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].item, 'b');
});

test('Geometry clipping, exact overlap (convex & concave), containment, and road distance', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  assert.equal(polygonSelfIntersects(square), false);
  assert.equal(pointInPolygon({ x: 50, y: 50 }, square), true);
  assert.equal(pointInPolygon({ x: 120, y: 50 }, square), false);

  const clipped = clipPolygonByHalfPlane(square, { x: 50, y: 0 }, { x: 1, y: 0 });
  assert.equal(Math.round(polygonArea(clipped)), 5000);

  const inset = offsetPolygon(square, 10);
  assert.equal(Math.round(polygonArea(inset)), 6400);

  const sq2 = [
    { x: 60, y: 60 },
    { x: 140, y: 60 },
    { x: 140, y: 140 },
    { x: 60, y: 140 },
  ];
  assert.ok(Math.abs(polygonIntersectionArea(square, sq2) - 1600) < 1e-3);
  assert.equal(satPolygonsOverlap(square, sq2), true);
  assert.equal(
    satPolygonsOverlap(square, [
      { x: 120, y: 0 },
      { x: 160, y: 0 },
      { x: 160, y: 40 },
      { x: 120, y: 40 },
    ]),
    false
  );

  // Concave L-shape exact intersection
  const lShape = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 40 },
    { x: 40, y: 40 },
    { x: 40, y: 100 },
    { x: 0, y: 100 },
  ];
  const innerBox = [
    { x: 10, y: 10 },
    { x: 30, y: 10 },
    { x: 30, y: 30 },
    { x: 10, y: 30 },
  ];
  assert.equal(polygonInsidePolygon(innerBox, lShape, 0.05), true);
  assert.ok(Math.abs(polygonIntersectionArea(lShape, innerBox) - 400) < 1e-2);

  const dRoad = distancePolylineToPolygon(
    [{ x: -10, y: 0 }, { x: -10, y: 100 }],
    square
  );
  assert.ok(Math.abs(dRoad - 10) < 1e-3);
});

test('Spine spline, turning radius, Chaikin, union metrics, and PCA aspect ratio work accurately', () => {
  const straight = catmullRomSpline(
    [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 400, y: 0 },
      { x: 600, y: 0 },
    ],
    10
  );
  assert.ok(straight.length > 20);
  assert.equal(minTurningRadius(straight), Infinity);

  const smoothed = chaikinSmoothClosed(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    2
  );
  assert.ok(smoothed.length > 10);

  const elong = [
    { x: -300, y: -20 },
    { x: 0, y: 10 },
    { x: 300, y: 20 },
    { x: 150, y: -15 },
    { x: -150, y: 15 },
  ];
  assert.ok(computePcaAspectRatio(elong) > 5.0);

  const metrics = unionPolygonsMetrics([
    [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 50 },
      { x: 0, y: 50 },
    ],
  ]);
  assert.ok(metrics.area > 19000);
  assert.ok(metrics.roundness < 0.45);
});

test('MST and DBSCAN produce expected spanning tree and clusters', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const mst = computeMstEdges(pts);
  assert.equal(mst.length, 3);

  const clusterPts = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 40, y: 0 },
    { x: 55, y: 10 },
    { x: 500, y: 500 },
  ];
  const db = dbscanPoints(clusterPts, 60, 4);
  assert.equal(db.clusters.length, 1);
  assert.equal(db.clusters[0].length, 4);
  assert.deepEqual(db.noise, [4]);
});

test('Half-edge face extraction extracts 2 triangles from a square with diagonal', () => {
  const nodes: GraphNode[] = [
    { id: 0, pos: { x: 0, y: 0 }, edgeIds: [0, 3, 4] },
    { id: 1, pos: { x: 100, y: 0 }, edgeIds: [0, 1] },
    { id: 2, pos: { x: 100, y: 100 }, edgeIds: [1, 2, 4] },
    { id: 3, pos: { x: 0, y: 100 }, edgeIds: [2, 3] },
  ];
  const edges: GraphEdge[] = [
    { id: 0, nodeA: 0, nodeB: 1, streetId: 0, traceId: 1, roadClass: RoadClass.Main, speedKph: ROAD_SPEED_KPH[RoadClass.Main], isCulDeSac: false, polyline: [nodes[0].pos, nodes[1].pos], length: 100 },
    { id: 1, nodeA: 1, nodeB: 2, streetId: 0, traceId: 1, roadClass: RoadClass.Main, speedKph: ROAD_SPEED_KPH[RoadClass.Main], isCulDeSac: false, polyline: [nodes[1].pos, nodes[2].pos], length: 100 },
    { id: 2, nodeA: 2, nodeB: 3, streetId: 0, traceId: 1, roadClass: RoadClass.Main, speedKph: ROAD_SPEED_KPH[RoadClass.Main], isCulDeSac: false, polyline: [nodes[2].pos, nodes[3].pos], length: 100 },
    { id: 3, nodeA: 3, nodeB: 0, streetId: 0, traceId: 1, roadClass: RoadClass.Main, speedKph: ROAD_SPEED_KPH[RoadClass.Main], isCulDeSac: false, polyline: [nodes[3].pos, nodes[0].pos], length: 100 },
    { id: 4, nodeA: 0, nodeB: 2, streetId: 1, traceId: 2, roadClass: RoadClass.Secondary, speedKph: ROAD_SPEED_KPH[RoadClass.Secondary], isCulDeSac: false, polyline: [nodes[0].pos, nodes[2].pos], length: Math.SQRT2 * 100 },
  ];
  const faces = extractPlanarFaces(nodes, edges);
  assert.equal(faces.length, 2);
  const totalArea = faces.reduce((acc, f) => acc + f.signedArea, 0);
  assert.ok(Math.abs(totalArea - 10000) < 1);
});

test('Binary-heap Dijkstra finds shortest path through virtual entrance projections', () => {
  const nodes: GraphNode[] = [
    { id: 0, pos: { x: 0, y: 0 }, edgeIds: [0, 1] },
    { id: 1, pos: { x: 100, y: 0 }, edgeIds: [0, 2] },
    { id: 2, pos: { x: 0, y: 100 }, edgeIds: [1, 2] },
  ];
  const edges: GraphEdge[] = [
    { id: 0, nodeA: 0, nodeB: 1, streetId: 0, traceId: 1, roadClass: RoadClass.Arterial, speedKph: ROAD_SPEED_KPH[RoadClass.Arterial], isCulDeSac: false, polyline: [nodes[0].pos, nodes[1].pos], length: 100 },
    { id: 1, nodeA: 0, nodeB: 2, streetId: 1, traceId: 2, roadClass: RoadClass.Main, speedKph: ROAD_SPEED_KPH[RoadClass.Main], isCulDeSac: false, polyline: [nodes[0].pos, nodes[2].pos], length: 100 },
    { id: 2, nodeA: 1, nodeB: 2, streetId: 2, traceId: 3, roadClass: RoadClass.Lane, speedKph: ROAD_SPEED_KPH[RoadClass.Lane], isCulDeSac: false, polyline: [nodes[1].pos, nodes[2].pos], length: Math.SQRT2 * 100 },
  ];
  const streets: Street[] = [
    { id: 0, name: 'High Street', roadClass: RoadClass.Arterial, speedKph: ROAD_SPEED_KPH[RoadClass.Arterial], isCulDeSac: false, edgeIds: [0], traceIds: [1], polyline: edges[0].polyline },
    { id: 1, name: 'Mill Lane', roadClass: RoadClass.Main, speedKph: ROAD_SPEED_KPH[RoadClass.Main], isCulDeSac: false, edgeIds: [1], traceIds: [2], polyline: edges[1].polyline },
    { id: 2, name: 'Church Walk', roadClass: RoadClass.Lane, speedKph: ROAD_SPEED_KPH[RoadClass.Lane], isCulDeSac: false, edgeIds: [2], traceIds: [3], polyline: edges[2].polyline },
  ];

  const route = findShortestRoute(
    nodes,
    edges,
    streets,
    { x: 50, y: 2 },
    { x: 2, y: 50 },
    0,
    1
  );
  assert.equal(route.found, true);
  assert.ok(route.distanceMeters > 90 && route.distanceMeters < 110);
  assert.ok(route.walkingMinutes > 0.5);
  assert.deepEqual(route.streetNames, ['High Street', 'Mill Lane']);
});
