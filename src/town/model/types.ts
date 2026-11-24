export interface Vec2 {
  x: number;
  y: number;
}

export enum TownPreset {
  MarketTown = 'market_town',
  IndustrialTown = 'industrial_town',
  PostWarEstate = 'post_war_estate',
  CommuterTown = 'commuter_town',
  SeasideResort = 'seaside_resort',
}

export enum DistrictArchetype {
  OldTown = 'old_town',
  VictorianTerraces = 'victorian_terraces',
  PostWarEstate = 'post_war_estate',
  Suburb = 'suburb',
  StationIndustrial = 'station_industrial',
  Parkside = 'parkside',
}

export enum DwellingType {
  Terraced = 'terraced',
  SemiDetached = 'semi_detached',
  Detached = 'detached',
  LuxuryMansion = 'luxury_mansion',
  FlatBuilding = 'flat_building',
}

export enum RoadClass {
  Arterial = 1,
  Main = 2,
  Secondary = 3,
  Lane = 4,
}

export const ROAD_HALF_WIDTH: Record<RoadClass, number> = {
  [RoadClass.Arterial]: 5.8,
  [RoadClass.Main]: 4.2,
  [RoadClass.Secondary]: 2.8,
  [RoadClass.Lane]: 1.8,
};

/**
 * Preparation for future vehicle routing (unused by v0.2 walking Dijkstra).
 */
export const ROAD_SPEED_KPH: Record<RoadClass, number> = {
  [RoadClass.Arterial]: 64,
  [RoadClass.Main]: 48,
  [RoadClass.Secondary]: 32,
  [RoadClass.Lane]: 20,
};

export enum StopReason {
  OutOfDomain = 'OUT_OF_DOMAIN',
  OutOfBuiltUp = 'OUT_OF_BUILTUP',
  Degenerate = 'DEGENERATE',
  TooClose = 'TOO_CLOSE',
  Loop = 'LOOP',
  MaxLength = 'MAX_LENGTH',
  MinLengthReject = 'MIN_LENGTH_REJECT',
}

export enum BlockKind {
  Built = 'built',
  Green = 'green',
  Field = 'field',
}

export enum BuildingKind {
  Residential = 'residential',
  Venue = 'venue',
  Other = 'other',
}

export enum WealthTier {
  Modest = 'modest',
  Working = 'working',
  Comfortable = 'comfortable',
  Affluent = 'affluent',
}

export type RetailGroup =
  | 'food'
  | 'convenience'
  | 'fashion_goods'
  | 'services'
  | 'leisure'
  | 'civic';

export type VenueSiteType = 'frontage' | 'plot' | 'green';

export type SprawlKind = 'ribbon' | 'hamlet' | 'farm';

export type RetailClusterKind = 'high_street' | 'parade' | 'retail_park' | 'single';

export interface MapTheme {
  id: string;
  name: string;
  ground: string;
  outsideDomain: string;
  domainBorder: string;
  fieldFill: string;
  fieldHatch: string;
  woodlandFill: string;
  hedgerowColor: string;
  greenBlock: string;
  parkBlock: string;
  builtBlock: string;
  roadArterialCasing: string;
  roadArterialFill: string;
  roadMainCasing: string;
  roadMainFill: string;
  roadSecondaryCasing: string;
  roadSecondaryFill: string;
  roadLaneFill: string;
  buildingShadow: string;
  buildingStroke: string;
  buildingVenueFill: string;
  venueSiteFill: string;
  venueSiteStroke: string;
  retailClusterFill: string;
  retailClusterStroke: string;
  treeCanopy: string;
  treeCanopyDark: string;
  districtLabelColor: string;
  streetLabelColor: string;
  streetLabelHalo: string;
  routeLineColor: string;
  selectionColor: string;
  hoverColor: string;
  venuePinFill: string;
  venuePinStroke: string;
  districtPalette: Record<DistrictArchetype, string>;
  buildingDistrictPalette: Record<DistrictArchetype, string>;
}

export type TownShape = 'auto' | 'strip' | 'fork' | 'crossroads';
export type ResolvedTownShape = 'strip' | 'fork' | 'crossroads';

export interface SettlementNode {
  id: number;
  kind: 'core' | 'satellite' | 'lobe';
  pos: Vec2;
  tangent: Vec2;
  sigma: number;
  weight: number;
  stretchAlongSpine: number;
  archetype?: DistrictArchetype;
}

