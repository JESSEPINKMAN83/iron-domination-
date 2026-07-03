# Handoff prompt — continue IRON DOMINION from here

> Give your agent this file as its prompt (or paste the whole thing). It continues
> work in this same folder: `/Users/danir/Development/iron-dominion`.

---

You are taking over a phased game build mid-way through **Phase 1**. Read
`IRON_DOMINION_BUILD_PLAN.md` (the full spec) and `PROGRESS.md` (what's done) before
touching anything.

## Current state

All Phase 1 source code is **written but never compiled, tested, or run**, because
`npm install` was blocked by the network (see blocker below). The dependency versions
in `package.json` (`three@^0.170`, `postprocessing@^6.36`, `n8ao@^1.9`, `vite@^6`,
`vitest@^2`, `@types/three@^0.170`) were chosen from memory and never verified against
real packages — expect small API/type mismatches, most likely in:

- `src/render/renderer.ts` — CSM import (`three/addons/csm/CSM.js`), CSM constructor
  params, `postprocessing` effect constructors, `N8AOPostPass` typings (add a local
  `.d.ts` shim if `n8ao` ships none).
- `src/render/terrainMesh.ts` — `onBeforeCompile` shader-chunk string replacements
  must match the installed three version's chunk names (`map_pars_fragment`,
  `map_fragment`, `vUv` via `USE_UV` define).
- `node_modules` may contain a partial tree from a killed install — if `npm install`
  misbehaves, delete `node_modules` and retry.

There is **no git repo yet** — initialize one and commit when Phase 1 passes.

## Network blocker (must resolve first)

`registry.npmjs.org` and `registry.yarnpkg.com` are TCP-blocked on this machine by the
**GlobalProtect VPN** (Palo Alto, active on utun4). General internet works. The user
must disconnect GlobalProtect from the macOS menu bar; verify with
`curl -sS -o /dev/null -w "%{http_code}" https://registry.npmjs.org/` (000 = still
blocked). **Do NOT use the Wix internal mirror (`npm.dev.wixpress.com`) — this is a
personal project and the user explicitly declined it.** Do not add any `.npmrc`
registry override. If the registry is still blocked, stop and ask the user to
disconnect the VPN rather than working around it.

## Your task — finish Phase 1 ONLY

1. `npm install` (postinstall copies Draco/Basis decoders to `public/libs/`).
2. `npm test` — the sim determinism tests in `src/sim/heightfield.test.ts` must pass.
3. `npm run build` — fix TypeScript/API errors until clean. Keep fixes minimal;
   don't redesign.
4. `npm run dev` — open the game, verify every Phase 1 acceptance criterion below.
5. Fix whatever fails verification (visual glitches, controls, perf).
6. Update `PROGRESS.md` (done / known issues / next), `git init`, commit Phase 1.
7. **Do not start Phase 2.** No ECS, no units, no refactors beyond what Phase 1 needs.

## Phase 1 acceptance criteria (from the plan)

- ~60 fps while orbiting/panning a lit, textured ~1 km² map with **5,000** instanced
  trees/rocks (HUD top-left shows fps, draw calls, instance count).
- Fixed 30 Hz sim tick with render interpolation (HUD shows `sim 30 Hz`).
- Terrain: 512×512 heightmap, splat-mapped grass/dirt/rock/ore textures, terraced
  cliffs; **F3** overlays walkability (red = blocked cliffs/water).
- Water plane with animated shader (waves, shore foam, sun specular) in the basins.
- Lighting: hemisphere + directional sun with 3-cascade shadow maps; postprocessing:
  SSAO, SMAA, subtle bloom, color-grading LUT, vignette.
- Camera: WASD/arrows/screen-edge pan; right-drag AND Space-drag grab pan; wheel zoom
  clamped 28–140 (HUD shows zoom); Q/E rotate in 90° steps; all smoothly damped.
- Asset pipeline present: GLTFLoader + Draco + KTX2 wired (`src/render/assets.ts`),
  instanced-mesh registry (`src/render/instancing.ts`).

## Hard rules (from the plan — keep them)

- `/src/sim` must stay renderer-independent: **zero three.js imports** there.
- Terrain/walkability generation stays seed-deterministic (tests enforce it).
- One phase per session; never refactor across phase boundaries without asking.
- All art/names stay original placeholders (no Westwood/EA assets or names).

## File map

```
IRON_DOMINION_BUILD_PLAN.md  full phased spec (Phase 1 = §Phase 1)
PROGRESS.md                  phase log — update it
scripts/copy-decoders.mjs    postinstall: copies Draco/Basis into public/libs
src/engine/   loop.ts (30 Hz fixed-step), input.ts, events.ts
src/sim/      noise.ts, heightfield.ts (+ .test.ts)  ← no three.js here
src/content/  map01.ts (seed 1337, 512 cells, 2 m/cell)
src/render/   renderer.ts (CSM + postprocessing), terrainMesh.ts (splat + F3 overlay),
              water.ts, scatter.ts (5,000 props), instancing.ts, assets.ts, textures.ts
src/modes/    rtsCamera.ts
src/ui/       hud.ts
```
