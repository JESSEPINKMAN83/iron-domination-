# Unit visual upgrade — local review

2026-09-05 · branch `codex/map-variety`

The unit phase follows the building redesign on the same branch. Changes are render-only; gameplay, balance, maps and environment are outside this phase. Publishing and deployment remain pending the user's combined testing.

## Models

- Infantry: rounded anatomy, shaped helmets and plate carriers, magazine pouches, gloves, smaller goggles/knee protection, muted camouflage, and kit details including sniper fabric and upright spare rocket tubes. Existing soldier joints and animation references remain intact.
- Jackal/M-17/Mauler: clipped and sloped armor, cylindrical gun barrels, segmented skirts, tread detail, turret cheek armor, optics and equipment.
- Wasp: compact scout fuselage, bubble canopy, slender boom, skids and chin gun.
- Vulture: tandem attack cockpit, twin engine pods, stub wings and seven-mouth rocket pods.
- Hammerhead: broad fuselage, twin rotor outriggers, twin tail fins and eight individually animated missiles.
- Harvester: shaped hull, beveled machinery and dark cab glazing, preserving cutter, scoop, conveyor and cargo references.

Static meshes share cached geometry and merge by material while animated parts remain separate. All eleven unit UI portraits use the same builders as the battlefield, through the bounded command portrait queue.

## Local review

- http://localhost:5173/unit-studio.html — orbit, zoom, switch factions and compare matching thumbnails.
- http://localhost:5173/?start=lineup&map=crater-oasis&size=small&seed=42&quality=full&armies=2&sides=1,2&relief=100 — live lineup.

The studio is a development entry point, not part of the production UI. Visually inspected infantry, armor and aircraft in the studio and the running local lineup. Full manual combat/animation and performance acceptance remains part of user testing.

## Validation

- `npm test`: 497 tests across 72 files passed.
- New model checks cover all eleven models: portrait framing, geometry sharing across factions, disposal safety, fewer than 100 meshes and 20,000 triangles per preview, plus attached rotor/missile/recoil/harvesting pivots.
- Re-ran the 12 model tests after final preview material/disposal cleanup: passed.
- `npm run build`: passed. Existing large bundle advisory remains.
- `git diff --check`: passed.

Next phase: maps and environment. This visual phase is being published after its focused review; deployment follows PR checks and review.
