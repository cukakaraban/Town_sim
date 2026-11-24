import { useCallback, useMemo, useState } from 'react';
import { RouteResult, TownData, TownParams, Vec2, Venue } from './town/model/types';
import { MAP_THEMES } from './town/data/themes';
import {
  createDefaultParams,
  generateTownAsync,
  generateTownSync,
} from './town/generator/pipeline';
import { claimHome } from './town/generator/stages';
import { SeededRng } from './town/geometry/rng';
import { findShortestRoute } from './town/geometry/dijkstra';
import { PickResult, SearchHit, TownIndex } from './town/model/townIndex';
import { DEFAULT_LAYER_OPTIONS, MapCamera, MapLayerOptions } from './town/view/mapRenderer';
import { AppScreen, TopBar } from './components/TopBar';
import { MapCanvas } from './components/MapCanvas';
import { SidebarTab, TownSidebar } from './components/TownSidebar';
import { PlaceInfoPanel } from './components/PlaceInfoPanel';
import { LocationListScreen } from './components/LocationListScreen';
import { SeedGalleryScreen } from './components/SeedGalleryScreen';
import { VerificationScreen } from './components/VerificationScreen';

interface RouteEndpoint {
  pos: Vec2;
  edgeId: number | null;
  label: string;
  venueId: string;
}

const DEFAULT_OVERVIEW_CAMERA: MapCamera = { x: 0, y: 0, zoom: 0.23 };

