const AUTOSTART_QUERY_KEYS = ['start', 'map', 'seed', 'ai', 'ai-style', 'combat', 'armies', 'sides', 'debug'];

export function shouldAutostartFromUrl(params: URLSearchParams): boolean {
  return AUTOSTART_QUERY_KEYS.some((key) => params.has(key));
}

export function aiControlledTeams(armyCount: number, humanTeams: Iterable<number>): number[] {
  const humans = new Set(Array.from(humanTeams).filter((team) => Number.isInteger(team) && team >= 1 && team <= armyCount));
  return Array.from({ length: Math.max(0, Math.floor(armyCount)) }, (_, index) => index + 1).filter((team) => !humans.has(team));
}
