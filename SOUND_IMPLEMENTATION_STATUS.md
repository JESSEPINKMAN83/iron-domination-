# Iron Dominion sound implementation status

This inventory separates finished recorded assets from procedural placeholders and audio that has not been designed yet. The local playable test match is available at `?start=sound-test`; the isolated soundboard is available at `?sfx-preview=all`.

Continuous engines now use a contextual mix: idle/hover is deliberately quiet, movement raises gain and pitch, Shift boost adds intensity, tracks are a subtle close-only layer, distance falls off rapidly, and nearby groups are automatically normalized so multiple units do not overwhelm the battle mix.

## Recorded assets implemented in the game

| Sound group | Files | What it means in play | How to hear it in the sound battle |
| --- | ---: | --- | --- |
| Strategic missile launch | 1 | Silo ignition and the initial lift from the launcher. | Select the Missile Silo and launch a missile. |
| Strategic missile flight loop | 1 | The sustained motor follows the missile across the map and changes volume with camera distance. | Follow a launched missile with the camera. |
| Strategic missile flyby | 1 | A close, fast pass when the missile crosses near the camera. | Move the camera close to the missile's flight path. |
| Strategic missile impact | 1 | The large ground detonation when a strategic missile reaches its target area. | Aim outside Aegis defense coverage or overwhelm the defenses. |
| Strategic missile interception | 1 | The airborne destruction heard when Aegis shoots down a strategic missile. | Aim inside the Aegis defense envelope. |
| Upgrade confirmation | 1 | Confirms a successful unit, building, missile, or drone upgrade. | Buy any available upgrade. |
| Button hover | 1 | Subtle feedback when the pointer enters any enabled game button. | Move the pointer across game buttons. |
| Button click | 1 | Confirms that any enabled game button was pressed. | Click any game button. |
| Unit acknowledgements | 12 MP3 | Infantry, vehicle, and aircraft responses for selection, movement, attack, and tactics. Volume follows the selected group's distance from the camera and becomes silent outside the audible range. | Select and command units while moving the camera toward and away from them. |
| Heavy gunship engine | 4 | Four looping engine identities assigned to Hammerhead aircraft. | Move the camera around the spawned Hammerheads. |
| Wasp and Vulture engines | 2 | Separate light-interceptor and armored-gunship loops whose volume and pitch react to hover, normal flight, and player Shift boost. | Move the camera near each aircraft, then possess one and compare hovering, forward flight, and Shift boost. |
| Tank engine and tracks | 4 | Four movement loops assigned consistently to M-17 and Mauler vehicles, with speed-sensitive pitch and volume. | Order M-17 or Mauler vehicles to move while keeping the camera nearby. |
| Vehicle engine states | 4 | Separate base engines for M-17, Mauler, and Jackal, plus a Shift-boost layer. Base pitch and volume follow speed; boost crossfades only while actively boosting. | Listen near a stationary vehicle, order it to move, then possess it and hold Shift while driving. |
| Autocannon bursts | 4 | Short automatic-fire variations used by aircraft, vehicles, and Skylance CIWS. | Fight with Wasp, Vulture, Jackal, Mauler secondary fire, or watch Skylance defend. |
| Rocket and missile launchers | 4 | Separate launch character for infantry, armored vehicles, aircraft, and defense towers. | Fight with Rocket Team, Jackal/M-17, aircraft, and AA defenses. |
| Heavy missile launchers | 4 | Platform-specific heavy launches for aircraft, vehicles, emplacements, and advanced missile classes, gain-matched below the nearby engine mix. | Fire Hammerhead, heavy vehicle/emplacement, or advanced missile weapons. |
| Medium missile launchers | 2 | Compact, lower-weight launches assigned to Vulture rocket pods and M-17 guided missiles. | Fire a Vulture rocket pod or the M-17 secondary missile. |
| Shell flybys | 4 | Two standard and two heavy projectile passes, audible when a shell travels near the camera. | Fire M-17 and Mauler shells past the camera. |
| Building impacts | 4 | Different impact weight for light, industrial, defensive, and strategic structures. | Attack the different enemy buildings around the Aegis base. |
| Building destruction | 4 | Dedicated collapse sounds for light, industrial, defensive, and strategic structures, replacing ordinary impact audio on the killing blow. | Destroy different enemy building classes; strategic-missile kills retain a quieter collapse beneath the main warhead blast. |
| Small explosions | 4 | Grenades, light rockets, standard missiles, and destruction of smaller units. | Fight with infantry, light missiles, and smaller vehicles. |
| Medium explosions | 4 | Tank shells, artillery, bombs, and destruction of heavy vehicles or aircraft. | Fight with M-17, Mauler, Vulture, and Hammerhead. |
| Heavy bomb and artillery impacts | 2 | Dedicated high-detail impacts for Mauler/siege ordnance and the denser aircraft or tank bomb blast. | Fire Mauler artillery or drop bombs near the camera; building kills combine the blast with a quieter structural collapse. |
| Armored vehicle destruction | 4 | Separate catastrophic-destruction sounds for Jackal, M-17, Mauler, and armored ore collectors. | Destroy each ground vehicle class; killing blows replace the generic explosion with the class-specific wreck sound. |

