import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { BuildingKind, DwellingType, TownData, TownPreset } from '../town/model/types';
import { createDefaultParams, generateTownSync } from '../town/generator/pipeline';
import { runInvariants } from '../town/generator/stages';

interface VerificationScreenProps {
  town: TownData;
}

export const VerificationScreen: React.FC<VerificationScreenProps> = ({ town }) => {
  const report = useMemo(() => runInvariants(town), [town]);
  const [determinismResult, setDeterminismResult] = useState<{
    checkedHash: string;
    matched: boolean;
  } | null>(null);
  const [batchResult, setBatchResult] = useState<{
    label: string;
    total: number;
    passed: number;
    avgMs: number;
    maxMs: number;
    failures: Array<{ seed: number; reason: string }>;
  } | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const cancelBatchRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelBatchRef.current = true;
    };
  }, []);

  const capacityRows = useMemo(() => {
    const counts = {
      venuesOther: 0,
      flatsAboveVenues: 0,
      detachedMansion: 0,
      semiDetached: 0,
      terraced: 0,
      flatBuilding: 0,
      flatUnits: 0,
    };
    const flatBuildingsCounted = new Set<number>();
    const householdCountByBld = new Map<number, number>();
    for (const h of town.households) {
      householdCountByBld.set(h.buildingId, (householdCountByBld.get(h.buildingId) ?? 0) + 1);
    }

    for (const b of town.buildings) {
      if (b.kind !== BuildingKind.Residential) {
        counts.venuesOther++;
        if (b.kind === BuildingKind.Venue) {
          const shopFlats = householdCountByBld.get(b.id) ?? 0;
          if (shopFlats > 0 && !flatBuildingsCounted.has(b.id)) {
            flatBuildingsCounted.add(b.id);
            counts.flatsAboveVenues += shopFlats;
          }
        }
      } else if (
        b.dwellingType === DwellingType.Detached ||
        b.dwellingType === DwellingType.LuxuryMansion
      ) {
        counts.detachedMansion++;
      } else if (b.dwellingType === DwellingType.SemiDetached) {
        counts.semiDetached++;
      } else if (b.dwellingType === DwellingType.Terraced) {
        counts.terraced++;
      } else if (b.dwellingType === DwellingType.FlatBuilding) {
        counts.flatBuilding++;
        counts.flatUnits += b.unitIds.length;
      }
    }
    return counts;
  }, [town]);

  const totalDurationMs = useMemo(
    () => town.diagnostics.reduce((acc, d) => acc + d.durationMs, 0),
    [town.diagnostics]
  );

  const slowestStageName = useMemo(() => {
    let best = '';
    let maxD = -1;
    for (const d of town.diagnostics) {
      if (d.durationMs > maxD) {
        maxD = d.durationMs;
        best = d.stage;
      }
    }
    return best;
  }, [town.diagnostics]);

  const requiredSlots = Math.ceil((1.05 * town.params.namedNpcCount) / 2.3);
  const slotRatio =
    requiredSlots > 0 ? (town.households.length / requiredSlots).toFixed(2) : '—';

  const handleCheckDeterminism = () => {
    const rerun = generateTownSync(town.params);
    setDeterminismResult({
      checkedHash: rerun.hash,
      matched: rerun.hash === town.hash,
    });
  };

  const handleRunBatch = (count: number, startSeed: number, label: string) => {
    cancelBatchRef.current = false;
    setBatchProgress({ done: 0, total: count });
    setBatchResult(null);

    const presets = [
      TownPreset.MarketTown,
      TownPreset.IndustrialTown,
      TownPreset.PostWarEstate,
      TownPreset.CommuterTown,
    ];
    let idx = 0;
    let passed = 0;
    let totalTime = 0;
    let maxMs = 0;
    const failures: Array<{ seed: number; reason: string }> = [];

    const stepChunk = () => {
      if (cancelBatchRef.current) return;
      const chunkEnd = Math.min(count, idx + 4);
      for (; idx < chunkEnd; idx++) {
        const seed = startSeed + idx;
        const t0 = performance.now();
        const t = generateTownSync(
          createDefaultParams({
            seed,
            preset: presets[idx % presets.length],
            coreDistrictCount: idx % 3 === 0 ? 2 : 3,
            satelliteCount: idx % 2 === 0 ? 3 : 4,
          })
        );
        const dt = performance.now() - t0;
        totalTime += dt;
        if (dt > maxMs) maxMs = dt;
        const rep = runInvariants(t);
        if (rep.allPassed) {
          passed++;
        } else {
          failures.push({
            seed,
            reason: rep.checks
              .filter((c) => !c.passed)
              .map((c) => `${c.label}: ${c.detail}`)
              .join('; '),
          });
        }
      }

      setBatchProgress({ done: idx, total: count });
      if (idx < count) {
        setTimeout(stepChunk, 0);
      } else {
        setBatchResult({
          label,
          total: count,
          passed,
          avgMs: totalTime / count,
          maxMs,
          failures,
        });
        setBatchProgress(null);
      }
    };

    setTimeout(stepChunk, 15);
  };

  return (
    <main className="flex-1 overflow-y-auto bg-[#F4F2EC]">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#DCD9D0] pb-5">
          <div>
            <h1 className="font-display text-2xl font-semibold text-[#1C1F23]">
              Invariants, Capacity & Pipeline Verification
            </h1>
            <p className="mt-1 text-sm text-[#5A626D]">
              Seed {town.params.seed} ({town.resolvedTownShape}) · v{town.generatorVersion} · Hash {town.hash} · Total {totalDurationMs.toFixed(1)} ms · Unplaced venues: {town.unplacedVenues.length} · Discarded slivers: {town.discardedSliverBlocks}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleCheckDeterminism}
              className="px-3.5 py-2 text-xs font-medium rounded-md border border-[#DCD9D0] bg-white hover:bg-[#EFECE3] text-[#1C1F23] cursor-pointer transition-colors"
            >
              Verify Determinism Hash
            </button>
            <button
              type="button"
              onClick={() => handleRunBatch(50, 1, '50-Seed Audit (1–50)')}
              disabled={batchProgress !== null}
              className="px-4 py-2 text-xs font-medium rounded-md bg-[#1D4E5F] hover:bg-[#163D4B] text-white cursor-pointer disabled:opacity-60 transition-colors"
            >
              {batchProgress?.total === 50
                ? `Auditing ${batchProgress.done}/50...`
                : '50-Seed Audit (1–50)'}
            </button>
            <button
              type="button"
              onClick={() => handleRunBatch(200, 1000, '200-Seed Batch')}
              disabled={batchProgress !== null}
              className="px-4 py-2 text-xs font-medium rounded-md border border-[#1D4E5F] text-[#1D4E5F] bg-white hover:bg-[#EFECE3] cursor-pointer disabled:opacity-60 transition-colors"
            >
              {batchProgress?.total === 200
                ? `Running ${batchProgress.done}/200...`
                : '200-Seed Batch'}
            </button>
          </div>
        </div>

        {determinismResult && (
          <div className="p-4 rounded-md border border-[#DCD9D0] bg-[#FAF9F6] flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              {determinismResult.matched ? (
                <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
              ) : (
                <XCircle className="w-4 h-4 text-[#DC2626]" />
              )}
              <span className="font-medium text-[#1C1F23]">
                {determinismResult.matched
                  ? 'Determinism Verified: two independent runs of Seed ' +
                    town.params.seed +
                    ' produced identical TownData hashes.'
                  : 'Hash mismatch detected.'}
              </span>
            </div>
            <span className="font-mono-tabular text-xs text-[#5A626D]">
              {town.hash} === {determinismResult.checkedHash}
            </span>
          </div>
        )}

        {batchResult && (
          <div className="p-4 rounded-md border border-[#DCD9D0] bg-[#FAF9F6] space-y-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-[#1C1F23]">
                {batchResult.label}: {batchResult.passed}/{batchResult.total} seeds passed all v0.2.1 invariants
              </span>
              <span className="font-mono-tabular text-xs text-[#5A626D]">
                Avg {batchResult.avgMs.toFixed(0)} ms · Worst {batchResult.maxMs.toFixed(0)} ms
              </span>
            </div>
            {batchResult.failures.length > 0 && (
              <ul className="text-xs text-[#DC2626] space-y-1 pt-1 max-h-40 overflow-y-auto">
                {batchResult.failures.map((f) => (
                  <li key={f.seed}>
                    Seed {f.seed}: {f.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Invariants */}
          <section className="bg-[#FAF9F6] border border-[#DCD9D0] rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-[#DCD9D0] bg-[#EFECE3] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#1C1F23]">
                v0.2.1 Structural & Geometry Invariants
              </h2>
              <span className="text-xs font-medium text-[#16A34A]">
                {report.checks.filter((c) => c.passed).length}/{report.checks.length} Passed
              </span>
            </div>
            <div className="divide-y divide-[#EAE8E1]">
              {report.checks.map((chk) => (
                <div
                  key={chk.id}
                  className="px-4 py-3 flex items-start justify-between gap-3 text-xs"
                >
                  <div className="flex items-start gap-2.5">
                    {chk.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 text-[#DC2626] shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className="font-medium text-[#1C1F23]">{chk.label}</div>
                      <div className="text-[#5A626D] mt-0.5">{chk.detail}</div>
                    </div>
                  </div>
                  <span
                    className={`font-medium shrink-0 ${
                      chk.passed ? 'text-[#16A34A]' : 'text-[#DC2626]'
                    }`}
                  >
                    {chk.passed ? 'PASS' : 'FAIL'}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Capacity Breakdown */}
          <section className="bg-[#FAF9F6] border border-[#DCD9D0] rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-[#DCD9D0] bg-[#EFECE3] flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[#1C1F23]">
                Household Capacity Breakdown
              </h2>
              <span className="text-xs font-mono-tabular text-[#5A626D]">
                {slotRatio}× req ({requiredSlots}) · ~{town.estimatedPopulation.toLocaleString()} pop
              </span>
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#DCD9D0] text-[#5A626D]">
                  <th className="py-2.5 px-4">Type</th>
                  <th className="py-2.5 px-4 text-right">Buildings</th>
                  <th className="py-2.5 px-4 text-right">Households</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE8E1] font-mono-tabular">
                <tr>
                  <td className="py-2.5 px-4 font-sans text-[#1C1F23]">
                    Venues & Non-Residential (incl. flats above)
                  </td>
                  <td className="py-2.5 px-4 text-right">{capacityRows.venuesOther}</td>
                  <td className="py-2.5 px-4 text-right">{capacityRows.flatsAboveVenues}</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-4 font-sans text-[#1C1F23]">
                    Detached & Luxury Mansion
                  </td>
                  <td className="py-2.5 px-4 text-right">{capacityRows.detachedMansion}</td>
                  <td className="py-2.5 px-4 text-right">{capacityRows.detachedMansion}</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-4 font-sans text-[#1C1F23]">Semi-Detached</td>
                  <td className="py-2.5 px-4 text-right">{capacityRows.semiDetached}</td>
                  <td className="py-2.5 px-4 text-right">{capacityRows.semiDetached}</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-4 font-sans text-[#1C1F23]">Terraced</td>
                  <td className="py-2.5 px-4 text-right">{capacityRows.terraced}</td>
                  <td className="py-2.5 px-4 text-right">{capacityRows.terraced}</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-4 font-sans text-[#1C1F23]">Flat Buildings</td>
                  <td className="py-2.5 px-4 text-right">{capacityRows.flatBuilding}</td>
                  <td className="py-2.5 px-4 text-right">{capacityRows.flatUnits}</td>
                </tr>
                <tr className="bg-[#EFECE3]/60 font-semibold">
                  <td className="py-2.5 px-4 font-sans text-[#1C1F23]">Total</td>
                  <td className="py-2.5 px-4 text-right">{town.buildings.length}</td>
                  <td className="py-2.5 px-4 text-right">{town.households.length}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>

        {/* Stage Diagnostics */}
        <section className="bg-[#FAF9F6] border border-[#DCD9D0] rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-[#DCD9D0] bg-[#EFECE3]">
            <h2 className="text-sm font-semibold text-[#1C1F23]">
              Pipeline Stage Timings
            </h2>
          </div>
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#DCD9D0] text-[#5A626D]">
                <th className="py-2.5 px-4">Stage</th>
                <th className="py-2.5 px-4">Output Summary</th>
                <th className="py-2.5 px-4 text-right">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE8E1]">
              {town.diagnostics.map((d) => {
                const isSlowest = d.stage === slowestStageName;
                return (
                  <tr key={d.stage} className={isSlowest ? 'bg-[#EFECE3]/50' : ''}>
                    <td className="py-2.5 px-4 font-medium text-[#1C1F23] whitespace-nowrap">
                      {d.stage}
                    </td>
                    <td className="py-2.5 px-4 text-[#5A626D]">{d.summary}</td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono-tabular ${
                        isSlowest ? 'font-semibold text-[#C2593F]' : 'text-[#1C1F23]'
                      }`}
                    >
                      {d.durationMs.toFixed(2)} ms
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
};
