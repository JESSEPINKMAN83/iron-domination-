# Iron Dominion weapon-system redesign

## Design goal

Every playable platform must feel like a different combat job, not the same missile with a different model. Price buys specialization, survivability, reach, or flexibility—not a universal damage multiplier.

## Research anchors

- The U.S. Army describes the M4A1 as a modular, accurate direct-fire carbine and the M320 as a separate low-velocity 40 mm grenade system with dedicated ballistic sights.
- The Army's M2010 sniper system emphasizes a variable optic and long-range precision rather than volume of fire.
- Javelin uses fire-and-forget guidance with selectable top-attack and direct-attack profiles.
- Bradley combines a rapid 25 mm chain gun with TOW missiles; those weapons solve different target problems.
- Paladin is a 155 mm indirect-fire system with a deliberately slower firing rhythm.
- Apache combines a 30 mm chain gun, Hydra rockets, and guided Hellfire missiles rather than treating them as interchangeable projectiles.

Primary references:

- https://cpeground.army.mil/Equipment/Equipment-Portfolio/PM-MBCT-Lethality-Portfolio/M4A1-Carbine/
- https://cpeground.army.mil/Equipment/Equipment-Portfolio/PM-MBCT-Lethality-Portfolio/M320-M320A1-Grenade-Launcher-Module/
- https://cpeground.army.mil/Equipment/Equipment-Portfolio/PM-MBCT-Lethality-Portfolio/M2010-Enhanced-Sniper-Rifle/
- https://www.lockheedmartin.com/en-us/products/javelin/javelin-media-kit.html
- https://www.army.mil/article/156153/bradley_fighting_vehicle_upgrades_tested_at_u_s_army_yuma_proving_ground
- https://www.army.mil/article/273189/position_areas_for_artillery_paa_analysis_in_severely_restricted_terrain
- https://www.boeing.com/content/theboeingcompany/us/en/defense/military-rotorcraft/ah-64-apache.html

## Implemented combat identities

| Platform | Primary | Secondary | V-mode fire control | Battlefield role |
| --- | --- | --- | --- | --- |
| Rifle Team | 5.56 burst | 40 mm under-barrel HE | Reflex sight | Mobile anti-infantry |
| Grenadier | Arcing 40 mm HE | — | Ballistic ladder | Cover denial and clustered infantry |
| Sniper | Precision rifle | — | Variable precision optic | Long-range infantry elimination |
| Rocket Team | Top/direct AT missile | AA seeker | Lock box | Ambush armor and air denial |
| Jackal | 25 mm chain gun | Light ATGM | Lead-computing armor sight | Recon and light-target pressure |
| M-17 | 120 mm kinetic round | Guided AT missile | Stabilized tank FCS | Direct armored breakthrough |
| Mauler | 155 mm indirect HE | 25 mm close defense | Artillery ladder | Long-range siege and area damage |
| Wasp | 20 mm rotary cannon | AA missile | Aviation lead funnel | Fast air superiority |
| Vulture | Unguided rocket pod | 25 mm autocannon | Rocket impact pipper | Suppression and attack runs |
| Hammerhead | Multi-role guided missile | Four-bomb heavy salvo | Strike-designation diamond | Premium air/ground strike |

## Flight and lock rules

- A completed lock produces slower guided ordnance with visible pursuit behavior, giving aircraft and fast vehicles a real dodge window.
- An unlocked V-mode shot remains fast and straight even if an enemy crosses the raw aim ray.
- Rocket pods are unguided; they reward lining up an attack run rather than waiting for a lock.
- Direct shells aim at vehicle hull or building facade height. Terrain can still provide real cover, but shells no longer dive toward an entity's ground coordinate.

## Balance rules

- Primary and secondary weapons must cover different target or timing needs.
- High splash, guidance, range, and rate of fire cannot all coexist on one weapon.
- Indirect weapons have minimum range and a longer reload.
- Precision weapons punish exposed targets but are poor at crowd control.
- V-mode feedback scales by the actual weapon class; it does not apply one global projectile-speed boost.

## Local acceptance checklist

Use `?start=weapons-lab` and test every platform against its matching enemy.

1. Confirm each platform has a clearly different reticle and weapon labels.
2. Compare LMB and RMB behavior, reload rhythm, trail, impact, splash, and recoil.
3. Test locked versus unlocked guided shots against a moving aircraft and tank.
4. Verify Vulture rockets stay unguided and Mauler shells visibly arc.
5. Confirm M-17 and Jackal direct shots clear modest terrain when the target is visibly exposed.
6. Confirm automatic combat still destroys a passive base inside the established AI acceptance window.
