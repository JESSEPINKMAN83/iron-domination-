export type GuideFaction = 'israel' | 'iran' | 'ukraine' | 'usa';
export const GUIDE_FACTION_IDS: GuideFaction[] = ['israel', 'iran', 'ukraine', 'usa'];
type Lesson = {
  name: string; subtitle: string; intro: string; goal: string;
  controls: Array<[string, string]>;
  steps: Array<[string, string]>; do: string; avoid: string;
};

export const GUIDE_FACTIONS = {
  usa: {name:'USA',specialty:'HEAVY COMBINED ARMS & STRIKE AVIATION',instructor:'American male field instructor in Multicam uniform'},
  israel: { name: 'Israel', specialty: 'AIR POWER & LAYERED DEFENSE', instructor: 'Israeli female field instructor in olive uniform' },
  iran: { name: 'Iran', specialty: 'STRATEGIC PRESSURE & GROUND ASSAULTS', instructor: 'Iranian male field instructor in camouflage uniform' },
  ukraine: { name: 'Ukraine', specialty: 'RECONNAISSANCE & MOBILE PRECISION', instructor: 'Young adult Ukrainian male field instructor in pixel camouflage' },
} as const;

export const FACTION_LESSONS: Record<GuideFaction, Lesson[]> = {
  usa: [
    {name:'Build',subtitle:'Fund the heavy force before committing it.',intro:'The USA adds specialist armor, rocket artillery, fast jets and a heavy conventional bomber. Its strongest purchases take time and money to replace.',goal:'A protected income stream and functioning armor and air production.',controls:[['Specialists','Heavy Armor Plant / Expeditionary Air Base'],['Defense','Patriot + C-RAM']],steps:[
      ['Open conventional production','Build Power Plant, Refinery and Heavy Armor Plant, then the Expeditionary Air Base. Keep collectors supplied with open routes.'],
      ['Buy the role you need','Stryker scouts, Abrams holds the armored line, and Bradley adds tracked 25mm and guided-missile support. M270 delivers a three-rocket area salvo.'],
      ['Save for the strike wing','F-15E combines ground strikes with an air seeker. B-2 carries a heavy conventional bomb pair, but costs $3,200 and takes 40 seconds to build.'],
      ['Protect your investment','Use Patriot and C-RAM coverage, tower upgrades and building repairs. The USA has no Arrow 3 or Iranian strategic missile program.'],
    ],do:'Capture income sites with ground troops before filling the queue with expensive aircraft.',avoid:'Spending every credit on a bomber and leaving its base undefended.'},
    {name:'Deploy',subtitle:'A bomber needs an escort and a ground plan.',intro:'Use the broader roster as combined arms. Large payloads are useful only if the aircraft reaches the target and the ground force can exploit the damage.',goal:'An escorted strike route with armor ready to follow.',controls:[['Quick path','Pointer → draw → release'],['Formations','Hover selected item count']],steps:[
      ['Reconnoiter first','Use Strykers or a small air group to find enemy air defenses. Preserve expensive aircraft until you know the approach.'],
      ['Split support and assault','Bradley supports the infantry and Abrams. Keep the M270 behind the front: its minimum range is 60 and its reload is slow.'],
      ['Route the strike wing','Quick paths execute on release. Define Tactic lets you customize routes and choose priorities such as Defenses, Production or Economy.'],
      ['Leave room for the B-2','The flying wing is larger than a gunship and turns more slowly. Space the group and choose a broad approach instead of tight repeated reversals.'],
    ],do:'Use air-to-air escorts and ground pressure to make the heavy strike safer.',avoid:'Treating the B-2 as a fast dogfighter or assuming it is immune to air defense.'},
    {name:'Fight',subtitle:'Different weapons. One coordinated attack.',intro:'F-15Es can screen hostile aircraft while the bomber attacks ground targets. Rocket artillery and armor keep pressure on the positions the air strike exposes.',goal:'Deliver the payload without sacrificing the support force.',controls:[['Direct control','V · wheel · Q / E'],['Aircraft altitude','Space / C']],steps:[
      ['Use the correct aircraft weapon','F-15E primary is a ground-only precision munition; secondary is an air-to-air seeker. B-2 has heavy conventional bombs and no air-to-air weapon.'],
      ['Wait for the right bomb run','The B-2 drops two heavy bombs and reloads for 12 seconds. Its V-mode range remains limited; it cannot strike across the whole map from home.'],
      ['Coordinate rocket fire','M270 fires three staggered rockets with area damage. Its nine-second reload and vulnerable hull give enemies time to close in.'],
      ['Keep movement purposeful','Attack as you move preserves the route while valid targets are in range. Use ground flanks against armor; use Q/E and the wheel to control the V-mode view.'],
    ],do:'Read the weapon labels and reload states rather than firing both buttons at every target.',avoid:'Leaving expensive specialists alone against close assault troops or concentrated aircraft.'},
    {name:'Adapt',subtitle:'Preserve specialists. Replace the missing role.',intro:'A broader roster gives options, not a guaranteed win. Counter what the enemy is building and keep the economy able to fund another attack.',goal:'Recover enough force and income for a better second attack.',controls:[['Loss history','Click Losses'],['Unit upgrades','Selected thumbnail']],steps:[
      ['Answer the counter','If aircraft intercept the bombers, add escorts. If close attacks reach the M270, add a frontline rather than another launcher.'],
      ['Recover and upgrade','Repair buildings from the hover wrench. Inspect a unit thumbnail for its available upgrades, tactical map and kill record.'],
      ['Hold useful ground','Radar, supply and oil each pay $100 per second while owned. Supply repairs parked ground combat units; only armed ground troops can capture sites.'],
      ['Review the real cost','Use losses and the post-match income/damage timelines to judge expensive purchases. Protect your HQ and eliminate all hostile HQs in skirmish.'],
    ],do:'Keep a replacement reserve and change the route or unit mix when an attack fails.',avoid:'Buying only the largest units because their damage looks impressive.'},
  ],
  israel: [
    { name: 'Build', subtitle: 'Protect the economy that keeps you flying.',
      intro: 'Israel combines aircraft with layered interception. Build income and production first, then protect the facilities that would hurt most to lose.',
      goal: 'A working Refinery, an Air Base, and enough power to keep both running.',
      controls: [['Repair', 'Hover building → wrench'], ['Tower upgrades', '$100 / $250 / $500']],
      steps: [
        ['Power → income → air production', 'Start with a Power Plant and Refinery. Add Armor Works, then an Air Base. Keep routes clear for collectors and departing units.'],
        ['Layer the defense', 'Iron Dome sends interceptors toward incoming missiles early. Add Arrow 3 and Phalanx coverage around valuable facilities; interception is not a guarantee.'],
        ['Upgrade instead of rebuilding', 'Select a defense and buy its three upgrade tiers for $100, $250 and $500. Upgrades increase durability and firepower; capabilities depend on the tower.'],
        ['Earn beyond the base', 'Armed ground troops can capture radar, supply and oil sites. Each owned site pays $100 per second. Repair damaged buildings with the hover wrench for $10 per second.'],
      ], do: 'Keep producing a fighting force while strengthening income and defenses.',
      avoid: 'Spending every credit on a shield that cannot capture territory or finish an enemy HQ.' },
    { name: 'Deploy', subtitle: 'Give the air wing a route and a purpose.',
      intro: 'Cobra interceptors, Apache rocket gunships and Yasur strike gunships fill different roles. Combine them with ground troops rather than flying one expensive blob into every threat.',
      goal: 'A mixed force with a safe route, a target priority and space between aircraft.',
      controls: [['Quick path', 'Pointer button → draw → release'], ['Altitude', 'Select aircraft · Space / C']],
      steps: [
        ['Match the aircraft to the job', 'Cobra provides air interception; Apache brings rocket pressure; Yasur carries guided strikes and a heavier bomb payload. Hover card ratings for weapon details.'],
        ['Draw straight on the battlefield', 'Use the pointer beside Define Tactic, draw, then release to execute immediately. Quick routes use Fast, 50% variation and Attack as you move.'],
        ['Use the planner for precision', 'Define Tactic opens the larger map. Draw a route or place up to 64 points, change variation and choose optional target priorities such as Economy or Anti-air threats.'],
        ['Keep the group readable', 'Hover the selected item count for Tight, Spread or Wedge. Space and C raise or lower selected aircraft; ground clearance prevents terrain crashes.'],
      ], do: 'Send ground troops to hold space while the air wing approaches from another direction.',
      avoid: 'Expecting a priority target to make aircraft leave their route and chase it across the map.' },
    { name: 'Fight', subtitle: 'Strike on the move. Take control when it matters.',
      intro: 'Attack as you move preserves the route while units fire at valid targets in range. Direct control gives you a closer view without requiring you to abandon the whole battle.',
      goal: 'Damage the enemy while your force still reaches its destination.',
      controls: [['Direct control', 'V · wheel to change view'], ['Aircraft', 'Q / E turn · Space / C altitude'], ['Infantry', 'Space jump · C crouch']],
      steps: [
        ['Keep ordinary moves aggressive', 'Turn on Aggressive in the selected-force panel to fire while moving toward a normal movement order. It keeps the destination rather than stopping to chase.'],
        ['Inspect before taking over', 'Press V on a unit following a tactic to watch it continue. Movement or fire input takes manual control. Q/E rotate; scroll fully in for a clear onboard aiming view.'],
        ['Build a guided volley', 'Hold a valid lock with a compatible guided weapon. Every extra three seconds adds a missile, up to five, or ten after upgrading. Use the matching fire button.'],
        ['Bring artillery and flank armor', 'Deploy an ATMOS Field Gun with F: 10 seconds to deploy, 5 to pack. It must remain stationary to fire its long-range weapon. Ground armor is more vulnerable at the sides and rear.'],
      ], do: 'Use V for a useful shot, then return to command view and check production and threats.',
      avoid: 'Flying into concentrated anti-air because a charged volley looks powerful.' },
    { name: 'Adapt', subtitle: 'Replace the weakness, not the whole army.',
      intro: 'Use loss reports, scouting and income to decide the next purchase. Strong air power still needs protected collectors, captured ground and a route around enemy counters.',
      goal: 'Turn battle feedback into a different next attack.',
      controls: [['Loss history', 'Click Losses'], ['Unit record', 'Selected unit thumbnail']],
      steps: [
        ['Respond to the actual threat', 'Code Red warns about attacks on your army. Read the incoming direction and minimap marker. Dismiss commander cards with × when they obstruct the view.'],
        ['Change an unsuccessful route', 'If aircraft are falling to anti-air, scout another approach or use ground troops to remove it. High ground helps sight; it does not make a unit invulnerable.'],
        ['Recover around useful ground', 'Capture a supply depot to repair parked ground combat units nearby. Keep armed ground troops beside objective structures, inside the capture ring; aircraft cannot capture them.'],
        ['Review, then finish', 'Loss history shows what died. A unit thumbnail opens its tactics, upgrades and kill record. After the match, compare income, losses and damage over time. Destroy every hostile HQ to win a skirmish.'],
      ], do: 'Spend on a visible problem: lost air cover, exposed income or a missing ground force.',
      avoid: 'Treating the estimated win-chance graph as a promise, or repeating a failed air route unchanged.' },
  ],
  iran: [
    { name: 'Build', subtitle: 'A reliable economy behind every launch.',
      intro: 'Iran fields Fattah missiles and Shahed swarms instead of aircraft production. Build a ground army alongside the strategic program so you can protect income and exploit each strike.',
      goal: 'Fund Missile City without leaving the economy and HQ exposed.',
      controls: [['Missile program', 'Aerospace HQ → Missile City'], ['Repairs', 'Hover building → wrench']],
      steps: [
        ['Start with power and collectors', 'Build a Power Plant and Refinery. Keep collector routes open and expand toward usable ore rather than trapping production inside a dense base.'],
        ['Unlock strategic pressure', 'Build the IRGC Aerospace HQ, then Missile City. Strategic launches and upgrades use credits, so keep money available for replacement troops.'],
        ['Build the army that follows up', 'IRGC Barracks and Armor Works provide infantry, Karrar tanks and artillery. Iran has no Air Base or aircraft production.'],
        ['Take income onto the battlefield', 'Armed ground troops capture radar, supply and oil sites by holding the ring uncontested for 8 seconds. Each owned site pays $100 per second; all three pay $300.'],
      ], do: 'Protect the collectors and build enough ground force to contest a resource site.',
      avoid: 'Saving only for strategic weapons while enemy aircraft or raiders dismantle your base.' },
    { name: 'Deploy', subtitle: 'Make the next strike part of a ground plan.',
      intro: 'Missiles threaten a location. Ground troops occupy it. Scout the target, prepare a route, and decide what the army should achieve once the first explosion is over.',
      goal: 'A scouted strike location with a ground force ready to exploit it.',
      controls: [['Quick path', 'Pointer → draw → release'], ['Target priorities', 'Define Tactic']],
      steps: [
        ['Scout before spending', 'Locate production, collectors and missile defenses. A strike marker targets a location; mobile enemies may leave it before impact.'],
        ['Pick the right ground mix', 'Use Karrar armor with infantry and Toophan teams. Fajr and Raad artillery support the push; keep air-capable defenders near important troops and facilities.'],
        ['Route around the strongest defense', 'Quick tactics execute on release with Fast, 50% variation and Attack as you move. Open Define Tactic to customize the route and focus on Economy, Defenses or Production.'],
        ['Space the advance', 'Hover the selected item count for Tight, Spread or Wedge. Spread can separate targets; a formation does not replace a clear route around buildings.'],
      ], do: 'Move the ground force into position before committing the strategic attack.',
      avoid: 'Sending isolated tanks one at a time and expecting missiles to defend them.' },
    { name: 'Fight', subtitle: 'Watch the result. Exploit the opening.',
      intro: 'Strategic missiles and drone swarms create pressure, but interception and moving targets can change the outcome. Keep controlling the ground battle while weapons are in flight.',
      goal: 'Turn long-range damage into lost enemy production or captured territory.',
      controls: [['Ground control', 'Select unit · V'], ['Field artillery', 'F deploy / pack'], ['Infantry', 'Space jump · C crouch']],
      steps: [
        ['Choose a current target', 'Select the strategic action and mark a worthwhile location. Recheck scouting before repeating a launch at the same marker.'],
        ['Respect interception', 'Missile defenses can destroy incoming threats. Watch hits and interceptions rather than assuming the full launch reached the enemy.'],
        ['Keep attacking along the route', 'Attack as you move fires at available targets without abandoning the path. Optional priorities change target preference in range; Aggressive does the same for ordinary movement orders.'],
        ['Use direct fire and siege support', 'V enters a unit; Q/E rotate and the wheel changes the view. Raad Field Guns need 10 seconds to deploy and stay stationary to fire; packing takes 5 seconds. Aim for armored flanks where possible.'],
      ], do: 'Follow a successful strike with a ground order that removes the damaged target or secures the area.',
      avoid: 'Watching a missile animation while enemy ground troops overrun your collectors.' },
    { name: 'Adapt', subtitle: 'Change the pressure before it becomes predictable.',
      intro: 'The enemy may add interception, raid ore or mass aircraft. Choose upgrades and reinforcements for the problem you can see, not for the last successful launch.',
      goal: 'Sustain pressure while preserving a working economy and an answer to aircraft.',
      controls: [['Tower tiers', '$100 / $250 / $500'], ['Losses', 'Click the loss counter']],
      steps: [
        ['Upgrade the strategic program', 'Use the available guidance, warhead and Shahed upgrade controls. Keep credits for ordinary production instead of spending the entire reserve on upgrades.'],
        ['Answer enemy aircraft', 'Use Khordad-15 defenses and air-capable ground weapons. Upgrade selected defenses through three tiers to improve durability and firepower.'],
        ['Keep resource sites useful', 'Click an objective for its owner, capture progress and benefits. Radar reveals nearby enemies; supply also repairs parked ground combat units. Contesting enemies must be cleared before capture can progress.'],
        ['Learn from actual losses', 'Open Losses during the match, inspect unit kill records from their thumbnails, and compare income and damage timelines afterward. Protect your HQ and eliminate every hostile HQ in skirmish.'],
      ], do: 'Combine a changed strike target with a different ground approach when interception becomes too strong.',
      avoid: 'Launching at an empty marker while neglecting aircraft, repairs and replacement troops.' },
  ],
  ukraine: [
    { name: 'Build', subtitle: 'Build the network before the strike.',
      intro: 'Ukraine rewards reconnaissance and mobile precision. Its UAVs see widely and fill specialized roles, but fragile aircraft and lighter armor punish an expensive frontal trade.',
      goal: 'A funded UAV hub plus a ground force that can protect it and capture income.',
      controls: [['Aviation', 'Armor Workshop → UAV hub'], ['Capture income', '$100 / second per site']],
      steps: [
        ['Start with a working economy', 'Build a Power Plant and Refinery, then an Armor Workshop. Add the UAV & Aviation Hub and keep enough power for production.'],
        ['Build around specialized UAVs', 'The FPV Strike Drone physically dives into one ground target and is consumed on impact; it cannot fire rockets or attack aircraft. Bayraktar TB2 brings guided ground strikes and a single-bomb payload. Mi-24 provides conventional rocket support.'],
        ['Keep ground support mobile', 'Mechanized infantry, BTR-4s and Leopard tanks hold space that aircraft cannot. Ukraine’s armored vehicles trade some durability for movement speed.'],
        ['Claim the sites that fund the fleet', 'Hold armed ground troops beside radar, supply or oil sites inside the 25m ring for 8 uncontested seconds. Each owned site pays $100 per second. Ukraine has no strategic missile or Arrow 3 program.'],
      ], do: 'Build ground troops as well as UAVs; they secure the income your aircraft depend on.',
      avoid: 'Expecting expendable FPVs or TB2s to provide air-to-air defense.' },
    { name: 'Deploy', subtitle: 'See first. Choose the opening.',
      intro: 'Use wide UAV vision to find exposed targets, then send the right weapon. Reconnaissance gives you options; it does not make fragile drones safe inside anti-air coverage.',
      goal: 'Locate a vulnerable target and route a strike around its counters.',
      controls: [['Quick path', 'Draw → release to execute'], ['Formation', 'Hover selected item count']],
      steps: [
        ['Scout before committing the FPV', 'Use its vision to choose a ground target. An attack commits the drone to a one-way dive; enemy air defenses can shoot it down before contact.'],
        ['Give the TB2 a ground target', 'Look for exposed armor, collectors or production. The TB2 has a ground-only precision munition and a smaller bomb payload than Israel’s heavy gunship.'],
        ['Plan a focused route', 'Quick paths execute immediately on release. Define Tactic adds a larger map, optional priorities and route controls. Select Economy or Armored vehicles when that is the job.'],
        ['Separate the wing', 'Choose Tight, Spread or Wedge from the item-count menu. Formation variation staggers departures and offsets the route. Space/C raise or lower selected aircraft in strategy view.'],
      ], do: 'Use the first sighting to choose an approach instead of committing the entire air group.',
      avoid: 'Mistaking wider vision for more armor or immunity to interception.' },
    { name: 'Fight', subtitle: 'Precision needs a moving ground plan.',
      intro: 'Use routes to approach, then commit FPVs to a one-way strike. TB2s can keep firing along their route. Support the strike with ground troops and artillery that can reposition before the enemy answers.',
      goal: 'Make each specialized unit fight the target it is equipped to handle.',
      controls: [['V mode', 'V · wheel · Q / E'], ['Artillery', 'F · deploy 10s / pack 5s'], ['Infantry', 'Space jump · C crouch']],
      steps: [
        ['Keep the assigned route', 'Attack as you move completes the path while firing. Target priorities favor matching enemies in range; they do not send the wing chasing away from the route.'],
        ['Use the correct UAV weapon', 'FPV drones are consumed in a ground-impact attack. TB2 guided munitions engage ground targets; its bomb is a separate weapon. Watch the V-mode LMB/RMB labels before firing.'],
        ['Control the view and altitude', 'V lets you inspect a tactic until you give manual input. Q/E turn, the wheel moves between onboard and chase views, and Space/C change aircraft altitude with terrain clearance.'],
        ['Bring mobile artillery', 'Bohdana moves faster while mobile, but must deploy for 10 seconds and remain stationary to use its heavy weapon. Pack for 5 seconds before relocating. Hit armored sides and rear when you can.'],
      ], do: 'Use short, supported attacks and reposition surviving units before repeating the strike.',
      avoid: 'Leaving a deployed gun exposed or trading fragile UAVs head-on against layered defenses.' },
    { name: 'Adapt', subtitle: 'Keep the information advantage alive.',
      intro: 'Ukraine’s advantage comes from choosing where to fight. Replace scouting losses, protect production and use the ground army to make your next air route safer.',
      goal: 'Preserve useful units and turn captured ground into sustained pressure.',
      controls: [['Unit upgrades & record', 'Click its selected thumbnail'], ['Repair building', 'Hover → wrench']],
      steps: [
        ['Replace the missing role', 'Need air defense? Build counter-UAS coverage. Exposed ground target? Choose an expendable FPV or a reusable TB2. Need rocket support? Use Mi-24s. Read the card tooltips rather than buying only the most expensive unit.'],
        ['Recover around captured ground', 'A supply depot pays income and repairs parked ground combat units nearby. Radar adds vision. Keep a ground response available when opponents contest the ring.'],
        ['Strengthen what must survive', 'Use tower upgrades and building repairs to protect the UAV hub and economy. Upgrade active units from their selected thumbnail; keep money for replacements.'],
        ['Judge the whole match', 'Loss history and unit kill records show what happened. Debrief timelines compare income, damage and losses for every army. In skirmish, keep your HQ standing and destroy every hostile HQ.'],
      ], do: 'Change target, route or unit mix when the opponent builds a counter.',
      avoid: 'Repeating the same drone attack just because the first one succeeded.' },
  ],
};