export interface TownParams {
  seed: number;
  generatorVersion: string;
  preset: TownPreset;
  townShape: TownShape;
  domainSize: { w: number; h: number }; // default 3800 x 2000 m
  spineMaxOffset: number; // default 250 m
  spineMinRadius: number; // default 150 m
  branchLength: [number, number]; // default [800, 1500] m
  coreSigma: number; // default 380 m
  satelliteSigma: [number, number]; // default [200, 260] m
  stretchAlongSpine: number; // default 1.6
  ribbonSigma: number; // default 70 m
  ribbonWeight: number; // default 0.20
  builtUpThreshold: number; // default 0.25
  ribbonThreshold: number; // default 0.10
  noiseAmp: number; // default 0.25
  townExtent: number; // derived max(domainSize.w, domainSize.h)
  coreDistrictCount: number; // 2-3 (default 2)
  satelliteCount: number; // 2-3 satellites + 1-2 lobes (default 3)
  coreRadius: number; // compat alias synced with coreSigma
  satelliteDistance: [number, number]; // compat
  ribbonDensity: number; // default 0.5
  targetBuildings: [number, number]; // default [900, 1400]
  namedNpcCount: number; // default 2000
  retailClusterStrength: number; // default 1.0 (0 = unclustered, 2 = strong)
  districtCount: number; // derived/sync (5 or 6)
  townRadius: number; // derived townExtent * 0.5
  themeId: string;
}

export interface District {
  id: number;
  name: string;
  kind: 'core' | 'satellite';
  nodeKind: 'core' | 'satellite' | 'lobe';
  archetype: DistrictArchetype;
  seedPoint: Vec2;
  polygon: Vec2[]; // primary (largest) component polygon
  polygons: Vec2[][]; // intersected built-up polygons for this district
  color: string;
  dwellingMix: Record<DwellingType, number>;
  wealthTier: WealthTier;
  venueProfile: string[];
}

export interface Street {
  id: number;
  name: string;
  roadClass: RoadClass;
  speedKph: number;
  isCulDeSac: boolean;
  edgeIds: number[];
  traceIds: number[];
  polyline: Vec2[];
}

export interface GraphNode {
  id: number;
  pos: Vec2;
  edgeIds: number[];
}

export interface GraphEdge {
  id: number;
  nodeA: number;
  nodeB: number;
  streetId: number;
  traceId: number;
  roadClass: RoadClass;
  speedKph: number;
  isCulDeSac: boolean;
  polyline: Vec2[];
  length: number;
}

export interface Block {
  id: number;
  polygon: Vec2[];
  districtId: number;
  edgeIds: number[];
  kind: BlockKind;
  area: number;
  isSprawlBlock?: boolean;
}

export interface Lot {
  id: number;
  blockId: number;
  districtId: number;
  polygon: Vec2[];
  frontageEdge: [Vec2, Vec2];
  frontageMidpoint: Vec2;
  streetId: number;
  edgeId: number;
  side: 'left' | 'right';
  dwellingType: DwellingType;
  isFringe: boolean;
  isGardenOrParking: boolean;
}

export interface Address {
  streetId: number;
  number: number;
  unitLabel: string; // e.g., "" or "Flat 3"
}

export interface Building {
  id: number;
  lotId: number;
  blockId: number;
  districtId: number;
  footprint: Vec2[];
  centroid: Vec2;
  kind: BuildingKind;
  dwellingType: DwellingType | null;
  address: Address;
  addressString: string;
  unitIds: number[];
  venueId: number | null;
  entrancePos: Vec2;
  entranceEdgeId: number;
  isFringe: boolean;
  sprawlType: SprawlKind | null;
}

export interface VenueDef {
  id: string;
  displayName: string;
  category: string;
  retailGroup: RetailGroup;
  siteType: VenueSiteType;
  footprint: { w: number; wMax?: number; d: number };
  site?: { w: number; d: number };
  extraLabel?: string;
  flatsAbove?: { min: number; max: number };
  isAnchor?: boolean;
  requiredDistrictTags: DistrictArchetype[];
  frontageClass: RoadClass;
  minArea: number;
  countRange: [number, number];
  minSpacing: number;
  isParkType?: boolean;
  isUniqueStoryLocation?: boolean;
}

