# Grok prompt: expand the asymmetric factions

You are helping design and, only after approval, implement the next faction-weapons update for **Iron Dominion**, a browser-based fictional RTS/FPS hybrid. Use your current public web and X knowledge to generate grounded game ideas. The two factions are fictional, but their strategic contrast is intentionally parallel to publicly discussed aspects of the United States–Iran conflict.

This is a **game-design and public-source research task**, not a request for real operational planning. Do not provide weapon-construction instructions, targeting procedures, vulnerabilities of real installations, classified or leaked information, or advice that could facilitate real-world violence. Keep all implementation names fictional. Treat real systems only as high-level inspiration for roles, tradeoffs, and counterplay. Cite dated public sources and clearly distinguish confirmed facts, estimates, and your own game-design inference. Prefer official sources, manufacturers, reputable defense publications, and well-established open-source analysts; use X posts as leads and corroborate important claims elsewhere.

## Current game concept

Players configure every army independently in the setup table. Each army chooses a side/alliance and one of these types; multiplayer rooms synchronize the full set of assignments.

### Aegis Coalition — US-inspired capability model

- Identity: air superiority, reconnaissance, precision air attack, and layered interception.
- Exclusive production: Helipad and aircraft.
- Current aircraft: Wasp armed scout, Vulture rocket gunship, Hammerhead strike craft.
- Current strategic defense: Missile Defense Battery. It detects incoming strategic missiles and launches smaller interceptors. A standard strategic missile currently needs roughly five interceptor hits to be destroyed, with durability increasing by warhead level.
- Aircraft can also attack an incoming strategic missile.
- Everyone can see the incoming strategic missile’s health bar.
- Limitation: no Intelligence Center, strategic Missile Silo, or long-range strategic strike program.
- Future direction: better air-defense layers, airborne intelligence, electronic warfare, and possibly anti-drone systems.

### Vesper Republic — Iran-inspired capability model

- Identity: asymmetric long-range strike, intelligence, dispersion, saturation, and eventually drones.
- Exclusive buildings: Intelligence Center and strategic Missile Silo.
- Strategic missile flow: choose a map location, see the possible impact radius, launch, and receive random scatter inside that radius.
- Upgrades are separated into warhead power and accuracy. Accuracy shrinks the possible impact radius; power increases damage, impact scale, and missile durability.
- Defenders receive an immediate launch warning. Strategic missile impacts are intentionally much larger and more damaging than ordinary tank missiles.
- Limitation: no Helipad or aircraft production at all.
- Future direction already desired: one-way attack drones, reconnaissance drones, decoys, mobile launch concepts, and saturation tactics, all with readable defensive counterplay.

### Shared baseline roster

- Economy/buildings: Power Plant, Refinery, Barracks, Factory.
- Infantry: Rifle Team, Grenadier, Sniper, Rocket Team.
- Vehicles: Jackal Scout AFV, M-17 Main Battle Tank, Mauler Siege Gun.
- Shared defenses: Wall, Fortress Guard Tower, AA Missile Tower.
- Aegis-only defense: Missile Defense Battery.

## What I want from you

1. Research the publicly known capability patterns that distinguish US-style air power and layered defense from Iran-style missile/drone and asymmetric strike doctrine. Focus on **gameplay roles**, not exact replication.
2. Produce **12–18 concrete game ideas**, balanced across both factions. Each idea must include:
   - fictional unit/building/upgrade name;
   - real-world capability category that inspired it;
   - battlefield role and player decision it creates;
   - production prerequisite and approximate game cost/build time;
   - range, cooldown, damage or defensive effect expressed relative to the current units;
   - clear counters available to the opposing faction;
   - UI warning/telegraph needed to keep it fair;
   - multiplayer and AI implications;
   - why it is fun rather than merely realistic.
3. Include ideas from these categories where credible:
   - Aegis: airborne early warning/ISR, stealth or low-observable strike, electronic warfare, suppression of air defenses, combat air patrol, layered terminal/area missile defense, anti-drone defense, and precision munitions.
   - Vesper: ballistic and cruise missile variants, reconnaissance and one-way attack drones, decoys, saturation salvos, mobile launchers, hardened/hidden infrastructure, electronic deception, and cheaper distributed defenses.
4. Do not make either faction a strict upgrade over the other. Preserve the core asymmetry:
   - Aegis spends more for flexible aircraft, information, and interception.
   - Vesper accepts weaker/no conventional air power in exchange for cheaper dispersed threats, strategic reach, and saturation.
5. Identify mechanics that would be frustrating—unavoidable base deletion, invisible attacks, perfect interception, excessive micromanagement—and explain how to prevent them.
6. Recommend the **best three additions for the next small PR**. Prefer additions that reuse the current strategic-missile, projectile-health, warning, radar/vision, production, and upgrade systems. Rank them by gameplay value, implementation effort, and regression risk.
7. For those three recommendations, provide an implementation brief tied to the likely repository areas:
   - `src/content/phase3.ts` for units/buildings and faction restrictions;
   - `src/content/phase4.ts` and `src/content/unitArsenal.ts` for weapons;
   - `src/sim/strategicWarfare.ts`, `src/sim/combat.ts`, and `src/sim/economy.ts` for simulation;
   - `src/ai/commander.ts` for AI usage and counters;
   - `src/render/` for readable visuals;
   - `src/ui/sidebar.ts` and setup UI for controls and explanations;
   - multiplayer deterministic state/commands and tests.
8. End with a source table containing title/author, publication date, URL, capability category, confidence, and the specific game-design inference you drew from it.

## Coding/PR rules

Do **not** code immediately. First return the research, design matrix, balance proposal, and the recommended three-item scope for approval. If I then approve implementation:

- inspect the repository before editing;
- create a new branch from the current reviewed branch;
- keep the work additive and deterministic for multiplayer;
- avoid real country names, flags, political messaging, and exact real weapon names in player-facing content;
- add thumbnails matching the existing 256×192 dark isometric command-card style;
- add simulation, AI, serialization/hash, and multiplayer tests proportionate to the change;
- run the production build and full test suite;
- open a separate PR for review, but do not merge or deploy it.

Start by giving me the research-backed design proposal only.
