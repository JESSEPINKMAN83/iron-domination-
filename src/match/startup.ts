const AUTOSTART_QUERY_KEYS = ['start', 'map', 'seed', 'ore', 'ai', 'ai-style', 'combat', 'armies', 'sides', 'debug'];

export function shouldAutostartFromUrl(params: URLSearchParams): boolean {
  return AUTOSTART_QUERY_KEYS.some((key) => params.has(key));
}

export function aiControlledTeams(armyCount: number, humanTeams: Iterable<number>): number[] {
  const humans = new Set(Array.from(humanTeams).filter((team) => Number.isInteger(team) && team >= 1 && team <= armyCount));
  return Array.from({ length: Math.max(0, Math.floor(armyCount)) }, (_, index) => index + 1).filter((team) => !humans.has(team));
}

export function ensureOpposingSides(armyCount: number, armySides: readonly number[]): [number, number, number, number] {
  const count = Math.max(2, Math.min(4, Math.floor(armyCount) || 2));
  const sides = [0, 1, 2, 3].map((index) => {
    const side = Math.floor(Number(armySides[index]));
    return Number.isFinite(side) ? Math.max(1, Math.min(4, side)) : index + 1;
  }) as [number, number, number, number];
  if (new Set(sides.slice(0, count)).size < 2) sides[1] = sides[0] === 1 ? 2 : 1;
  return sides;
}

export function formatArmyMatchup(armyCount: number, armySides: readonly number[]): string {
  const count = Math.max(2, Math.min(4, Math.floor(armyCount) || 2));
  const groups = new Map<number, number[]>();
  for (let army = 1; army <= count; army++) {
    const side = Math.max(1, Math.min(4, Math.floor(Number(armySides[army - 1])) || army));
    const members = groups.get(side) ?? [];
    members.push(army);
    groups.set(side, members);
  }
  return Array.from(groups.entries())
    .map(([side, armies]) => `SIDE ${side}: ${armies.map((army) => `ARMY ${army}`).join(' + ')}`)
    .join('  VS  ');
}

export function isVictoryFromHostileBuildingCounts(counts: Iterable<number>): boolean {
  const hostileBuildings = Array.from(counts);
  return hostileBuildings.length > 0 && hostileBuildings.every((count) => count === 0);
}
