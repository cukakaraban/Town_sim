import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import {
  Building,
  MapTheme,
  RouteResult,
  Street,
  TownData,
  Vec2,
  Venue,
} from '../town/model/types';
import { PickResult, TownIndex } from '../town/model/townIndex';
import {
  MapCamera,
  MapLayerOptions,
  bakeStaticMapLayer,
  renderMapViewport,
} from '../town/view/mapRenderer';

interface MapCanvasProps {
  town: TownData;
  townIndex: TownIndex;
  theme: MapTheme;
  layerOptions: MapLayerOptions;
  camera: MapCamera;
  onCameraChange: (cam: MapCamera) => void;
  selectedBuilding: Building | null;
  selectedVenue: Venue | null;
  selectedStreet: Street | null;
  onPick: (pick: PickResult | null, worldPos: Vec2) => void;
  route: RouteResult | null;
  routeOrigin: Vec2 | null;
  routeDestination: Vec2 | null;
  onResetView: () => void;
}

const MIN_ZOOM = 0.14;
const MAX_ZOOM = 7.5;

export const MapCanvas: React.FC<MapCanvasProps> = ({
  town,
  townIndex,
  theme,
  layerOptions,
  camera,
  onCameraChange,
  selectedBuilding,
  selectedVenue,
  selectedStreet,
  onPick,
  route,
  routeOrigin,
  routeDestination,
  onResetView,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 960, height: 700 });
  const [hoveredBuilding, setHoveredBuilding] = useState<Building | null>(null);
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);

  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    camX: number;
    camY: number;
  }>({ active: false, moved: false, startX: 0, startY: 0, camX: 0, camY: 0 });

  // Resize observer for crisp HiDPI rendering
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Bake static layer when town, theme, or static layer flags change
  const bakedCanvas = useMemo(() => {
    return bakeStaticMapLayer(town, theme, {
      showDistrictTints: layerOptions.showDistrictTints,
      showGreenbelt: layerOptions.showGreenbelt,
      showVenueSites: layerOptions.showVenueSites,
      showLotBoundaries: layerOptions.showLotBoundaries,
    });
  }, [
    town,
    theme,
    layerOptions.showDistrictTints,
    layerOptions.showGreenbelt,
    layerOptions.showVenueSites,
    layerOptions.showLotBoundaries,
  ]);

  // Draw viewport
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    renderMapViewport(
      ctx,
      size.width,
      size.height,
      bakedCanvas,
      town,
      theme,
      camera,
      layerOptions,
      {
        hoveredBuilding,
        selectedBuilding,
        selectedVenue,
        selectedStreet,
        route,
        routeOrigin,
        routeDestination,
      }
    );
    ctx.restore();
  }, [
    size,
    bakedCanvas,
    town,
    theme,
    camera,
    layerOptions,
    hoveredBuilding,
    selectedBuilding,
    selectedVenue,
    selectedStreet,
    route,
    routeOrigin,
    routeDestination,
  ]);

  const screenToWorld = (sx: number, sy: number): Vec2 => ({
    x: camera.x + (sx - size.width * 0.5) / camera.zoom,
    y: camera.y + (sy - size.height * 0.5) / camera.zoom,
  });

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      camX: camera.x,
      camY: camera.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.hypot(dx, dy) > 4) {
        dragRef.current.moved = true;
      }
      onCameraChange({
        ...camera,
        x: dragRef.current.camX - dx / camera.zoom,
        y: dragRef.current.camY - dy / camera.zoom,
      });
      return;
    }

    const worldPos = screenToWorld(sx, sy);
    const hit = townIndex.pickAtPoint(worldPos, camera.zoom);
    if (hit?.venue) {
      setHoveredBuilding(hit.building);
      setHoverLabel(`${hit.venue.name} · ${hit.venue.addressString}`);
    } else if (hit?.building) {
      setHoveredBuilding(hit.building);
      setHoverLabel(hit.building.addressString);
    } else if (hit?.street) {
      setHoveredBuilding(null);
      setHoverLabel(hit.street.name);
    } else {
      setHoveredBuilding(null);
      setHoverLabel(null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.active) return;
    const wasDrag = dragRef.current.moved;
    dragRef.current.active = false;
    if (!wasDrag) {
      const rect = e.currentTarget.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const worldPos = screenToWorld(sx, sy);
      const hit = townIndex.pickAtPoint(worldPos, camera.zoom);
      onPick(hit, worldPos);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const before = screenToWorld(sx, sy);

    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * factor));

    const nextX = before.x - (sx - size.width * 0.5) / nextZoom;
    const nextY = before.y - (sy - size.height * 0.5) / nextZoom;
    onCameraChange({ x: nextX, y: nextY, zoom: nextZoom });
  };

  const zoomBy = (factor: number) => {
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * factor));
    onCameraChange({ ...camera, zoom: nextZoom });
  };

  // Adaptive metric scale bar spanning 10 m .. 1000 m
  const candidatesM = [10, 25, 50, 100, 250, 500, 1000];
  let scaleMeters = candidatesM[candidatesM.length - 1];
  let bestDelta = Infinity;
  for (const m of candidatesM) {
    const px = m * camera.zoom;
    if (px >= 50 && px <= 165) {
      const d = Math.abs(px - 105);
      if (d < bestDelta) {
        bestDelta = d;
        scaleMeters = m;
      }
    }
  }
  const scaleWidthPx = Math.round(scaleMeters * camera.zoom);
  const scaleLabel = scaleMeters >= 1000 ? `${scaleMeters / 1000} km` : `${scaleMeters} m`;

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-[260px] h-full overflow-hidden select-none bg-[#E6E2D6]"
    >
      <canvas
        ref={canvasRef}
        data-testid="map-canvas"
        data-town-hash={town.hash}
        data-building-count={town.buildings.length}
        aria-label="Interactive procedural town map"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          dragRef.current.active = false;
          setHoveredBuilding(null);
          setHoverLabel(null);
        }}
        onWheel={handleWheel}
        className="w-full h-full block cursor-grab active:cursor-grabbing"
      />

      {/* Hover readout */}
      {hoverLabel && (
        <div className="pointer-events-none absolute top-3 left-3 px-2.5 py-1.5 rounded bg-[#FAF9F6]/95 border border-[#DCD9D0] text-xs font-medium text-[#1C1F23] shadow-sm">
          {hoverLabel}
        </div>
      )}

      {/* Compass Rose (top-right) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-3 right-3 w-11 h-11 rounded-full bg-[#FAF9F6]/90 border border-[#DCD9D0] flex flex-col items-center justify-center text-[10px] font-semibold text-[#1C1F23]"
      >
        <span className="text-[#C2593F] leading-none">N</span>
        <svg width="14" height="16" viewBox="0 0 14 16" className="mt-0.5">
          <polygon points="7,1 11,13 7,10" fill="#C2593F" />
          <polygon points="7,1 3,13 7,10" fill="#5A626D" />
        </svg>
      </div>

      {/* Bottom-left Adaptive Scale Bar */}
      <div className="pointer-events-none absolute bottom-3 left-3 px-2.5 py-1.5 rounded bg-[#FAF9F6]/92 border border-[#DCD9D0] flex items-center gap-2 text-xs font-mono-tabular text-[#1C1F23]">
        <div
          className="h-1.5 border-x border-b border-[#1C1F23]"
          style={{ width: `${Math.max(24, Math.min(180, scaleWidthPx))}px` }}
        />
        <span>{scaleLabel}</span>
      </div>

      {/* Bottom-right Zoom Controls */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-[#FAF9F6]/95 border border-[#DCD9D0] rounded-md p-1 shadow-sm">
        <button
          type="button"
          onClick={() => zoomBy(1.25)}
          aria-label="Zoom in"
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-[#EAE8E1] text-[#1C1F23] cursor-pointer transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.25)}
          aria-label="Zoom out"
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-[#EAE8E1] text-[#1C1F23] cursor-pointer transition-colors"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onResetView}
          aria-label="Reset map view"
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-[#EAE8E1] text-[#1C1F23] cursor-pointer transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