**Recorded total: 74 active files (62 WAV and 12 MP3) across 24 gameplay moments.**

## Implemented, but still procedural placeholders

These already react to gameplay and use positional audio, but are synthesized by Web Audio rather than finished recorded assets.

| Sound | Current meaning | Still needed |
| --- | --- | --- |
| UI select, order, build, cancel, and error | Short feedback beeps for map and command actions that are not regular buttons. Button hover and click now use recorded assets. | Recorded command-specific sounds for selection, orders, cancellation, and errors. |
| Building and wall construction | Machinery, clanks, and placement activity. | Recorded construction/deployment layers. |
| Rifle and sniper fire | Light rifle reports and a heavier precision shot. | Distinct recorded weapons for Rifle Team and Sniper. |
| Cannon and heavy cannon fire | Muzzle report for tank and heavy direct-fire weapons. | Dedicated Jackal, M-17, and Mauler firing assets. |
| Grenade, bomb, and generic projectile launch | Launch noise for weapons without a recorded source-specific sample. | Dedicated grenade launch and bomb-release sounds. |
| Generic impact/explosion fallback | Covers combat events that do not match one of the recorded impact groups. | Replace remaining fallback cases with material-specific assets. |
| Possessed-unit hit feedback | Close internal thud/clang while controlling a unit in V-mode. | Recorded interior armor-hit layers. |
| Hard landing and metal crash | Mechanical scrape and impact after crashes or hard bounces. | Dedicated aircraft crash and vehicle wreck sounds. |

## Not implemented yet

| Missing sound | What it should communicate |
| --- | --- |
| Infantry footsteps and gear | Nearby squad movement without becoming noisy at the RTS camera height. |
| Ember drone motor | A distinctive propeller or small-engine loop that follows each one-way drone. |
| Dedicated tank-cannon muzzle blast | Different reports for scout cannon, M-17 main gun, and Mauler artillery. |
| Dedicated rifle, sniper, and grenade launch | Recognizable infantry weapon identities instead of synthesized placeholders. |
| Artillery launch and distant report | The heavy outgoing Mauler shot, including a distant battlefield tail. |
| Bomb release and falling whistle | Separation from aircraft followed by an approaching fall cue. |
| Bullet impacts and ricochets | Dirt, armor, concrete, and water hit materials, including near misses. |
| Burning wreck loop | Persistent but restrained fire/crackle from destroyed vehicles and buildings. |
| Aircraft damage and crash descent | Engine failure, airframe stress, falling motion, and final ground impact. |
| Incoming missile/drone warning | A clear alert for the defending army without masking combat audio. |
| Turret rotation and lock confirmation | Mechanical tracking plus a concise target-lock cue for defenses and guided weapons. |
| Ore collector and refinery loop | Collector engine, mining, cargo loading, return, and ore deposit. |
| Factory, refinery, and power ambience | Quiet local machinery that makes a working base feel alive. |
| Unit production complete | A short cue when infantry, vehicle, or aircraft production finishes. |
| Weapon ready / cooldown complete | Restrained readiness feedback for strategic missiles and drone salvos. |
| Victory and defeat stingers | A short match-ending identity for both outcomes. |
| Weather and map ambience | Wind, rain, snow, water, and subtle biome atmosphere. |