export function guideFlag(faction: GuideFaction): string {
  if (faction === 'usa') return '<svg viewBox="0 0 60 40" aria-hidden="true"><path fill="#fff" d="M0 0h60v40H0z"/><path stroke="#b33b42" stroke-width="3" d="M0 2h60M0 8h60M0 14h60M0 20h60M0 26h60M0 32h60M0 38h60"/><path fill="#29446d" d="M0 0h25v22H0z"/><path fill="#fff" d="M5 5h2v2H5zM12 5h2v2h-2zM19 5h2v2h-2zM5 12h2v2H5zM12 12h2v2h-2zM19 12h2v2h-2z"/></svg>';
  if (faction === 'ukraine') return '<svg viewBox="0 0 60 40" aria-hidden="true"><path fill="#0057b7" d="M0 0h60v20H0z"/><path fill="#ffd700" d="M0 20h60v20H0z"/></svg>';
  return faction === 'israel'
    ? '<svg viewBox="0 0 60 40" aria-hidden="true"><path fill="#fff" d="M0 0h60v40H0z"/><path fill="#1858b0" d="M0 6h60v5H0zm0 23h60v5H0z"/><path d="m30 13 7 11H23zm0 14-7-11h14z" fill="none" stroke="#1858b0" stroke-width="1.6"/></svg>'
    : '<svg viewBox="0 0 60 40" aria-hidden="true"><path fill="#fff" d="M0 0h60v40H0z"/><path fill="#249f58" d="M0 0h60v13H0z"/><path fill="#da2737" d="M0 27h60v13H0z"/><text x="30" y="25" text-anchor="middle" fill="#da2737" font-size="18" font-family="serif">☫</text></svg>';
}
