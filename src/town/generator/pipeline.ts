import { TownData, TownParams, TownPreset } from '../model/types';
import {
  createInitialContext,
  hashTownData,
  runStageArterials,
  runStageBlocks,
  runStageGraph,
  runStageHouseholds,
  runStageLotsAndFitting,
  runStageRetailAndFrontageVenues,
  runStageSpineAndDomain,
  runStageStreamlines,
  runStageStreetsAndAddresses,
  runStageTensorField,
  runStageUrbanityAndDistricts,
  runStageVenueSiteReservation,
} from './stages';

export const GENERATOR_VERSION = '0.2.1';

export function createDefaultParams(overrides?: Partial<TownParams>): TownParams {
  const domainSize = overrides?.domainSize ?? { w: 3800, h: 2000 };
  const townExtent = overrides?.townExtent ?? Math.max(domainSize.w, domainSize.h);
  const coreDistrictCount = overrides?.coreDistrictCount ?? 2;
  const satelliteCount = overrides?.satelliteCount ?? 3;
  const coreSigma = overrides?.coreSigma ?? overrides?.coreRadius ?? 380;
  return {
    seed: 1042,
    generatorVersion: GENERATOR_VERSION,
    preset: TownPreset.MarketTown,
    townShape: 'auto',
    domainSize,
    spineMaxOffset: 250,
    spineMinRadius: 150,
    branchLength: [800, 1500],
    coreSigma,
    satelliteSigma: [200, 260],
    stretchAlongSpine: 1.6,
    ribbonSigma: 70,
    ribbonWeight: 0.20,
    builtUpThreshold: 0.25,
    ribbonThreshold: 0.10,
    noiseAmp: 0.25,
    townExtent,
    coreDistrictCount,
    satelliteCount,
    coreRadius: coreSigma,
    satelliteDistance: [650, 1200],
    ribbonDensity: 0.5,
    targetBuildings: [900, 1400],
    namedNpcCount: 2000,
    retailClusterStrength: 1.0,
    districtCount: coreDistrictCount + satelliteCount,
    townRadius: townExtent * 0.5,
    themeId: 'ordnance_paper',
    ...overrides,
  };
}

export function generateTownSync(
  params: TownParams,
  onProgress?: (stageLabel: string, percent: number) => void
): TownData {
  const domainSize = params.domainSize ?? { w: 3800, h: 2000 };
  const townExtent = Math.max(domainSize.w, domainSize.h);
  const coreSigma = params.coreSigma ?? params.coreRadius ?? 380;
  const ctx = createInitialContext({
    ...params,
    domainSize,
    townExtent,
    coreSigma,
    coreRadius: coreSigma,
    townRadius: townExtent * 0.5,
    districtCount: (params.coreDistrictCount ?? 2) + (params.satelliteCount ?? 3),
  });

  onProgress?.('Rotated domain & curving arterial spine', 8);
  runStageSpineAndDomain(ctx);

  onProgress?.('Urbanity density field & Voronoi districts', 16);
  runStageUrbanityAndDistricts(ctx);

  onProgress?.('Arterial corridors, country lanes & service roads', 24);
  runStageArterials(ctx);

  onProgress?.('Spine-aligned tensor field & jogs', 34);
  runStageTensorField(ctx);

  onProgress?.('RK4 streamlines inside built-up mask', 48);
  runStageStreamlines(ctx);

  onProgress?.('Planar graph & arterial connectivity', 56);
  runStageGraph(ctx);

  onProgress?.('Block extraction & large-block capping', 64);
  runStageBlocks(ctx);

  onProgress?.('Large venue & retail park row reservation', 72);
  runStageVenueSiteReservation(ctx);

  onProgress?.('Lots, urbanity gradient, ribbon sprawl & Voronoi fields', 84);
  runStageLotsAndFitting(ctx);

  onProgress?.('Street naming & odd/even addressing', 90);
  runStageStreetsAndAddresses(ctx);

  onProgress?.('Retail clustering & DBSCAN hulls', 95);
  runStageRetailAndFrontageVenues(ctx);

  onProgress?.('Household capacity & geometry audit', 99);
  runStageHouseholds(ctx);

  const data: TownData = {
    params: { ...ctx.params },
    generatorVersion: ctx.params.generatorVersion,
    hash: '',
    resolvedTownShape: ctx.resolvedTownShape,
    domainAngle: ctx.domainAngle,
    domainPolygon: ctx.domainPolygon,
    spinePolyline: ctx.spinePolyline,
    arterialPolylines: ctx.arterialPolylines,
    settlementNodes: ctx.settlementNodes,
    builtUpPolygons: ctx.builtUpPolygons,
    ribbonContours: ctx.ribbonContours,
    retailParkServiceRoad: ctx.retailParkServiceRoad,
    entryPoints: ctx.entryPoints,
    districts: ctx.districts,
    tensorBases: ctx.tensorBases,
    streamlines: ctx.streamlines,
    streets: ctx.streets,
    nodes: ctx.nodes,
    edges: ctx.edges,
    blocks: ctx.blocks,
    lots: ctx.lots,
    buildings: ctx.buildings,
    venueSites: ctx.venueSites,
    venues: ctx.venues,
    retailClusters: ctx.retailClusters,
    unplacedVenues: ctx.unplacedVenues,
    households: ctx.households,
    estimatedPopulation: ctx.estimatedPopulation,
    namedShare: ctx.namedShare,
    fields: ctx.fields,
    woodlands: ctx.woodlands,
    hedgerows: ctx.hedgerows,
    treeClusters: ctx.treeClusters,
    discardedSliverBlocks: ctx.discardedSliverBlocks,
    diagnostics: ctx.diagnostics,
    fittingAttempts: ctx.fittingAttempts,
    fittingWarning: ctx.fittingWarning,
    overlapViolations: ctx.overlapViolations,
  };

  data.hash = hashTownData(data);
  onProgress?.('Complete', 100);
  return data;
}

export function generateTownAsync(
  params: TownParams,
  onProgress?: (stageLabel: string, percent: number) => void
): Promise<TownData> {
  if (typeof Worker !== 'undefined') {
    return new Promise((resolve) => {
      try {
        const worker = new Worker(new URL('./worker.ts', import.meta.url), {
          type: 'module',
        });
        worker.onmessage = (ev: MessageEvent) => {
          const msg = ev.data;
          if (msg.type === 'progress') {
            onProgress?.(msg.stageLabel, msg.percent);
          } else if (msg.type === 'done') {
            worker.terminate();
            resolve(msg.town as TownData);
          }
        };
        worker.onerror = () => {
          worker.terminate();
          resolve(generateTownSync(params, onProgress));
        };
        worker.postMessage({ params });
      } catch {
        resolve(generateTownSync(params, onProgress));
      }
    });
  }
  return Promise.resolve(generateTownSync(params, onProgress));
}