## ElevenLabs generation queue

Generate these **one at a time**. Export WAV at 48 kHz when possible. The suggested filenames are the names the game will use when each asset is supplied.

### Procedural sounds that need recorded replacements

| Suggested filename | Sound | Ready-to-paste ElevenLabs prompt |
| --- | --- | --- |
| `ui-select-01.wav` | Unit selection | Generate exactly one short futuristic military strategy-game unit-selection sound, 0.15 seconds: a clean restrained electronic confirmation tick with a subtle tactical-radio texture. Crisp and readable, not musical, no voice, no ambience, no reverb tail, no clipping. |
| `ui-order-move-01.wav` | Move order | Generate exactly one short RTS movement-order confirmation, 0.2 seconds: a decisive low electronic chirp rising slightly at the end, professional military interface character. No speech, music, ambience, reverb, or additional sounds. |
| `ui-order-attack-01.wav` | Attack order | Generate exactly one short RTS attack-order confirmation, 0.25 seconds: an urgent two-part tactical electronic pulse with a firm low ending. Aggressive but not loud, no voice, music, ambience, or long tail. |
| `ui-build-start-01.wav` | Build command | Generate exactly one compact futuristic construction-command confirmation, 0.35 seconds: a metallic switch engagement followed by a soft powered-machine pulse. Clean isolated sound, no voice, music, background ambience, or long reverb. |
| `ui-cancel-01.wav` | Cancel command | Generate exactly one short military-interface cancellation sound, 0.2 seconds: a muted descending electronic double-click that clearly communicates cancellation without sounding like an error alarm. No voice, music, ambience, or reverb. |
| `ui-error-01.wav` | Invalid action | Generate exactly one concise tactical-interface error sound, 0.3 seconds: a low dry rejected-command buzz with two tight pulses. Noticeable but not harsh, no speech, music, ambience, distortion, or long tail. |
| `construction-structure-01.wav` | Building construction | Generate exactly one isolated futuristic military building-construction sound, 1.5 seconds: heavy machinery starts, hydraulic movement, metal panels lock into place, and one solid finishing clamp. No voice, music, battlefield ambience, or explosion. |
| `construction-wall-01.wav` | Wall construction | Generate exactly one isolated defensive-wall deployment sound, 0.9 seconds: a compact servo lift, concrete-and-metal scrape, and firm mechanical lock. Dry close recording, no voice, music, ambience, or explosion. |
| `rifle-fire-01.wav` | Rifle Team weapon | Generate exactly one short modern fictional military rifle shot suitable for an RTS, 0.35 seconds: sharp controlled crack, compact mechanical action, restrained distant tail. Powerful but not cinematic, no burst, voice, music, ambience, or impact. |
| `sniper-fire-01.wav` | Sniper weapon | Generate exactly one isolated heavy precision-rifle shot, 1 second: deep muzzle report, sharp supersonic crack, and controlled distant decay. One shot only, no bullet impact, echoing battle, music, voice, or background noise. |
| `tank-cannon-m17-01.wav` | M-17 main gun | Generate exactly one isolated futuristic main battle tank cannon firing, 1.5 seconds: enormous low-frequency muzzle blast, metallic hull resonance, brief pressure-wave tail. One shot only, no projectile impact, engine, crew, music, or battlefield ambience. |
| `artillery-mauler-fire-01.wav` | Mauler artillery | Generate exactly one isolated heavy self-propelled artillery launch, 2 seconds: massive 155mm-style report, deep mechanical recoil, heavy air displacement, and a distant low tail. No impact, voices, engine, music, or battle ambience. |
| `grenade-launcher-fire-01.wav` | Grenade launcher | Generate exactly one isolated under-barrel grenade-launcher firing sound, 0.5 seconds: hollow low-pressure thump with a small mechanical click. No explosion, rifle shot, voice, music, ambience, or exaggerated cinematic bass. |
| `bomb-release-01.wav` | Bomb release | Generate exactly one isolated aircraft bomb-release sound, 0.8 seconds: heavy rack latch opens, metal mechanism snaps, and the payload separates with a brief air movement. No explosion, falling whistle, engine, voice, or music. |
| `vehicle-interior-hit-01.wav` | V-mode armor hit | Generate exactly one close interior armored-vehicle impact sound, 0.7 seconds: violent exterior strike transmitted through thick armor, deep hull thud, short metallic ringing, and loose equipment vibration. No explosion, voice, engine, music, or ambience. |
| `vehicle-metal-crash-01.wav` | Hard landing/crash | Generate exactly one isolated heavy military vehicle metal crash, 1.2 seconds: armored mass hits hard ground, suspension collapses, steel scrapes, and debris settles briefly. No explosion, fire, voices, music, or background battle. |

