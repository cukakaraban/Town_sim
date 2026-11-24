import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultParams, generateTownSync } from './pipeline';
import { claimHome, hashTownData, runInvariants } from './stages';
import { SeededRng } from '../geometry/rng';
import { DwellingType, TownPreset, formatAddress } from '../model/types';

test('Town generation is deterministic for identical seed and version', () => {
  const params = createDefaultParams({ seed: 2026 });
  const run1 = generateTownSync(params);
  const run2 = generateTownSync(params);

  assert.equal(run1.hash, run2.hash);
  assert.equal(hashTownData(run1), hashTownData(run2));
  assert.equal(run1.buildings.length, run2.buildings.length);
  assert.equal(run1.streets.length, run2.streets.length);
  assert.equal(run1.venues.length, run2.venues.length);
  assert.equal(run1.retailClusters.length, run2.retailClusters.length);
});

test('Changing retailClusterStrength preserves street layout & non-retail RNG independence', () => {
  const t0 = generateTownSync(createDefaultParams({ seed: 1042, retailClusterStrength: 0.0 }));
  const t2 = generateTownSync(createDefaultParams({ seed: 1042, retailClusterStrength: 2.0 }));

  assert.equal(t0.nodes.length, t2.nodes.length);
  assert.equal(t0.edges.length, t2.edges.length);
  assert.deepEqual(
    t0.streets.map((s) => s.name),
    t2.streets.map((s) => s.name)
  );
  assert.equal(t0.lots.length, t2.lots.length);
});

test('All v0.2.1 Section 6 & v0.2.0 invariants pass across 16 seeds and townShapes within budget', () => {
  const presets = [
    TownPreset.MarketTown,
    TownPreset.IndustrialTown,
    TownPreset.PostWarEstate,
    TownPreset.CommuterTown,
  ];
  const shapes = ['auto', 'strip', 'fork', 'crossroads'] as const;

  for (let i = 0; i < 16; i++) {
    const preset = presets[i % presets.length];
    const params = createDefaultParams({
      seed: 1 + i,
      preset,
      townShape: shapes[i % shapes.length],
      coreDistrictCount: i % 3 === 0 ? 3 : 2,
      satelliteCount: i % 2 === 0 ? 4 : 3,
    });
    const tStart = performance.now();
    const town = generateTownSync(params);
    const elapsed = performance.now() - tStart;
    assert.equal(town.generatorVersion, '0.2.1');
    assert.ok(elapsed < 6000, `Seed ${params.seed} exceeded 6s generation budget (${elapsed.toFixed(0)} ms)`);

    const report = runInvariants(town);
    const failures = report.checks.filter((c) => !c.passed);
    assert.equal(
      report.allPassed,
      true,
      `Seed ${params.seed} (${preset}, ${town.resolvedTownShape}) failed invariants: ${failures
        .map((f) => `${f.id}: ${f.detail}`)
        .join('; ')}`
    );
  }
});

test('Address formatting and claimHome household slot allocation work cleanly', () => {
  const town = generateTownSync(createDefaultParams({ seed: 1042 }));
  const flatBld = town.buildings.find((b) => b.unitIds.length > 1);
  assert.ok(flatBld, 'Expected at least one flat building');
  const flatSlot = town.households.find((h) => h.buildingId === flatBld.id);
  assert.ok(flatSlot && flatSlot.unitLabel.startsWith('Flat '));

  const formatted = formatAddress(
    { ...flatBld.address, unitLabel: flatSlot.unitLabel },
    town.streets
  );
  assert.ok(formatted.startsWith(`${flatSlot.unitLabel}, ${flatBld.address.number} `));

  const claimed = claimHome(
    town,
    { preferredDwelling: DwellingType.FlatBuilding, npcId: 9999, npcName: 'Clara Abbott' },
    new SeededRng(42)
  );
  assert.ok(claimed);
  assert.equal(claimed.occupantId, 9999);
  assert.equal(claimed.occupantName, 'Clara Abbott');
});
