# Cinematic command portraits

The UI uses 24 `*-portrait.webp` images, one per building or unit, including the
Command Yard, Ore Collector, and a separate Skylance CIWS portrait. Images are
512px wide, 4:3, and generated using the built-in image-generation tool.

Art direction: grounded realistic military equipment, olive paint and charcoal
hardware, amber key light and cool blue rim light, quiet smoky navy background.
The model-rendered `<kind>.webp` files are retained as silhouette references.
They establish each item's layout, tracks/wheels, rotor configuration, roof
shape, weapon type and role. Infantry use cinematic character portraits.
Original `.png` files are legacy assets.

`src/ui/commandIcons.ts` provides the single mapping used by the sidebar,
selected-force cards and development atlas. Gameplay only loads static images;
no portrait renderer or extra WebGL context runs during a match.

## Preview and authoring

Run the local Vite server and open `/?thumbnail-studio=1` for the static atlas.
Category filters show infrastructure, defense, infantry, vehicles and aircraft.
This atlas does not allocate a WebGL renderer. To regenerate the original model
reference renders, use `/?thumbnail-studio=1&render-models=1`; do not overwrite
the cinematic `*-portrait.webp` artwork with those reference images.

Prompts and source paths are recorded in `art/command-portrait-prompts.json` and
`art/infantry-portraits.md`. Generated originals remain in Codex generated_images.
Final selected outputs are exported here as WebP, retaining aspect ratio.
