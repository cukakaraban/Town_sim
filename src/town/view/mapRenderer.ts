import {
  BlockKind,
  Building,
  BuildingKind,
  District,
  GraphEdge,
  MapTheme,
  RoadClass,
  RouteResult,
  StopReason,
  Street,
  TownData,
  Vec2,
  Venue,
} from '../model/types';
import { polygonBounds, polygonCentroid } from '../geometry/geom';
import { sampleTensorDirection } from '../geometry/tensor';

export interface MapLayerOptions {
  showDistrictTints: boolean;
  showGreenbelt: boolean;
  showVenueSites: boolean;
  showRetailClusters: boolean;
  showLotBoundaries: boolean;
  showVenuePins: boolean;
  showStreetLabels: boolean;
  showDistrictLabels: boolean;
  showSpineAndUrbanity: boolean;
  debugTensorField: boolean;
  debugStreamlines: boolean;
  debugGraph: boolean;
  debugFaces: boolean;
  debugLotFrontage: boolean;
  debugOverlaps: boolean;
}

export const DEFAULT_LAYER_OPTIONS: MapLayerOptions = {
  showDistrictTints: true,
  showGreenbelt: true,
  showVenueSites: true,
  showRetailClusters: true,
  showLotBoundaries: true,
  showVenuePins: true,
  showStreetLabels: true,
  showDistrictLabels: true,
  showSpineAndUrbanity: false,
  debugTensorField: false,
  debugStreamlines: false,
  debugGraph: false,
  debugFaces: false,
  debugLotFrontage: false,
  debugOverlaps: false,
};

export interface MapCamera {
  x: number; // world center X
  y: number; // world center Y
  zoom: number; // pixels per world meter
}

const BAKE_MAX_PX = 3072;

function getBakeBounds(town: TownData): {
  minX: number;
  minY: number;
  width: number;
  height: number;
  canvasW: number;
  canvasH: number;
  scale: number;
} {
  const b = polygonBounds(town.domainPolygon);
  const pad = 90;
  const minX = b.minX - pad;
  const minY = b.minY - pad;
  const width = Math.max(1200, b.width + pad * 2);
  const height = Math.max(1200, b.height + pad * 2);
  const scale = BAKE_MAX_PX / Math.max(width, height);
  return {
    minX,
    minY,
    width,
    height,
    canvasW: Math.round(width * scale),
    canvasH: Math.round(height * scale),
    scale,
  };
}

function tracePoly(ctx: CanvasRenderingContext2D, poly: readonly Vec2[]): void {
  if (poly.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) {
    ctx.lineTo(poly[i].x, poly[i].y);
  }
  ctx.closePath();
}

function tracePolyline(ctx: CanvasRenderingContext2D, pts: readonly Vec2[]): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
}

