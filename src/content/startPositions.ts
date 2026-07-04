export type StartTeam = 1 | 2;

const START_FACTORS: Record<StartTeam, { x: number; z: number }> = {
  1: { x: -0.22, z: -0.22 },
  2: { x: 0.22, z: 0.22 },
};

export function startPosition(size: number, team: StartTeam): { x: number; z: number } {
  const factor = START_FACTORS[team];
  return { x: size * factor.x, z: size * factor.z };
}

export function startMusterPosition(size: number, team: StartTeam): { x: number; z: number } {
  const base = startPosition(size, team);
  const inward = size * 0.025;
  return {
    x: base.x + (team === 1 ? inward : -inward),
    z: base.z + (team === 1 ? inward : -inward),
  };
}
