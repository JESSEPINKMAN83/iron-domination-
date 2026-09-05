# Building visual upgrade — local review, September 5, 2026

Scope: all 13 existing building kinds and their portraits. This work does not change unit art, costs, health, weapons, AI, collision footprints, or multiplayer commands. Existing uncommitted audio, AI and tactics work in this checkout is preserved.

## Test locally

Run `npm run dev -- --port 5173` from this checkout.

- Building collection: http://localhost:5173/building-studio.html
- Game: http://localhost:5173/

The collection shows the actual battlefield model, lets you orbit/zoom, and switches among four faction colors. Select any of the 13 cards. The collection is development-only and is not included in the production build.

In the game, check Buildings and Defense cards, select a completed building, and compare the selection portrait with the battlefield model. Watch a building take damage: the added details are registered in the existing damage tree and collapse with it.

## Changes

- Beveled damage cells and armor housings; building-specific architectural surface textures with restrained seams, fasteners and weathering.
- Finished side/rear facades, reinforced corners, faction inlays, warning markings and readable industrial designations.
- Command yard roof machinery, CIC crown/glazing, roof access, and concave communications reflector.
- Power plant cooling ribs, service rings and busbars; restrained reactor glow.
- Refinery vessel straps, distillation flanges and catwalk rails.
- Barracks standing-seam roof and reinforced entrance; factory exoskeleton, loading visor and maintenance rail.
- Helipad approach lights, flight-deck edging and corrected H marking.
- Intelligence center parabolic radar, server spines and service rail; silo blast revetments.
- Wall blast belts; reinforced defense shafts and deck fascia; beveled tower launchers.
- Missile battery and Skylance use physical phased-array radar housings. Missile caps now attach to their tubes. Skylance has heavier barrel jackets and its own portrait.
- World and UI share complete model construction. Portraits use the current faction palette, bounded caching, one queued render per frame and a temporary renderer that releases its context when finished.

## Verification

- Production TypeScript/Vite build passes (existing bundle-size advisory remains).
- 471 tests passed in the full sandboxed run; 11 relay tests required localhost socket permission and passed on rerun: 482 tests verified total.
- After final defense refinements, the 22 focused building/model tests and production build passed again.
- Added coverage for all 13 models: complete-model camera framing, damage registration, triangle budget, and distinct Skylance routing.
- Browser checks: full catalog, faction switching, loaded portraits, live match sidebar and battlefield damage/collapse. No errors in the building viewer.

Status: ready for local visual review. No publishing or production deployment performed.

## Concept replacement after visual feedback

The four reviewed buildings now replace their original full-height block bodies and roof props with new architecture in `src/render/buildingConcepts.ts`:

- Missile Silo: paired recessed launch wells, split hatch armor, a slender missile with an ogive nose, and a separate hardened control bunker.
- Missile Defense Battery: six enclosed canisters on an elevated hydraulic cradle, a low bearing emplacement, separate radar cabin and power unit.
- Factory: sawtooth assembly hall, open loading entrance, visible chassis and traveling hoist, plus a service wing.
- Barracks: twin vaulted quarters surrounding an open muster court and linked rear command building.

The original simulation footprints and damage grids remain. The new architecture participates in the existing damage tree, and the UI portraits use these same replacement models. The original oversized roof nameplates are replaced by integrated facade signage for these four structures.

Final validation: all 485 tests across 71 files pass; production build passes. Browser-verified each replacement, matching thumbnails, faction switching, and a fresh local match without console errors. Added geometric checks for the open factory entrance, uncovered courtyard, and upward launcher orientation.
