import React from 'react';
import { MapPin, Navigation, UserPlus, X } from 'lucide-react';
import {
  BuildingKind,
  District,
  HouseholdSlot,
  TownData,
  Vec2,
} from '../town/model/types';
import { ARCHETYPE_SPECS, DWELLING_SPECS } from '../town/data/presets';
import { PickResult, ROAD_CLASS_LABEL } from '../town/model/townIndex';
import { polygonArea } from '../town/geometry/geom';

interface PlaceInfoPanelProps {
  town: TownData;
  selection: PickResult;
  onClose: () => void;
  onSetRouteOrigin: (pos: Vec2, edgeId: number | null, label: string) => void;
  onSetRouteDestination: (pos: Vec2, edgeId: number | null, label: string) => void;
  onClaimSlot: (buildingId: number) => void;
}

const SPRAWL_LABELS: Record<string, string> = {
  ribbon: 'Fringe · Arterial Ribbon',
  hamlet: 'Fringe · Roadside Hamlet',
  farm: 'Fringe · Greenbelt Farm',
};

const CLUSTER_ROLE_LABELS: Record<string, string> = {
  high_street: 'High Street Anchor / Shop',
  retail_park: 'Millbrook Retail Park Unit',
  parade: 'Neighbourhood Parade Shop',
  single: 'Isolated Retail',
};