### Sounds with no implementation yet

| Suggested filename | Sound | Ready-to-paste ElevenLabs prompt |
| --- | --- | --- |
| `wheeled-engine-loop-01.wav` | Wheeled vehicle engine | Generate exactly one seamless 5-second loop of a fast armored scout vehicle driving over compact dirt: responsive diesel turbine tone, tire rumble, light suspension chatter, and restrained mechanical vibration. Constant speed, no weapons, voices, music, or other vehicles. |
| `infantry-footsteps-gear-loop-01.wav` | Infantry movement | Generate exactly one seamless 4-second loop of a four-person military squad jogging over dry soil: staggered boot steps, subtle fabric and equipment movement, light gear rattle. RTS-friendly and restrained, no voices, gunfire, music, wind, or vehicles. |
| `ember-drone-engine-loop-01.wav` | Ember drone motor | Generate exactly one seamless 5-second loop of a hostile fictional one-way attack drone in flight: rough compact piston engine, propeller buzz, slight unstable vibration, and an ominous mechanical character. No missile sound, weapons, voice, music, wind gusts, or background battle. |
| `wasp-engine-loop-01.wav` | Wasp interceptor engine | Generate exactly one seamless 6-second loop for a small futuristic military interceptor aircraft: high-energy turbine whine, agile rotor or ducted-fan texture, clean aerodynamic rush. Constant flight speed, no weapons, voices, music, or other aircraft. |
| `vulture-engine-loop-01.wav` | Vulture gunship engine | Generate exactly one seamless 6-second loop for a medium armored attack gunship: heavy twin turbine and rotor texture, muscular low-frequency pulse, mechanical vibration, controlled flight. No weapons, voices, music, alarms, or other aircraft. |
| `bomb-falling-whistle-01.wav` | Falling bomb | Generate exactly one isolated 3-second falling heavy bomb approach: distant air whistle grows rapidly louder and lower, with accelerating aerodynamic rush ending immediately before impact. No explosion, aircraft engine, voice, music, or battlefield ambience. |
| `impact-dirt-01.wav` | Dirt projectile impact | Generate exactly one isolated high-velocity projectile striking dry soil, 0.8 seconds: sharp ground hit, dense dirt burst, stones scattering, and a short dusty decay. No gunshot, explosion, ricochet, voices, music, or ambience. |
| `impact-armor-ricochet-01.wav` | Armor ricochet | Generate exactly one isolated projectile ricocheting from heavy vehicle armor, 0.7 seconds: hard metallic strike, bright deflection snap, short steel ring, and fast departing whine. No muzzle shot, explosion, voice, music, or background combat. |
| `impact-concrete-01.wav` | Concrete impact | Generate exactly one isolated military projectile striking reinforced concrete, 0.9 seconds: sharp dense crack, chunks breaking, grit scattering, and short structural resonance. No weapon firing, large explosion, voice, music, or ambience. |
| `impact-water-01.wav` | Water impact | Generate exactly one isolated fast projectile hitting open water, 0.8 seconds: hard surface slap, narrow violent splash, falling droplets, and short water decay. No gunshot, explosion, voices, music, waves, or background ambience. |
| `burning-wreck-loop-01.wav` | Burning wreck | Generate exactly one seamless 7-second loop of a recently destroyed armored vehicle burning: controlled fire crackle, occasional small metal pops, subtle hot-steel creaks, and low flame roar. No explosions, voices, wind, music, sirens, or other vehicles. |
| `aircraft-damaged-loop-01.wav` | Damaged aircraft | Generate exactly one seamless 5-second loop of a badly damaged military aircraft still airborne: irregular failing turbine, strained mechanics, intermittent sputter, and subtle airframe vibration. No crash impact, alarm, voice, weapons, music, or other aircraft. |
| `aircraft-crash-descent-01.wav` | Aircraft crash descent | Generate exactly one isolated 4-second military aircraft uncontrolled crash descent: failing engine winds down, airframe tears and rattles, fast turbulent air increases, ending just before ground impact. No final explosion, voice, music, or other aircraft. |
| `incoming-missile-warning-01.wav` | Missile warning | Generate exactly one clear 2-second futuristic base-defense warning for an incoming strategic missile: urgent low alarm pulse followed by three precise electronic warning beats. Designed to cut through combat without being piercing. No speech, music, explosion, or ambience. |
| `incoming-drone-warning-01.wav` | Drone warning | Generate exactly one clear 2-second tactical warning for an incoming attack-drone swarm: fast repeating electronic scan pulse with a distinct rising alert signature. Urgent but less severe than a strategic missile alarm. No voice, music, weapons, or ambience. |
| `turret-rotation-loop-01.wav` | Turret tracking | Generate exactly one seamless 4-second loop of a heavy automated defense turret rotating slowly: electric servo motor, geared mechanical movement, subtle bearing rumble, and controlled metal tension. No weapon fire, target beep, voice, music, or background battle. |
| `target-lock-01.wav` | Target lock | Generate exactly one short military targeting-lock confirmation, 0.45 seconds: rapid scanning chirps converge into one firm precise lock tone. Futuristic but restrained, no voice, alarm, weapon fire, music, ambience, or reverb. |
| `ore-collector-engine-loop-01.wav` | Ore collector movement | Generate exactly one seamless 6-second loop of a large industrial armored resource collector driving slowly: deep utility diesel engine, heavy drivetrain, broad tires or tracks, and loaded suspension. No mining, deposit machinery, weapons, voices, or music. |
| `ore-mining-loop-01.wav` | Ore extraction | Generate exactly one seamless 6-second loop of a futuristic industrial ore collector actively extracting mineral crystals: powered grinding, hydraulic cutting, crystalline fragments, conveyor vibration, and heavy machinery. No vehicle travel, deposit sound, voice, music, or combat. |
| `ore-deposit-01.wav` | Refinery deposit | Generate exactly one isolated 3-second futuristic refinery cargo deposit: heavy hopper opens, mineral ore pours into a metal processor, machinery engages, and a solid gate closes. No vehicle engine, voice, music, weapons, or background ambience. |
| `factory-ambience-loop-01.wav` | Factory ambience | Generate exactly one seamless 8-second quiet futuristic military vehicle-factory interior loop: distant hydraulic presses, restrained conveyor movement, ventilation hum, and occasional soft metal work. Low intensity, no voices, alarms, music, weapons, or prominent single event. |
| `refinery-ambience-loop-01.wav` | Refinery ambience | Generate exactly one seamless 8-second quiet ore-refinery machinery loop: low industrial processing hum, rotating crusher, conveyor vibration, and subtle mineral movement. Low intensity, no vehicles, deposit event, voices, alarms, music, or combat. |
| `power-plant-ambience-loop-01.wav` | Power-plant ambience | Generate exactly one seamless 8-second futuristic military power-plant loop: deep electrical generator hum, slow turbine rotation, restrained transformer buzz, and occasional soft energy pulse. Stable and quiet, no alarms, voices, music, weapons, or explosions. |
| `unit-production-complete-01.wav` | Unit ready | Generate exactly one concise 0.7-second futuristic military production-complete cue: powered mechanism finishes, a solid latch locks, and a confident clean electronic readiness tone follows. No voice, music, ambience, alarm, or vehicle engine. |
| `strategic-missile-ready-01.wav` | Missile cooldown complete | Generate exactly one restrained 0.8-second strategic missile readiness cue: deep system-power pulse, two precise guidance electronics, and a firm low confirmation tone. Serious and valuable, no voice, alarm, music, launch, or ambience. |
| `ember-drones-ready-01.wav` | Drone salvo ready | Generate exactly one restrained 0.7-second attack-drone salvo readiness cue: several quick synchronized electronic checks converge into one clean tactical confirmation. No voice, alarm, drone engine, music, weapon fire, or ambience. |
| `victory-stinger-01.wav` | Victory | Generate exactly one original 4-second military strategy-game victory stinger: confident low brass-like synthetic swell, powerful tactical percussion hit, and a clean resolved ending. No recognizable melody, copyrighted style imitation, voices, ambience, or long fade. |
| `defeat-stinger-01.wav` | Defeat | Generate exactly one original 4-second military strategy-game defeat stinger: restrained low synthetic brass fall, distant heavy impact, and unresolved dark ending. Somber rather than melodramatic, no recognizable melody, copyrighted style imitation, voice, or ambience. |
| `desert-wind-loop-01.wav` | Desert ambience | Generate exactly one seamless 10-second sparse desert battlefield ambience loop: broad dry wind, occasional fine sand movement, and very distant natural air texture. Quiet and non-distracting, no animals, voices, music, vehicles, or combat. |
| `rain-loop-01.wav` | Rain ambience | Generate exactly one seamless 10-second battlefield rain loop: steady moderate rain striking soil, metal, and distant water with subtle wind. Even intensity, no thunder, voices, music, vehicles, weapons, or dramatic weather events. |
| `snow-wind-loop-01.wav` | Snow ambience | Generate exactly one seamless 10-second frozen battlefield ambience loop: soft cold wind across snow, faint icy granules, and restrained open-space air movement. Quiet, no blizzard gust, animals, voices, music, vehicles, or combat. |
| `shoreline-water-loop-01.wav` | Water ambience | Generate exactly one seamless 10-second calm battlefield shoreline loop: small freshwater waves touching an uneven shore, gentle water movement, and subtle wet stones. Quiet, no ocean surf, birds, voices, music, wind storm, boats, or combat. |

