import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { MapTheme, TownData, TownParams, TownPreset } from '../town/model/types';
import { PRESET_CONFIGS } from '../town/data/presets';
import { createDefaultParams, generateTownSync } from '../town/generator/pipeline';
import { runInvariants } from '../town/generator/stages';
import { renderThumbnailToCanvas } from '../town/view/mapRenderer';

interface SeedGalleryScreenProps {
  baseParams: TownParams;
  theme: MapTheme;
  onSelectSeedTown: (params: TownParams) => void;
}

interface GalleryCardData {
  seed: number;
  preset: TownPreset;
  town: TownData;
  allPassed: boolean;
  failedLabels: string[];
}

const ThumbnailCanvas: React.FC<{ town: TownData; theme: MapTheme }> = ({
  town,
  theme,
}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) {
      renderThumbnailToCanvas(ref.current, town, theme);
    }
  }, [town, theme]);

  return (
    <canvas
      ref={ref}
      width={400}
      height={250}
      className="w-full aspect-[16/10] block bg-[#E6E2D6]"
    />
  );
};

export const SeedGalleryScreen: React.FC<SeedGalleryScreenProps> = ({
  baseParams,
  theme,
  onSelectSeedTown,
}) => {
  const [startSeed, setStartSeed] = useState<number>(baseParams.seed);
  const [presetMode, setPresetMode] = useState<'mixed' | TownPreset>('mixed');
  const [cards, setCards] = useState<GalleryCardData[]>([]);
  const [isBuilding, setIsBuilding] = useState(false);

  const buildGallery = React.useCallback(
    (seedStart: number, mode: 'mixed' | TownPreset) => {
      setIsBuilding(true);
      requestAnimationFrame(() => {
        const presetList = [
          TownPreset.MarketTown,
          TownPreset.IndustrialTown,
          TownPreset.PostWarEstate,
          TownPreset.CommuterTown,
        ];
        const next: GalleryCardData[] = [];
        for (let i = 0; i < 12; i++) {
          const seed = seedStart + i;
          const preset =
            mode === 'mixed' ? presetList[i % presetList.length] : mode;
          const params = createDefaultParams({
            seed,
            preset,
            coreDistrictCount: i % 3 === 0 ? 2 : 3,
            satelliteCount: i % 2 === 0 ? 3 : 4,
            themeId: baseParams.themeId,
          });
          const town = generateTownSync(params);
          const inv = runInvariants(town);
          next.push({
            seed,
            preset,
            town,
            allPassed: inv.allPassed,
            failedLabels: inv.checks
              .filter((c) => !c.passed)
              .map((c) => c.label),
          });
        }
        setCards(next);
        setIsBuilding(false);
      });
    },
    [baseParams.themeId]
  );

  useEffect(() => {
    buildGallery(startSeed, presetMode);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    buildGallery(startSeed, presetMode);
  };

  return (
    <main className="flex-1 overflow-y-auto bg-[#F4F2EC]">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#DCD9D0] pb-5">
          <div>
            <h1 className="font-display text-2xl font-semibold text-[#1C1F23]">
              12-Seed Spine Corridor Atlas Gallery
            </h1>
            <p className="mt-1 text-sm text-[#5A626D]">
              3.8 × 2.0 km spine-and-urbanity corridors showing strip, fork, and crossroads layouts, Voronoi fields, Retail Park rows, and invariant checks.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="gallery-start-seed"
                className="block text-xs font-semibold text-[#1C1F23] mb-1"
              >
                Start Seed
              </label>
              <input
                id="gallery-start-seed"
                type="number"
                value={startSeed}
                onChange={(e) => setStartSeed(Math.max(0, Number(e.target.value) || 0))}
                className="px-3 py-1.5 text-xs font-mono-tabular bg-white border border-[#DCD9D0] rounded-md w-28 text-[#1C1F23]"
              />
            </div>
            <div>
              <label
                htmlFor="gallery-preset-select"
                className="block text-xs font-semibold text-[#1C1F23] mb-1"
              >
                Preset Mix
              </label>
              <select
                id="gallery-preset-select"
                value={presetMode}
                onChange={(e) =>
                  setPresetMode(e.target.value as 'mixed' | TownPreset)
                }
                className="px-3 py-1.5 text-xs bg-white border border-[#DCD9D0] rounded-md text-[#1C1F23]"
              >
                <option value="mixed">Mixed All Presets</option>
                {Object.values(PRESET_CONFIGS).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={isBuilding}
              className="px-4 py-1.5 text-xs font-medium rounded-md bg-[#1D4E5F] hover:bg-[#163D4B] text-white cursor-pointer disabled:opacity-60 transition-colors"
            >
              {isBuilding ? 'Rendering...' : 'Render 12 Seeds'}
            </button>
          </form>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {cards.map((card) => (
            <button
              key={`${card.seed}-${card.preset}`}
              type="button"
              onClick={() => onSelectSeedTown(card.town.params)}
              className="text-left bg-[#FAF9F6] border border-[#DCD9D0] rounded-md overflow-hidden hover:border-[#1D4E5F] transition-colors cursor-pointer group"
            >
              <ThumbnailCanvas town={card.town} theme={theme} />
              <div className="p-3.5 space-y-1.5 border-t border-[#DCD9D0]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono-tabular text-sm font-semibold text-[#1C1F23] group-hover:text-[#1D4E5F]">
                    Seed {card.seed}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium">
                    {card.allPassed ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" />
                        <span className="text-[#16A34A]">Valid</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5 text-[#D97706]" />
                        <span className="text-[#D97706]">Check</span>
                      </>
                    )}
                  </span>
                </div>
                <div className="text-xs text-[#5A626D] truncate">
                  {PRESET_CONFIGS[card.preset].label} · {card.town.resolvedTownShape} ({card.town.settlementNodes.length} nodes)
                </div>
                <div className="text-xs font-mono-tabular text-[#5A626D]">
                  {card.town.buildings.length} bldgs · ~{card.town.estimatedPopulation.toLocaleString()} pop · {card.town.retailClusters.length} clusters
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
};