export interface VenueSite {
  id: number;
  defId: string;
  venueId: number | null;
  blockId: number;
  districtId: number;
  edgeId: number;
  sitePolygon: Vec2[];
  footprintPolygon: Vec2[];
  extraPolygon: Vec2[] | null;
  extraLabel: string | null;
  entrancePos: Vec2;
  catalogW: number;
  catalogD: number;
}

export interface Venue {
  id: number;
  defId: string;
  name: string;
  category: string;
  retailGroup: RetailGroup;
  siteType: VenueSiteType;
  buildingId: number | null;
  siteId: number | null;
  clusterId: number | null;
  blockId: number;
  districtId: number;
  address: Address;
  addressString: string;
  entrancePos: Vec2;
  entranceEdgeId: number;
  pos: Vec2;
  catalogW: number;
  catalogD: number;
}

export interface RetailCluster {
  id: number;
  kind: RetailClusterKind;
  name: string;
  districtId: number;
  venueIds: number[];
  hull: Vec2[];
}

export interface HouseholdSlot {
  id: number;
  buildingId: number;
  unitLabel: string;
  dwellingType: DwellingType;
  wealthTier: WealthTier;
  occupantId: number; // -1 if vacant
  occupantName: string | null;
}

export interface FieldPolygon {
  id: number;
  polygon: Vec2[];
  angle: number;
}

export interface TreeCluster {
  id: number;
  center: Vec2;
  trees: Array<{ x: number; y: number; r: number }>;
}

export interface StreamlineTrace {
  traceId: number;
  level: RoadClass;
  family: 'major' | 'minor';
  points: Vec2[];
  stopReasonForward: StopReason;
  stopReasonBackward: StopReason;
}

export interface TensorBasis {
  kind: 'grid' | 'radial' | 'curved_radial';
  center: Vec2;
  angle: number;
  size: number;
  strength: number;
  decay: number;
  warpStrength: number;
  noiseFreq?: number;
  districtId?: number;
}

export interface StageDiagnostic {
  stage: string;
  durationMs: number;
  summary: string;
}

export interface OverlapViolation {
  kind: 'footprint' | 'road' | 'lot' | 'containment' | 'venue_site';
  polygon: Vec2[];
  detail: string;
}

export interface TownData {
  params: TownParams;
  generatorVersion: string;
  hash: string;
  resolvedTownShape: ResolvedTownShape;
  domainAngle: number;
  domainPolygon: Vec2[];
  spinePolyline: Vec2[];
  arterialPolylines: Vec2[][];
  settlementNodes: SettlementNode[];
  builtUpPolygons: Vec2[][];
  ribbonContours: Vec2[][];
  retailParkServiceRoad: Vec2[] | null;
  entryPoints: Vec2[];
  districts: District[];
  tensorBases: TensorBasis[];
  streamlines: StreamlineTrace[];
  streets: Street[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  blocks: Block[];
  lots: Lot[];
  buildings: Building[];
  venueSites: VenueSite[];
  venues: Venue[];
  retailClusters: RetailCluster[];
  unplacedVenues: Array<{ defId: string; displayName: string; reason: string }>;
  households: HouseholdSlot[];
  estimatedPopulation: number;
  namedShare: number;
  fields: FieldPolygon[];
  woodlands: Vec2[][];
  hedgerows: Array<[Vec2, Vec2]>;
  treeClusters: TreeCluster[];
  discardedSliverBlocks: number;
  diagnostics: StageDiagnostic[];
  fittingAttempts: number;
  fittingWarning: string | null;
  overlapViolations: OverlapViolation[];
}

export interface RouteResult {
  found: boolean;
  polyline: Vec2[];
  distanceMeters: number;
  walkingMinutes: number;
  streetNames: string[];
}

export interface InvariantCheckResult {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface InvariantReport {
  allPassed: boolean;
  checks: InvariantCheckResult[];
}

/**
 * Canonical address formatter used everywhere in the generator and UI.
 */
export function formatAddress(
  address: Address,
  streetsById: Map<number, Street> | Street[]
): string {
  const street = Array.isArray(streetsById)
    ? streetsById.find((s) => s.id === address.streetId)
    : streetsById.get(address.streetId);
  const streetName = street ? street.name : `Street #${address.streetId}`;
  if (address.unitLabel && address.unitLabel.length > 0) {
    return `${address.unitLabel}, ${address.number} ${streetName}`;
  }
  return `${address.number} ${streetName}`;
}
