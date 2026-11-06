# Ukraine — Reconnaissance and mobile precision

Research checked 5 November 2026. This faction is an equipment-inspired game abstraction, not an order of battle or a real-world quality ranking.

## Evidence and boundaries

- Ukrainian Land Forces describe UAV roles including reconnaissance, artillery adjustment, infantry support, FPV strike and interception: https://landforces.mil.gov.ua/en/about/ground-forces/unmanned-aerial-vehicle/
- The Ukrainian MoD documents interceptor UAVs, including quadcopter designs: https://mod.gov.ua/en/news/defence-forces-of-ukraine-receive-new-high-speed-jedi-shahed-hunter-interceptor-drones-to-counter-shahed-type-threats
- MoD lists Leopard, Bradley, PzH 2000 and Bohdana among operated equipment: https://mod.gov.ua/en/about-us/land-forces
- Ukraine's naval aviation describes TB2 reconnaissance and precision-strike use: https://recrutvms.mil.gov.ua/10brigade
- MoD describes a mixed air fleet and F-16 introduction: https://mod.gov.ua/en/about-us/air-force

Ukraine has combat aviation. This first roster does not include every real aircraft. No claim is made that all Ukrainian drones are superior to Iranian drones, immune to interception, or immune to jamming. Small interceptor UAVs exist, but this quadcopter is now a single-use ground-strike FPV rather than a reusable missile-firing fighter. The game does not simulate fiber-optic links, batteries or electronic warfare. Ground-only targeting is an explicit gameplay role, not a claim that all FPV drones lack interception uses.

## Why choose it?

A wider view of the battlefield and mobile combined arms. FPV Strike Drones scout and commit to one ground-impact attack. TB2s seek exposed ground targets with a smaller, precise payload. Reposition ground forces and artillery rather than win a frontal damage trade.

## Playable roster

| Existing chassis | Ukrainian identity | Gameplay distinction |
|---|---|---|
| Rifle infantry | Mechanized Infantry | 10% faster repositioning |
| Sniper | Recon Marksman | Existing precision role; 10% faster repositioning |
| Grenadier | Assault Infantry | Existing ballistic support role; 10% faster |
| ATGM team | Stugna-P ATGM Team | Existing ATGM role; 10% faster |
| Scout APC | BTR-4 Bucephalus | 25% more vision, 10% faster, 10% less health |
| Tank | Leopard 2A6 | 10% faster, 10% less health; wedge-turret model |
| Siege tank | PzH 2000 | 10% faster, 10% less health; tracked artillery silhouette |
| Deployable artillery | Bohdana Field Gun | 30% faster while mobile; truck-mounted model; same deployment restrictions |
| Light aircraft | FPV Strike Drone | Single-use physical ground impact, 110 engagement range, no rockets or air-to-air weapon; 48% of base hull health |
| Rocket aircraft | Mi-24 Hind | Conventional rocket support; 78% of Apache hull health |
| Heavy aircraft | Bayraktar TB2 | Ground-only guided munition, 196 range, one bomb instead of four; 65% more vision, 25% faster, 52% of heavy gunship hull health |

All percentages are gameplay balancing relative to the reused base chassis. Existing production costs remain unchanged for this first balance pass. Ukraine can produce conventional aviation and counter-UAS defenses, but cannot build Iran's strategic missile program or Israel's Arrow 3.

## Integration and performance

- Third doctrine `drone-network`, country/flag Ukraine, separate setup option and roster labels.
- Per-entity profile is applied once at initial staging or production and saved with the entity. Committed FPV dives use a bounded state update on the existing combat pass; no projectile or extra entity is created.
- AI builds aviation, mixes TB2s and ground-strike FPVs, avoids buying FPVs as anti-air fighters, and retains the existing artillery/flanking/retreat systems.
- Eleven static 384px WebP portraits. Generic existing building art is reused.
- Cached primitive geometry; static UAV parts are merged by material and rotors retain existing animation. Existing unit caps, culling, effects budgets and LOD remain in force.
- No live two-computer play or physical older-laptop benchmark has been performed for this branch.
