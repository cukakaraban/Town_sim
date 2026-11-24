import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpDown, Search, Trash2 } from 'lucide-react';
import {
  District,
  RouteResult,
  TownData,
  TownParams,
  TownPreset,
  TownShape,
  Vec2,
} from '../town/model/types';
import { ARCHETYPE_SPECS, PRESET_CONFIGS } from '../town/data/presets';
import { isRetailVenueForClustering } from '../town/generator/invariants';
import { MAP_THEMES } from '../town/data/themes';
import { SearchHit, TownIndex } from '../town/model/townIndex';
import { MapLayerOptions } from '../town/view/mapRenderer';
import { polygonCentroid } from '../town/geometry/geom';

export type SidebarTab = 'explore' | 'directions' | 'layers';

export function formatWalkingDuration(minutes: number): string {
  const totalMin = Math.max(1, Math.round(minutes));
  if (totalMin < 60) return `${totalMin} min`;
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins > 0 ? `${hrs} hr ${mins} min` : `${hrs} hr`;
}

interface TownSidebarProps {
  town: TownData;
  townIndex: TownIndex;
  params: TownParams;
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  layerOptions: MapLayerOptions;
  onLayerOptionsChange: (next: MapLayerOptions) => void;
  onFocusPoint: (pos: Vec2, zoom?: number) => void;
  onSelectSearchHit: (hit: SearchHit) => void;
  onRegenerate: (nextParams: TownParams) => void;
  isGenerating: boolean;
  progressText: string;
  routeOriginLabel: string;
  routeDestLabel: string;
  routeOriginVenueId: string;
  routeDestVenueId: string;
  onSelectOriginVenue: (venueId: string) => void;
  onSelectDestVenue: (venueId: string) => void;
  onSwapRoute: () => void;
  onClearRoute: () => void;
  routeResult: RouteResult | null;
}

