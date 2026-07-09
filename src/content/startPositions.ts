export type StartTeam = 1 | 2 | 3 | 4;

const START_FACTORS: Record<StartTeam, { x: number; z: number }> = {
  1: { x: -0.34, z: -0.34 },
  2: { x: 0.34, z: 0.34 },
  3: { x: 0.34, z: -0.34 },
  4: { x: -0.34, z: 0.34 },
};

export function startPosition(size: number, team: number): { x: number; z: number } {
  const factor = START_FACTORS[clampStartTeam(team)];
  return { x: size * factor.x, z: size * factor.z };
}

export function startMusterPosition(size: number, team: number): { x: number; z: number } {
  const base = startPosition(size, team);
  const inward = size * 0.025;
  const factor = START_FACTORS[clampStartTeam(team)];
  return {
    x: base.x - Math.sign(factor.x) * inward,
    z: base.z - Math.sign(factor.z) * inward,
  };
}

function clampStartTeam(team: number): StartTeam {
  return team === 2 || team === 3 || team === 4 ? team : 1;
}
