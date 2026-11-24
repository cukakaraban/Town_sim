import {
  Block,
  Building,
  District,
  GraphEdge,
  Lot,
  RetailCluster,
  RoadClass,
  Street,
  TownData,
  Vec2,
  Venue,
  VenueSite,
} from './types';
import { SpatialHash } from '../geometry/spatialHash';
import { dist, pointInPolygon, pointToSegment, polygonBounds } from '../geometry/geom';

export const ROAD_CLASS_LABEL: Record<RoadClass, string> = {
  [RoadClass.Arterial]: 'Arterial Road',
  [RoadClass.Main]: 'Main Road',
  [RoadClass.Secondary]: 'Secondary Street',
  [RoadClass.Lane]: 'Lane / Alley',
};

export interface PickResult {
  kind: 'venue' | 'building' | 'block' | 'street';
  id: number;
  building: Building | null;
  venue: Venue | null;
  block: Block | null;
  street: Street | null;
  lot: Lot | null;
  district: District | null;
}

export interface SearchHit {
  kind: 'venue' | 'building' | 'street' | 'resident';
  id: number;
  title: string;
  subtitle: string;
  pos: Vec2;
  buildingId: number | null;
  venueId: number | null;
  streetId: number | null;
}

export class TownIndex {
  readonly data: TownData;
  private buildingHash: SpatialHash<Building>;
  private blockHash: SpatialHash<Block>;
  private edgeHash: SpatialHash<GraphEdge>;

  readonly districtsById = new Map<number, District>();
  readonly streetsById = new Map<number, Street>();
  readonly edgesById = new Map<number, GraphEdge>();
  readonly blocksById = new Map<number, Block>();
  readonly lotsById = new Map<number, Lot>();
  readonly buildingsById = new Map<number, Building>();
  readonly buildingsByAddress = new Map<string, Building>();
  readonly venuesById = new Map<number, Venue>();
  readonly venuesByBuildingId = new Map<number, Venue>();
  readonly venuesByBlockId = new Map<number, Venue>();
  readonly retailClustersById = new Map<number, RetailCluster>();
  readonly venueSitesById = new Map<number, VenueSite>();
  readonly venueSitesByVenueId = new Map<number, VenueSite>();

