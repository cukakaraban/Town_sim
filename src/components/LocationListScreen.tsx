import React, { useMemo, useState } from 'react';
import { MapPin, Navigation, Search } from 'lucide-react';
import { TownData, Venue } from '../town/model/types';
import { dist } from '../town/geometry/geom';
import { formatWalkingDuration } from './TownSidebar';

interface LocationListScreenProps {
  town: TownData;
  onShowOnMap: (venue: Venue) => void;
  onRouteToVenue: (venue: Venue) => void;
}

export const LocationListScreen: React.FC<LocationListScreenProps> = ({
  town,
  onShowOnMap,
  onRouteToVenue,
}) => {
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [districtFilter, setDistrictFilter] = useState<string>('All');
  const [clusterFilter, setClusterFilter] = useState<string>('All');
  const [viewMode, setViewMode] = useState<'table' | 'clusters'>('clusters');

  const districtsById = useMemo(() => {
    const m = new Map<number, string>();
    for (const d of town.districts) m.set(d.id, d.name);
    return m;
  }, [town.districts]);

  const clustersById = useMemo(() => {
    const m = new Map<number, string>();
    for (const rc of town.retailClusters) m.set(rc.id, rc.name);
    return m;
  }, [town.retailClusters]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const v of town.venues) set.add(v.category);
    return ['All', ...Array.from(set).sort()];
  }, [town.venues]);

  const filteredVenues = useMemo(() => {
    const q = query.trim().toLowerCase();
    return town.venues.filter((v) => {
      if (categoryFilter !== 'All' && v.category !== categoryFilter) return false;
      if (districtFilter !== 'All' && String(v.districtId) !== districtFilter) return false;
      if (clusterFilter === 'standalone' && v.clusterId !== null) return false;
      if (
        clusterFilter !== 'All' &&
        clusterFilter !== 'standalone' &&
        String(v.clusterId) !== clusterFilter
      ) {
        return false;
      }
      if (q) {
        const dName = (districtsById.get(v.districtId) ?? '').toLowerCase();
        const cName = (v.clusterId !== null ? clustersById.get(v.clusterId) ?? '' : '').toLowerCase();
        return (
          v.name.toLowerCase().includes(q) ||
          v.addressString.toLowerCase().includes(q) ||
          v.category.toLowerCase().includes(q) ||
          dName.includes(q) ||
          cName.includes(q)
        );
      }
      return true;
    });
  }, [town.venues, categoryFilter, districtFilter, clusterFilter, query, districtsById, clustersById]);

  const groupedByCluster = useMemo(() => {
    const groups: Array<{
      id: string;
      title: string;
      subtitle: string;
      venues: Venue[];
    }> = [];

    for (const rc of town.retailClusters) {
      const members = filteredVenues.filter((v) => v.clusterId === rc.id);
      if (members.length > 0) {
        const dName = districtsById.get(rc.districtId) ?? '';
        groups.push({
          id: `cluster-${rc.id}`,
          title: rc.name,
          subtitle: `${rc.kind === 'high_street' ? 'High Street' : rc.kind === 'retail_park' ? 'Retail Park' : 'District Parade'} · ${dName} · ${members.length} venues`,
          venues: members,
        });
      }
    }

    const standalone = filteredVenues.filter((v) => v.clusterId === null);
    if (standalone.length > 0) {
      groups.push({
        id: 'standalone',
        title: 'Civic Anchors, Parks & Roadside Singles',
        subtitle: `${standalone.length} standalone or unclustered locations`,
        venues: standalone,
      });
    }
    return groups;
  }, [filteredVenues, town.retailClusters, districtsById]);

  const townCenter = useMemo(() => {
    const sq = town.venues.find((v) => v.defId === 'town_square');
    return sq ? sq.pos : { x: 0, y: 0 };
  }, [town.venues]);

  const renderVenueRow = (venue: Venue) => {
    const meters = Math.round(dist(townCenter, venue.pos));
    const mins = Math.max(1, Math.round(meters / (1.4 * 60)));
    const clusterName =
      venue.clusterId !== null ? clustersById.get(venue.clusterId) ?? '—' : 'Standalone';
    return (
      <tr key={venue.id} className="hover:bg-[#F4F2EC]/80 transition-colors">
        <td className="py-3 px-4 font-medium text-[#1C1F23]">{venue.name}</td>
        <td className="py-3 px-4 text-xs text-[#5A626D]">
          {venue.category} · {clusterName}
        </td>
        <td className="py-3 px-4 font-mono-tabular text-xs text-[#1C1F23]">
          {venue.addressString}
        </td>
        <td className="py-3 px-4 text-xs text-[#5A626D]">
          {districtsById.get(venue.districtId) ?? '—'}
        </td>
        <td className="py-3 px-4 text-right font-mono-tabular text-xs text-[#5A626D]">
          {meters} m · {formatWalkingDuration(mins)}
        </td>
        <td className="py-3 px-4 text-right">
          <div className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={() => onShowOnMap(venue)}
              className="px-2.5 py-1.5 text-xs font-medium rounded border border-[#DCD9D0] bg-white hover:bg-[#EFECE3] text-[#1C1F23] inline-flex items-center gap-1 cursor-pointer whitespace-nowrap transition-colors"
            >
              <MapPin className="w-3.5 h-3.5 text-[#1D4E5F]" />
              <span>Map</span>
            </button>
            <button
              type="button"
              onClick={() => onRouteToVenue(venue)}
              className="px-2.5 py-1.5 text-xs font-medium rounded bg-[#1D4E5F] hover:bg-[#163D4B] text-white inline-flex items-center gap-1 cursor-pointer whitespace-nowrap transition-colors"
            >
              <Navigation className="w-3.5 h-3.5" />
              <span>Directions</span>
            </button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <main className="flex-1 overflow-y-auto bg-[#F4F2EC]">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#DCD9D0] pb-5">
          <div>
            <h1 className="font-display text-2xl font-semibold text-[#1C1F23]">
              Town Directory
            </h1>
            <p className="mt-1 text-sm text-[#5A626D]">
              {town.venues.length} physical venues · {town.retailClusters.length} retail clusters · {town.districts.length} districts · Seed {town.params.seed}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div
              role="group"
              aria-label="Grouping mode"
              className="inline-flex p-0.5 rounded-md bg-[#EAE8E1] border border-[#DCD9D0]"
            >
              <button
                type="button"
                onClick={() => setViewMode('clusters')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded cursor-pointer transition-colors ${
                  viewMode === 'clusters'
                    ? 'bg-white text-[#1C1F23] shadow-sm'
                    : 'text-[#5A626D] hover:text-[#1C1F23]'
                }`}
              >
                By Cluster
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded cursor-pointer transition-colors ${
                  viewMode === 'table'
                    ? 'bg-white text-[#1C1F23] shadow-sm'
                    : 'text-[#5A626D] hover:text-[#1C1F23]'
                }`}
              >
                All Venues
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-[#5A626D] absolute left-2.5 top-2.5 pointer-events-none" />
              <input
                type="search"
                aria-label="Filter locations"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by venue, cluster, street..."
                className="pl-8 pr-3 py-2 text-xs bg-white border border-[#DCD9D0] rounded-md w-56 text-[#1C1F23] focus:outline-none focus:border-[#1D4E5F]"
              />
            </div>

            <select
              aria-label="Filter by retail cluster"
              value={clusterFilter}
              onChange={(e) => setClusterFilter(e.target.value)}
              className="px-3 py-2 text-xs bg-white border border-[#DCD9D0] rounded-md text-[#1C1F23]"
            >
              <option value="All">All Clusters</option>
              {town.retailClusters.map((rc) => (
                <option key={rc.id} value={String(rc.id)}>
                  {rc.name} ({rc.venueIds.length})
                </option>
              ))}
              <option value="standalone">Standalone Venues</option>
            </select>

            <select
              aria-label="Filter by category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-2 text-xs bg-white border border-[#DCD9D0] rounded-md text-[#1C1F23]"
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === 'All' ? 'All Categories' : cat}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by district"
              value={districtFilter}
              onChange={(e) => setDistrictFilter(e.target.value)}
              className="px-3 py-2 text-xs bg-white border border-[#DCD9D0] rounded-md text-[#1C1F23]"
            >
              <option value="All">All Districts</option>
              {town.districts.map((d) => (
                <option key={d.id} value={String(d.id)}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {viewMode === 'clusters' ? (
          groupedByCluster.length === 0 ? (
            <div className="bg-[#FAF9F6] border border-[#DCD9D0] rounded-md py-10 text-center text-sm text-[#5A626D]">
              No venues match your current filter.
            </div>
          ) : (
            <div className="space-y-6">
              {groupedByCluster.map((grp) => (
                <section
                  key={grp.id}
                  className="bg-[#FAF9F6] border border-[#DCD9D0] rounded-md overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-[#DCD9D0] bg-[#EFECE3] flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-sm font-semibold text-[#1C1F23]">
                      {grp.title}
                    </h2>
                    <span className="text-xs text-[#5A626D]">{grp.subtitle}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <tbody className="divide-y divide-[#EAE8E1] text-sm">
                        {grp.venues.map(renderVenueRow)}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          )
        ) : (
          <div className="bg-[#FAF9F6] border border-[#DCD9D0] rounded-md overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#DCD9D0] bg-[#EFECE3] text-xs font-semibold text-[#5A626D]">
                  <th className="py-3 px-4">Venue</th>
                  <th className="py-3 px-4">Category · Cluster</th>
                  <th className="py-3 px-4">Street Address</th>
                  <th className="py-3 px-4">District</th>
                  <th className="py-3 px-4 text-right">From Centre</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE8E1] text-sm">
                {filteredVenues.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-[#5A626D]">
                      No venues match your current filter.
                    </td>
                  </tr>
                ) : (
                  filteredVenues.map(renderVenueRow)
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
};