export const PlaceInfoPanel: React.FC<PlaceInfoPanelProps> = ({
  town,
  selection,
  onClose,
  onSetRouteOrigin,
  onSetRouteDestination,
  onClaimSlot,
}) => {
  const district: District | null = selection.district;
  const archetypeSpec = district ? ARCHETYPE_SPECS[district.archetype] : null;
  const bld = selection.building;
  const venue = selection.venue;
  const street = selection.street;
  const block = selection.block;

  const retailCluster =
    venue && venue.clusterId !== null
      ? town.retailClusters.find((c) => c.id === venue.clusterId) ?? null
      : null;

  const venueSite =
    venue && venue.siteId !== null
      ? town.venueSites.find((s) => s.id === venue.siteId) ?? null
      : null;

  const households: HouseholdSlot[] = bld
    ? town.households.filter((h) => h.buildingId === bld.id)
    : [];
  const vacantCount = households.filter((h) => h.occupantId === -1).length;

  const routePoint: Vec2 | null = venue
    ? venue.entrancePos
    : bld
    ? bld.entrancePos
    : street
    ? street.polyline[Math.floor(street.polyline.length / 2)] ?? null
    : null;
  const routeEdgeId: number | null = venue
    ? venue.entranceEdgeId
    : bld
    ? bld.entranceEdgeId
    : street?.edgeIds[0] ?? null;

  const title = venue
    ? venue.name
    : bld
    ? bld.addressString
    : street
    ? street.name
    : block
    ? block.kind === 'green'
      ? 'Public Green'
      : 'Urban Block'
    : 'Location';

  const subtitleParts: string[] = [];
  if (venue) {
    subtitleParts.push(venue.category);
    subtitleParts.push(venue.addressString);
  } else if (bld) {
    if (bld.dwellingType) {
      subtitleParts.push(DWELLING_SPECS[bld.dwellingType].label);
    } else if (bld.kind === BuildingKind.Other) {
      subtitleParts.push(bld.sprawlType === 'farm' ? 'Farm Outbuilding' : 'Industrial / Depot');
    }
  } else if (street) {
    subtitleParts.push(
      street.isCulDeSac ? 'Cul-de-sac' : ROAD_CLASS_LABEL[street.roadClass]
    );
  }
  if (district) {
    subtitleParts.push(district.name);
  }

  return (
    <aside
      aria-label="Selected place details"
      className="w-full md:w-80 max-h-[30vh] md:max-h-none md:h-full shrink-0 bg-[#FAF9F6] border-t md:border-t-0 md:border-l border-[#DCD9D0] flex flex-col overflow-y-auto"
    >
      <div className="p-4 border-b border-[#DCD9D0] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-[#1C1F23] leading-snug">
            {title}
          </h2>
          {subtitleParts.length > 0 && (
            <p className="mt-1 text-xs text-[#5A626D]">
              {subtitleParts.join(' · ')}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close place details"
          className="w-7 h-7 shrink-0 rounded flex items-center justify-center text-[#5A626D] hover:text-[#1C1F23] hover:bg-[#EAE8E1] cursor-pointer transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-5 flex-1">
        {/* Route Actions */}
        {routePoint && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onSetRouteOrigin(routePoint, routeEdgeId, title)}
              className="px-3 py-2 rounded border border-[#DCD9D0] bg-white hover:bg-[#EFECE3] text-xs font-medium text-[#1C1F23] flex items-center justify-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap"
            >
              <MapPin className="w-3.5 h-3.5 text-[#1D4E5F]" />
              <span>Route From</span>
            </button>
            <button
              type="button"
              onClick={() => onSetRouteDestination(routePoint, routeEdgeId, title)}
              className="px-3 py-2 rounded bg-[#1D4E5F] hover:bg-[#163D4B] text-xs font-medium text-white flex items-center justify-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap"
            >
              <Navigation className="w-3.5 h-3.5" />
              <span>Route To</span>
            </button>
          </div>
        )}

        {/* Metadata Table */}
        <div className="border-t border-[#DCD9D0] pt-3 space-y-2 text-xs">
          {district && archetypeSpec && (
            <div className="flex justify-between gap-2">
              <span className="text-[#5A626D]">District Archetype</span>
              <span className="font-medium text-[#1C1F23] text-right">
                {archetypeSpec.label}
              </span>
            </div>
          )}

          {venue && (
            <>
              <div className="flex justify-between gap-2">
                <span className="text-[#5A626D]">Retail Cluster</span>
                <span className="font-medium text-[#1C1F23] text-right">
                  {retailCluster ? retailCluster.name : 'Standalone Venue'}
                </span>
              </div>
              {retailCluster && (
                <div className="flex justify-between gap-2">
                  <span className="text-[#5A626D]">Cluster Role</span>
                  <span className="text-[#1C1F23] text-right">
                    {CLUSTER_ROLE_LABELS[retailCluster.kind] ?? retailCluster.kind} ·{' '}
                    {retailCluster.venueIds.length} venues
                  </span>
                </div>
              )}
              {venueSite && (
                <div className="flex justify-between gap-2">
                  <span className="text-[#5A626D]">Reserved Site</span>
                  <span className="font-mono-tabular text-[#1C1F23] text-right">
                    {Math.round(venueSite.catalogW)} × {Math.round(venueSite.catalogD)} m
                    {venueSite.extraLabel ? ` · ${venueSite.extraLabel}` : ''}
                  </span>
                </div>
              )}
            </>
          )}

          {bld && (
            <>
              <div className="flex justify-between gap-2">
                <span className="text-[#5A626D]">Footprint Area</span>
                <span className="font-mono-tabular text-[#1C1F23]">
                  {Math.round(polygonArea(bld.footprint))} m²
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#5A626D]">Development Zone</span>
                <span className="text-[#1C1F23] text-right">
                  {bld.sprawlType
                    ? SPRAWL_LABELS[bld.sprawlType] ?? 'Outer Fringe'
                    : bld.isFringe
                    ? 'Outer Fringe'
                    : 'Urban Block'}
                </span>
              </div>
            </>
          )}

          {selection.lot && (
            <div className="flex justify-between gap-2">
              <span className="text-[#5A626D]">Plot Area · Side</span>
              <span className="font-mono-tabular text-[#1C1F23]">
                {Math.round(polygonArea(selection.lot.polygon))} m² · {selection.lot.side}
              </span>
            </div>
          )}

          {street && (
            <div className="flex justify-between gap-2">
              <span className="text-[#5A626D]">Road Class · Segments</span>
              <span className="font-mono-tabular text-[#1C1F23]">
                {ROAD_CLASS_LABEL[street.roadClass]} · {street.edgeIds.length}
              </span>
            </div>
          )}
        </div>

        {/* Household Slots (residential homes OR flats above shops) */}
        {bld && households.length > 0 && (
          <div className="border-t border-[#DCD9D0] pt-4">
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-xs font-semibold text-[#1C1F23]">
                {bld.kind === BuildingKind.Venue ? 'Flats Above Shop' : 'Household Slots'} (
                {households.length})
              </h3>
              {vacantCount > 0 && (
                <button
                  type="button"
                  onClick={() => onClaimSlot(bld.id)}
                  className="text-xs font-medium text-[#1D4E5F] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Claim Vacant Slot</span>
                </button>
              )}
            </div>

            <div className="divide-y divide-[#EAE8E1] border border-[#DCD9D0] rounded bg-white">
              {households.map((slot) => (
                <div
                  key={slot.id}
                  className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-[#1C1F23] truncate">
                      {slot.occupantName ?? 'Vacant Household'}
                    </div>
                    <div className="text-[#5A626D]">
                      {slot.unitLabel ? `${slot.unitLabel} · ` : ''}
                      {slot.wealthTier}
                    </div>
                  </div>
                  <span className="font-mono-tabular text-[11px] text-[#5A626D] shrink-0">
                    #{slot.id}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