export const TownSidebar: React.FC<TownSidebarProps> = ({
  town,
  townIndex,
  params,
  activeTab,
  onTabChange,
  layerOptions,
  onLayerOptionsChange,
  onFocusPoint,
  onSelectSearchHit,
  onRegenerate,
  isGenerating,
  progressText,
  routeOriginLabel,
  routeDestLabel,
  routeOriginVenueId,
  routeDestVenueId,
  onSelectOriginVenue,
  onSelectDestVenue,
  onSwapRoute,
  onClearRoute,
  routeResult,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [draftSeed, setDraftSeed] = useState(String(params.seed));
  const [draftPreset, setDraftPreset] = useState<TownPreset>(params.preset);
  const [draftTownShape, setDraftTownShape] = useState<TownShape>(params.townShape);
  const [draftCoreCount, setDraftCoreCount] = useState<number>(params.coreDistrictCount);
  const [draftSatCount, setDraftSatCount] = useState<number>(params.satelliteCount);
  const [draftCoreSigma, setDraftCoreSigma] = useState<number>(params.coreSigma);
  const [draftRibbonDensity, setDraftRibbonDensity] = useState<number>(params.ribbonDensity);
  const [draftNamedNpcCount, setDraftNamedNpcCount] = useState<number>(params.namedNpcCount);
  const [draftClusterStrength, setDraftClusterStrength] = useState<number>(
    params.retailClusterStrength
  );
  const [draftThemeId, setDraftThemeId] = useState<string>(params.themeId);

  React.useEffect(() => {
    setDraftSeed(String(params.seed));
    setDraftPreset(params.preset);
    setDraftTownShape(params.townShape);
    setDraftCoreCount(params.coreDistrictCount);
    setDraftSatCount(params.satelliteCount);
    setDraftCoreSigma(params.coreSigma);
    setDraftRibbonDensity(params.ribbonDensity);
    setDraftNamedNpcCount(params.namedNpcCount);
    setDraftClusterStrength(params.retailClusterStrength);
    setDraftThemeId(params.themeId);
  }, [params]);

  const searchHits = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return townIndex.search(searchQuery, 18);
  }, [townIndex, searchQuery]);

  const ledgerStats = useMemo(() => {
    const retailAll = town.venues.filter((v) => isRetailVenueForClustering(v.defId));
    const clustered = retailAll.filter((v) => v.clusterId !== null).length;
    const clusteredPct =
      retailAll.length > 0 ? Math.round((clustered / retailAll.length) * 100) : 0;
    const sprawlCount = town.buildings.filter((b) => b.sprawlType !== null).length;
    const sprawlPct =
      town.buildings.length > 0
        ? Math.round((sprawlCount / town.buildings.length) * 100)
        : 0;
    return { clusteredPct, sprawlCount, sprawlPct };
  }, [town]);

  const handleApplyParams = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseInt(draftSeed, 10);
    const cleanSeed = Number.isFinite(parsed) ? Math.abs(parsed) : params.seed;
    onRegenerate({
      ...params,
      seed: cleanSeed,
      preset: draftPreset,
      townShape: draftTownShape,
      coreDistrictCount: draftCoreCount,
      satelliteCount: draftSatCount,
      districtCount: draftCoreCount + draftSatCount,
      coreSigma: draftCoreSigma,
      coreRadius: draftCoreSigma,
      ribbonDensity: draftRibbonDensity,
      namedNpcCount: Math.max(400, Math.min(4000, draftNamedNpcCount)),
      retailClusterStrength: draftClusterStrength,
      themeId: draftThemeId,
    });
  };

  const toggleLayer = (key: keyof MapLayerOptions) => {
    onLayerOptionsChange({
      ...layerOptions,
      [key]: !layerOptions[key],
    });
  };

  return (
    <aside
      aria-label="Town controls and navigation"
      className="w-full md:w-80 lg:w-84 max-h-[34vh] md:max-h-none md:h-full shrink-0 bg-[#FAF9F6] border-b md:border-b-0 md:border-r border-[#DCD9D0] flex flex-col overflow-hidden"
    >
      {/* Segmented Control */}
      <div className="p-3 border-b border-[#DCD9D0]">
        <div
          role="tablist"
          aria-label="Map tools"
          className="grid grid-cols-3 gap-1 p-1 rounded-md bg-[#EAE8E1]"
        >
          {(
            [
              { id: 'explore', label: 'Explore' },
              { id: 'directions', label: 'Directions' },
              { id: 'layers', label: 'Seed & Layers' },
            ] as const
          ).map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => onTabChange(tab.id)}
                className={`py-1.5 px-2 text-xs font-medium rounded whitespace-nowrap cursor-pointer transition-colors ${
                  active
                    ? 'bg-white text-[#1C1F23] shadow-sm'
                    : 'text-[#5A626D] hover:text-[#1C1F23]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {isGenerating && (
          <div className="p-3 rounded border border-[#1D4E5F]/30 bg-[#1D4E5F]/5 text-xs text-[#1D4E5F]">
            {progressText || 'Generating spine-based town...'}
          </div>
        )}

        {town.unplacedVenues.length > 0 && (
          <div className="p-2.5 rounded border border-[#D97706]/40 bg-[#D97706]/10 text-xs text-[#92400E] flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#D97706]" />
            <div>
              {town.unplacedVenues.length} unplaced venue(s):{' '}
              {town.unplacedVenues.map((u) => u.displayName).join(', ')}
            </div>
          </div>
        )}

        {activeTab === 'explore' && (
          <>
            {/* Search */}
            <div>
              <label
                htmlFor="town-search-input"
                className="block text-xs font-semibold text-[#1C1F23] mb-1.5"
              >
                Search Town
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-[#5A626D] absolute left-2.5 top-2.5 pointer-events-none" />
                <input
                  id="town-search-input"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Venue, street, cluster, or address"
                  className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-[#DCD9D0] rounded-md text-[#1C1F23] placeholder:text-[#7D8590] focus:outline-none focus:border-[#1D4E5F]"
                />
              </div>

              {searchQuery.trim() && (
                <div className="mt-2 border border-[#DCD9D0] rounded-md bg-white divide-y divide-[#EAE8E1] max-h-64 overflow-y-auto">
                  {searchHits.length === 0 ? (
                    <div className="p-3 text-xs text-[#5A626D]">
                      No matching places or addresses found.
                    </div>
                  ) : (
                    searchHits.map((hit) => (
                      <button
                        key={`${hit.kind}-${hit.id}`}
                        type="button"
                        onClick={() => onSelectSearchHit(hit)}
                        className="w-full text-left px-3 py-2 hover:bg-[#EFECE3] cursor-pointer transition-colors"
                      >
                        <div className="text-xs font-medium text-[#1C1F23] truncate">
                          {hit.title}
                        </div>
                        <div className="text-[11px] text-[#5A626D] truncate">
                          {hit.subtitle}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Key Metrics Strip (unboxed tabular figures) */}
            <div className="border-t border-[#DCD9D0] pt-4">
              <div className="flex items-baseline justify-between mb-2">
                <h2 className="text-xs font-semibold text-[#1C1F23]">
                  Town Ledger · Seed {town.params.seed} ({town.resolvedTownShape})
                </h2>
                <span className="font-mono-tabular text-[11px] text-[#5A626D]">
                  {town.hash}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-y-2.5 gap-x-4 text-xs">
                <div>
                  <div className="text-[#5A626D]">Est. Population</div>
                  <div className="font-mono-tabular text-sm font-semibold text-[#1C1F23]">
                    ~{town.estimatedPopulation.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-[#5A626D]">Household Slots</div>
                  <div className="font-mono-tabular text-sm font-semibold text-[#1C1F23]">
                    {town.households.length}
                  </div>
                </div>
                <div>
                  <div className="text-[#5A626D]">Buildings</div>
                  <div className="font-mono-tabular text-sm font-semibold text-[#1C1F23]">
                    {town.buildings.length}
                  </div>
                </div>
                <div>
                  <div className="text-[#5A626D]">Named Share</div>
                  <div className="font-mono-tabular text-sm font-semibold text-[#1C1F23]">
                    {Math.round(town.namedShare * 100)}% · {town.params.namedNpcCount}
                  </div>
                </div>
                <div>
                  <div className="text-[#5A626D]">Venues · Clusters</div>
                  <div className="font-mono-tabular text-sm font-semibold text-[#1C1F23]">
                    {town.venues.length} · {town.retailClusters.length} ({ledgerStats.clusteredPct}%)
                  </div>
                </div>
                <div>
                  <div className="text-[#5A626D]">Streets · Sprawl</div>
                  <div className="font-mono-tabular text-sm font-semibold text-[#1C1F23]">
                    {town.streets.length} · {ledgerStats.sprawlPct}%
                  </div>
                </div>
              </div>
            </div>

            {/* Districts List */}
            <div className="border-t border-[#DCD9D0] pt-4">
              <h2 className="text-xs font-semibold text-[#1C1F23] mb-2">
                Districts ({town.districts.length} along {town.resolvedTownShape} spine)
              </h2>
              <div className="divide-y divide-[#EAE8E1] border border-[#DCD9D0] rounded-md bg-white">
                {town.districts.map((d: District) => {
                  const spec = ARCHETYPE_SPECS[d.archetype];
                  const bCount = town.buildings.filter(
                    (b) => b.districtId === d.id
                  ).length;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        const center =
                          d.polygon.length >= 3
                            ? polygonCentroid(d.polygon)
                            : d.seedPoint;
                        onFocusPoint(center, 1.05);
                      }}
                      className="w-full text-left px-3 py-2.5 hover:bg-[#EFECE3] flex items-center justify-between gap-2 cursor-pointer transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-[#1C1F23] truncate">
                          {d.name}
                        </div>
                        <div className="text-[11px] text-[#5A626D] truncate">
                          {spec.label} · {d.nodeKind}
                        </div>
                      </div>
                      <span className="font-mono-tabular text-xs text-[#5A626D] shrink-0">
                        {bCount}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {activeTab === 'directions' && (
          <div className="space-y-4">
            <div>
              <label
                htmlFor="route-origin-select"
                className="block text-xs font-semibold text-[#1C1F23] mb-1"
              >
                Origin (A)
              </label>
              <select
                id="route-origin-select"
                value={routeOriginVenueId}
                onChange={(e) => onSelectOriginVenue(e.target.value)}
                className="w-full px-2.5 py-2 text-xs bg-white border border-[#DCD9D0] rounded-md text-[#1C1F23] focus:outline-none focus:border-[#1D4E5F]"
              >
                <option value="">
                  {routeOriginLabel ? `Selected: ${routeOriginLabel}` : 'Choose a venue or click map...'}
                </option>
                {town.venues.map((v) => (
                  <option key={v.id} value={String(v.id)}>
                    {v.name} ({v.addressString})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={onSwapRoute}
                className="px-2.5 py-1.5 text-xs font-medium text-[#1C1F23] border border-[#DCD9D0] rounded bg-white hover:bg-[#EFECE3] flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                <span>Swap</span>
              </button>
              <button
                type="button"
                onClick={onClearRoute}
                className="px-2.5 py-1.5 text-xs font-medium text-[#5A626D] hover:text-[#1C1F23] flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            </div>

            <div>
              <label
                htmlFor="route-dest-select"
                className="block text-xs font-semibold text-[#1C1F23] mb-1"
              >
                Destination (B)
              </label>
              <select
                id="route-dest-select"
                value={routeDestVenueId}
                onChange={(e) => onSelectDestVenue(e.target.value)}
                className="w-full px-2.5 py-2 text-xs bg-white border border-[#DCD9D0] rounded-md text-[#1C1F23] focus:outline-none focus:border-[#1D4E5F]"
              >
                <option value="">
                  {routeDestLabel ? `Selected: ${routeDestLabel}` : 'Choose a venue or click map...'}
                </option>
                {town.venues.map((v) => (
                  <option key={v.id} value={String(v.id)}>
                    {v.name} ({v.addressString})
                  </option>
                ))}
              </select>
            </div>

            {/* Route Summary */}
            {routeResult ? (
              routeResult.found ? (
                <div className="border-t border-[#DCD9D0] pt-4 space-y-3">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-xs text-[#5A626D]">Walking Time</div>
                      <div className="font-mono-tabular text-xl font-semibold text-[#1D4E5F]">
                        {formatWalkingDuration(routeResult.walkingMinutes)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-[#5A626D]">Distance</div>
                      <div className="font-mono-tabular text-sm font-medium text-[#1C1F23]">
                        {Math.round(routeResult.distanceMeters)} m
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold text-[#1C1F23] mb-1.5">
                      Route Streets ({routeResult.streetNames.length})
                    </h3>
                    <ol className="space-y-1.5 text-xs text-[#1C1F23] border border-[#DCD9D0] rounded bg-white p-3">
                      {routeResult.streetNames.map((st, idx) => (
                        <li key={`${st}-${idx}`} className="flex items-baseline gap-2">
                          <span className="font-mono-tabular text-[11px] text-[#5A626D] w-4 shrink-0">
                            {idx + 1}.
                          </span>
                          <span>{st}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded border border-[#C2593F]/40 bg-[#C2593F]/10 text-xs text-[#C2593F]">
                  No pedestrian path found between these points.
                </div>
              )
            ) : (
              <p className="text-xs text-[#5A626D] leading-relaxed">
                Select an origin and destination above, or click any building on the map and choose Route From / Route To.
              </p>
            )}
          </div>
        )}

        {activeTab === 'layers' && (
          <div className="space-y-5">
            {/* Seed & Spine Preset Form */}
            <form onSubmit={handleApplyParams} className="space-y-3">
              <div className="flex gap-2">
                <div className="w-24 shrink-0">
                  <label
                    htmlFor="seed-input"
                    className="block text-xs font-semibold text-[#1C1F23] mb-1"
                  >
                    Town Seed
                  </label>
                  <input
                    id="seed-input"
                    type="number"
                    value={draftSeed}
                    onChange={(e) => setDraftSeed(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono-tabular bg-white border border-[#DCD9D0] rounded-md text-[#1C1F23] focus:outline-none focus:border-[#1D4E5F]"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <label
                    htmlFor="theme-select"
                    className="block text-xs font-semibold text-[#1C1F23] mb-1"
                  >
                    Map Theme
                  </label>
                  <select
                    id="theme-select"
                    value={draftThemeId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setDraftThemeId(nextId);
                      onRegenerate({
                        ...params,
                        themeId: nextId,
                      });
                    }}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#DCD9D0] rounded-md text-[#1C1F23]"
                  >
                    {Object.values(MAP_THEMES).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="preset-select"
                  className="block text-xs font-semibold text-[#1C1F23] mb-1"
                >
                  Town Preset
                </label>
                <select
                  id="preset-select"
                  value={draftPreset}
                  onChange={(e) => setDraftPreset(e.target.value as TownPreset)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#DCD9D0] rounded-md text-[#1C1F23] focus:outline-none focus:border-[#1D4E5F]"
                >
                  {Object.values(PRESET_CONFIGS).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-[#5A626D]">
                  {PRESET_CONFIGS[draftPreset].description}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label
                    htmlFor="shape-select"
                    className="block text-[11px] font-semibold text-[#1C1F23] mb-1"
                  >
                    Town Shape
                  </label>
                  <select
                    id="shape-select"
                    value={draftTownShape}
                    onChange={(e) => setDraftTownShape(e.target.value as TownShape)}
                    className="w-full px-2 py-1.5 text-xs bg-white border border-[#DCD9D0] rounded-md text-[#1C1F23]"
                  >
                    <option value="auto">Auto ({town.resolvedTownShape})</option>
                    <option value="strip">Strip</option>
                    <option value="fork">Fork</option>
                    <option value="crossroads">Crossroads</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="core-count-select"
                    className="block text-[11px] font-semibold text-[#1C1F23] mb-1"
                  >
                    Core Nodes
                  </label>
                  <select
                    id="core-count-select"
                    value={draftCoreCount}
                    onChange={(e) => setDraftCoreCount(Number(e.target.value))}
                    className="w-full px-2 py-1.5 text-xs bg-white border border-[#DCD9D0] rounded-md text-[#1C1F23]"
                  >
                    <option value={2}>2 core</option>
                    <option value={3}>3 core</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="sat-count-select"
                    className="block text-[11px] font-semibold text-[#1C1F23] mb-1"
                  >
                    Satellites
                  </label>
                  <select
                    id="sat-count-select"
                    value={draftSatCount}
                    onChange={(e) => setDraftSatCount(Number(e.target.value))}
                    className="w-full px-2 py-1.5 text-xs bg-white border border-[#DCD9D0] rounded-md text-[#1C1F23]"
                  >
                    <option value={3}>3 sat+lobe</option>
                    <option value={4}>4 sat+lobe</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="core-sigma-range"
                    className="flex justify-between text-[11px] font-semibold text-[#1C1F23] mb-1"
                  >
                    <span>Core Sigma</span>
                    <span className="font-mono-tabular text-[#5A626D]">{draftCoreSigma} m</span>
                  </label>
                  <input
                    id="core-sigma-range"
                    type="range"
                    min={320}
                    max={440}
                    step={10}
                    value={draftCoreSigma}
                    onChange={(e) => setDraftCoreSigma(Number(e.target.value))}
                    className="w-full accent-[#1D4E5F] cursor-pointer"
                  />
                </div>
                <div>
                  <label
                    htmlFor="ribbon-density-range"
                    className="flex justify-between text-[11px] font-semibold text-[#1C1F23] mb-1"
                  >
                    <span>Ribbon Sprawl</span>
                    <span className="font-mono-tabular text-[#5A626D]">
                      {Math.round(draftRibbonDensity * 100)}%
                    </span>
                  </label>
                  <input
                    id="ribbon-density-range"
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={draftRibbonDensity}
                    onChange={(e) => setDraftRibbonDensity(Number(e.target.value))}
                    className="w-full accent-[#1D4E5F] cursor-pointer"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="cluster-strength-range"
                  className="flex justify-between text-xs font-semibold text-[#1C1F23] mb-1"
                >
                  <span>Retail Cluster Strength</span>
                  <span className="font-mono-tabular text-[#1D4E5F]">
                    {draftClusterStrength.toFixed(1)}×
                  </span>
                </label>
                <input
                  id="cluster-strength-range"
                  type="range"
                  min={0}
                  max={2}
                  step={0.2}
                  value={draftClusterStrength}
                  onChange={(e) => setDraftClusterStrength(Number(e.target.value))}
                  className="w-full accent-[#1D4E5F] cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[#5A626D]">
                  <span>0.0 (Random)</span>
                  <span>1.0 (Clustered)</span>
                  <span>2.0 (Strong)</span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="named-npc-input"
                  className="flex justify-between text-xs font-semibold text-[#1C1F23] mb-1"
                >
                  <span>Named NPC Population Target</span>
                  <span className="font-mono-tabular text-[#5A626D]">
                    {draftNamedNpcCount}
                  </span>
                </label>
                <input
                  id="named-npc-input"
                  type="number"
                  min={400}
                  max={4000}
                  step={100}
                  value={draftNamedNpcCount}
                  onChange={(e) => setDraftNamedNpcCount(Number(e.target.value) || 2000)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono-tabular bg-white border border-[#DCD9D0] rounded-md text-[#1C1F23]"
                />
              </div>

              <button
                type="submit"
                disabled={isGenerating}
                className="w-full py-2 px-4 rounded-md bg-[#1D4E5F] hover:bg-[#163D4B] text-white text-xs font-medium cursor-pointer transition-colors disabled:opacity-60"
              >
                {isGenerating ? 'Generating...' : 'Apply & Generate'}
              </button>
            </form>

            {/* Map Display Layers */}
            <div className="border-t border-[#DCD9D0] pt-4">
              <h3 className="text-xs font-semibold text-[#1C1F23] mb-2">
                Map Layers
              </h3>
              <div className="space-y-2 text-xs">
                {(
                  [
                    ['showDistrictTints', 'District Color Tints'],
                    ['showGreenbelt', 'Greenbelt Fields, Woods & Hedgerows'],
                    ['showVenueSites', 'Venue Sites, Car Parks & Yards'],
                    ['showRetailClusters', 'Retail Cluster Zones (DBSCAN)'],
                    ['showLotBoundaries', 'Property Lot Lines'],
                    ['showVenuePins', 'Venue Markers'],
                    ['showDistrictLabels', 'District Labels'],
                    ['showStreetLabels', 'Street Name Labels'],
                  ] as Array<[keyof MapLayerOptions, string]>
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <span className="text-[#1C1F23]">{label}</span>
                    <input
                      type="checkbox"
                      checked={layerOptions[key]}
                      onChange={() => toggleLayer(key)}
                      className="accent-[#1D4E5F] w-4 h-4 cursor-pointer"
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* Algorithm Inspection Overlays */}
            <div className="border-t border-[#DCD9D0] pt-4">
              <h3 className="text-xs font-semibold text-[#1C1F23] mb-2">
                Geometry & Field Overlays
              </h3>
              <div className="space-y-2 text-xs">
                {(
                  [
                    ['showSpineAndUrbanity', 'Spine and Urbanity'],
                    ['debugTensorField', 'Tensor Field Glyphs'],
                    ['debugStreamlines', 'Streamlines (Stop Reasons)'],
                    ['debugGraph', 'Planar Street Graph'],
                    ['debugFaces', 'Extracted Block Faces'],
                    ['debugLotFrontage', 'Lot Frontage Arrows'],
                    ['debugOverlaps', 'Overlap & Containment Check'],
                  ] as Array<[keyof MapLayerOptions, string]>
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <span className="text-[#1C1F23]">{label}</span>
                    <input
                      type="checkbox"
                      checked={layerOptions[key]}
                      onChange={() => toggleLayer(key)}
                      className="accent-[#C2593F] w-4 h-4 cursor-pointer"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
