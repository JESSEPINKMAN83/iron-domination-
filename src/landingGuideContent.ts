export type GuideFaction = 'israel' | 'iran';
type Lesson = {
  name: string; subtitle: string; intro: string;
  steps: Array<[string, string]>; do: string; avoid: string;
};

export const GUIDE_FACTIONS = {
  israel: { name: 'Israel', specialty: 'AIR POWER & LAYERED DEFENSE' },
  iran: { name: 'Iran', specialty: 'MISSILES & DRONE SWARMS' },
} as const;

export const FACTION_LESSONS: Record<GuideFaction, Lesson[]> = {
  israel: [
    { name: 'Build', subtitle: 'Build the base. Own the sky.',
      intro: 'Israel combines aircraft with layered missile defense. A steady economy lets you field gunships while protecting the buildings that keep them flying.',
      steps: [
        ['Start with power and income', 'Build a Power Plant, then a Refinery. Protect your collectors and leave clear routes back to base.'],
        ['Unlock your Air Base', 'Develop your ground production through the Armor Works, then add an Air Base. Keep power ahead of demand as you expand.'],
        ['Build a layered shield', 'Iron Dome launches early interceptors. Arrow 3 adds missile defense, while Phalanx protects the close approaches. Cover valuable facilities.'],
        ['Keep the base working', 'Leave space between buildings for movement. Repair damaged facilities before losing production; repairs cost 10 credits per second.'],
      ], do: 'Fund your aircraft and ground army alongside your defenses. Keep a reserve for repairs.',
      avoid: 'Buying only interceptors. Defenses protect your base, but you still need a force that can win the game.' },
    { name: 'Deploy', subtitle: 'Air power needs a ground plan.',
      intro: 'Cobra, Apache and Yasur aircraft give Israel mobile pressure. Use them to support a mixed ground force rather than sending every unit down one approach.',
      steps: [
        ['Scout the approach', 'Reveal enemy positions before committing expensive aircraft. Look for anti-air defenses and exposed production.'],
        ['Give each group a job', 'Use ground units to hold space and aircraft to support them. Keep a reserve near your collectors and Command HQ.'],
        ['Choose a formation', 'Select multiple units and open the item-count menu. Tight, Spread and Wedge give the group different shapes and spacing.'],
        ['Plot the whole flight', 'Open Define Tactic to place waypoints or draw a route. Formation variation staggers departures and adds movement variety.'],
      ], do: 'Give aircraft a route and a useful destination before committing your frontline.',
      avoid: 'Flying the whole squad into anti-air coverage or leaving your base completely undefended.' },
    { name: 'Fight', subtitle: 'Keep moving. Keep the pressure on.',
      intro: 'Manage the battle from above, then take direct control when it helps. Israel’s strength is mobile firepower backed by a defended economy.',
      steps: [
        ['Fire without abandoning the route', 'Choose Attack as you move in Define Tactic. Units keep completing the route while firing at available targets.'],
        ['Use Aggressive for ordinary moves', 'Enable Aggressive on your selected force to attack available enemies while continuing toward your movement destination.'],
        ['Take the controls', 'Select a unit and press V on desktop, or CONTROL on touch devices. For compatible guided weapons, keep aim locked to load a larger missile volley.'],
        ['Watch the threat report', 'Incoming alerts name the missile or drone and its direction. Check the matching minimap marker, then return to managing the whole army.'],
      ], do: 'Switch views with a purpose, and keep production and home defense running while you fight.',
      avoid: 'Staying in one aircraft so long that an exposed collector or damaged Air Base goes unnoticed.' },
    { name: 'Adapt', subtitle: 'Defend the next attack, not the last.',
      intro: 'Your opponent can change routes, raid your income or concentrate missile pressure. Read the battle and spend on the weakness you can actually see.',
      steps: [
        ['Respond to the right threat', 'Missiles approaching? Check interception coverage. Ground raiders arriving? Bring a mobile response instead of relying on anti-air.'],
        ['Change the approach', 'If aircraft meet strong anti-air, find another route or support the attack with ground troops. Keep scouting as the enemy expands.'],
        ['Preserve expensive units', 'Choose upgrades for units you are using, replace losses, and keep enough credits to repair damaged production.'],
        ['Win the objective', 'Protect your Command HQ and destroy every hostile Command HQ. Israel has no strategic missile program; aircraft and ground forces must finish the job.'],
      ], do: 'After a fight, check your losses, income and the enemy’s defenses before choosing the next purchase.',
      avoid: 'Repeating the same air attack after the enemy has already built a counter.' },
  ],
  iran: [
    { name: 'Build', subtitle: 'An economy behind every launch.',
      intro: 'Iran trades aircraft production for Fattah missiles and Shahed drone swarms. Build a reliable economy before investing in the strategic program.',
      steps: [
        ['Establish power and income', 'Start with a Power Plant and Refinery. Keep collectors protected so your next launch does not leave you short of credits.'],
        ['Open the missile program', 'Build the IRGC Aerospace HQ, then Missile City. Check the production panel for each requirement and the available strategic actions.'],
        ['Keep a ground army', 'Use IRGC Barracks and Armor Works for infantry and vehicles. Strategic strikes support your army; they do not defend your base by themselves.'],
        ['Protect your investment', 'Spread valuable facilities, keep access routes clear, and repair damaged buildings. Iran does not build Air Bases or produce aircraft.'],
      ], do: 'Balance launches and upgrades with income, ground production and a home defense force.',
      avoid: 'Spending everything on Missile City while collectors and the Command HQ are left exposed.' },
    { name: 'Deploy', subtitle: 'Strike from range. Advance with purpose.',
      intro: 'Combine long-range pressure with ground forces. Give infantry, armor and strategic weapons distinct jobs instead of waiting for missiles to win alone.',
      steps: [
        ['Find a worthwhile location', 'Scout production and resource sites before choosing a strike marker. A marked location is not a guarantee that moving units will stay there.'],
        ['Prepare your ground force', 'Mix infantry and vehicles for the resistance you have seen. Keep support together and leave protection near your economy.'],
        ['Plan the follow-up', 'Send ground forces toward a useful position while your strategic weapons apply pressure. Do not leave units idle after a strike.'],
        ['Use formations and routes', 'Open the selected group’s item-count menu for Tight, Spread or Wedge. Draw a tactical path to move around defended approaches.'],
      ], do: 'Make every strike part of a plan that your ground army can continue.',
      avoid: 'Trying to build aircraft, or sending isolated ground units into a defended position one at a time.' },
    { name: 'Fight', subtitle: 'Turn a launch into an opportunity.',
      intro: 'Fattah missiles hit marked locations; Shahed swarms add another kind of pressure. Keep issuing ground orders while strategic weapons are in flight.',
      steps: [
        ['Aim at the current battlefield', 'Choose the strategic action, then mark the location you want to threaten. Recheck scouting before committing another strike.'],
        ['Account for interception', 'Enemy missile defenses can destroy incoming threats. Watch the result instead of assuming that every launch reached its destination.'],
        ['Keep your advance moving', 'Use Attack as you move for tactical routes, or Aggressive for ordinary movement orders. Units fire at available targets while continuing to the destination.'],
        ['Join the ground fight', 'Select infantry or a vehicle and press V on desktop, or CONTROL on touch devices. Return to command view to manage launches, production and reinforcements.'],
      ], do: 'Watch what a strike actually achieves, then give your ground army the next order.',
      avoid: 'Launching repeatedly at an empty marker or watching missiles while your own base is under attack.' },
    { name: 'Adapt', subtitle: 'Change the pressure. Keep the initiative.',
      intro: 'Missiles, drones and ground troops offer different options. Use the result of each engagement to decide what your next credits should buy.',
      steps: [
        ['Read the defense', 'If missiles are being intercepted, reassess the target and approach. Scout exposed facilities and use ground pressure where it makes sense.'],
        ['Upgrade for the problem', 'Use the strategic upgrade controls for accuracy and warhead improvements. Keep enough money to maintain production and replace losses.'],
        ['Answer enemy aircraft', 'Iran has no aircraft production. Use available anti-air defenses and air-capable ground units to protect important facilities and your advancing army.'],
        ['Keep the objective in sight', 'Repair damaged buildings, protect your Command HQ and destroy every hostile Command HQ. Long-range damage matters when it helps secure that objective.'],
      ], do: 'Alternate strategic pressure and ground action based on what the opponent is building.',
      avoid: 'Repeating an intercepted strike while ignoring aircraft, ground raids or a failing economy.' },
  ],
};

export function guideFlag(faction: GuideFaction): string {
  return faction === 'israel'
    ? '<svg viewBox="0 0 60 40" aria-hidden="true"><path fill="#fff" d="M0 0h60v40H0z"/><path fill="#1858b0" d="M0 6h60v5H0zm0 23h60v5H0z"/><path d="m30 13 7 11H23zm0 14-7-11h14z" fill="none" stroke="#1858b0" stroke-width="1.6"/></svg>'
    : '<svg viewBox="0 0 60 40" aria-hidden="true"><path fill="#fff" d="M0 0h60v40H0z"/><path fill="#249f58" d="M0 0h60v13H0z"/><path fill="#da2737" d="M0 27h60v13H0z"/><text x="30" y="25" text-anchor="middle" fill="#da2737" font-size="18" font-family="serif">☫</text></svg>';
}