  constructor(data: TownData) {
    this.data = data;
    this.buildingHash = new SpatialHash<Building>(40);
    this.blockHash = new SpatialHash<Block>(80);
    this.edgeHash = new SpatialHash<GraphEdge>(50);

    for (const d of data.districts) this.districtsById.set(d.id, d);
    for (const s of data.streets) this.streetsById.set(s.id, s);
    for (const rc of data.retailClusters) this.retailClustersById.set(rc.id, rc);
    for (const vs of data.venueSites) {
      this.venueSitesById.set(vs.id, vs);
      if (vs.venueId !== null) this.venueSitesByVenueId.set(vs.venueId, vs);
    }

    for (const e of data.edges) {
      this.edgesById.set(e.id, e);
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const p of e.polyline) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      this.edgeHash.insertBounds(
        minX - 6,
        minY - 6,
        maxX + 6,
        maxY + 6,
        e.polyline[0],
        e
      );
    }
    for (const blk of data.blocks) {
      this.blocksById.set(blk.id, blk);
      const b = polygonBounds(blk.polygon);
      this.blockHash.insertBounds(b.minX, b.minY, b.maxX, b.maxY, blk.polygon[0], blk);
    }
    for (const lot of data.lots) this.lotsById.set(lot.id, lot);
    for (const bld of data.buildings) {
      this.buildingsById.set(bld.id, bld);
      this.buildingsByAddress.set(bld.addressString.toLowerCase(), bld);
      const b = polygonBounds(bld.footprint);
      this.buildingHash.insertBounds(
        b.minX - 2,
        b.minY - 2,
        b.maxX + 2,
        b.maxY + 2,
        bld.centroid,
        bld
      );
    }
    for (const v of data.venues) {
      this.venuesById.set(v.id, v);
      if (v.buildingId !== null) this.venuesByBuildingId.set(v.buildingId, v);
      this.venuesByBlockId.set(v.blockId, v);
      if (v.siteId !== null && !this.venueSitesByVenueId.has(v.id)) {
        const vs = this.venueSitesById.get(v.siteId);
        if (vs) this.venueSitesByVenueId.set(v.id, vs);
      }
    }
  }

  pickAtPoint(p: Vec2, zoom = 1): PickResult | null {
    // 1. Check venue pins within adaptive zoom hit radius
    const pinRadius = Math.max(9, Math.min(28, 12 / Math.max(0.25, zoom)));
    let bestVenue: Venue | null = null;
    let bestVenueDist = pinRadius;
    for (const v of this.data.venues) {
      const d = dist(p, v.pos);
      if (d < bestVenueDist) {
        bestVenueDist = d;
        bestVenue = v;
      }
    }
    if (bestVenue) {
      const bld =
        bestVenue.buildingId !== null
          ? this.buildingsById.get(bestVenue.buildingId) ?? null
          : null;
      const blk = this.blocksById.get(bestVenue.blockId) ?? null;
      const lot = bld ? this.lotsById.get(bld.lotId) ?? null : null;
      const street = this.streetsById.get(bestVenue.address.streetId) ?? null;
      const district = this.districtsById.get(bestVenue.districtId) ?? null;
      return {
        kind: 'venue',
        id: bestVenue.id,
        building: bld,
        venue: bestVenue,
        block: blk,
        street,
        lot,
        district,
      };
    }

    // 2. Check buildings via spatial hash + point-in-polygon
    const candBuildings = this.buildingHash.queryBounds(p.x - 2, p.y - 2, p.x + 2, p.y + 2);
    for (const bld of candBuildings) {
      if (pointInPolygon(p, bld.footprint)) {
        const venue = bld.venueId !== null ? this.venuesById.get(bld.venueId) ?? null : null;
        const lot = this.lotsById.get(bld.lotId) ?? null;
        const blk = this.blocksById.get(bld.blockId) ?? null;
        const street = this.streetsById.get(bld.address.streetId) ?? null;
        const district = this.districtsById.get(bld.districtId) ?? null;
        return {
          kind: venue ? 'venue' : 'building',
          id: venue ? venue.id : bld.id,
          building: bld,
          venue,
          block: blk,
          street,
          lot,
          district,
        };
      }
    }

    // 3. Check nearest street edge within 8 m
    const nearestEdge = this.findNearestEdge(p, 8);
    if (nearestEdge) {
      const street = this.streetsById.get(nearestEdge.edge.streetId) ?? null;
      if (street) {
        return {
          kind: 'street',
          id: street.id,
          building: null,
          venue: null,
          block: null,
          street,
          lot: null,
          district: this.findDistrictAt(p),
        };
      }
    }

    // 4. Check green/park blocks
    const candBlocks = this.blockHash.queryBounds(p.x - 1, p.y - 1, p.x + 1, p.y + 1);
    for (const blk of candBlocks) {
      if (pointInPolygon(p, blk.polygon)) {
        const venue = this.venuesByBlockId.get(blk.id) ?? null;
        const district = this.districtsById.get(blk.districtId) ?? null;
        return {
          kind: venue ? 'venue' : 'block',
          id: venue ? venue.id : blk.id,
          building: null,
          venue,
          block: blk,
          street: null,
          lot: null,
          district,
        };
      }
    }

    return null;
  }

  findDistrictAt(p: Vec2): District | null {
    for (const d of this.data.districts) {
      if (d.polygons && d.polygons.length > 0) {
        for (const poly of d.polygons) {
          if (poly.length >= 3 && pointInPolygon(p, poly)) return d;
        }
      } else if (d.polygon.length >= 3 && pointInPolygon(p, d.polygon)) {
        return d;
      }
    }
    return null;
  }

  findByAddress(addr: string): Building | null {
    return this.buildingsByAddress.get(addr.trim().toLowerCase()) ?? null;
  }

  findNearestEdge(
    p: Vec2,
    maxDist = Infinity
  ): { edge: GraphEdge; dist: number; proj: Vec2 } | null {
    const cands =
      maxDist < Infinity
        ? this.edgeHash.queryBounds(p.x - maxDist, p.y - maxDist, p.x + maxDist, p.y + maxDist)
        : this.data.edges;

    let best: { edge: GraphEdge; dist: number; proj: Vec2 } | null = null;
    for (const e of cands) {
      for (let i = 1; i < e.polyline.length; i++) {
        const res = pointToSegment(p, e.polyline[i - 1], e.polyline[i]);
        if (res.dist <= maxDist && (!best || res.dist < best.dist)) {
          best = { edge: e, dist: res.dist, proj: res.proj };
        }
      }
    }
    return best;
  }

  search(query: string, limit = 20): SearchHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: SearchHit[] = [];

    // Venues first (matches name, category, address, or cluster name)
    for (const v of this.data.venues) {
      const cluster =
        v.clusterId !== null ? this.retailClustersById.get(v.clusterId) : undefined;
      if (
        v.name.toLowerCase().includes(q) ||
        v.category.toLowerCase().includes(q) ||
        v.addressString.toLowerCase().includes(q) ||
        (cluster && cluster.name.toLowerCase().includes(q))
      ) {
        const distObj = this.districtsById.get(v.districtId);
        hits.push({
          kind: 'venue',
          id: v.id,
          title: v.name,
          subtitle: `${v.category}${cluster ? ` · ${cluster.name}` : ''} · ${v.addressString}${distObj ? ` · ${distObj.name}` : ''}`,
          pos: v.pos,
          buildingId: v.buildingId,
          venueId: v.id,
          streetId: v.address.streetId,
        });
        if (hits.length >= limit) return hits;
      }
    }

    // Streets
    for (const s of this.data.streets) {
      if (s.name.toLowerCase().includes(q)) {
        const mid = s.polyline[Math.floor(s.polyline.length / 2)] ?? { x: 0, y: 0 };
        hits.push({
          kind: 'street',
          id: s.id,
          title: s.name,
          subtitle: s.isCulDeSac ? 'Cul-de-sac' : ROAD_CLASS_LABEL[s.roadClass],
          pos: mid,
          buildingId: null,
          venueId: null,
          streetId: s.id,
        });
        if (hits.length >= limit) return hits;
      }
    }

    // Buildings / addresses
    for (const b of this.data.buildings) {
      if (b.addressString.toLowerCase().includes(q)) {
        const distObj = this.districtsById.get(b.districtId);
        hits.push({
          kind: 'building',
          id: b.id,
          title: b.addressString,
          subtitle: `${b.kind === 'venue' ? 'Commercial' : b.dwellingType ?? 'Building'}${distObj ? ` · ${distObj.name}` : ''}`,
          pos: b.centroid,
          buildingId: b.id,
          venueId: b.venueId,
          streetId: b.address.streetId,
        });
        if (hits.length >= limit) return hits;
      }
    }

    // Residents
    for (const h of this.data.households) {
      if (h.occupantName && h.occupantName.toLowerCase().includes(q)) {
        const b = this.buildingsById.get(h.buildingId);
        if (b) {
          hits.push({
            kind: 'resident',
            id: h.id,
            title: h.occupantName,
            subtitle: `${h.unitLabel ? `${h.unitLabel}, ` : ''}${b.addressString}`,
            pos: b.centroid,
            buildingId: b.id,
            venueId: null,
            streetId: b.address.streetId,
          });
          if (hits.length >= limit) return hits;
        }
      }
    }

    return hits;
  }
}