function drawHatchedPolygon(
  ctx: CanvasRenderingContext2D,
  poly: readonly Vec2[],
  fillColor: string,
  hatchColor: string,
  angle: number,
  spacing = 8
): void {
  if (poly.length < 3) return;
  ctx.save();
  tracePoly(ctx, poly);
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.clip();

  const b = polygonBounds(poly);
  const cx = (b.minX + b.maxX) * 0.5;
  const cy = (b.minY + b.maxY) * 0.5;
  const diag = Math.hypot(b.width, b.height) * 0.65;

  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.strokeStyle = hatchColor;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (let x = -diag; x <= diag; x += spacing) {
    ctx.moveTo(x, -diag);
    ctx.lineTo(x, diag);
  }
  ctx.stroke();
  ctx.restore();

  tracePoly(ctx, poly);
  ctx.strokeStyle = hatchColor;
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

/**
 * Bakes static ground, greenbelt fields/woodlands/hedgerows, blocks, venue sites,
 * roads (including Arterials), buildings, and trees onto an offscreen canvas.
 */
export function bakeStaticMapLayer(
  town: TownData,
  theme: MapTheme,
  options: Pick<
    MapLayerOptions,
    'showDistrictTints' | 'showGreenbelt' | 'showVenueSites' | 'showLotBoundaries'
  >
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const bb = getBakeBounds(town);
  canvas.width = bb.canvasW;
  canvas.height = bb.canvasH;
  const ctx = canvas.getContext('2d')!;

  // Continuous countryside outside domain
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, bb.canvasW, bb.canvasH);

  ctx.save();
  ctx.scale(bb.scale, bb.scale);
  ctx.translate(-bb.minX, -bb.minY);

  // 1. Town domain ground (seamless countryside without hard oval/box border)
  tracePoly(ctx, town.domainPolygon);
  ctx.fillStyle = theme.ground;
  ctx.fill();

  // 2. Greenbelt Fields, Woodlands & Hedgerows (outside urban built-up mask)
  if (options.showGreenbelt) {
    for (const f of town.fields) {
      drawHatchedPolygon(ctx, f.polygon, theme.fieldFill, theme.fieldHatch, f.angle, 9);
    }
    for (const w of town.woodlands) {
      tracePoly(ctx, w);
      ctx.fillStyle = theme.woodlandFill;
      ctx.fill();
      ctx.strokeStyle = theme.hedgerowColor;
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
    ctx.strokeStyle = theme.hedgerowColor;
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [a, b] of town.hedgerows) {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  // 3. District built-up tints
  if (options.showDistrictTints) {
    for (const d of town.districts) {
      const polys = d.polygons && d.polygons.length > 0 ? d.polygons : [d.polygon];
      ctx.fillStyle = theme.districtPalette[d.archetype];
      for (const poly of polys) {
        if (poly.length < 3) continue;
        tracePoly(ctx, poly);
        ctx.fill();
      }
    }
  }

  // 4. Blocks (Field, Green/Park, Built)
  const parkBlockIds = new Set<number>();
  for (const v of town.venues) {
    if (v.buildingId === null) parkBlockIds.add(v.blockId);
  }

  for (const blk of town.blocks) {
    if (blk.kind === BlockKind.Field) {
      drawHatchedPolygon(ctx, blk.polygon, theme.fieldFill, theme.fieldHatch, 0.45, 7);
    } else if (blk.kind === BlockKind.Green) {
      tracePoly(ctx, blk.polygon);
      ctx.fillStyle = parkBlockIds.has(blk.id) ? theme.parkBlock : theme.greenBlock;
      ctx.fill();
    } else {
      tracePoly(ctx, blk.polygon);
      ctx.fillStyle = theme.builtBlock;
      ctx.fill();
    }
  }

  // 5. Pre-reserved Venue Sites & Yards/Carparks
  if (options.showVenueSites) {
    for (const vs of town.venueSites) {
      tracePoly(ctx, vs.sitePolygon);
      ctx.fillStyle = theme.venueSiteFill;
      ctx.fill();
      ctx.strokeStyle = theme.venueSiteStroke;
      ctx.lineWidth = 0.7;
      ctx.stroke();

      if (vs.extraPolygon && vs.extraPolygon.length >= 3) {
        tracePoly(ctx, vs.extraPolygon);
        ctx.fillStyle =
          vs.extraLabel === 'Playground' || vs.extraLabel === 'Beer Garden' || vs.extraLabel === 'Churchyard'
            ? theme.greenBlock
            : theme.venueSiteFill;
        ctx.fill();
        ctx.strokeStyle = theme.venueSiteStroke;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }
  }

  // Subtle lot plot lines
  if (options.showLotBoundaries) {
    ctx.strokeStyle = theme.domainBorder;
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = 0.45;
    for (const lot of town.lots) {
      tracePoly(ctx, lot.polygon);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // 6. Streets (Road hierarchy: Lanes -> Secondary -> Main -> Arterial)
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const drawEdgesByClass = (
    roadClass: RoadClass,
    color: string,
    width: number
  ) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (const e of town.edges) {
      if (e.roadClass !== roadClass) continue;
      tracePolyline(ctx, e.polyline);
      ctx.stroke();
    }
  };

  drawEdgesByClass(RoadClass.Lane, theme.roadLaneFill, 3.6);
  drawEdgesByClass(RoadClass.Secondary, theme.roadSecondaryCasing, 7.2);
  drawEdgesByClass(RoadClass.Secondary, theme.roadSecondaryFill, 5.2);
  drawEdgesByClass(RoadClass.Main, theme.roadMainCasing, 11.4);
  drawEdgesByClass(RoadClass.Main, theme.roadMainFill, 8.6);
  drawEdgesByClass(RoadClass.Arterial, theme.roadArterialCasing, 16.8);
  drawEdgesByClass(RoadClass.Arterial, theme.roadArterialFill, 12.6);

  // 7. Building shadows
  ctx.fillStyle = theme.buildingShadow;
  ctx.save();
  ctx.translate(1.6, 1.8);
  for (const b of town.buildings) {
    tracePoly(ctx, b.footprint);
    ctx.fill();
  }
  ctx.restore();

  // 8. Buildings tinted by district or venue
  const districtsById = new Map<number, District>();
  for (const d of town.districts) districtsById.set(d.id, d);

  ctx.lineWidth = 0.65;
  ctx.strokeStyle = theme.buildingStroke;
  for (const b of town.buildings) {
    tracePoly(ctx, b.footprint);
    if (b.kind === BuildingKind.Venue) {
      ctx.fillStyle = theme.buildingVenueFill;
    } else if (b.kind === BuildingKind.Other) {
      ctx.fillStyle = theme.venueSiteStroke;
    } else {
      const distObj = districtsById.get(b.districtId);
      ctx.fillStyle = distObj
        ? theme.buildingDistrictPalette[distObj.archetype]
        : theme.builtBlock;
    }
    ctx.fill();
    ctx.stroke();
  }

  // 9. Tree clusters (woodlands & park blocks)
  if (options.showGreenbelt) {
    for (const cluster of town.treeClusters) {
      for (const tree of cluster.trees) {
        ctx.beginPath();
        ctx.arc(tree.x + 0.8, tree.y + 0.9, tree.r, 0, Math.PI * 2);
        ctx.fillStyle = theme.treeCanopyDark;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(tree.x, tree.y, tree.r * 0.92, 0, Math.PI * 2);
        ctx.fillStyle = theme.treeCanopy;
        ctx.fill();
      }
    }
  }

  ctx.restore();
  return canvas;
}

const STOP_REASON_COLORS: Record<StopReason, string> = {
  [StopReason.OutOfDomain]: '#0284C7',
  [StopReason.OutOfBuiltUp]: '#0D9488',
  [StopReason.Degenerate]: '#DC2626',
  [StopReason.TooClose]: '#D97706',
  [StopReason.Loop]: '#7C3AED',
  [StopReason.MaxLength]: '#059669',
  [StopReason.MinLengthReject]: '#64748B',
};

function drawTextWithHalo(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string,
  halo: string,
  haloWidth = 3.2
): void {
  ctx.lineWidth = haloWidth;
  ctx.strokeStyle = halo;
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/**
 * Renders the interactive map with 3-tier zoom LOD across the 2.6 km polycentric extent.
 */
export function renderMapViewport(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bakedCanvas: HTMLCanvasElement,
  town: TownData,
  theme: MapTheme,
  camera: MapCamera,
  options: MapLayerOptions,
  state: {
    hoveredBuilding: Building | null;
    selectedBuilding: Building | null;
    selectedVenue: Venue | null;
    selectedStreet: Street | null;
    route: RouteResult | null;
    routeOrigin: Vec2 | null;
    routeDestination: Vec2 | null;
  }
): void {
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, width, height);

  const worldToScreen = (p: Vec2): Vec2 => ({
    x: width * 0.5 + (p.x - camera.x) * camera.zoom,
    y: height * 0.5 + (p.y - camera.y) * camera.zoom,
  });

  // 1. Blit baked static layer
  const bb = getBakeBounds(town);
  const topLeft = worldToScreen({ x: bb.minX, y: bb.minY });
  ctx.drawImage(
    bakedCanvas,
    topLeft.x,
    topLeft.y,
    bb.width * camera.zoom,
    bb.height * camera.zoom
  );

  // World-space dynamic overlays
  ctx.save();
  ctx.translate(width * 0.5, height * 0.5);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  // Spine & Urbanity Field Overlay
  if (options.showSpineAndUrbanity) {
    ctx.save();
    for (const rc of town.ribbonContours) {
      if (rc.length < 3) continue;
      tracePoly(ctx, rc);
      ctx.strokeStyle = 'rgba(29, 78, 95, 0.45)';
      ctx.lineWidth = 1.6 / camera.zoom;
      ctx.setLineDash([6 / camera.zoom, 4 / camera.zoom]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const bp of town.builtUpPolygons) {
      if (bp.length < 3) continue;
      tracePoly(ctx, bp);
      ctx.fillStyle = 'rgba(29, 78, 95, 0.08)';
      ctx.fill();
      ctx.strokeStyle = '#1D4E5F';
      ctx.lineWidth = 2.2 / camera.zoom;
      ctx.stroke();
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < town.arterialPolylines.length; i++) {
      tracePolyline(ctx, town.arterialPolylines[i]);
      ctx.strokeStyle = i === 0 ? '#C2593F' : '#D97706';
      ctx.lineWidth = (i === 0 ? 4.2 : 3.2) / camera.zoom;
      ctx.stroke();
    }
    for (const sn of town.settlementNodes) {
      ctx.beginPath();
      ctx.arc(sn.pos.x, sn.pos.y, (sn.kind === 'core' ? 9 : 6) / camera.zoom, 0, Math.PI * 2);
      ctx.fillStyle = sn.kind === 'core' ? '#C2593F' : sn.kind === 'lobe' ? '#7C3AED' : '#1D4E5F';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2 / camera.zoom;
      ctx.stroke();
    }
    ctx.restore();
  }

  // Retail Cluster Hulls
  if (options.showRetailClusters) {
    for (const rc of town.retailClusters) {
      if (rc.hull.length < 3) continue;
      tracePoly(ctx, rc.hull);
      ctx.fillStyle = theme.retailClusterFill;
      ctx.fill();
      ctx.save();
      ctx.setLineDash([6 / Math.max(0.25, camera.zoom), 4 / Math.max(0.25, camera.zoom)]);
      ctx.strokeStyle = theme.retailClusterStroke;
      ctx.lineWidth = 1.6 / camera.zoom;
      ctx.stroke();
      ctx.restore();
    }
  }

  // Debug: Overlap / containment violations
  if (options.debugOverlaps && town.overlapViolations.length > 0) {
    for (const ov of town.overlapViolations) {
      if (ov.polygon.length >= 3) {
        tracePoly(ctx, ov.polygon);
        ctx.fillStyle = 'rgba(220, 38, 38, 0.38)';
        ctx.fill();
        ctx.strokeStyle = '#DC2626';
        ctx.lineWidth = 2.5 / camera.zoom;
        ctx.stroke();
      }
    }
  }

  // Debug: Block faces
  if (options.debugFaces) {
    ctx.lineWidth = 1.4 / camera.zoom;
    for (const blk of town.blocks) {
      tracePoly(ctx, blk.polygon);
      ctx.strokeStyle = blk.kind === BlockKind.Built ? '#2563EB' : '#16A34A';
      ctx.stroke();
    }
  }

  // Debug: Streamlines colored by StopReason
  if (options.debugStreamlines) {
    ctx.lineWidth = 2.0 / camera.zoom;
    for (const tr of town.streamlines) {
      tracePolyline(ctx, tr.points);
      ctx.strokeStyle = STOP_REASON_COLORS[tr.stopReasonForward] ?? '#0284C7';
      ctx.stroke();

      const last = tr.points[tr.points.length - 1];
      ctx.beginPath();
      ctx.arc(last.x, last.y, 3.2 / camera.zoom, 0, Math.PI * 2);
      ctx.fillStyle = STOP_REASON_COLORS[tr.stopReasonForward] ?? '#0284C7';
      ctx.fill();
    }
  }

  // Debug: Tensor field glyphs
  if (options.debugTensorField) {
    const domB = polygonBounds(town.domainPolygon);
    const step = 76;
    ctx.lineWidth = 1.2 / camera.zoom;
    for (let y = domB.minY; y <= domB.maxY; y += step) {
      for (let x = domB.minX; x <= domB.maxX; x += step) {
        const p = { x, y };
        const maj = sampleTensorDirection(town.tensorBases, p, 'major', null);
        if (!maj) continue;
        const r = 14;
        ctx.strokeStyle = 'rgba(29, 78, 95, 0.72)';
        ctx.beginPath();
        ctx.moveTo(x - maj.x * r, y - maj.y * r);
        ctx.lineTo(x + maj.x * r, y + maj.y * r);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(194, 89, 63, 0.45)';
        ctx.beginPath();
        ctx.moveTo(x + maj.y * (r * 0.55), y - maj.x * (r * 0.55));
        ctx.lineTo(x - maj.y * (r * 0.55), y + maj.x * (r * 0.55));
        ctx.stroke();
      }
    }
  }

  // Debug: Planar graph nodes & edges
  if (options.debugGraph) {
    ctx.lineWidth = 1.5 / camera.zoom;
    ctx.strokeStyle = '#DC2626';
    for (const e of town.edges) {
      tracePolyline(ctx, e.polyline);
      ctx.stroke();
    }
    for (const n of town.nodes) {
      ctx.beginPath();
      ctx.arc(n.pos.x, n.pos.y, 2.8 / camera.zoom, 0, Math.PI * 2);
      ctx.fillStyle = n.edgeIds.length === 1 ? '#D97706' : '#DC2626';
      ctx.fill();
    }
  }

  // Debug: Lot frontage arrows
  if (options.debugLotFrontage) {
    ctx.strokeStyle = '#7C3AED';
    ctx.lineWidth = 1.2 / camera.zoom;
    for (const l of town.lots) {
      const c = polygonCentroid(l.polygon);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(l.frontageMidpoint.x, l.frontageMidpoint.y);
      ctx.stroke();
    }
  }

  // Selected Street highlight
  if (state.selectedStreet) {
    const edgeById = new Map<number, GraphEdge>();
    for (const e of town.edges) edgeById.set(e.id, e);
    ctx.strokeStyle = theme.selectionColor;
    ctx.lineWidth = Math.max(9.5, 4.5 / camera.zoom);
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.45;
    for (const eid of state.selectedStreet.edgeIds) {
      const e = edgeById.get(eid);
      if (!e) continue;
      tracePolyline(ctx, e.polyline);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Hovered Building
  if (state.hoveredBuilding && state.hoveredBuilding.id !== state.selectedBuilding?.id) {
    tracePoly(ctx, state.hoveredBuilding.footprint);
    ctx.strokeStyle = theme.hoverColor;
    ctx.lineWidth = 2.2 / camera.zoom;
    ctx.stroke();
  }

  // Selected Building
  if (state.selectedBuilding) {
    tracePoly(ctx, state.selectedBuilding.footprint);
    ctx.fillStyle = theme.selectionColor;
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.selectionColor;
    ctx.lineWidth = 2.8 / camera.zoom;
    ctx.stroke();
  }

  // Active Route Polyline
  if (state.route && state.route.found && state.route.polyline.length >= 2) {
    ctx.save();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 6.5 / camera.zoom;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    tracePolyline(ctx, state.route.polyline);
    ctx.stroke();

    ctx.strokeStyle = theme.routeLineColor;
    ctx.lineWidth = 3.8 / camera.zoom;
    ctx.setLineDash([8 / camera.zoom, 5 / camera.zoom]);
    tracePolyline(ctx, state.route.polyline);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();

  // 2. Screen-space 3-tier Zoom LOD typography, site tags & venue pins
  const placedLabelBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];
  const canPlaceBox = (cx: number, cy: number, w: number, h: number): boolean =>
    !placedLabelBoxes.some(
      (b) => Math.abs(b.x - cx) < (b.w + w) * 0.5 && Math.abs(b.y - cy) < (b.h + h) * 0.5
    );

  // Reserve Route Origin & Destination marker boxes first
  const routeMarkers: Array<{ pos: Vec2; label: string; bg: string }> = [];
  if (state.routeOrigin) {
    routeMarkers.push({ pos: state.routeOrigin, label: 'A', bg: '#1D4E5F' });
  }
  if (state.routeDestination) {
    routeMarkers.push({ pos: state.routeDestination, label: 'B', bg: '#C2593F' });
  }
  for (const rm of routeMarkers) {
    const sc = worldToScreen(rm.pos);
    placedLabelBoxes.push({ x: sc.x, y: sc.y, w: 28, h: 28 });
  }

  // Tier 1/2: District Labels (visible up to zoom < 1.6)
  if (options.showDistrictLabels && camera.zoom < 1.6) {
    ctx.save();
    ctx.font = `600 ${camera.zoom < 0.55 ? 13 : 14}px "Fraunces", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const d of town.districts) {
      if (d.polygon.length < 3) continue;
      const c = polygonCentroid(d.polygon);
      const sc = worldToScreen(c);
      if (sc.x < -80 || sc.x > width + 80 || sc.y < -40 || sc.y > height + 40) continue;
      const bw = d.name.length * 8 + 14;
      if (canPlaceBox(sc.x, sc.y, bw, 22)) {
        placedLabelBoxes.push({ x: sc.x, y: sc.y, w: bw, h: 22 });
        drawTextWithHalo(
          ctx,
          d.name,
          sc.x,
          sc.y,
          theme.districtLabelColor,
          theme.streetLabelHalo,
          4
        );
      }
    }
    ctx.restore();
  }

  // Tier 1/2: Retail Cluster Badges
  if (options.showRetailClusters && camera.zoom < 1.85) {
    ctx.save();
    ctx.font = `600 11px "Plus Jakarta Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const rc of town.retailClusters) {
      if (rc.hull.length < 3) continue;
      const c = polygonCentroid(rc.hull);
      const sc = worldToScreen(c);
      if (sc.x < -80 || sc.x > width + 80 || sc.y < -30 || sc.y > height + 30) continue;
      const txt = `${rc.name} (${rc.venueIds.length})`;
      const bw = txt.length * 6.4 + 12;
      const offsets = [0, -18, 18, -32, 32, -46, 46];
      let placedY: number | null = null;
      for (const dy of offsets) {
        if (canPlaceBox(sc.x, sc.y + dy, bw, 18)) {
          placedY = sc.y + dy;
          break;
        }
      }
      if (placedY !== null) {
        placedLabelBoxes.push({ x: sc.x, y: placedY, w: bw, h: 18 });
        drawTextWithHalo(
          ctx,
          txt,
          sc.x,
          placedY,
          theme.selectionColor,
          theme.streetLabelHalo,
          3.4
        );
      }
    }
    ctx.restore();
  }

  // Tier 3 Close Detail: Extra Yard/Car-Park tags
  if (options.showVenueSites && camera.zoom >= 1.35) {
    ctx.save();
    ctx.font = `500 10px "Plus Jakarta Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const vs of town.venueSites) {
      if (!vs.extraPolygon || !vs.extraLabel) continue;
      const c = polygonCentroid(vs.extraPolygon);
      const sc = worldToScreen(c);
      if (sc.x < -40 || sc.x > width + 40 || sc.y < -20 || sc.y > height + 20) continue;
      const bw = vs.extraLabel.length * 5.6 + 8;
      if (canPlaceBox(sc.x, sc.y, bw, 14)) {
        placedLabelBoxes.push({ x: sc.x, y: sc.y, w: bw, h: 14 });
        drawTextWithHalo(
          ctx,
          vs.extraLabel,
          sc.x,
          sc.y,
          theme.districtLabelColor,
          theme.streetLabelHalo,
          2.6
        );
      }
    }
    ctx.restore();
  }

  // Tier 3 Close Detail: House Numbers on footprints (zoom >= 2.2)
  if (camera.zoom >= 2.2) {
    ctx.save();
    ctx.font = `500 9px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of town.buildings) {
      if (b.address.number <= 0) continue;
      const sc = worldToScreen(b.centroid);
      if (sc.x < -10 || sc.x > width + 10 || sc.y < -10 || sc.y > height + 10) continue;
      const numTxt = String(b.address.number);
      if (canPlaceBox(sc.x, sc.y, numTxt.length * 6 + 4, 11)) {
        placedLabelBoxes.push({ x: sc.x, y: sc.y, w: numTxt.length * 6 + 4, h: 11 });
        drawTextWithHalo(
          ctx,
          numTxt,
          sc.x,
          sc.y,
          theme.streetLabelColor,
          theme.streetLabelHalo,
          2.4
        );
      }
    }
    ctx.restore();
  }

  // Venue Pins & non-overlapping labels (LOD filtered below zoom 0.55)
  if (options.showVenuePins) {
    ctx.save();
    ctx.font = `600 11px "Plus Jakarta Sans", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const orderedVenues = [...town.venues].sort((a, b) => {
      if (a.id === state.selectedVenue?.id) return 1;
      if (b.id === state.selectedVenue?.id) return -1;
      return 0;
    });

    for (const v of orderedVenues) {
      const isSelected = state.selectedVenue?.id === v.id;
      const isMajorPin = v.siteType !== 'frontage' || v.defId === 'town_square' || isSelected;
      if (camera.zoom < 0.55 && !isMajorPin) continue;

      const sc = worldToScreen(v.pos);
      if (sc.x < -30 || sc.x > width + 30 || sc.y < -30 || sc.y > height + 30) continue;

      const radius = isSelected ? 6.5 : camera.zoom < 0.55 ? 3.4 : 4.2;

      ctx.beginPath();
      ctx.arc(sc.x, sc.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? theme.selectionColor : theme.venuePinFill;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = theme.venuePinStroke;
      ctx.stroke();

      if (isSelected || camera.zoom >= 1.15) {
        const labelW = v.name.length * 6.4 + 10;
        const labelCx = sc.x + radius + 4 + labelW * 0.5;
        if (isSelected || canPlaceBox(labelCx, sc.y, labelW, 16)) {
          placedLabelBoxes.push({ x: labelCx, y: sc.y, w: labelW, h: 16 });
          drawTextWithHalo(
            ctx,
            v.name,
            sc.x + radius + 4,
            sc.y,
            theme.streetLabelColor,
            theme.streetLabelHalo,
            3
          );
        }
      }
    }
    ctx.restore();
  }

  // Street Labels with zoom LOD
  if (options.showStreetLabels && camera.zoom >= 0.55) {
    ctx.save();
    ctx.font = `500 11px "Plus Jakarta Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const sortedStreets = [...town.streets].sort((a, b) => a.roadClass - b.roadClass);
    for (const st of sortedStreets) {
      if (st.roadClass === RoadClass.Secondary && camera.zoom < 1.0) continue;
      if (st.roadClass === RoadClass.Lane && camera.zoom < 1.65) continue;
      if (st.polyline.length < 2) continue;

      const midIdx = Math.floor((st.polyline.length - 1) * 0.5);
      const a = st.polyline[midIdx];
      const b = st.polyline[Math.min(st.polyline.length - 1, midIdx + 1)];
      const worldMid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
      const sc = worldToScreen(worldMid);
      if (sc.x < -60 || sc.x > width + 60 || sc.y < -30 || sc.y > height + 30) continue;

      const labelW = st.name.length * 6.5 + 12;
      const labelH = 16;
      if (!canPlaceBox(sc.x, sc.y, labelW, labelH)) continue;
      placedLabelBoxes.push({ x: sc.x, y: sc.y, w: labelW, h: labelH });

      let angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (angle > Math.PI * 0.5) angle -= Math.PI;
      if (angle < -Math.PI * 0.5) angle += Math.PI;

      ctx.save();
      ctx.translate(sc.x, sc.y);
      ctx.rotate(angle);
      drawTextWithHalo(
        ctx,
        st.name,
        0,
        0,
        theme.streetLabelColor,
        theme.streetLabelHalo,
        3.2
      );
      ctx.restore();
    }
    ctx.restore();
  }

  // Draw Route Origin & Destination Badges on top
  for (const rm of routeMarkers) {
    const sc = worldToScreen(rm.pos);
    ctx.save();
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = rm.bg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();

    ctx.font = `700 11px "Plus Jakarta Sans", sans-serif`;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(rm.label, sc.x, sc.y + 0.5);
    ctx.restore();
  }
}

/**
 * Renders a crisp miniature thumbnail framing the full 3.8 × 2.0 km spine corridor for Seed Gallery.
 */
export function renderThumbnailToCanvas(
  canvas: HTMLCanvasElement,
  town: TownData,
  theme: MapTheme
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const b = polygonBounds(town.domainPolygon);
  const cx = (b.minX + b.maxX) * 0.5;
  const cy = (b.minY + b.maxY) * 0.5;
  const fitZoom = Math.min(w / Math.max(800, b.width * 1.04), h / Math.max(800, b.height * 1.04));

  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w * 0.5, h * 0.5);
  ctx.scale(fitZoom, fitZoom);
  ctx.translate(-cx, -cy);

  // Domain ground
  tracePoly(ctx, town.domainPolygon);
  ctx.fillStyle = theme.ground;
  ctx.fill();

  // Greenbelt fields & woodlands
  for (const f of town.fields) {
    tracePoly(ctx, f.polygon);
    ctx.fillStyle = theme.fieldFill;
    ctx.fill();
  }
  for (const wd of town.woodlands) {
    tracePoly(ctx, wd);
    ctx.fillStyle = theme.woodlandFill;
    ctx.fill();
  }

  // District tints
  for (const d of town.districts) {
    const polys = d.polygons && d.polygons.length > 0 ? d.polygons : [d.polygon];
    ctx.fillStyle = theme.districtPalette[d.archetype];
    for (const poly of polys) {
      if (poly.length < 3) continue;
      tracePoly(ctx, poly);
      ctx.fill();
    }
  }

  // Blocks
  for (const blk of town.blocks) {
    tracePoly(ctx, blk.polygon);
    ctx.fillStyle =
      blk.kind === BlockKind.Green
        ? theme.greenBlock
        : blk.kind === BlockKind.Field
        ? theme.fieldFill
        : theme.builtBlock;
    ctx.fill();
  }

  // Roads
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const drawClass = (rc: RoadClass, color: string, lw: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    for (const e of town.edges) {
      if (e.roadClass !== rc) continue;
      tracePolyline(ctx, e.polyline);
      ctx.stroke();
    }
  };
  drawClass(RoadClass.Lane, theme.roadLaneFill, 3.6);
  drawClass(RoadClass.Secondary, theme.roadSecondaryCasing, 7.6);
  drawClass(RoadClass.Secondary, theme.roadSecondaryFill, 4.8);
  drawClass(RoadClass.Main, theme.roadMainCasing, 12.2);
  drawClass(RoadClass.Main, theme.roadMainFill, 8.2);
  drawClass(RoadClass.Arterial, theme.roadArterialCasing, 20.0);
  drawClass(RoadClass.Arterial, theme.roadArterialFill, 14.0);

  // Buildings
  const districtsById = new Map<number, District>();
  for (const d of town.districts) districtsById.set(d.id, d);
  for (const b of town.buildings) {
    tracePoly(ctx, b.footprint);
    if (b.kind === BuildingKind.Venue) {
      ctx.fillStyle = theme.buildingVenueFill;
    } else {
      const dObj = districtsById.get(b.districtId);
      ctx.fillStyle = dObj
        ? theme.buildingDistrictPalette[dObj.archetype]
        : theme.builtBlock;
    }
    ctx.fill();
  }

  // Subtle retail cluster hulls
  for (const rc of town.retailClusters) {
    if (rc.hull.length < 3) continue;
    tracePoly(ctx, rc.hull);
    ctx.strokeStyle = theme.retailClusterStroke;
    ctx.lineWidth = 4.5;
    ctx.stroke();
  }

  // Trees
  for (const cluster of town.treeClusters) {
    for (const tree of cluster.trees) {
      ctx.beginPath();
      ctx.arc(tree.x, tree.y, tree.r, 0, Math.PI * 2);
      ctx.fillStyle = theme.treeCanopy;
      ctx.fill();
    }
  }

  ctx.restore();
}
