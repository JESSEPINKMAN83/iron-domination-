# Homepage gameplay film

The homepage background is recorded from the current Three.js game, not generated animation. The local cinematic scenario seeds three mutually hostile armies with real base structures, infantry, armored vehicles and aircraft, using normal combat, weapons and movement systems.

## Capture desk

Open the local Vite server with `?start=cinematic&landing-capture=1&cinematic-ui=clean`. The capture desk records only the WebGL canvas (no HTML HUD) at 1280×720, silently, with a slow camera orbit. Combat labels, health bars, selection markers and fog-of-war are hidden only for cinematic recording. The scene waits until Record is clicked, preserving the opening combat. Download the resulting WebM clip.

Other useful query parameters:

- `armies=3&sides=1,2,3&doctrines=iron-legion,missile-command,iron-legion`
- `size=medium&spawnpts=-20,20,20,-20,20,20,-20,-20` keeps bases away from the map edge.
- `cinematic-shot=base`, `frontline` or `overview`.
- `map=highlands`, `crater-oasis`, `frostbite-pass` or `natanz`.
- `tod=day`, `sunset` or `night`; `weather=clear`, `rain` or `snow`.
- `capture-name=golan-day` sets the download filename.
- `quality=balanced` retains shadows and current models while reducing recording overhead.

The recording path is local and development-only. The homepage plays a pre-rendered silent MP4 loop; it does not run a game simulation behind the menu.

## Current loop

- Golan daylight base orbit: highlands, seed 61, open plains, clear weather.
- Negev armored engagement: crater-oasis, seed 73, sunset, clear weather.
- Hermon combined-arms battle: frostbite-pass, seed 29, daylight, snow.
- Natanz night battle: natanz, seed 12, clear weather.

Each source is a 12-second browser recording. The film uses eight seconds per scene with 0.65-second crossfades and an ending blended back into the opening for a continuous 29.4-second loop. Output: H.264 MP4, 1280×720 at 30 fps, no audio, fast-start metadata. A matching JPEG poster is used before playback and for reduced-motion users. Old footage is retained on disk but no longer referenced by the homepage.