export default function App() {
  const [params, setParams] = useState<TownParams>(() =>
    createDefaultParams({ seed: 1042 })
  );
  const [town, setTown] = useState<TownData>(() =>
    generateTownSync(createDefaultParams({ seed: 1042 }))
  );
  const [activeScreen, setActiveScreen] = useState<AppScreen>('map');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('explore');
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressText, setProgressText] = useState('');

  const [layerOptions, setLayerOptions] = useState<MapLayerOptions>(
    DEFAULT_LAYER_OPTIONS
  );
  const [camera, setCamera] = useState<MapCamera>(DEFAULT_OVERVIEW_CAMERA);
  const [selection, setSelection] = useState<PickResult | null>(null);

  const [routeOrigin, setRouteOrigin] = useState<RouteEndpoint | null>(null);
  const [routeDest, setRouteDest] = useState<RouteEndpoint | null>(null);

  const theme = MAP_THEMES[params.themeId] ?? MAP_THEMES.ordnance_paper;
  const townIndex = useMemo(() => new TownIndex(town), [town]);

  const routeResult: RouteResult | null = useMemo(() => {
    if (!routeOrigin || !routeDest) return null;
    return findShortestRoute(
      town.nodes,
      town.edges,
      town.streets,
      routeOrigin.pos,
      routeDest.pos,
      routeOrigin.edgeId,
      routeDest.edgeId
    );
  }, [town, routeOrigin, routeDest]);

  const regenerateTown = useCallback(
    async (nextParams: TownParams) => {
      const geometryAndRetailUnchanged =
        nextParams.seed === params.seed &&
        nextParams.preset === params.preset &&
        nextParams.townShape === params.townShape &&
        nextParams.townExtent === params.townExtent &&
        nextParams.coreDistrictCount === params.coreDistrictCount &&
        nextParams.satelliteCount === params.satelliteCount &&
        nextParams.coreSigma === params.coreSigma &&
        nextParams.ribbonDensity === params.ribbonDensity &&
        nextParams.namedNpcCount === params.namedNpcCount &&
        nextParams.retailClusterStrength === params.retailClusterStrength &&
        nextParams.generatorVersion === params.generatorVersion;

      setParams(nextParams);
      if (geometryAndRetailUnchanged) {
        return;
      }

      setIsGenerating(true);
      setProgressText('Initializing RNG streams...');
      setSelection(null);
      setRouteOrigin(null);
      setRouteDest(null);

      const generated = await generateTownAsync(nextParams, (stageLabel, pct) => {
        setProgressText(`${stageLabel} (${pct}%)`);
      });

      setTown(generated);
      setCamera({
        x: 0,
        y: 0,
        zoom: Number((0.23 * (3800 / nextParams.townExtent)).toFixed(3)),
      });
      setIsGenerating(false);
      setProgressText('');
    },
    [params]
  );

  const handleRandomizeTown = () => {
    const nextSeed = Math.floor(1000 + Math.random() * 8999);
    void regenerateTown({ ...params, seed: nextSeed });
  };

  const handleFocusPoint = useCallback((pos: Vec2, zoom?: number) => {
    setCamera((prev) => ({
      x: pos.x,
      y: pos.y,
      zoom: zoom ?? Math.max(prev.zoom, 1.4),
    }));
  }, []);

  const handleSelectSearchHit = (hit: SearchHit) => {
    handleFocusPoint(hit.pos, hit.kind === 'street' ? 1.25 : 1.9);
    const building =
      hit.buildingId !== null ? townIndex.buildingsById.get(hit.buildingId) ?? null : null;
    const venue =
      hit.venueId !== null ? townIndex.venuesById.get(hit.venueId) ?? null : null;
    const street =
      hit.streetId !== null ? townIndex.streetsById.get(hit.streetId) ?? null : null;
    const lot = building ? townIndex.lotsById.get(building.lotId) ?? null : null;
    const block = building ? townIndex.blocksById.get(building.blockId) ?? null : null;
    const district = building
      ? townIndex.districtsById.get(building.districtId) ?? null
      : townIndex.findDistrictAt(hit.pos);

    setSelection({
      kind: venue ? 'venue' : building ? 'building' : 'street',
      id: hit.id,
      building,
      venue,
      block,
      street,
      lot,
      district,
    });
  };

  const handlePickMap = (hit: PickResult | null) => {
    setSelection(hit);
  };

  const frameRoute = useCallback((a: Vec2, b: Vec2) => {
    const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
    const span = Math.max(120, Math.hypot(b.x - a.x, b.y - a.y) * 1.45);
    const targetZoom = Math.max(0.24, Math.min(2.2, 520 / span));
    setCamera({ x: mid.x, y: mid.y, zoom: targetZoom });
  }, []);

  const handleSelectOriginVenue = (venueIdStr: string) => {
    if (!venueIdStr) {
      setRouteOrigin(null);
      return;
    }
    const v = townIndex.venuesById.get(Number(venueIdStr));
    if (v) {
      const next = {
        pos: v.entrancePos,
        edgeId: v.entranceEdgeId,
        label: v.name,
        venueId: String(v.id),
      };
      setRouteOrigin(next);
      if (routeDest) frameRoute(next.pos, routeDest.pos);
    }
  };

  const handleSelectDestVenue = (venueIdStr: string) => {
    if (!venueIdStr) {
      setRouteDest(null);
      return;
    }
    const v = townIndex.venuesById.get(Number(venueIdStr));
    if (v) {
      const next = {
        pos: v.entrancePos,
        edgeId: v.entranceEdgeId,
        label: v.name,
        venueId: String(v.id),
      };
      setRouteDest(next);
      if (routeOrigin) frameRoute(routeOrigin.pos, next.pos);
    }
  };

  const handleSetRouteOrigin = (pos: Vec2, edgeId: number | null, label: string) => {
    setRouteOrigin({ pos, edgeId, label, venueId: '' });
    setSidebarTab('directions');
    if (routeDest) frameRoute(pos, routeDest.pos);
  };

  const handleSetRouteDest = (pos: Vec2, edgeId: number | null, label: string) => {
    setRouteDest({ pos, edgeId, label, venueId: '' });
    setSidebarTab('directions');
    if (routeOrigin) frameRoute(routeOrigin.pos, pos);
  };

  const handleShowVenueOnMap = (venue: Venue) => {
    setActiveScreen('map');
    handleFocusPoint(venue.pos, 1.7);
    const building =
      venue.buildingId !== null
        ? townIndex.buildingsById.get(venue.buildingId) ?? null
        : null;
    const block = townIndex.blocksById.get(venue.blockId) ?? null;
    const lot = building ? townIndex.lotsById.get(building.lotId) ?? null : null;
    const street = townIndex.streetsById.get(venue.address.streetId) ?? null;
    const district = townIndex.districtsById.get(venue.districtId) ?? null;
    setSelection({
      kind: 'venue',
      id: venue.id,
      building,
      venue,
      block,
      street,
      lot,
      district,
    });
  };

  const handleRouteToVenueFromList = (venue: Venue) => {
    const startVenue =
      town.venues.find((v) => v.defId === 'town_square' && v.id !== venue.id) ??
      town.venues[0];
    if (startVenue && startVenue.id !== venue.id) {
      setRouteOrigin({
        pos: startVenue.entrancePos,
        edgeId: startVenue.entranceEdgeId,
        label: startVenue.name,
        venueId: String(startVenue.id),
      });
    }
    setRouteDest({
      pos: venue.entrancePos,
      edgeId: venue.entranceEdgeId,
      label: venue.name,
      venueId: String(venue.id),
    });
    setActiveScreen('map');
    setSidebarTab('directions');
    if (startVenue && startVenue.id !== venue.id) {
      frameRoute(startVenue.pos, venue.pos);
    } else {
      handleFocusPoint(venue.pos, 1.4);
    }
  };

  const handleClaimSlotInBuilding = (buildingId: number) => {
    const bld = townIndex.buildingsById.get(buildingId);
    if (!bld) return;
    const vacant = town.households.filter(
      (h) => h.buildingId === buildingId && h.occupantId === -1
    );
    if (vacant.length === 0) return;

    const targetSlot = vacant[0];
    const npcId = 10000 + targetSlot.id;
    const names = [
      'Clara Bennett',
      'Arthur Lawson',
      'Sophie Ingram',
      'Daniel Mercer',
      'Grace Fletcher',
    ];
    const npcName = names[targetSlot.id % names.length];

    const nextHouseholds = town.households.map((h) =>
      h.id === targetSlot.id ? { ...h, occupantId: npcId, occupantName: npcName } : h
    );
    const updatedTown: TownData = { ...town, households: nextHouseholds };
    claimHome(
      { ...updatedTown, households: [...nextHouseholds] },
      { npcId: npcId + 1, npcName },
      new SeededRng(targetSlot.id + 7)
    );
    setTown(updatedTown);
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#F4F2EC] text-[#1C1F23]">
      <TopBar
        activeScreen={activeScreen}
        onNavigate={setActiveScreen}
        onRandomizeTown={handleRandomizeTown}
        isGenerating={isGenerating}
      />

      {activeScreen === 'map' && (
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          <TownSidebar
            town={town}
            townIndex={townIndex}
            params={params}
            activeTab={sidebarTab}
            onTabChange={setSidebarTab}
            layerOptions={layerOptions}
            onLayerOptionsChange={setLayerOptions}
            onFocusPoint={handleFocusPoint}
            onSelectSearchHit={handleSelectSearchHit}
            onRegenerate={(next) => {
              void regenerateTown(next);
            }}
            isGenerating={isGenerating}
            progressText={progressText}
            routeOriginLabel={routeOrigin?.label ?? ''}
            routeDestLabel={routeDest?.label ?? ''}
            routeOriginVenueId={routeOrigin?.venueId ?? ''}
            routeDestVenueId={routeDest?.venueId ?? ''}
            onSelectOriginVenue={handleSelectOriginVenue}
            onSelectDestVenue={handleSelectDestVenue}
            onSwapRoute={() => {
              const prevOrig = routeOrigin;
              setRouteOrigin(routeDest);
              setRouteDest(prevOrig);
            }}
            onClearRoute={() => {
              setRouteOrigin(null);
              setRouteDest(null);
            }}
            routeResult={routeResult}
          />

          <MapCanvas
            town={town}
            townIndex={townIndex}
            theme={theme}
            layerOptions={layerOptions}
            camera={camera}
            onCameraChange={setCamera}
            selectedBuilding={selection?.building ?? null}
            selectedVenue={selection?.venue ?? null}
            selectedStreet={selection?.street ?? null}
            onPick={handlePickMap}
            route={routeResult}
            routeOrigin={routeOrigin?.pos ?? null}
            routeDestination={routeDest?.pos ?? null}
            onResetView={() =>
              setCamera({
                x: 0,
                y: 0,
                zoom: Number((0.23 * (3800 / params.townExtent)).toFixed(3)),
              })
            }
          />

          {selection && (
            <PlaceInfoPanel
              town={town}
              selection={selection}
              onClose={() => setSelection(null)}
              onSetRouteOrigin={handleSetRouteOrigin}
              onSetRouteDestination={handleSetRouteDest}
              onClaimSlot={handleClaimSlotInBuilding}
            />
          )}
        </div>
      )}

      {activeScreen === 'locations' && (
        <LocationListScreen
          town={town}
          onShowOnMap={handleShowVenueOnMap}
          onRouteToVenue={handleRouteToVenueFromList}
        />
      )}

      {activeScreen === 'gallery' && (
        <SeedGalleryScreen
          baseParams={params}
          theme={theme}
          onSelectSeedTown={(seedParams) => {
            setActiveScreen('map');
            void regenerateTown(seedParams);
          }}
        />
      )}

      {activeScreen === 'verification' && <VerificationScreen town={town} />}
    </div>
  );
}