## Vehicle and aircraft speed-state experiment

The intended runtime mix has three states rather than replacing one clip with another abruptly:

1. **Idle/hover:** a quiet base engine remains audible nearby.
2. **Normal movement:** the base engine changes pitch and gains a movement/air or track layer.
3. **Shift boost:** the normal mix remains, while a dedicated high-speed strain/boost layer fades in proportionally.

Generate each candidate separately so it can be auditioned and mixed independently.

| Suggested filename | Candidate layer | Ready-to-paste ElevenLabs prompt |
| --- | --- | --- |
| `tank-engine-idle-loop-01.wav` | M-17/Mauler idle | Generate exactly one seamless 6-second loop of a massive fictional tracked military vehicle idling while stationary: deep diesel engine pulse, heavy mechanical vibration, cooling fan, and subtle hull resonance. Absolutely no moving tracks, acceleration, weapons, voices, music, wind, or other vehicles. |
| `tank-engine-boost-layer-loop-01.wav` | M-17/Mauler Shift boost | Generate exactly one seamless 5-second additive high-speed layer for a heavy tracked military vehicle accelerating under maximum load: strained diesel revs, faster track rhythm, suspension vibration, and forceful drivetrain whine. Designed to layer over an existing engine loop; no idle start, weapons, voices, music, or other vehicles. |
| `jackal-engine-idle-loop-01.wav` | Jackal idle | Generate exactly one seamless 5-second loop of a lightweight fictional armored scout vehicle idling while stationary: compact high-performance diesel turbine, subtle fan whine, restrained chassis vibration. No tire movement, acceleration, weapons, voices, music, wind, or other vehicles. |
| `jackal-engine-cruise-loop-01.wav` | Jackal normal movement | Generate exactly one seamless 6-second loop of a fast wheeled armored scout vehicle cruising over compact dirt: responsive engine, steady tire rumble, light suspension chatter, and aerodynamic movement. Constant normal speed, no acceleration burst, weapons, voices, music, or other vehicles. |
| `jackal-engine-boost-layer-loop-01.wav` | Jackal Shift boost | Generate exactly one seamless 5-second additive boost layer for a fast wheeled armored scout vehicle at maximum speed: rising turbine strain, rapid tire texture, drivetrain whine, and stronger aerodynamic rush. Designed to layer over its cruise loop; no gear-change sequence, weapons, voices, music, or other vehicles. |
| `wasp-engine-hover-loop-01.wav` | Wasp hover/idle | Generate exactly one seamless 6-second loop of a small futuristic military interceptor hovering nearly stationary: compact high-frequency turbine, agile ducted-fan or rotor texture, controlled mechanical pulse. No forward air rush, acceleration, weapons, alarms, voices, music, or other aircraft. |
| `wasp-engine-cruise-loop-01.wav` | Wasp normal flight | Generate exactly one seamless 6-second loop of a small futuristic military interceptor in steady forward flight: energetic turbine whine, fast ducted-fan texture, smooth aerodynamic air rush. Constant normal speed, no boost surge, weapons, alarms, voices, music, or other aircraft. |
| `wasp-engine-boost-layer-loop-01.wav` | Wasp Shift boost | Generate exactly one seamless 5-second additive high-speed boost layer for a small futuristic interceptor: intense turbine spool, sharper aerodynamic rush, and controlled high-energy whine. Designed to layer over a cruise engine loop; no explosion, weapons, alarm, voice, music, or other aircraft. |
| `vulture-engine-hover-loop-01.wav` | Vulture hover/idle | Generate exactly one seamless 6-second loop of a medium armored attack gunship hovering stationary: muscular twin turbines, heavy rotor or lift-fan pulse, low mechanical vibration, and stable downwash. No forward flight, weapons, voices, alarms, music, or other aircraft. |
| `vulture-engine-cruise-loop-01.wav` | Vulture normal flight | Generate exactly one seamless 6-second loop of a medium armored attack gunship cruising forward: heavy twin turbines, rhythmic rotor or lift-fan texture, armored airframe vibration, and moderate aerodynamic rush. Constant speed, no boost, weapons, voices, music, or other aircraft. |
| `vulture-engine-boost-layer-loop-01.wav` | Vulture Shift boost | Generate exactly one seamless 5-second additive high-speed layer for a medium armored attack gunship under maximum power: strained twin turbines, faster lift rhythm, stronger airframe vibration, and forceful air rush. Designed to layer over its cruise loop; no weapons, alarms, voices, music, or other aircraft. |
| `hammerhead-engine-idle-loop-01.wav` | Hammerhead hover/idle alternative | Generate exactly one seamless 7-second loop of a massive futuristic heavy military aircraft hovering stationary: deep multi-engine turbine drone, slow powerful lift pulse, broad armored-airframe resonance, and restrained downwash. No forward movement, weapons, alarms, voices, music, or other aircraft. |
| `hammerhead-engine-boost-layer-loop-01.wav` | Hammerhead Shift boost | Generate exactly one seamless 6-second additive maximum-power layer for a massive heavy military aircraft accelerating: multiple turbines under load, deep propulsion surge, stressed airframe resonance, and broad high-speed air movement. Designed to layer over an existing heavy engine loop; no weapons, alarms, voices, music, or other aircraft. |

## Intentionally disabled

Combat mixing now applies a shared 70% gain ceiling to weapon fire, missile launches and flybys, impacts, explosions, and destruction sounds. Engine, movement, unit voice, and interface levels are unchanged, so close combat no longer overwhelms the contextual vehicle and aircraft mix.

Every enabled button across the home page, battle setup, HUD, production, upgrade, commands, top-level controls, and pause menu uses the selected `ui-button-hover-active-02.wav` and `ui-button-click-active-02.wav` pair. The longer hover is restrained at 6% and playback-limited to avoid overlapping tails. The very short, quiet click is compensated to 50% and listens during event capture so controls that stop pointer propagation still produce feedback. Earlier candidates remain inactive.

| Audio | Status |
| --- | --- |
| Music | Disabled while the soundtrack direction is reconsidered. |
| Intro and enemy-contact characters | Disabled because the current narration was disruptive; assets remain available for a future redesign. |
