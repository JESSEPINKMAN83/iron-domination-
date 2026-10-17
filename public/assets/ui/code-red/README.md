# Code Red equipment portraits

54 static WebP images rendered from the actual game factories: 24 roster items for each doctrine plus six additional HQ flag variants. `src/ui/codeRedIcons.ts` maps both the sidebar and selection panel to these files.

- Final size: 256 × 192, matching legacy PNG dimensions.
- Render source: 512 × 384, supersampled down with cwebp quality 88.
- Full set: 198,316 bytes. Legacy 23-PNG set: 1,151,275 bytes.
- Shared materials, silhouettes, visual scales and building footprints come directly from UnitView/BuildingView. Portrait framing excludes health bars, selection effects, damage-cell duplicates and building nameplates.
- Units have no gameplay upgrades applied. Nation-specific HQs use the actual cached flag material.
- Runtime UI uses ordinary image elements; no per-card canvas, renderer, model loading or animation loop.

## Review and regenerate

Local static review: `?code-red-thumbnails=1`.

Offline rendering: `?code-red-thumbnails=1&render=1`. The generated images are exposed as `img[data-asset]` in the page. Export these WebP images, then resize to 256 × 192 with cwebp. Rendering is gated by `import.meta.env.DEV`; the production bundle excludes the authoring page.

Do not crop or desaturate the files in CSS: they already have safe framing and contain faction colors. Card layout and height remain unchanged.
