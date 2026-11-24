# Second Helpings Atlas — Procedural Town & Physical Map (v0.2.1)

Deterministic, spine-anchored 2.6 km procedural town generator and interactive physical cartographic atlas built with pure TypeScript geometry kernels, React, and HTML5 Canvas.

## Architecture & Pipeline Stages

All geometry and procedural stages are written in pure TypeScript (`src/town/*`) with zero React/DOM dependencies so algorithms map cleanly 1:1 to GDScript (`Vector2`, `Rect2`, `Geometry2D`):

1. **Spine, Urbanity Field & Polycentric Settlements (`Stages 1–2`)**: Generates a 2.6 km × 1.8 km rectangular domain anchored by an organic Catmull-Rom primary arterial spine (`strip`, `fork`, or `crossroads` via `TownShape`), continuous thresholded urbanity field `urbanity(x, y) >= 0.35`, ribbon arterial sprawl lobes, coalesced central core districts (`OldTown`, `VictorianTerraces`, `Parkside`), and satellite districts (`StationIndustrial`, `PostWarEstate`, `Suburb`).
2. **Arterials, Service Roads & Country Lane (`Stage 2.5`)**: Protects the spine + branch arterials, adds town-center bypass loops without circular border rings, builds a single open rural `countryLane`, and lays out a parallel `Retail Park Service Road` campus alongside an outer arterial.
3. **Tensor Field, Streamlines & Planar Graph (`Stages 3–5`)**: Blends per-district tensor fields aligned to local arterials, traces spine-aligned `Main`, `Secondary`, and `Lane` streets inside the urbanity contour, preserves connected `Arterial` corridors and service roads, and bisects built-up blocks exceeding `11,200 m²` so blocks `> 12,000 m²` stay `<= 8%` of built-up area.
4. **Pre-Lot Venue Sites (`Stage 6b`)**: Reserves plot venues (`Millbrook Supermarket` + `3–4` `Retail Park Store` units in a cohesive campus row with `>= 10 m` gaps and a shared car park, `Station`, `Schools`, `Leisure Centre`, `Town Supermarket`, `Pubs`) *before* residential sub-division, verifying exact polygon containment and road clearance.
5. **Spatial Gradient, Voronoi Fields & Overlap Repair (`Stages 7–9`)**: Applies radial + spine-distance density gradient `m(r)`, drops outer garden lots, adds ribbon cottages and road-aligned Voronoi agricultural fields (`15–40` fields aligned `<= 15°` to nearest arterial/country lane) with hedgerows and organic woodlands, and runs `repairBuildingsPass` guaranteeing zero overlaps (`<= 0.01 m²` footprint, `<= 0.5 m²` lot).
6. **Streets, Retail Clustering & Capacity (`Stages 10–12`)**: Assigns UK street names and odd/even + `Flat N, ...` addresses, places frontage retail (`High Street`, district `Parades`, `Millbrook Retail Park`) detected via DBSCAN (`eps = 60 m`, `minPts = 4`) on an isolated `'retail'` RNG stream, and calibrates household slots (`1.8x–3.0x` required slots for `2,000` named NPCs).

## v0.2.1 Changelog (Spine-Based Town Layout Fix)

- **Milestone A — Spine & Urbanity Field**: Replaced circular perimeter ring and convex hull border with Catmull-Rom regional spines (`strip` / `fork` / `crossroads`) and a continuous `urbanity(p) >= 0.35` settlement contour (PCA elongation `>= 2.2`, roundness `<= 0.45`, zero enclosed outer loops).
- **Milestone B — Spine-Aligned Streets & Campus Venues**: Oriented `RoadClass.Main` / `Secondary` tensors to local arterials, aligned `OldTown` / `VictorianTerraces` blocks along High Street, replaced scattered big boxes with a dedicated `Retail Park` service-road campus (`>= 3` units in a row, `>= 10 m` gaps, shared front car park), and bisected oversized non-superblock faces (`<= 8%` built-up area `> 12,000 m²`).
- **Milestone C — Voronoi Greenbelt Fields & Country Lane**: Replaced rectangular patch boxes with clipped Voronoi rural parcels oriented within `15°` of the nearest arterial or open `countryLane`, buffered clear of built-up envelopes and roads.
- **Milestones D–F — Audit, Tooling & UI**: Added `'Spine and Urbanity'` inspector overlay, `Town Shape` (`auto` / `strip` / `fork` / `crossroads`) selector, `400×250` rectangular `Seed Gallery` cards, `Verification` **50-Seed Audit (1–50)** runner, and headless `scripts/audit.ts` harness.

## Running & Testing

- **Development server**: `npm run dev` (serves on `http://localhost:3000`)
- **Production build**: `npm run build`
- **Unit & Multi-Seed Invariant Tests**:
  ```bash
  npx tsx --test src/town/geometry/math.test.ts src/town/generator/pipeline.test.ts
  ```
- **50-Seed Headless Audit (`scripts/audit.ts`)**:
  ```bash
  npx tsx scripts/audit.ts
  ```
  Verified baseline across Seeds `1–50`: **50/50 PASS** (`0` SAT building overlaps, `0` road clearances `< 1 m`, PCA aspect ratio `avg 3.48` / `min 2.57`, max roundness `0.373`, generation time `avg 1.98s` / `max 2.91s`).
- **In-App Verification**: Open **Verification** in the top navigation bar to inspect all v0.2.1 + v0.2.0 invariant checks, verify determinism hashes, or run **50-Seed Audit (1–50)** and **200-Seed Batch** suites.

