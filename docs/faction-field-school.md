# Faction field school

Local branch: `codex/faction-field-school`, based on main after PR #97.
Preview: http://127.0.0.1:5183/ — open Build, Deploy, Fight or Adapt.

- Flag-only, labelled toggle above the instructor; selection stays when changing chapters and reopening a card during the current visit.
- Eight faction-specific lessons use the game's actual doctrines: Israeli aircraft and layered interception; Iranian missiles, drones and ground forces without aircraft production.
- Full-body instructors share an illustration style, with four distinct chapter poses each: tablet briefing, directing a squad, rifle at low ready, and binoculars/radio assessment. The Israeli female wears matching olive field clothing; the Iranian male wears camouflage and has a more weathered, ordinary middle-aged appearance. These are illustrated game characters, not certified uniform references.
- Transparent WebP assets load only for the selected guide: `public/assets/landing/commander/factions/{israel,iran}-{build,deploy,fight,adapt}.webp`. No simulation or game renderer changes. Additional prompts are recorded in `faction-guide-pose-prompts.md`.
- Verified all eight chapters, portrait loading, close/reopen selection, and 390px mobile layout without horizontal overflow. Browser console clear. Production build passed; existing bundle-size warning remains.
- Local review only; no PR, merge or deployment.

## Artwork provenance and prompts

Generated using the built-in image-generation tool with transparent background enabled. The original `public/assets/landing/commander/build.png` was inspected and supplied as reference. Originals remain in the generator's output directory; project assets are alpha-preserving WebP conversions with `cwebp -q 88`.

### Israel prompt

Edit target: the supplied female field instructor. Preserve the same adult female identity, auburn hair, confident professional expression, premium painted realistic military game illustration style, full body boots-to-head framing, three-quarter pose holding a rugged tablet, slung compact rifle muzzle down. Redesign her clothing as a recognizably authentic contemporary Israeli IDF field uniform: matching plain olive-drab long-sleeve shirt and olive-drab cargo trousers, olive combat helmet with fabric cover rather than a beret, practical olive plate carrier and radio, dark combat boots, small Israeli flag shoulder patch. No tan trousers or fashion costume. Correct anatomy, practical modest fit. Subtle mint rim lighting compatible with a dark green game UI. Isolated single full-body figure on an ACTUALLY TRANSPARENT background, no scenery, no text, no lettering, no floor. Leave safe margin around entire silhouette. Asset is the Israel BUILD instructor.

### Iran prompt

Generate a NEW adult male Iranian military field instructor, not the same person as reference. Reference is STYLE AND FULL-BODY FRAMING ONLY: polished realistic painted military strategy game character illustration. Iranian man around35 with short dark hair, neatly trimmed beard, composed approachable professional expression. Recognizable Iranian field clothing: muted olive/tan/brown pixel camouflage matching shirt and trousers, olive tactical vest, practical olive combat helmet, black combat boots, small Iranian tricolor national flag patch on upper sleeve. Standing three-quarter pose holding rugged tactical tablet, compact rifle safely slung muzzle down. Human realistic anatomy, no stereotype, no exaggerated heroic pose. Subtle warm amber rim light fitting dark green game interface. Full-body isolated figure head to boot soles completely in frame with safe margins. ACTUALLY TRANSPARENT background, no scenery, no text, no lettering, no floor. Asset is Iran BUILD instructor.
